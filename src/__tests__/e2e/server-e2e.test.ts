import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * End-to-end tests for the MCP Memory Keeper server.
 *
 * These tests spawn the actual server process over stdio, send real MCP
 * protocol messages, and validate the responses. Unlike integration tests
 * that instantiate internal classes directly, these exercise the full stack:
 * transport → protocol → handler → database → response.
 *
 * @see https://github.com/mkreyman/mcp-memory-keeper/issues/33
 */

// Valid JSON Schema types per the spec
const VALID_JSON_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
]);

let serverProcess: ChildProcess | null = null;
let tempDir: string;
let msgId = 0;
let outputBuffer = '';

/** Send a JSON-RPC message to the server and wait for a response with the matching id. */
function sendRequest(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
    }, timeoutMs);

    const onData = (data: Buffer) => {
      outputBuffer += data.toString();
      const lines = outputBuffer.split('\n');
      // Keep the last incomplete line in the buffer
      outputBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timeout);
            serverProcess?.stdout?.removeListener('data', onData);
            resolve(msg);
          }
        } catch {
          // Not JSON, skip
        }
      }
    };

    serverProcess?.stdout?.on('data', onData);
    serverProcess?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n');
  });
}

/**
 * Recursively validate a JSON Schema property definition.
 * Returns an array of human-readable violation strings.
 */
function validateSchemaProperty(
  prop: Record<string, any>,
  path: string,
  toolName: string
): string[] {
  const violations: string[] = [];

  // Every property should have a type
  if (!prop.type) {
    violations.push(`${toolName}: ${path} — missing 'type'`);
    return violations; // Can't validate further without type
  }

  // Type must be a valid JSON Schema type
  if (!VALID_JSON_SCHEMA_TYPES.has(prop.type)) {
    violations.push(`${toolName}: ${path} — invalid type '${prop.type}'`);
  }

  // Arrays must have items
  if (prop.type === 'array' && !prop.items) {
    violations.push(`${toolName}: ${path} — type 'array' missing 'items'`);
  }

  // If enum is present, values should match the declared type
  if (prop.enum && prop.type) {
    for (const val of prop.enum) {
      if (prop.type === 'string' && typeof val !== 'string') {
        violations.push(`${toolName}: ${path} — enum value '${val}' is not a string`);
      }
      if (prop.type === 'number' && typeof val !== 'number') {
        violations.push(`${toolName}: ${path} — enum value '${val}' is not a number`);
      }
    }
  }

  // Required must reference existing properties
  if (prop.type === 'object' && prop.required && prop.properties) {
    for (const req of prop.required) {
      if (!(req in prop.properties)) {
        violations.push(`${toolName}: ${path} — required field '${req}' not found in properties`);
      }
    }
  }

  // Recurse into object properties
  if (prop.type === 'object' && prop.properties) {
    for (const [key, value] of Object.entries(prop.properties)) {
      violations.push(
        ...validateSchemaProperty(value as Record<string, any>, `${path}.${key}`, toolName)
      );
    }
  }

  // Recurse into array items
  if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
    violations.push(
      ...validateSchemaProperty(prop.items as Record<string, any>, `${path}.items`, toolName)
    );
  }

  return violations;
}

describe('MCP Server E2E Tests', () => {
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-'));

    serverProcess = spawn('node', [path.join(__dirname, '../../../dist/index.js')], {
      env: { ...process.env, DATA_DIR: tempDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if ((global as any).testProcesses) {
      (global as any).testProcesses.push(serverProcess);
    }

    // Initialize the MCP session
    const initResponse = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0.0' },
    });

    expect(initResponse.result).toHaveProperty('protocolVersion');

    // Send initialized notification (no response expected)
    serverProcess?.stdin?.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );

    // Brief pause for server to process the notification
    await new Promise(resolve => setTimeout(resolve, 200));
  }, 10000);

  afterAll(async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          serverProcess?.kill('SIGKILL');
          resolve();
        }, 3000);
        serverProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      serverProcess?.removeAllListeners();
    }
    serverProcess = null;

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ─── ListTools Schema Validation ────────────────────────────────────

  describe('tools/list — schema validation', () => {
    let tools: any[];

    beforeAll(async () => {
      const response = await sendRequest('tools/list');
      expect(response.result).toHaveProperty('tools');
      tools = response.result.tools;
    });

    it('should return a non-empty list of tools', () => {
      expect(tools.length).toBeGreaterThan(0);
    });

    it('every tool should have name, description, and inputSchema', () => {
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });

    it('every tool name should follow the context_ convention', () => {
      for (const tool of tools) {
        expect(tool.name).toMatch(/^context_[a-z_]+$/);
      }
    });

    it('every inputSchema should be type object with properties', () => {
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema).toHaveProperty('properties');
        expect(typeof tool.inputSchema.properties).toBe('object');
      }
    });

    it('no tool names should be duplicated', () => {
      const names = tools.map((t: any) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('every array property should have items declared (issue #33)', () => {
      const violations: string[] = [];
      for (const tool of tools) {
        violations.push(
          ...validateSchemaProperty(tool.inputSchema, 'inputSchema', tool.name).filter(v =>
            v.includes("missing 'items'")
          )
        );
      }
      expect(violations).toHaveLength(0);
    });

    it('every property type should be a valid JSON Schema type', () => {
      const violations: string[] = [];
      for (const tool of tools) {
        violations.push(
          ...validateSchemaProperty(tool.inputSchema, 'inputSchema', tool.name).filter(v =>
            v.includes('invalid type')
          )
        );
      }
      expect(violations).toHaveLength(0);
    });

    it('every required field should reference an existing property', () => {
      const violations: string[] = [];
      for (const tool of tools) {
        violations.push(
          ...validateSchemaProperty(tool.inputSchema, 'inputSchema', tool.name).filter(v =>
            v.includes('not found in properties')
          )
        );
      }
      expect(violations).toHaveLength(0);
    });

    it('enum values should match their declared type', () => {
      const violations: string[] = [];
      for (const tool of tools) {
        violations.push(
          ...validateSchemaProperty(tool.inputSchema, 'inputSchema', tool.name).filter(v =>
            v.includes('enum value')
          )
        );
      }
      expect(violations).toHaveLength(0);
    });

    it('full schema validation should find zero violations across all tools', () => {
      const allViolations: string[] = [];
      for (const tool of tools) {
        allViolations.push(...validateSchemaProperty(tool.inputSchema, 'inputSchema', tool.name));
      }
      if (allViolations.length > 0) {
        throw new Error(
          `Found ${allViolations.length} schema violation(s):\n${allViolations.map(v => `  ${v}`).join('\n')}`
        );
      }
    });
  });

  // ─── Tool Call Smoke Tests ──────────────────────────────────────────

  describe('tools/call — smoke tests', () => {
    it('should save and retrieve a context item', async () => {
      // Save
      const saveResponse = await sendRequest('tools/call', {
        name: 'context_save',
        arguments: {
          key: 'e2e_test_key',
          value: 'e2e_test_value',
          category: 'note',
        },
      });

      expect(saveResponse.result).toHaveProperty('content');
      const saveText = saveResponse.result.content[0].text;
      expect(saveText).toContain('e2e_test_key');

      // Retrieve
      const getResponse = await sendRequest('tools/call', {
        name: 'context_get',
        arguments: { key: 'e2e_test_key' },
      });

      expect(getResponse.result).toHaveProperty('content');
      const getResult = JSON.parse(getResponse.result.content[0].text);
      expect(getResult.items).toBeDefined();
      expect(getResult.items.length).toBeGreaterThan(0);
      expect(getResult.items[0].value).toBe('e2e_test_value');
    });

    it('should search for saved items', async () => {
      const response = await sendRequest('tools/call', {
        name: 'context_search',
        arguments: { query: 'e2e_test' },
      });

      expect(response.result).toHaveProperty('content');
      const text = response.result.content[0].text;
      expect(text).toContain('e2e_test');
    });

    it('should return status', async () => {
      const response = await sendRequest('tools/call', {
        name: 'context_status',
        arguments: {},
      });

      expect(response.result).toHaveProperty('content');
      const text = response.result.content[0].text;
      // Status response contains session info regardless of format
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/session|item/i);
    });

    it('should reject unknown tools with an error', async () => {
      const response = await sendRequest('tools/call', {
        name: 'nonexistent_tool',
        arguments: {},
      });

      // MCP SDK wraps handler errors
      expect(response.error || response.result?.isError).toBeTruthy();
    });

    it('should handle missing required arguments gracefully', async () => {
      const response = await sendRequest('tools/call', {
        name: 'context_save',
        arguments: {},
      });

      expect(response.result).toHaveProperty('content');
      const text = response.result.content[0].text;
      // Should return an error message, not crash
      expect(text.toLowerCase()).toMatch(/error|required|key/i);
    });
  });

  // ─── Tool Profile Filtering ────────────────────────────────────────

  describe('tool profile filtering', () => {
    it('default profile should expose all tools', async () => {
      const response = await sendRequest('tools/list');
      // Default is "full" profile with 38 tools
      expect(response.result.tools.length).toBe(38);
    });
  });
});
