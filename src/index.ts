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

// Initialize database
const db = new Database('context.db');

// Create tables with enhanced schema
db.exec(`
  -- Sessions table
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    branch TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

// Create MCP server
const server = new Server(
  {
    name: 'memory-keeper',
    version: '0.2.0',
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
      const { name, description, continueFrom } = args;
      const sessionId = uuidv4();
      
      // Get current git branch if available
      let branch = null;
      try {
        const gitHeadPath = path.join(process.cwd(), '.git', 'HEAD');
        if (fs.existsSync(gitHeadPath)) {
          const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
          if (headContent.startsWith('ref: refs/heads/')) {
            branch = headContent.replace('ref: refs/heads/', '');
          }
        }
      } catch (e) {
        // Ignore git errors
      }

      db.prepare('INSERT INTO sessions (id, name, description, branch) VALUES (?, ?, ?, ?)').run(
        sessionId,
        name || `Session ${new Date().toISOString()}`,
        description || '',
        branch
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

      return {
        content: [{
          type: 'text',
          text: `Started new session: ${sessionId}\nName: ${name || 'Unnamed'}\nBranch: ${branch || 'unknown'}`,
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
      
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(uuidv4(), sessionId, key, value, category, priority);
      
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
        description: 'Start a new context session',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Session name' },
            description: { type: 'string', description: 'Session description' },
            continueFrom: { type: 'string', description: 'Session ID to continue from' },
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
    ],
  };
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);