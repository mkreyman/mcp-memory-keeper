import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// Initialize database
const db = new Database('context.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS context_items (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create MCP server
const server = new Server(
  {
    name: 'memory-keeper',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool: Save context
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'context_save') {
    const { key, value } = request.params.arguments as { key: string; value: string };
    
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO context_items (id, key, value) VALUES (?, ?, ?)'
    );
    stmt.run(uuidv4(), key, value);
    
    return {
      content: [
        {
          type: 'text',
          text: `Saved: ${key}`,
        },
      ],
    };
  }
  
  if (request.params.name === 'context_get') {
    const { key } = request.params.arguments as { key: string };
    
    const row = db.prepare('SELECT value FROM context_items WHERE key = ?').get(key) as any;
    
    return {
      content: [
        {
          type: 'text',
          text: row ? row.value : 'Not found',
        },
      ],
    };
  }
  
  throw new Error(`Unknown tool: ${request.params.name}`);
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'context_save',
        description: 'Save a context item',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'context_get',
        description: 'Get a context item',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
          },
          required: ['key'],
        },
      },
    ],
  };
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);