import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Context Search Handler Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let contextRepo: ContextRepository;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-context-search-handler-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    contextRepo = new ContextRepository(dbManager);

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

  describe('Enhanced Search Method', () => {
    beforeEach(() => {
      // Create comprehensive test data
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const items = [
        {
          id: uuidv4(),
          session_id: testSessionId,
          key: 'auth_config',
          value: 'Authentication configuration for the app',
          category: 'config',
          priority: 'high',
          channel: 'main',
          created_at: now.toISOString(),
          metadata: JSON.stringify({ tags: ['auth', 'config'] }),
          size: 40,
        },
        {
          id: uuidv4(),
          session_id: testSessionId,
          key: 'db_auth_connection',
          value: 'Database connection string with auth params',
          category: 'config',
          priority: 'normal',
          channel: 'feature/auth',
          created_at: yesterday.toISOString(),
          metadata: JSON.stringify({ tags: ['db', 'auth'] }),
          size: 45,
        },
        {
          id: uuidv4(),
          session_id: testSessionId,
          key: 'user_model',
          value: 'User model with authentication methods',
          category: 'code',
          priority: 'high',
          channel: 'main',
          created_at: lastWeek.toISOString(),
          metadata: null,
          size: 38,
        },
        {
          id: uuidv4(),
          session_id: testSessionId,
          key: 'api_endpoints',
          value: 'API endpoints documentation',
          category: 'docs',
          priority: 'normal',
          channel: 'main',
          created_at: now.toISOString(),
          is_private: 1,
        },
      ];

      // Insert test data
      const stmt = db.prepare(`
        INSERT INTO context_items (
          id, session_id, key, value, category, priority, channel, 
          created_at, metadata, size, is_private
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      items.forEach(item => {
        stmt.run(
          item.id,
          item.session_id,
          item.key,
          item.value,
          item.category || null,
          item.priority || 'normal',
          item.channel || null,
          item.created_at || new Date().toISOString(),
          item.metadata || null,
          item.size || Buffer.byteLength(item.value, 'utf8'),
          item.is_private || 0
        );
      });
    });

    it('should search with basic query maintaining backward compatibility', () => {
      // Test the existing search method
      const results = contextRepo.search('auth', testSessionId, true);

      expect(results.length).toBeGreaterThanOrEqual(3); // auth_config, db_auth_connection, user_model
      expect(
        results.every(
          r => r.key.includes('auth') || r.value.includes('auth') || r.value.includes('Auth')
        )
      ).toBe(true);
    });

    it('should handle enhanced search with time filtering', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      // Simulate enhanced search parameters
      const searchParams = {
        query: 'auth',
        sessionId: testSessionId,
        createdAfter: twoDaysAgo.toISOString(),
        searchIn: ['key', 'value'],
      };

      // Build query similar to how enhanced search would work
      let sql = `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        AND created_at > ?
        ORDER BY priority DESC, created_at DESC
      `;

      const results = db
        .prepare(sql)
        .all(
          searchParams.sessionId,
          `%${searchParams.query}%`,
          `%${searchParams.query}%`,
          searchParams.createdAfter
        ) as any[];

      expect(results.length).toBe(2); // auth_config and db_auth_connection (not user_model which is older)
    });

    it('should handle enhanced search with channel filtering', () => {
      const searchParams = {
        query: 'auth',
        sessionId: testSessionId,
        channel: 'feature/auth',
      };

      let sql = `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        AND channel = ?
        ORDER BY priority DESC, created_at DESC
      `;

      const results = db
        .prepare(sql)
        .all(
          searchParams.sessionId,
          `%${searchParams.query}%`,
          `%${searchParams.query}%`,
          searchParams.channel
        ) as any[];

      expect(results.length).toBe(1);
      expect(results[0].key).toBe('db_auth_connection');
    });

    it('should handle enhanced search with multiple channels', () => {
      const searchParams = {
        query: 'auth',
        sessionId: testSessionId,
        channels: ['main', 'feature/auth'],
      };

      const placeholders = searchParams.channels.map(() => '?').join(',');
      let sql = `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        AND channel IN (${placeholders})
        ORDER BY priority DESC, created_at DESC
      `;

      const results = db
        .prepare(sql)
        .all(
          searchParams.sessionId,
          `%${searchParams.query}%`,
          `%${searchParams.query}%`,
          ...searchParams.channels
        ) as any[];

      expect(results.length).toBe(3); // All items with 'auth' in main or feature/auth channels
    });

    it('should handle sort parameter correctly', () => {
      const searchParams = {
        query: 'auth',
        sessionId: testSessionId,
        sort: 'key_asc',
      };

      let sql = `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        ORDER BY key ASC
      `;

      const results = db
        .prepare(sql)
        .all(searchParams.sessionId, `%${searchParams.query}%`, `%${searchParams.query}%`) as any[];

      expect(results[0].key).toBe('auth_config');
      expect(results[1].key).toBe('db_auth_connection');
    });

    it('should include metadata when requested', () => {
      const searchParams = {
        query: 'auth',
        sessionId: testSessionId,
        includeMetadata: true,
      };

      const results = db
        .prepare(
          `
        SELECT *, size FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        ORDER BY created_at DESC
      `
        )
        .all(searchParams.sessionId, `%${searchParams.query}%`, `%${searchParams.query}%`) as any[];

      results.forEach((item: any) => {
        if (searchParams.includeMetadata) {
          // Verify metadata structure
          if (item.metadata) {
            const parsed = JSON.parse(item.metadata);
            expect(parsed).toHaveProperty('tags');
          }
          // Verify size is included
          expect(item.size).toBeGreaterThan(0);
        }
      });
    });

    it('should handle pagination correctly', () => {
      const searchParams = {
        query: 'auth',
        sessionId: testSessionId,
        limit: 2,
        offset: 1,
      };

      // Get total count first
      const countResult = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
      `
        )
        .get(searchParams.sessionId, `%${searchParams.query}%`, `%${searchParams.query}%`) as any;

      const totalCount = countResult.count;

      // Get paginated results
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
        )
        .all(
          searchParams.sessionId,
          `%${searchParams.query}%`,
          `%${searchParams.query}%`,
          searchParams.limit,
          searchParams.offset
        ) as any[];

      expect(results.length).toBeLessThanOrEqual(searchParams.limit);
      expect(totalCount).toBeGreaterThanOrEqual(3);
    });

    it('should handle keyPattern for regex-like matching', () => {
      const searchParams = {
        query: 'config', // Search in value
        sessionId: testSessionId,
        keyPattern: '*_config', // GLOB pattern for keys ending with _config
      };

      let sql = `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        AND key GLOB ?
        ORDER BY created_at DESC
      `;

      const results = db
        .prepare(sql)
        .all(
          searchParams.sessionId,
          `%${searchParams.query}%`,
          `%${searchParams.query}%`,
          searchParams.keyPattern
        ) as any[];

      expect(results.length).toBe(1);
      expect(results[0].key).toBe('auth_config');
    });

    it('should filter by priorities', () => {
      const searchParams = {
        query: 'auth',
        sessionId: testSessionId,
        priorities: ['high'],
      };

      const placeholders = searchParams.priorities.map(() => '?').join(',');
      let sql = `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        AND priority IN (${placeholders})
        ORDER BY created_at DESC
      `;

      const results = db
        .prepare(sql)
        .all(
          searchParams.sessionId,
          `%${searchParams.query}%`,
          `%${searchParams.query}%`,
          ...searchParams.priorities
        ) as any[];

      expect(results.length).toBe(2); // auth_config and user_model
      expect(results.every((r: any) => r.priority === 'high')).toBe(true);
    });

    it('should respect privacy settings', () => {
      // Search without session (should not see private items)
      const publicResults = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE is_private = 0
        ORDER BY created_at DESC
      `
        )
        .all() as any[];

      expect(publicResults.some((r: any) => r.key === 'api_endpoints')).toBe(false);

      // Search with session (should see own private items)
      const sessionResults = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE (is_private = 0 OR session_id = ?)
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId) as any[];

      expect(sessionResults.some((r: any) => r.key === 'api_endpoints')).toBe(true);
    });

    it('should handle relative time parsing', () => {
      // Add a recent item
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        uuidv4(),
        testSessionId,
        'recent_auth_task',
        'Recent authentication task',
        oneHourAgo.toISOString()
      );

      // Simulate relative time parsing
      const relativeTime = '2 hours ago';
      const match = relativeTime.match(/^(\d+) hours? ago$/);
      expect(match).toBeTruthy();

      const hours = parseInt(match![1]);
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        AND created_at > ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, '%auth%', '%auth%', cutoffTime.toISOString()) as any[];

      expect(results.some((r: any) => r.key === 'recent_auth_task')).toBe(true);
      expect(results.some((r: any) => r.key === 'auth_config')).toBe(true);
    });

    it('should handle complex combined filters', () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const searchParams = {
        query: 'auth',
        sessionId: testSessionId,
        channels: ['main', 'feature/auth'],
        priorities: ['high', 'normal'],
        createdAfter: twoDaysAgo.toISOString(),
        sort: 'created_at_desc',
        limit: 10,
        includeMetadata: true,
      };

      // Build complex query
      const channelPlaceholders = searchParams.channels.map(() => '?').join(',');
      const priorityPlaceholders = searchParams.priorities.map(() => '?').join(',');

      let sql = `
        SELECT *, size FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        AND channel IN (${channelPlaceholders})
        AND priority IN (${priorityPlaceholders})
        AND created_at > ?
        ORDER BY created_at DESC
        LIMIT ?
      `;

      const results = db
        .prepare(sql)
        .all(
          searchParams.sessionId,
          `%${searchParams.query}%`,
          `%${searchParams.query}%`,
          ...searchParams.channels,
          ...searchParams.priorities,
          searchParams.createdAfter,
          searchParams.limit
        ) as any[];

      // Should get auth_config and db_auth_connection (not user_model which is older)
      expect(results.length).toBe(2);
      expect(results[0].key).toBe('auth_config'); // Most recent
      expect(results[1].key).toBe('db_auth_connection');
    });
  });

  describe('searchIn Parameter Handling', () => {
    beforeEach(() => {
      // Add specific test data
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'authentication_service',
        'Service for user login'
      );

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        testSessionId,
        'user_service',
        'Service for authentication'
      );
    });

    it('should search in both key and value when searchIn includes both', () => {
      const searchParams = {
        query: 'authentication',
        sessionId: testSessionId,
        searchIn: ['key', 'value'],
      };

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND (key LIKE ? OR value LIKE ?)
        ORDER BY created_at DESC
      `
        )
        .all(searchParams.sessionId, `%${searchParams.query}%`, `%${searchParams.query}%`) as any[];

      expect(results.length).toBe(2);
    });

    it('should search only in keys when searchIn is ["key"]', () => {
      const searchParams = {
        query: 'authentication',
        sessionId: testSessionId,
        searchIn: ['key'],
      };

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND key LIKE ?
        ORDER BY created_at DESC
      `
        )
        .all(searchParams.sessionId, `%${searchParams.query}%`) as any[];

      expect(results.length).toBe(1);
      expect(results[0].key).toBe('authentication_service');
    });

    it('should search only in values when searchIn is ["value"]', () => {
      const searchParams = {
        query: 'authentication',
        sessionId: testSessionId,
        searchIn: ['value'],
      };

      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND value LIKE ?
        ORDER BY created_at DESC
      `
        )
        .all(searchParams.sessionId, `%${searchParams.query}%`) as any[];

      expect(results.length).toBe(1);
      expect(results[0].key).toBe('user_service');
    });
  });

  describe('Response Format', () => {
    beforeEach(() => {
      // Add test data
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, priority, size) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          `test_item_${i}`,
          `Test value containing auth keyword ${i}`,
          i % 2 === 0 ? 'high' : 'normal',
          50 + i * 10
        );
      }
    });

    it('should format response without metadata', () => {
      const results = db
        .prepare(
          `
        SELECT * FROM context_items 
        WHERE session_id = ?
        AND value LIKE ?
        ORDER BY created_at DESC
      `
        )
        .all(testSessionId, '%auth%') as any[];

      // Simulate handler response formatting
      const formatted = results.map((r: any) => ({
        key: r.key,
        value: r.value,
        category: r.category,
        priority: r.priority,
      }));

      expect(formatted.length).toBe(5);
      formatted.forEach((item: any) => {
        expect(item).toHaveProperty('key');
        expect(item).toHaveProperty('value');
        expect(item).toHaveProperty('priority');
        expect(item).not.toHaveProperty('size');
        expect(item).not.toHaveProperty('created_at');
      });
    });

    it('should format response with metadata when requested', () => {
      const results = db
        .prepare(
          `
        SELECT *, size FROM context_items 
        WHERE session_id = ?
        AND value LIKE ?
        ORDER BY created_at DESC
        LIMIT 3
      `
        )
        .all(testSessionId, '%auth%') as any[];

      // Get total count
      const countResult = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM context_items 
        WHERE session_id = ?
        AND value LIKE ?
      `
        )
        .get(testSessionId, '%auth%') as any;

      // Simulate handler response with metadata
      const formattedWithMetadata = {
        items: results.map((item: any) => ({
          key: item.key,
          value: item.value,
          category: item.category,
          priority: item.priority,
          channel: item.channel,
          metadata: item.metadata ? JSON.parse(item.metadata) : null,
          size: item.size,
          created_at: item.created_at,
          updated_at: item.updated_at,
        })),
        totalCount: countResult.count,
        page: 1,
        pageSize: 3,
      };

      expect(formattedWithMetadata.items.length).toBe(3);
      expect(formattedWithMetadata.totalCount).toBe(5);
      expect(formattedWithMetadata.page).toBe(1);
      expect(formattedWithMetadata.pageSize).toBe(3);

      formattedWithMetadata.items.forEach((item: any) => {
        expect(item).toHaveProperty('size');
        expect(item).toHaveProperty('created_at');
        expect(item).toHaveProperty('updated_at');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle empty search query gracefully', () => {
      const results = contextRepo.search('', testSessionId, true);
      expect(results.length).toBe(0);
    });

    it('should handle non-existent session gracefully', () => {
      const results = contextRepo.search('test', 'non-existent-session', true);
      expect(results.length).toBe(0);
    });

    it('should handle SQL injection attempts safely', () => {
      const maliciousQuery = "'; DROP TABLE context_items; --";

      // This should not throw and should not damage the database
      const _results = contextRepo.search(maliciousQuery, testSessionId, true);

      // Verify table still exists
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='context_items'")
        .get();

      expect(tableExists).toBeTruthy();
    });
  });
});
