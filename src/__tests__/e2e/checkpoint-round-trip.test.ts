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
 * The round-trip test imports into a SEPARATE server instance (its own
 * DATA_DIR), so the only checkpoint named "cp-roundtrip" is the imported one —
 * otherwise context_restore_checkpoint (which matches by name across all
 * checkpoints) could resolve the original source checkpoint and mask a broken
 * import.
 *
 * @see https://github.com/mkreyman/mcp-memory-keeper/issues/37
 */

const SERVER_ENTRY = path.join(__dirname, '../../../dist/index.js');

/** A connected MCP server process with isolated JSON-RPC framing. */
interface Client {
  proc: ChildProcess;
  dataDir: string;
  exportsDir: string;
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
  close: () => Promise<void>;
}

async function startServer(): Promise<Client> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-checkpoint-'));
  const exportsDir = path.join(dataDir, 'exports');
  const proc = spawn('node', [SERVER_ENTRY], {
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if ((global as any).testProcesses) {
    (global as any).testProcesses.push(proc);
  }

  let buffer = '';
  let nextId = 0;

  const send = (method: string, params: Record<string, unknown>, id?: number): Promise<any> =>
    new Promise((resolve, reject) => {
      const reqId = id ?? ++nextId;
      const timeout = setTimeout(() => {
        proc.stdout?.removeListener('data', onData);
        reject(new Error(`Timeout waiting for ${method} (id=${reqId})`));
      }, 5000);

      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id === reqId) {
              clearTimeout(timeout);
              proc.stdout?.removeListener('data', onData);
              resolve(msg);
            }
          } catch {
            // not JSON for us
          }
        }
      };

      proc.stdout?.on('data', onData);
      proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params, id: reqId }) + '\n');
    });

  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'checkpoint-e2e', version: '1.0.0' },
  });
  expect(init.result).toHaveProperty('protocolVersion');
  proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await new Promise(resolve => setTimeout(resolve, 150));

  const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const res = await send('tools/call', { name, arguments: args });
    return res.result?.content?.[0]?.text ?? JSON.stringify(res);
  };

  const close = async (): Promise<void> => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
      await new Promise<void>(resolve => {
        const t = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, 3000);
        proc.on('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
      proc.removeAllListeners();
    }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return { proc, dataDir, exportsDir, call, close };
}

/** Pull the export file path out of a context_export success message. */
function parseExportPath(exportText: string): string {
  const match = exportText.match(/to:\s*(.+?\.json)/);
  if (!match) throw new Error(`Could not parse export path from: ${exportText}`);
  return match[1];
}

describe('E2E: checkpoint export/import round trip (issue #37)', () => {
  let server: Client;

  beforeAll(async () => {
    server = await startServer();
  }, 15000);

  afterAll(async () => {
    await server?.close();
  });

  it('restores a checkpoint and its linked items + files into a clean instance', async () => {
    // --- Source instance: seed, checkpoint, export ---
    await server.call('context_session_start', { name: 'cp-source' });
    await server.call('context_save', { key: 'cp_item_a', value: 'value_a', category: 'task' });
    await server.call('context_save', { key: 'cp_item_b', value: 'value_b', category: 'note' });
    await server.call('context_cache_file', {
      filePath: '/tmp/checkpoint-test.ts',
      content: 'cached file content',
    });

    const cpText = await server.call('context_checkpoint', {
      name: 'cp-roundtrip',
      description: 'round trip checkpoint',
      includeFiles: true,
      includeGitStatus: false,
    });
    expect(cpText).toMatch(/Created checkpoint/i);
    expect(cpText).toMatch(/Context items:\s*2/);

    const exportText = await server.call('context_export', { confirmEmpty: true });
    const exportPath = parseExportPath(exportText);
    const exportBytes = fs.readFileSync(exportPath);

    // --- Fresh instance: import the file, so the imported checkpoint is the
    // ONLY one named "cp-roundtrip" (unambiguous restore-by-name). ---
    const importer = await startServer();
    try {
      fs.mkdirSync(importer.exportsDir, { recursive: true });
      const importFile = path.join(importer.exportsDir, 'incoming.json');
      fs.writeFileSync(importFile, exportBytes);

      const importText = await importer.call('context_import', { filePath: 'incoming.json' });
      expect(importText).toMatch(/Import successful/i);
      expect(importText).toMatch(/Context items:\s*2/);
      // 2 item links + 1 file link = 3, none dropped.
      expect(importText).toMatch(/Checkpoints:\s*1, links restored:\s*3$/m);

      // End-to-end proof: restoring reproduces the items AND the file, which can
      // only be true if the join rows were rewired onto the freshly-imported
      // rows in THIS instance.
      const restoreText = await importer.call('context_restore_checkpoint', {
        name: 'cp-roundtrip',
        restoreFiles: true,
      });
      expect(restoreText).toMatch(/Successfully restored from checkpoint/i);
      expect(restoreText).toMatch(/Context items:\s*2/);
      expect(restoreText).toMatch(/Files:\s*1/);
    } finally {
      await importer.close();
    }
  }, 20000);

  it('reports legacy exports (no checkpointItems) as not imported, without error', async () => {
    const legacy = path.join(server.exportsDir, 'legacy-export.json');
    fs.mkdirSync(server.exportsDir, { recursive: true });
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
      const text = await server.call('context_import', { filePath: 'legacy-export.json' });
      expect(text).toMatch(/Import successful/i);
      expect(text).toMatch(/Context items:\s*1/);
      expect(text).toMatch(/Checkpoints in file:\s*1 \(not imported/i);
    } finally {
      fs.rmSync(legacy, { force: true });
    }
  });

  it('drops checkpoint links that point at skipped/absent rows and proves DB state', async () => {
    // 0.5.0 export with a checkpoint whose item link references an id that is
    // not present in contextItems — the checkpoint imports, the dangling link is
    // dropped, and a subsequent restore yields exactly the one valid item.
    const partial = path.join(server.exportsDir, 'partial-cp.json');
    fs.mkdirSync(server.exportsDir, { recursive: true });
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
      const text = await server.call('context_import', { filePath: 'partial-cp.json' });
      expect(text).toMatch(/Import successful/i);
      // 1 checkpoint, only the 1 valid link restored, 1 dangling link dropped.
      expect(text).toMatch(/Checkpoints:\s*1, links restored:\s*1 \(dropped 1 dangling\)/);

      // "partial-cp" is unique here, so restore-by-name is unambiguous.
      const restoreText = await server.call('context_restore_checkpoint', {
        name: 'partial-cp',
        restoreFiles: true,
      });
      expect(restoreText).toMatch(/Context items:\s*1/); // not 2 — dangling link was dropped
    } finally {
      fs.rmSync(partial, { force: true });
    }
  });
});
