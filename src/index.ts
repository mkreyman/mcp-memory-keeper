import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { KnowledgeGraphManager } from './utils/knowledge-graph.js';
import { VectorStore } from './utils/vector-store.js';
import { AgentCoordinator, AnalyzerAgent, SynthesizerAgent, AgentTask } from './utils/agents.js';
import { RetentionManager } from './utils/retention.js';
import { FeatureFlagManager } from './utils/feature-flags.js';
import { MigrationManager } from './utils/migrations.js';

// Initialize database
const db = new Database('context.db');

// Initialize git - will be updated with project directory
let git: SimpleGit = simpleGit();
let projectDirectory: string | undefined = undefined;

// Initialize knowledge graph manager
const knowledgeGraph = new KnowledgeGraphManager(db);

// Initialize vector store
const vectorStore = new VectorStore(db);

// Initialize multi-agent system
const agentCoordinator = new AgentCoordinator();
const analyzerAgent = new AnalyzerAgent(db, knowledgeGraph, vectorStore);
const synthesizerAgent = new SynthesizerAgent(db, vectorStore);
agentCoordinator.registerAgent(analyzerAgent);
agentCoordinator.registerAgent(synthesizerAgent);

// Initialize retention manager
const retentionManager = new RetentionManager({ getDatabase: () => db } as any);

// Initialize feature flag manager
const featureFlagManager = new FeatureFlagManager({ getDatabase: () => db } as any);

// Initialize migration manager
const migrationManager = new MigrationManager({ getDatabase: () => db } as any);

// Create tables with enhanced schema
db.exec(`
  -- Sessions table
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    branch TEXT,
    parent_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES sessions(id)
  );

  -- Enhanced context_items table with session support
  CREATE TABLE IF NOT EXISTS context_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT,
    priority TEXT DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    UNIQUE(session_id, key)
  );

  -- File cache table
  CREATE TABLE IF NOT EXISTS file_cache (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT,
    hash TEXT,
    last_read TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    UNIQUE(session_id, file_path)
  );

  -- Checkpoints table (Phase 2)
  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    git_status TEXT,
    git_branch TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  -- Checkpoint items table (Phase 2)
  CREATE TABLE IF NOT EXISTS checkpoint_items (
    id TEXT PRIMARY KEY,
    checkpoint_id TEXT NOT NULL,
    context_item_id TEXT NOT NULL,
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id),
    FOREIGN KEY (context_item_id) REFERENCES context_items(id)
  );

  -- Checkpoint files table (Phase 2)
  CREATE TABLE IF NOT EXISTS checkpoint_files (
    id TEXT PRIMARY KEY,
    checkpoint_id TEXT NOT NULL,
    file_cache_id TEXT NOT NULL,
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id),
    FOREIGN KEY (file_cache_id) REFERENCES file_cache(id)
  );

  -- Journal entries table (Phase 4.4)
  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    entry TEXT NOT NULL,
    tags TEXT,
    mood TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  -- Compressed context table (Phase 4.4)
  CREATE TABLE IF NOT EXISTS compressed_context (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    original_count INTEGER NOT NULL,
    compressed_data TEXT NOT NULL,
    compression_ratio REAL NOT NULL,
    date_range_start TIMESTAMP,
    date_range_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  -- Cross-tool integration events (Phase 4.4)
  CREATE TABLE IF NOT EXISTS tool_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`);

// Track current session
let currentSessionId: string | null = null;

// Helper function to get or create default session
function ensureSession(): string {
  if (!currentSessionId) {
    const session = db.prepare('SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1').get() as any;
    if (session) {
      currentSessionId = session.id;
    } else {
      // Create default session
      currentSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
        currentSessionId,
        'Default Session',
        'Auto-created default session'
      );
    }
  }
  return currentSessionId!;
}

// Helper to calculate file hash
function calculateFileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Helper to get project directory setup message
function getProjectDirectorySetupMessage(): string {
  return `⚠️ No project directory set for git tracking!

To enable git tracking for your project, use one of these methods:

1. For the current session:
   context_set_project_dir({ projectDir: "/path/to/your/project" })

2. When starting a new session:
   context_session_start({ name: "My Session", projectDir: "/path/to/your/project" })

This allows the MCP server to track git changes in your actual project directory.`;
}

// Helper to get git status
async function getGitStatus(): Promise<{ status: string; branch: string }> {
  if (!projectDirectory) {
    return { status: 'No project directory set', branch: 'none' };
  }
  
  try {
    const status = await git.status();
    const branch = await git.branch();
    return {
      status: JSON.stringify({
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        staged: status.staged,
        ahead: status.ahead,
        behind: status.behind,
      }),
      branch: branch.current,
    };
  } catch (e) {
    return { status: 'No git repository', branch: 'none' };
  }
}

// Helper to create summary
function createSummary(items: any[], options: { categories?: string[]; maxLength?: number }): string {
  const { categories, maxLength = 1000 } = options;
  
  let filteredItems = items;
  if (categories && categories.length > 0) {
    filteredItems = items.filter(item => categories.includes(item.category));
  }

  // Group by category
  const grouped: Record<string, any[]> = filteredItems.reduce((acc, item) => {
    const cat = item.category || 'uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, any[]>);

  // Build summary
  let summary = '# Context Summary\n\n';
  
  // High priority items first
  const highPriorityItems = filteredItems.filter(item => item.priority === 'high');
  if (highPriorityItems.length > 0) {
    summary += '## High Priority Items\n';
    highPriorityItems.forEach(item => {
      summary += `- **${item.key}**: ${item.value.substring(0, 200)}${item.value.length > 200 ? '...' : ''}\n`;
    });
    summary += '\n';
  }

  // Then by category
  Object.entries(grouped).forEach(([category, categoryItems]) => {
    if (category !== 'uncategorized') {
      summary += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n`;
      categoryItems.forEach((item: any) => {
        if (item.priority !== 'high') { // Already shown above
          summary += `- ${item.key}: ${item.value.substring(0, 100)}${item.value.length > 100 ? '...' : ''}\n`;
        }
      });
      summary += '\n';
    }
  });

  // Truncate if needed
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength - 3) + '...';
  }

  return summary;
}

// Create MCP server
const server = new Server(
  {
    name: 'memory-keeper',
    version: '0.8.1',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Main request handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments as any;

  switch (toolName) {
    // Session Management
    case 'context_session_start': {
      const { name, description, continueFrom, projectDir } = args;
      const sessionId = uuidv4();
      
      // Update project directory if provided
      if (projectDir) {
        projectDirectory = projectDir;
        git = simpleGit(projectDirectory);
      }
      
      // Get current git branch if available
      let branch = null;
      let gitDetected = false;
      try {
        if (projectDirectory) {
          // Use simple-git to get branch info
          const branchInfo = await git.branch();
          branch = branchInfo.current;
          gitDetected = true;
        } else {
          // Try to detect if current directory has git
          const gitHeadPath = path.join(process.cwd(), '.git', 'HEAD');
          if (fs.existsSync(gitHeadPath)) {
            const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
            if (headContent.startsWith('ref: refs/heads/')) {
              branch = headContent.replace('ref: refs/heads/', '');
            }
          }
        }
      } catch (e) {
        // Ignore git errors
      }

      db.prepare('INSERT INTO sessions (id, name, description, branch, working_directory) VALUES (?, ?, ?, ?, ?)').run(
        sessionId,
        name || `Session ${new Date().toISOString()}`,
        description || '',
        branch,
        projectDir || null
      );

      // Copy context from previous session if specified
      if (continueFrom) {
        const copyStmt = db.prepare(`
          INSERT INTO context_items (id, session_id, key, value, category, priority)
          SELECT ?, ?, key, value, category, priority
          FROM context_items
          WHERE session_id = ?
        `);
        
        const items = db.prepare('SELECT * FROM context_items WHERE session_id = ?').all(continueFrom);
        for (const item of items) {
          copyStmt.run(uuidv4(), sessionId, continueFrom);
        }
      }

      currentSessionId = sessionId;

      let statusMessage = `Started new session: ${sessionId}\nName: ${name || 'Unnamed'}`;
      
      if (projectDirectory) {
        statusMessage += `\nProject directory: ${projectDirectory}`;
        if (gitDetected) {
          statusMessage += `\nGit branch: ${branch || 'unknown'}`;
        } else {
          statusMessage += `\nGit: No repository found in project directory`;
        }
      } else {
        statusMessage += `\nGit branch: ${branch || 'unknown'}`;
        
        // Provide helpful guidance about setting project directory
        const cwdHasGit = fs.existsSync(path.join(process.cwd(), '.git'));
        if (cwdHasGit) {
          statusMessage += `\n\n💡 Tip: Your current directory has a git repository. To enable full git tracking, start a session with:\ncontext_session_start({ name: "${name || 'My Session'}", projectDir: "${process.cwd()}" })`;
        } else {
          // Check for git repos in immediate subdirectories
          const subdirs = fs.readdirSync(process.cwd(), { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .filter(name => !name.startsWith('.'));
          
          const gitSubdirs = subdirs.filter(dir => {
            try {
              return fs.existsSync(path.join(process.cwd(), dir, '.git'));
            } catch {
              return false;
            }
          });
          
          if (gitSubdirs.length > 0) {
            statusMessage += `\n\n💡 Found git repositories in: ${gitSubdirs.join(', ')}`;
            statusMessage += `\nTo enable git tracking, start a session with your project directory:`;
            statusMessage += `\ncontext_session_start({ name: "${name || 'My Session'}", projectDir: "${path.join(process.cwd(), gitSubdirs[0])}" })`;
          } else {
            statusMessage += `\n\n💡 To enable git tracking, start a session with your project directory:`;
            statusMessage += `\ncontext_session_start({ name: "${name || 'My Session'}", projectDir: "/path/to/your/project" })`;
          }
        }
      }
      
      return {
        content: [{
          type: 'text',
          text: statusMessage,
        }],
      };
    }

    case 'context_set_project_dir': {
      const { projectDir } = args;
      
      if (!projectDir) {
        throw new Error('Project directory path is required');
      }
      
      // Verify the directory exists
      if (!fs.existsSync(projectDir)) {
        return {
          content: [{
            type: 'text',
            text: `Error: Directory not found: ${projectDir}`,
          }],
        };
      }
      
      // Update the project directory and git instance
      projectDirectory = projectDir;
      git = simpleGit(projectDirectory);
      
      // Try to get git info to verify it's a git repo
      let gitInfo = 'No git repository found';
      try {
        const branchInfo = await git.branch();
        const status = await git.status();
        gitInfo = `Git repository detected\nBranch: ${branchInfo.current}\nStatus: ${status.modified.length} modified, ${status.created.length} new, ${status.deleted.length} deleted`;
      } catch (e) {
        // Not a git repo, that's okay
      }
      
      return {
        content: [{
          type: 'text',
          text: `Project directory set to: ${projectDir}\n\n${gitInfo}`,
        }],
      };
    }

    case 'context_session_list': {
      const { limit = 10 } = args;
      const sessions = db.prepare(`
        SELECT id, name, description, branch, created_at,
               (SELECT COUNT(*) FROM context_items WHERE session_id = sessions.id) as item_count
        FROM sessions
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);

      const sessionList = sessions.map((s: any) => 
        `• ${s.name} (${s.id.substring(0, 8)})\n  Created: ${s.created_at}\n  Items: ${s.item_count}\n  Branch: ${s.branch || 'unknown'}`
      ).join('\n\n');

      return {
        content: [{
          type: 'text',
          text: `Recent sessions:\n\n${sessionList}`,
        }],
      };
    }

    // Enhanced Context Storage
    case 'context_save': {
      const { key, value, category, priority = 'normal' } = args;
      const sessionId = ensureSession();
      const itemId = uuidv4();
      
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(itemId, sessionId, key, value, category, priority);
      
      // Create embedding for semantic search
      try {
        const content = `${key}: ${value}`;
        const metadata = { key, category, priority };
        await vectorStore.storeDocument(itemId, content, metadata);
      } catch (error) {
        // Log but don't fail the save operation
        console.error('Failed to create embedding:', error);
      }
      
      return {
        content: [{
          type: 'text',
          text: `Saved: ${key}\nCategory: ${category || 'none'}\nPriority: ${priority}\nSession: ${sessionId.substring(0, 8)}`,
        }],
      };
    }

    case 'context_get': {
      const { key, category, sessionId: specificSessionId } = args;
      const targetSessionId = specificSessionId || currentSessionId || ensureSession();
      
      let query = 'SELECT * FROM context_items WHERE session_id = ?';
      const params: any[] = [targetSessionId];
      
      if (key) {
        query += ' AND key = ?';
        params.push(key);
      }
      
      if (category) {
        query += ' AND category = ?';
        params.push(category);
      }
      
      query += ' ORDER BY priority DESC, created_at DESC';
      
      const rows = db.prepare(query).all(...params);
      
      if (rows.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No matching context found',
          }],
        };
      }
      
      if (key && rows.length === 1) {
        // Single item requested
        const item = rows[0] as any;
        return {
          content: [{
            type: 'text',
            text: item.value,
          }],
        };
      }
      
      // Multiple items
      const items = rows.map((r: any) => 
        `• [${r.priority}] ${r.key}: ${r.value.substring(0, 100)}${r.value.length > 100 ? '...' : ''}`
      ).join('\n');
      
      return {
        content: [{
          type: 'text',
          text: `Found ${rows.length} context items:\n\n${items}`,
        }],
      };
    }

    // File Caching
    case 'context_cache_file': {
      const { filePath, content } = args;
      const sessionId = ensureSession();
      const hash = calculateFileHash(content);
      
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO file_cache (id, session_id, file_path, content, hash)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run(uuidv4(), sessionId, filePath, content, hash);
      
      return {
        content: [{
          type: 'text',
          text: `Cached file: ${filePath}\nHash: ${hash.substring(0, 16)}...\nSize: ${content.length} bytes`,
        }],
      };
    }

    case 'context_file_changed': {
      const { filePath, currentContent } = args;
      const sessionId = ensureSession();
      
      const cached = db.prepare(
        'SELECT hash, content FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(sessionId, filePath) as any;
      
      if (!cached) {
        return {
          content: [{
            type: 'text',
            text: `No cached version found for: ${filePath}`,
          }],
        };
      }
      
      const currentHash = currentContent ? calculateFileHash(currentContent) : null;
      const hasChanged = currentHash !== cached.hash;
      
      return {
        content: [{
          type: 'text',
          text: `File: ${filePath}\nChanged: ${hasChanged}\nCached hash: ${cached.hash.substring(0, 16)}...\nCurrent hash: ${currentHash ? currentHash.substring(0, 16) + '...' : 'N/A'}`,
        }],
      };
    }

    case 'context_status': {
      const sessionId = currentSessionId || ensureSession();
      
      const stats = db.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM context_items WHERE session_id = ?) as item_count,
          (SELECT COUNT(*) FROM file_cache WHERE session_id = ?) as file_count,
          (SELECT created_at FROM sessions WHERE id = ?) as session_created,
          (SELECT name FROM sessions WHERE id = ?) as session_name
      `).get(sessionId, sessionId, sessionId, sessionId) as any;
      
      const recentItems = db.prepare(`
        SELECT key, category, priority FROM context_items 
        WHERE session_id = ? 
        ORDER BY created_at DESC 
        LIMIT 5
      `).all(sessionId);
      
      const recentList = recentItems.map((item: any) => 
        `  • [${item.priority}] ${item.key} (${item.category || 'uncategorized'})`
      ).join('\n');
      
      return {
        content: [{
          type: 'text',
          text: `Current Session: ${stats.session_name}
Session ID: ${sessionId.substring(0, 8)}
Created: ${stats.session_created}
Context Items: ${stats.item_count}
Cached Files: ${stats.file_count}

Recent Items:
${recentList || '  None'}`,
        }],
      };
    }

    // Phase 2: Checkpoint System
    case 'context_checkpoint': {
      const { name, description, includeFiles = true, includeGitStatus = true } = args;
      const sessionId = ensureSession();
      const checkpointId = uuidv4();
      
      // Get git status if requested
      let gitStatus = null;
      let gitBranch = null;
      if (includeGitStatus) {
        const gitInfo = await getGitStatus();
        gitStatus = gitInfo.status;
        gitBranch = gitInfo.branch;
      }

      // Create checkpoint
      db.prepare(`
        INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(checkpointId, sessionId, name, description || '', gitStatus, gitBranch);

      // Save context items
      const contextItems = db.prepare('SELECT id FROM context_items WHERE session_id = ?').all(sessionId);
      const itemStmt = db.prepare('INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)');
      for (const item of contextItems) {
        itemStmt.run(uuidv4(), checkpointId, (item as any).id);
      }

      // Save file cache if requested
      let fileCount = 0;
      if (includeFiles) {
        const files = db.prepare('SELECT id FROM file_cache WHERE session_id = ?').all(sessionId);
        const fileStmt = db.prepare('INSERT INTO checkpoint_files (id, checkpoint_id, file_cache_id) VALUES (?, ?, ?)');
        for (const file of files) {
          fileStmt.run(uuidv4(), checkpointId, (file as any).id);
          fileCount++;
        }
      }

      let statusText = `Created checkpoint: ${name}
ID: ${checkpointId.substring(0, 8)}
Context items: ${contextItems.length}
Cached files: ${fileCount}
Git branch: ${gitBranch || 'none'}
Git status: ${gitStatus ? 'captured' : 'not captured'}`;

      // Add helpful message if git status was requested but no project directory is set
      if (includeGitStatus && !projectDirectory) {
        statusText += `\n\n💡 Note: Git status was requested but no project directory is set.
To enable git tracking, use context_set_project_dir with your project path.`;
      }

      return {
        content: [{
          type: 'text',
          text: statusText,
        }],
      };
    }

    case 'context_restore_checkpoint': {
      const { name, checkpointId, restoreFiles = true } = args;
      
      // Find checkpoint
      let checkpoint;
      if (checkpointId) {
        checkpoint = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId);
      } else if (name) {
        checkpoint = db.prepare('SELECT * FROM checkpoints ORDER BY created_at DESC').all()
          .find((cp: any) => cp.name === name);
      } else {
        // Get latest checkpoint
        checkpoint = db.prepare('SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 1').get();
      }

      if (!checkpoint) {
        return {
          content: [{
            type: 'text',
            text: 'No checkpoint found',
          }],
        };
      }

      const cp = checkpoint as any;
      
      // Start new session from checkpoint
      const newSessionId = uuidv4();
      db.prepare(`
        INSERT INTO sessions (id, name, description, branch)
        VALUES (?, ?, ?, ?)
      `).run(
        newSessionId,
        `Restored from: ${cp.name}`,
        `Checkpoint ${cp.id.substring(0, 8)} created at ${cp.created_at}`,
        cp.git_branch
      );

      // Restore context items
      const contextItems = db.prepare(`
        SELECT ci.* FROM context_items ci
        JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
        WHERE cpi.checkpoint_id = ?
      `).all(cp.id);

      const itemStmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, category, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of contextItems) {
        itemStmt.run(
          uuidv4(),
          newSessionId,
          (item as any).key,
          (item as any).value,
          (item as any).category,
          (item as any).priority,
          (item as any).created_at
        );
      }

      // Restore file cache if requested
      let fileCount = 0;
      if (restoreFiles) {
        const files = db.prepare(`
          SELECT fc.* FROM file_cache fc
          JOIN checkpoint_files cpf ON fc.id = cpf.file_cache_id
          WHERE cpf.checkpoint_id = ?
        `).all(cp.id);

        const fileStmt = db.prepare(`
          INSERT INTO file_cache (id, session_id, file_path, content, hash, last_read)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const file of files) {
          fileStmt.run(
            uuidv4(),
            newSessionId,
            (file as any).file_path,
            (file as any).content,
            (file as any).hash,
            (file as any).last_read
          );
          fileCount++;
        }
      }

      currentSessionId = newSessionId;

      return {
        content: [{
          type: 'text',
          text: `Restored from checkpoint: ${cp.name}
New session: ${newSessionId.substring(0, 8)}
Context items restored: ${contextItems.length}
Files restored: ${fileCount}
Original git branch: ${cp.git_branch || 'none'}
Original checkpoint created: ${cp.created_at}`,
        }],
      };
    }

    // Phase 2: Summarization
    case 'context_summarize': {
      const { sessionId: specificSessionId, categories, maxLength } = args;
      const targetSessionId = specificSessionId || currentSessionId || ensureSession();
      
      const items = db.prepare(`
        SELECT * FROM context_items 
        WHERE session_id = ? 
        ORDER BY priority DESC, created_at DESC
      `).all(targetSessionId);

      const summary = createSummary(items, { categories, maxLength });

      return {
        content: [{
          type: 'text',
          text: summary,
        }],
      };
    }

    // Phase 3: Smart Compaction Helper
    case 'context_prepare_compaction': {
      const sessionId = ensureSession();
      
      // Get all high priority items
      const highPriorityItems = db.prepare(`
        SELECT * FROM context_items 
        WHERE session_id = ? AND priority = 'high'
        ORDER BY created_at DESC
      `).all(sessionId);

      // Get recent tasks
      const recentTasks = db.prepare(`
        SELECT * FROM context_items 
        WHERE session_id = ? AND category = 'task'
        ORDER BY created_at DESC LIMIT 10
      `).all(sessionId);

      // Get all decisions
      const decisions = db.prepare(`
        SELECT * FROM context_items 
        WHERE session_id = ? AND category = 'decision'
        ORDER BY created_at DESC
      `).all(sessionId);

      // Get files that changed
      const changedFiles = db.prepare(`
        SELECT file_path, hash FROM file_cache 
        WHERE session_id = ?
      `).all(sessionId);

      // Auto-create checkpoint
      const checkpointId = uuidv4();
      const checkpointName = `auto-compaction-${new Date().toISOString()}`;
      
      const gitInfo = await getGitStatus();
      
      db.prepare(`
        INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        checkpointId, 
        sessionId, 
        checkpointName,
        'Automatic checkpoint before compaction',
        gitInfo.status,
        gitInfo.branch
      );

      // Save all context items to checkpoint
      const allItems = db.prepare('SELECT id FROM context_items WHERE session_id = ?').all(sessionId);
      const itemStmt = db.prepare('INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)');
      for (const item of allItems) {
        itemStmt.run(uuidv4(), checkpointId, (item as any).id);
      }

      // Generate summary for next session
      const summary = createSummary([...highPriorityItems, ...recentTasks, ...decisions], { maxLength: 2000 });
      
      // Determine next steps
      const nextSteps: string[] = [];
      const unfinishedTasks = recentTasks.filter((t: any) => 
        !t.value.toLowerCase().includes('completed') && 
        !t.value.toLowerCase().includes('done')
      );
      
      unfinishedTasks.forEach((task: any) => {
        nextSteps.push(`Continue: ${task.key}`);
      });

      // Save prepared context
      const preparedContext = {
        checkpoint: checkpointName,
        summary,
        nextSteps,
        criticalItems: highPriorityItems.map((i: any) => ({ key: i.key, value: i.value })),
        decisions: decisions.map((d: any) => ({ key: d.key, value: d.value })),
        filesModified: changedFiles.length,
        gitBranch: gitInfo.branch
      };

      // Save as special context item
      db.prepare(`
        INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        sessionId,
        '_prepared_compaction',
        JSON.stringify(preparedContext),
        'system',
        'high'
      );

      return {
        content: [{
          type: 'text',
          text: `Prepared for compaction:

Checkpoint: ${checkpointName}
Critical items saved: ${highPriorityItems.length}
Decisions preserved: ${decisions.length}
Next steps identified: ${nextSteps.length}
Files tracked: ${changedFiles.length}

Summary:
${summary.substring(0, 500)}${summary.length > 500 ? '...' : ''}

Next Steps:
${nextSteps.join('\n')}

To restore after compaction:
mcp_context_restore_checkpoint({ name: "${checkpointName}" })`,
        }],
      };
    }

    // Phase 3: Git Integration
    case 'context_git_commit': {
      const { message, autoSave = true } = args;
      const sessionId = ensureSession();
      
      // Check if project directory is set
      if (!projectDirectory) {
        return {
          content: [{
            type: 'text',
            text: getProjectDirectorySetupMessage(),
          }],
        };
      }
      
      if (autoSave) {
        // Save current context state
        const timestamp = new Date().toISOString();
        db.prepare(`
          INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          uuidv4(),
          sessionId,
          `commit_${timestamp}`,
          message || 'No commit message',
          'git',
          'normal'
        );

        // Create checkpoint
        const checkpointId = uuidv4();
        const checkpointName = `git-commit-${timestamp}`;
        const gitInfo = await getGitStatus();
        
        db.prepare(`
          INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          checkpointId,
          sessionId,
          checkpointName,
          `Git commit: ${message || 'No message'}`,
          gitInfo.status,
          gitInfo.branch
        );

        // Link current context to checkpoint
        const items = db.prepare('SELECT id FROM context_items WHERE session_id = ?').all(sessionId);
        const itemStmt = db.prepare('INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)');
        for (const item of items) {
          itemStmt.run(uuidv4(), checkpointId, (item as any).id);
        }
      }

      // Execute git commit
      try {
        await git.add('.');
        const commitResult = await git.commit(message || 'Commit via Memory Keeper');
        
        return {
          content: [{
            type: 'text',
            text: `Git commit successful!
Commit: ${commitResult.commit}
Context saved: ${autoSave ? 'Yes' : 'No'}
Checkpoint: ${autoSave ? `git-commit-${new Date().toISOString()}` : 'None'}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Git commit failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 3: Context Search
    case 'context_search': {
      const { query, searchIn = ['key', 'value'], sessionId: specificSessionId } = args;
      const targetSessionId = specificSessionId || currentSessionId || ensureSession();
      
      let conditions: string[] = [];
      if (searchIn.includes('key')) {
        conditions.push('key LIKE ?');
      }
      if (searchIn.includes('value')) {
        conditions.push('value LIKE ?');
      }
      
      const whereClause = conditions.length > 0 ? `AND (${conditions.join(' OR ')})` : '';
      const queryParams = [targetSessionId, ...conditions.map(() => `%${query}%`)];
      
      const results = db.prepare(`
        SELECT * FROM context_items 
        WHERE session_id = ? ${whereClause}
        ORDER BY priority DESC, created_at DESC
        LIMIT 20
      `).all(...queryParams);

      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No results found for: "${query}"`,
          }],
        };
      }

      const resultText = results.map((r: any) => 
        `• [${r.priority}] ${r.key} (${r.category || 'none'})\n  ${r.value.substring(0, 100)}${r.value.length > 100 ? '...' : ''}`
      ).join('\n\n');

      return {
        content: [{
          type: 'text',
          text: `Found ${results.length} results for "${query}":\n\n${resultText}`,
        }],
      };
    }

    // Phase 3: Export/Import
    case 'context_export': {
      const { sessionId: specificSessionId, format = 'json' } = args;
      const targetSessionId = specificSessionId || currentSessionId || ensureSession();
      
      // Get session data
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(targetSessionId) as any;
      const contextItems = db.prepare('SELECT * FROM context_items WHERE session_id = ?').all(targetSessionId);
      const fileCache = db.prepare('SELECT * FROM file_cache WHERE session_id = ?').all(targetSessionId);
      
      const exportData = {
        version: '0.4.0',
        exported: new Date().toISOString(),
        session,
        contextItems,
        fileCache,
      };

      if (format === 'json') {
        const exportPath = `memory-keeper-export-${targetSessionId.substring(0, 8)}.json`;
        fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
        
        return {
          content: [{
            type: 'text',
            text: `Exported session to: ${exportPath}
Items: ${contextItems.length}
Files: ${fileCache.length}`,
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(exportData, null, 2),
        }],
      };
    }

    case 'context_import': {
      const { filePath, merge = false } = args;
      
      try {
        const importData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Create new session or merge
        let targetSessionId: string;
        if (merge && currentSessionId) {
          targetSessionId = currentSessionId;
        } else {
          targetSessionId = uuidv4();
          const importedSession = importData.session;
          db.prepare(`
            INSERT INTO sessions (id, name, description, branch, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            targetSessionId,
            `Imported: ${importedSession.name}`,
            `Imported from ${filePath} on ${new Date().toISOString()}`,
            importedSession.branch,
            new Date().toISOString()
          );
          currentSessionId = targetSessionId;
        }

        // Import context items
        const itemStmt = db.prepare(`
          INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        let itemCount = 0;
        for (const item of importData.contextItems) {
          itemStmt.run(
            uuidv4(),
            targetSessionId,
            item.key,
            item.value,
            item.category,
            item.priority,
            item.created_at
          );
          itemCount++;
        }

        // Import file cache
        const fileStmt = db.prepare(`
          INSERT OR REPLACE INTO file_cache (id, session_id, file_path, content, hash, last_read)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        let fileCount = 0;
        for (const file of importData.fileCache || []) {
          fileStmt.run(
            uuidv4(),
            targetSessionId,
            file.file_path,
            file.content,
            file.hash,
            file.last_read
          );
          fileCount++;
        }

        return {
          content: [{
            type: 'text',
            text: `Import successful!
Session: ${targetSessionId.substring(0, 8)}
Context items: ${itemCount}
Files: ${fileCount}
Mode: ${merge ? 'Merged' : 'New session'}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Import failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.1: Knowledge Graph Tools
    case 'context_analyze': {
      const { sessionId, categories } = args;
      const targetSessionId = sessionId || ensureSession();
      
      try {
        // Get context items to analyze
        let query = 'SELECT * FROM context_items WHERE session_id = ?';
        const params: any[] = [targetSessionId];
        
        if (categories && categories.length > 0) {
          query += ` AND category IN (${categories.map(() => '?').join(',')})`;
          params.push(...categories);
        }
        
        const items = db.prepare(query).all(...params) as any[];
        
        let entitiesCreated = 0;
        let relationsCreated = 0;
        
        // Analyze each context item
        for (const item of items) {
          const analysis = knowledgeGraph.analyzeContext(targetSessionId, item.value);
          
          // Create entities
          for (const entityData of analysis.entities) {
            const existing = knowledgeGraph.findEntity(targetSessionId, entityData.name, entityData.type);
            if (!existing) {
              knowledgeGraph.createEntity(
                targetSessionId,
                entityData.type,
                entityData.name,
                { confidence: entityData.confidence, source: item.key }
              );
              entitiesCreated++;
            }
          }
          
          // Create relations
          for (const relationData of analysis.relations) {
            const subject = knowledgeGraph.findEntity(targetSessionId, relationData.subject);
            const object = knowledgeGraph.findEntity(targetSessionId, relationData.object);
            
            if (subject && object) {
              knowledgeGraph.createRelation(
                targetSessionId,
                subject.id,
                relationData.predicate,
                object.id,
                relationData.confidence
              );
              relationsCreated++;
            }
          }
        }
        
        // Get summary statistics
        const entityStats = db.prepare(`
          SELECT type, COUNT(*) as count 
          FROM entities 
          WHERE session_id = ? 
          GROUP BY type
        `).all(targetSessionId) as any[];
        
        return {
          content: [{
            type: 'text',
            text: `Analysis complete!
Items analyzed: ${items.length}
Entities created: ${entitiesCreated}
Relations created: ${relationsCreated}

Entity breakdown:
${entityStats.map(s => `- ${s.type}: ${s.count}`).join('\n')}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Analysis failed: ${error.message}`,
          }],
        };
      }
    }
    
    case 'context_find_related': {
      const { key, relationTypes, maxDepth = 2 } = args;
      const sessionId = ensureSession();
      
      try {
        // First try to find as entity
        let entity = knowledgeGraph.findEntity(sessionId, key);
        
        // If not found as entity, check if it's a context key
        if (!entity) {
          const contextItem = db.prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND key = ?'
          ).get(sessionId, key) as any;
          
          if (contextItem) {
            // Try to extract entities from the context value
            const analysis = knowledgeGraph.analyzeContext(sessionId, contextItem.value);
            if (analysis.entities.length > 0) {
              entity = knowledgeGraph.findEntity(sessionId, analysis.entities[0].name);
            }
          }
        }
        
        if (!entity) {
          return {
            content: [{
              type: 'text',
              text: `No entity found for key: ${key}`,
            }],
          };
        }
        
        // Get connected entities
        const connectedIds = knowledgeGraph.getConnectedEntities(entity.id, maxDepth);
        
        // Get details for connected entities
        const entities = Array.from(connectedIds).map(id => {
          const entityData = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
          const relations = knowledgeGraph.getRelations(id);
          const observations = knowledgeGraph.getObservations(id);
          
          return {
            ...entityData,
            attributes: entityData.attributes ? JSON.parse(entityData.attributes) : {},
            relations: relations.length,
            observations: observations.length,
          };
        });
        
        // Filter by relation types if specified
        let relevantRelations = knowledgeGraph.getRelations(entity.id);
        if (relationTypes && relationTypes.length > 0) {
          relevantRelations = relevantRelations.filter(r => 
            relationTypes.includes(r.predicate)
          );
        }
        
        return {
          content: [{
            type: 'text',
            text: `Related entities for "${key}":

Found ${entities.length} connected entities (max depth: ${maxDepth})

Main entity:
- Type: ${entity.type}
- Name: ${entity.name}
- Direct relations: ${relevantRelations.length}

Connected entities:
${entities.slice(0, 20).map(e => 
  `- ${e.type}: ${e.name} (${e.relations} relations, ${e.observations} observations)`
).join('\n')}
${entities.length > 20 ? `\n... and ${entities.length - 20} more` : ''}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Find related failed: ${error.message}`,
          }],
        };
      }
    }
    
    case 'context_visualize': {
      const { type = 'graph', entityTypes, sessionId } = args;
      const targetSessionId = sessionId || ensureSession();
      
      try {
        if (type === 'graph') {
          const graphData = knowledgeGraph.getGraphData(targetSessionId, entityTypes);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(graphData, null, 2),
            }],
          };
        } else if (type === 'timeline') {
          // Get time-based data
          const timeline = db.prepare(`
            SELECT 
              strftime('%Y-%m-%d %H:00', created_at) as hour,
              COUNT(*) as events,
              GROUP_CONCAT(DISTINCT category) as categories
            FROM context_items
            WHERE session_id = ?
            GROUP BY hour
            ORDER BY hour DESC
            LIMIT 24
          `).all(targetSessionId) as any[];
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                type: 'timeline',
                data: timeline,
              }, null, 2),
            }],
          };
        } else if (type === 'heatmap') {
          // Get category/priority heatmap data
          const heatmap = db.prepare(`
            SELECT 
              category,
              priority,
              COUNT(*) as count
            FROM context_items
            WHERE session_id = ?
            GROUP BY category, priority
          `).all(targetSessionId) as any[];
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                type: 'heatmap',
                data: heatmap,
              }, null, 2),
            }],
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: `Unknown visualization type: ${type}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Visualization failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.2: Semantic Search
    case 'context_semantic_search': {
      const { query, topK = 10, minSimilarity = 0.3, sessionId } = args;
      const targetSessionId = sessionId || ensureSession();
      
      try {
        // Ensure embeddings are up to date for the session
        const embeddingCount = await vectorStore.updateSessionEmbeddings(targetSessionId);
        
        // Perform semantic search
        const results = await vectorStore.searchInSession(
          targetSessionId,
          query,
          topK,
          minSimilarity
        );
        
        if (results.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No results found for query: "${query}"`,
            }],
          };
        }
        
        // Format results
        let response = `Found ${results.length} results for: "${query}"\n\n`;
        
        results.forEach((result, index) => {
          const similarity = (result.similarity * 100).toFixed(1);
          response += `${index + 1}. [${similarity}% match]\n`;
          
          // Extract key and value from content
          const colonIndex = result.content.indexOf(':');
          if (colonIndex > -1) {
            const key = result.content.substring(0, colonIndex);
            const value = result.content.substring(colonIndex + 1).trim();
            response += `   Key: ${key}\n`;
            response += `   Value: ${value.substring(0, 200)}${value.length > 200 ? '...' : ''}\n`;
          } else {
            response += `   ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}\n`;
          }
          
          if (result.metadata) {
            if (result.metadata.category) {
              response += `   Category: ${result.metadata.category}`;
            }
            if (result.metadata.priority) {
              response += `, Priority: ${result.metadata.priority}`;
            }
            response += '\n';
          }
          response += '\n';
        });
        
        return {
          content: [{
            type: 'text',
            text: response,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Semantic search failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.3: Multi-Agent System
    case 'context_delegate': {
      const { taskType, input, sessionId, chain = false } = args;
      const targetSessionId = sessionId || ensureSession();
      
      try {
        // Create agent task
        const task: AgentTask = {
          id: uuidv4(),
          type: taskType,
          input: {
            ...input,
            sessionId: targetSessionId
          }
        };
        
        // Process with agents
        let results;
        if (chain && Array.isArray(input)) {
          // Process as a chain of tasks
          const tasks = input.map((inp, index) => ({
            id: uuidv4(),
            type: Array.isArray(taskType) ? taskType[index] : taskType,
            input: { ...inp, sessionId: targetSessionId }
          }));
          results = await agentCoordinator.processChain(tasks);
        } else {
          // Single task delegation
          results = await agentCoordinator.delegate(task);
        }
        
        // Format response
        let response = `Agent Processing Results:\n\n`;
        
        for (const result of results) {
          response += `## ${result.agentType.toUpperCase()} Agent\n`;
          response += `Confidence: ${(result.confidence * 100).toFixed(0)}%\n`;
          response += `Processing Time: ${result.processingTime}ms\n`;
          
          if (result.reasoning) {
            response += `Reasoning: ${result.reasoning}\n`;
          }
          
          response += `\nOutput:\n`;
          response += JSON.stringify(result.output, null, 2);
          response += '\n\n---\n\n';
        }
        
        // Get best result if multiple agents processed
        if (results.length > 1) {
          const best = agentCoordinator.getBestResult(task.id);
          if (best) {
            response += `\n## Best Result (${best.agentType}, ${(best.confidence * 100).toFixed(0)}% confidence):\n`;
            response += JSON.stringify(best.output, null, 2);
          }
        }
        
        return {
          content: [{
            type: 'text',
            text: response,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Agent delegation failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.4: Session Branching
    case 'context_branch_session': {
      const { branchName, copyDepth = 'shallow' } = args;
      const sourceSessionId = ensureSession();
      
      try {
        // Get source session info
        const sourceSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sourceSessionId) as any;
        if (!sourceSession) {
          throw new Error('Source session not found');
        }
        
        // Create new branch session
        const branchId = uuidv4();
        db.prepare(`
          INSERT INTO sessions (id, name, description, branch, parent_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          branchId,
          branchName,
          `Branch of ${sourceSession.name} created at ${new Date().toISOString()}`,
          sourceSession.branch,
          sourceSessionId
        );
        
        if (copyDepth === 'deep') {
          // Copy all context items
          const items = db.prepare('SELECT * FROM context_items WHERE session_id = ?').all(sourceSessionId) as any[];
          const stmt = db.prepare('INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
          
          for (const item of items) {
            stmt.run(uuidv4(), branchId, item.key, item.value, item.category, item.priority, item.created_at);
          }
          
          // Copy file cache
          const files = db.prepare('SELECT * FROM file_cache WHERE session_id = ?').all(sourceSessionId) as any[];
          const fileStmt = db.prepare('INSERT INTO file_cache (id, session_id, file_path, content, hash, last_read) VALUES (?, ?, ?, ?, ?, ?)');
          
          for (const file of files) {
            fileStmt.run(uuidv4(), branchId, file.file_path, file.content, file.hash, file.last_read);
          }
        } else {
          // Shallow copy - only copy high priority items
          const items = db.prepare('SELECT * FROM context_items WHERE session_id = ? AND priority = ?').all(sourceSessionId, 'high') as any[];
          const stmt = db.prepare('INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
          
          for (const item of items) {
            stmt.run(uuidv4(), branchId, item.key, item.value, item.category, item.priority, item.created_at);
          }
        }
        
        // Switch to the new branch
        currentSessionId = branchId;
        
        return {
          content: [{
            type: 'text',
            text: `Created branch session: ${branchName}
ID: ${branchId}
Parent: ${sourceSession.name} (${sourceSessionId.substring(0, 8)})
Copy depth: ${copyDepth}
Items copied: ${copyDepth === 'deep' ? 'All' : 'High priority only'}

Now working in branch: ${branchName}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Branch creation failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.4: Session Merging
    case 'context_merge_sessions': {
      const { sourceSessionId, conflictResolution = 'keep_current' } = args;
      const targetSessionId = ensureSession();
      
      try {
        // Get both sessions
        const sourceSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sourceSessionId) as any;
        const targetSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(targetSessionId) as any;
        
        if (!sourceSession) {
          throw new Error('Source session not found');
        }
        
        // Get items from source session
        const sourceItems = db.prepare('SELECT * FROM context_items WHERE session_id = ?').all(sourceSessionId) as any[];
        
        let merged = 0;
        let skipped = 0;
        
        for (const item of sourceItems) {
          // Check if item exists in target
          const existing = db.prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?').get(targetSessionId, item.key) as any;
          
          if (existing) {
            // Handle conflict
            if (conflictResolution === 'keep_source' || 
                (conflictResolution === 'keep_newest' && new Date(item.created_at) > new Date(existing.created_at))) {
              db.prepare('UPDATE context_items SET value = ?, category = ?, priority = ? WHERE session_id = ? AND key = ?')
                .run(item.value, item.category, item.priority, targetSessionId, item.key);
              merged++;
            } else {
              skipped++;
            }
          } else {
            // No conflict, insert item
            db.prepare('INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(uuidv4(), targetSessionId, item.key, item.value, item.category, item.priority, item.created_at);
            merged++;
          }
        }
        
        return {
          content: [{
            type: 'text',
            text: `Merge completed!
Source: ${sourceSession.name} (${sourceSessionId.substring(0, 8)})
Target: ${targetSession.name} (${targetSessionId.substring(0, 8)})
Items merged: ${merged}
Items skipped: ${skipped}
Conflict resolution: ${conflictResolution}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Session merge failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.4: Journal Entry
    case 'context_journal_entry': {
      const { entry, tags = [], mood } = args;
      const sessionId = ensureSession();
      
      try {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO journal_entries (id, session_id, entry, tags, mood)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, sessionId, entry, JSON.stringify(tags), mood);
        
        return {
          content: [{
            type: 'text',
            text: `Journal entry added!
Time: ${new Date().toISOString()}
Mood: ${mood || 'not specified'}
Tags: ${tags.join(', ') || 'none'}
Entry saved with ID: ${id.substring(0, 8)}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Journal entry failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.4: Timeline
    case 'context_timeline': {
      const { startDate, endDate, groupBy = 'day', sessionId } = args;
      const targetSessionId = sessionId || ensureSession();
      
      try {
        let query = `
          SELECT 
            strftime('%Y-%m-%d', created_at) as date,
            strftime('%H', created_at) as hour,
            COUNT(*) as count,
            category
          FROM context_items
          WHERE session_id = ?
        `;
        const params: any[] = [targetSessionId];
        
        if (startDate) {
          query += ' AND created_at >= ?';
          params.push(startDate);
        }
        if (endDate) {
          query += ' AND created_at <= ?';
          params.push(endDate);
        }
        
        if (groupBy === 'hour') {
          query += ' GROUP BY date, hour, category ORDER BY date, hour';
        } else if (groupBy === 'week') {
          query = query.replace("strftime('%Y-%m-%d', created_at)", "strftime('%Y-W%W', created_at)");
          query += ' GROUP BY date, category ORDER BY date';
        } else {
          query += ' GROUP BY date, category ORDER BY date';
        }
        
        const timeline = db.prepare(query).all(...params) as any[];
        
        // Get journal entries for the same period
        let journalQuery = 'SELECT * FROM journal_entries WHERE session_id = ?';
        const journalParams: any[] = [targetSessionId];
        
        if (startDate) {
          journalQuery += ' AND created_at >= ?';
          journalParams.push(startDate);
        }
        if (endDate) {
          journalQuery += ' AND created_at <= ?';
          journalParams.push(endDate);
        }
        
        const journals = db.prepare(journalQuery + ' ORDER BY created_at').all(...journalParams) as any[];
        
        // Format timeline
        let response = `Timeline for session ${targetSessionId.substring(0, 8)}\n`;
        response += `Period: ${startDate || 'beginning'} to ${endDate || 'now'}\n\n`;
        
        // Group by date
        const dateGroups: Record<string, any> = {};
        for (const item of timeline) {
          if (!dateGroups[item.date]) {
            dateGroups[item.date] = { categories: {}, total: 0 };
          }
          dateGroups[item.date].categories[item.category || 'uncategorized'] = item.count;
          dateGroups[item.date].total += item.count;
        }
        
        // Add timeline data
        for (const [date, data] of Object.entries(dateGroups)) {
          response += `\n${date}: ${data.total} items\n`;
          for (const [category, count] of Object.entries(data.categories)) {
            response += `  ${category}: ${count}\n`;
          }
        }
        
        // Add journal entries
        if (journals.length > 0) {
          response += '\n## Journal Entries\n';
          for (const journal of journals) {
            const tags = JSON.parse(journal.tags || '[]');
            response += `\n${journal.created_at.substring(0, 10)} - ${journal.mood || 'no mood'}\n`;
            response += `Tags: ${tags.join(', ') || 'none'}\n`;
            response += `${journal.entry}\n`;
          }
        }
        
        return {
          content: [{
            type: 'text',
            text: response,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Timeline generation failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.4: Progressive Compression
    case 'context_compress': {
      const { olderThan, preserveCategories = [], targetSize, sessionId } = args;
      const targetSessionId = sessionId || ensureSession();
      
      try {
        // Build query for items to compress
        let query = 'SELECT * FROM context_items WHERE session_id = ?';
        const params: any[] = [targetSessionId];
        
        if (olderThan) {
          query += ' AND created_at < ?';
          params.push(olderThan);
        }
        
        if (preserveCategories.length > 0) {
          query += ` AND category NOT IN (${preserveCategories.map(() => '?').join(',')})`;
          params.push(...preserveCategories);
        }
        
        const itemsToCompress = db.prepare(query).all(...params) as any[];
        
        if (itemsToCompress.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No items found to compress with given criteria.',
            }],
          };
        }
        
        // Group items by category for compression
        const categoryGroups: Record<string, any[]> = {};
        for (const item of itemsToCompress) {
          const category = item.category || 'uncategorized';
          if (!categoryGroups[category]) {
            categoryGroups[category] = [];
          }
          categoryGroups[category].push(item);
        }
        
        // Compress each category group
        const compressed: any[] = [];
        for (const [category, items] of Object.entries(categoryGroups)) {
          const summary = {
            category,
            count: items.length,
            priorities: { high: 0, normal: 0, low: 0 },
            keys: items.map((i: any) => i.key),
            samples: items.slice(0, 3).map((i: any) => ({ key: i.key, value: i.value.substring(0, 100) }))
          };
          
          for (const item of items) {
            const priority = (item.priority || 'normal') as 'high' | 'normal' | 'low';
            summary.priorities[priority]++;
          }
          
          compressed.push(summary);
        }
        
        // Calculate compression
        const originalSize = JSON.stringify(itemsToCompress).length;
        const compressedData = JSON.stringify(compressed);
        const compressedSize = compressedData.length;
        const compressionRatio = 1 - (compressedSize / originalSize);
        
        // Store compressed data
        const compressedId = uuidv4();
        const dateRange = itemsToCompress.reduce((acc, item) => {
          const date = new Date(item.created_at);
          if (!acc.start || date < acc.start) acc.start = date;
          if (!acc.end || date > acc.end) acc.end = date;
          return acc;
        }, { start: null as Date | null, end: null as Date | null });
        
        db.prepare(`
          INSERT INTO compressed_context (id, session_id, original_count, compressed_data, compression_ratio, date_range_start, date_range_end)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          compressedId,
          targetSessionId,
          itemsToCompress.length,
          compressedData,
          compressionRatio,
          dateRange.start?.toISOString(),
          dateRange.end?.toISOString()
        );
        
        // Delete original items
        const deleteStmt = db.prepare('DELETE FROM context_items WHERE id = ?');
        for (const item of itemsToCompress) {
          deleteStmt.run(item.id);
        }
        
        return {
          content: [{
            type: 'text',
            text: `Compression completed!
Items compressed: ${itemsToCompress.length}
Original size: ${(originalSize / 1024).toFixed(2)} KB
Compressed size: ${(compressedSize / 1024).toFixed(2)} KB
Compression ratio: ${(compressionRatio * 100).toFixed(1)}%
Date range: ${dateRange.start?.toISOString().substring(0, 10)} to ${dateRange.end?.toISOString().substring(0, 10)}

Categories compressed:
${Object.entries(categoryGroups).map(([cat, items]) => `- ${cat}: ${items.length} items`).join('\n')}

Compressed data ID: ${compressedId.substring(0, 8)}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Compression failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 4.4: Cross-Tool Integration
    case 'context_integrate_tool': {
      const { toolName, eventType, data } = args;
      const sessionId = ensureSession();
      
      try {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO tool_events (id, session_id, tool_name, event_type, data)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, sessionId, toolName, eventType, JSON.stringify(data));
        
        // Optionally create a context item for important events
        if (data.important || eventType === 'error' || eventType === 'milestone') {
          db.prepare(`
            INSERT INTO context_items (id, session_id, key, value, category, priority)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            uuidv4(),
            sessionId,
            `${toolName}_${eventType}_${Date.now()}`,
            `Tool event: ${toolName} - ${eventType}: ${JSON.stringify(data)}`,
            'tool_event',
            data.important ? 'high' : 'normal'
          );
        }
        
        return {
          content: [{
            type: 'text',
            text: `Tool event recorded!
Tool: ${toolName}
Event: ${eventType}
Data recorded: ${JSON.stringify(data).length} bytes
Event ID: ${id.substring(0, 8)}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Tool integration failed: ${error.message}`,
          }],
        };
      }
    }

    // Phase 5: Retention Management
    case 'context_retention_create_policy': {
      try {
        const { policy } = args;
        
        if (!policy || !policy.name) {
          throw new Error('Policy object with name is required');
        }
        
        const policyId = retentionManager.createPolicy(policy);
        
        return {
          content: [{
            type: 'text',
            text: `Retention policy created successfully. ID: ${policyId}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to create retention policy: ${error.message}`,
          }],
        };
      }
    }

    case 'context_retention_list_policies': {
      try {
        const policies = retentionManager.listPolicies();
        
        return {
          content: [{
            type: 'text',
            text: `Found ${policies.length} retention policies:\n\n${
              policies.map(p => 
                `• ${p.name} (${p.enabled ? 'enabled' : 'disabled'})\n` +
                `  ID: ${p.id}\n` +
                `  Action: ${p.action}\n` +
                `  Schedule: ${p.schedule}\n` +
                `  Max Age: ${p.maxAge || 'none'}\n` +
                `  Last Run: ${p.lastRun || 'never'}`
              ).join('\n\n')
            }`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to list retention policies: ${error.message}`,
          }],
        };
      }
    }

    case 'context_retention_get_stats': {
      try {
        const { sessionId } = args;
        const stats = retentionManager.getRetentionStats(sessionId);
        
        return {
          content: [{
            type: 'text',
            text: `Retention Statistics${sessionId ? ` (Session: ${sessionId})` : ' (All Sessions)'}:\n\n` +
              `📊 Overall:\n` +
              `  • Total Items: ${stats.totalItems.toLocaleString()}\n` +
              `  • Total Size: ${(stats.totalSize / 1024).toFixed(1)}KB\n` +
              `  • Oldest Item: ${stats.oldestItem ? new Date(stats.oldestItem).toLocaleDateString() : 'N/A'}\n` +
              `  • Newest Item: ${stats.newestItem ? new Date(stats.newestItem).toLocaleDateString() : 'N/A'}\n\n` +
              `🗂️ By Category:\n${
                Object.entries(stats.byCategory)
                  .map(([cat, data]) => `  • ${cat}: ${data.count} items (${(data.size / 1024).toFixed(1)}KB)`)
                  .join('\n')
              }\n\n` +
              `⚡ By Priority:\n${
                Object.entries(stats.byPriority)
                  .map(([pri, data]) => `  • ${pri}: ${data.count} items (${(data.size / 1024).toFixed(1)}KB)`)
                  .join('\n')
              }\n\n` +
              `🧹 Retention Eligible:\n` +
              `  • Items: ${stats.eligibleForRetention.items.toLocaleString()}\n` +
              `  • Size: ${(stats.eligibleForRetention.size / 1024).toFixed(1)}KB\n` +
              `  • Potential Savings: ${stats.eligibleForRetention.savings}%`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get retention stats: ${error.message}`,
          }],
        };
      }
    }

    case 'context_retention_execute_policy': {
      try {
        const { policyId, dryRun = true } = args;
        
        if (!policyId) {
          throw new Error('Policy ID is required');
        }
        
        const result = await retentionManager.executePolicy(policyId, dryRun);
        
        return {
          content: [{
            type: 'text',
            text: `Retention Policy Execution ${dryRun ? '(DRY RUN)' : '(LIVE)'}\n\n` +
              `Policy: ${result.policyName}\n` +
              `Action: ${result.action}\n` +
              `Execution Time: ${result.executionTime}ms\n\n` +
              `📋 Processed:\n` +
              `  • Items: ${result.processed.items.toLocaleString()}\n` +
              `  • Size: ${(result.processed.size / 1024).toFixed(1)}KB\n` +
              `  • Sessions: ${result.processed.sessions.length}\n\n` +
              `💾 Saved:\n` +
              `  • Items: ${result.saved.items.toLocaleString()}\n` +
              `  • Size: ${(result.saved.size / 1024).toFixed(1)}KB\n\n` +
              `${result.errors.length > 0 ? `❌ Errors:\n${result.errors.map(e => `  • ${e}`).join('\n')}\n\n` : ''}` +
              `${result.warnings.length > 0 ? `⚠️ Warnings:\n${result.warnings.map(w => `  • ${w}`).join('\n')}\n\n` : ''}` +
              `${dryRun ? '🔍 This was a dry run. Use dryRun: false to execute for real.' : '✅ Retention policy executed successfully.'}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to execute retention policy: ${error.message}`,
          }],
        };
      }
    }

    case 'context_retention_setup_defaults': {
      try {
        const defaultPolicies = (retentionManager.constructor as any).getDefaultPolicies();
        const createdPolicies: string[] = [];
        
        for (const policy of defaultPolicies) {
          const policyId = retentionManager.createPolicy(policy);
          createdPolicies.push(`${policy.name} (${policyId})`);
        }
        
        return {
          content: [{
            type: 'text',
            text: `Default retention policies created:\n\n${
              createdPolicies.map(p => `• ${p}`).join('\n')
            }\n\nUse context_retention_list_policies to see all policies.`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to setup default policies: ${error.message}`,
          }],
        };
      }
    }

    // Feature Flags Management
    case 'context_feature_create_flag': {
      try {
        const { flag } = args;
        
        if (!flag || !flag.name || !flag.key) {
          throw new Error('Flag object with name and key is required');
        }
        
        const flagId = featureFlagManager.createFlag(flag);
        
        return {
          content: [{
            type: 'text',
            text: `Feature flag created successfully!
Flag: ${flag.name} (${flag.key})
ID: ${flagId}
Status: ${flag.enabled ? 'Enabled' : 'Disabled'}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to create feature flag: ${error.message}`,
          }],
        };
      }
    }

    case 'context_feature_list_flags': {
      try {
        const flags = featureFlagManager.listFlags(args || {});
        
        if (flags.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No feature flags found.',
            }],
          };
        }
        
        const flagList = flags.map(flag => {
          const status = flag.enabled ? '✅ Enabled' : '❌ Disabled';
          const env = flag.environments ? ` (${flag.environments.join(', ')})` : '';
          const percentage = flag.percentage ? ` ${flag.percentage}%` : '';
          return `• ${flag.name} (${flag.key}) - ${status}${env}${percentage}`;
        }).join('\n');
        
        return {
          content: [{
            type: 'text',
            text: `Feature Flags (${flags.length}):\n\n${flagList}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to list feature flags: ${error.message}`,
          }],
        };
      }
    }

    case 'context_feature_get_flag': {
      try {
        const { key, id } = args;
        
        if (!key && !id) {
          throw new Error('Either key or id is required');
        }
        
        const flag = key ? featureFlagManager.getFlagByKey(key) : featureFlagManager.getFlag(id);
        
        if (!flag) {
          return {
            content: [{
              type: 'text',
              text: `Feature flag not found: ${key || id}`,
            }],
          };
        }
        
        const details = `Feature Flag Details:
Name: ${flag.name}
Key: ${flag.key}
Status: ${flag.enabled ? '✅ Enabled' : '❌ Disabled'}
Description: ${flag.description || 'No description'}
Category: ${flag.category || 'uncategorized'}
Environments: ${flag.environments ? flag.environments.join(', ') : 'All'}
Users: ${flag.users ? flag.users.join(', ') : 'All'}
Percentage: ${flag.percentage || 0}%
Tags: ${flag.tags ? flag.tags.join(', ') : 'None'}
Created: ${flag.createdAt}
Updated: ${flag.updatedAt}
Created by: ${flag.createdBy || 'Unknown'}`;
        
        return {
          content: [{
            type: 'text',
            text: details,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get feature flag: ${error.message}`,
          }],
        };
      }
    }

    case 'context_feature_update_flag': {
      try {
        const { key, id, updates, userId } = args;
        
        if (!key && !id) {
          throw new Error('Either key or id is required');
        }
        
        if (!updates) {
          throw new Error('Updates object is required');
        }
        
        const flag = key ? featureFlagManager.getFlagByKey(key) : featureFlagManager.getFlag(id);
        if (!flag) {
          throw new Error(`Feature flag not found: ${key || id}`);
        }
        
        featureFlagManager.updateFlag(flag.id, updates, userId);
        
        return {
          content: [{
            type: 'text',
            text: `Feature flag updated successfully: ${flag.name} (${flag.key})`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to update feature flag: ${error.message}`,
          }],
        };
      }
    }

    case 'context_feature_delete_flag': {
      try {
        const { key, id, userId } = args;
        
        if (!key && !id) {
          throw new Error('Either key or id is required');
        }
        
        const flag = key ? featureFlagManager.getFlagByKey(key) : featureFlagManager.getFlag(id);
        if (!flag) {
          throw new Error(`Feature flag not found: ${key || id}`);
        }
        
        featureFlagManager.deleteFlag(flag.id, userId);
        
        return {
          content: [{
            type: 'text',
            text: `Feature flag deleted successfully: ${flag.name} (${flag.key})`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to delete feature flag: ${error.message}`,
          }],
        };
      }
    }

    case 'context_feature_evaluate': {
      try {
        const { key, context } = args;
        
        if (!key) {
          throw new Error('Flag key is required');
        }
        
        const evaluation = featureFlagManager.evaluateFlag(key, context || {});
        
        const result = `Feature Flag Evaluation:
Flag: ${evaluation.flag.name} (${key})
Result: ${evaluation.enabled ? '✅ ENABLED' : '❌ DISABLED'}
Reason: ${evaluation.reason}
Context: ${JSON.stringify(evaluation.context, null, 2)}`;
        
        return {
          content: [{
            type: 'text',
            text: result,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to evaluate feature flag: ${error.message}`,
          }],
        };
      }
    }

    case 'context_feature_get_stats': {
      try {
        const stats = featureFlagManager.getStats();
        
        const categoryStats = Object.entries(stats.byCategory)
          .map(([cat, data]) => `  ${cat}: ${data.enabled}/${data.count} enabled`)
          .join('\n');
        
        const envStats = Object.entries(stats.byEnvironment)
          .map(([env, data]) => `  ${env}: ${data.enabled}/${data.count} enabled`)
          .join('\n');
        
        const scheduled = [
          ...stats.scheduledChanges.toEnable.map(s => `  📅 Enable ${s.flag} on ${s.date}`),
          ...stats.scheduledChanges.toDisable.map(s => `  📅 Disable ${s.flag} on ${s.date}`)
        ].join('\n');
        
        const recent = stats.recentActivity
          .map(a => `  ${a.action} ${a.flag} - ${a.timestamp} ${a.user ? `by ${a.user}` : ''}`)
          .join('\n');
        
        const result = `Feature Flag Statistics:

📊 Overview:
  Total flags: ${stats.totalFlags}
  Enabled: ${stats.enabledFlags}
  Disabled: ${stats.disabledFlags}

📂 By Category:
${categoryStats || '  No categories'}

🌍 By Environment:
${envStats || '  No environments'}

⏰ Scheduled Changes:
${scheduled || '  No scheduled changes'}

📜 Recent Activity:
${recent || '  No recent activity'}`;
        
        return {
          content: [{
            type: 'text',
            text: result,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get feature flag stats: ${error.message}`,
          }],
        };
      }
    }

    case 'context_feature_setup_defaults': {
      try {
        const defaultFlags = (featureFlagManager.constructor as any).getDefaultFlags();
        const createdFlags: string[] = [];
        
        for (const flag of defaultFlags) {
          try {
            const flagId = featureFlagManager.createFlag(flag);
            createdFlags.push(`${flag.name} (${flag.key})`);
          } catch (error: any) {
            // Skip if flag already exists
            if (error.message.includes('UNIQUE constraint failed')) {
              continue;
            }
            throw error;
          }
        }
        
        return {
          content: [{
            type: 'text',
            text: `Default feature flags setup completed!
            
Created flags:
${createdFlags.map(f => `• ${f}`).join('\n') || '• No new flags created (may already exist)'}

Use context_feature_list_flags to see all flags.`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to setup default flags: ${error.message}`,
          }],
        };
      }
    }

    // Database Migration Management
    case 'context_migration_create': {
      try {
        const { migration } = args;
        
        if (!migration || !migration.version || !migration.name || !migration.up) {
          throw new Error('Migration object with version, name, and up SQL is required');
        }
        
        const migrationId = migrationManager.createMigration(migration);
        
        return {
          content: [{
            type: 'text',
            text: `Database migration created successfully!
Migration: ${migration.name} (v${migration.version})
ID: ${migrationId}
Requires backup: ${migration.requiresBackup ? 'Yes' : 'No'}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to create migration: ${error.message}`,
          }],
        };
      }
    }

    case 'context_migration_list': {
      try {
        const migrations = migrationManager.listMigrations(args || {});
        
        if (migrations.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No migrations found.',
            }],
          };
        }
        
        const migrationList = migrations.map(migration => {
          const status = migration.appliedAt ? '✅ Applied' : '⏳ Pending';
          const appliedDate = migration.appliedAt ? ` (${migration.appliedAt})` : '';
          return `• v${migration.version} - ${migration.name} - ${status}${appliedDate}`;
        }).join('\n');
        
        return {
          content: [{
            type: 'text',
            text: `Database Migrations (${migrations.length}):\n\n${migrationList}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to list migrations: ${error.message}`,
          }],
        };
      }
    }

    case 'context_migration_status': {
      try {
        const status = migrationManager.getStatus();
        
        const pendingList = status.pending.map(m => 
          `  v${m.version} - ${m.name}${m.requiresBackup ? ' (requires backup)' : ''}`
        ).join('\n');
        
        const appliedList = status.applied.slice(-5).map(m => 
          `  v${m.version} - ${m.name} (${m.appliedAt})`
        ).join('\n');
        
        const result = `Database Migration Status:

📊 Overview:
  Current version: v${status.currentVersion}
  Total migrations: ${status.totalMigrations}
  Applied: ${status.appliedMigrations}
  Pending: ${status.pendingMigrations}

⏳ Pending Migrations:
${pendingList || '  No pending migrations'}

✅ Recent Applied Migrations:
${appliedList || '  No applied migrations'}

${status.lastMigration ? `📝 Last Migration:
  v${status.lastMigration.version} - ${status.lastMigration.name}
  Applied: ${status.lastMigration.appliedAt}` : ''}`;
        
        return {
          content: [{
            type: 'text',
            text: result,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get migration status: ${error.message}`,
          }],
        };
      }
    }

    case 'context_migration_apply': {
      try {
        const { version, dryRun, createBackup } = args;
        
        if (!version) {
          throw new Error('Migration version is required');
        }
        
        const result = await migrationManager.applyMigration(version, {
          dryRun: dryRun !== false, // Default to dry run
          createBackup: createBackup === true
        });
        
        const statusIcon = result.success ? '✅' : '❌';
        const backupInfo = result.backupCreated ? `\nBackup created: ${result.backupCreated}` : '';
        const errorInfo = result.errors.length > 0 ? `\nErrors: ${result.errors.join(', ')}` : '';
        const warningInfo = result.warnings.length > 0 ? `\nWarnings: ${result.warnings.join(', ')}` : '';
        
        return {
          content: [{
            type: 'text',
            text: `${statusIcon} Migration ${result.success ? 'Applied' : 'Failed'}

Migration: ${result.name} (v${result.version})
Execution time: ${result.executionTime}ms
Rows affected: ${result.rowsAffected || 0}${backupInfo}${errorInfo}${warningInfo}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to apply migration: ${error.message}`,
          }],
        };
      }
    }

    case 'context_migration_rollback': {
      try {
        const { version, dryRun, createBackup } = args;
        
        if (!version) {
          throw new Error('Migration version is required');
        }
        
        const result = await migrationManager.rollbackMigration(version, {
          dryRun: dryRun !== false, // Default to dry run
          createBackup: createBackup === true
        });
        
        const statusIcon = result.success ? '✅' : '❌';
        const backupInfo = result.backupCreated ? `\nBackup created: ${result.backupCreated}` : '';
        const errorInfo = result.errors.length > 0 ? `\nErrors: ${result.errors.join(', ')}` : '';
        const warningInfo = result.warnings.length > 0 ? `\nWarnings: ${result.warnings.join(', ')}` : '';
        
        return {
          content: [{
            type: 'text',
            text: `${statusIcon} Migration ${result.success ? 'Rolled Back' : 'Rollback Failed'}

Migration: ${result.name} (v${result.version})
Execution time: ${result.executionTime}ms
Rows affected: ${result.rowsAffected || 0}${backupInfo}${errorInfo}${warningInfo}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to rollback migration: ${error.message}`,
          }],
        };
      }
    }

    case 'context_migration_apply_all': {
      try {
        const { dryRun, createBackups, stopOnError } = args || {};
        
        const results = await migrationManager.applyAllPending({
          dryRun: dryRun !== false, // Default to dry run
          createBackups: createBackups === true,
          stopOnError: stopOnError !== false // Default to stop on error
        });
        
        if (results.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No pending migrations to apply.',
            }],
          };
        }
        
        const summary = results.map(result => {
          const statusIcon = result.success ? '✅' : '❌';
          return `${statusIcon} v${result.version} - ${result.name} (${result.executionTime}ms)`;
        }).join('\n');
        
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.length - successCount;
        
        return {
          content: [{
            type: 'text',
            text: `Migration Batch Complete

Results:
${summary}

Summary: ${successCount} successful, ${failureCount} failed`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to apply migrations: ${error.message}`,
          }],
        };
      }
    }

    case 'context_migration_get_log': {
      try {
        const { version, limit } = args || {};
        
        const logs = migrationManager.getMigrationLog(version, limit || 20);
        
        if (logs.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No migration logs found.',
            }],
          };
        }
        
        const logList = logs.map(log => {
          const statusIcon = log.success ? '✅' : '❌';
          const action = log.action.charAt(0).toUpperCase() + log.action.slice(1);
          return `${statusIcon} v${log.version} - ${action} - ${log.timestamp} (${log.execution_time}ms)`;
        }).join('\n');
        
        return {
          content: [{
            type: 'text',
            text: `Migration Log${version ? ` for v${version}` : ''}:\n\n${logList}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get migration log: ${error.message}`,
          }],
        };
      }
    }

    case 'context_migration_setup_defaults': {
      try {
        const defaultMigrations = (migrationManager.constructor as any).getDefaultMigrations();
        const createdMigrations: string[] = [];
        
        for (const migration of defaultMigrations) {
          try {
            const migrationId = migrationManager.createMigration(migration);
            createdMigrations.push(`v${migration.version} - ${migration.name}`);
          } catch (error: any) {
            // Skip if migration already exists
            if (error.message.includes('UNIQUE constraint failed')) {
              continue;
            }
            throw error;
          }
        }
        
        return {
          content: [{
            type: 'text',
            text: `Default migrations setup completed!

Created migrations:
${createdMigrations.map(m => `• ${m}`).join('\n') || '• No new migrations created (may already exist)'}

Use context_migration_status to see migration status.
Use context_migration_apply_all to apply pending migrations.`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to setup default migrations: ${error.message}`,
          }],
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Session Management
      {
        name: 'context_session_start',
        description: 'Start a new context session with optional project directory for git tracking',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Session name' },
            description: { type: 'string', description: 'Session description' },
            continueFrom: { type: 'string', description: 'Session ID to continue from' },
            projectDir: { type: 'string', description: 'Project directory path for git tracking (e.g., "/path/to/your/project")' },
          },
        },
      },
      {
        name: 'context_session_list',
        description: 'List recent sessions',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum number of sessions to return', default: 10 },
          },
        },
      },
      {
        name: 'context_set_project_dir',
        description: 'Set the project directory for git tracking in the current session',
        inputSchema: {
          type: 'object',
          properties: {
            projectDir: { 
              type: 'string', 
              description: 'Project directory path for git tracking (e.g., "/path/to/your/project")' 
            },
          },
          required: ['projectDir'],
        },
      },
      // Enhanced Context Storage
      {
        name: 'context_save',
        description: 'Save a context item with optional category and priority',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Unique key for the context item' },
            value: { type: 'string', description: 'Context value to save' },
            category: { 
              type: 'string', 
              description: 'Category (e.g., task, decision, progress)',
              enum: ['task', 'decision', 'progress', 'note', 'error', 'warning']
            },
            priority: { 
              type: 'string', 
              description: 'Priority level',
              enum: ['high', 'normal', 'low'],
              default: 'normal'
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'context_get',
        description: 'Retrieve saved context by key, category, or session',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Specific key to retrieve' },
            category: { type: 'string', description: 'Filter by category' },
            sessionId: { type: 'string', description: 'Specific session ID (defaults to current)' },
          },
        },
      },
      // File Caching
      {
        name: 'context_cache_file',
        description: 'Cache file content with hash for change detection',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'File content to cache' },
          },
          required: ['filePath', 'content'],
        },
      },
      {
        name: 'context_file_changed',
        description: 'Check if a file has changed since it was cached',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to the file' },
            currentContent: { type: 'string', description: 'Current file content to compare' },
          },
          required: ['filePath'],
        },
      },
      // Status
      {
        name: 'context_status',
        description: 'Get current context status and statistics',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      // Phase 2: Checkpoint System
      {
        name: 'context_checkpoint',
        description: 'Create a named checkpoint of current context',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Checkpoint name' },
            description: { type: 'string', description: 'Checkpoint description' },
            includeFiles: { 
              type: 'boolean', 
              description: 'Include cached files in checkpoint',
              default: true 
            },
            includeGitStatus: { 
              type: 'boolean', 
              description: 'Capture current git status',
              default: true 
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'context_restore_checkpoint',
        description: 'Restore context from a checkpoint',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Checkpoint name to restore' },
            checkpointId: { type: 'string', description: 'Specific checkpoint ID' },
            restoreFiles: { 
              type: 'boolean', 
              description: 'Restore cached files',
              default: true 
            },
          },
        },
      },
      // Phase 2: Summarization
      {
        name: 'context_summarize',
        description: 'Get AI-friendly summary of session context',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session to summarize (defaults to current)' },
            categories: { 
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by specific categories' 
            },
            maxLength: { 
              type: 'number', 
              description: 'Maximum summary length',
              default: 1000 
            },
          },
        },
      },
      // Phase 3: Smart Compaction
      {
        name: 'context_prepare_compaction',
        description: 'Automatically save critical context before compaction',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      // Phase 3: Git Integration
      {
        name: 'context_git_commit',
        description: 'Create git commit with automatic context save',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' },
            autoSave: { 
              type: 'boolean', 
              description: 'Automatically save context state',
              default: true 
            },
          },
          required: ['message'],
        },
      },
      // Phase 3: Search
      {
        name: 'context_search',
        description: 'Search through saved context items',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            searchIn: { 
              type: 'array',
              items: { type: 'string', enum: ['key', 'value'] },
              description: 'Fields to search in',
              default: ['key', 'value']
            },
            sessionId: { type: 'string', description: 'Session to search (defaults to current)' },
          },
          required: ['query'],
        },
      },
      // Phase 3: Export/Import
      {
        name: 'context_export',
        description: 'Export session data for backup or sharing',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session to export (defaults to current)' },
            format: { 
              type: 'string', 
              enum: ['json', 'inline'],
              description: 'Export format',
              default: 'json'
            },
          },
        },
      },
      {
        name: 'context_import',
        description: 'Import previously exported session data',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to import file' },
            merge: { 
              type: 'boolean', 
              description: 'Merge with current session instead of creating new',
              default: false 
            },
          },
          required: ['filePath'],
        },
      },
      // Phase 4.1: Knowledge Graph
      {
        name: 'context_analyze',
        description: 'Analyze context to extract entities and relationships',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to analyze (defaults to current)' },
            categories: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Categories to analyze' 
            },
          },
        },
      },
      {
        name: 'context_find_related',
        description: 'Find entities related to a key or entity',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Context key or entity name' },
            relationTypes: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Types of relations to include' 
            },
            maxDepth: { 
              type: 'number', 
              description: 'Maximum graph traversal depth',
              default: 2 
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'context_visualize',
        description: 'Generate visualization data for the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            type: { 
              type: 'string', 
              enum: ['graph', 'timeline', 'heatmap'],
              description: 'Visualization type',
              default: 'graph'
            },
            entityTypes: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Entity types to include' 
            },
            sessionId: { type: 'string', description: 'Session to visualize (defaults to current)' },
          },
        },
      },
      // Phase 4.2: Semantic Search
      {
        name: 'context_semantic_search',
        description: 'Search context using natural language queries',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language search query' },
            topK: { 
              type: 'number', 
              description: 'Number of results to return',
              default: 10 
            },
            minSimilarity: { 
              type: 'number', 
              description: 'Minimum similarity score (0-1)',
              default: 0.3 
            },
            sessionId: { type: 'string', description: 'Search within specific session (defaults to current)' },
          },
          required: ['query'],
        },
      },
      // Phase 4.3: Multi-Agent System
      {
        name: 'context_delegate',
        description: 'Delegate complex analysis tasks to specialized agents',
        inputSchema: {
          type: 'object',
          properties: {
            taskType: { 
              type: 'string', 
              enum: ['analyze', 'synthesize'],
              description: 'Type of task to delegate' 
            },
            input: {
              type: 'object',
              properties: {
                analysisType: { 
                  type: 'string', 
                  enum: ['patterns', 'relationships', 'trends', 'comprehensive'],
                  description: 'For analyze tasks: type of analysis' 
                },
                synthesisType: { 
                  type: 'string', 
                  enum: ['summary', 'merge', 'recommendations'],
                  description: 'For synthesize tasks: type of synthesis' 
                },
                categories: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Categories to include in analysis'
                },
                timeframe: { 
                  type: 'string', 
                  description: 'Time period for analysis (e.g., "-7 days")' 
                },
                maxLength: { 
                  type: 'number', 
                  description: 'Maximum length for summaries' 
                },
                insights: {
                  type: 'array',
                  description: 'For merge synthesis: array of insights to merge'
                },
              },
            },
            chain: { 
              type: 'boolean', 
              description: 'Process multiple tasks in sequence',
              default: false 
            },
            sessionId: { type: 'string', description: 'Session to analyze (defaults to current)' },
          },
          required: ['taskType', 'input'],
        },
      },
      // Phase 4.4: Advanced Features
      {
        name: 'context_branch_session',
        description: 'Create a branch from current session for exploring alternatives',
        inputSchema: {
          type: 'object',
          properties: {
            branchName: { 
              type: 'string', 
              description: 'Name for the new branch' 
            },
            copyDepth: { 
              type: 'string', 
              enum: ['shallow', 'deep'],
              description: 'How much to copy: shallow (high priority only) or deep (everything)',
              default: 'shallow'
            },
          },
          required: ['branchName'],
        },
      },
      {
        name: 'context_merge_sessions',
        description: 'Merge another session into the current one',
        inputSchema: {
          type: 'object',
          properties: {
            sourceSessionId: { 
              type: 'string', 
              description: 'ID of the session to merge from' 
            },
            conflictResolution: { 
              type: 'string', 
              enum: ['keep_current', 'keep_source', 'keep_newest'],
              description: 'How to resolve conflicts',
              default: 'keep_current'
            },
          },
          required: ['sourceSessionId'],
        },
      },
      {
        name: 'context_journal_entry',
        description: 'Add a timestamped journal entry with optional tags and mood',
        inputSchema: {
          type: 'object',
          properties: {
            entry: { 
              type: 'string', 
              description: 'Journal entry text' 
            },
            tags: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Tags for categorization' 
            },
            mood: { 
              type: 'string', 
              description: 'Current mood/feeling' 
            },
          },
          required: ['entry'],
        },
      },
      {
        name: 'context_timeline',
        description: 'Get timeline of activities with optional grouping',
        inputSchema: {
          type: 'object',
          properties: {
            startDate: { 
              type: 'string', 
              description: 'Start date (ISO format)' 
            },
            endDate: { 
              type: 'string', 
              description: 'End date (ISO format)' 
            },
            groupBy: { 
              type: 'string', 
              enum: ['hour', 'day', 'week'],
              description: 'How to group timeline data',
              default: 'day'
            },
            sessionId: { 
              type: 'string', 
              description: 'Session to analyze (defaults to current)' 
            },
          },
        },
      },
      {
        name: 'context_compress',
        description: 'Intelligently compress old context to save space',
        inputSchema: {
          type: 'object',
          properties: {
            olderThan: { 
              type: 'string', 
              description: 'Compress items older than this date (ISO format)' 
            },
            preserveCategories: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Categories to preserve (not compress)' 
            },
            targetSize: { 
              type: 'number', 
              description: 'Target size in KB (optional)' 
            },
            sessionId: { 
              type: 'string', 
              description: 'Session to compress (defaults to current)' 
            },
          },
        },
      },
      {
        name: 'context_integrate_tool',
        description: 'Track events from other MCP tools',
        inputSchema: {
          type: 'object',
          properties: {
            toolName: { 
              type: 'string', 
              description: 'Name of the tool' 
            },
            eventType: { 
              type: 'string', 
              description: 'Type of event' 
            },
            data: { 
              type: 'object', 
              description: 'Event data',
              properties: {
                important: { 
                  type: 'boolean',
                  description: 'Mark as important to save as context item'
                }
              }
            },
          },
          required: ['toolName', 'eventType', 'data'],
        },
      },

      // Phase 5: Retention Management
      {
        name: 'context_retention_create_policy',
        description: 'Create a new retention policy for automatic data lifecycle management',
        inputSchema: {
          type: 'object',
          properties: {
            policy: {
              type: 'object',
              description: 'Retention policy configuration',
              properties: {
                name: { type: 'string', description: 'Policy name' },
                enabled: { type: 'boolean', description: 'Whether policy is enabled' },
                maxAge: { type: 'string', description: 'Maximum age (e.g., "30d", "1y")' },
                maxSize: { type: 'number', description: 'Maximum size in bytes' },
                maxItems: { type: 'number', description: 'Maximum number of items' },
                preserveHighPriority: { type: 'boolean', description: 'Preserve high priority items' },
                preserveCritical: { type: 'boolean', description: 'Preserve critical items' },
                action: { 
                  type: 'string', 
                  enum: ['delete', 'archive', 'compress'],
                  description: 'Action to take on eligible items'
                },
                schedule: {
                  type: 'string',
                  enum: ['daily', 'weekly', 'monthly', 'manual'],
                  description: 'Execution schedule'
                },
                categories: {
                  type: 'object',
                  description: 'Category-specific rules',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      maxAge: { type: 'string' },
                      preserve: { type: 'boolean' },
                      archiveAfter: { type: 'string' }
                    }
                  }
                }
              },
              required: ['name', 'action', 'schedule']
            }
          },
          required: ['policy']
        }
      },
      {
        name: 'context_retention_list_policies',
        description: 'List all retention policies',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'context_retention_get_stats',
        description: 'Get retention statistics for database or specific session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { 
              type: 'string', 
              description: 'Optional session ID to get stats for specific session' 
            }
          }
        }
      },
      {
        name: 'context_retention_execute_policy',
        description: 'Execute a retention policy (dry run by default)',
        inputSchema: {
          type: 'object',
          properties: {
            policyId: { 
              type: 'string', 
              description: 'ID of the policy to execute' 
            },
            dryRun: { 
              type: 'boolean', 
              description: 'Whether to perform a dry run (default: true)',
              default: true
            }
          },
          required: ['policyId']
        }
      },
      {
        name: 'context_retention_setup_defaults',
        description: 'Create default retention policies (Conservative, Aggressive, Development)',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },

      // Feature Flags Management
      {
        name: 'context_feature_create_flag',
        description: 'Create a new feature flag',
        inputSchema: {
          type: 'object',
          properties: {
            flag: {
              type: 'object',
              description: 'Feature flag configuration',
              properties: {
                name: { type: 'string', description: 'Display name for the flag' },
                key: { type: 'string', description: 'Unique key for the flag' },
                enabled: { type: 'boolean', description: 'Whether flag is enabled', default: false },
                description: { type: 'string', description: 'Flag description' },
                environments: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'Target environments (e.g., ["development", "staging"])' 
                },
                users: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'Target specific users' 
                },
                percentage: { 
                  type: 'number', 
                  minimum: 0, 
                  maximum: 100,
                  description: 'Percentage rollout (0-100)' 
                },
                enabledFrom: { type: 'string', description: 'Enable from date (ISO format)' },
                enabledUntil: { type: 'string', description: 'Enable until date (ISO format)' },
                category: { type: 'string', description: 'Flag category' },
                tags: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'Tags for organization' 
                },
                createdBy: { type: 'string', description: 'Creator identifier' }
              },
              required: ['name', 'key']
            }
          },
          required: ['flag']
        }
      },
      {
        name: 'context_feature_list_flags',
        description: 'List feature flags with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Filter by category' },
            enabled: { type: 'boolean', description: 'Filter by enabled status' },
            environment: { type: 'string', description: 'Filter by environment' },
            tag: { type: 'string', description: 'Filter by tag' },
            limit: { type: 'number', description: 'Maximum number of flags to return' }
          }
        }
      },
      {
        name: 'context_feature_get_flag',
        description: 'Get details of a specific feature flag',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Flag key' },
            id: { type: 'string', description: 'Flag ID (alternative to key)' }
          }
        }
      },
      {
        name: 'context_feature_update_flag',
        description: 'Update an existing feature flag',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Flag key' },
            id: { type: 'string', description: 'Flag ID (alternative to key)' },
            updates: {
              type: 'object',
              description: 'Updates to apply',
              properties: {
                name: { type: 'string' },
                enabled: { type: 'boolean' },
                description: { type: 'string' },
                environments: { type: 'array', items: { type: 'string' } },
                users: { type: 'array', items: { type: 'string' } },
                percentage: { type: 'number', minimum: 0, maximum: 100 },
                enabledFrom: { type: 'string' },
                enabledUntil: { type: 'string' },
                category: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } }
              }
            },
            userId: { type: 'string', description: 'User making the change' }
          },
          required: ['updates']
        }
      },
      {
        name: 'context_feature_delete_flag',
        description: 'Delete a feature flag',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Flag key' },
            id: { type: 'string', description: 'Flag ID (alternative to key)' },
            userId: { type: 'string', description: 'User making the change' }
          }
        }
      },
      {
        name: 'context_feature_evaluate',
        description: 'Evaluate a feature flag for a given context',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Flag key to evaluate' },
            context: {
              type: 'object',
              description: 'Evaluation context',
              properties: {
                environment: { type: 'string', description: 'Current environment' },
                userId: { type: 'string', description: 'User ID' },
                timestamp: { type: 'string', description: 'Evaluation timestamp (ISO format)' }
              }
            }
          },
          required: ['key']
        }
      },
      {
        name: 'context_feature_get_stats',
        description: 'Get feature flag usage statistics',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'context_feature_setup_defaults',
        description: 'Create default feature flags for common features',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },

      // Database Migration Management
      {
        name: 'context_migration_create',
        description: 'Create a new database migration',
        inputSchema: {
          type: 'object',
          properties: {
            migration: {
              type: 'object',
              description: 'Migration configuration',
              properties: {
                version: { type: 'string', description: 'Migration version (e.g., "1.0.0")' },
                name: { type: 'string', description: 'Migration name' },
                description: { type: 'string', description: 'Migration description' },
                up: { type: 'string', description: 'SQL for applying migration' },
                down: { type: 'string', description: 'SQL for rolling back migration' },
                dependencies: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'Required migration versions' 
                },
                requiresBackup: { 
                  type: 'boolean', 
                  description: 'Whether backup is needed before running' 
                }
              },
              required: ['version', 'name', 'up']
            }
          },
          required: ['migration']
        }
      },
      {
        name: 'context_migration_list',
        description: 'List database migrations with optional filtering',
        inputSchema: {
          type: 'object',
          properties: {
            applied: { type: 'boolean', description: 'Filter by applied status' },
            pending: { type: 'boolean', description: 'Filter by pending status' },
            limit: { type: 'number', description: 'Maximum number of migrations to return' }
          }
        }
      },
      {
        name: 'context_migration_status',
        description: 'Get database migration status overview',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'context_migration_apply',
        description: 'Apply a specific migration (dry run by default)',
        inputSchema: {
          type: 'object',
          properties: {
            version: { type: 'string', description: 'Migration version to apply' },
            dryRun: { 
              type: 'boolean', 
              description: 'Whether to perform a dry run (default: true)',
              default: true
            },
            createBackup: { 
              type: 'boolean', 
              description: 'Whether to create backup before applying' 
            }
          },
          required: ['version']
        }
      },
      {
        name: 'context_migration_rollback',
        description: 'Rollback a specific migration (dry run by default)',
        inputSchema: {
          type: 'object',
          properties: {
            version: { type: 'string', description: 'Migration version to rollback' },
            dryRun: { 
              type: 'boolean', 
              description: 'Whether to perform a dry run (default: true)',
              default: true
            },
            createBackup: { 
              type: 'boolean', 
              description: 'Whether to create backup before rollback' 
            }
          },
          required: ['version']
        }
      },
      {
        name: 'context_migration_apply_all',
        description: 'Apply all pending migrations (dry run by default)',
        inputSchema: {
          type: 'object',
          properties: {
            dryRun: { 
              type: 'boolean', 
              description: 'Whether to perform a dry run (default: true)',
              default: true
            },
            createBackups: { 
              type: 'boolean', 
              description: 'Whether to create backups before applying' 
            },
            stopOnError: { 
              type: 'boolean', 
              description: 'Whether to stop on first error (default: true)',
              default: true
            }
          }
        }
      },
      {
        name: 'context_migration_get_log',
        description: 'Get migration execution log',
        inputSchema: {
          type: 'object',
          properties: {
            version: { type: 'string', description: 'Filter by migration version' },
            limit: { 
              type: 'number', 
              description: 'Maximum number of log entries to return',
              default: 20
            }
          }
        }
      },
      {
        name: 'context_migration_setup_defaults',
        description: 'Create default migrations for common schema updates',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
    ],
  };
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);