import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Security regression tests for GitHub issue #35:
 * "Arbitrary Local File Read via Unvalidated context_import.filePath".
 *
 * Before the fix, context_import passed the caller-supplied filePath straight
 * to fs.readFileSync, so an MCP client (or a prompt-injected agent) could read
 * any file the server process could read — full contents for any JSON file, and
 * the leading bytes of any other file (echoed back inside the JSON.parse error).
 *
 * These tests spawn the real server over stdio and assert that:
 *   1. Absolute paths outside the exports directory are rejected.
 *   2. `..` traversal is rejected.
 *   3. Non-JSON system files (e.g. /etc/passwd) are rejected without leaking
 *      any of their bytes in the error message.
 *   4. The secret in a rejected JSON file never becomes retrievable.
 *   5. The legitimate export -> import round trip (inside the exports dir)
 *      still works.
 *
 * @see https://github.com/mkreyman/mcp-memory-keeper/issues/35
 */

let serverProcess: ChildProcess | null = null;
let tempDir: string;
let exportsDir: string;
let victimPath: string;
let msgId = 0;
let outputBuffer = '';

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const SECRET_KEY = 'AWS_SECRET_ACCESS_KEY';

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

function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  return sendRequest('tools/call', { name, arguments: args }).then(
    res => res.result?.content?.[0]?.text ?? JSON.stringify(res)
  );
}

describe('Security: context_import path confinement (issue #35)', () => {
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-import-sec-'));
    // Default exports dir is <DATA_DIR>/exports.
    exportsDir = path.join(tempDir, 'exports');

    // A "victim" JSON file OUTSIDE the exports directory (but inside the data
    // dir) — proves confinement is to the exports dir, not just the data dir.
    victimPath = path.join(tempDir, 'victim_export.json');
    fs.writeFileSync(
      victimPath,
      JSON.stringify({
        session: { name: 'victims-private-session', branch: 'main' },
        contextItems: [
          {
            key: SECRET_KEY,
            value: SECRET,
            category: 'secret',
            priority: 'high',
            created_at: new Date(0).toISOString(),
          },
        ],
        fileCache: [],
      })
    );

    serverProcess = spawn('node', [path.join(__dirname, '../../../dist/index.js')], {
      env: { ...process.env, DATA_DIR: tempDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if ((global as any).testProcesses) {
      (global as any).testProcesses.push(serverProcess);
    }

    const initResponse = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'import-sec-test', version: '1.0.0' },
    });
    expect(initResponse.result).toHaveProperty('protocolVersion');

    serverProcess?.stdin?.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );
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

  it('rejects an absolute path to a JSON file outside the exports directory', async () => {
    const text = await callTool('context_import', { filePath: victimPath });
    expect(text).toMatch(/Import failed/i);
    expect(text).toMatch(/not found in the exports directory/i);
    // The secret must never appear in the response.
    expect(text).not.toContain(SECRET);
  });

  it('returns the same message for a missing path and an existing outside path (no existence oracle)', async () => {
    // A file that exists outside the exports dir and a path that does not exist
    // at all must be indistinguishable, so the error cannot be used to probe
    // for the existence of arbitrary files on the host.
    const missing = await callTool('context_import', { filePath: '/no/such/file/anywhere.json' });
    const existsOutside = await callTool('context_import', { filePath: victimPath });
    const strip = (t: string) => t.replace(/^Import failed:\s*/i, '').trim();
    expect(strip(existsOutside)).toBe(strip(missing));
    // And neither echoes the resolved exports-directory absolute path.
    expect(existsOutside).not.toContain(exportsDir);
  });

  it('does not make the rejected file’s secret retrievable via context_get', async () => {
    const text = await callTool('context_get', { key: SECRET_KEY });
    expect(text).not.toContain(SECRET);
  });

  // Use an explicit conditional skip (not a bare `return`) so the platform gap
  // is visible in the test report on systems without /etc/passwd.
  const hasEtcPasswd = fs.existsSync('/etc/passwd');
  (hasEtcPasswd ? it : it.skip)(
    'rejects a non-JSON system file without leaking its bytes',
    async () => {
      const text = await callTool('context_import', { filePath: '/etc/passwd' });
      expect(text).toMatch(/Import failed/i);
      // The classic leak was "Unexpected token 'r', "root:x:0:0"...". Ensure no
      // file bytes are reflected back.
      expect(text).not.toMatch(/root:/);
      expect(text).not.toMatch(/Unexpected token/);
    }
  );

  it('rejects `..` traversal out of the exports directory', async () => {
    const text = await callTool('context_import', {
      filePath: '../../../../../../etc/hostname',
    });
    expect(text).toMatch(/Import failed/i);
    expect(text).not.toMatch(/Unexpected token/);
  });

  it('rejects a symlink inside the exports dir that points outside it', async () => {
    // realpathSync must resolve the symlink to its target before the
    // confinement check, so an inside-the-dir symlink cannot escape.
    const linkPath = path.join(exportsDir, 'escape.json');
    try {
      fs.symlinkSync(victimPath, linkPath);
    } catch (e) {
      // Only treat a genuine platform restriction as "skip"; surface anything else.
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'EACCES') {
        return;
      }
      throw e;
    }
    try {
      const text = await callTool('context_import', { filePath: 'escape.json' });
      expect(text).toMatch(/Import failed/i);
      expect(text).toMatch(/not found in the exports directory/i);
      expect(text).not.toContain(SECRET);
    } finally {
      fs.unlinkSync(linkPath);
    }
  });

  it('rejects a sibling directory whose name shares the exports-dir prefix', async () => {
    // Guards the `startsWith(exportsDirReal + path.sep)` boundary: a sibling
    // like "<exportsDir>-evil" must NOT be treated as inside the exports dir.
    const evilDir = `${exportsDir}-evil`;
    fs.mkdirSync(evilDir, { recursive: true });
    const evilFile = path.join(evilDir, 'data.json');
    fs.writeFileSync(evilFile, JSON.stringify({ session: { name: 'x' }, contextItems: [] }));
    try {
      const text = await callTool('context_import', { filePath: evilFile });
      expect(text).toMatch(/Import failed/i);
      expect(text).toMatch(/not found in the exports directory/i);
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });

  it('rejects an empty filePath', async () => {
    const text = await callTool('context_import', { filePath: '' });
    expect(text).toMatch(/Import failed/i);
    expect(text).toMatch(/non-empty string/i);
  });

  it('rejects a non-string filePath', async () => {
    const text = await callTool('context_import', { filePath: 12345 as unknown as string });
    expect(text).toMatch(/Import failed/i);
    expect(text).toMatch(/non-empty string/i);
  });

  it('rejects the exports directory itself (not a regular file)', async () => {
    const text = await callTool('context_import', { filePath: exportsDir });
    expect(text).toMatch(/Import failed/i);
    expect(text).toMatch(/regular file/i);
  });

  it('rejects a confined file that is valid JSON but not an export', async () => {
    const notExport = path.join(exportsDir, 'not-an-export.json');
    fs.writeFileSync(notExport, JSON.stringify({ hello: 'world' }));
    try {
      const text = await callTool('context_import', { filePath: 'not-an-export.json' });
      expect(text).toMatch(/Import failed/i);
      expect(text).toMatch(/not a valid memory-keeper export/i);
    } finally {
      fs.rmSync(notExport, { force: true });
    }
  });

  it('still supports the legitimate export -> import round trip and preserves data', async () => {
    // Seed a context item, export it (lands inside the exports dir), then
    // import the produced file back.
    await callTool('context_save', {
      key: 'roundtrip_key',
      value: 'roundtrip_value',
      category: 'note',
    });

    const exportText = await callTool('context_export', { confirmEmpty: true });
    // `.+?\.json` (with `.` not matching newlines) tolerates spaces in the
    // path, unlike `\S+`.
    const match = exportText.match(/to:\s*(.+?\.json)/);
    expect(match).toBeTruthy();
    const exportPath = match![1];
    // Export must write inside the exports directory.
    expect(exportPath.startsWith(exportsDir)).toBe(true);

    const importText = await callTool('context_import', { filePath: exportPath });
    expect(importText).toMatch(/Import successful/i);
    // A regression that silently dropped every item would still say "successful";
    // assert at least one item was imported AND that the value is retrievable.
    expect(importText).toMatch(/Context items:\s*[1-9]/);
    const getResult = await callTool('context_get', { key: 'roundtrip_key' });
    expect(getResult).toContain('roundtrip_value');
  });

  it('skips malformed items but imports the valid ones and reports the skip count', async () => {
    // A confined, well-formed export envelope with one good item and several
    // malformed ones: the good item imports, the bad ones are skipped (not
    // silently — the count is surfaced), and nothing aborts the transaction.
    const mixed = path.join(exportsDir, 'mixed.json');
    fs.writeFileSync(
      mixed,
      JSON.stringify({
        session: { name: 'mixed', branch: 'main' },
        contextItems: [
          { key: 'good_key', value: 'good_value', category: 'note', priority: 'high' },
          { key: 'no_value' }, // missing value -> skipped
          { value: 'no_key' }, // missing key -> skipped
          'not-an-object', // not an object -> skipped
        ],
        fileCache: [],
      })
    );
    try {
      const text = await callTool('context_import', { filePath: 'mixed.json' });
      expect(text).toMatch(/Import successful/i);
      expect(text).toMatch(/Context items:\s*1\s*\(skipped 3 malformed\)/);
      const getResult = await callTool('context_get', { key: 'good_key' });
      expect(getResult).toContain('good_value');
    } finally {
      fs.rmSync(mixed, { force: true });
    }
  });
});
