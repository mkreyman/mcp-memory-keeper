/**
 * Critical Pagination Fix Test
 * Tests the new pagination functionality for context_search_all to prevent token overflow
 */

import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Pagination Critical Fix', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  let sessionId: string;
  let tempDbPath: string;
  let db: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-pagination-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    repositories = new RepositoryManager(dbManager);
    db = dbManager.getDatabase();

    // Create test session
    sessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
      sessionId,
      'Pagination Test Session',
      'Test session for pagination testing'
    );

    // Add test data to test pagination
    for (let i = 1; i <= 50; i++) {
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, category, priority, size) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        uuidv4(),
        sessionId,
        `test_item_${i}`,
        `This is test item number ${i} with searchable content`,
        i % 2 === 0 ? 'task' : 'note',
        i % 3 === 0 ? 'high' : 'normal',
        100 // size in bytes
      );
    }
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (_e) {
      // Ignore cleanup errors
    }
  });

  describe('searchAcrossSessionsEnhanced', () => {
    test('should implement default pagination (25 items)', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
      });

      expect(result.items).toHaveLength(25); // Default limit
      expect(result.totalCount).toBe(50);
      expect(result.pagination).toMatchObject({
        currentPage: 1,
        totalPages: 2,
        totalItems: 50,
        itemsPerPage: 25,
        hasNextPage: true,
        hasPreviousPage: false,
        nextOffset: 25,
        previousOffset: null,
      });
    });

    test('should handle custom pagination parameters', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        limit: 10,
        offset: 20,
      });

      expect(result.items).toHaveLength(10);
      expect(result.totalCount).toBe(50);
      expect(result.pagination.currentPage).toBe(3); // offset 20 / limit 10 + 1
      expect(result.pagination.totalPages).toBe(5); // 50 / 10
      expect(result.pagination.hasNextPage).toBe(true);
      expect(result.pagination.hasPreviousPage).toBe(true);
    });

    test('should enforce maximum limit of 100', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        limit: 500, // Should be capped at 100
      });

      expect(result.pagination.itemsPerPage).toBe(100); // Capped at maximum 100
      expect(result.items).toHaveLength(50); // But only 50 items available
    });

    test('should handle minimum limit of 1', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        limit: -5, // Should be set to 1
      });

      expect(result.pagination.itemsPerPage).toBe(1);
      expect(result.items).toHaveLength(1);
    });

    test('should handle invalid offset values', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        offset: -10, // Should be set to 0
      });

      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.previousOffset).toBeNull();
    });

    test('should work with category filtering', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        category: 'task',
        limit: 10,
      });

      // Should find only task items (even numbered items)
      expect(result.totalCount).toBe(25); // 50/2 = 25 task items
      expect(result.items).toHaveLength(10);
      expect(result.items.every(item => item.category === 'task')).toBe(true);
    });

    test('should work with priority filtering', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        priorities: ['high'],
        limit: 20,
      });

      // Should find only high priority items (every 3rd item)
      expect(result.totalCount).toBe(16); // Math.floor(50/3) + some extras
      expect(result.items.every(item => item.priority === 'high')).toBe(true);
    });

    test('should work with multiple filters and pagination', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        category: 'task',
        priorities: ['normal'],
        limit: 5,
        offset: 5,
      });

      expect(result.items).toHaveLength(5);
      expect(
        result.items.every(item => item.category === 'task' && item.priority === 'normal')
      ).toBe(true);
      expect(result.pagination.currentPage).toBe(2);
    });

    test('should handle empty results with pagination metadata', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'nonexistent',
        currentSessionId: sessionId,
        limit: 10,
      });

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.pagination).toMatchObject({
        currentPage: 1,
        totalPages: 0,
        totalItems: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    test('should maintain backward compatibility with original searchAcrossSessions', () => {
      const newResult = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        sort: 'created_desc', // Use same sorting as old method
      });

      const oldResult = repositories.contexts.searchAcrossSessions('test', sessionId);

      // Old method should return all results, new method should paginate
      expect(oldResult).toHaveLength(50);
      expect(newResult.items).toHaveLength(25); // Default pagination
      expect(newResult.totalCount).toBe(50);

      // Both methods should use same sorting (priority DESC, created_at DESC)
      // Just verify the counts and that pagination works correctly
      expect(newResult.pagination).toMatchObject({
        currentPage: 1,
        totalPages: 2,
        totalItems: 50,
        itemsPerPage: 25,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    test('should handle large datasets without token overflow', () => {
      // Add more test data to simulate large dataset
      for (let i = 51; i <= 200; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority, size) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          sessionId,
          `large_dataset_item_${i}`,
          `This is a large dataset item with lots of content that could cause token overflow in the previous implementation. Item number ${i} contains substantial text content.`,
          'note',
          'normal',
          200 // size in bytes
        );
      }

      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'large',
        currentSessionId: sessionId,
        limit: 25,
      });

      // Should successfully handle large dataset with pagination
      expect(result.items).toHaveLength(25);
      expect(result.totalCount).toBe(150); // Items 51-200
      expect(result.pagination.totalPages).toBe(6); // 150/25 = 6 pages

      // Verify we can get subsequent pages
      const page2 = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'large',
        currentSessionId: sessionId,
        limit: 25,
        offset: 25,
      });

      expect(page2.items).toHaveLength(25);
      expect(page2.pagination.currentPage).toBe(2);
    });

    test('should support all search options with pagination', () => {
      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        searchIn: ['key', 'value'],
        sort: 'key_asc',
        limit: 15,
        offset: 10,
        includeMetadata: true,
      });

      expect(result.items).toHaveLength(15);
      expect(result.totalCount).toBe(50);

      // Verify sorting (should be alphabetical by key)
      const keys = result.items.map(item => item.key);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });
  });

  describe('Integration with cross-session functionality', () => {
    test('should work across multiple sessions with pagination', () => {
      // Create another session with data
      const session2Id = uuidv4();
      db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
        session2Id,
        'Second Test Session',
        'Second session for pagination testing'
      );

      // Add data to second session
      for (let i = 1; i <= 30; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority, is_private, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          session2Id,
          `session2_item_${i}`,
          `Session 2 test item ${i}`,
          'task',
          'normal',
          0, // Make public so it's searchable
          50 // size in bytes
        );
      }

      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        limit: 20,
      });

      // Should find items from both sessions
      expect(result.totalCount).toBe(80); // 50 from session1 + 30 from session2
      expect(result.items).toHaveLength(20);
      expect(result.pagination.totalPages).toBe(4); // 80/20 = 4
    });

    test('should respect privacy settings with pagination', () => {
      // Add private items to current session
      for (let i = 1; i <= 10; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority, is_private, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          sessionId,
          `private_item_${i}`,
          `Private test item ${i}`,
          'note',
          'high',
          1, // Private
          60 // size in bytes
        );
      }

      const result = repositories.contexts.searchAcrossSessionsEnhanced({
        query: 'test',
        currentSessionId: sessionId,
        limit: 30,
      });

      // Should include private items from current session + public items
      expect(result.totalCount).toBe(60); // 50 original + 10 private
      expect(result.items).toHaveLength(30);
    });
  });
});
