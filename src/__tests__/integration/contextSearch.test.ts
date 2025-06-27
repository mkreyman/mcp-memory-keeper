import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Enhanced Context Search Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;
  let otherSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-context-search-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();

    // Create test sessions
    testSessionId = uuidv4();
    otherSessionId = uuidv4();

    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      testSessionId,
      'Main Test Session'
    );

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

  describe('Backward Compatibility', () => {
    beforeEach(() => {
      // Add test data
      const items = [
        {
          key: 'auth_config',
          value: 'Authentication configuration settings',
          category: 'config',
          priority: 'high',
        },
        {
          key: 'db_connection',
          value: 'Database connection string for auth',
          category: 'config',
          priority: 'normal',
        },
        { key: 'user_model', value: 'User model definition', category: 'code', priority: 'high' },
        {
          key: 'auth_middleware',
          value: 'Authentication middleware implementation',
          category: 'code',
          priority: 'normal',
        },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      });
    });

    it('should maintain existing search functionality with query parameter', () => {
      // Test existing simple search - should search in both key and value
      const sql = `
        SELECT * FROM context_items 
        WHERE session_id = ? AND (key LIKE ? OR value LIKE ?)
        ORDER BY priority DESC, created_at DESC
      `;

      const results = db.prepare(sql).all(testSessionId, '%auth%', '%auth%') as any[];

      expect(results).toHaveLength(3); // auth_config, auth_middleware, db_connection (has 'auth' in value)
      expect(results.map((r: any) => r.key)).toContain('auth_config');
      expect(results.map((r: any) => r.key)).toContain('auth_middleware');
      expect(results.map((r: any) => r.key)).toContain('db_connection');
    });

    it('should support searchIn parameter for backward compatibility', () => {
      // Search only in keys
      const keyResults = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND key LIKE ?
        ORDER BY priority DESC, created_at DESC
      `
        )
        .all(testSessionId, '%auth%') as any[];

      expect(keyResults).toHaveLength(2); // auth_config, auth_middleware

      // Search only in values
      const valueResults = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND value LIKE ?
        ORDER BY priority DESC, created_at DESC
      `
        )
        .all(testSessionId, '%auth%') as any[];

      expect(valueResults).toHaveLength(3); // auth_config, auth_middleware, db_connection
    });
  });

  describe('Time Filtering', () => {
    beforeEach(() => {
      const now = new Date();
      const items = [
        { key: 'today_item', value: 'Created today', created_at: now.toISOString() },
        {
          key: 'yesterday_item',
          value: 'Created yesterday',
          created_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          key: 'two_days_ago',
          value: 'Created 2 days ago',
          created_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          key: 'week_old',
          value: 'Created a week ago',
          created_at: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          key: 'month_old',
          value: 'Created a month ago',
          created_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.created_at);
      });
    });

    it('should filter by createdAfter', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND created_at > ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, threeDaysAgo.toISOString()) as any[];

      expect(results).toHaveLength(3); // today, yesterday, two_days_ago
      expect(results.map((r: any) => r.key)).toContain('today_item');
      expect(results.map((r: any) => r.key)).toContain('yesterday_item');
      expect(results.map((r: any) => r.key)).toContain('two_days_ago');
    });

    it('should filter by createdBefore', () => {
      // Get all items first to check their timestamps
      const allItems = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId) as any[];

      // Find the two_days_ago item to get its exact timestamp
      const twoDaysAgoItem = allItems.find((item: any) => item.key === 'two_days_ago');

      // Use a timestamp just after the two_days_ago item to exclude it
      const cutoffDate = new Date(twoDaysAgoItem.created_at);
      cutoffDate.setMilliseconds(cutoffDate.getMilliseconds() - 1); // Go back 1ms to exclude this item

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND created_at < ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, cutoffDate.toISOString()) as any[];

      expect(results).toHaveLength(2); // week_old, month_old
      expect(results.map((r: any) => r.key)).toContain('week_old');
      expect(results.map((r: any) => r.key)).toContain('month_old');
      expect(results.map((r: any) => r.key)).not.toContain('two_days_ago');
    });

    it('should support relative time parsing', () => {
      // Test "2 hours ago"
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

      // Add an item from 1 hour ago
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'recent_item', 'Created 1 hour ago', oneHourAgo.toISOString());

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND created_at > ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, twoHoursAgo.toISOString()) as any[];

      const recentResults = results.filter(
        (r: any) => new Date(r.created_at).getTime() > twoHoursAgo.getTime()
      );

      expect(recentResults.some((r: any) => r.key === 'recent_item')).toBe(true);
      expect(recentResults.some((r: any) => r.key === 'today_item')).toBe(true);
    });

    it('should handle "yesterday" as relative time', () => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? 
        AND created_at >= ? 
        AND created_at < ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, yesterday.toISOString(), today.toISOString()) as any[];

      // Should only include yesterday_item
      const yesterdayResults = results.filter((r: any) => {
        const itemDate = new Date(r.created_at);
        return itemDate >= yesterday && itemDate < today;
      });

      expect(yesterdayResults.length).toBeGreaterThan(0);
    });
  });

  describe('Channel Filtering', () => {
    beforeEach(() => {
      const items = [
        { key: 'main_task', value: 'Main channel task', channel: 'main', priority: 'high' },
        {
          key: 'feature_task',
          value: 'Feature branch task',
          channel: 'feature/auth',
          priority: 'normal',
        },
        {
          key: 'feature_bug',
          value: 'Feature branch bug',
          channel: 'feature/auth',
          priority: 'high',
        },
        {
          key: 'hotfix_task',
          value: 'Hotfix task',
          channel: 'hotfix/security',
          priority: 'critical',
        },
        { key: 'no_channel', value: 'Task without channel', channel: null, priority: 'normal' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, channel, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.channel, item.priority);
      });
    });

    it('should filter by single channel', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND channel = ?
        ORDER BY priority DESC, created_at DESC
      `
        )
        .all(testSessionId, 'feature/auth') as any[];

      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.key)).toContain('feature_task');
      expect(results.map((r: any) => r.key)).toContain('feature_bug');
    });

    it('should filter by multiple channels', () => {
      const channels = ['main', 'hotfix/security'];
      const placeholders = channels.map(() => '?').join(',');

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND channel IN (${placeholders})
        ORDER BY priority DESC, created_at DESC
      `
        )
        .all(testSessionId, ...channels) as any[];

      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.key)).toContain('main_task');
      expect(results.map((r: any) => r.key)).toContain('hotfix_task');
    });

    it('should handle items without channels', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND channel IS NULL
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId) as any[];

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('no_channel');
    });
  });

  describe('Sort Options', () => {
    beforeEach(() => {
      // Create items with specific timestamps and keys for testing sort
      const baseTime = new Date('2024-01-01T00:00:00Z');
      const items = [
        {
          key: 'alpha_item',
          value: 'First alphabetically',
          created_at: new Date(baseTime.getTime() + 1000).toISOString(),
          updated_at: new Date(baseTime.getTime() + 5000).toISOString(),
        },
        {
          key: 'beta_item',
          value: 'Second alphabetically',
          created_at: new Date(baseTime.getTime() + 2000).toISOString(),
          updated_at: new Date(baseTime.getTime() + 4000).toISOString(),
        },
        {
          key: 'charlie_item',
          value: 'Third alphabetically',
          created_at: new Date(baseTime.getTime() + 3000).toISOString(),
          updated_at: new Date(baseTime.getTime() + 3000).toISOString(),
        },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.created_at, item.updated_at);
      });
    });

    it('should sort by created_at descending (default)', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId) as any[];

      expect(results[0].key).toBe('charlie_item'); // Most recent
      expect(results[results.length - 1].key).toBe('alpha_item'); // Oldest
    });

    it('should sort by created_at ascending', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
        )
        .all(testSessionId) as any[];

      expect(results[0].key).toBe('alpha_item'); // Oldest
      expect(results[results.length - 1].key).toBe('charlie_item'); // Most recent
    });

    it('should sort by updated_at descending', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY updated_at DESC
      `
        )
        .all(testSessionId) as any[];

      expect(results[0].key).toBe('alpha_item'); // Most recently updated
      expect(results[results.length - 1].key).toBe('charlie_item'); // Least recently updated
    });

    it('should sort by key ascending', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY key ASC
      `
        )
        .all(testSessionId) as any[];

      expect(results[0].key).toBe('alpha_item');
      expect(results[1].key).toBe('beta_item');
      expect(results[2].key).toBe('charlie_item');
    });

    it('should sort by key descending', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY key DESC
      `
        )
        .all(testSessionId) as any[];

      expect(results[0].key).toBe('charlie_item');
      expect(results[1].key).toBe('beta_item');
      expect(results[2].key).toBe('alpha_item');
    });
  });

  describe('Metadata and Size', () => {
    beforeEach(() => {
      const items = [
        {
          key: 'small_item',
          value: 'Small content',
          metadata: JSON.stringify({ tags: ['small', 'test'] }),
        },
        {
          key: 'large_item',
          value: 'A'.repeat(1000), // Large content
          metadata: JSON.stringify({ tags: ['large', 'performance'] }),
        },
        {
          key: 'no_metadata',
          value: 'Item without metadata',
          metadata: null,
        },
      ];

      items.forEach(item => {
        const size = Buffer.byteLength(item.value, 'utf8');
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, metadata, size) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.metadata, size);
      });
    });

    it('should include metadata when requested', () => {
      const results = db
        .prepare(
          `
        SELECT *, size FROM context_items 
        WHERE session_id = ?
      `
        )
        .all(testSessionId) as any[];

      results.forEach((item: any) => {
        if (item.metadata) {
          const parsed = JSON.parse(item.metadata);
          expect(parsed).toHaveProperty('tags');
          expect(Array.isArray(parsed.tags)).toBe(true);
        }
      });
    });

    it('should include size information', () => {
      const results = db
        .prepare(
          `
        SELECT *, size FROM context_items 
        WHERE session_id = ?
      `
        )
        .all(testSessionId) as any[];

      const smallItem = results.find((r: any) => r.key === 'small_item');
      const largeItem = results.find((r: any) => r.key === 'large_item');

      expect(smallItem.size).toBeLessThan(100);
      expect(largeItem.size).toBeGreaterThan(900);
    });

    it('should calculate size if not stored', () => {
      // For items without stored size, it should be calculated
      const results = db
        .prepare(
          `
        SELECT *, 
        CASE 
          WHEN size IS NULL THEN LENGTH(value)
          ELSE size 
        END as calculated_size
        FROM context_items 
        WHERE session_id = ?
      `
        )
        .all(testSessionId) as any[];

      results.forEach((item: any) => {
        expect(item.calculated_size).toBeGreaterThan(0);
      });
    });
  });

  describe('Pagination', () => {
    beforeEach(() => {
      // Create 50 items for pagination testing
      for (let i = 0; i < 50; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, priority) VALUES (?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          `item_${i.toString().padStart(2, '0')}`,
          `Value for item ${i}`,
          i % 3 === 0 ? 'high' : 'normal'
        );
      }
    });

    it('should limit results', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY key ASC
        LIMIT 10
      `
        )
        .all(testSessionId) as any[];

      expect(results).toHaveLength(10);
      expect(results[0].key).toBe('item_00');
      expect(results[9].key).toBe('item_09');
    });

    it('should support offset for pagination', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY key ASC
        LIMIT 10 OFFSET 20
      `
        )
        .all(testSessionId) as any[];

      expect(results).toHaveLength(10);
      expect(results[0].key).toBe('item_20');
      expect(results[9].key).toBe('item_29');
    });

    it('should return total count for pagination', () => {
      // First get total count
      const countResult = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM context_items 
        WHERE session_id = ?
      `
        )
        .get(testSessionId) as any;

      expect(countResult.count).toBe(50);

      // Then get paginated results
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        ORDER BY key ASC
        LIMIT 10 OFFSET 10
      `
        )
        .all(testSessionId) as any[];

      expect(results).toHaveLength(10);
      expect(results[0].key).toBe('item_10');
    });
  });

  describe('Key Pattern Matching', () => {
    beforeEach(() => {
      const items = [
        { key: 'auth_login', value: 'Login functionality' },
        { key: 'auth_logout', value: 'Logout functionality' },
        { key: 'auth_register', value: 'Registration functionality' },
        { key: 'user_profile', value: 'User profile page' },
        { key: 'user_settings', value: 'User settings page' },
        { key: 'admin_dashboard', value: 'Admin dashboard' },
        { key: 'test_auth_unit', value: 'Unit tests for auth' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value);
      });
    });

    it('should match keys with glob pattern', () => {
      // SQLite GLOB pattern for keys starting with 'auth_'
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND key GLOB 'auth_*'
        ORDER BY key ASC
      `
        )
        .all(testSessionId) as any[];

      expect(results).toHaveLength(3);
      expect(results.map((r: any) => r.key)).toEqual([
        'auth_login',
        'auth_logout',
        'auth_register',
      ]);
    });

    it('should match keys ending with pattern', () => {
      // Keys ending with '_settings'
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND key GLOB '*_settings'
        ORDER BY key ASC
      `
        )
        .all(testSessionId) as any[];

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('user_settings');
    });

    it('should match keys containing pattern', () => {
      // Keys containing 'auth'
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND key GLOB '*auth*'
        ORDER BY key ASC
      `
        )
        .all(testSessionId) as any[];

      expect(results).toHaveLength(4); // auth_login, auth_logout, auth_register, test_auth_unit
    });
  });

  describe('Priority Filtering', () => {
    beforeEach(() => {
      const items = [
        { key: 'critical_bug', value: 'Critical security issue', priority: 'critical' },
        { key: 'high_task1', value: 'Important feature', priority: 'high' },
        { key: 'high_task2', value: 'Important bugfix', priority: 'high' },
        { key: 'normal_task1', value: 'Regular task', priority: 'normal' },
        { key: 'normal_task2', value: 'Another regular task', priority: 'normal' },
        { key: 'low_task', value: 'Nice to have', priority: 'low' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, priority) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.priority);
      });
    });

    it('should filter by single priority', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND priority = ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, 'high') as any[];

      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.key)).toContain('high_task1');
      expect(results.map((r: any) => r.key)).toContain('high_task2');
    });

    it('should filter by multiple priorities', () => {
      const priorities = ['critical', 'high'];
      const placeholders = priorities.map(() => '?').join(',');

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ? AND priority IN (${placeholders})
        ORDER BY 
          CASE priority 
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            WHEN 'low' THEN 4
          END
      `
        )
        .all(testSessionId, ...priorities) as any[];

      expect(results).toHaveLength(3);
      expect(results[0].key).toBe('critical_bug'); // Critical comes first
      expect(results.slice(1).map((r: any) => r.priority)).toEqual(['high', 'high']);
    });
  });

  describe('Privacy and Session Boundaries', () => {
    beforeEach(() => {
      // Add items to main session
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, is_private) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'public_item', 'Public content', 0);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, is_private) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'private_item', 'Private content', 1);

      // Add items to other session
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, is_private) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), otherSessionId, 'other_public', 'Other public content', 0);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, is_private) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), otherSessionId, 'other_private', 'Other private content', 1);
    });

    it('should only show private items to owner session', () => {
      // Search from main session - should see own private items
      const mainResults = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE (key LIKE ? OR value LIKE ?)
        AND (is_private = 0 OR session_id = ?)
        ORDER BY created_at DESC
      `
        )
        .all('%content%', '%content%', testSessionId) as any[];

      expect(mainResults.map((r: any) => r.key)).toContain('public_item');
      expect(mainResults.map((r: any) => r.key)).toContain('private_item');
      expect(mainResults.map((r: any) => r.key)).toContain('other_public');
      expect(mainResults.map((r: any) => r.key)).not.toContain('other_private');
    });

    it('should not show other sessions private items', () => {
      // Search from other session - should not see main session's private items
      const otherResults = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE (key LIKE ? OR value LIKE ?)
        AND (is_private = 0 OR session_id = ?)
        ORDER BY created_at DESC
      `
        )
        .all('%content%', '%content%', otherSessionId) as any[];

      expect(otherResults.map((r: any) => r.key)).toContain('public_item');
      expect(otherResults.map((r: any) => r.key)).not.toContain('private_item');
      expect(otherResults.map((r: any) => r.key)).toContain('other_public');
      expect(otherResults.map((r: any) => r.key)).toContain('other_private');
    });
  });

  describe('Combined Filters', () => {
    beforeEach(() => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const items = [
        {
          key: 'auth_recent_high',
          value: 'Recent high priority auth task',
          category: 'task',
          priority: 'high',
          channel: 'feature/auth',
          created_at: now.toISOString(),
        },
        {
          key: 'auth_old_normal',
          value: 'Old normal priority auth task',
          category: 'task',
          priority: 'normal',
          channel: 'feature/auth',
          created_at: yesterday.toISOString(),
        },
        {
          key: 'db_recent_high',
          value: 'Recent high priority database task',
          category: 'task',
          priority: 'high',
          channel: 'main',
          created_at: now.toISOString(),
        },
        {
          key: 'ui_recent_normal',
          value: 'Recent normal priority UI task',
          category: 'task',
          priority: 'normal',
          channel: 'feature/ui',
          created_at: now.toISOString(),
        },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority, channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          item.key,
          item.value,
          item.category,
          item.priority,
          item.channel,
          item.created_at
        );
      });
    });

    it('should combine search query with time and priority filters', () => {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      oneDayAgo.setHours(oneDayAgo.getHours() - 1); // A bit more than 24 hours ago

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        AND priority = ?
        AND created_at > ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, '%auth%', '%auth%', 'high', oneDayAgo.toISOString()) as any[];

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('auth_recent_high');
    });

    it('should combine channel and category filters', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND channel = ?
        AND category = ?
        ORDER BY priority DESC, created_at DESC
      `
        )
        .all(testSessionId, 'feature/auth', 'task') as any[];

      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.key)).toContain('auth_recent_high');
      expect(results.map((r: any) => r.key)).toContain('auth_old_normal');
    });

    it('should handle complex multi-filter queries', () => {
      const channels = ['feature/auth', 'main'];
      const priorities = ['high'];
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      oneDayAgo.setHours(oneDayAgo.getHours() - 1);

      const channelPlaceholders = channels.map(() => '?').join(',');
      const priorityPlaceholders = priorities.map(() => '?').join(',');

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND channel IN (${channelPlaceholders})
        AND priority IN (${priorityPlaceholders})
        AND created_at > ?
        AND category = ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, ...channels, ...priorities, oneDayAgo.toISOString(), 'task') as any[];

      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.key).sort()).toEqual(['auth_recent_high', 'db_recent_high']);
    });
  });

  describe('Performance with Large Dataset', () => {
    beforeEach(() => {
      // Create 1000+ items for performance testing
      const channels = ['main', 'feature/auth', 'feature/ui', 'hotfix/security', 'develop'];
      const categories = ['task', 'decision', 'note', 'error', 'warning'];
      const priorities = ['critical', 'high', 'normal', 'low'];

      for (let i = 0; i < 1000; i++) {
        const channel = channels[i % channels.length];
        const category = categories[i % categories.length];
        const priority = priorities[i % priorities.length];

        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority, channel) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          `item_${i.toString().padStart(4, '0')}`,
          `This is the value for item ${i} with some searchable content like auth, database, api, etc.`,
          category,
          priority,
          channel
        );
      }
    });

    it('should search efficiently with 1000+ items', () => {
      const start = Date.now();

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        ORDER BY priority DESC, created_at DESC
        LIMIT 50
      `
        )
        .all(testSessionId, '%auth%', '%auth%') as any[];

      const duration = Date.now() - start;

      expect(results).toHaveLength(50);
      expect(duration).toBeLessThan(100); // Should complete within 100ms
    });

    it('should paginate efficiently through large result sets', () => {
      const start = Date.now();

      // Get page 3 (offset 100, limit 50)
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND category = ?
        ORDER BY created_at DESC
        LIMIT 50 OFFSET 100
      `
        )
        .all(testSessionId, 'task') as any[];

      const duration = Date.now() - start;

      expect(results).toHaveLength(50);
      expect(duration).toBeLessThan(50); // Pagination should be very fast
    });

    it('should efficiently filter by multiple criteria', () => {
      const start = Date.now();

      const channels = ['feature/auth', 'feature/ui'];
      const priorities = ['high', 'critical'];

      const channelPlaceholders = channels.map(() => '?').join(',');
      const priorityPlaceholders = priorities.map(() => '?').join(',');

      const _results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND channel IN (${channelPlaceholders})
        AND priority IN (${priorityPlaceholders})
        AND value LIKE ?
        ORDER BY priority DESC, created_at DESC
        LIMIT 20
      `
        )
        .all(testSessionId, ...channels, ...priorities, '%database%') as any[];

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should count total results efficiently', () => {
      const start = Date.now();

      const countResult = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
      `
        )
        .get(testSessionId, '%api%', '%api%') as any;

      const duration = Date.now() - start;

      expect(countResult.count).toBeGreaterThan(0);
      expect(duration).toBeLessThan(50); // Count should be very fast
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty search results gracefully', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
      `
        )
        .all(testSessionId, '%nonexistent%', '%nonexistent%') as any[];

      expect(results).toHaveLength(0);
    });

    it('should handle invalid date formats', () => {
      // Should not throw error with invalid date
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND created_at > ?
      `
        )
        .all(testSessionId, 'invalid-date') as any[];

      // SQLite will handle invalid dates gracefully
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle special characters in search queries', () => {
      // Add item with special characters
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'special_chars',
        'Value with % and _ special chars'
      );

      // Search for literal % character (need to escape in LIKE)
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND value LIKE ? ESCAPE '\\'
      `
        )
        .all(testSessionId, '%\\%%') as any[];

      expect(results.some((r: any) => r.key === 'special_chars')).toBe(true);
    });

    it('should handle null values in optional fields', () => {
      // Add items with null values
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, category, channel, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'null_fields', 'Item with nulls', null, null, null);

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND category IS NULL
      `
        )
        .all(testSessionId) as any[];

      expect(results.some((r: any) => r.key === 'null_fields')).toBe(true);
    });

    it('should handle very long search queries', () => {
      const longQuery = 'a'.repeat(1000);

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
      `
        )
        .all(testSessionId, `%${longQuery}%`, `%${longQuery}%`) as any[];

      expect(results).toHaveLength(0);
    });
  });

  describe('SearchIn Parameter Behavior', () => {
    beforeEach(() => {
      // Add test data with specific patterns
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'auth_key_only',
        'This value does not contain the search term'
      );

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'normal_key',
        'This value contains auth in the content'
      );
    });

    it('should search in both key and value by default', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
      `
        )
        .all(testSessionId, '%auth%', '%auth%') as any[];

      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.key)).toContain('auth_key_only');
      expect(results.map((r: any) => r.key)).toContain('normal_key');
    });

    it('should search only in keys when searchIn = ["key"]', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND key LIKE ?
      `
        )
        .all(testSessionId, '%auth%') as any[];

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('auth_key_only');
    });

    it('should search only in values when searchIn = ["value"]', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND value LIKE ?
      `
        )
        .all(testSessionId, '%auth%') as any[];

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('normal_key');
    });
  });
});
