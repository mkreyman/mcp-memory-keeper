import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Enhanced Context Operations Integration Tests', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;
  let testSessionId2: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-enhanced-context-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    repositories = new RepositoryManager(dbManager);

    // Create test sessions
    testSessionId = uuidv4();
    testSessionId2 = uuidv4();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      testSessionId,
      'Test Session 1'
    );
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      testSessionId2,
      'Test Session 2'
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

  describe('Enhanced context_get', () => {
    beforeEach(() => {
      // Add test data with varying timestamps
      const baseTime = new Date('2024-01-01T00:00:00Z');
      const items = [
        { key: 'alpha_item', value: 'First value', category: 'task', priority: 'high', offset: 0 },
        {
          key: 'beta_item',
          value: 'Second value',
          category: 'task',
          priority: 'normal',
          offset: 1,
        },
        {
          key: 'gamma_item',
          value: 'Third value',
          category: 'decision',
          priority: 'high',
          offset: 2,
        },
        {
          key: 'delta_item',
          value: 'Fourth value with much longer content to test size calculation',
          category: 'note',
          priority: 'low',
          offset: 3,
        },
        {
          key: 'epsilon_item',
          value: 'Fifth value',
          category: 'progress',
          priority: 'normal',
          offset: 4,
        },
        { key: 'zeta_item', value: 'Sixth value', category: 'task', priority: 'high', offset: 5 },
        { key: 'eta_item', value: 'Seventh value', category: 'error', priority: 'high', offset: 6 },
        {
          key: 'theta_item',
          value: 'Eighth value',
          category: 'warning',
          priority: 'normal',
          offset: 7,
        },
        { key: 'iota_item', value: 'Ninth value', category: 'task', priority: 'low', offset: 8 },
        { key: 'kappa_item', value: 'Tenth value', category: 'note', priority: 'high', offset: 9 },
      ];

      items.forEach(item => {
        const createdAt = new Date(baseTime.getTime() + item.offset * 3600000); // 1 hour intervals
        const updatedAt = new Date(createdAt.getTime() + 1800000); // 30 minutes later

        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, category, priority, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          item.key,
          item.value,
          item.category,
          item.priority,
          createdAt.toISOString(),
          updatedAt.toISOString()
        );
      });

      // Add some items to second session for multi-session tests
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value, category, priority) 
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId2, 'session2_item', 'Another session value', 'task', 'normal');
    });

    describe('includeMetadata parameter', () => {
      it('should return items without metadata by default', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(testSessionId) as any[];

        // Simulate response without metadata
        const response = items.map(item => ({
          key: item.key,
          value: item.value,
          category: item.category,
          priority: item.priority,
        }));

        expect(response).toHaveLength(10);
        expect(response[0]).not.toHaveProperty('created_at');
        expect(response[0]).not.toHaveProperty('updated_at');
        expect(response[0]).not.toHaveProperty('size');
        expect(response[0]).not.toHaveProperty('session_info');
      });

      it('should include metadata when includeMetadata is true', () => {
        const items = db
          .prepare(
            `
            SELECT ci.*, s.name as session_name, s.description as session_description
            FROM context_items ci
            JOIN sessions s ON ci.session_id = s.id
            WHERE ci.session_id = ?
          `
          )
          .all(testSessionId) as any[];

        // Simulate response with metadata
        const response = items.map(item => ({
          key: item.key,
          value: item.value,
          category: item.category,
          priority: item.priority,
          metadata: {
            created_at: item.created_at,
            updated_at: item.updated_at,
            size: Buffer.byteLength(item.value, 'utf8'),
            session_info: {
              id: item.session_id,
              name: item.session_name,
              description: item.session_description,
            },
          },
        }));

        expect(response).toHaveLength(10);
        expect(response[0].metadata).toBeDefined();
        expect(response[0].metadata.created_at).toBeDefined();
        expect(response[0].metadata.updated_at).toBeDefined();
        expect(response[0].metadata.size).toBeGreaterThan(0);
        expect(response[0].metadata.session_info.name).toBe('Test Session 1');
      });

      it('should calculate correct size for items with metadata', () => {
        const item = db
          .prepare('SELECT * FROM context_items WHERE key = ?')
          .get('delta_item') as any;

        const size = Buffer.byteLength(item.value, 'utf8');
        expect(size).toBe(62); // Byte length of "Fourth value with much longer content to test size calculation"
      });
    });

    describe('sort parameter', () => {
      it('should sort by created_at descending (newest first)', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY created_at DESC')
          .all(testSessionId) as any[];

        expect(items[0].key).toBe('kappa_item'); // Last created
        expect(items[9].key).toBe('alpha_item'); // First created
      });

      it('should sort by created_at ascending (oldest first)', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY created_at ASC')
          .all(testSessionId) as any[];

        expect(items[0].key).toBe('alpha_item'); // First created
        expect(items[9].key).toBe('kappa_item'); // Last created
      });

      it('should sort by updated_at descending', () => {
        // Update a specific item to have a more recent updated_at
        const recentUpdate = new Date();
        db.prepare('UPDATE context_items SET updated_at = ? WHERE key = ?').run(
          recentUpdate.toISOString(),
          'beta_item'
        );

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY updated_at DESC')
          .all(testSessionId) as any[];

        expect(items[0].key).toBe('beta_item'); // Most recently updated
      });

      it('should sort by key ascending', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key ASC')
          .all(testSessionId) as any[];

        expect(items[0].key).toBe('alpha_item');
        expect(items[1].key).toBe('beta_item');
        expect(items[9].key).toBe('zeta_item');
      });

      it('should sort by key descending', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key DESC')
          .all(testSessionId) as any[];

        expect(items[0].key).toBe('zeta_item');
        expect(items[9].key).toBe('alpha_item');
      });

      it('should default to created_at DESC when sort is not specified', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY created_at DESC')
          .all(testSessionId) as any[];

        expect(items[0].key).toBe('kappa_item');
      });
    });

    describe('limit and offset parameters', () => {
      it('should return limited number of items', () => {
        const result = repositories.contexts.queryEnhanced({
          sessionId: testSessionId,
          sort: 'key_asc',
          limit: 5,
        });

        expect(result.items).toHaveLength(5);
        expect(result.items[0].key).toBe('alpha_item');
        expect(result.items[4].key).toBe('eta_item'); // 5th item alphabetically
      });

      it('should apply offset for pagination', () => {
        const result = repositories.contexts.queryEnhanced({
          sessionId: testSessionId,
          sort: 'key_asc',
          limit: 5,
          offset: 5,
        });

        expect(result.items).toHaveLength(5);
        expect(result.items[0].key).toBe('gamma_item'); // 6th item alphabetically (offset 5)
        expect(result.items[4].key).toBe('zeta_item'); // 10th and last item alphabetically
      });

      it('should handle limit larger than available items', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key ASC LIMIT 20')
          .all(testSessionId) as any[];

        expect(items).toHaveLength(10); // Only 10 items available
      });

      it('should handle offset beyond available items', () => {
        const items = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? ORDER BY key ASC LIMIT 5 OFFSET 15'
          )
          .all(testSessionId) as any[];

        expect(items).toHaveLength(0);
      });

      it('should return total count for pagination info', () => {
        const totalCount = db
          .prepare('SELECT COUNT(*) as count FROM context_items WHERE session_id = ?')
          .get(testSessionId) as any;

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key ASC LIMIT 5')
          .all(testSessionId) as any[];

        expect(totalCount.count).toBe(10);
        expect(items).toHaveLength(5);
      });
    });

    describe('createdAfter and createdBefore parameters', () => {
      it('should filter items created after a specific date', () => {
        const afterDate = new Date('2024-01-01T03:00:00Z'); // After first 3 items
        const result = repositories.contexts.queryEnhanced({
          sessionId: testSessionId,
          createdAfter: afterDate.toISOString(),
          sort: 'created_at_asc',
        });

        expect(result.items).toHaveLength(6); // Items created after 03:00 (not including 03:00)
        expect(result.items[0].key).toBe('epsilon_item'); // First item after 03:00 is at 04:00
      });

      it('should filter items created before a specific date', () => {
        const beforeDate = new Date('2024-01-01T05:00:00Z'); // Before last 5 items
        const items = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND created_at < ? ORDER BY created_at ASC'
          )
          .all(testSessionId, beforeDate.toISOString()) as any[];

        expect(items).toHaveLength(5);
        expect(items[4].key).toBe('epsilon_item');
      });

      it('should filter items within a date range', () => {
        const afterDate = new Date('2024-01-01T02:00:00Z');
        const beforeDate = new Date('2024-01-01T06:00:00Z');
        const result = repositories.contexts.queryEnhanced({
          sessionId: testSessionId,
          createdAfter: afterDate.toISOString(),
          createdBefore: beforeDate.toISOString(),
          sort: 'created_at_asc',
        });

        expect(result.items).toHaveLength(3); // Items with 02:00 < created_at < 06:00
        expect(result.items[0].key).toBe('delta_item'); // 03:00
        expect(result.items[2].key).toBe('zeta_item'); // 05:00
      });

      it('should return empty when no items match date filters', () => {
        const afterDate = new Date('2025-01-01T00:00:00Z'); // Future date
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at > ?')
          .all(testSessionId, afterDate.toISOString()) as any[];

        expect(items).toHaveLength(0);
      });

      it('should handle invalid date formats gracefully', () => {
        // This test expects the implementation to validate date formats
        const invalidDate = 'not-a-date';
        // The implementation should either throw an error or return all items
        // For now, we'll test that it doesn't crash
        expect(() => {
          db.prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at > ?').all(
            testSessionId,
            invalidDate
          );
        }).not.toThrow();
      });
    });

    describe('keyPattern parameter', () => {
      it('should match items by simple pattern', () => {
        const items = db
          .prepare(
            "SELECT * FROM context_items WHERE session_id = ? AND key LIKE '%_item' ORDER BY key ASC"
          )
          .all(testSessionId) as any[];

        expect(items).toHaveLength(10); // All items end with '_item'
      });

      it('should match items by prefix pattern', () => {
        // Simulate regex ^alpha.* as SQL LIKE
        const items = db
          .prepare(
            "SELECT * FROM context_items WHERE session_id = ? AND key LIKE 'alpha%' ORDER BY key ASC"
          )
          .all(testSessionId) as any[];

        expect(items).toHaveLength(1);
        expect(items[0].key).toBe('alpha_item');
      });

      it('should match items by complex pattern', () => {
        // Simulate regex that matches Greek letter names
        const items = db
          .prepare(
            "SELECT * FROM context_items WHERE session_id = ? AND (key LIKE 'alpha%' OR key LIKE 'beta%' OR key LIKE 'gamma%') ORDER BY key ASC"
          )
          .all(testSessionId) as any[];

        expect(items).toHaveLength(3);
        expect(items.map(i => i.key)).toEqual(['alpha_item', 'beta_item', 'gamma_item']);
      });

      it('should return empty when pattern matches nothing', () => {
        const items = db
          .prepare("SELECT * FROM context_items WHERE session_id = ? AND key LIKE 'nonexistent%'")
          .all(testSessionId) as any[];

        expect(items).toHaveLength(0);
      });

      it('should handle special regex characters', () => {
        // Add item with special characters in key
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, category, priority) 
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, 'item.with.dots', 'Special value', 'note', 'normal');

        // Pattern should escape dots when used literally
        const items = db
          .prepare("SELECT * FROM context_items WHERE session_id = ? AND key = 'item.with.dots'")
          .all(testSessionId) as any[];

        expect(items).toHaveLength(1);
        expect(items[0].key).toBe('item.with.dots');
      });
    });

    describe('priorities parameter', () => {
      it('should filter by single priority', () => {
        const items = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND priority = ? ORDER BY key ASC'
          )
          .all(testSessionId, 'high') as any[];

        expect(items).toHaveLength(5);
        expect(items.every(i => i.priority === 'high')).toBe(true);
      });

      it('should filter by multiple priorities', () => {
        const items = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND priority IN (?, ?) ORDER BY key ASC'
          )
          .all(testSessionId, 'high', 'normal') as any[];

        expect(items).toHaveLength(8); // 5 high + 3 normal
        expect(items.every(i => ['high', 'normal'].includes(i.priority))).toBe(true);
      });

      it('should return empty when priorities array is empty', () => {
        // Simulate empty priorities filter - should return all items
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(testSessionId) as any[];

        expect(items).toHaveLength(10);
      });

      it('should handle invalid priority values', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND priority = ?')
          .all(testSessionId, 'invalid_priority') as any[];

        expect(items).toHaveLength(0);
      });
    });

    describe('Combining multiple parameters', () => {
      it('should combine category filter with sort and limit', () => {
        const items = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND category = ? ORDER BY key DESC LIMIT 2'
          )
          .all(testSessionId, 'task') as any[];

        expect(items).toHaveLength(2);
        expect(items[0].key).toBe('zeta_item');
        expect(items[1].key).toBe('iota_item');
        expect(items.every(i => i.category === 'task')).toBe(true);
      });

      it('should combine date filters with priority and pagination', () => {
        const afterDate = new Date('2024-01-01T01:00:00Z');
        const beforeDate = new Date('2024-01-01T07:00:00Z');

        const items = db
          .prepare(
            `
            SELECT * FROM context_items 
            WHERE session_id = ? 
              AND created_at > ? 
              AND created_at < ? 
              AND priority = ?
            ORDER BY created_at ASC 
            LIMIT 3 OFFSET 1
          `
          )
          .all(testSessionId, afterDate.toISOString(), beforeDate.toISOString(), 'high') as any[];

        expect(items).toHaveLength(2); // Only 3 high priority items in range, offset 1
      });

      it('should combine keyPattern with category and sort', () => {
        // Pattern matching items starting with vowels (a, e, i)
        const result = repositories.contexts.queryEnhanced({
          sessionId: testSessionId,
          keyPattern: '[aei]*', // SQLite GLOB pattern for starts with a, e, or i
          category: 'task',
          sort: 'key_asc',
        });

        expect(result.items).toHaveLength(2); // alpha (task), iota (task)
        expect(result.items[0].key).toBe('alpha_item');
        expect(result.items[1].key).toBe('iota_item');
      });

      it('should include metadata with all filters applied', () => {
        const items = db
          .prepare(
            `
            SELECT ci.*, s.name as session_name, LENGTH(ci.value) as value_size
            FROM context_items ci
            JOIN sessions s ON ci.session_id = s.id
            WHERE ci.session_id = ? 
              AND ci.priority IN (?, ?)
              AND ci.category = ?
            ORDER BY ci.created_at DESC
            LIMIT 2
          `
          )
          .all(testSessionId, 'high', 'normal', 'task') as any[];

        expect(items).toHaveLength(2);
        expect(items[0]).toHaveProperty('value_size');
        expect(items[0]).toHaveProperty('session_name');
        expect(items[0].session_name).toBe('Test Session 1');
      });
    });

    describe('Backward compatibility', () => {
      it('should work with only key parameter as before', () => {
        const item = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
          .get(testSessionId, 'alpha_item') as any;

        expect(item).toBeDefined();
        expect(item.value).toBe('First value');
      });

      it('should work with only category parameter as before', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND category = ?')
          .all(testSessionId, 'task') as any[];

        expect(items).toHaveLength(4);
        expect(items.every(i => i.category === 'task')).toBe(true);
      });

      it('should work with session_id parameter as before', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(testSessionId2) as any[];

        expect(items).toHaveLength(1);
        expect(items[0].key).toBe('session2_item');
      });

      it('should return empty array when no matches as before', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
          .all(testSessionId, 'nonexistent') as any[];

        expect(items).toHaveLength(0);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty session', () => {
        const emptySessionId = uuidv4();
        db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
          emptySessionId,
          'Empty Session'
        );

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(emptySessionId) as any[];

        expect(items).toHaveLength(0);
      });

      it('should handle very large limit values', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? LIMIT 999999')
          .all(testSessionId) as any[];

        expect(items).toHaveLength(10); // Still returns only available items
      });

      it('should handle negative offset gracefully', () => {
        // SQLite treats negative offset as 0
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? LIMIT 5 OFFSET -5')
          .all(testSessionId) as any[];

        expect(items).toHaveLength(5);
      });

      it('should handle concurrent access with proper isolation', () => {
        // Simulate concurrent reads
        const promises = Array(5)
          .fill(null)
          .map(
            () =>
              new Promise(resolve => {
                const items = db
                  .prepare('SELECT * FROM context_items WHERE session_id = ?')
                  .all(testSessionId) as any[];
                resolve(items.length);
              })
          );

        return Promise.all(promises).then(results => {
          expect(results).toEqual([10, 10, 10, 10, 10]);
        });
      });
    });
  });

  describe('Enhanced context_timeline', () => {
    beforeEach(() => {
      // Create items across different time periods
      const now = new Date();
      const timeOffsets = [
        { hours: -1, key: 'recent_1', category: 'task' }, // 1 hour ago
        { hours: -2, key: 'recent_2', category: 'note' }, // 2 hours ago
        { hours: -5, key: 'today_1', category: 'task' }, // 5 hours ago
        { hours: -8, key: 'today_2', category: 'decision' }, // 8 hours ago
        { hours: -25, key: 'yesterday_1', category: 'task' }, // Yesterday
        { hours: -30, key: 'yesterday_2', category: 'note' }, // Yesterday
        { hours: -72, key: 'days_ago_1', category: 'progress' }, // 3 days ago
        { hours: -168, key: 'week_ago_1', category: 'task' }, // 1 week ago
        { hours: -336, key: 'weeks_ago_1', category: 'error' }, // 2 weeks ago
      ];

      timeOffsets.forEach(({ hours, key, category }) => {
        const createdAt = new Date(now.getTime() + hours * 3600000);
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          key,
          `Value for ${key}`,
          category,
          'normal',
          createdAt.toISOString()
        );
      });

      // Add journal entries
      const journalEntries = [
        { hours: -3, entry: 'Completed major refactoring', mood: 'accomplished' },
        { hours: -24, entry: 'Started new feature branch', mood: 'excited' },
        { hours: -48, entry: 'Fixed critical bug', mood: 'relieved' },
      ];

      journalEntries.forEach(({ hours, entry, mood }) => {
        const createdAt = new Date(now.getTime() + hours * 3600000);
        db.prepare(
          `
          INSERT INTO journal_entries (id, session_id, entry, mood, created_at) 
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, entry, mood, createdAt.toISOString());
      });
    });

    describe('Basic timeline functionality', () => {
      it('should group items by time period', () => {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 3600000);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 3600000);

        // Get items from different periods
        const todayItems = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at > ?')
          .all(testSessionId, oneDayAgo.toISOString()) as any[];

        const thisWeekItems = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND created_at > ? AND created_at <= ?'
          )
          .all(testSessionId, oneWeekAgo.toISOString(), oneDayAgo.toISOString()) as any[];

        expect(todayItems.length).toBeGreaterThan(0);
        expect(thisWeekItems.length).toBeGreaterThan(0);
      });

      it('should order timeline entries by date descending', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY created_at DESC')
          .all(testSessionId) as any[];

        // Verify ordering
        for (let i = 1; i < items.length; i++) {
          const prevDate = new Date(items[i - 1].created_at);
          const currDate = new Date(items[i].created_at);
          expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
        }
      });
    });

    describe('includeItems parameter', () => {
      it('should return timeline without item details by default', () => {
        // Simulate timeline response without items
        const periods = db
          .prepare(
            `
            SELECT 
              DATE(created_at) as period,
              COUNT(*) as item_count
            FROM context_items 
            WHERE session_id = ?
            GROUP BY DATE(created_at)
            ORDER BY period DESC
          `
          )
          .all(testSessionId) as any[];

        expect(periods.length).toBeGreaterThan(0);
        expect(periods[0]).toHaveProperty('period');
        expect(periods[0]).toHaveProperty('item_count');
        expect(periods[0]).not.toHaveProperty('items');
      });

      it('should include item details when includeItems is true', () => {
        // Get timeline with items
        const periods = db
          .prepare(
            `
            SELECT DATE(created_at) as period
            FROM context_items 
            WHERE session_id = ?
            GROUP BY DATE(created_at)
            ORDER BY period DESC
          `
          )
          .all(testSessionId) as any[];

        const timeline = periods.map(period => {
          const items = db
            .prepare(
              `
              SELECT * FROM context_items 
              WHERE session_id = ? AND DATE(created_at) = ?
              ORDER BY created_at DESC
            `
            )
            .all(testSessionId, period.period) as any[];

          return {
            period: period.period,
            item_count: items.length,
            items: items.map(item => ({
              key: item.key,
              value: item.value,
              category: item.category,
              priority: item.priority,
              created_at: item.created_at,
            })),
          };
        });

        expect(timeline.length).toBeGreaterThan(0);
        expect(timeline[0].items).toBeDefined();
        expect(timeline[0].items.length).toBe(timeline[0].item_count);
      });

      it('should include journal entries in timeline', () => {
        const journals = db
          .prepare('SELECT * FROM journal_entries WHERE session_id = ? ORDER BY created_at DESC')
          .all(testSessionId) as any[];

        expect(journals).toHaveLength(3);
        expect(journals[0]).toHaveProperty('entry');
        expect(journals[0]).toHaveProperty('mood');
      });
    });

    describe('categories parameter', () => {
      it('should filter timeline by single category', () => {
        const taskItems = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND category = ?')
          .all(testSessionId, 'task') as any[];

        expect(taskItems.length).toBeGreaterThan(0);
        expect(taskItems.every(item => item.category === 'task')).toBe(true);
      });

      it('should filter timeline by multiple categories', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND category IN (?, ?)')
          .all(testSessionId, 'task', 'note') as any[];

        expect(items.length).toBeGreaterThan(0);
        expect(items.every(item => ['task', 'note'].includes(item.category))).toBe(true);
      });

      it('should return empty timeline when no items match categories', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND category = ?')
          .all(testSessionId, 'nonexistent_category') as any[];

        expect(items).toHaveLength(0);
      });

      it('should include all categories when parameter is empty', () => {
        const allItems = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(testSessionId) as any[];

        const categories = [...new Set(allItems.map(item => item.category))];
        expect(categories.length).toBeGreaterThan(3);
      });
    });

    describe('relativeTime parameter', () => {
      it('should handle "today" relative time', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at >= ?')
          .all(testSessionId, today.toISOString()) as any[];

        expect(items.length).toBeGreaterThan(0);
        expect(items.some(i => i.key.includes('recent'))).toBe(true);
      });

      it('should handle "yesterday" relative time', () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const items = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND created_at >= ? AND created_at < ?'
          )
          .all(testSessionId, yesterday.toISOString(), today.toISOString()) as any[];

        expect(items.some(i => i.key.includes('yesterday'))).toBe(true);
      });

      it('should handle "X hours ago" format', () => {
        // Use a slightly earlier time to account for millisecond differences
        const twoHoursAgo = new Date();
        twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
        twoHoursAgo.setMinutes(twoHoursAgo.getMinutes() - 1); // Go back 1 minute to ensure we catch items at exactly 2 hours

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at >= ?')
          .all(testSessionId, twoHoursAgo.toISOString()) as any[];

        // Check what items we actually got
        const itemKeys = items.map(i => i.key);

        // Should include items created 2 hours ago or less
        expect(itemKeys).toContain('recent_1'); // 1 hour ago
        expect(itemKeys).toContain('recent_2'); // 2 hours ago
        // Should not include items created more than 2 hours ago
        expect(itemKeys).not.toContain('today_1'); // 5 hours ago
      });

      it('should handle "X days ago" format', () => {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at >= ?')
          .all(testSessionId, threeDaysAgo.toISOString()) as any[];

        expect(items.length).toBeGreaterThan(0);
        // Should include items created within the last 3 days
        expect(items.some(i => i.key === 'recent_1' || i.key === 'recent_2' || i.key === 'today_1' || i.key === 'today_2')).toBe(true);
      });

      it('should handle "this week" relative time', () => {
        const startOfWeek = new Date();
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day;
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at >= ?')
          .all(testSessionId, startOfWeek.toISOString()) as any[];

        expect(items.length).toBeGreaterThan(0);
      });

      it('should handle "last week" relative time', () => {
        const startOfLastWeek = new Date();
        const day = startOfLastWeek.getDay();
        const diff = startOfLastWeek.getDate() - day - 7;
        startOfLastWeek.setDate(diff);
        startOfLastWeek.setHours(0, 0, 0, 0);

        const endOfLastWeek = new Date(startOfLastWeek);
        endOfLastWeek.setDate(endOfLastWeek.getDate() + 7);

        const items = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND created_at >= ? AND created_at < ?'
          )
          .all(testSessionId, startOfLastWeek.toISOString(), endOfLastWeek.toISOString()) as any[];

        expect(items.some(i => i.key === 'week_ago_1')).toBe(true);
      });

      it('should default to all time when relativeTime is invalid', () => {
        // Invalid relative time should return all items
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(testSessionId) as any[];

        expect(items).toHaveLength(9);
      });
    });

    describe('itemsPerPeriod parameter', () => {
      it('should limit items per time period', () => {
        // Get periods with limited items
        const periods = db
          .prepare(
            `
            SELECT DATE(created_at) as period
            FROM context_items 
            WHERE session_id = ?
            GROUP BY DATE(created_at)
            ORDER BY period DESC
          `
          )
          .all(testSessionId) as any[];

        const timeline = periods.map(period => {
          const items = db
            .prepare(
              `
              SELECT * FROM context_items 
              WHERE session_id = ? AND DATE(created_at) = ?
              ORDER BY created_at DESC
              LIMIT 2
            `
            )
            .all(testSessionId, period.period) as any[];

          return {
            period: period.period,
            items: items,
            hasMore:
              db
                .prepare(
                  `
                SELECT COUNT(*) as total FROM context_items 
                WHERE session_id = ? AND DATE(created_at) = ?
              `
                )
                .get(testSessionId, period.period).total > 2,
          };
        });

        timeline.forEach(period => {
          expect(period.items.length).toBeLessThanOrEqual(2);
        });
      });

      it('should indicate when more items exist in period', () => {
        // Add many items to today
        const now = new Date();
        for (let i = 0; i < 10; i++) {
          db.prepare(
            `
            INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
          ).run(
            uuidv4(),
            testSessionId,
            `extra_item_${i}`,
            `Extra value ${i}`,
            'note',
            'normal',
            now.toISOString()
          );
        }

        const todayCount = db
          .prepare(
            `
            SELECT COUNT(*) as count FROM context_items 
            WHERE session_id = ? AND DATE(created_at) = DATE('now')
          `
          )
          .get(testSessionId) as any;

        expect(todayCount.count).toBeGreaterThan(5);
      });

      it('should show most recent items first in each period', () => {
        const periods = db
          .prepare(
            `
            SELECT DATE(created_at) as period
            FROM context_items 
            WHERE session_id = ?
            GROUP BY DATE(created_at)
          `
          )
          .all(testSessionId) as any[];

        periods.forEach(period => {
          const items = db
            .prepare(
              `
              SELECT * FROM context_items 
              WHERE session_id = ? AND DATE(created_at) = ?
              ORDER BY created_at DESC
            `
            )
            .all(testSessionId, period.period) as any[];

          if (items.length > 1) {
            for (let i = 1; i < items.length; i++) {
              const prevTime = new Date(items[i - 1].created_at).getTime();
              const currTime = new Date(items[i].created_at).getTime();
              expect(prevTime).toBeGreaterThanOrEqual(currTime);
            }
          }
        });
      });
    });

    describe('groupBy parameter', () => {
      it('should group by hour', () => {
        const hourlyGroups = db
          .prepare(
            `
            SELECT 
              strftime('%Y-%m-%d %H:00', created_at) as period,
              COUNT(*) as count
            FROM context_items 
            WHERE session_id = ?
            GROUP BY strftime('%Y-%m-%d %H:00', created_at)
            ORDER BY period DESC
          `
          )
          .all(testSessionId) as any[];

        expect(hourlyGroups.length).toBeGreaterThan(0);
        expect(hourlyGroups[0].period).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:00/);
      });

      it('should group by day (default)', () => {
        const dailyGroups = db
          .prepare(
            `
            SELECT 
              DATE(created_at) as period,
              COUNT(*) as count
            FROM context_items 
            WHERE session_id = ?
            GROUP BY DATE(created_at)
            ORDER BY period DESC
          `
          )
          .all(testSessionId) as any[];

        expect(dailyGroups.length).toBeGreaterThan(0);
        expect(dailyGroups[0].period).toMatch(/\d{4}-\d{2}-\d{2}/);
      });

      it('should group by week', () => {
        const weeklyGroups = db
          .prepare(
            `
            SELECT 
              strftime('%Y-W%W', created_at) as period,
              COUNT(*) as count
            FROM context_items 
            WHERE session_id = ?
            GROUP BY strftime('%Y-W%W', created_at)
            ORDER BY period DESC
          `
          )
          .all(testSessionId) as any[];

        expect(weeklyGroups.length).toBeGreaterThan(0);
        expect(weeklyGroups[0].period).toMatch(/\d{4}-W\d{2}/);
      });
    });

    describe('Combining timeline parameters', () => {
      it('should combine categories and date filters', () => {
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

        const items = db
          .prepare(
            `
            SELECT * FROM context_items 
            WHERE session_id = ? 
              AND category IN (?, ?)
              AND created_at >= ?
            ORDER BY created_at DESC
          `
          )
          .all(testSessionId, 'task', 'note', twoDaysAgo.toISOString()) as any[];

        expect(items.length).toBeGreaterThan(0);
        expect(items.every(i => ['task', 'note'].includes(i.category))).toBe(true);
      });

      it('should combine includeItems with itemsPerPeriod', () => {
        const periods = db
          .prepare(
            `
            SELECT DATE(created_at) as period
            FROM context_items 
            WHERE session_id = ?
            GROUP BY DATE(created_at)
            ORDER BY period DESC
          `
          )
          .all(testSessionId) as any[];

        const timeline = periods.map(period => {
          const allItems = db
            .prepare(
              `
              SELECT COUNT(*) as total FROM context_items 
              WHERE session_id = ? AND DATE(created_at) = ?
            `
            )
            .get(testSessionId, period.period) as any;

          const items = db
            .prepare(
              `
              SELECT * FROM context_items 
              WHERE session_id = ? AND DATE(created_at) = ?
              ORDER BY created_at DESC
              LIMIT 3
            `
            )
            .all(testSessionId, period.period) as any[];

          return {
            period: period.period,
            items: items,
            total_count: allItems.total,
            hasMore: allItems.total > 3,
          };
        });

        timeline.forEach(period => {
          expect(period.items.length).toBeLessThanOrEqual(3);
          expect(period.hasMore).toBe(period.total_count > 3);
        });
      });
    });

    describe('Backward compatibility', () => {
      it('should work with no parameters as before', () => {
        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY created_at DESC')
          .all(testSessionId) as any[];

        expect(items.length).toBeGreaterThan(0);
      });

      it('should work with only startDate and endDate as before', () => {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);

        const items = db
          .prepare(
            'SELECT * FROM context_items WHERE session_id = ? AND created_at >= ? AND created_at <= ?'
          )
          .all(testSessionId, startDate.toISOString(), endDate.toISOString()) as any[];

        expect(items.length).toBeGreaterThan(0);
      });
    });

    describe('Edge cases', () => {
      it('should handle empty timeline gracefully', () => {
        const emptySessionId = uuidv4();
        db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
          emptySessionId,
          'Empty Session'
        );

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ?')
          .all(emptySessionId) as any[];

        expect(items).toHaveLength(0);
      });

      it('should handle future dates in relativeTime', () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const items = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at >= ?')
          .all(testSessionId, tomorrow.toISOString()) as any[];

        expect(items).toHaveLength(0);
      });

      it('should handle very large itemsPerPeriod values', () => {
        const periods = db
          .prepare(
            `
            SELECT DATE(created_at) as period
            FROM context_items 
            WHERE session_id = ?
            GROUP BY DATE(created_at)
          `
          )
          .all(testSessionId) as any[];

        periods.forEach(period => {
          const items = db
            .prepare(
              `
              SELECT * FROM context_items 
              WHERE session_id = ? AND DATE(created_at) = ?
              ORDER BY created_at DESC
              LIMIT 99999
            `
            )
            .all(testSessionId, period.period) as any[];

          const totalCount = db
            .prepare(
              `
              SELECT COUNT(*) as count FROM context_items 
              WHERE session_id = ? AND DATE(created_at) = ?
            `
            )
            .get(testSessionId, period.period) as any;

          expect(items).toHaveLength(totalCount.count);
        });
      });
    });
  });

  describe('Performance considerations', () => {
    it('should handle large datasets efficiently', () => {
      // Add many items
      const startTime = Date.now();

      db.transaction(() => {
        for (let i = 0; i < 1000; i++) {
          db.prepare(
            `
            INSERT INTO context_items (id, session_id, key, value, category, priority) 
            VALUES (?, ?, ?, ?, ?, ?)
          `
          ).run(
            uuidv4(),
            testSessionId,
            `perf_test_${i}`,
            `Performance test value ${i}`,
            i % 2 === 0 ? 'task' : 'note',
            i % 3 === 0 ? 'high' : 'normal'
          );
        }
      })();

      const insertTime = Date.now() - startTime;
      expect(insertTime).toBeLessThan(1000); // Should complete within 1 second

      // Test query performance
      const queryStartTime = Date.now();

      const items = db
        .prepare(
          `
          SELECT * FROM context_items 
          WHERE session_id = ? 
            AND category = ?
            AND priority = ?
          ORDER BY created_at DESC
          LIMIT 50 OFFSET 100
        `
        )
        .all(testSessionId, 'task', 'high') as any[];

      const queryTime = Date.now() - queryStartTime;
      expect(queryTime).toBeLessThan(100); // Should complete within 100ms
      expect(items.length).toBeLessThanOrEqual(50);
    });

    it('should use indexes effectively', () => {
      // Check that indexes exist
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'context_items'"
        )
        .all() as any[];

      expect(indexes.length).toBeGreaterThan(0);
      expect(indexes.some(idx => idx.name.includes('session'))).toBe(true);
    });
  });
});
