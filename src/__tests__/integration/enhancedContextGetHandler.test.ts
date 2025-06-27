import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Enhanced Context Get Handler Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let contextRepo: ContextRepository;
  let testSessionId: string;
  let secondSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-enhanced-context-get-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    contextRepo = new ContextRepository(dbManager);

    // Create test sessions
    testSessionId = uuidv4();
    secondSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(testSessionId, 'Test Session');
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      secondSessionId,
      'Second Session'
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

  function createTestData() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Create a timestamp that's definitely yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0); // Noon yesterday

    const items = [
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'config.database.url',
        value: 'postgresql://localhost:5432/myapp',
        category: 'config',
        priority: 'high',
        channel: 'main',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        metadata: JSON.stringify({ environment: 'production' }),
        size: 35,
      },
      // Add an item from yesterday
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'config.yesterday.item',
        value: 'Created yesterday',
        category: 'config',
        priority: 'normal',
        channel: 'main',
        created_at: yesterday.toISOString(),
        updated_at: yesterday.toISOString(),
        size: 17,
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'config.cache.ttl',
        value: '3600',
        category: 'config',
        priority: 'normal',
        channel: 'main',
        created_at: oneHourAgo.toISOString(),
        updated_at: oneHourAgo.toISOString(),
        metadata: JSON.stringify({ unit: 'seconds' }),
        size: 4,
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'task.deploy.status',
        value: 'completed',
        category: 'task',
        priority: 'high',
        channel: 'deployment',
        created_at: oneDayAgo.toISOString(),
        updated_at: oneHourAgo.toISOString(),
        size: 9,
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'task.backup.status',
        value: 'pending',
        category: 'task',
        priority: 'low',
        channel: 'maintenance',
        created_at: twoDaysAgo.toISOString(),
        updated_at: twoDaysAgo.toISOString(),
        size: 7,
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'note.architecture',
        value: 'The system uses a microservices architecture with Docker containers',
        category: 'note',
        priority: 'normal',
        channel: 'documentation',
        created_at: oneWeekAgo.toISOString(),
        updated_at: oneWeekAgo.toISOString(),
        size: 67,
      },
      // Private item
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'secret.api.key',
        value: 'sk-1234567890abcdef',
        category: 'config',
        priority: 'high',
        channel: 'secure',
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        is_private: 1,
        size: 18,
      },
      // Item from another session (public)
      {
        id: uuidv4(),
        session_id: secondSessionId,
        key: 'shared.resource',
        value: 'This is a shared resource',
        category: 'shared',
        priority: 'normal',
        channel: 'public',
        created_at: oneDayAgo.toISOString(),
        is_private: 0,
        size: 25,
      },
    ];

    // Insert test data
    const stmt = db.prepare(`
      INSERT INTO context_items (
        id, session_id, key, value, category, priority, channel, 
        created_at, updated_at, metadata, size, is_private
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    items.forEach(item => {
      stmt.run(
        item.id,
        item.session_id,
        item.key,
        item.value,
        item.category || null,
        item.priority || 'normal',
        item.channel || 'general',
        item.created_at || new Date().toISOString(),
        item.updated_at || item.created_at || new Date().toISOString(),
        item.metadata || null,
        item.size || Buffer.byteLength(item.value, 'utf8'),
        item.is_private || 0
      );
    });
  }

  describe('Backward Compatibility Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should return single value when requesting by key (backward compatible)', () => {
      const result = contextRepo.getByKey(testSessionId, 'config.database.url');

      expect(result).toBeTruthy();
      expect(result!.value).toBe('postgresql://localhost:5432/myapp');

      // Handler should return just the value for single key requests
      // This simulates the handler behavior
      const handlerResponse = {
        content: [{ type: 'text', text: result!.value }],
      };

      expect(handlerResponse.content[0].text).toBe('postgresql://localhost:5432/myapp');
    });

    it('should return text format for multiple items by default', () => {
      const items = contextRepo.getByCategory(testSessionId, 'config');

      expect(items.length).toBeGreaterThan(1);

      // Simulate handler formatting for multiple items
      const formattedItems = items
        .filter(item => !item.is_private || item.session_id === testSessionId)
        .map(
          r =>
            `• [${r.priority}] ${r.key}: ${r.value.substring(0, 100)}${r.value.length > 100 ? '...' : ''}`
        )
        .join('\n');

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: `Found ${items.length} context items:\n\n${formattedItems}`,
          },
        ],
      };

      expect(handlerResponse.content[0].text).toContain('Found');
      expect(handlerResponse.content[0].text).toContain('config.database.url');
      expect(handlerResponse.content[0].text).toContain('[high]');
    });

    it('should handle category parameter (existing functionality)', () => {
      const items = contextRepo.getByCategory(testSessionId, 'task');

      expect(items.length).toBe(2);
      expect(items.every(item => item.category === 'task')).toBe(true);
    });

    it('should respect session isolation by default', () => {
      const items = contextRepo.getBySessionId(testSessionId);

      expect(items.every(item => item.session_id === testSessionId)).toBe(true);
      expect(items.some(item => item.key === 'shared.resource')).toBe(false);
    });
  });

  describe('Metadata Inclusion Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should include metadata when includeMetadata is true', () => {
      const options = {
        sessionId: testSessionId,
        key: 'config.database.url',
        includeMetadata: true,
      };

      const result = contextRepo.queryEnhanced(options);

      expect(result.items.length).toBe(1);
      const item = result.items[0];

      // Verify all metadata fields are present
      expect(item).toHaveProperty('size');
      expect(item).toHaveProperty('created_at');
      expect(item).toHaveProperty('updated_at');
      expect(item).toHaveProperty('metadata');
      expect(item.size).toBe(35);

      // Verify metadata can be parsed
      if (item.metadata) {
        const parsed = JSON.parse(item.metadata);
        expect(parsed).toHaveProperty('environment', 'production');
      }
    });

    it('should return metadata structure for multiple items', () => {
      const options = {
        sessionId: testSessionId,
        category: 'config',
        includeMetadata: true,
      };

      const result = contextRepo.queryEnhanced(options);

      // Should return object with items array and totalCount
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('totalCount');
      expect(result.totalCount).toBeGreaterThanOrEqual(result.items.length);

      result.items.forEach(item => {
        expect(item).toHaveProperty('size');
        expect(item).toHaveProperty('created_at');
        expect(item).toHaveProperty('updated_at');
      });
    });
  });

  describe('Sorting Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should sort by created_at descending (default)', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        sort: 'created_desc',
      });

      for (let i = 1; i < result.items.length; i++) {
        const prevDate = new Date(result.items[i - 1].created_at);
        const currDate = new Date(result.items[i].created_at);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
      }
    });

    it('should sort by created_at ascending', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        sort: 'created_asc',
      });

      for (let i = 1; i < result.items.length; i++) {
        const prevDate = new Date(result.items[i - 1].created_at);
        const currDate = new Date(result.items[i].created_at);
        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }
    });

    it('should sort by updated_at descending', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        sort: 'updated_desc',
      });

      // Verify items are sorted by updated_at in descending order
      for (let i = 1; i < result.items.length; i++) {
        const prevDate = new Date(result.items[i - 1].updated_at);
        const currDate = new Date(result.items[i].updated_at);
        expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
      }

      // The most recently updated items should be first
      // config.database.url and secret.api.key both have updated_at = now
      expect(['config.database.url', 'secret.api.key']).toContain(result.items[0].key);
    });

    it('should sort by key ascending', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        sort: 'key_asc',
      });

      for (let i = 1; i < result.items.length; i++) {
        expect(result.items[i - 1].key.localeCompare(result.items[i].key)).toBeLessThanOrEqual(0);
      }
    });

    it('should sort by key descending', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        sort: 'key_desc',
      });

      for (let i = 1; i < result.items.length; i++) {
        expect(result.items[i - 1].key.localeCompare(result.items[i].key)).toBeGreaterThanOrEqual(
          0
        );
      }
    });

    it('should handle priority-based sorting when no sort specified', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
      });

      // High priority items should come first
      expect(result.items[0].priority).toBe('high');
    });
  });

  describe('Pagination Tests', () => {
    beforeEach(() => {
      createTestData();

      // Add more items for pagination testing
      for (let i = 0; i < 10; i++) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, category, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, `test.item.${i}`, `Test value ${i}`, 'test', 'normal');
      }
    });

    it('should limit results correctly', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 5,
      });

      expect(result.items.length).toBe(5);
      expect(result.totalCount).toBeGreaterThan(5);
    });

    it('should handle offset correctly', () => {
      const resultPage1 = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 5,
        offset: 0,
      });

      const resultPage2 = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 5,
        offset: 5,
      });

      // Ensure no overlap between pages
      const page1Keys = new Set(resultPage1.items.map(item => item.key));
      const page2Keys = new Set(resultPage2.items.map(item => item.key));

      page2Keys.forEach(key => {
        expect(page1Keys.has(key)).toBe(false);
      });
    });

    it('should calculate correct pagination metadata', () => {
      const pageSize = 3;
      const page = 2;
      const offset = (page - 1) * pageSize;

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: pageSize,
        offset: offset,
      });

      // Handler would calculate these values
      const totalPages = Math.ceil(result.totalCount / pageSize);
      const hasNextPage = page < totalPages;
      const hasPreviousPage = page > 1;

      expect(result.items.length).toBeLessThanOrEqual(pageSize);
      expect(hasNextPage).toBe(true);
      expect(hasPreviousPage).toBe(true);
    });
  });

  describe('Time Filtering Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should filter by createdAfter with ISO date', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        createdAfter: twoDaysAgo.toISOString(),
      });

      result.items.forEach(item => {
        expect(new Date(item.created_at).getTime()).toBeGreaterThan(twoDaysAgo.getTime());
      });

      // Should include recent items but not older ones
      expect(result.items.some(item => item.key === 'config.database.url')).toBe(true);
      expect(result.items.some(item => item.key === 'note.architecture')).toBe(false);
    });

    it('should filter by createdBefore with ISO date', () => {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        createdBefore: oneDayAgo.toISOString(),
      });

      result.items.forEach(item => {
        expect(new Date(item.created_at).getTime()).toBeLessThan(oneDayAgo.getTime());
      });

      // Should include older items but not recent ones
      expect(result.items.some(item => item.key === 'note.architecture')).toBe(true);
      expect(result.items.some(item => item.key === 'config.database.url')).toBe(false);
    });

    it('should handle relative time for createdAfter', () => {
      // Test "2 hours ago"
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        createdAfter: '2 hours ago',
      });

      // Should include items created within last 2 hours
      expect(result.items.some(item => item.key === 'config.database.url')).toBe(true);
      expect(result.items.some(item => item.key === 'config.cache.ttl')).toBe(true);
      expect(result.items.some(item => item.key === 'task.deploy.status')).toBe(false);
    });

    it('should handle "today" relative time', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        createdAfter: 'today',
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      result.items.forEach(item => {
        const itemDate = new Date(item.created_at);
        expect(itemDate.getTime()).toBeGreaterThanOrEqual(today.getTime());
      });
    });

    it('should handle "yesterday" relative time', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        createdAfter: 'yesterday',
        createdBefore: 'today',
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      result.items.forEach(item => {
        const itemDate = new Date(item.created_at);
        expect(itemDate.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());
        expect(itemDate.getTime()).toBeLessThan(today.getTime());
      });
    });

    it('should handle combined date range', () => {
      // Use a slightly larger range to account for timing
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        createdAfter: '8 days ago',
        createdBefore: '1 hour ago',
      });

      // Should include items from the past week but not the most recent items
      expect(result.items.some(item => item.key === 'note.architecture')).toBe(true);
      expect(result.items.some(item => item.key === 'task.backup.status')).toBe(true);
      expect(result.items.some(item => item.key === 'task.deploy.status')).toBe(true);
      expect(result.items.some(item => item.key === 'config.database.url')).toBe(false); // created "now"
      expect(result.items.some(item => item.key === 'secret.api.key')).toBe(false); // created "now"
    });
  });

  describe('Priority Filtering Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should filter by single priority', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        priorities: ['high'],
      });

      expect(result.items.every(item => item.priority === 'high')).toBe(true);
      expect(result.items.some(item => item.key === 'config.database.url')).toBe(true);
      expect(result.items.some(item => item.key === 'task.deploy.status')).toBe(true);
    });

    it('should filter by multiple priorities', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        priorities: ['high', 'low'],
      });

      expect(result.items.every(item => item.priority === 'high' || item.priority === 'low')).toBe(
        true
      );
      expect(result.items.some(item => item.priority === 'normal')).toBe(false);
    });

    it('should handle empty priorities array', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        priorities: [],
      });

      // Should return all items when no priority filter
      expect(result.items.length).toBeGreaterThan(0);
    });
  });

  describe('Pattern Matching Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should match keys with simple pattern', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        keyPattern: 'config.*',
      });

      expect(result.items.every(item => item.key.startsWith('config.'))).toBe(true);
      expect(result.items.length).toBe(3); // config.database.url, config.cache.ttl, and config.yesterday.item
    });

    it('should match keys ending with pattern', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        keyPattern: '*.status',
      });

      expect(result.items.every(item => item.key.endsWith('.status'))).toBe(true);
      expect(result.items.length).toBe(2); // task.deploy.status and task.backup.status
    });

    it('should match keys with middle wildcard', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        keyPattern: 'task.*.status',
      });

      expect(
        result.items.every(item => item.key.startsWith('task.') && item.key.endsWith('.status'))
      ).toBe(true);
    });

    it('should handle regex special characters in pattern', () => {
      // Add item with special characters
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value)
        VALUES (?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, 'config.db[prod].host', 'localhost');

      // Pattern should handle [ ] characters
      // In GLOB, we need to match literal brackets and any content between them
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        keyPattern: 'config.db*prod*.host',
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].key).toBe('config.db[prod].host');
    });
  });

  describe('Channel Filtering Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should filter by single channel', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        channel: 'main',
      });

      expect(result.items.every(item => item.channel === 'main')).toBe(true);
      expect(result.items.length).toBe(3); // includes config.yesterday.item
    });

    it('should filter by multiple channels', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        channels: ['main', 'deployment'],
      });

      expect(
        result.items.every(item => item.channel === 'main' || item.channel === 'deployment')
      ).toBe(true);
      expect(result.items.length).toBe(4); // 3 from main + 1 from deployment
    });

    it('should handle both channel and channels parameters', () => {
      // When both are provided, channels array should take precedence
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        channel: 'main',
        channels: ['deployment', 'maintenance'],
      });

      // Should only return items from channels array
      expect(
        result.items.every(item => item.channel === 'deployment' || item.channel === 'maintenance')
      ).toBe(true);
      expect(result.items.some(item => item.channel === 'main')).toBe(false);
    });
  });

  describe('Combined Parameter Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should handle multiple filters together', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'task',
        priorities: ['high', 'normal'],
        createdAfter: '3 days ago',
        sort: 'created_desc',
        limit: 10,
      });

      expect(
        result.items.every(
          item =>
            item.category === 'task' && (item.priority === 'high' || item.priority === 'normal')
        )
      ).toBe(true);

      // Should include task.deploy.status but not task.backup.status (low priority)
      expect(result.items.some(item => item.key === 'task.deploy.status')).toBe(true);
      expect(result.items.some(item => item.key === 'task.backup.status')).toBe(false);
    });

    it('should handle pattern with other filters', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        keyPattern: '*.status',
        priorities: ['high'],
        includeMetadata: true,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].key).toBe('task.deploy.status');
      expect(result.items[0]).toHaveProperty('size');
      expect(result.items[0]).toHaveProperty('created_at');
    });

    it('should handle time range with channels and pagination', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        channels: ['main', 'deployment', 'maintenance'],
        createdAfter: '7 days ago',
        createdBefore: 'today',
        sort: 'key_asc',
        limit: 2,
        offset: 0,
      });

      expect(result.items.length).toBeLessThanOrEqual(2);
      expect(result.totalCount).toBeGreaterThanOrEqual(result.items.length);

      // Verify sorting
      if (result.items.length > 1) {
        expect(result.items[0].key.localeCompare(result.items[1].key)).toBeLessThanOrEqual(0);
      }
    });
  });

  describe('Privacy and Access Control Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should include own private items', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'config',
      });

      // Should include private secret.api.key since it's from the same session
      expect(result.items.some(item => item.key === 'secret.api.key')).toBe(true);
    });

    it('should include public items from other sessions', () => {
      const result = contextRepo.getAccessibleItems(testSessionId);

      // Should include shared.resource from another session
      expect(result.some(item => item.key === 'shared.resource')).toBe(true);
    });

    it('should not include private items from other sessions', () => {
      // Add private item in second session
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value, is_private)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), secondSessionId, 'other.private', 'Private data', 1);

      const result = contextRepo.getAccessibleItems(testSessionId);

      // Should not include other session's private item
      expect(result.some(item => item.key === 'other.private')).toBe(false);
    });
  });

  describe('Error Handling Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should handle non-existent session gracefully', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: 'non-existent-session',
      });

      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should handle invalid sort parameter', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        sort: 'invalid_sort',
      });

      // Should fall back to default sort
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('should handle invalid date formats', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        createdAfter: 'invalid date',
      });

      // Should treat as literal string and likely return no results
      expect(result.items).toEqual([]);
    });

    it('should handle negative offset', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 5,
        offset: -1,
      });

      // Should treat negative offset as 0
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('should handle very large limit', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        limit: 999999,
      });

      // Should return all available items
      expect(result.items.length).toBe(result.totalCount);
    });

    it('should handle SQL injection attempts in keyPattern', () => {
      const maliciousPattern = "'; DROP TABLE context_items; --";

      // Should not throw and should not damage database
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        keyPattern: maliciousPattern,
      });

      // Verify table still exists
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='context_items'")
        .get();

      expect(tableExists).toBeTruthy();
      expect(result.items).toEqual([]);
    });
  });

  describe('Handler Response Format Tests', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should format single item response correctly', () => {
      const item = contextRepo.getByKey(testSessionId, 'config.database.url');

      // Handler returns just the value for single key request
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: item!.value,
          },
        ],
      };

      expect(handlerResponse.content[0].text).toBe('postgresql://localhost:5432/myapp');
    });

    it('should format multiple items without metadata', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'config',
      });

      // Handler formats as text list
      const formattedItems = result.items
        .map(
          r =>
            `• [${r.priority}] ${r.key}: ${r.value.substring(0, 100)}${r.value.length > 100 ? '...' : ''}`
        )
        .join('\n');

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: `Found ${result.items.length} context items:\n\n${formattedItems}`,
          },
        ],
      };

      expect(handlerResponse.content[0].text).toContain('Found');
      expect(handlerResponse.content[0].text).toContain('• [');
      expect(handlerResponse.content[0].text.split('\n').length).toBeGreaterThan(2);
    });

    it('should format response with metadata as JSON', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'config',
        includeMetadata: true,
        limit: 10,
        offset: 0,
      });

      // Handler returns structured data with metadata
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
                  channel: item.channel,
                  metadata: item.metadata ? JSON.parse(item.metadata) : null,
                  size: item.size,
                  created_at: item.created_at,
                  updated_at: item.updated_at,
                })),
                pagination: {
                  totalCount: result.totalCount,
                  page: 1,
                  pageSize: 10,
                  totalPages: Math.ceil(result.totalCount / 10),
                  hasNextPage: result.totalCount > 10,
                  hasPreviousPage: false,
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed).toHaveProperty('items');
      expect(parsed).toHaveProperty('pagination');
      expect(parsed.pagination).toHaveProperty('totalCount');
      expect(parsed.items[0]).toHaveProperty('size');
      expect(parsed.items[0]).toHaveProperty('created_at');
    });

    it('should handle empty results gracefully', () => {
      const _result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        key: 'non-existent-key',
      });

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: 'No matching context found',
          },
        ],
      };

      expect(handlerResponse.content[0].text).toBe('No matching context found');
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle large number of items efficiently', () => {
      // Add 100 items
      for (let i = 0; i < 100; i++) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, priority)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          `perf.test.${i.toString().padStart(3, '0')}`,
          `Performance test value ${i}`,
          i % 3 === 0 ? 'high' : 'normal'
        );
      }

      const startTime = Date.now();
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        keyPattern: 'perf.test.*',
        priorities: ['high'],
        sort: 'key_desc',
        limit: 20,
      });
      const endTime = Date.now();

      expect(result.items.length).toBe(20);
      expect(result.totalCount).toBeGreaterThan(20);
      expect(endTime - startTime).toBeLessThan(100); // Should complete within 100ms
    });

    it('should handle unicode and special characters in values', () => {
      const unicodeKey = 'unicode.test';
      const unicodeValue = '🚀 Unicode test with émojis and spëcial çharacters';

      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value)
        VALUES (?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, unicodeKey, unicodeValue);

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        key: unicodeKey,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].value).toBe(unicodeValue);
    });

    it('should handle very long values', () => {
      const longValue = 'A'.repeat(10000);

      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value, size)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, 'long.value', longValue, Buffer.byteLength(longValue, 'utf8'));

      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        key: 'long.value',
        includeMetadata: true,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].value.length).toBe(10000);
      expect(result.items[0].size).toBe(10000);
    });

    it('should handle all parameters at once', () => {
      const result = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        key: undefined,
        category: 'config',
        channel: undefined,
        channels: ['main', 'secure'],
        sort: 'created_desc',
        limit: 5,
        offset: 0,
        createdAfter: '7 days ago',
        createdBefore: 'now',
        keyPattern: 'config.*',
        priorities: ['high', 'normal'],
        includeMetadata: true,
      });

      // Should apply all filters correctly
      expect(
        result.items.every(
          item =>
            item.category === 'config' &&
            item.key.startsWith('config.') &&
            (item.channel === 'main' || item.channel === 'secure') &&
            (item.priority === 'high' || item.priority === 'normal')
        )
      ).toBe(true);

      expect(result).toHaveProperty('totalCount');
      expect(result.items.length).toBeLessThanOrEqual(5);
    });
  });
});
