import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { DatabaseManager } from '../../utils/database.js';
import { GitOperations } from '../../utils/git.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export class TestServer {
  server: Server;
  dbManager: DatabaseManager;
  gitOps: GitOperations;
  tempDbPath: string;

  constructor() {
    // Create temporary database for testing
    this.tempDbPath = path.join(os.tmpdir(), `test-mcp-${Date.now()}.db`);

    this.dbManager = new DatabaseManager({
      filename: this.tempDbPath,
      maxSize: 10 * 1024 * 1024, // 10MB
      walMode: true,
    });

    this.gitOps = new GitOperations(os.tmpdir());

    // Import and configure the server logic here
    // For now, we'll create a minimal server for testing
    this.server = new Server(
      {
        name: 'test-memory-keeper',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  async callTool(name: string, args: any): Promise<any> {
    // This would call the actual tool handler
    // For now, returning a mock response
    return {
      content: [
        {
          type: 'text',
          text: `Called ${name} with ${JSON.stringify(args)}`,
        },
      ],
    };
  }

  cleanup(): void {
    this.dbManager.close();
    try {
      fs.unlinkSync(this.tempDbPath);
      fs.unlinkSync(`${this.tempDbPath}-wal`);
      fs.unlinkSync(`${this.tempDbPath}-shm`);
    } catch (_e) {
      // Ignore
    }
  }
}
