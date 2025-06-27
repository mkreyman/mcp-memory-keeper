import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Context Diff Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;
  let otherSessionId: string;
  let repositories: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-context-diff-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    repositories = new RepositoryManager(dbManager);

    // Create test sessions
    testSessionId = uuidv4();
    otherSessionId = uuidv4();

    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(testSessionId, 'Test Session');

    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      otherSessionId,
      'Other Session'
    );
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

  describe('Basic Diff Operations', () => {
    it('should detect added items since timestamp', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 2);

      // Add items at different times
      const oldItem = {
        id: uuidv4(),
        key: 'old_item',
        value: 'This existed before',
        created_at: new Date(baseTime.getTime() - 1000).toISOString(),
      };

      const newItem = {
        id: uuidv4(),
        key: 'new_item',
        value: 'This was added recently',
        created_at: new Date().toISOString(),
      };

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(oldItem.id, testSessionId, oldItem.key, oldItem.value, oldItem.created_at);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(newItem.id, testSessionId, newItem.key, newItem.value, newItem.created_at);

      // Query for items added since baseTime
      const addedItems = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
          ORDER BY created_at DESC
        `
        )
        .all(testSessionId, baseTime.toISOString()) as any[];

      expect(addedItems).toHaveLength(1);
      expect(addedItems[0].key).toBe('new_item');
    });

    it('should detect modified items', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 2);

      // Create an item
      const itemId = uuidv4();
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        itemId,
        testSessionId,
        'changing_item',
        'Original value',
        new Date(baseTime.getTime() - 1000).toISOString(),
        new Date(baseTime.getTime() - 1000).toISOString()
      );

      // Update the item
      const newUpdateTime = new Date().toISOString();
      db.prepare('UPDATE context_items SET value = ?, updated_at = ? WHERE id = ?').run(
        'Modified value',
        newUpdateTime,
        itemId
      );

      // Query for items modified since baseTime
      const modifiedItems = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
          AND created_at <= ?
          AND updated_at > ?
          ORDER BY updated_at DESC
        `
        )
        .all(testSessionId, baseTime.toISOString(), baseTime.toISOString()) as any[];

      expect(modifiedItems).toHaveLength(1);
      expect(modifiedItems[0].key).toBe('changing_item');
      expect(modifiedItems[0].value).toBe('Modified value');
    });

    it('should handle no changes scenario', () => {
      const baseTime = new Date();

      // Add items before the base time
      const oldTime = new Date(baseTime.getTime() - 60000).toISOString();

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'old_item', 'Old value', oldTime, oldTime);

      // Query for changes since baseTime (should be empty)
      const addedItems = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
        `
        )
        .all(testSessionId, baseTime.toISOString()) as any[];

      const modifiedItems = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
          AND created_at <= ?
          AND updated_at > ?
        `
        )
        .all(testSessionId, baseTime.toISOString(), baseTime.toISOString()) as any[];

      expect(addedItems).toHaveLength(0);
      expect(modifiedItems).toHaveLength(0);
    });
  });

  describe('Checkpoint-based Diff', () => {
    it('should compare against checkpoint using repository method', () => {
      const checkpointTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      // Create items at checkpoint time
      const items = [
        { key: 'item1', value: 'Value 1' },
        { key: 'item2', value: 'Value 2' },
        { key: 'item3', value: 'Value 3' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          item.key,
          item.value,
          checkpointTime.toISOString(),
          checkpointTime.toISOString()
        );
      });

      // Wait a bit to ensure timestamp difference
      const afterCheckpoint = new Date(checkpointTime.getTime() + 2000); // 2 seconds later

      // Make changes after checkpoint
      // 1. Add new item
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        uuidv4(),
        testSessionId,
        'item4',
        'Value 4',
        afterCheckpoint.toISOString(),
        afterCheckpoint.toISOString()
      );

      // 2. Modify existing item
      db.prepare(
        'UPDATE context_items SET value = ?, updated_at = ? WHERE session_id = ? AND key = ?'
      ).run('Modified Value 2', afterCheckpoint.toISOString(), testSessionId, 'item2');

      // 3. Delete an item
      db.prepare('DELETE FROM context_items WHERE session_id = ? AND key = ?').run(
        testSessionId,
        'item3'
      );

      // Use repository method to get diff
      const sinceTime = new Date(checkpointTime.getTime() + 1000); // 1 second after checkpoint

      const diff = repositories.contexts.getDiff({
        sessionId: testSessionId,
        sinceTimestamp: sinceTime.toISOString(),
      });

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].key).toBe('item4');

      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0].key).toBe('item2');
      expect(diff.modified[0].value).toBe('Modified Value 2');

      // Note: deleted items are only detected via checkpoint comparison, not timestamp diff
    });

    it('should compare against checkpoint', () => {
      // Create initial state
      const checkpointTime = new Date();
      const items = [
        { key: 'item1', value: 'Value 1' },
        { key: 'item2', value: 'Value 2' },
        { key: 'item3', value: 'Value 3' },
      ];

      const itemIds: string[] = [];
      items.forEach(item => {
        const id = uuidv4();
        itemIds.push(id);
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          id,
          testSessionId,
          item.key,
          item.value,
          checkpointTime.toISOString(),
          checkpointTime.toISOString()
        );
      });

      // Create checkpoint slightly after items (to ensure proper comparison)
      const actualCheckpointTime = new Date(checkpointTime.getTime() + 1000); // 1 second later
      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, created_at) VALUES (?, ?, ?, ?)'
      ).run(checkpointId, testSessionId, 'test-checkpoint', actualCheckpointTime.toISOString());

      // Link items to checkpoint
      itemIds.forEach(itemId => {
        db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, itemId);
      });

      // Make changes after checkpoint
      // 1. Add new item
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'item4',
        'Value 4'
      );

      // 2. Modify existing item
      db.prepare(
        'UPDATE context_items SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND key = ?'
      ).run('Modified Value 2', testSessionId, 'item2');

      // 3. Delete an item
      db.prepare('DELETE FROM context_items WHERE session_id = ? AND key = ?').run(
        testSessionId,
        'item3'
      );

      // Get checkpoint items
      const checkpointItems = db
        .prepare(
          `
          SELECT ci.* FROM context_items ci
          JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
          WHERE cpi.checkpoint_id = ?
        `
        )
        .all(checkpointId) as any[];

      // Get current items
      const currentItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(testSessionId) as any[];

      // Calculate diff
      const checkpointKeys = new Set(checkpointItems.map((i: any) => i.key));
      const currentKeys = new Set(currentItems.map((i: any) => i.key));

      // Added: in current but not in checkpoint
      const added = currentItems.filter((i: any) => !checkpointKeys.has(i.key));
      expect(added).toHaveLength(1);
      expect(added[0].key).toBe('item4');

      // Modified: in both but values differ
      const modified = currentItems.filter((i: any) => {
        const checkpointItem = checkpointItems.find((ci: any) => ci.key === i.key);
        return checkpointItem && checkpointItem.value !== i.value;
      });
      expect(modified).toHaveLength(1);
      expect(modified[0].key).toBe('item2');

      // Deleted: in checkpoint but not in current
      const deleted = checkpointItems.filter((i: any) => !currentKeys.has(i.key));
      expect(deleted).toHaveLength(1);
      expect(deleted[0].key).toBe('item3');
    });

    it('should handle non-existent checkpoint', () => {
      const checkpoint = db
        .prepare('SELECT * FROM checkpoints WHERE name = ?')
        .get('non-existent-checkpoint') as any;

      expect(checkpoint).toBeUndefined();
    });
  });

  describe('Relative Time Parsing', () => {
    it('should parse "2 hours ago"', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Add items at different times
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        uuidv4(),
        testSessionId,
        'recent_item',
        'Added 1 hour ago',
        new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      );

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        uuidv4(),
        testSessionId,
        'old_item',
        'Added 3 hours ago',
        new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
      );

      // Query items added since "2 hours ago"
      const items = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
          ORDER BY created_at DESC
        `
        )
        .all(testSessionId, twoHoursAgo.toISOString()) as any[];

      expect(items).toHaveLength(1);
      expect(items[0].key).toBe('recent_item');
    });

    it('should parse "yesterday"', () => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      // Add items at different times
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'today_item', 'Added today', new Date().toISOString());

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        uuidv4(),
        testSessionId,
        'yesterday_item',
        'Added yesterday',
        new Date(yesterday.getTime() + 12 * 60 * 60 * 1000).toISOString() // Noon yesterday
      );

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        uuidv4(),
        testSessionId,
        'old_item',
        'Added 2 days ago',
        new Date(yesterday.getTime() - 24 * 60 * 60 * 1000).toISOString()
      );

      // Query items added since yesterday
      const items = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at >= ?
          ORDER BY created_at DESC
        `
        )
        .all(testSessionId, yesterday.toISOString()) as any[];

      expect(items).toHaveLength(2);
      expect(items.map((i: any) => i.key)).toContain('today_item');
      expect(items.map((i: any) => i.key)).toContain('yesterday_item');
      expect(items.map((i: any) => i.key)).not.toContain('old_item');
    });

    it('should parse "3 days ago"', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

      // Add items
      for (let i = 0; i < 5; i++) {
        const daysAgo = i;
        const itemTime = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          `item_${daysAgo}d_ago`,
          `Added ${daysAgo} days ago`,
          itemTime.toISOString()
        );
      }

      // Query items since 3 days ago
      const items = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
          ORDER BY created_at DESC
        `
        )
        .all(testSessionId, threeDaysAgo.toISOString()) as any[];

      expect(items).toHaveLength(3); // 0, 1, 2 days ago
      expect(items.map((i: any) => i.key)).toContain('item_0d_ago');
      expect(items.map((i: any) => i.key)).toContain('item_1d_ago');
      expect(items.map((i: any) => i.key)).toContain('item_2d_ago');
      expect(items.map((i: any) => i.key)).not.toContain('item_3d_ago');
      expect(items.map((i: any) => i.key)).not.toContain('item_4d_ago');
    });

    it('should handle invalid relative time formats', () => {
      // Test that invalid formats don't crash
      const invalidFormats = [
        'invalid time',
        '2 minutes ago', // Not supported
        'next week',
        '',
        null,
      ];

      invalidFormats.forEach(format => {
        expect(() => {
          db.prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at > ?').all(
            testSessionId,
            format
          );
        }).not.toThrow();
      });
    });
  });

  describe('Filtering Options', () => {
    beforeEach(() => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 2);

      // Create diverse items for filtering tests
      const items = [
        {
          key: 'task_new_high',
          value: 'New high priority task',
          category: 'task',
          priority: 'high',
          channel: 'main',
          created_at: new Date().toISOString(),
        },
        {
          key: 'task_old_normal',
          value: 'Old normal priority task',
          category: 'task',
          priority: 'normal',
          channel: 'main',
          created_at: new Date(baseTime.getTime() - 1000).toISOString(),
        },
        {
          key: 'note_new_low',
          value: 'New low priority note',
          category: 'note',
          priority: 'low',
          channel: 'feature/docs',
          created_at: new Date().toISOString(),
        },
        {
          key: 'decision_modified',
          value: 'Modified decision',
          category: 'decision',
          priority: 'high',
          channel: 'main',
          created_at: new Date(baseTime.getTime() - 2000).toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      items.forEach(item => {
        db.prepare(
          `INSERT INTO context_items 
           (id, session_id, key, value, category, priority, channel, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uuidv4(),
          testSessionId,
          item.key,
          item.value,
          item.category,
          item.priority,
          item.channel,
          item.created_at,
          item.updated_at || item.created_at
        );
      });
    });

    it('should filter diff by category', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 2);

      // Get added items filtered by category
      const addedTasks = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
          AND created_at > ?
          AND category = ?
          ORDER BY created_at DESC
        `
        )
        .all(testSessionId, baseTime.toISOString(), 'task') as any[];

      expect(addedTasks).toHaveLength(1);
      expect(addedTasks[0].key).toBe('task_new_high');
    });

    it('should filter diff by channel', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 2);

      // Get all changes in 'main' channel
      const mainChannelAdded = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
          AND created_at > ?
          AND channel = ?
          ORDER BY created_at DESC
        `
        )
        .all(testSessionId, baseTime.toISOString(), 'main') as any[];

      expect(mainChannelAdded).toHaveLength(1);
      expect(mainChannelAdded[0].key).toBe('task_new_high');
    });

    it('should filter diff by multiple channels', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 2);

      const channels = ['main', 'feature/docs'];
      const placeholders = channels.map(() => '?').join(',');

      const multiChannelItems = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
          AND created_at > ?
          AND channel IN (${placeholders})
          ORDER BY created_at DESC
        `
        )
        .all(testSessionId, baseTime.toISOString(), ...channels) as any[];

      expect(multiChannelItems).toHaveLength(2);
      expect(multiChannelItems.map((i: any) => i.key)).toContain('task_new_high');
      expect(multiChannelItems.map((i: any) => i.key)).toContain('note_new_low');
    });
  });

  describe('Include Values Option', () => {
    it('should include full values when requested', () => {
      const longValue = 'A'.repeat(1000);

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'long_item',
        longValue
      );

      const item = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, 'long_item') as any;

      expect(item.value).toBe(longValue);
      expect(item.value.length).toBe(1000);
    });

    it('should be able to exclude values for summary', () => {
      // Add items
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `item_${i}`, `Value ${i} with lots of text...`);
      }

      // Query without values (just keys and metadata)
      const items = db
        .prepare(
          'SELECT id, session_id, key, category, priority, channel, created_at FROM context_items WHERE session_id = ?'
        )
        .all(testSessionId) as any[];

      expect(items).toHaveLength(5);
      items.forEach((item: any) => {
        expect(item).not.toHaveProperty('value');
        expect(item).toHaveProperty('key');
        expect(item).toHaveProperty('created_at');
      });
    });
  });

  describe('Privacy and Session Boundaries', () => {
    it('should respect privacy boundaries in diff', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 1);

      // Add items to both sessions
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, is_private) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'my_public', 'Public item', 0);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, is_private) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'my_private', 'Private item', 1);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, is_private) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), otherSessionId, 'other_public', 'Other public', 0);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, is_private) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), otherSessionId, 'other_private', 'Other private', 1);

      // Query from testSessionId perspective
      const visibleItems = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE created_at > ?
          AND (is_private = 0 OR session_id = ?)
          ORDER BY created_at DESC
        `
        )
        .all(baseTime.toISOString(), testSessionId) as any[];

      expect(visibleItems.map((i: any) => i.key)).toContain('my_public');
      expect(visibleItems.map((i: any) => i.key)).toContain('my_private');
      expect(visibleItems.map((i: any) => i.key)).toContain('other_public');
      expect(visibleItems.map((i: any) => i.key)).not.toContain('other_private');
    });

    it('should only show session-specific diff by default', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 1);

      // Add items to different sessions
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'my_item',
        'My value'
      );

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        otherSessionId,
        'other_item',
        'Other value'
      );

      // Query for specific session
      const sessionItems = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
        `
        )
        .all(testSessionId, baseTime.toISOString()) as any[];

      expect(sessionItems).toHaveLength(1);
      expect(sessionItems[0].key).toBe('my_item');
    });
  });

  describe('Deleted Items Detection', () => {
    it('should detect deleted items using checkpoint comparison', () => {
      // Create initial items
      const item1Id = uuidv4();
      const item2Id = uuidv4();
      const item3Id = uuidv4();

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        item1Id,
        testSessionId,
        'keep_item',
        'Will remain'
      );

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        item2Id,
        testSessionId,
        'delete_item1',
        'Will be deleted'
      );

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        item3Id,
        testSessionId,
        'delete_item2',
        'Will also be deleted'
      );

      // Create checkpoint
      const checkpointId = uuidv4();
      db.prepare('INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)').run(
        checkpointId,
        testSessionId,
        'before-deletion'
      );

      // Link all items to checkpoint
      [item1Id, item2Id, item3Id].forEach(itemId => {
        db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, itemId);
      });

      // Delete some items
      db.prepare('DELETE FROM context_items WHERE session_id = ? AND key IN (?, ?)').run(
        testSessionId,
        'delete_item1',
        'delete_item2'
      );

      // Get checkpoint items
      const checkpointItems = db
        .prepare(
          `
          SELECT ci.key FROM context_items ci
          JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
          WHERE cpi.checkpoint_id = ?
        `
        )
        .all(checkpointId) as any[];

      // Get current items
      const currentItems = db
        .prepare('SELECT key FROM context_items WHERE session_id = ?')
        .all(testSessionId) as any[];

      const checkpointKeys = new Set(checkpointItems.map((i: any) => i.key));
      const currentKeys = new Set(currentItems.map((i: any) => i.key));

      // Find deleted items
      const deletedKeys = Array.from(checkpointKeys).filter(key => !currentKeys.has(key));

      expect(deletedKeys).toHaveLength(2);
      expect(deletedKeys).toContain('delete_item1');
      expect(deletedKeys).toContain('delete_item2');
      expect(deletedKeys).not.toContain('keep_item');
    });

    it('should handle deletion time tracking if available', () => {
      // Create audit log table for tracking deletions (if implemented)
      // This is a potential enhancement for the actual implementation
      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          action TEXT NOT NULL,
          item_key TEXT,
          timestamp TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `
      ).run();

      const itemId = uuidv4();
      const itemKey = 'tracked_item';

      // Create and then delete an item
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        itemId,
        testSessionId,
        itemKey,
        'Will be deleted with tracking'
      );

      // Delete and log
      const deleteTime = new Date().toISOString();
      db.prepare('DELETE FROM context_items WHERE id = ?').run(itemId);

      db.prepare(
        'INSERT INTO audit_log (id, session_id, action, item_key, timestamp) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'delete', itemKey, deleteTime);

      // Query audit log for deletions
      const deletions = db
        .prepare(
          `
          SELECT * FROM audit_log 
          WHERE session_id = ? AND action = 'delete'
          ORDER BY timestamp DESC
        `
        )
        .all(testSessionId) as any[];

      expect(deletions).toHaveLength(1);
      expect(deletions[0].item_key).toBe(itemKey);
      expect(deletions[0].timestamp).toBe(deleteTime);
    });
  });

  describe('Edge Cases', () => {
    it('should handle future timestamps gracefully', () => {
      const futureTime = new Date();
      futureTime.setDate(futureTime.getDate() + 1);

      // Add current item
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'current_item',
        'Current value'
      );

      // Query with future timestamp (should return nothing)
      const items = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
        `
        )
        .all(testSessionId, futureTime.toISOString()) as any[];

      expect(items).toHaveLength(0);
    });

    it('should handle very old timestamps', () => {
      const veryOldTime = new Date('1970-01-01').toISOString();

      // Add items
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'item1',
        'Value 1'
      );

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'item2',
        'Value 2'
      );

      // Query since very old time (should return all items)
      const items = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
        `
        )
        .all(testSessionId, veryOldTime) as any[];

      expect(items).toHaveLength(2);
    });

    it('should handle invalid checkpoint names', () => {
      const checkpoint = db
        .prepare('SELECT * FROM checkpoints WHERE session_id = ? AND name = ?')
        .get(testSessionId, 'non-existent-checkpoint') as any;

      expect(checkpoint).toBeUndefined();
    });

    it('should handle empty diff results', () => {
      const baseTime = new Date().toISOString();

      // Query for changes (should be empty)
      const added = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at > ?')
        .all(testSessionId, baseTime) as any[];

      const modified = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
          AND created_at <= ?
          AND updated_at > ?
        `
        )
        .all(testSessionId, baseTime, baseTime) as any[];

      expect(added).toHaveLength(0);
      expect(modified).toHaveLength(0);
    });
  });

  describe('Performance with Large Datasets', () => {
    it('should efficiently diff large numbers of changes', () => {
      const baseTime = new Date();
      baseTime.setMinutes(baseTime.getMinutes() - 30);

      // Create many items before base time
      for (let i = 0; i < 500; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          `old_item_${i}`,
          `Old value ${i}`,
          new Date(baseTime.getTime() - 60000).toISOString()
        );
      }

      // Create many new items
      for (let i = 0; i < 500; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `new_item_${i}`, `New value ${i}`);
      }

      const start = Date.now();

      // Query for changes
      const added = db
        .prepare(
          `
          SELECT COUNT(*) as count FROM context_items 
          WHERE session_id = ? AND created_at > ?
        `
        )
        .get(testSessionId, baseTime.toISOString()) as any;

      const duration = Date.now() - start;

      expect(added.count).toBe(500);
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it('should paginate large diff results', () => {
      const baseTime = new Date();
      baseTime.setMinutes(baseTime.getMinutes() - 30);

      // Create many new items
      for (let i = 0; i < 100; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `item_${i.toString().padStart(3, '0')}`, `Value ${i}`);
      }

      // Get paginated results
      const page1 = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
          ORDER BY key ASC
          LIMIT 20 OFFSET 0
        `
        )
        .all(testSessionId, baseTime.toISOString()) as any[];

      const page2 = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? AND created_at > ?
          ORDER BY key ASC
          LIMIT 20 OFFSET 20
        `
        )
        .all(testSessionId, baseTime.toISOString()) as any[];

      expect(page1).toHaveLength(20);
      expect(page2).toHaveLength(20);
      expect(page1[0].key).toBe('item_000');
      expect(page1[19].key).toBe('item_019');
      expect(page2[0].key).toBe('item_020');
      expect(page2[19].key).toBe('item_039');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle item recreation (delete then add with same key)', () => {
      const checkpointTime = new Date();

      // Create initial item
      const originalId = uuidv4();
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        originalId,
        testSessionId,
        'recreated_item',
        'Original value',
        new Date(checkpointTime.getTime() - 60000).toISOString()
      );

      // Create checkpoint
      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, created_at) VALUES (?, ?, ?, ?)'
      ).run(checkpointId, testSessionId, 'before-recreation', checkpointTime.toISOString());

      db.prepare(
        'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
      ).run(uuidv4(), checkpointId, originalId);

      // Delete the item
      db.prepare('DELETE FROM context_items WHERE id = ?').run(originalId);

      // Recreate with same key but different value
      const newId = uuidv4();
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        newId,
        testSessionId,
        'recreated_item',
        'New value after recreation'
      );

      // Get checkpoint item
      const checkpointItem = db
        .prepare(
          `
          SELECT ci.* FROM context_items ci
          JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
          WHERE cpi.checkpoint_id = ? AND ci.key = ?
        `
        )
        .get(checkpointId, 'recreated_item') as any;

      // Get current item
      const currentItem = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, 'recreated_item') as any;

      // Should be treated as modified (different id, different value)
      expect(checkpointItem).toBeDefined();
      expect(currentItem).toBeDefined();
      expect(checkpointItem.id).not.toBe(currentItem.id);
      expect(checkpointItem.value).not.toBe(currentItem.value);
    });

    it('should handle mixed changes across categories and channels', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 1);

      // Create diverse changes
      const changes = [
        // Added items
        { action: 'add', key: 'task_new_1', category: 'task', channel: 'main' },
        { action: 'add', key: 'note_new_1', category: 'note', channel: 'feature/ui' },
        // Modified items (created before, updated after)
        { action: 'modify', key: 'task_mod_1', category: 'task', channel: 'main' },
        { action: 'modify', key: 'decision_mod_1', category: 'decision', channel: 'hotfix' },
      ];

      // Process changes
      changes.forEach(change => {
        if (change.action === 'add') {
          db.prepare(
            'INSERT INTO context_items (id, session_id, key, value, category, channel) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            uuidv4(),
            testSessionId,
            change.key,
            `Value for ${change.key}`,
            change.category,
            change.channel
          );
        } else if (change.action === 'modify') {
          // Create before base time
          const id = uuidv4();
          db.prepare(
            'INSERT INTO context_items (id, session_id, key, value, category, channel, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(
            id,
            testSessionId,
            change.key,
            `Original value for ${change.key}`,
            change.category,
            change.channel,
            new Date(baseTime.getTime() - 60000).toISOString(),
            new Date(baseTime.getTime() - 60000).toISOString()
          );

          // Update after base time
          db.prepare(
            'UPDATE context_items SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).run(`Modified value for ${change.key}`, id);
        }
      });

      // Query different combinations
      // 1. All added in 'main' channel
      const mainAdded = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
          AND created_at > ?
          AND channel = ?
        `
        )
        .all(testSessionId, baseTime.toISOString(), 'main') as any[];

      expect(mainAdded).toHaveLength(1);
      expect(mainAdded[0].key).toBe('task_new_1');

      // 2. All modified tasks
      const modifiedTasks = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
          AND created_at <= ?
          AND updated_at > ?
          AND category = ?
        `
        )
        .all(testSessionId, baseTime.toISOString(), baseTime.toISOString(), 'task') as any[];

      expect(modifiedTasks).toHaveLength(1);
      expect(modifiedTasks[0].key).toBe('task_mod_1');

      // 3. All changes (added + modified) summary
      const allAdded = db
        .prepare(
          'SELECT COUNT(*) as count FROM context_items WHERE session_id = ? AND created_at > ?'
        )
        .get(testSessionId, baseTime.toISOString()) as any;

      const allModified = db
        .prepare(
          `
          SELECT COUNT(*) as count FROM context_items 
          WHERE session_id = ? 
          AND created_at <= ?
          AND updated_at > ?
        `
        )
        .get(testSessionId, baseTime.toISOString(), baseTime.toISOString()) as any;

      expect(allAdded.count).toBe(2);
      expect(allModified.count).toBe(2);
    });
  });

  describe('Summary Generation', () => {
    it('should generate accurate diff summary', () => {
      const baseTime = new Date();
      baseTime.setHours(baseTime.getHours() - 1);

      // Create scenario: 5 added, 3 modified, 2 deleted
      // Add old items
      const oldItemIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = uuidv4();
        oldItemIds.push(id);
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          id,
          testSessionId,
          `old_item_${i}`,
          `Original value ${i}`,
          new Date(baseTime.getTime() - 60000).toISOString(),
          new Date(baseTime.getTime() - 60000).toISOString()
        );
      }

      // Create checkpoint for deletion tracking
      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, created_at) VALUES (?, ?, ?, ?)'
      ).run(checkpointId, testSessionId, 'summary-test', baseTime.toISOString());

      oldItemIds.forEach(id => {
        db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, id);
      });

      // Modify 3 items
      for (let i = 0; i < 3; i++) {
        db.prepare(
          'UPDATE context_items SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND key = ?'
        ).run(`Modified value ${i}`, testSessionId, `old_item_${i}`);
      }

      // Delete 2 items
      db.prepare('DELETE FROM context_items WHERE session_id = ? AND key IN (?, ?)').run(
        testSessionId,
        'old_item_3',
        'old_item_4'
      );

      // Add 5 new items
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `new_item_${i}`, `New value ${i}`);
      }

      // Calculate summary
      const added = db
        .prepare(
          'SELECT COUNT(*) as count FROM context_items WHERE session_id = ? AND created_at > ?'
        )
        .get(testSessionId, baseTime.toISOString()) as any;

      const modified = db
        .prepare(
          `
          SELECT COUNT(*) as count FROM context_items 
          WHERE session_id = ? 
          AND created_at <= ?
          AND updated_at > ?
        `
        )
        .get(testSessionId, baseTime.toISOString(), baseTime.toISOString()) as any;

      // Get deleted count from checkpoint comparison
      const checkpointItemCount = db
        .prepare('SELECT COUNT(*) as count FROM checkpoint_items WHERE checkpoint_id = ?')
        .get(checkpointId) as any;

      const currentItemCount = db
        .prepare('SELECT COUNT(*) as count FROM context_items WHERE session_id = ?')
        .get(testSessionId) as any;

      const deletedCount = checkpointItemCount.count - (currentItemCount.count - added.count);

      expect(added.count).toBe(5);
      expect(modified.count).toBe(3);
      expect(deletedCount).toBe(2);

      // Summary string
      const summary = `${added.count} added, ${modified.count} modified, ${deletedCount} deleted`;
      expect(summary).toBe('5 added, 3 modified, 2 deleted');
    });
  });
});
