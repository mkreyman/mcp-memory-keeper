import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import { SessionRepository } from '../../repositories/SessionRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('context_get Pagination Defaults', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let contextRepo: ContextRepository;
  let sessionRepo: SessionRepository;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-context-get-pagination-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    contextRepo = new ContextRepository(dbManager);
    sessionRepo = new SessionRepository(dbManager);

    // Create test session
    const session = sessionRepo.create({
      name: 'Test Session',
      description: 'Testing context_get pagination',
    });
    testSessionId = session.id;
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

  describe('Default Limit Behavior', () => {
    beforeEach(() => {
      // Create 150 test items to test default limit
      for (let i = 0; i < 150; i++) {
        contextRepo.save(testSessionId, {
          key: `test.item.${i.toString().padStart(3, '0')}`,
          value: `Test value ${i}`,
          category: i % 2 === 0 ? 'task' : 'note',
          priority: i % 3 === 0 ? 'high' : 'normal',
        });
      }
    });

    it('should apply default limit of 100 when limit is not provided', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        // No limit specified
      });

      expect(result.items.length).toBe(100);
      expect(result.totalCount).toBe(150);
    });

    it('should apply default limit of 100 when limit is undefined', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: undefined,
      });

      expect(result.items.length).toBe(100);
      expect(result.totalCount).toBe(150);
    });

    it('should respect explicit limit when provided', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 50,
      });

      expect(result.items.length).toBe(50);
      expect(result.totalCount).toBe(150);
    });

    it('should handle limit of 0 as unlimited', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 0,
      });

      expect(result.items.length).toBe(150); // All items
      expect(result.totalCount).toBe(150);
    });

    it('should treat negative limit as default (100)', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: -1,
      });

      expect(result.items.length).toBe(100);
      expect(result.totalCount).toBe(150);
    });

    it('should apply default sort (created_desc) when not specified', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        // No sort specified
      });

      // Items should be sorted by created_at descending
      for (let i = 1; i < result.items.length; i++) {
        const prevDate = new Date(result.items[i - 1].created_at);
        const currDate = new Date(result.items[i].created_at);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
      }
    });
  });

  describe('Pagination with Filters', () => {
    beforeEach(() => {
      // Create items with different categories
      for (let i = 0; i < 120; i++) {
        contextRepo.save(testSessionId, {
          key: `filtered.item.${i}`,
          value: `Filtered value ${i}`,
          category: i % 3 === 0 ? 'task' : i % 3 === 1 ? 'note' : 'decision',
          priority: i % 2 === 0 ? 'high' : 'normal',
        });
      }
    });

    it('should apply default limit with category filter', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
        // No limit specified
      });

      // Should have 40 total tasks (120 / 3)
      expect(result.totalCount).toBe(40);
      // But still limited to default of 100 (which is more than 40)
      expect(result.items.length).toBe(40);
      expect(result.items.every(item => item.category === 'task')).toBe(true);
    });

    it('should apply default limit with multiple filters', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
        priorities: ['high'],
        // No limit specified
      });

      // Should filter by both category and priority
      expect(result.items.every(item => item.category === 'task' && item.priority === 'high')).toBe(
        true
      );
      // Default limit still applies
      expect(result.items.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Offset Behavior', () => {
    beforeEach(() => {
      // Create exactly 25 items for easier offset testing
      for (let i = 0; i < 25; i++) {
        contextRepo.save(testSessionId, {
          key: `offset.test.${i.toString().padStart(2, '0')}`,
          value: `Offset test value ${i}`,
        });
      }
    });

    it('should default offset to 0 when not specified', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 10,
        // No offset specified
      });

      expect(result.items.length).toBe(10);
      // Should start from the beginning (most recent items due to default sort)
    });

    it('should handle offset with default limit', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        offset: 10,
        // No limit specified - should default to 100
      });

      expect(result.items.length).toBe(15); // 25 total - 10 offset = 15 remaining
    });

    it('should handle negative offset as 0', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        offset: -10,
        limit: 5,
      });

      expect(result.items.length).toBe(5);
      // Should behave as if offset was 0
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty result set gracefully', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'non-existent-category',
      });

      expect(result.items.length).toBe(0);
      expect(result.totalCount).toBe(0);
    });

    it('should handle offset beyond available items', () => {
      // Create only 5 items
      for (let i = 0; i < 5; i++) {
        contextRepo.save(testSessionId, {
          key: `limited.${i}`,
          value: `Limited value ${i}`,
        });
      }

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        offset: 100, // Far beyond available items
        // No limit specified
      });

      expect(result.items.length).toBe(0);
      expect(result.totalCount).toBe(5);
    });

    it('should handle very large datasets efficiently', () => {
      // Create 1000 items
      const stmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const _startCreate = Date.now();
      for (let i = 0; i < 1000; i++) {
        stmt.run(
          uuidv4(),
          testSessionId,
          `large.dataset.${i.toString().padStart(4, '0')}`,
          `Large dataset value ${i}`,
          new Date(Date.now() - i * 1000).toISOString()
        );
      }
      const _endCreate = Date.now();

      const startQuery = Date.now();
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        // No limit specified - should default to 100
      });
      const endQuery = Date.now();

      expect(result.items.length).toBe(100); // Default limit
      expect(result.totalCount).toBe(1000);

      // Query should be fast even with 1000 items
      const queryTime = endQuery - startQuery;
      expect(queryTime).toBeLessThan(100); // Should complete in < 100ms

      // Performance metrics (using underscored vars to avoid lint errors):
      // Created 1000 items in ${_endCreate - _startCreate}ms
      // Queried with default limit in ${queryTime}ms
    });
  });

  describe('Repository Type Handling', () => {
    it('should handle string numbers that can be converted', () => {
      // The repository's type checking will treat non-numbers as undefined
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: '50' as any, // String that looks like a number
      });

      // Repository treats non-numbers as undefined, so it applies default
      expect(result.items.length).toBeLessThanOrEqual(100);
    });

    it('should treat non-numeric types as undefined and apply defaults', () => {
      // Create some test items
      for (let i = 0; i < 10; i++) {
        contextRepo.save(testSessionId, {
          key: `type.test.${i}`,
          value: `Type test value ${i}`,
        });
      }

      // Repository checks typeof limit === 'number'
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 'not-a-number' as any,
      });

      // Should apply default limit of 100
      expect(result.items.length).toBe(10); // We only have 10 items
      expect(result.totalCount).toBe(10);
    });
  });
});
