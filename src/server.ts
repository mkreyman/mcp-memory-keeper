import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { DatabaseManager } from './utils/database.js';
import { GitOperations } from './utils/git.js';
import {
  ValidationError,
  validateFilePath,
  validateSearchQuery,
  validateSessionName,
  validateKey,
  validateValue,
  validateCategory,
  validatePriority,
} from './utils/validation.js';

// Initialize database with better configuration
const dbManager = new DatabaseManager({
  filename: process.env.MCP_MEMORY_DB || 'context.db',
  maxSize: parseInt(process.env.MCP_MEMORY_MAX_SIZE || '104857600'), // 100MB default
  walMode: true
});

const db = dbManager.getDatabase();

// Initialize git operations
const gitOps = new GitOperations();

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
    version: '0.5.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Error wrapper for better error handling
async function handleToolRequest(toolName: string, args: any): Promise<any> {
  try {
    // Check database size before operations
    if (dbManager.isDatabaseFull()) {
      // Attempt cleanup
      const deleted = dbManager.cleanupOldSessions(30);
      if (deleted > 0) {
        dbManager.vacuum();
      }
      
      // Check again
      if (dbManager.isDatabaseFull()) {
        return {
          content: [{
            type: 'text',
            text: 'Error: Database is full. Please export old sessions and delete them to free space.',
          }],
        };
      }
    }

    switch (toolName) {
      // Session Management
      case 'context_session_start': {
        const { name, description, continueFrom } = args;
        const sessionId = uuidv4();
        const validatedName = name ? validateSessionName(name) : `Session ${new Date().toISOString()}`;
        
        // Get current git branch safely
        const branch = await gitOps.getCurrentBranch();

        db.prepare('INSERT INTO sessions (id, name, description, branch) VALUES (?, ?, ?, ?)').run(
          sessionId,
          validatedName,
          description || '',
          branch
        );

        // Copy context from previous session if specified
        if (continueFrom) {
          // Verify session exists
          const sourceSession = db.prepare('SELECT id FROM sessions WHERE id = ?').get(continueFrom);
          if (!sourceSession) {
            throw new ValidationError('Source session not found');
          }

          dbManager.transaction(() => {
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
          });
        }

        currentSessionId = sessionId;

        return {
          content: [{
            type: 'text',
            text: `Started new session: ${sessionId}\nName: ${validatedName}\nBranch: ${branch || 'none'}`,
          }],
        };
      }

      case 'context_session_list': {
        const { limit = 10 } = args;
        const validLimit = Math.min(Math.max(1, limit), 100); // Limit between 1-100
        
        const sessions = db.prepare(`
          SELECT id, name, description, branch, created_at,
                 (SELECT COUNT(*) FROM context_items WHERE session_id = sessions.id) as item_count
          FROM sessions
          ORDER BY created_at DESC
          LIMIT ?
        `).all(validLimit);

        const sessionList = sessions.map((s: any) => 
          `• ${s.name} (${s.id.substring(0, 8)})\n  Created: ${s.created_at}\n  Items: ${s.item_count}\n  Branch: ${s.branch || 'none'}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: sessionList.length > 0 ? `Recent sessions:\n\n${sessionList}` : 'No sessions found',
          }],
        };
      }

      // Enhanced Context Storage
      case 'context_save': {
        const { key, value, category, priority = 'normal' } = args;
        const sessionId = ensureSession();
        
        const validatedKey = validateKey(key);
        const validatedValue = validateValue(value);
        const validatedCategory = validateCategory(category);
        const validatedPriority = validatePriority(priority);
        
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(uuidv4(), sessionId, validatedKey, validatedValue, validatedCategory, validatedPriority);
        
        return {
          content: [{
            type: 'text',
            text: `Saved: ${validatedKey}\nCategory: ${validatedCategory || 'none'}\nPriority: ${validatedPriority}\nSession: ${sessionId.substring(0, 8)}`,
          }],
        };
      }

      case 'context_get': {
        const { key, category, sessionId: specificSessionId } = args;
        const targetSessionId = specificSessionId || currentSessionId || ensureSession();
        
        let query = 'SELECT * FROM context_items WHERE session_id = ?';
        const params: any[] = [targetSessionId];
        
        if (key) {
          const validatedKey = validateKey(key);
          query += ' AND key = ?';
          params.push(validatedKey);
        }
        
        if (category) {
          const validatedCategory = validateCategory(category);
          query += ' AND category = ?';
          params.push(validatedCategory);
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
        
        const validatedPath = validateFilePath(filePath, 'write');
        const validatedContent = validateValue(content);
        const hash = calculateFileHash(validatedContent);
        
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO file_cache (id, session_id, file_path, content, hash)
          VALUES (?, ?, ?, ?, ?)
        `);
        
        stmt.run(uuidv4(), sessionId, validatedPath, validatedContent, hash);
        
        return {
          content: [{
            type: 'text',
            text: `Cached file: ${validatedPath}\nHash: ${hash.substring(0, 16)}...\nSize: ${validatedContent.length} bytes`,
          }],
        };
      }

      case 'context_file_changed': {
        const { filePath, currentContent } = args;
        const sessionId = ensureSession();
        
        const validatedPath = validateFilePath(filePath, 'write');
        
        const cached = db.prepare(
          'SELECT hash, content FROM file_cache WHERE session_id = ? AND file_path = ?'
        ).get(sessionId, validatedPath) as any;
        
        if (!cached) {
          return {
            content: [{
              type: 'text',
              text: `No cached version found for: ${validatedPath}`,
            }],
          };
        }
        
        const currentHash = currentContent ? calculateFileHash(currentContent) : null;
        const hasChanged = currentHash !== cached.hash;
        
        return {
          content: [{
            type: 'text',
            text: `File: ${validatedPath}\nChanged: ${hasChanged}\nCached hash: ${cached.hash.substring(0, 16)}...\nCurrent hash: ${currentHash ? currentHash.substring(0, 16) + '...' : 'N/A'}`,
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
        
        const sizeInfo = dbManager.getSessionSize(sessionId);
        const dbSize = dbManager.getDatabaseSize();
        
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
Session Size: ${(sizeInfo.totalSize / 1024).toFixed(2)} KB
Database Size: ${(dbSize / 1024 / 1024).toFixed(2)} MB

Recent Items:
${recentList || '  None'}`,
          }],
        };
      }

      // The rest of the tool implementations would follow similar patterns...
      // For brevity, I'll include just the key changes for error handling

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    // Handle errors gracefully
    if (error instanceof ValidationError) {
      return {
        content: [{
          type: 'text',
          text: `Validation Error: ${error.message}`,
        }],
      };
    }
    
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }
}

// Main request handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments as any;
  return handleToolRequest(toolName, args);
});

// Tool definitions remain the same...
// Export server and utilities for testing
export { server, dbManager, gitOps };

// Only start server if this is the main module
if (require.main === module) {
  const transport = new StdioServerTransport();
  server.connect(transport);
}