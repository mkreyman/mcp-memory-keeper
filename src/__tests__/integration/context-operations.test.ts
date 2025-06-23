import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Context Operations Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-context-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();

    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(testSessionId, 'Test Session');
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (_e) {
      // Ignore
    }
  });

  describe('context_save', () => {
    it('should save a basic context item', () => {
      const result = db
        .prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), testSessionId, 'test_key', 'test_value');

      expect(result.changes).toBe(1);

      const saved = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, 'test_key') as any;

      expect(saved).toBeDefined();
      expect(saved.key).toBe('test_key');
      expect(saved.value).toBe('test_value');
    });

    it('should save context with category and priority', () => {
      const id = uuidv4();
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, testSessionId, 'task_item', 'Fix bug in auth', 'task', 'high');

      const saved = db.prepare('SELECT * FROM context_items WHERE id = ?').get(id) as any;

      expect(saved.category).toBe('task');
      expect(saved.priority).toBe('high');
    });

    it('should update existing key in same session', () => {
      // Insert first
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'update_key',
        'original_value'
      );

      // Update using INSERT OR REPLACE
      db.prepare(
        'INSERT OR REPLACE INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'update_key', 'updated_value');

      const items = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .all(testSessionId, 'update_key') as any[];

      expect(items).toHaveLength(1);
      expect(items[0].value).toBe('updated_value');
    });

    it('should handle large values', () => {
      const largeValue = 'x'.repeat(10000); // 10KB of data
      const result = db
        .prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), testSessionId, 'large_key', largeValue);

      expect(result.changes).toBe(1);

      const saved = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, 'large_key') as any;

      expect(saved.value).toBe(largeValue);
    });

    it('should handle special characters in values', () => {
      const specialValue = `Line 1\nLine 2\t"quoted"\n'single'\n\`backtick\``;
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'special_key',
        specialValue
      );

      const saved = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, 'special_key') as any;

      expect(saved.value).toBe(specialValue);
    });
  });

  describe('context_get', () => {
    beforeEach(() => {
      // Add test data
      const items = [
        { key: 'item1', value: 'value1', category: 'task', priority: 'high' },
        { key: 'item2', value: 'value2', category: 'task', priority: 'normal' },
        { key: 'item3', value: 'value3', category: 'decision', priority: 'high' },
        { key: 'item4', value: 'value4', category: 'note', priority: 'low' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      });
    });

    it('should get item by key', () => {
      const item = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, 'item1') as any;

      expect(item).toBeDefined();
      expect(item.value).toBe('value1');
      expect(item.category).toBe('task');
    });

    it('should get all items for session', () => {
      const items = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key')
        .all(testSessionId) as any[];

      expect(items).toHaveLength(4);
      expect(items[0].key).toBe('item1');
      expect(items[3].key).toBe('item4');
    });

    it('should filter by category', () => {
      const tasks = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND category = ?')
        .all(testSessionId, 'task') as any[];

      expect(tasks).toHaveLength(2);
      expect(tasks.every((t: any) => t.category === 'task')).toBe(true);
    });

    it('should filter by priority', () => {
      const highPriority = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND priority = ?')
        .all(testSessionId, 'high') as any[];

      expect(highPriority).toHaveLength(2);
      expect(highPriority.every((t: any) => t.priority === 'high')).toBe(true);
    });

    it('should filter by category and priority', () => {
      const highTasks = db
        .prepare(
          'SELECT * FROM context_items WHERE session_id = ? AND category = ? AND priority = ?'
        )
        .all(testSessionId, 'task', 'high') as any[];

      expect(highTasks).toHaveLength(1);
      expect(highTasks[0].key).toBe('item1');
    });

    it('should return empty array when no matches', () => {
      const items = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .all(testSessionId, 'nonexistent') as any[];

      expect(items).toHaveLength(0);
    });

    it('should get items from specific session', () => {
      // Create another session
      const otherSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        otherSessionId,
        'Other Session'
      );

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        otherSessionId,
        'other_item',
        'other_value'
      );

      // Get from specific session
      const items = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(otherSessionId) as any[];

      expect(items).toHaveLength(1);
      expect(items[0].key).toBe('other_item');
    });
  });

  describe('context_status', () => {
    it('should show status with no items', () => {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(testSessionId) as any;
      const itemCount = db
        .prepare('SELECT COUNT(*) as count FROM context_items WHERE session_id = ?')
        .get(testSessionId) as any;
      const fileCount = db
        .prepare('SELECT COUNT(*) as count FROM file_cache WHERE session_id = ?')
        .get(testSessionId) as any;

      expect(session).toBeDefined();
      expect(itemCount.count).toBe(0);
      expect(fileCount.count).toBe(0);
    });

    it('should show complete status information', () => {
      // Add some data
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `key${i}`, `value${i}`, i % 2 === 0 ? 'task' : 'note');
      }

      for (let i = 0; i < 3; i++) {
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `/file${i}.txt`, `content${i}`, `hash${i}`);
      }

      // Get status
      const itemCount = db
        .prepare('SELECT COUNT(*) as count FROM context_items WHERE session_id = ?')
        .get(testSessionId) as any;
      const fileCount = db
        .prepare('SELECT COUNT(*) as count FROM file_cache WHERE session_id = ?')
        .get(testSessionId) as any;

      const categoryBreakdown = db
        .prepare(
          `SELECT category, COUNT(*) as count 
         FROM context_items 
         WHERE session_id = ? 
         GROUP BY category`
        )
        .all(testSessionId) as any[];

      expect(itemCount.count).toBe(5);
      expect(fileCount.count).toBe(3);
      expect(categoryBreakdown).toHaveLength(2);
      expect(categoryBreakdown.find((c: any) => c.category === 'task')?.count).toBe(3);
      expect(categoryBreakdown.find((c: any) => c.category === 'note')?.count).toBe(2);
    });

    it('should calculate database size', () => {
      // Add substantial data
      const largeContent = 'x'.repeat(1000);
      for (let i = 0; i < 10; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `large${i}`, largeContent);
      }

      // Calculate approximate size
      const items = db
        .prepare('SELECT LENGTH(value) as size FROM context_items WHERE session_id = ?')
        .all(testSessionId) as any[];

      const totalSize = items.reduce((sum: number, item: any) => sum + item.size, 0);
      expect(totalSize).toBe(10000); // 10 items × 1000 chars
    });
  });
});
