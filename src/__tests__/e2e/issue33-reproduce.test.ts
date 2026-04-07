import { describe, it, expect, afterAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Issue #33 reproduction test.
 *
 * Reproduces the exact scenario reported: spawn the MCP server with each
 * tool profile (minimal, standard, full), call tools/list, and validate
 * that every returned tool schema passes strict JSON Schema validation
 * that OpenAI-compatible providers enforce.
 *
 * The reporter found:
 *   - minimal: works
 *   - standard: works
 *   - full: fails (context_delegate.input.insights missing items)
 *
 * After the fix, all three profiles must pass.
 *
 * @see https://github.com/mkreyman/mcp-memory-keeper/issues/33
 */

/**
 * Strict schema validation matching what OpenAI-compatible providers enforce.
 * Returns violation strings. Empty array = valid.
 */
function strictValidateSchema(prop: Record<string, any>, path: string, toolName: string): string[] {
  const violations: string[] = [];

  if (!prop.type) {
    violations.push(`${toolName}: ${path} — missing 'type'`);
    return violations;
  }

  // Arrays MUST have items (the exact bug from issue #33)
  if (prop.type === 'array' && !prop.items) {
    violations.push(`${toolName}: ${path} — array missing 'items' (issue #33)`);
  }

  // Enum values must match declared type
  if (prop.enum && prop.type === 'string') {
    for (const val of prop.enum) {
      if (typeof val !== 'string') {
        violations.push(`${toolName}: ${path} — enum value '${val}' is not a string`);
      }
    }
  }

  // Required fields must exist in properties
  if (prop.type === 'object' && prop.required && prop.properties) {
    for (const req of prop.required) {
      if (!(req in prop.properties)) {
        violations.push(`${toolName}: ${path} — required '${req}' not in properties`);
      }
    }
  }

  // Recurse into object properties
  if (prop.type === 'object' && prop.properties) {
    for (const [key, value] of Object.entries(prop.properties)) {
      violations.push(
        ...strictValidateSchema(value as Record<string, any>, `${path}.${key}`, toolName)
      );
    }
  }

  // Recurse into array items
  if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
    violations.push(
      ...strictValidateSchema(prop.items as Record<string, any>, `${path}.items`, toolName)
    );
  }

  return violations;
}

/**
 * Spawn a server with a given TOOL_PROFILE, call tools/list, return the tools.
 */
async function getToolsForProfile(
  profile: string
): Promise<{ tools: any[]; process: ChildProcess; tempDir: string }> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-issue33-${profile}-`));

  const proc = spawn('node', [path.join(__dirname, '../../../dist/index.js')], {
    env: { ...process.env, DATA_DIR: tempDir, TOOL_PROFILE: profile },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if ((global as any).testProcesses) {
    (global as any).testProcesses.push(proc);
  }

  let msgId = 0;
  let outputBuffer = '';

  const sendRequest = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      const timeout = setTimeout(
        () => reject(new Error(`Timeout: ${method} on ${profile}`)),
        10000
      );

      const onData = (data: Buffer) => {
        outputBuffer += data.toString();
        const lines = outputBuffer.split('\n');
        outputBuffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id === id) {
              clearTimeout(timeout);
              proc.stdout?.removeListener('data', onData);
              resolve(msg);
            }
          } catch {
            // skip
          }
        }
      };

      proc.stdout?.on('data', onData);
      proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n');
    });
  };

  // Initialize
  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'issue33-repro', version: '1.0.0' },
  });

  proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await new Promise(resolve => setTimeout(resolve, 200));

  // Get tools
  const response = await sendRequest('tools/list');
  return { tools: response.result.tools, process: proc, tempDir };
}

const profiles = ['minimal', 'standard', 'full'] as const;
const servers: Array<{ process: ChildProcess; tempDir: string }> = [];

describe('Issue #33 reproduction: all profiles must pass strict schema validation', () => {
  afterAll(async () => {
    for (const server of servers) {
      if (server.process && !server.process.killed) {
        server.process.kill('SIGTERM');
        await new Promise<void>(resolve => {
          const timeout = setTimeout(() => {
            server.process?.kill('SIGKILL');
            resolve();
          }, 3000);
          server.process?.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
        server.process?.removeAllListeners();
      }
      try {
        fs.rmSync(server.tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  for (const profile of profiles) {
    describe(`TOOL_PROFILE=${profile}`, () => {
      let tools: any[];

      beforeAll(async () => {
        const result = await getToolsForProfile(profile);
        tools = result.tools;
        servers.push({ process: result.process, tempDir: result.tempDir });
      }, 15000);

      it('should return tools', () => {
        expect(tools.length).toBeGreaterThan(0);
      });

      it('all tool schemas should pass strict validation', () => {
        const allViolations: string[] = [];
        for (const tool of tools) {
          allViolations.push(...strictValidateSchema(tool.inputSchema, 'inputSchema', tool.name));
        }
        if (allViolations.length > 0) {
          throw new Error(
            `Profile "${profile}" has ${allViolations.length} schema violation(s):\n` +
              allViolations.map(v => `  ${v}`).join('\n')
          );
        }
      });

      it('specifically: no array property should be missing items', () => {
        const arrayViolations: string[] = [];
        for (const tool of tools) {
          arrayViolations.push(
            ...strictValidateSchema(tool.inputSchema, 'inputSchema', tool.name).filter(v =>
              v.includes('missing')
            )
          );
        }
        expect(arrayViolations).toHaveLength(0);
      });
    });
  }

  // The reporter specifically bisected these tools
  describe('reporter-flagged tools', () => {
    let fullTools: any[];

    beforeAll(async () => {
      const result = await getToolsForProfile('full');
      fullTools = result.tools;
      servers.push({ process: result.process, tempDir: result.tempDir });
    }, 15000);

    const flaggedTools = [
      'context_delegate',
      'context_find_related',
      'context_visualize',
      'context_branch_session',
    ];

    for (const toolName of flaggedTools) {
      it(`${toolName} should pass strict schema validation`, () => {
        const tool = fullTools.find((t: any) => t.name === toolName);
        expect(tool).toBeDefined();

        const violations = strictValidateSchema(tool.inputSchema, 'inputSchema', toolName);
        expect(violations).toHaveLength(0);
      });
    }
  });
});
