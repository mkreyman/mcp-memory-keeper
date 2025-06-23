import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Session Management Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-session-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
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

  describe('Session lifecycle', () => {
    it('should create a new session', () => {
      const sessionId = uuidv4();
      const result = db
        .prepare('INSERT INTO sessions (id, name, description, branch) VALUES (?, ?, ?, ?)')
        .run(sessionId, 'Test Session', 'Test Description', 'main');

      expect(result.changes).toBe(1);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
      expect(session).toBeDefined();
      expect(session.name).toBe('Test Session');
      expect(session.description).toBe('Test Description');
      expect(session.branch).toBe('main');
    });

    it('should list sessions in order', () => {
      // Create multiple sessions
      const sessions = [
        { id: uuidv4(), name: 'Session 1' },
        { id: uuidv4(), name: 'Session 2' },
        { id: uuidv4(), name: 'Session 3' },
      ];

      sessions.forEach((s, index) => {
        // Add delay to ensure different timestamps
        const date = new Date();
        date.setSeconds(date.getSeconds() - (sessions.length - index));

        db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)').run(
          s.id,
          s.name,
          date.toISOString()
        );
      });

      const results = db
        .prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 10')
        .all() as any[];

      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('Session 3');
      expect(results[2].name).toBe('Session 1');
    });

    it('should copy context when continuing from previous session', () => {
      // Create source session
      const sourceSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        sourceSessionId,
        'Source Session'
      );

      // Add context items
      const items = [
        { key: 'key1', value: 'value1', category: 'task', priority: 'high' },
        { key: 'key2', value: 'value2', category: 'decision', priority: 'normal' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), sourceSessionId, item.key, item.value, item.category, item.priority);
      });

      // Create new session and copy items
      const newSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(newSessionId, 'New Session');

      dbManager.transaction(() => {
        const sourceItems = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(sourceSessionId) as any[];

        sourceItems.forEach((item: any) => {
          db.prepare(
            'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(uuidv4(), newSessionId, item.key, item.value, item.category, item.priority);
        });
      });

      // Verify items were copied
      const copiedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key')
        .all(newSessionId) as any[];

      expect(copiedItems).toHaveLength(2);
      expect(copiedItems[0].key).toBe('key1');
      expect(copiedItems[0].value).toBe('value1');
      expect(copiedItems[1].key).toBe('key2');
      expect(copiedItems[1].value).toBe('value2');
    });
  });

  describe('Context storage', () => {
    it('should save and retrieve context items', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Save context item
      const itemId = uuidv4();
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(itemId, sessionId, 'test_key', 'test_value', 'task', 'high');

      // Retrieve item
      const item = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(sessionId, 'test_key') as any;

      expect(item).toBeDefined();
      expect(item.value).toBe('test_value');
      expect(item.category).toBe('task');
      expect(item.priority).toBe('high');
    });

    it('should handle unique key constraint per session', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Insert first item
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        sessionId,
        'unique_key',
        'value1'
      );

      // Try to insert duplicate key - should replace
      db.prepare(
        'INSERT OR REPLACE INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
      ).run(uuidv4(), sessionId, 'unique_key', 'value2');

      const items = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .all(sessionId, 'unique_key') as any[];

      expect(items).toHaveLength(1);
      expect(items[0].value).toBe('value2');
    });

    it('should filter by category and priority', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Insert items with different categories and priorities
      const items = [
        { key: 'task1', category: 'task', priority: 'high' },
        { key: 'task2', category: 'task', priority: 'low' },
        { key: 'decision1', category: 'decision', priority: 'high' },
        { key: 'note1', category: 'note', priority: 'normal' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, item.key, 'value', item.category, item.priority);
      });

      // Filter by category
      const tasks = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND category = ?')
        .all(sessionId, 'task') as any[];

      expect(tasks).toHaveLength(2);

      // Filter by priority
      const highPriority = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND priority = ?')
        .all(sessionId, 'high') as any[];

      expect(highPriority).toHaveLength(2);
      expect(highPriority.map((i: any) => i.key).sort()).toEqual(['decision1', 'task1']);
    });
  });

  describe('File caching', () => {
    it('should cache file content with hash', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      const content = 'This is file content';
      const hash = require('crypto').createHash('sha256').update(content).digest('hex');

      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), sessionId, '/test/file.txt', content, hash);

      const cached = db
        .prepare('SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?')
        .get(sessionId, '/test/file.txt') as any;

      expect(cached).toBeDefined();
      expect(cached.content).toBe(content);
      expect(cached.hash).toBe(hash);
    });

    it('should detect file changes', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      const originalContent = 'Original content';
      const originalHash = require('crypto')
        .createHash('sha256')
        .update(originalContent)
        .digest('hex');

      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), sessionId, '/test/file.txt', originalContent, originalHash);

      const newContent = 'Modified content';
      const newHash = require('crypto').createHash('sha256').update(newContent).digest('hex');

      const cached = db
        .prepare('SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?')
        .get(sessionId, '/test/file.txt') as any;

      expect(cached.hash).not.toBe(newHash);
      expect(originalHash).not.toBe(newHash);
    });
  });
});
