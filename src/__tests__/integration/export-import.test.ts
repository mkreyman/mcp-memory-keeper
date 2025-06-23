import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Export/Import Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let tempExportPath: string;
  let db: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-export-${Date.now()}.db`);
    tempExportPath = path.join(os.tmpdir(), `test-exports-${Date.now()}`);

    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();

    // Create export directory
    fs.mkdirSync(tempExportPath, { recursive: true });
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
      fs.rmSync(tempExportPath, { recursive: true, force: true });
    } catch (_e) {
      // Ignore
    }
  });

  describe('context_export', () => {
    it('should export session data to JSON', () => {
      // Create test data
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
        sessionId,
        'Export Test',
        'Test session for export'
      );

      // Add context items
      const items = [
        { key: 'task1', value: 'Complete export feature', category: 'task', priority: 'high' },
        {
          key: 'note1',
          value: 'Export format should be JSON',
          category: 'note',
          priority: 'normal',
        },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, item.key, item.value, item.category, item.priority);
      });

      // Add file cache
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), sessionId, '/test.ts', 'test content', 'hash123');

      // Export data
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        session: db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId),
        context_items: db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(sessionId),
        file_cache: db.prepare('SELECT * FROM file_cache WHERE session_id = ?').all(sessionId),
        checkpoints: db.prepare('SELECT * FROM checkpoints WHERE session_id = ?').all(sessionId),
      };

      const exportPath = path.join(tempExportPath, `session-${sessionId}.json`);
      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

      // Verify export
      expect(fs.existsSync(exportPath)).toBe(true);
      const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
      expect(exported.version).toBe('1.0');
      expect(exported.context_items).toHaveLength(2);
      expect(exported.file_cache).toHaveLength(1);
    });

    it('should export with checkpoints and linked items', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        sessionId,
        'Checkpoint Export'
      );

      // Add context items
      const itemId1 = uuidv4();
      const itemId2 = uuidv4();
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        itemId1,
        sessionId,
        'item1',
        'value1'
      );
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        itemId2,
        sessionId,
        'item2',
        'value2'
      );

      // Create checkpoint
      const checkpointId = uuidv4();
      db.prepare('INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)').run(
        checkpointId,
        sessionId,
        'Test Checkpoint'
      );

      // Link items to checkpoint
      db.prepare(
        'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
      ).run(uuidv4(), checkpointId, itemId1);
      db.prepare(
        'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
      ).run(uuidv4(), checkpointId, itemId2);

      // Export with checkpoint data
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        session: db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId),
        context_items: db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(sessionId),
        checkpoints: db.prepare('SELECT * FROM checkpoints WHERE session_id = ?').all(sessionId),
        checkpoint_items: db
          .prepare(
            `
          SELECT cpi.* FROM checkpoint_items cpi
          JOIN checkpoints cp ON cpi.checkpoint_id = cp.id
          WHERE cp.session_id = ?
        `
          )
          .all(sessionId),
      };

      const exportPath = path.join(tempExportPath, 'checkpoint-export.json');
      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

      const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
      expect(exported.checkpoints).toHaveLength(1);
      expect(exported.checkpoint_items).toHaveLength(2);
    });

    it('should compress large exports', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Large Export');

      // Add many items
      const items = [];
      for (let i = 0; i < 1000; i++) {
        const id = uuidv4();
        items.push(id);
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(id, sessionId, `key${i}`, `This is a longer value to make the export larger: ${i}`);
      }

      // Export data
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        session: db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId),
        context_items: db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(sessionId),
      };

      // Test both compressed and uncompressed
      const uncompressedPath = path.join(tempExportPath, 'large-export.json');
      const compressedPath = path.join(tempExportPath, 'large-export.json.gz');

      fs.writeFileSync(uncompressedPath, JSON.stringify(exportData, null, 2));

      // Simulate compression (using zlib)
      const zlib = require('zlib');
      const compressed = zlib.gzipSync(JSON.stringify(exportData));
      fs.writeFileSync(compressedPath, compressed);

      const uncompressedSize = fs.statSync(uncompressedPath).size;
      const compressedSize = fs.statSync(compressedPath).size;

      expect(compressedSize).toBeLessThan(uncompressedSize * 0.5); // Should compress well
    });
  });

  describe('context_import', () => {
    it('should import session data from JSON', () => {
      // Create export data
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        session: {
          id: uuidv4(),
          name: 'Imported Session',
          description: 'Test import',
          created_at: new Date().toISOString(),
        },
        context_items: [
          {
            id: uuidv4(),
            session_id: '',
            key: 'imported1',
            value: 'value1',
            category: 'task',
            priority: 'high',
          },
          {
            id: uuidv4(),
            session_id: '',
            key: 'imported2',
            value: 'value2',
            category: 'note',
            priority: 'normal',
          },
        ],
        file_cache: [
          {
            id: uuidv4(),
            session_id: '',
            file_path: '/imported.ts',
            content: 'imported content',
            hash: 'hash456',
          },
        ],
      };

      const importPath = path.join(tempExportPath, 'import-test.json');
      fs.writeFileSync(importPath, JSON.stringify(exportData, null, 2));

      // Import data
      const importedData = JSON.parse(fs.readFileSync(importPath, 'utf-8'));

      // Create new session for import
      const newSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
        newSessionId,
        `${importedData.session.name} (Imported)`,
        importedData.session.description
      );

      // Import context items
      importedData.context_items.forEach((item: any) => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), newSessionId, item.key, item.value, item.category, item.priority);
      });

      // Import file cache
      importedData.file_cache.forEach((file: any) => {
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), newSessionId, file.file_path, file.content, file.hash);
      });

      // Verify import
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(newSessionId) as any;
      expect(session.name).toContain('Imported');

      const items = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(newSessionId) as any[];
      expect(items).toHaveLength(2);
      expect(items.map((i: any) => i.key)).toContain('imported1');

      const files = db
        .prepare('SELECT * FROM file_cache WHERE session_id = ?')
        .all(newSessionId) as any[];
      expect(files).toHaveLength(1);
      expect(files[0].file_path).toBe('/imported.ts');
    });

    it('should validate import data format', () => {
      const invalidData = {
        // Missing version
        timestamp: new Date().toISOString(),
        session: { name: 'Invalid' },
      };

      const importPath = path.join(tempExportPath, 'invalid.json');
      fs.writeFileSync(importPath, JSON.stringify(invalidData));

      // Validation function
      const validateImport = (data: any): boolean => {
        return !!(data.version && data.session && data.session.name);
      };

      const importedData = JSON.parse(fs.readFileSync(importPath, 'utf-8'));
      expect(validateImport(importedData)).toBe(false);
    });

    it('should handle duplicate imports', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Original');

      // Add existing item
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        sessionId,
        'existing_key',
        'original value'
      );

      // Import data with same key
      const importData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        context_items: [
          { key: 'existing_key', value: 'imported value', category: 'task', priority: 'high' },
        ],
      };

      // Strategy 1: Skip duplicates
      const existingItem = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(sessionId, 'existing_key');

      if (!existingItem) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          sessionId,
          importData.context_items[0].key,
          importData.context_items[0].value,
          importData.context_items[0].category,
          importData.context_items[0].priority
        );
      }

      // Verify original was kept
      const item = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(sessionId, 'existing_key') as any;
      expect(item.value).toBe('original value');

      // Strategy 2: Replace duplicates
      db.prepare(
        'INSERT OR REPLACE INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(item.id, sessionId, 'existing_key', 'replaced value', 'task', 'high');

      const replaced = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(sessionId, 'existing_key') as any;
      expect(replaced.value).toBe('replaced value');
    });

    it('should merge imports into existing session', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Merge Target');

      // Add existing items
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        sessionId,
        'existing1',
        'value1'
      );

      // Import additional items
      const importData = {
        version: '1.0',
        context_items: [
          { key: 'imported1', value: 'new value1' },
          { key: 'imported2', value: 'new value2' },
        ],
      };

      // Merge import
      importData.context_items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, item.key, item.value);
      });

      // Verify merge
      const allItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key')
        .all(sessionId) as any[];

      expect(allItems).toHaveLength(3);
      expect(allItems.map((i: any) => i.key)).toEqual(['existing1', 'imported1', 'imported2']);
    });
  });

  describe('Export/Import formats', () => {
    it('should support markdown export format', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
        sessionId,
        'Markdown Export',
        'Testing markdown format'
      );

      // Add context items
      const items = [
        { key: 'task1', value: 'Implement feature X', category: 'task', priority: 'high' },
        { key: 'decision1', value: 'Use TypeScript', category: 'decision', priority: 'high' },
        {
          key: 'note1',
          value: 'Remember to test edge cases',
          category: 'note',
          priority: 'normal',
        },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, item.key, item.value, item.category, item.priority);
      });

      // Generate markdown
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
      const contextItems = db
        .prepare(
          'SELECT * FROM context_items WHERE session_id = ? ORDER BY category, priority DESC'
        )
        .all(sessionId) as any[];

      const markdown = [`# ${session.name}`, '', session.description, '', '## Context Items', ''];

      const itemsByCategory = contextItems.reduce((acc: any, item: any) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
      }, {});

      Object.entries(itemsByCategory).forEach(([category, items]: [string, any]) => {
        markdown.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}s`);
        markdown.push('');
        items.forEach((item: any) => {
          markdown.push(`- **${item.key}** (${item.priority}): ${item.value}`);
        });
        markdown.push('');
      });

      const markdownPath = path.join(tempExportPath, 'export.md');
      fs.writeFileSync(markdownPath, markdown.join('\n'));

      // Verify markdown
      const content = fs.readFileSync(markdownPath, 'utf-8');
      expect(content).toContain('# Markdown Export');
      expect(content).toContain('### Tasks');
      expect(content).toContain('**task1** (high): Implement feature X');
    });
  });
});
