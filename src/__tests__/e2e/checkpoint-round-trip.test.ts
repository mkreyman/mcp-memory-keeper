import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * E2E tests for GitHub issue #37: checkpoints (and their checkpoint_items /
 * checkpoint_files join rows) must survive a context_export -> context_import
 * round trip.
 *
 * Before the fix, exports carried the `checkpoints` rows but not the join rows,
 * and import restored neither — so a re-imported session lost its checkpoints.
 * The 0.5.0 export format adds `checkpointItems` / `checkpointFiles`, and import
 * rewires their foreign keys onto the freshly-generated ids.
 *
 * @see https://github.com/mkreyman/mcp-memory-keeper/issues/37
 */

let serverProcess: ChildProcess | null = null;
let tempDir: string;
let exportsDir: string;
let msgId = 0;
let outputBuffer = '';

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

/** Pull the export file path out of a context_export success message. */
function parseExportPath(exportText: string): string {
  const match = exportText.match(/to:\s*(.+?\.json)/);
  if (!match) throw new Error(`Could not parse export path from: ${exportText}`);
  return match[1];
}

describe('E2E: checkpoint export/import round trip (issue #37)', () => {
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-checkpoint-'));
    exportsDir = path.join(tempDir, 'exports');

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
      clientInfo: { name: 'checkpoint-e2e', version: '1.0.0' },
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

  it('restores a checkpoint and its linked items + files through export -> import', async () => {
    // Seed two items and a cached file in a fresh session.
    await callTool('context_session_start', { name: 'cp-source' });
    await callTool('context_save', { key: 'cp_item_a', value: 'value_a', category: 'task' });
    await callTool('context_save', { key: 'cp_item_b', value: 'value_b', category: 'note' });
    await callTool('context_cache_file', {
      filePath: '/tmp/checkpoint-test.ts',
      content: 'cached file content',
    });

    // Capture a checkpoint that links both items and the file.
    const cpText = await callTool('context_checkpoint', {
      name: 'cp-roundtrip',
      description: 'round trip checkpoint',
      includeFiles: true,
      includeGitStatus: false,
    });
    expect(cpText).toMatch(/Created checkpoint/i);
    expect(cpText).toMatch(/Context items:\s*2/);

    // Export, then import the produced file into a new session.
    const exportText = await callTool('context_export', { confirmEmpty: true });
    const exportPath = parseExportPath(exportText);
    expect(exportPath.startsWith(exportsDir)).toBe(true);

    const importText = await callTool('context_import', { filePath: exportPath });
    expect(importText).toMatch(/Import successful/i);
    // The imported checkpoint must be restored with its links rewired: 2 item
    // links + 1 file link = 3.
    expect(importText).toMatch(/Checkpoints:\s*1.*links restored:\s*3/);

    // End-to-end proof: restoring the checkpoint by name reproduces its items
    // and file (the join rows point at the freshly-imported rows).
    const restoreText = await callTool('context_restore_checkpoint', {
      name: 'cp-roundtrip',
      restoreFiles: true,
    });
    expect(restoreText).toMatch(/Successfully restored from checkpoint/i);
    expect(restoreText).toMatch(/Context items:\s*2/);
    expect(restoreText).toMatch(/Files:\s*1/);
  });

  it('reports legacy exports (no checkpointItems) as not imported, without error', async () => {
    // A 0.4.0-style export: checkpoints present, but no join-row arrays.
    const legacy = path.join(exportsDir, 'legacy-export.json');
    fs.mkdirSync(exportsDir, { recursive: true });
    fs.writeFileSync(
      legacy,
      JSON.stringify({
        version: '0.4.0',
        session: { name: 'legacy', branch: 'main' },
        contextItems: [{ id: 'old-1', key: 'legacy_key', value: 'legacy_value' }],
        fileCache: [],
        checkpoints: [{ id: 'old-cp', session_id: 'old-sess', name: 'legacy-cp' }],
        // no checkpointItems / checkpointFiles keys
      })
    );
    try {
      const text = await callTool('context_import', { filePath: 'legacy-export.json' });
      expect(text).toMatch(/Import successful/i);
      expect(text).toMatch(/Context items:\s*1/);
      expect(text).toMatch(/Checkpoints in file:\s*1 \(not imported/i);
    } finally {
      fs.rmSync(legacy, { force: true });
    }
  });

  it('drops checkpoint links that point at skipped/absent rows', async () => {
    // 0.5.0 export with a checkpoint whose item link references an id that is
    // not present in contextItems — the checkpoint imports, the dangling link
    // is dropped, and the import does not error.
    const partial = path.join(exportsDir, 'partial-cp.json');
    fs.mkdirSync(exportsDir, { recursive: true });
    fs.writeFileSync(
      partial,
      JSON.stringify({
        version: '0.5.0',
        session: { name: 'partial', branch: 'main' },
        contextItems: [{ id: 'item-1', key: 'k1', value: 'v1' }],
        fileCache: [],
        checkpoints: [{ id: 'cp-1', session_id: 's', name: 'partial-cp' }],
        checkpointItems: [
          { id: 'l1', checkpoint_id: 'cp-1', context_item_id: 'item-1' }, // valid
          { id: 'l2', checkpoint_id: 'cp-1', context_item_id: 'missing' }, // dangling
        ],
        checkpointFiles: [],
      })
    );
    try {
      const text = await callTool('context_import', { filePath: 'partial-cp.json' });
      expect(text).toMatch(/Import successful/i);
      // 1 checkpoint, only the 1 valid link restored.
      expect(text).toMatch(/Checkpoints:\s*1.*links restored:\s*1/);
    } finally {
      fs.rmSync(partial, { force: true });
    }
  });
});
