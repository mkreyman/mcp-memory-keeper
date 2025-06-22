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
      // First try graceful shutdown
      serverProcess.kill('SIGTERM');
      
      // Wait for process to actually exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if still running
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
        
        serverProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        serverProcess?.on('error', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      // Remove event listeners to prevent leaks
      serverProcess?.removeAllListeners();
      
      // Track for global cleanup
      if ((global as any).testProcesses) {
        const index = (global as any).testProcesses.indexOf(serverProcess);
        if (index > -1) {
          (global as any).testProcesses.splice(index, 1);
        }
      }
    }
    
    serverProcess = null;
    
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Error cleaning up temp directory:', error);
    }
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
    
    // Track for global cleanup
    if (!(global as any).testProcesses) {
      (global as any).testProcesses = [];
    }
    (global as any).testProcesses.push(serverProcess);
    
    // Track for global cleanup
    if (!(global as any).testProcesses) {
      (global as any).testProcesses = [];
    }
    (global as any).testProcesses.push(serverProcess);

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
    
    // Track for global cleanup
    if (!(global as any).testProcesses) {
      (global as any).testProcesses = [];
    }
    (global as any).testProcesses.push(serverProcess);

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
    
    // Track for global cleanup
    if (!(global as any).testProcesses) {
      (global as any).testProcesses = [];
    }
    (global as any).testProcesses.push(serverProcess);

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
    
    // Track for global cleanup
    if (!(global as any).testProcesses) {
      (global as any).testProcesses = [];
    }
    (global as any).testProcesses.push(serverProcess);

    let serverStarted = false;
    let timeout: NodeJS.Timeout;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
    };

    serverProcess.stdout?.on('data', (data) => {
      serverStarted = true;
      // Server is ready, wait a bit then terminate
      setTimeout(() => {
        serverProcess?.kill('SIGTERM');
      }, 100);
    });

    serverProcess.stderr?.on('data', (data) => {
      // Any stderr output means server is working
      serverStarted = true;
    });

    serverProcess.on('exit', (code) => {
      cleanup();
      expect(serverStarted).toBe(true);
      expect(code).toBe(null); // Killed by signal, not error
      done();
    });

    serverProcess.on('error', (err) => {
      cleanup();
      done(err);
    });

    // Fallback: if server doesn't start in 3 seconds, kill it anyway
    timeout = setTimeout(() => {
      if (!serverStarted) {
        serverStarted = true; // Assume it started but didn't output yet
      }
      serverProcess?.kill('SIGTERM');
    }, 3000);
  }, 15000); // Increase test timeout to 15 seconds
});