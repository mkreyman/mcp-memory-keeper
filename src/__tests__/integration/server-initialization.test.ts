import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Server Initialization Tests', () => {
  let tempDir: string;
  let serverProcess: ChildProcess | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  });

  afterEach(async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
      // Wait a bit for process to terminate
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should start server and respond to initialize request', (done) => {
    const dbPath = path.join(tempDir, 'test.db');
    
    // Start the server
    serverProcess = spawn('node', [path.join(__dirname, '../../../dist/index.js')], {
      env: {
        ...process.env,
        MCP_DB_PATH: dbPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let initialized = false;

    serverProcess.stdout?.on('data', (data) => {
      output += data.toString();
      
      // Look for initialization response
      const lines = output.split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            initialized = true;
            expect(msg.result).toHaveProperty('protocolVersion');
            expect(msg.result).toHaveProperty('capabilities');
            done();
          }
        } catch (e) {
          // Not JSON, continue
        }
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error('Server error:', data.toString());
    });

    // Send initialization request
    setTimeout(() => {
      serverProcess?.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        },
        id: 1
      }) + '\n');
    }, 500);

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!initialized) {
        done(new Error('Server did not initialize within timeout'));
      }
    }, 5000);
  });

  it('should create database file on startup', (done) => {
    const dbPath = path.join(tempDir, 'context.db');
    
    // Change to temp directory
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Start the server
    serverProcess = spawn('node', [path.join(__dirname, '../../../dist/index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for server to start
    setTimeout(() => {
      // Check if database file was created
      expect(fs.existsSync(dbPath)).toBe(true);
      
      // Check if it's a valid SQLite database
      const header = fs.readFileSync(dbPath).slice(0, 16).toString();
      expect(header).toBe('SQLite format 3\x00');
      
      process.chdir(originalCwd);
      done();
    }, 1000);
  });

  it('should handle invalid requests gracefully', (done) => {
    const dbPath = path.join(tempDir, 'test.db');
    
    serverProcess = spawn('node', [path.join(__dirname, '../../../dist/index.js')], {
      env: {
        ...process.env,
        MCP_DB_PATH: dbPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errorReceived = false;

    serverProcess.stdout?.on('data', (data) => {
      output += data.toString();
      
      const lines = output.split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.error) {
            errorReceived = true;
            expect(msg.error).toHaveProperty('code');
            expect(msg.error).toHaveProperty('message');
            done();
          }
        } catch (e) {
          // Not JSON, continue
        }
      }
    });

    // Send invalid request after initialization
    setTimeout(() => {
      // Initialize first
      serverProcess?.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
        },
        id: 1
      }) + '\n');

      // Then send invalid request
      setTimeout(() => {
        serverProcess?.stdin?.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'non_existent_tool',
            arguments: {}
          },
          id: 2
        }) + '\n');
      }, 500);
    }, 500);

    // Timeout
    setTimeout(() => {
      if (!errorReceived) {
        done(new Error('Server did not return error for invalid request'));
      }
    }, 5000);
  });

  it('should handle server shutdown gracefully', (done) => {
    const dbPath = path.join(tempDir, 'test.db');
    
    serverProcess = spawn('node', [path.join(__dirname, '../../../dist/index.js')], {
      env: {
        ...process.env,
        MCP_DB_PATH: dbPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let serverStarted = false;

    serverProcess.stdout?.on('data', () => {
      serverStarted = true;
    });

    serverProcess.on('exit', (code) => {
      expect(serverStarted).toBe(true);
      expect(code).toBe(null); // Killed by signal, not error
      done();
    });

    // Wait for server to start then kill it
    setTimeout(() => {
      serverProcess?.kill('SIGTERM');
    }, 1000);
  });
});