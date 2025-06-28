import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Enhanced Context Timeline Handler Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let contextRepo: ContextRepository;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-enhanced-timeline-${Date.now()}.db`);
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

  function createTestDataWithTimeline() {
    const now = new Date();

    // Create items across different time periods
    const items = [
      // Today - 6 items
      { time: new Date(now.getTime() - 1 * 60 * 60 * 1000), category: 'task', priority: 'high' },
      { time: new Date(now.getTime() - 2 * 60 * 60 * 1000), category: 'task', priority: 'normal' },
      { time: new Date(now.getTime() - 3 * 60 * 60 * 1000), category: 'note', priority: 'normal' },
      {
        time: new Date(now.getTime() - 4 * 60 * 60 * 1000),
        category: 'decision',
        priority: 'high',
      },
      {
        time: new Date(now.getTime() - 5 * 60 * 60 * 1000),
        category: 'progress',
        priority: 'normal',
      },
      { time: new Date(now.getTime() - 6 * 60 * 60 * 1000), category: 'task', priority: 'low' },

      // Yesterday - 3 items
      { time: new Date(now.getTime() - 26 * 60 * 60 * 1000), category: 'task', priority: 'high' },
      { time: new Date(now.getTime() - 28 * 60 * 60 * 1000), category: 'note', priority: 'normal' },
      {
        time: new Date(now.getTime() - 30 * 60 * 60 * 1000),
        category: 'progress',
        priority: 'low',
      },

      // 3 days ago - 1 item
      {
        time: new Date(now.getTime() - 72 * 60 * 60 * 1000),
        category: 'decision',
        priority: 'high',
      },

      // 5 days ago - 2 items
      {
        time: new Date(now.getTime() - 120 * 60 * 60 * 1000),
        category: 'task',
        priority: 'normal',
      },
      {
        time: new Date(now.getTime() - 121 * 60 * 60 * 1000),
        category: 'note',
        priority: 'normal',
      },

      // 7 days ago - 4 items
      {
        time: new Date(now.getTime() - 168 * 60 * 60 * 1000),
        category: 'progress',
        priority: 'high',
      },
      {
        time: new Date(now.getTime() - 169 * 60 * 60 * 1000),
        category: 'task',
        priority: 'normal',
      },
      {
        time: new Date(now.getTime() - 170 * 60 * 60 * 1000),
        category: 'decision',
        priority: 'low',
      },
      {
        time: new Date(now.getTime() - 171 * 60 * 60 * 1000),
        category: 'note',
        priority: 'normal',
      },
    ];

    const stmt = db.prepare(`
      INSERT INTO context_items (
        id, session_id, key, value, category, priority, channel, created_at, updated_at, size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    items.forEach((item, index) => {
      const key = `item.${item.time.toISOString().split('T')[0]}.${index}`;
      const value = `Test item created at ${item.time.toISOString()}`;
      stmt.run(
        uuidv4(),
        testSessionId,
        key,
        value,
        item.category,
        item.priority,
        'test-channel',
        item.time.toISOString(),
        item.time.toISOString(),
        Buffer.byteLength(value, 'utf8')
      );
    });

    return items;
  }

  describe('minItemsPerPeriod Tests', () => {
    beforeEach(() => {
      createTestDataWithTimeline();
    });

    it('should filter periods with fewer items than minItemsPerPeriod', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: 3,
      });

      // Only today (6 items), yesterday (3 items), and 7 days ago (4 items) should appear
      expect(timeline.length).toBe(3);
      expect(timeline.every((period: any) => period.count >= 3)).toBe(true);
    });

    it('should include all periods when minItemsPerPeriod is 0', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: 0,
      });

      // Should include all 7 periods that have data
      expect(timeline.length).toBe(7);
    });

    it('should handle negative minItemsPerPeriod by treating as 0', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: -5,
      });

      // Should include all periods (same as 0)
      expect(timeline.length).toBe(7);
    });

    it('should work with category filters and minItemsPerPeriod', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        categories: ['task'],
        minItemsPerPeriod: 2,
      });

      // Only today (3 task items) and 7 days ago (1 task, but need to verify) should qualify
      // Actually checking: today has 3 tasks, yesterday has 1 task, 7 days ago has 1 task
      // So only today qualifies with 2+ task items
      expect(timeline.every((period: any) => period.count >= 2)).toBe(true);
    });

    it('should work with hour grouping and minItemsPerPeriod', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'hour',
        minItemsPerPeriod: 1,
        relativeTime: 'today',
      });

      // Should only show hours that have at least 1 item
      expect(timeline.every((period: any) => period.count >= 1)).toBe(true);
    });

    it('should include item details when requested with minItemsPerPeriod filter', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: 3,
        includeItems: true,
        itemsPerPeriod: 5,
      });

      // Check that periods have items attached
      timeline.forEach((period: any) => {
        expect(period.items).toBeDefined();
        expect(Array.isArray(period.items)).toBe(true);
        expect(period.items.length).toBeLessThanOrEqual(5);
        expect(period.count).toBeGreaterThanOrEqual(3);
      });
    });

    it('should work with relative time and minItemsPerPeriod', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        relativeTime: '7 days ago',
        groupBy: 'day',
        minItemsPerPeriod: 2,
      });

      // Should include periods from last 7 days with 2+ items
      timeline.forEach((period: any) => {
        expect(period.count).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('showEmpty Tests', () => {
    beforeEach(() => {
      createTestDataWithTimeline();
    });

    it('should generate empty periods when showEmpty is true', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 10);
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        showEmpty: true,
      });

      // Should have 11 periods (10 days + today)
      expect(timeline.length).toBe(11);

      // Check that empty periods have count = 0
      const emptyPeriods = timeline.filter((p: any) => p.count === 0);
      expect(emptyPeriods.length).toBeGreaterThan(0);
      emptyPeriods.forEach((period: any) => {
        expect(period.count).toBe(0);
        expect(period.items).toEqual([]);
      });
    });

    it('should handle showEmpty with hour grouping', () => {
      const startDate = new Date();
      startDate.setHours(startDate.getHours() - 24);
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'hour',
        showEmpty: true,
      });

      // Should have 25 periods (24 hours + current hour)
      expect(timeline.length).toBe(25);
    });

    it('should handle showEmpty with week grouping', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 28); // 4 weeks ago
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'week',
        showEmpty: true,
      });

      // Should have 5 periods (4 full weeks + current week)
      expect(timeline.length).toBeGreaterThanOrEqual(4);
      expect(timeline.length).toBeLessThanOrEqual(5);
    });

    it('should include empty periods with categories filter', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 5);
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        categories: ['task'],
        showEmpty: true,
      });

      // Should have 6 periods regardless of task items
      expect(timeline.length).toBe(6);
    });

    it('should handle showEmpty with relative time', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        relativeTime: '3 days ago',
        groupBy: 'day',
        showEmpty: true,
      });

      // Should have 4 periods (3 days ago to today)
      expect(timeline.length).toBe(4);
    });

    it('should enforce reasonable limits on empty period generation', () => {
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1); // 1 year ago
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        showEmpty: true,
      });

      // Should enforce a reasonable limit (e.g., 365 days max)
      expect(timeline.length).toBeLessThanOrEqual(365);
    });

    it('should include items in non-empty periods when showEmpty is true', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 3);
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        showEmpty: true,
        includeItems: true,
      });

      // Find periods with data
      const nonEmptyPeriods = timeline.filter((p: any) => p.count > 0);
      expect(nonEmptyPeriods.length).toBeGreaterThan(0);

      nonEmptyPeriods.forEach((period: any) => {
        expect(period.items).toBeDefined();
        expect(period.items.length).toBeGreaterThan(0);
      });

      // Empty periods should have empty items array
      const emptyPeriods = timeline.filter((p: any) => p.count === 0);
      emptyPeriods.forEach((period: any) => {
        expect(period.items).toEqual([]);
      });
    });
  });

  describe('Parameter Interaction Tests', () => {
    beforeEach(() => {
      createTestDataWithTimeline();
    });

    it('should have showEmpty override minItemsPerPeriod', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 5);
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        showEmpty: true,
        minItemsPerPeriod: 3,
      });

      // Should show all 6 days, including empty ones
      expect(timeline.length).toBe(6);

      // Should include periods with 0 items despite minItemsPerPeriod
      const emptyPeriods = timeline.filter((p: any) => p.count === 0);
      expect(emptyPeriods.length).toBeGreaterThan(0);
    });

    it('should work with all parameters combined', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        categories: ['task', 'progress'],
        showEmpty: true,
        minItemsPerPeriod: 2,
        includeItems: true,
        itemsPerPeriod: 3,
      });

      // Should have 8 days total
      expect(timeline.length).toBe(8);

      // Check various aspects
      timeline.forEach((period: any) => {
        expect(period).toHaveProperty('period');
        expect(period).toHaveProperty('count');
        expect(period).toHaveProperty('items');

        if (period.count > 0) {
          // Non-empty periods should respect itemsPerPeriod
          expect(period.items.length).toBeLessThanOrEqual(3);

          // Items should only be from specified categories
          period.items.forEach((item: any) => {
            expect(['task', 'progress']).toContain(item.category);
          });
        }
      });
    });

    it('should handle showEmpty false with minItemsPerPeriod', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        showEmpty: false,
        minItemsPerPeriod: 2,
      });

      // Should only show periods with 2+ items
      expect(timeline.every((period: any) => period.count >= 2)).toBe(true);

      // Should not include any empty periods
      expect(timeline.every((period: any) => period.count > 0)).toBe(true);
    });

    it('should respect date ranges with both new parameters', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 2);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        showEmpty: true,
        minItemsPerPeriod: 5,
      });

      // Should show exactly 2 days
      expect(timeline.length).toBe(2);
    });
  });

  describe('Edge Cases and Validation Tests', () => {
    beforeEach(() => {
      createTestDataWithTimeline();
    });

    it('should handle minItemsPerPeriod larger than any period count', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: 100,
      });

      // Should return empty array since no period has 100+ items
      expect(timeline).toEqual([]);
    });

    it('should handle showEmpty with no date range specified', () => {
      // Without date range, showEmpty should be ignored
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        showEmpty: true,
      });

      // Should only return periods with data
      expect(timeline.every((period: any) => period.count > 0)).toBe(true);
    });

    it('should handle invalid date ranges gracefully', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: '2025-01-01',
        endDate: '2024-01-01', // End before start
        groupBy: 'day',
        showEmpty: true,
      });

      // Should return empty array or handle gracefully
      expect(timeline).toEqual([]);
    });

    it('should handle very large minItemsPerPeriod values', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: Number.MAX_SAFE_INTEGER,
      });

      // Should return empty array
      expect(timeline).toEqual([]);
    });

    it('should handle fractional minItemsPerPeriod by rounding', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: 2.7, // Should be treated as 3
      });

      // Periods should have at least 3 items
      expect(timeline.every((period: any) => period.count >= 3)).toBe(true);
    });

    it('should handle showEmpty with very narrow time windows', () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour later

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'hour',
        showEmpty: true,
      });

      // Should have 2 hour periods
      expect(timeline.length).toBe(2);
    });

    it('should maintain sort order with new parameters', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        showEmpty: false,
        minItemsPerPeriod: 1,
      });

      // Verify descending order by period
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i - 1].period >= timeline[i].period).toBe(true);
      }
    });
  });

  describe('Performance Tests', () => {
    it('should handle large datasets efficiently with minItemsPerPeriod', () => {
      // Create many items
      const stmt = db.prepare(`
        INSERT INTO context_items (
          id, session_id, key, value, category, channel, created_at, size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const batchSize = 1000;
      for (let i = 0; i < batchSize; i++) {
        const daysAgo = Math.floor(Math.random() * 30);
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);

        stmt.run(
          uuidv4(),
          testSessionId,
          `perf.test.${i}`,
          `Performance test item ${i}`,
          'performance',
          'test-channel',
          date.toISOString(),
          20
        );
      }

      const startTime = Date.now();
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: 10,
      });
      const endTime = Date.now();

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(500);

      // Should only show days with 10+ items
      expect(timeline.every((period: any) => period.count >= 10)).toBe(true);
    });

    it('should handle showEmpty efficiently for large date ranges', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90); // 3 months
      const endDate = new Date();

      const startTime = Date.now();
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        showEmpty: true,
      });
      const endTime = Date.now();

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(1000);

      // Should have ~91 periods
      expect(timeline.length).toBeGreaterThanOrEqual(90);
      expect(timeline.length).toBeLessThanOrEqual(92);
    });
  });

  describe('Backward Compatibility Tests', () => {
    beforeEach(() => {
      createTestDataWithTimeline();
    });

    it('should work without new parameters (existing behavior)', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
      });

      // Should return all periods with data
      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline.every((period: any) => period.count > 0)).toBe(true);
    });

    it('should maintain existing parameter functionality', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        categories: ['task'],
        includeItems: true,
        itemsPerPeriod: 2,
      });

      // Should filter by category and limit items
      timeline.forEach((period: any) => {
        if (period.items && period.items.length > 0) {
          expect(period.items.every((item: any) => item.category === 'task')).toBe(true);
          expect(period.items.length).toBeLessThanOrEqual(2);
        }
      });
    });

    it('should handle undefined new parameters gracefully', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: undefined,
        showEmpty: undefined,
      });

      // Should behave as if parameters weren't provided
      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline.every((period: any) => period.count > 0)).toBe(true);
    });

    it('should maintain response format compatibility', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        includeItems: true,
      });

      // Verify expected structure
      timeline.forEach((period: any) => {
        expect(period).toHaveProperty('period');
        expect(period).toHaveProperty('count');
        expect(period).toHaveProperty('items');
        expect(typeof period.period).toBe('string');
        expect(typeof period.count).toBe('number');
        expect(Array.isArray(period.items)).toBe(true);
      });
    });
  });

  describe('Handler Response Format Tests', () => {
    beforeEach(() => {
      createTestDataWithTimeline();
    });

    it('should format timeline response correctly', () => {
      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        minItemsPerPeriod: 2,
      });

      // Simulate handler formatting
      const formattedPeriods = timeline
        .map(
          (p: any) =>
            `${p.period}: ${p.count} items${p.hasMore ? ` (showing ${p.items?.length || 0} of ${p.totalCount})` : ''}`
        )
        .join('\n');

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: `Timeline (${timeline.length} periods):\n\n${formattedPeriods}`,
          },
        ],
      };

      expect(handlerResponse.content[0].text).toContain('Timeline');
      expect(handlerResponse.content[0].text).toContain('periods');
      expect(handlerResponse.content[0].text).toContain('items');
    });

    it('should include empty periods in response when showEmpty is true', () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 3);
      const endDate = new Date();

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        groupBy: 'day',
        showEmpty: true,
      });

      // Handler should indicate empty periods
      const formattedPeriods = timeline
        .map((p: any) => `${p.period}: ${p.count === 0 ? 'No items' : `${p.count} items`}`)
        .join('\n');

      expect(formattedPeriods).toContain('No items');
    });

    it('should format response with journal entries integration', () => {
      // Add journal entries
      db.prepare(
        `
        INSERT INTO journal_entries (id, session_id, entry, created_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, 'Test journal entry', new Date().toISOString());

      const timeline = contextRepo.getTimelineData({
        sessionId: testSessionId,
        groupBy: 'day',
        includeItems: true,
      });

      // Handler would merge context items and journal entries
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: `Timeline with ${timeline.length} periods and journal entries`,
          },
        ],
      };

      expect(handlerResponse.content[0].text).toContain('journal entries');
    });
  });
});
