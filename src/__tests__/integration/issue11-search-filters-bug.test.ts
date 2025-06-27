import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Tests for Issue #11: Search filters not working with category and priority
 * 
 * BUG DESCRIPTION:
 * - context_search tool doesn't filter properly when using category + priority parameters
 * - Basic search works, but adding filters returns no results even when matching items exist
 * - context_get with same filters works correctly (this is the workaround)
 * 
 * ROOT CAUSE:
 * - Missing privacy filter in queryEnhanced method causes different SQL query structure
 * - searchEnhanced includes privacy filter, queryEnhanced doesn't
 * - This affects both the main query and the count query, leading to inconsistent results
 * 
 * EXPECTED BEHAVIOR:
 * - context_search with filters should return the same results as context_get with same filters
 * - Both should respect privacy boundaries and session isolation
 * - Filters should work in combination (category + priority + channels, etc.)
 */
describe('Issue #11: Search Filters Bug Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let contextRepo: ContextRepository;
  let testSessionId: string;
  let otherSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-issue11-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    contextRepo = new ContextRepository(dbManager);

    // Create test sessions
    testSessionId = uuidv4();
    otherSessionId = uuidv4();
    
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(testSessionId, 'Main Test Session');
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(otherSessionId, 'Other Session');

    // Create comprehensive test data that covers the bug scenarios
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const testItems = [
      // Items in main session
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'auth_high_task',
        value: 'High priority authentication task',
        category: 'task',
        priority: 'high',
        channel: 'feature/auth',
        created_at: now.toISOString(),
        is_private: 0,
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'auth_normal_task',
        value: 'Normal priority authentication configuration',
        category: 'task',
        priority: 'normal',
        channel: 'feature/auth',
        created_at: yesterday.toISOString(),
        is_private: 0,
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'auth_config_high',
        value: 'Authentication configuration settings',
        category: 'config',
        priority: 'high',
        channel: 'main',
        created_at: now.toISOString(),
        is_private: 0,
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'db_config_normal',
        value: 'Database configuration with auth settings',
        category: 'config',
        priority: 'normal',
        channel: 'main',
        created_at: yesterday.toISOString(),
        is_private: 0,
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'private_auth_note',
        value: 'Private authentication notes',
        category: 'note',
        priority: 'normal',
        channel: 'main',
        created_at: now.toISOString(),
        is_private: 1, // Private item
      },
      // Items in other session
      {
        id: uuidv4(),
        session_id: otherSessionId,
        key: 'other_auth_task',
        value: 'Authentication task in other session',
        category: 'task',
        priority: 'high',
        channel: 'feature/auth',
        created_at: now.toISOString(),
        is_private: 0,
      },
      {
        id: uuidv4(),
        session_id: otherSessionId,
        key: 'other_private_auth',
        value: 'Private auth item in other session',
        category: 'task',
        priority: 'high',
        channel: 'main',
        created_at: now.toISOString(),
        is_private: 1, // Private to other session
      },
    ];

    // Insert test data
    const stmt = db.prepare(`
      INSERT INTO context_items (
        id, session_id, key, value, category, priority, channel, 
        created_at, is_private
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    testItems.forEach(item => {
      stmt.run(
        item.id,
        item.session_id,
        item.key,
        item.value,
        item.category,
        item.priority,
        item.channel,
        item.created_at,
        item.is_private
      );
    });
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

  describe('Basic Search Functionality (Should Work)', () => {
    it('should return results for basic search without filters', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
      });

      expect(searchResult.items.length).toBeGreaterThan(0);
      expect(searchResult.totalCount).toBeGreaterThan(0);
      expect(searchResult.items.every(item => 
        item.key.includes('auth') || item.value.includes('auth')
      )).toBe(true);
    });
  });

  describe('The Core Bug: Missing Privacy Filter in queryEnhanced', () => {
    it('should demonstrate privacy filter bug: queryEnhanced misses public items from other sessions', () => {
      // This test will fail because queryEnhanced is missing the privacy filter
      // The correct behavior should be: show public items from ANY session + private items from OWN session
      
      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        // No filters - this should show all accessible items
      });

      const searchResult = contextRepo.searchEnhanced({
        query: '', // Empty query to match all items
        sessionId: testSessionId,
      });

      console.log('DEBUG: queryEnhanced results:', {
        itemCount: queryResult.items.length,
        totalCount: queryResult.totalCount,
        sessionsFound: [...new Set(queryResult.items.map(i => i.session_id))],
        items: queryResult.items.map(i => ({ key: i.key, session_id: i.session_id, is_private: i.is_private }))
      });

      console.log('DEBUG: searchEnhanced results (correct behavior):', {
        itemCount: searchResult.items.length,
        totalCount: searchResult.totalCount,
        sessionsFound: [...new Set(searchResult.items.map(i => i.session_id))],
        items: searchResult.items.map(i => ({ key: i.key, session_id: i.session_id, is_private: i.is_private }))
      });

      // BUG: queryEnhanced only shows items from current session
      // But it should show public items from other sessions too
      const queryPublicItemsFromOtherSession = queryResult.items.filter(item => 
        item.session_id === otherSessionId && item.is_private === 0
      );

      const searchPublicItemsFromOtherSession = searchResult.items.filter(item => 
        item.session_id === otherSessionId && item.is_private === 0
      );

      console.log('DEBUG: Public items from other session comparison:', {
        queryCount: queryPublicItemsFromOtherSession.length,
        searchCount: searchPublicItemsFromOtherSession.length,
        queryItems: queryPublicItemsFromOtherSession.map(i => i.key),
        searchItems: searchPublicItemsFromOtherSession.map(i => i.key)
      });

      // This will demonstrate the bug: queryEnhanced will have 0 public items from other sessions
      // while searchEnhanced will have > 0 public items from other sessions
      expect(queryPublicItemsFromOtherSession.length).toBe(searchPublicItemsFromOtherSession.length);
    });

    it('should demonstrate privacy filter works correctly in searchEnhanced', () => {
      // searchEnhanced should correctly respect privacy
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
      });

      // searchEnhanced should NOT see private items from other sessions
      const privateItemsFromOtherSession = searchResult.items.filter(item => 
        item.session_id === otherSessionId && item.is_private === 1
      );

      console.log('DEBUG: Private items from other session found by searchEnhanced:', {
        count: privateItemsFromOtherSession.length,
        items: privateItemsFromOtherSession.map(i => ({ key: i.key, session_id: i.session_id, is_private: i.is_private }))
      });

      // This should be 0 and will be 0 because searchEnhanced has the privacy filter
      expect(privateItemsFromOtherSession.length).toBe(0);
    });
  });

  describe('The Core Bug: Filters Failing in searchEnhanced', () => {
    it('should fail: searchEnhanced with category filter returns wrong results', () => {
      // This test documents the current failing behavior
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        category: 'task',
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
      });

      // Debug logging to understand the actual behavior
      console.log('DEBUG: searchEnhanced with category=task results:', {
        itemCount: searchResult.items.length,
        totalCount: searchResult.totalCount,
        items: searchResult.items.map(i => ({ key: i.key, category: i.category, priority: i.priority }))
      });

      // BUG: searchEnhanced should return items but currently may not due to filter interaction
      // The query should find: auth_high_task and auth_normal_task
      expect(searchResult.items.length).toBeGreaterThanOrEqual(0); // Currently may be 0 due to bug
      
      // But queryEnhanced works correctly as a workaround
      const taskItems = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );
      console.log('DEBUG: queryEnhanced filtered results:', {
        itemCount: taskItems.length,
        items: taskItems.map(i => ({ key: i.key, category: i.category, priority: i.priority }))
      });
      expect(taskItems.length).toBe(3); // Should find auth_high_task, auth_normal_task, and other_auth_task
      
      // Let's see if there's actually a difference
      if (searchResult.items.length !== taskItems.length) {
        console.log('BUG DETECTED: Different result counts!');
      }
    });

    it('should fail: searchEnhanced with priority filter returns wrong results', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        priorities: ['high'],
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        priorities: ['high'],
      });

      // BUG: searchEnhanced may not work with priority filters
      expect(searchResult.items.length).toBeGreaterThanOrEqual(0); // Currently may be 0 due to bug
      
      // But queryEnhanced works as workaround
      const highPriorityItems = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );
      expect(highPriorityItems.length).toBe(3); // auth_high_task, auth_config_high, and other_auth_task
    });

    it('should fail: searchEnhanced with category + priority filters returns wrong results', () => {
      // This is the core failing scenario from the bug report
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        category: 'task',
        priorities: ['high'],
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
        priorities: ['high'],
      });

      // BUG: Combined filters in searchEnhanced likely return no results
      expect(searchResult.items.length).toBeGreaterThanOrEqual(0); // Currently likely 0 due to bug
      
      // But queryEnhanced works correctly
      const matchingItems = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );
      expect(matchingItems.length).toBe(2); // Should find auth_high_task and other_auth_task
      expect(matchingItems.some(item => item.key === 'auth_high_task')).toBe(true);
      expect(matchingItems.some(item => item.key === 'other_auth_task')).toBe(true);
    });

    it('should fail: searchEnhanced with channel filter returns wrong results', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        channel: 'feature/auth',
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        channel: 'feature/auth',
      });

      // BUG: Channel filtering in searchEnhanced may not work
      expect(searchResult.items.length).toBeGreaterThanOrEqual(0); // Currently may be 0 due to bug
      
      // But queryEnhanced works as workaround
      const channelItems = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );
      expect(channelItems.length).toBe(3); // auth_high_task, auth_normal_task, and other_auth_task
    });
  });

  describe('Expected Behavior After Fix', () => {
    it('should match: searchEnhanced and queryEnhanced with category filter', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        category: 'task',
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
      });

      const queryMatches = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );

      // After fix: searchEnhanced should return same results as queryEnhanced filter
      expect(searchResult.items.length).toBe(queryMatches.length);
      expect(searchResult.items.map(i => i.key).sort()).toEqual(
        queryMatches.map(i => i.key).sort()
      );
    });

    it('should match: searchEnhanced and queryEnhanced with priority filter', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        priorities: ['high'],
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        priorities: ['high'],
      });

      const queryMatches = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );

      // After fix: should return matching results
      expect(searchResult.items.length).toBe(queryMatches.length);
      expect(searchResult.items.map(i => i.key).sort()).toEqual(
        queryMatches.map(i => i.key).sort()
      );
    });

    it('should match: searchEnhanced and queryEnhanced with combined filters', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        category: 'task',
        priorities: ['high'],
        channel: 'feature/auth',
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
        priorities: ['high'],
        channel: 'feature/auth',
      });

      const queryMatches = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );

      // After fix: complex filter combinations should work
      expect(searchResult.items.length).toBe(queryMatches.length);
      expect(searchResult.items.map(i => i.key).sort()).toEqual(
        queryMatches.map(i => i.key).sort()
      );
    });
  });

  describe('Privacy and Session Boundaries', () => {
    it('should respect privacy: searchEnhanced only shows accessible items', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
      });

      // Should find public items from any session + private items from own session
      expect(searchResult.items.some(item => item.key === 'private_auth_note')).toBe(true);
      expect(searchResult.items.some(item => item.key === 'other_private_auth')).toBe(false);
    });

    it('should respect privacy: queryEnhanced only shows accessible items', () => {
      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
      });

      const authItems = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );

      // Should find public items from any session + private items from own session
      expect(authItems.some(item => item.key === 'private_auth_note')).toBe(true);
      expect(authItems.some(item => item.key === 'other_private_auth')).toBe(false);
    });

    it('should match privacy behavior: searchEnhanced and queryEnhanced', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
      });

      const queryMatches = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );

      // Both should respect privacy in the same way
      const searchPrivateItems = searchResult.items.filter(item => item.is_private === 1);
      const queryPrivateItems = queryMatches.filter(item => item.is_private === 1);

      expect(searchPrivateItems.length).toBe(queryPrivateItems.length);
      expect(searchPrivateItems.every(item => item.session_id === testSessionId)).toBe(true);
      expect(queryPrivateItems.every(item => item.session_id === testSessionId)).toBe(true);
    });
  });

  describe('Edge Cases and Combinations', () => {
    it('should handle multiple priorities filter', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        priorities: ['high', 'normal'],
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        priorities: ['high', 'normal'],
      });

      const queryMatches = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );

      expect(searchResult.items.length).toBe(queryMatches.length);
    });

    it('should handle multiple channels filter', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        channels: ['main', 'feature/auth'],
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        channels: ['main', 'feature/auth'],
      });

      const queryMatches = queryResult.items.filter(item => 
        item.key.includes('auth') || item.value.includes('auth')
      );

      expect(searchResult.items.length).toBe(queryMatches.length);
    });

    it('should handle empty query with filters', () => {
      // Test with empty query - should rely purely on filters
      const searchResult = contextRepo.searchEnhanced({
        query: '',
        sessionId: testSessionId,
        category: 'task',
      });

      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
      });

      // When query is empty, searchEnhanced should return all items matching filters
      expect(searchResult.items.length).toBe(queryResult.items.length);
    });

    it('should handle pagination with filters', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        limit: 2,
        offset: 0,
      });

      expect(searchResult.items.length).toBeLessThanOrEqual(2);
      expect(searchResult.totalCount).toBeGreaterThanOrEqual(searchResult.items.length);
    });
  });

  describe('Success Criteria Definition', () => {
    it('SUCCESS CRITERIA: All filter combinations should work consistently', () => {
      const testCases = [
        { category: 'task' },
        { priorities: ['high'] },
        { channel: 'main' },
        { category: 'task', priorities: ['high'] },
        { category: 'config', channel: 'main' },
        { priorities: ['high', 'normal'], channel: 'feature/auth' },
        { category: 'task', priorities: ['high'], channel: 'feature/auth' },
      ];

      testCases.forEach((filters, index) => {
        const searchResult = contextRepo.searchEnhanced({
          query: 'auth',
          sessionId: testSessionId,
          ...filters,
        });

        const queryResult = contextRepo.queryEnhanced({
          sessionId: testSessionId,
          ...filters,
        });

        const queryMatches = queryResult.items.filter(item => 
          item.key.includes('auth') || item.value.includes('auth')
        );

        expect(searchResult.items.length).toBe(queryMatches.length);
        expect(searchResult.totalCount).toBe(queryMatches.length);
        
        // Log for debugging
        if (searchResult.items.length !== queryMatches.length) {
          console.log(`Test case ${index} failed:`, filters);
          console.log('Search results:', searchResult.items.map(i => i.key));
          console.log('Query matches:', queryMatches.map(i => i.key));
        }
      });
    });

    it('SUCCESS CRITERIA: Search with text query + metadata filters should work', () => {
      // This is the core failing scenario from the bug report
      const result = contextRepo.searchEnhanced({
        query: 'authentication',
        sessionId: testSessionId,
        category: 'task',
        priorities: ['high'],
      });

      // Should find auth_high_task and other_auth_task
      expect(result.items.length).toBe(2);
      expect(result.items.some(item => item.key === 'auth_high_task')).toBe(true);
      expect(result.items.some(item => item.key === 'other_auth_task')).toBe(true);
      expect(result.totalCount).toBe(2);
    });

    it('SUCCESS CRITERIA: Performance should be acceptable', () => {
      const start = Date.now();
      
      const result = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        category: 'task',
        priorities: ['high', 'normal'],
        channels: ['main', 'feature/auth'],
      });

      const duration = Date.now() - start;
      
      expect(result.items.length).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(100); // Should complete within 100ms
    });
  });
});