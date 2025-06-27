import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager } from './utils/database.js';
import { KnowledgeGraphManager } from './utils/knowledge-graph.js';
import { VectorStore } from './utils/vector-store.js';
import { ensureSQLiteFormat } from './utils/timestamps.js';
import { AgentCoordinator, AnalyzerAgent, SynthesizerAgent, AgentTask } from './utils/agents.js';
import { RetentionManager } from './utils/retention.js';
import { FeatureFlagManager } from './utils/feature-flags.js';
import { MigrationManager } from './utils/migrations.js';
import { RepositoryManager } from './repositories/RepositoryManager.js';
import { simpleGit } from 'simple-git';
import { deriveDefaultChannel } from './utils/channels.js';

// Initialize database with migrations
const dbManager = new DatabaseManager({ filename: 'context.db' });
const db = dbManager.getDatabase();

// Initialize repository manager
const repositories = new RepositoryManager(dbManager);

// Initialize git - will be created per session as needed
// REMOVED: Global project directory was causing conflicts between sessions

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
const _retentionManager = new RetentionManager(dbManager);

// Initialize feature flag manager
const _featureFlagManager = new FeatureFlagManager(dbManager);

// Initialize migration manager
const _migrationManager = new MigrationManager(dbManager);

// Tables are now created by DatabaseManager in utils/database.ts

// Track current session
let currentSessionId: string | null = null;

// Helper function to get or create default session
function ensureSession(): string {
  if (!currentSessionId) {
    const session = repositories.sessions.getLatest();
    if (session) {
      currentSessionId = session.id;
    } else {
      // Create default session
      const newSession = repositories.sessions.create({
        name: 'Default Session',
        description: 'Auto-created default session',
      });
      currentSessionId = newSession.id;
    }
  }
  return currentSessionId!;
}

// Helper to calculate file hash
function calculateFileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Helper to calculate byte size of string
function calculateSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

// Helper to parse relative time strings
function parseRelativeTime(relativeTime: string): string | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (relativeTime === 'today') {
    return today.toISOString();
  } else if (relativeTime === 'yesterday') {
    return new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString();
  } else if (relativeTime.match(/^(\d+) hours? ago$/)) {
    const hours = parseInt(relativeTime.match(/^(\d+)/)![1]);
    return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  } else if (relativeTime.match(/^(\d+) days? ago$/)) {
    const days = parseInt(relativeTime.match(/^(\d+)/)![1]);
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  } else if (relativeTime === 'this week') {
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    return startOfWeek.toISOString();
  } else if (relativeTime === 'last week') {
    const startOfLastWeek = new Date(today);
    startOfLastWeek.setDate(today.getDate() - today.getDay() - 7);
    return startOfLastWeek.toISOString();
  }

  return null;
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

// Helper to get git status for a session
async function getGitStatus(sessionId?: string): Promise<{ status: string; branch: string }> {
  // Get the current session's working directory
  const session = sessionId
    ? repositories.sessions.getById(sessionId)
    : repositories.sessions.getById(currentSessionId || '');

  if (!session || !session.working_directory) {
    return { status: 'No project directory set', branch: 'none' };
  }

  try {
    const git = simpleGit(session.working_directory);
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
  } catch (_e) {
    return { status: 'No git repository', branch: 'none' };
  }
}

// Helper to create summary
function createSummary(
  items: any[],
  options: { categories?: string[]; maxLength?: number }
): string {
  const { categories, maxLength = 1000 } = options;

  let filteredItems = items;
  if (categories && categories.length > 0) {
    filteredItems = items.filter(item => categories.includes(item.category));
  }

  // Group by category
  const grouped: Record<string, any[]> = filteredItems.reduce(
    (acc, item) => {
      const cat = item.category || 'uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {} as Record<string, any[]>
  );

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
        if (item.priority !== 'high') {
          // Already shown above
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
    version: '0.10.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Main request handler
server.setRequestHandler(CallToolRequestSchema, async request => {
  const toolName = request.params.name;
  const args = request.params.arguments as any;

  switch (toolName) {
    // Session Management
    case 'context_session_start': {
      const { name, description, continueFrom, projectDir, defaultChannel } = args;

      // Project directory will be saved with the session if provided

      // Get current git branch if available
      let branch = null;
      let gitDetected = false;
      try {
        const checkPath = projectDir || process.cwd();

        // Try to detect if directory has git
        const gitHeadPath = path.join(checkPath, '.git', 'HEAD');
        if (fs.existsSync(gitHeadPath)) {
          // Use simple-git to get proper branch info
          const tempGit = simpleGit(checkPath);
          const branchInfo = await tempGit.branch();
          branch = branchInfo.current;
          gitDetected = true;
        }
      } catch (_e) {
        // Ignore git errors
      }

      // Derive default channel if not provided
      let channel = defaultChannel;
      if (!channel) {
        channel = deriveDefaultChannel(branch || undefined, name || undefined);
      }

      // Create new session using repository
      const session = repositories.sessions.create({
        name: name || `Session ${new Date().toISOString()}`,
        description: description || '',
        branch: branch || undefined,
        working_directory: projectDir || undefined,
        defaultChannel: channel,
      });

      // Copy context from previous session if specified
      if (continueFrom) {
        repositories.contexts.copyBetweenSessions(continueFrom, session.id);
      }

      currentSessionId = session.id;

      let statusMessage = `Started new session: ${session.id}\nName: ${name || 'Unnamed'}\nChannel: ${channel}`;

      if (projectDir) {
        statusMessage += `\nProject directory: ${projectDir}`;
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
          const subdirs = fs
            .readdirSync(process.cwd(), { withFileTypes: true })
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
        content: [
          {
            type: 'text',
            text: statusMessage,
          },
        ],
      };
    }

    case 'context_set_project_dir': {
      const { projectDir } = args;
      const sessionId = ensureSession();

      if (!projectDir) {
        throw new Error('Project directory path is required');
      }

      // Verify the directory exists
      if (!fs.existsSync(projectDir)) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Directory not found: ${projectDir}`,
            },
          ],
        };
      }

      // Update the current session's working directory
      repositories.sessions.update(sessionId, { working_directory: projectDir });

      // Try to get git info to verify it's a git repo
      let gitInfo = 'No git repository found';
      try {
        const git = simpleGit(projectDir);
        const branchInfo = await git.branch();
        const status = await git.status();
        gitInfo = `Git repository detected\nBranch: ${branchInfo.current}\nStatus: ${status.modified.length} modified, ${status.created.length} new, ${status.deleted.length} deleted`;
      } catch (_e) {
        // Not a git repo, that's okay
      }

      return {
        content: [
          {
            type: 'text',
            text: `Project directory set for session ${sessionId.substring(0, 8)}: ${projectDir}\n\n${gitInfo}`,
          },
        ],
      };
    }

    case 'context_session_list': {
      const { limit = 10 } = args;
      const sessions = db
        .prepare(
          `
        SELECT id, name, description, branch, created_at,
               (SELECT COUNT(*) FROM context_items WHERE session_id = sessions.id) as item_count
        FROM sessions
        ORDER BY created_at DESC
        LIMIT ?
      `
        )
        .all(limit);

      const sessionList = sessions
        .map(
          (s: any) =>
            `• ${s.name} (${s.id.substring(0, 8)})\n  Created: ${s.created_at}\n  Items: ${s.item_count}\n  Branch: ${s.branch || 'unknown'}`
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Recent sessions:\n\n${sessionList}`,
          },
        ],
      };
    }

    // Enhanced Context Storage
    case 'context_save': {
      const {
        key,
        value,
        category,
        priority = 'normal',
        private: isPrivate = false,
        channel,
      } = args;

      try {
        const sessionId = ensureSession();

        // Verify session exists before saving context
        const session = repositories.sessions.getById(sessionId);
        if (!session) {
          // Session was deleted or corrupted, create a new one
          console.warn(`Session ${sessionId} not found, creating new session`);
          const newSession = repositories.sessions.create({
            name: 'Recovery Session',
            description: 'Auto-created after session corruption',
          });
          currentSessionId = newSession.id;
          const _contextItem = repositories.contexts.save(newSession.id, {
            key,
            value,
            category,
            priority: priority as 'high' | 'normal' | 'low',
            isPrivate,
            channel,
          });

          return {
            content: [
              {
                type: 'text',
                text: `Saved: ${key}\nCategory: ${category || 'none'}\nPriority: ${priority}\nSession: ${newSession.id.substring(0, 8)} (recovered)`,
              },
            ],
          };
        }

        const contextItem = repositories.contexts.save(sessionId, {
          key,
          value,
          category,
          priority: priority as 'high' | 'normal' | 'low',
          isPrivate,
          channel,
        });

        // Create embedding for semantic search
        try {
          const content = `${key}: ${value}`;
          const metadata = { key, category, priority };
          await vectorStore.storeDocument(contextItem.id, content, metadata);
        } catch (error) {
          // Log but don't fail the save operation
          console.error('Failed to create embedding:', error);
        }

        return {
          content: [
            {
              type: 'text',
              text: `Saved: ${key}\nCategory: ${category || 'none'}\nPriority: ${priority}\nChannel: ${contextItem.channel || 'general'}\nSession: ${sessionId.substring(0, 8)}`,
            },
          ],
        };
      } catch (error: any) {
        console.error('Context save error:', error);

        // If it's a foreign key constraint error, try recovery
        if (error.message?.includes('FOREIGN KEY constraint failed')) {
          try {
            console.warn('Foreign key constraint failed, attempting recovery...');
            const newSession = repositories.sessions.create({
              name: 'Emergency Recovery Session',
              description: 'Created due to foreign key constraint failure',
            });
            currentSessionId = newSession.id;

            const _contextItem = repositories.contexts.save(newSession.id, {
              key,
              value,
              category,
              priority: priority as 'high' | 'normal' | 'low',
              isPrivate,
              channel,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: `Saved: ${key}\nCategory: ${category || 'none'}\nPriority: ${priority}\nSession: ${newSession.id.substring(0, 8)} (emergency recovery)`,
                },
              ],
            };
          } catch (recoveryError: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to save context item: ${recoveryError.message}`,
                },
              ],
            };
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: `Failed to save context item: ${error.message}`,
            },
          ],
        };
      }
    }

    case 'context_get': {
      const {
        key,
        category,
        channel,
        channels,
        sessionId: specificSessionId,
        includeMetadata,
        sort,
        limit,
        offset,
        createdAfter,
        createdBefore,
        keyPattern,
        priorities,
      } = args;
      const targetSessionId = specificSessionId || currentSessionId || ensureSession();

      // Use new enhanced query for complex queries
      if (
        sort ||
        limit ||
        offset ||
        createdAfter ||
        createdBefore ||
        keyPattern ||
        priorities ||
        channel ||
        channels
      ) {
        const result = repositories.contexts.queryEnhanced({
          sessionId: targetSessionId,
          key,
          category,
          channel,
          channels,
          sort,
          limit,
          offset,
          createdAfter,
          createdBefore,
          keyPattern,
          priorities,
          includeMetadata,
        });

        if (result.items.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No matching context found',
              },
            ],
          };
        }

        // Enhanced response format
        if (includeMetadata) {
          const itemsWithMetadata = result.items.map(item => ({
            key: item.key,
            value: item.value,
            category: item.category,
            priority: item.priority,
            channel: item.channel,
            metadata: item.metadata ? JSON.parse(item.metadata) : null,
            size: item.size || calculateSize(item.value),
            created_at: item.created_at,
            updated_at: item.updated_at,
          }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    items: itemsWithMetadata,
                    totalCount: result.totalCount,
                    page: offset && limit ? Math.floor(offset / limit) + 1 : 1,
                    pageSize: limit || result.items.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Return items array for backward compatibility when using enhanced features
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.items),
            },
          ],
        };
      }

      // Backward compatible simple queries
      let rows;
      if (key) {
        // Use getAccessibleByKey to respect privacy
        const item = repositories.contexts.getAccessibleByKey(targetSessionId, key);
        rows = item ? [item] : [];
      } else {
        // Use getAccessibleItems for listing
        rows = repositories.contexts.getAccessibleItems(targetSessionId, { category });
      }

      if (rows.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No matching context found',
            },
          ],
        };
      }

      if (key && rows.length === 1) {
        // Single item requested
        const item = rows[0] as any;
        return {
          content: [
            {
              type: 'text',
              text: item.value,
            },
          ],
        };
      }

      // Multiple items
      const items = rows
        .map(
          (r: any) =>
            `• [${r.priority}] ${r.key}: ${r.value.substring(0, 100)}${r.value.length > 100 ? '...' : ''}`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${rows.length} context items:\n\n${items}`,
          },
        ],
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
        content: [
          {
            type: 'text',
            text: `Cached file: ${filePath}\nHash: ${hash.substring(0, 16)}...\nSize: ${content.length} bytes`,
          },
        ],
      };
    }

    case 'context_file_changed': {
      const { filePath, currentContent } = args;
      const sessionId = ensureSession();

      const cached = db
        .prepare('SELECT hash, content FROM file_cache WHERE session_id = ? AND file_path = ?')
        .get(sessionId, filePath) as any;

      if (!cached) {
        return {
          content: [
            {
              type: 'text',
              text: `No cached version found for: ${filePath}`,
            },
          ],
        };
      }

      const currentHash = currentContent ? calculateFileHash(currentContent) : null;
      const hasChanged = currentHash !== cached.hash;

      return {
        content: [
          {
            type: 'text',
            text: `File: ${filePath}\nChanged: ${hasChanged}\nCached hash: ${cached.hash.substring(0, 16)}...\nCurrent hash: ${currentHash ? currentHash.substring(0, 16) + '...' : 'N/A'}`,
          },
        ],
      };
    }

    case 'context_status': {
      const sessionId = currentSessionId || ensureSession();

      const stats = db
        .prepare(
          `
        SELECT 
          (SELECT COUNT(*) FROM context_items WHERE session_id = ?) as item_count,
          (SELECT COUNT(*) FROM file_cache WHERE session_id = ?) as file_count,
          (SELECT created_at FROM sessions WHERE id = ?) as session_created,
          (SELECT name FROM sessions WHERE id = ?) as session_name
      `
        )
        .get(sessionId, sessionId, sessionId, sessionId) as any;

      const recentItems = db
        .prepare(
          `
        SELECT key, category, priority FROM context_items 
        WHERE session_id = ? 
        ORDER BY created_at DESC 
        LIMIT 5
      `
        )
        .all(sessionId);

      const recentList = recentItems
        .map(
          (item: any) => `  • [${item.priority}] ${item.key} (${item.category || 'uncategorized'})`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Current Session: ${stats.session_name}
Session ID: ${sessionId.substring(0, 8)}
Created: ${stats.session_created}
Context Items: ${stats.item_count}
Cached Files: ${stats.file_count}

Recent Items:
${recentList || '  None'}`,
          },
        ],
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
      db.prepare(
        `
        INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(checkpointId, sessionId, name, description || '', gitStatus, gitBranch);

      // Save context items
      const contextItems = db
        .prepare('SELECT id FROM context_items WHERE session_id = ?')
        .all(sessionId);
      const itemStmt = db.prepare(
        'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
      );
      for (const item of contextItems) {
        itemStmt.run(uuidv4(), checkpointId, (item as any).id);
      }

      // Save file cache if requested
      let fileCount = 0;
      if (includeFiles) {
        const files = db.prepare('SELECT id FROM file_cache WHERE session_id = ?').all(sessionId);
        const fileStmt = db.prepare(
          'INSERT INTO checkpoint_files (id, checkpoint_id, file_cache_id) VALUES (?, ?, ?)'
        );
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
      const currentSession = repositories.sessions.getById(sessionId);
      if (includeGitStatus && (!currentSession || !currentSession.working_directory)) {
        statusText += `\n\n💡 Note: Git status was requested but no project directory is set.
To enable git tracking, use context_set_project_dir with your project path.`;
      }

      return {
        content: [
          {
            type: 'text',
            text: statusText,
          },
        ],
      };
    }

    case 'context_restore_checkpoint': {
      const { name, checkpointId, restoreFiles = true } = args;

      // Find checkpoint
      let checkpoint;
      if (checkpointId) {
        checkpoint = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId);
      } else if (name) {
        checkpoint = db
          .prepare('SELECT * FROM checkpoints ORDER BY created_at DESC')
          .all()
          .find((cp: any) => cp.name === name);
      } else {
        // Get latest checkpoint
        checkpoint = db.prepare('SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 1').get();
      }

      if (!checkpoint) {
        return {
          content: [
            {
              type: 'text',
              text: 'No checkpoint found',
            },
          ],
        };
      }

      const cp = checkpoint as any;

      // Start new session from checkpoint
      const newSessionId = uuidv4();
      db.prepare(
        `
        INSERT INTO sessions (id, name, description, branch, working_directory)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(
        newSessionId,
        `Restored from: ${cp.name}`,
        `Checkpoint ${cp.id.substring(0, 8)} created at ${cp.created_at}`,
        cp.git_branch,
        null
      );

      // Restore context items
      const contextItems = db
        .prepare(
          `
        SELECT ci.* FROM context_items ci
        JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
        WHERE cpi.checkpoint_id = ?
      `
        )
        .all(cp.id);

      const itemStmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, category, priority, size, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      for (const item of contextItems) {
        const itemData = item as any;
        itemStmt.run(
          uuidv4(),
          newSessionId,
          itemData.key,
          itemData.value,
          itemData.category,
          itemData.priority,
          itemData.size || calculateSize(itemData.value),
          itemData.created_at
        );
      }

      // Restore file cache if requested
      let fileCount = 0;
      if (restoreFiles) {
        const files = db
          .prepare(
            `
          SELECT fc.* FROM file_cache fc
          JOIN checkpoint_files cpf ON fc.id = cpf.file_cache_id
          WHERE cpf.checkpoint_id = ?
        `
          )
          .all(cp.id);

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
        content: [
          {
            type: 'text',
            text: `Restored from checkpoint: ${cp.name}
New session: ${newSessionId.substring(0, 8)}
Context items restored: ${contextItems.length}
Files restored: ${fileCount}
Original git branch: ${cp.git_branch || 'none'}
Original checkpoint created: ${cp.created_at}`,
          },
        ],
      };
    }

    // Phase 2: Summarization
    case 'context_summarize': {
      const { sessionId: specificSessionId, categories, maxLength } = args;
      const targetSessionId = specificSessionId || currentSessionId || ensureSession();

      const items = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? 
        ORDER BY priority DESC, created_at DESC
      `
        )
        .all(targetSessionId);

      const summary = createSummary(items, { categories, maxLength });

      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };
    }

    // Phase 3: Smart Compaction Helper
    case 'context_prepare_compaction': {
      const sessionId = ensureSession();

      // Get all high priority items
      const highPriorityItems = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND priority = 'high'
        ORDER BY created_at DESC
      `
        )
        .all(sessionId);

      // Get recent tasks
      const recentTasks = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND category = 'task'
        ORDER BY created_at DESC LIMIT 10
      `
        )
        .all(sessionId);

      // Get all decisions
      const decisions = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND category = 'decision'
        ORDER BY created_at DESC
      `
        )
        .all(sessionId);

      // Get files that changed
      const changedFiles = db
        .prepare(
          `
        SELECT file_path, hash FROM file_cache 
        WHERE session_id = ?
      `
        )
        .all(sessionId);

      // Auto-create checkpoint
      const checkpointId = uuidv4();
      const checkpointName = `auto-compaction-${new Date().toISOString()}`;

      const gitInfo = await getGitStatus();

      db.prepare(
        `
        INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        checkpointId,
        sessionId,
        checkpointName,
        'Automatic checkpoint before compaction',
        gitInfo.status,
        gitInfo.branch
      );

      // Save all context items to checkpoint
      const allItems = db
        .prepare('SELECT id FROM context_items WHERE session_id = ?')
        .all(sessionId);
      const itemStmt = db.prepare(
        'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
      );
      for (const item of allItems) {
        itemStmt.run(uuidv4(), checkpointId, (item as any).id);
      }

      // Generate summary for next session
      const summary = createSummary([...highPriorityItems, ...recentTasks, ...decisions], {
        maxLength: 2000,
      });

      // Determine next steps
      const nextSteps: string[] = [];
      const unfinishedTasks = recentTasks.filter(
        (t: any) =>
          !t.value.toLowerCase().includes('completed') && !t.value.toLowerCase().includes('done')
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
        gitBranch: gitInfo.branch,
      };

      // Save as special context item
      const preparedValue = JSON.stringify(preparedContext);
      db.prepare(
        `
        INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority, size, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
      ).run(
        uuidv4(),
        sessionId,
        '_prepared_compaction',
        preparedValue,
        'system',
        'high',
        calculateSize(preparedValue)
      );

      return {
        content: [
          {
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
          },
        ],
      };
    }

    // Phase 3: Git Integration
    case 'context_git_commit': {
      const { message, autoSave = true } = args;
      const sessionId = ensureSession();

      // Check if project directory is set for this session
      const session = repositories.sessions.getById(sessionId);
      if (!session || !session.working_directory) {
        return {
          content: [
            {
              type: 'text',
              text: getProjectDirectorySetupMessage(),
            },
          ],
        };
      }

      if (autoSave) {
        // Save current context state
        const timestamp = new Date().toISOString();
        const commitValue = message || 'No commit message';
        db.prepare(
          `
          INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority, size, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `
        ).run(
          uuidv4(),
          sessionId,
          `commit_${timestamp}`,
          commitValue,
          'git',
          'normal',
          calculateSize(commitValue)
        );

        // Create checkpoint
        const checkpointId = uuidv4();
        const checkpointName = `git-commit-${timestamp}`;
        const gitInfo = await getGitStatus();

        db.prepare(
          `
          INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(
          checkpointId,
          sessionId,
          checkpointName,
          `Git commit: ${message || 'No message'}`,
          gitInfo.status,
          gitInfo.branch
        );

        // Link current context to checkpoint
        const items = db
          .prepare('SELECT id FROM context_items WHERE session_id = ?')
          .all(sessionId);
        const itemStmt = db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        );
        for (const item of items) {
          itemStmt.run(uuidv4(), checkpointId, (item as any).id);
        }
      }

      // Execute git commit
      try {
        const git = simpleGit(session.working_directory);
        await git.add('.');
        const commitResult = await git.commit(message || 'Commit via Memory Keeper');

        return {
          content: [
            {
              type: 'text',
              text: `Git commit successful!
Commit: ${commitResult.commit}
Context saved: ${autoSave ? 'Yes' : 'No'}
Checkpoint: ${autoSave ? `git-commit-${new Date().toISOString()}` : 'None'}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Git commit failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Phase 3: Context Search
    case 'context_search': {
      const {
        query,
        searchIn = ['key', 'value'],
        sessionId: specificSessionId,
        category,
        channel,
        channels,
        sort,
        limit,
        offset,
        createdAfter,
        createdBefore,
        keyPattern,
        priorities,
        includeMetadata,
      } = args;
      const targetSessionId = specificSessionId || currentSessionId || ensureSession();

      // Use enhanced search for all cases
      const result = repositories.contexts.searchEnhanced({
        query,
        sessionId: targetSessionId,
        searchIn,
        category,
        channel,
        channels,
        sort,
        limit,
        offset,
        createdAfter,
        createdBefore,
        keyPattern,
        priorities,
        includeMetadata,
      });

      if (result.items.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No results found for: "${query}"`,
            },
          ],
        };
      }

      // Enhanced response format with metadata
      if (includeMetadata) {
        const itemsWithMetadata = result.items.map(item => ({
          key: item.key,
          value: item.value,
          category: item.category,
          priority: item.priority,
          channel: item.channel,
          metadata: item.metadata ? JSON.parse(item.metadata) : null,
          size: item.size || calculateSize(item.value),
          created_at: item.created_at,
          updated_at: item.updated_at,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  items: itemsWithMetadata,
                  totalCount: result.totalCount,
                  page: offset && limit ? Math.floor(offset / limit) + 1 : 1,
                  pageSize: limit || result.items.length,
                  query,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Backward compatible format
      const resultText = result.items
        .map(
          (r: any) =>
            `• [${r.priority}] ${r.key} (${r.category || 'none'})\n  ${r.value.substring(0, 100)}${r.value.length > 100 ? '...' : ''}`
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${result.items.length} results for "${query}":\n\n${resultText}`,
          },
        ],
      };
    }

    // Phase 3: Export/Import
    case 'context_export': {
      const {
        sessionId: specificSessionId,
        format = 'json',
        includeStats = false,
        confirmEmpty = false,
      } = args;
      const targetSessionId = specificSessionId || currentSessionId;

      // Phase 1: Validation
      if (!targetSessionId) {
        throw new Error('No session ID provided and no current session active');
      }

      // Check if session exists
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(targetSessionId) as any;
      if (!session) {
        throw new Error(`Session not found: ${targetSessionId}`);
      }

      // Get session data
      const contextItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(targetSessionId);
      const fileCache = db
        .prepare('SELECT * FROM file_cache WHERE session_id = ?')
        .all(targetSessionId);
      const checkpoints = db
        .prepare('SELECT * FROM checkpoints WHERE session_id = ?')
        .all(targetSessionId);

      // Check if session is empty
      const isEmpty =
        contextItems.length === 0 && fileCache.length === 0 && checkpoints.length === 0;
      if (isEmpty && !confirmEmpty) {
        return {
          content: [
            {
              type: 'text',
              text: 'Warning: Session appears to be empty. No context items, files, or checkpoints found.\n\nTo export anyway, use confirmEmpty: true',
            },
          ],
          isEmpty: true,
          requiresConfirmation: true,
        };
      }

      const exportData = {
        version: '0.4.0',
        exported: new Date().toISOString(),
        session,
        contextItems,
        fileCache,
        checkpoints,
        metadata: {
          itemCount: contextItems.length,
          fileCount: fileCache.length,
          checkpointCount: checkpoints.length,
          totalSize: JSON.stringify({ contextItems, fileCache, checkpoints }).length,
        },
      };

      if (format === 'json') {
        const exportPath = path.resolve(
          `memory-keeper-export-${targetSessionId.substring(0, 8)}.json`
        );

        // Check write permissions
        try {
          fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
        } catch (error: any) {
          if (error.code === 'EACCES') {
            throw new Error(`Permission denied: Cannot write to ${exportPath}`);
          }
          throw error;
        }

        const stats = {
          items: contextItems.length,
          files: fileCache.length,
          checkpoints: checkpoints.length,
          size: fs.statSync(exportPath).size,
        };

        return {
          content: [
            {
              type: 'text',
              text: includeStats
                ? `✅ Successfully exported session "${session.name}" to: ${exportPath}

📊 Export Statistics:
- Context Items: ${stats.items}
- Cached Files: ${stats.files}
- Checkpoints: ${stats.checkpoints}
- Export Size: ${(stats.size / 1024).toFixed(2)} KB

Session ID: ${targetSessionId}`
                : `Exported session to: ${exportPath}
Items: ${stats.items}
Files: ${stats.files}`,
            },
          ],
          exportPath,
          statistics: stats,
        };
      }

      // Inline format
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(exportData, null, 2),
          },
        ],
        statistics: {
          items: contextItems.length,
          files: fileCache.length,
          checkpoints: checkpoints.length,
        },
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
          db.prepare(
            `
            INSERT INTO sessions (id, name, description, branch, working_directory, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `
          ).run(
            targetSessionId,
            `Imported: ${importedSession.name}`,
            `Imported from ${filePath} on ${new Date().toISOString()}`,
            importedSession.branch,
            null,
            new Date().toISOString()
          );
          currentSessionId = targetSessionId;
        }

        // Import context items
        const itemStmt = db.prepare(`
          INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority, size, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
            item.size || calculateSize(item.value),
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
          content: [
            {
              type: 'text',
              text: `Import successful!
Session: ${targetSessionId.substring(0, 8)}
Context items: ${itemCount}
Files: ${fileCount}
Mode: ${merge ? 'Merged' : 'New session'}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Import failed: ${error.message}`,
            },
          ],
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
            const existing = knowledgeGraph.findEntity(
              targetSessionId,
              entityData.name,
              entityData.type
            );
            if (!existing) {
              knowledgeGraph.createEntity(targetSessionId, entityData.type, entityData.name, {
                confidence: entityData.confidence,
                source: item.key,
              });
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
        const entityStats = db
          .prepare(
            `
          SELECT type, COUNT(*) as count 
          FROM entities 
          WHERE session_id = ? 
          GROUP BY type
        `
          )
          .all(targetSessionId) as any[];

        return {
          content: [
            {
              type: 'text',
              text: `Analysis complete!
Items analyzed: ${items.length}
Entities created: ${entitiesCreated}
Relations created: ${relationsCreated}

Entity breakdown:
${entityStats.map(s => `- ${s.type}: ${s.count}`).join('\n')}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Analysis failed: ${error.message}`,
            },
          ],
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
          const contextItem = db
            .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
            .get(sessionId, key) as any;

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
            content: [
              {
                type: 'text',
                text: `No entity found for key: ${key}`,
              },
            ],
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
          relevantRelations = relevantRelations.filter(r => relationTypes.includes(r.predicate));
        }

        return {
          content: [
            {
              type: 'text',
              text: `Related entities for "${key}":

Found ${entities.length} connected entities (max depth: ${maxDepth})

Main entity:
- Type: ${entity.type}
- Name: ${entity.name}
- Direct relations: ${relevantRelations.length}

Connected entities:
${entities
  .slice(0, 20)
  .map(e => `- ${e.type}: ${e.name} (${e.relations} relations, ${e.observations} observations)`)
  .join('\n')}
${entities.length > 20 ? `\n... and ${entities.length - 20} more` : ''}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Find related failed: ${error.message}`,
            },
          ],
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
            content: [
              {
                type: 'text',
                text: JSON.stringify(graphData, null, 2),
              },
            ],
          };
        } else if (type === 'timeline') {
          // Get time-based data
          const timeline = db
            .prepare(
              `
            SELECT 
              strftime('%Y-%m-%d %H:00', created_at) as hour,
              COUNT(*) as events,
              GROUP_CONCAT(DISTINCT category) as categories
            FROM context_items
            WHERE session_id = ?
            GROUP BY hour
            ORDER BY hour DESC
            LIMIT 24
          `
            )
            .all(targetSessionId) as any[];

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    type: 'timeline',
                    data: timeline,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else if (type === 'heatmap') {
          // Get category/priority heatmap data
          const heatmap = db
            .prepare(
              `
            SELECT 
              category,
              priority,
              COUNT(*) as count
            FROM context_items
            WHERE session_id = ?
            GROUP BY category, priority
          `
            )
            .all(targetSessionId) as any[];

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    type: 'heatmap',
                    data: heatmap,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Unknown visualization type: ${type}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Visualization failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Phase 4.2: Semantic Search
    case 'context_semantic_search': {
      const { query, topK = 10, minSimilarity = 0.3, sessionId } = args;
      const targetSessionId = sessionId || ensureSession();

      try {
        // Ensure embeddings are up to date for the session
        const _embeddingCount = await vectorStore.updateSessionEmbeddings(targetSessionId);

        // Perform semantic search
        const results = await vectorStore.searchInSession(
          targetSessionId,
          query,
          topK,
          minSimilarity
        );

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No results found for query: "${query}"`,
              },
            ],
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
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Semantic search failed: ${error.message}`,
            },
          ],
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
            sessionId: targetSessionId,
          },
        };

        // Process with agents
        let results;
        if (chain && Array.isArray(input)) {
          // Process as a chain of tasks
          const tasks = input.map((inp, index) => ({
            id: uuidv4(),
            type: Array.isArray(taskType) ? taskType[index] : taskType,
            input: { ...inp, sessionId: targetSessionId },
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
          content: [
            {
              type: 'text',
              text: response,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Agent delegation failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Phase 4.4: Session Branching
    case 'context_branch_session': {
      const { branchName, copyDepth = 'shallow' } = args;
      const sourceSessionId = ensureSession();

      try {
        // Get source session info
        const sourceSession = db
          .prepare('SELECT * FROM sessions WHERE id = ?')
          .get(sourceSessionId) as any;
        if (!sourceSession) {
          throw new Error('Source session not found');
        }

        // Create new branch session
        const branchId = uuidv4();
        db.prepare(
          `
          INSERT INTO sessions (id, name, description, branch, working_directory, parent_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(
          branchId,
          branchName,
          `Branch of ${sourceSession.name} created at ${new Date().toISOString()}`,
          sourceSession.branch,
          null,
          sourceSessionId
        );

        if (copyDepth === 'deep') {
          // Copy all context items
          const items = db
            .prepare('SELECT * FROM context_items WHERE session_id = ?')
            .all(sourceSessionId) as any[];
          const stmt = db.prepare(
            'INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          );

          for (const item of items) {
            stmt.run(
              uuidv4(),
              branchId,
              item.key,
              item.value,
              item.category,
              item.priority,
              item.created_at
            );
          }

          // Copy file cache
          const files = db
            .prepare('SELECT * FROM file_cache WHERE session_id = ?')
            .all(sourceSessionId) as any[];
          const fileStmt = db.prepare(
            'INSERT INTO file_cache (id, session_id, file_path, content, hash, last_read) VALUES (?, ?, ?, ?, ?, ?)'
          );

          for (const file of files) {
            fileStmt.run(
              uuidv4(),
              branchId,
              file.file_path,
              file.content,
              file.hash,
              file.last_read
            );
          }
        } else {
          // Shallow copy - only copy high priority items
          const items = db
            .prepare('SELECT * FROM context_items WHERE session_id = ? AND priority = ?')
            .all(sourceSessionId, 'high') as any[];
          const stmt = db.prepare(
            'INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          );

          for (const item of items) {
            stmt.run(
              uuidv4(),
              branchId,
              item.key,
              item.value,
              item.category,
              item.priority,
              item.created_at
            );
          }
        }

        // Switch to the new branch
        currentSessionId = branchId;

        return {
          content: [
            {
              type: 'text',
              text: `Created branch session: ${branchName}
ID: ${branchId}
Parent: ${sourceSession.name} (${sourceSessionId.substring(0, 8)})
Copy depth: ${copyDepth}
Items copied: ${copyDepth === 'deep' ? 'All' : 'High priority only'}

Now working in branch: ${branchName}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Branch creation failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Phase 4.4: Session Merging
    case 'context_merge_sessions': {
      const { sourceSessionId, conflictResolution = 'keep_current' } = args;
      const targetSessionId = ensureSession();

      try {
        // Get both sessions
        const sourceSession = db
          .prepare('SELECT * FROM sessions WHERE id = ?')
          .get(sourceSessionId) as any;
        const targetSession = db
          .prepare('SELECT * FROM sessions WHERE id = ?')
          .get(targetSessionId) as any;

        if (!sourceSession) {
          throw new Error('Source session not found');
        }

        // Get items from source session
        const sourceItems = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(sourceSessionId) as any[];

        let merged = 0;
        let skipped = 0;

        for (const item of sourceItems) {
          // Check if item exists in target
          const existing = db
            .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
            .get(targetSessionId, item.key) as any;

          if (existing) {
            // Handle conflict
            if (
              conflictResolution === 'keep_source' ||
              (conflictResolution === 'keep_newest' &&
                new Date(item.created_at) > new Date(existing.created_at))
            ) {
              db.prepare(
                'UPDATE context_items SET value = ?, category = ?, priority = ? WHERE session_id = ? AND key = ?'
              ).run(item.value, item.category, item.priority, targetSessionId, item.key);
              merged++;
            } else {
              skipped++;
            }
          } else {
            // No conflict, insert item
            db.prepare(
              'INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).run(
              uuidv4(),
              targetSessionId,
              item.key,
              item.value,
              item.category,
              item.priority,
              item.created_at
            );
            merged++;
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: `Merge completed!
Source: ${sourceSession.name} (${sourceSessionId.substring(0, 8)})
Target: ${targetSession.name} (${targetSessionId.substring(0, 8)})
Items merged: ${merged}
Items skipped: ${skipped}
Conflict resolution: ${conflictResolution}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Session merge failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Phase 4.4: Journal Entry
    case 'context_journal_entry': {
      const { entry, tags = [], mood } = args;
      const sessionId = ensureSession();

      try {
        const id = uuidv4();
        db.prepare(
          `
          INSERT INTO journal_entries (id, session_id, entry, tags, mood)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(id, sessionId, entry, JSON.stringify(tags), mood);

        return {
          content: [
            {
              type: 'text',
              text: `Journal entry added!
Time: ${new Date().toISOString()}
Mood: ${mood || 'not specified'}
Tags: ${tags.join(', ') || 'none'}
Entry saved with ID: ${id.substring(0, 8)}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Journal entry failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Phase 4.4: Timeline
    case 'context_timeline': {
      const {
        startDate,
        endDate,
        groupBy = 'day',
        sessionId,
        categories,
        relativeTime,
        itemsPerPeriod,
        includeItems,
      } = args;
      const targetSessionId = sessionId || ensureSession();

      try {
        // Use the enhanced timeline method
        const timeline = repositories.contexts.getTimelineData({
          sessionId: targetSessionId,
          startDate,
          endDate,
          categories,
          relativeTime,
          itemsPerPeriod,
          includeItems,
          groupBy,
        });

        // Get journal entries for the same period
        let journalQuery = 'SELECT * FROM journal_entries WHERE session_id = ?';
        const journalParams: any[] = [targetSessionId];

        // Calculate effective dates based on relativeTime if needed
        let effectiveStartDate = startDate;
        let effectiveEndDate = endDate;

        if (relativeTime) {
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

          if (relativeTime === 'today') {
            effectiveStartDate = today.toISOString();
            effectiveEndDate = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();
          } else if (relativeTime === 'yesterday') {
            const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
            effectiveStartDate = yesterday.toISOString();
            effectiveEndDate = today.toISOString();
          } else if (relativeTime.match(/^(\d+) hours? ago$/)) {
            const hours = parseInt(relativeTime.match(/^(\d+)/)![1]);
            effectiveStartDate = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
          } else if (relativeTime.match(/^(\d+) days? ago$/)) {
            const days = parseInt(relativeTime.match(/^(\d+)/)![1]);
            effectiveStartDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
          } else if (relativeTime === 'this week') {
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay());
            effectiveStartDate = startOfWeek.toISOString();
          } else if (relativeTime === 'last week') {
            const startOfLastWeek = new Date(today);
            startOfLastWeek.setDate(today.getDate() - today.getDay() - 7);
            const endOfLastWeek = new Date(startOfLastWeek);
            endOfLastWeek.setDate(startOfLastWeek.getDate() + 7);
            effectiveStartDate = startOfLastWeek.toISOString();
            effectiveEndDate = endOfLastWeek.toISOString();
          }
        }

        if (effectiveStartDate) {
          journalQuery += ' AND created_at >= ?';
          journalParams.push(effectiveStartDate);
        }
        if (effectiveEndDate) {
          journalQuery += ' AND created_at <= ?';
          journalParams.push(effectiveEndDate);
        }

        const journals = db
          .prepare(journalQuery + ' ORDER BY created_at')
          .all(...journalParams) as any[];

        // Format enhanced timeline response
        const timelineData = {
          session_id: targetSessionId,
          period: {
            start: effectiveStartDate || startDate || 'beginning',
            end: effectiveEndDate || endDate || 'now',
            relative: relativeTime || null,
          },
          groupBy,
          filters: {
            categories: categories || null,
          },
          timeline: timeline.map(period => {
            const result: any = {
              period: period.period,
              count: period.count,
            };

            if (includeItems && period.items) {
              result.items = period.items.map((item: any) => ({
                key: item.key,
                value: item.value,
                category: item.category,
                priority: item.priority,
                created_at: item.created_at,
              }));

              if (period.hasMore) {
                result.hasMore = true;
                result.totalCount = period.totalCount;
              }
            }

            return result;
          }),
          journal_entries: journals.map((journal: any) => ({
            entry: journal.entry,
            tags: JSON.parse(journal.tags || '[]'),
            mood: journal.mood,
            created_at: journal.created_at,
          })),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(timelineData, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Timeline generation failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Phase 4.4: Progressive Compression
    case 'context_compress': {
      const { olderThan, preserveCategories = [], targetSize: _targetSize, sessionId } = args;
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
            content: [
              {
                type: 'text',
                text: 'No items found to compress with given criteria.',
              },
            ],
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
            samples: items
              .slice(0, 3)
              .map((i: any) => ({ key: i.key, value: i.value.substring(0, 100) })),
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
        const compressionRatio = 1 - compressedSize / originalSize;

        // Store compressed data
        const compressedId = uuidv4();
        const dateRange = itemsToCompress.reduce(
          (acc, item) => {
            const date = new Date(item.created_at);
            if (!acc.start || date < acc.start) acc.start = date;
            if (!acc.end || date > acc.end) acc.end = date;
            return acc;
          },
          { start: null as Date | null, end: null as Date | null }
        );

        db.prepare(
          `
          INSERT INTO compressed_context (id, session_id, original_count, compressed_data, compression_ratio, date_range_start, date_range_end)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
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
          content: [
            {
              type: 'text',
              text: `Compression completed!
Items compressed: ${itemsToCompress.length}
Original size: ${(originalSize / 1024).toFixed(2)} KB
Compressed size: ${(compressedSize / 1024).toFixed(2)} KB
Compression ratio: ${(compressionRatio * 100).toFixed(1)}%
Date range: ${dateRange.start?.toISOString().substring(0, 10)} to ${dateRange.end?.toISOString().substring(0, 10)}

Categories compressed:
${Object.entries(categoryGroups)
  .map(([cat, items]) => `- ${cat}: ${items.length} items`)
  .join('\n')}

Compressed data ID: ${compressedId.substring(0, 8)}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Compression failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Phase 4.4: Cross-Tool Integration
    case 'context_integrate_tool': {
      const { toolName, eventType, data } = args;
      const sessionId = ensureSession();

      try {
        const id = uuidv4();
        db.prepare(
          `
          INSERT INTO tool_events (id, session_id, tool_name, event_type, data)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(id, sessionId, toolName, eventType, JSON.stringify(data));

        // Optionally create a context item for important events
        if (data.important || eventType === 'error' || eventType === 'milestone') {
          db.prepare(
            `
            INSERT INTO context_items (id, session_id, key, value, category, priority)
            VALUES (?, ?, ?, ?, ?, ?)
          `
          ).run(
            uuidv4(),
            sessionId,
            `${toolName}_${eventType}_${Date.now()}`,
            `Tool event: ${toolName} - ${eventType}: ${JSON.stringify(data)}`,
            'tool_event',
            data.important ? 'high' : 'normal'
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: `Tool event recorded!
Tool: ${toolName}
Event: ${eventType}
Data recorded: ${JSON.stringify(data).length} bytes
Event ID: ${id.substring(0, 8)}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Tool integration failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Cross-Session Collaboration Tools
    // REMOVED: Sharing is now automatic (public by default)
    /*
    case 'context_share': {
      const { key, targetSessions, makePublic = false } = args;
      const sessionId = ensureSession();
      
      try {
        // Get the item to share
        const item = repositories.contexts.getByKey(sessionId, key);
        if (!item) {
          return {
            content: [{
              type: 'text',
              text: `Item not found: ${key}`,
            }],
          };
        }
        
        // Share with specific sessions or make public
        const targetSessionIds = makePublic ? [] : (targetSessions || []);
        repositories.contexts.shareByKey(sessionId, key, targetSessionIds);
        
        return {
          content: [{
            type: 'text',
            text: `Shared "${key}" ${makePublic ? 'publicly' : `with ${targetSessionIds.length} session(s)`}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to share context: ${error.message}`,
          }],
        };
      }
    }
    */

    // REMOVED: All accessible items are retrieved via context_get
    /*
    case 'context_get_shared': {
      const { includeAll = false } = args;
      const sessionId = ensureSession();
      
      try {
        const items = includeAll 
          ? repositories.contexts.getAllSharedItems()
          : repositories.contexts.getSharedItems(sessionId);
        
        if (items.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No shared context items found',
            }],
          };
        }
        
        const itemsList = items.map((item: any) => {
          const sharedWith = item.shared_with_sessions 
            ? JSON.parse(item.shared_with_sessions).length 
            : 'all';
          return `• [${item.priority}] ${item.key} (from session: ${item.session_id.substring(0, 8)}, shared with: ${sharedWith})\n  ${item.value.substring(0, 100)}${item.value.length > 100 ? '...' : ''}`;
        }).join('\n\n');
        
        return {
          content: [{
            type: 'text',
            text: `Found ${items.length} shared items:\n\n${itemsList}`,
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get shared context: ${error.message}`,
          }],
        };
      }
    }
    */

    case 'context_search_all': {
      const { query } = args;
      const currentSession = currentSessionId || ensureSession();

      try {
        // Search across all sessions, including private items from current session
        const results = repositories.contexts.searchAcrossSessions(query, currentSession);

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No results found for: "${query}"`,
              },
            ],
          };
        }

        const resultsList = results
          .map(
            (item: any) =>
              `• [${item.session_id.substring(0, 8)}] ${item.key}: ${item.value.substring(0, 100)}${item.value.length > 100 ? '...' : ''}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${results.length} results across sessions:\n\n${resultsList}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Search failed: ${error.message}`,
            },
          ],
        };
      }
    }

    // Context Diff - Track changes since a specific point in time
    case 'context_diff': {
      const {
        since,
        sessionId: specificSessionId,
        category,
        channel,
        channels,
        includeValues = true,
        limit,
        offset,
      } = args;
      const targetSessionId = specificSessionId || currentSessionId || ensureSession();

      try {
        // Parse the 'since' parameter
        let sinceTimestamp: string | null = null;
        let checkpointId: string | null = null;

        if (since) {
          // Check if it's a checkpoint name or ID
          const checkpointByName = db
            .prepare('SELECT * FROM checkpoints WHERE name = ? ORDER BY created_at DESC LIMIT 1')
            .get(since) as any;

          const checkpointById = !checkpointByName
            ? (db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(since) as any)
            : null;

          const checkpoint = checkpointByName || checkpointById;

          if (checkpoint) {
            checkpointId = checkpoint.id;
            sinceTimestamp = checkpoint.created_at;
          } else {
            // Try to parse as relative time
            const parsedTime = parseRelativeTime(since);
            if (parsedTime) {
              sinceTimestamp = parsedTime;
            } else {
              // Assume it's an ISO timestamp
              sinceTimestamp = since;
            }
          }
        } else {
          // Default to 1 hour ago if no 'since' provided
          sinceTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        }

        // Convert ISO timestamp to SQLite format for repository compatibility
        const sqliteTimestamp = ensureSQLiteFormat(sinceTimestamp!);

        // Use repository method to get diff data
        const diffData = repositories.contexts.getDiff({
          sessionId: targetSessionId,
          sinceTimestamp: sqliteTimestamp,
          category,
          channel,
          channels,
          limit,
          offset,
          includeValues,
        });

        // Handle deleted items if we have a checkpoint
        let deletedKeys: string[] = [];
        if (checkpointId) {
          deletedKeys = repositories.contexts.getDeletedKeysFromCheckpoint(
            targetSessionId,
            checkpointId
          );
        }

        // Format response
        const toDate = new Date().toISOString();
        const response: any = {
          added: includeValues
            ? diffData.added
            : diffData.added.map(i => ({ key: i.key, category: i.category })),
          modified: includeValues
            ? diffData.modified
            : diffData.modified.map(i => ({ key: i.key, category: i.category })),
          deleted: deletedKeys,
          summary: `${diffData.added.length} added, ${diffData.modified.length} modified, ${deletedKeys.length} deleted`,
          period: {
            from: sinceTimestamp,
            to: toDate,
          },
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get context diff: ${error.message}`,
            },
          ],
        };
      }
    }

    // Channel Management
    case 'context_list_channels': {
      const { sessionId, sessionIds, sort, includeEmpty } = args;

      try {
        const channels = repositories.contexts.listChannels({
          sessionId: sessionId || currentSessionId,
          sessionIds,
          sort,
          includeEmpty,
        });

        if (channels.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No channels found.',
              },
            ],
          };
        }

        // Format the response
        const channelList = channels
          .map(
            (ch: any) =>
              `• ${ch.channel}: ${ch.total_count} items (${ch.public_count} public, ${ch.private_count} private)\n  Last activity: ${new Date(ch.last_activity).toLocaleString()}\n  Categories: ${ch.categories.join(', ') || 'none'}\n  Sessions: ${ch.session_count}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Found ${channels.length} channels:\n\n${channelList}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to list channels: ${error.message}`,
            },
          ],
        };
      }
    }

    case 'context_channel_stats': {
      const { channel, sessionId, includeTimeSeries, includeInsights } = args;

      try {
        const stats = repositories.contexts.getChannelStats({
          channel,
          sessionId: sessionId || currentSessionId,
          includeTimeSeries,
          includeInsights,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to get channel stats: ${error.message}`,
            },
          ],
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
            projectDir: {
              type: 'string',
              description:
                'Project directory path for git tracking (e.g., "/path/to/your/project")',
            },
            defaultChannel: {
              type: 'string',
              description:
                'Default channel for context items (auto-derived from git branch if not provided)',
            },
          },
        },
      },
      {
        name: 'context_session_list',
        description: 'List recent sessions',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of sessions to return',
              default: 10,
            },
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
              description:
                'Project directory path for git tracking (e.g., "/path/to/your/project")',
            },
          },
          required: ['projectDir'],
        },
      },
      // Enhanced Context Storage
      {
        name: 'context_save',
        description: 'Save a context item with optional category, priority, and privacy setting',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Unique key for the context item' },
            value: { type: 'string', description: 'Context value to save' },
            category: {
              type: 'string',
              description: 'Category (e.g., task, decision, progress)',
              enum: ['task', 'decision', 'progress', 'note', 'error', 'warning'],
            },
            priority: {
              type: 'string',
              description: 'Priority level',
              enum: ['high', 'normal', 'low'],
              default: 'normal',
            },
            private: {
              type: 'boolean',
              description:
                'If true, item is only accessible from the current session. Default: false (accessible from all sessions)',
              default: false,
            },
            channel: {
              type: 'string',
              description: 'Channel to organize this item (uses session default if not provided)',
            },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'context_get',
        description:
          'Retrieve saved context by key, category, or session with enhanced filtering. Returns all accessible items (public items + own private items)',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Specific key to retrieve' },
            category: { type: 'string', description: 'Filter by category' },
            sessionId: { type: 'string', description: 'Specific session ID (defaults to current)' },
            channel: { type: 'string', description: 'Filter by single channel' },
            channels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by multiple channels',
            },
            includeMetadata: {
              type: 'boolean',
              description: 'Include timestamps and size info',
            },
            sort: {
              type: 'string',
              enum: ['created_desc', 'created_asc', 'updated_desc', 'key_asc', 'key_desc'],
              description: 'Sort order for results',
            },
            limit: { type: 'number', description: 'Maximum items to return' },
            offset: { type: 'number', description: 'Pagination offset' },
            createdAfter: {
              type: 'string',
              description: 'ISO date - items created after this time',
            },
            createdBefore: {
              type: 'string',
              description: 'ISO date - items created before this time',
            },
            keyPattern: {
              type: 'string',
              description: 'Regex pattern for key matching',
            },
            priorities: {
              type: 'array',
              items: { type: 'string', enum: ['high', 'normal', 'low'] },
              description: 'Filter by priority levels',
            },
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
              default: true,
            },
            includeGitStatus: {
              type: 'boolean',
              description: 'Capture current git status',
              default: true,
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
              default: true,
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
            sessionId: {
              type: 'string',
              description: 'Session to summarize (defaults to current)',
            },
            categories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by specific categories',
            },
            maxLength: {
              type: 'number',
              description: 'Maximum summary length',
              default: 1000,
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
              default: true,
            },
          },
          required: ['message'],
        },
      },
      // Phase 3: Search
      {
        name: 'context_search',
        description: 'Search through saved context items with advanced filtering',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            searchIn: {
              type: 'array',
              items: { type: 'string', enum: ['key', 'value'] },
              description: 'Fields to search in',
              default: ['key', 'value'],
            },
            sessionId: { type: 'string', description: 'Session to search (defaults to current)' },
            category: { type: 'string', description: 'Filter by category' },
            channel: { type: 'string', description: 'Filter by single channel' },
            channels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by multiple channels',
            },
            createdAfter: {
              type: 'string',
              description: 'ISO date - items created after this time',
            },
            createdBefore: {
              type: 'string',
              description: 'ISO date - items created before this time',
            },
            relativeTime: {
              type: 'string',
              description: 'Natural language time (e.g., "2 hours ago", "yesterday")',
            },
            keyPattern: {
              type: 'string',
              description: 'Pattern for key matching (uses GLOB syntax)',
            },
            priorities: {
              type: 'array',
              items: { type: 'string', enum: ['high', 'normal', 'low'] },
              description: 'Filter by priority levels',
            },
            sort: {
              type: 'string',
              enum: ['created_desc', 'created_asc', 'updated_desc', 'key_asc', 'key_desc'],
              description: 'Sort order for results',
            },
            limit: { type: 'number', description: 'Maximum items to return' },
            offset: { type: 'number', description: 'Pagination offset' },
            includeMetadata: {
              type: 'boolean',
              description: 'Include timestamps and size info',
            },
          },
          required: ['query'],
        },
      },
      // Cross-Session Collaboration
      // REMOVED: Sharing is now automatic (public by default)
      /*
      {
        name: 'context_share',
        description: 'Share a context item with other sessions for cross-session collaboration',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key of the item to share' },
            targetSessions: { 
              type: 'array',
              items: { type: 'string' },
              description: 'Session IDs to share with (empty for public sharing)'
            },
            makePublic: { 
              type: 'boolean', 
              description: 'Share with all sessions',
              default: false 
            },
          },
          required: ['key'],
        },
      },
      */
      // REMOVED: All accessible items are retrieved via context_get
      /*
      {
        name: 'context_get_shared',
        description: 'Get shared context items from other sessions',
        inputSchema: {
          type: 'object',
          properties: {
            includeAll: { 
              type: 'boolean', 
              description: 'Include all shared items from all sessions',
              default: false 
            },
          },
        },
      },
      */
      {
        name: 'context_search_all',
        description: 'Search across multiple or all sessions',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            sessions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Session IDs to search (empty for all sessions)',
            },
            includeShared: {
              type: 'boolean',
              description: 'Include shared items in search',
              default: true,
            },
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
              default: 'json',
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
              default: false,
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
            sessionId: {
              type: 'string',
              description: 'Session ID to analyze (defaults to current)',
            },
            categories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Categories to analyze',
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
              description: 'Types of relations to include',
            },
            maxDepth: {
              type: 'number',
              description: 'Maximum graph traversal depth',
              default: 2,
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
              default: 'graph',
            },
            entityTypes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Entity types to include',
            },
            sessionId: {
              type: 'string',
              description: 'Session to visualize (defaults to current)',
            },
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
              default: 10,
            },
            minSimilarity: {
              type: 'number',
              description: 'Minimum similarity score (0-1)',
              default: 0.3,
            },
            sessionId: {
              type: 'string',
              description: 'Search within specific session (defaults to current)',
            },
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
              description: 'Type of task to delegate',
            },
            input: {
              type: 'object',
              properties: {
                analysisType: {
                  type: 'string',
                  enum: ['patterns', 'relationships', 'trends', 'comprehensive'],
                  description: 'For analyze tasks: type of analysis',
                },
                synthesisType: {
                  type: 'string',
                  enum: ['summary', 'merge', 'recommendations'],
                  description: 'For synthesize tasks: type of synthesis',
                },
                categories: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Categories to include in analysis',
                },
                timeframe: {
                  type: 'string',
                  description: 'Time period for analysis (e.g., "-7 days")',
                },
                maxLength: {
                  type: 'number',
                  description: 'Maximum length for summaries',
                },
                insights: {
                  type: 'array',
                  description: 'For merge synthesis: array of insights to merge',
                },
              },
            },
            chain: {
              type: 'boolean',
              description: 'Process multiple tasks in sequence',
              default: false,
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
              description: 'Name for the new branch',
            },
            copyDepth: {
              type: 'string',
              enum: ['shallow', 'deep'],
              description: 'How much to copy: shallow (high priority only) or deep (everything)',
              default: 'shallow',
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
              description: 'ID of the session to merge from',
            },
            conflictResolution: {
              type: 'string',
              enum: ['keep_current', 'keep_source', 'keep_newest'],
              description: 'How to resolve conflicts',
              default: 'keep_current',
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
              description: 'Journal entry text',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization',
            },
            mood: {
              type: 'string',
              description: 'Current mood/feeling',
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
              description: 'Start date (ISO format)',
            },
            endDate: {
              type: 'string',
              description: 'End date (ISO format)',
            },
            groupBy: {
              type: 'string',
              enum: ['hour', 'day', 'week'],
              description: 'How to group timeline data',
              default: 'day',
            },
            sessionId: {
              type: 'string',
              description: 'Session to analyze (defaults to current)',
            },
            includeItems: {
              type: 'boolean',
              description: 'Include item details in timeline',
            },
            categories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by categories',
            },
            relativeTime: {
              type: 'string',
              description: 'Natural language time (e.g., "2 hours ago", "today")',
            },
            itemsPerPeriod: {
              type: 'number',
              description: 'Max items per time period',
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
              description: 'Compress items older than this date (ISO format)',
            },
            preserveCategories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Categories to preserve (not compress)',
            },
            targetSize: {
              type: 'number',
              description: 'Target size in KB (optional)',
            },
            sessionId: {
              type: 'string',
              description: 'Session to compress (defaults to current)',
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
              description: 'Name of the tool',
            },
            eventType: {
              type: 'string',
              description: 'Type of event',
            },
            data: {
              type: 'object',
              description: 'Event data',
              properties: {
                important: {
                  type: 'boolean',
                  description: 'Mark as important to save as context item',
                },
              },
            },
          },
          required: ['toolName', 'eventType', 'data'],
        },
      },
      {
        name: 'context_diff',
        description:
          'Get changes to context items since a specific point in time (timestamp, checkpoint, or relative time)',
        inputSchema: {
          type: 'object',
          properties: {
            since: {
              type: 'string',
              description:
                'Point in time to compare against (ISO timestamp, checkpoint name/ID, or relative time like "2 hours ago")',
            },
            sessionId: {
              type: 'string',
              description: 'Session ID to analyze (defaults to current)',
            },
            category: {
              type: 'string',
              description: 'Filter by category',
            },
            channel: {
              type: 'string',
              description: 'Filter by single channel',
            },
            channels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by multiple channels',
            },
            includeValues: {
              type: 'boolean',
              description: 'Include full item values in response',
              default: true,
            },
            limit: {
              type: 'number',
              description: 'Maximum items per category (added/modified)',
            },
            offset: {
              type: 'number',
              description: 'Pagination offset',
            },
          },
        },
      },
      {
        name: 'context_list_channels',
        description: 'List all channels with metadata (counts, activity, categories)',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Filter by specific session (shows accessible items)',
            },
            sessionIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by multiple sessions',
            },
            sort: {
              type: 'string',
              enum: ['name', 'count', 'activity'],
              description: 'Sort order for results',
              default: 'name',
            },
            includeEmpty: {
              type: 'boolean',
              description: 'Include channels with no items',
              default: false,
            },
          },
        },
      },
      {
        name: 'context_channel_stats',
        description: 'Get detailed statistics for a specific channel or all channels',
        inputSchema: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'Specific channel name (omit for all channels overview)',
            },
            sessionId: {
              type: 'string',
              description: 'Session context for privacy filtering',
            },
            includeTimeSeries: {
              type: 'boolean',
              description: 'Include hourly/daily activity data',
              default: false,
            },
            includeInsights: {
              type: 'boolean',
              description: 'Include AI-generated insights',
              default: false,
            },
          },
        },
      },
    ],
  };
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);
