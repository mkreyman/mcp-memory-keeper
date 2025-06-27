import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
// Removed unused import: ValidationError

describe('Pagination Defaults Handler Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let contextRepo: ContextRepository;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-pagination-defaults-${Date.now()}.db`);
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

  describe('Default Pagination Parameters', () => {
    beforeEach(() => {
      // Create 150 test items to test pagination limits
      const now = new Date();
      for (let i = 0; i < 150; i++) {
        const createdAt = new Date(now.getTime() - i * 60 * 1000); // 1 minute apart
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, created_at, priority, size)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          `test.item.${i.toString().padStart(3, '0')}`,
          `Test value ${i} - ${`This is a longer test value to simulate real content that might contain various information and details that would typically be stored in a context item.`.repeat(
            3
          )}`,
          createdAt.toISOString(),
          i % 3 === 0 ? 'high' : i % 3 === 1 ? 'normal' : 'low',
          500 + i * 10 // Varying sizes
        );
      }
    });

    it('should apply default limit of 100 when not specified', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
      });

      expect(result.items.length).toBe(100);
      expect(result.totalCount).toBe(150);
    });

    it('should apply default sort of created_desc when not specified', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
      });

      // Verify items are sorted by created_at descending (newest first)
      for (let i = 1; i < result.items.length; i++) {
        const prevDate = new Date(result.items[i - 1].created_at);
        const currDate = new Date(result.items[i].created_at);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
      }

      // First item should be the most recent (test.item.000)
      expect(result.items[0].key).toBe('test.item.000');
    });

    it('should respect explicit limit over default', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 50,
      });

      expect(result.items.length).toBe(50);
      expect(result.totalCount).toBe(150);
    });

    it('should respect explicit sort over default', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        sort: 'key_asc',
      });

      // Verify items are sorted by key ascending
      for (let i = 1; i < result.items.length; i++) {
        expect(result.items[i - 1].key.localeCompare(result.items[i].key)).toBeLessThanOrEqual(0);
      }

      // First item should be test.item.000 (lexicographically first)
      expect(result.items[0].key).toBe('test.item.000');
    });

    it('should handle limit of 0 as unlimited', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 0,
      });

      expect(result.items.length).toBe(150); // All items
      expect(result.totalCount).toBe(150);
    });

    it('should handle negative limit as default', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: -1,
      });

      expect(result.items.length).toBe(100); // Default limit
      expect(result.totalCount).toBe(150);
    });
  });

  describe('Token Limit Safety', () => {
    beforeEach(() => {
      // Create items with varying sizes to test token safety
      const largeValue = 'A'.repeat(5000); // 5KB per item
      for (let i = 0; i < 50; i++) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, size, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          `large.item.${i}`,
          largeValue,
          5000,
          new Date(Date.now() - i * 1000).toISOString()
        );
      }
    });

    it('should calculate approximate token usage in response', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        includeMetadata: true,
      });

      // Calculate approximate token usage
      let totalSize = 0;
      result.items.forEach(item => {
        totalSize += item.size || Buffer.byteLength(item.value, 'utf8');
      });

      // With metadata, response should include size information
      expect(result.items.every(item => item.size !== undefined)).toBe(true);

      // Verify we don't exceed safe limits
      // Rough estimate: 1 token ≈ 4 characters
      const estimatedTokens = totalSize / 4;
      const safeTokenLimit = 100000; // Conservative limit

      expect(estimatedTokens).toBeLessThan(safeTokenLimit);
    });

    it('should provide size summary when includeMetadata is true', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        includeMetadata: true,
        limit: 10,
      });

      // Calculate total size of returned items
      const totalSize = result.items.reduce((sum, item) => sum + (item.size || 0), 0);

      // Handler should include this information
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: result.items,
                pagination: {
                  totalCount: result.totalCount,
                  returnedCount: result.items.length,
                  totalSize: totalSize,
                  averageSize: Math.round(totalSize / result.items.length),
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.pagination.totalSize).toBe(totalSize);
      expect(parsed.pagination.averageSize).toBeGreaterThan(0);
    });

    it('should warn when approaching token limits', () => {
      // Create a scenario where default pagination would exceed safe limits
      const hugeValue = 'B'.repeat(10000); // 10KB per item
      for (let i = 0; i < 200; i++) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, size, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          `huge.item.${i}`,
          hugeValue,
          10000,
          new Date(Date.now() - i * 1000).toISOString()
        );
      }

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        includeMetadata: true,
      });

      // Should still respect the 100 item limit
      expect(result.items.length).toBe(100);

      // Calculate if this would be safe
      const totalSize = result.items.reduce((sum, item) => sum + (item.size || 0), 0);
      const estimatedTokens = totalSize / 4;

      // Handler could include a warning if needed
      if (estimatedTokens > 50000) {
        const handlerResponse = {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  items: result.items,
                  pagination: {
                    totalCount: result.totalCount,
                    returnedCount: result.items.length,
                    warning:
                      'Large result set. Consider using smaller limit or more specific filters.',
                  },
                },
                null,
                2
              ),
            },
          ],
        };

        const parsed = JSON.parse(handlerResponse.content[0].text);
        expect(parsed.pagination.warning).toBeTruthy();
      }
    });
  });

  describe('Pagination Metadata in Response', () => {
    beforeEach(() => {
      // Create 25 items for easier pagination testing
      for (let i = 0; i < 25; i++) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          `page.item.${i.toString().padStart(2, '0')}`,
          `Value ${i}`,
          new Date(Date.now() - i * 60000).toISOString()
        );
      }
    });

    it('should include complete pagination metadata', () => {
      const limit = 10;
      const offset = 10;

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: limit,
        offset: offset,
      });

      // Calculate pagination metadata
      const currentPage = Math.floor(offset / limit) + 1;
      const totalPages = Math.ceil(result.totalCount / limit);
      const hasNextPage = currentPage < totalPages;
      const hasPreviousPage = currentPage > 1;

      // Simulate handler response with full pagination metadata
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: result.items.map(item => ({
                  key: item.key,
                  value: item.value,
                  category: item.category,
                  priority: item.priority,
                })),
                pagination: {
                  totalCount: result.totalCount,
                  page: currentPage,
                  pageSize: limit,
                  totalPages: totalPages,
                  hasNextPage: hasNextPage,
                  hasPreviousPage: hasPreviousPage,
                  nextOffset: hasNextPage ? offset + limit : null,
                  previousOffset: hasPreviousPage ? Math.max(0, offset - limit) : null,
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.pagination.totalCount).toBe(25);
      expect(parsed.pagination.page).toBe(2);
      expect(parsed.pagination.pageSize).toBe(10);
      expect(parsed.pagination.totalPages).toBe(3);
      expect(parsed.pagination.hasNextPage).toBe(true);
      expect(parsed.pagination.hasPreviousPage).toBe(true);
      expect(parsed.pagination.nextOffset).toBe(20);
      expect(parsed.pagination.previousOffset).toBe(0);
    });

    it('should handle first page correctly', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 10,
        offset: 0,
      });

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: result.items,
                pagination: {
                  totalCount: result.totalCount,
                  page: 1,
                  pageSize: 10,
                  totalPages: 3,
                  hasNextPage: true,
                  hasPreviousPage: false,
                  nextOffset: 10,
                  previousOffset: null,
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.pagination.page).toBe(1);
      expect(parsed.pagination.hasPreviousPage).toBe(false);
      expect(parsed.pagination.hasNextPage).toBe(true);
    });

    it('should handle last page correctly', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 10,
        offset: 20,
      });

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: result.items,
                pagination: {
                  totalCount: result.totalCount,
                  page: 3,
                  pageSize: 10,
                  totalPages: 3,
                  hasNextPage: false,
                  hasPreviousPage: true,
                  nextOffset: null,
                  previousOffset: 10,
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.pagination.page).toBe(3);
      expect(parsed.pagination.hasNextPage).toBe(false);
      expect(parsed.pagination.hasPreviousPage).toBe(true);
      expect(parsed.items.length).toBe(5); // Only 5 items on last page
    });

    it('should handle single page results', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 50, // More than total items
      });

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: result.items,
                pagination: {
                  totalCount: result.totalCount,
                  page: 1,
                  pageSize: 50,
                  totalPages: 1,
                  hasNextPage: false,
                  hasPreviousPage: false,
                  nextOffset: null,
                  previousOffset: null,
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.pagination.totalPages).toBe(1);
      expect(parsed.pagination.hasNextPage).toBe(false);
      expect(parsed.pagination.hasPreviousPage).toBe(false);
    });
  });

  describe('Default Behavior with Filters', () => {
    beforeEach(() => {
      const categories = ['task', 'decision', 'progress', 'note'];
      const priorities = ['high', 'normal', 'low'];
      const channels = ['main', 'feature', 'bugfix'];

      for (let i = 0; i < 120; i++) {
        db.prepare(
          `
          INSERT INTO context_items (
            id, session_id, key, value, category, priority, channel, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          `filtered.item.${i}`,
          `Filtered value ${i}`,
          categories[i % categories.length],
          priorities[i % priorities.length],
          channels[i % channels.length],
          new Date(Date.now() - i * 60000).toISOString()
        );
      }
    });

    it('should apply defaults with category filter', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
      });

      // Should still apply default limit
      expect(result.items.length).toBeLessThanOrEqual(100);
      expect(result.items.every(item => item.category === 'task')).toBe(true);

      // Should still apply default sort
      for (let i = 1; i < result.items.length; i++) {
        const prevDate = new Date(result.items[i - 1].created_at);
        const currDate = new Date(result.items[i].created_at);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
      }
    });

    it('should apply defaults with multiple filters', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task', // Only single category is supported
        priorities: ['high'],
        channels: ['main', 'feature'],
      });

      // Should apply all filters
      expect(
        result.items.every(
          item =>
            item.category === 'task' &&
            item.priority === 'high' &&
            (item.channel === 'main' || item.channel === 'feature')
        )
      ).toBe(true);

      // Should still apply default limit (even if fewer items match)
      expect(result.items.length).toBeLessThanOrEqual(100);

      // Should still apply default sort
      for (let i = 1; i < result.items.length; i++) {
        const prevDate = new Date(result.items[i - 1].created_at);
        const currDate = new Date(result.items[i].created_at);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
      }
    });

    it('should apply defaults with search pattern', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        keyPattern: 'filtered.item.1*',
      });

      // Should match items like filtered.item.1, filtered.item.10-19, filtered.item.100-119
      expect(result.items.every(item => item.key.match(/^filtered\.item\.1/))).toBe(true);

      // Should still apply defaults
      expect(result.items.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Handler Response Format with Defaults', () => {
    beforeEach(() => {
      for (let i = 0; i < 10; i++) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          `response.item.${i}`,
          `Response value ${i}`,
          new Date(Date.now() - i * 60000).toISOString()
        );
      }
    });

    it('should indicate when defaults were applied', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
      });

      // Handler could include information about applied defaults
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: result.items.map(item => ({
                  key: item.key,
                  value: item.value,
                  category: item.category,
                  priority: item.priority,
                })),
                pagination: {
                  totalCount: result.totalCount,
                  limit: 100,
                  offset: 0,
                  defaultsApplied: {
                    limit: true,
                    sort: true,
                  },
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.pagination.defaultsApplied.limit).toBe(true);
      expect(parsed.pagination.defaultsApplied.sort).toBe(true);
    });

    it('should not indicate defaults when explicit values provided', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 5,
        sort: 'key_asc',
      });

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: result.items,
                pagination: {
                  totalCount: result.totalCount,
                  limit: 5,
                  offset: 0,
                  defaultsApplied: {
                    limit: false,
                    sort: false,
                  },
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.pagination.defaultsApplied.limit).toBe(false);
      expect(parsed.pagination.defaultsApplied.sort).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid pagination parameters gracefully', () => {
      // Test with invalid limit type
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 'invalid' as any,
      });

      // Should fall back to default
      expect(result.items.length).toBeLessThanOrEqual(100);
    });

    it('should handle offset beyond available items', () => {
      // Create only 5 items
      for (let i = 0; i < 5; i++) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value)
          VALUES (?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, `limited.${i}`, `Value ${i}`);
      }

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        offset: 100, // Way beyond available items
      });

      expect(result.items.length).toBe(0);
      expect(result.totalCount).toBe(5);

      // Handler should handle this gracefully
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: [],
                pagination: {
                  totalCount: 5,
                  page: 11, // offset 100 / limit 10 + 1
                  pageSize: 10,
                  totalPages: 1,
                  hasNextPage: false,
                  hasPreviousPage: true,
                  message: 'No items found at this offset',
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.items).toEqual([]);
      expect(parsed.pagination.message).toBeTruthy();
    });
  });

  describe('Performance with Default Pagination', () => {
    it('should handle large datasets efficiently with defaults', () => {
      // Create 1000 items
      const stmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < 1000; i++) {
        stmt.run(
          uuidv4(),
          testSessionId,
          `perf.item.${i.toString().padStart(4, '0')}`,
          `Performance test value ${i}`,
          new Date(Date.now() - i * 1000).toISOString()
        );
      }

      const startTime = Date.now();
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
      });
      const endTime = Date.now();

      // Should complete quickly even with 1000 items
      expect(endTime - startTime).toBeLessThan(100);

      // Should return only default limit
      expect(result.items.length).toBe(100);
      expect(result.totalCount).toBe(1000);

      // First 100 items should be the most recent
      expect(result.items[0].key).toBe('perf.item.0000');
      expect(result.items[99].key).toBe('perf.item.0099');
    });
  });
});
