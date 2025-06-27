import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Channel Management Handler Integration Tests', () => {
  let dbManager: DatabaseManager;
  let _repositories: RepositoryManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;
  let testSessionId2: string;
  let testSessionId3: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-channel-management-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    _repositories = new RepositoryManager(dbManager);

    // Create test sessions with different channels
    testSessionId = uuidv4();
    testSessionId2 = uuidv4();
    testSessionId3 = uuidv4();

    // Insert test sessions
    db.prepare('INSERT INTO sessions (id, name, default_channel) VALUES (?, ?, ?)').run(
      testSessionId,
      'Dev Session',
      'dev-channel'
    );
    db.prepare('INSERT INTO sessions (id, name, default_channel) VALUES (?, ?, ?)').run(
      testSessionId2,
      'Feature Session',
      'feature-auth'
    );
    db.prepare('INSERT INTO sessions (id, name, default_channel) VALUES (?, ?, ?)').run(
      testSessionId3,
      'Production Session',
      'prod-channel'
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

  describe('context_list_channels', () => {
    beforeEach(() => {
      // Create diverse test data across channels and sessions
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Dev channel items (mixed sessions)
      const devItems = [
        {
          session: testSessionId,
          key: 'dev1',
          value: 'Dev item 1',
          channel: 'dev-channel',
          priority: 'high',
          category: 'code',
          created_at: now.toISOString(),
          is_private: 0,
        },
        {
          session: testSessionId,
          key: 'dev2',
          value: 'Dev item 2',
          channel: 'dev-channel',
          priority: 'normal',
          category: 'config',
          created_at: yesterday.toISOString(),
          is_private: 0,
        },
        {
          session: testSessionId2,
          key: 'dev3',
          value: 'Dev item 3',
          channel: 'dev-channel',
          priority: 'high',
          category: 'code',
          created_at: lastWeek.toISOString(),
          is_private: 0,
        },
        {
          session: testSessionId,
          key: 'dev4',
          value: 'Private dev item',
          channel: 'dev-channel',
          priority: 'low',
          category: 'note',
          created_at: now.toISOString(),
          is_private: 1,
        },
      ];

      // Feature channel items
      const featureItems = [
        {
          session: testSessionId2,
          key: 'feat1',
          value: 'Feature item 1',
          channel: 'feature-auth',
          priority: 'high',
          category: 'task',
          created_at: now.toISOString(),
          is_private: 0,
        },
        {
          session: testSessionId2,
          key: 'feat2',
          value: 'Feature item 2',
          channel: 'feature-auth',
          priority: 'normal',
          category: 'progress',
          created_at: yesterday.toISOString(),
          is_private: 0,
        },
        {
          session: testSessionId,
          key: 'feat3',
          value: 'Cross-session feature',
          channel: 'feature-auth',
          priority: 'high',
          category: 'decision',
          created_at: now.toISOString(),
          is_private: 0,
        },
      ];

      // Production channel items
      const prodItems = [
        {
          session: testSessionId3,
          key: 'prod1',
          value: 'Production config',
          channel: 'prod-channel',
          priority: 'high',
          category: 'config',
          created_at: now.toISOString(),
          is_private: 0,
        },
        {
          session: testSessionId3,
          key: 'prod2',
          value: 'Private prod data',
          channel: 'prod-channel',
          priority: 'high',
          category: 'config',
          created_at: now.toISOString(),
          is_private: 1,
        },
      ];

      // General channel items
      const generalItems = [
        {
          session: testSessionId,
          key: 'gen1',
          value: 'General note',
          channel: 'general',
          priority: 'normal',
          category: 'note',
          created_at: now.toISOString(),
          is_private: 0,
        },
        {
          session: testSessionId2,
          key: 'gen2',
          value: 'General task',
          channel: 'general',
          priority: 'low',
          category: 'task',
          created_at: yesterday.toISOString(),
          is_private: 0,
        },
      ];

      // Empty channel for edge cases
      const emptyItems = [
        {
          session: testSessionId,
          key: 'empty1',
          value: 'Item with empty channel',
          channel: 'empty-channel',
          priority: 'normal',
          category: 'note',
          created_at: lastWeek.toISOString(),
          is_private: 0,
        },
      ];

      // Insert all items
      const allItems = [...devItems, ...featureItems, ...prodItems, ...generalItems, ...emptyItems];
      const stmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, channel, priority, category, created_at, is_private)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of allItems) {
        stmt.run(
          uuidv4(),
          item.session,
          item.key,
          item.value,
          item.channel,
          item.priority,
          item.category,
          item.created_at,
          item.is_private
        );
      }
    });

    describe('Basic listing functionality', () => {
      it('should list all channels with counts across all sessions', () => {
        // Simulate handler logic for listing all channels
        const sql = `
          SELECT 
            channel,
            COUNT(*) as total_count,
            COUNT(DISTINCT session_id) as session_count,
            SUM(CASE WHEN is_private = 0 THEN 1 ELSE 0 END) as public_count,
            SUM(CASE WHEN is_private = 1 THEN 1 ELSE 0 END) as private_count
          FROM context_items
          GROUP BY channel
          ORDER BY total_count DESC, channel ASC
        `;

        const channels = db.prepare(sql).all() as any[];

        expect(channels).toHaveLength(5); // dev-channel, feature-auth, prod-channel, general, empty-channel

        // Verify dev-channel (most items)
        const devChannel = channels.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel).toBeDefined();
        expect(devChannel.total_count).toBe(4);
        expect(devChannel.session_count).toBe(2); // Used by session 1 and 2
        expect(devChannel.public_count).toBe(3);
        expect(devChannel.private_count).toBe(1);

        // Verify feature-auth
        const featureChannel = channels.find((c: any) => c.channel === 'feature-auth');
        expect(featureChannel).toBeDefined();
        expect(featureChannel.total_count).toBe(3);
        expect(featureChannel.session_count).toBe(2);
        expect(featureChannel.public_count).toBe(3);
        expect(featureChannel.private_count).toBe(0);

        // Verify sorting by count
        expect(channels[0].channel).toBe('dev-channel'); // 4 items
        expect(channels[1].channel).toBe('feature-auth'); // 3 items
      });

      it('should filter channels by specific session', () => {
        const sql = `
          SELECT 
            channel,
            COUNT(*) as total_count,
            SUM(CASE WHEN is_private = 0 THEN 1 ELSE 0 END) as public_count,
            SUM(CASE WHEN is_private = 1 THEN 1 ELSE 0 END) as private_count,
            MAX(created_at) as last_activity,
            GROUP_CONCAT(DISTINCT category) as categories
          FROM context_items
          WHERE session_id = ?
          GROUP BY channel
          ORDER BY total_count DESC
        `;

        const channels = db.prepare(sql).all(testSessionId) as any[];

        expect(channels).toHaveLength(4); // dev-channel, feature-auth, general, empty-channel

        const devChannel = channels.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel.total_count).toBe(3); // Only items from testSessionId (dev1, dev2, dev4)
        expect(devChannel.public_count).toBe(2); // dev1, dev2
        expect(devChannel.private_count).toBe(1); // dev4
        expect(devChannel.categories).toContain('code');
        expect(devChannel.categories).toContain('config');
      });

      it('should filter channels by multiple sessions', () => {
        const sessions = [testSessionId, testSessionId2];
        const placeholders = sessions.map(() => '?').join(',');

        const sql = `
          SELECT 
            channel,
            COUNT(*) as total_count,
            COUNT(DISTINCT session_id) as session_count,
            GROUP_CONCAT(DISTINCT session_id) as session_ids
          FROM context_items
          WHERE session_id IN (${placeholders})
          GROUP BY channel
          ORDER BY channel ASC
        `;

        const channels = db.prepare(sql).all(...sessions) as any[];

        expect(channels).toHaveLength(4); // dev-channel, feature-auth, general, empty-channel

        // Verify dev-channel is used by both sessions
        const devChannel = channels.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel.session_count).toBe(2);
        expect(devChannel.session_ids).toContain(testSessionId);
        expect(devChannel.session_ids).toContain(testSessionId2);

        // Verify prod-channel is NOT included (session3 not in filter)
        const prodChannel = channels.find((c: any) => c.channel === 'prod-channel');
        expect(prodChannel).toBeUndefined();
      });
    });

    describe('Sort options', () => {
      it('should sort channels by name alphabetically', () => {
        const sql = `
          SELECT channel, COUNT(*) as total_count
          FROM context_items
          GROUP BY channel
          ORDER BY channel ASC
        `;

        const channels = db.prepare(sql).all() as any[];
        const channelNames = channels.map((c: any) => c.channel);

        expect(channelNames).toEqual([
          'dev-channel',
          'empty-channel',
          'feature-auth',
          'general',
          'prod-channel',
        ]);
      });

      it('should sort channels by count descending', () => {
        const sql = `
          SELECT channel, COUNT(*) as total_count
          FROM context_items
          GROUP BY channel
          ORDER BY total_count DESC, channel ASC
        `;

        const channels = db.prepare(sql).all() as any[];

        expect(channels[0].channel).toBe('dev-channel'); // 4 items
        expect(channels[0].total_count).toBe(4);
        expect(channels[1].channel).toBe('feature-auth'); // 3 items
        expect(channels[1].total_count).toBe(3);
        expect(channels[channels.length - 1].channel).toBe('empty-channel'); // 1 item
        expect(channels[channels.length - 1].total_count).toBe(1);
      });

      it('should sort channels by last activity', () => {
        const sql = `
          SELECT 
            channel,
            MAX(created_at) as last_activity,
            COUNT(*) as total_count
          FROM context_items
          GROUP BY channel
          ORDER BY last_activity DESC
        `;

        const channels = db.prepare(sql).all() as any[];

        // Channels with recent activity should be first
        const topChannels = channels.slice(0, 4).map((c: any) => c.channel);
        expect(topChannels).toContain('dev-channel'); // Has items from "now"
        expect(topChannels).toContain('feature-auth'); // Has items from "now"
        expect(topChannels).toContain('prod-channel'); // Has items from "now"
        expect(topChannels).toContain('general'); // Has items from "now"

        // Empty channel should be last (only has old items)
        expect(channels[channels.length - 1].channel).toBe('empty-channel');
      });
    });

    describe('Privacy boundaries', () => {
      it('should respect privacy when listing channels for a session', () => {
        // When querying as testSessionId, should see own private items
        const sql = `
          SELECT 
            channel,
            COUNT(*) as total_count,
            SUM(CASE WHEN is_private = 1 THEN 1 ELSE 0 END) as private_count
          FROM context_items
          WHERE session_id = ? OR is_private = 0
          GROUP BY channel
        `;

        const channelsAsSession1 = db.prepare(sql).all(testSessionId) as any[];

        // Find dev-channel stats
        const devChannel = channelsAsSession1.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel.total_count).toBe(4); // Can see all including own private
        expect(devChannel.private_count).toBe(1);

        // Find prod-channel stats
        const prodChannel = channelsAsSession1.find((c: any) => c.channel === 'prod-channel');
        expect(prodChannel.total_count).toBe(1); // Can only see public items
        expect(prodChannel.private_count).toBe(0); // Cannot see session3's private items
      });

      it('should show different counts based on viewing session', () => {
        // Compare prod-channel visibility from different sessions
        const sqlForSession = `
          SELECT 
            channel,
            COUNT(*) as visible_count
          FROM context_items
          WHERE channel = 'prod-channel'
            AND (session_id = ? OR is_private = 0)
        `;

        // As session3 (owns prod items)
        const resultAsOwner = db.prepare(sqlForSession).get(testSessionId3) as any;
        expect(resultAsOwner.visible_count).toBe(2); // Sees both public and private

        // As session1 (different session)
        const resultAsOther = db.prepare(sqlForSession).get(testSessionId) as any;
        expect(resultAsOther.visible_count).toBe(1); // Only sees public
      });

      it('should include privacy breakdown in channel list', () => {
        const sql = `
          SELECT 
            channel,
            COUNT(*) as total_count,
            SUM(CASE WHEN is_private = 0 THEN 1 ELSE 0 END) as public_count,
            SUM(CASE WHEN is_private = 1 AND session_id = ? THEN 1 ELSE 0 END) as own_private_count,
            SUM(CASE WHEN is_private = 1 AND session_id != ? THEN 1 ELSE 0 END) as other_private_count
          FROM context_items
          GROUP BY channel
        `;

        const channels = db.prepare(sql).all(testSessionId, testSessionId) as any[];

        // Check dev-channel privacy breakdown
        const devChannel = channels.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel.public_count).toBe(3);
        expect(devChannel.own_private_count).toBe(1); // testSessionId owns 1 private
        expect(devChannel.other_private_count).toBe(0);

        // Check prod-channel privacy breakdown
        const prodChannel = channels.find((c: any) => c.channel === 'prod-channel');
        expect(prodChannel.public_count).toBe(1);
        expect(prodChannel.own_private_count).toBe(0); // testSessionId owns no private
        expect(prodChannel.other_private_count).toBe(1); // testSessionId3 owns 1 private
      });
    });

    describe('Empty results handling', () => {
      it('should return empty array when no channels exist', () => {
        // Clear all data
        db.prepare('DELETE FROM context_items').run();

        const sql = 'SELECT channel FROM context_items GROUP BY channel';
        const channels = db.prepare(sql).all();

        expect(channels).toEqual([]);
      });

      it('should return empty array when filtering by non-existent session', () => {
        const sql = `
          SELECT channel, COUNT(*) as count 
          FROM context_items 
          WHERE session_id = ?
          GROUP BY channel
        `;

        const channels = db.prepare(sql).all('non-existent-session');
        expect(channels).toEqual([]);
      });

      it('should handle channels with zero visible items gracefully', () => {
        // Create a session that can't see any items in certain channels
        const newSessionId = uuidv4();
        db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
          newSessionId,
          'New Session'
        );

        // All prod-channel items are either private to session3 or we make the public one private too
        db.prepare('UPDATE context_items SET is_private = 1 WHERE channel = ?').run('prod-channel');

        const sql = `
          SELECT 
            c.channel,
            COUNT(ci.id) as visible_count
          FROM (SELECT DISTINCT channel FROM context_items) c
          LEFT JOIN context_items ci ON c.channel = ci.channel 
            AND (ci.session_id = ? OR ci.is_private = 0)
          GROUP BY c.channel
          ORDER BY c.channel
        `;

        const channels = db.prepare(sql).all(newSessionId) as any[];

        // Should still list prod-channel but with 0 visible items
        const prodChannel = channels.find((c: any) => c.channel === 'prod-channel');
        expect(prodChannel).toBeDefined();
        expect(prodChannel.visible_count).toBe(0);
      });
    });

    describe('Additional metadata', () => {
      it('should include category distribution per channel', () => {
        const sql = `
          SELECT 
            channel,
            COUNT(*) as total_count,
            GROUP_CONCAT(DISTINCT category) as categories,
            COUNT(DISTINCT category) as category_count
          FROM context_items
          GROUP BY channel
        `;

        const channels = db.prepare(sql).all() as any[];

        const devChannel = channels.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel.categories).toContain('code');
        expect(devChannel.categories).toContain('config');
        expect(devChannel.categories).toContain('note');
        expect(devChannel.category_count).toBe(3);
      });

      it('should include priority distribution per channel', () => {
        const sql = `
          SELECT 
            channel,
            SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority,
            SUM(CASE WHEN priority = 'normal' THEN 1 ELSE 0 END) as normal_priority,
            SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) as low_priority
          FROM context_items
          GROUP BY channel
        `;

        const channels = db.prepare(sql).all() as any[];

        const devChannel = channels.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel.high_priority).toBe(2);
        expect(devChannel.normal_priority).toBe(1);
        expect(devChannel.low_priority).toBe(1);
      });

      it('should include time-based activity metrics', () => {
        const sql = `
          SELECT 
            channel,
            MIN(created_at) as first_activity,
            MAX(created_at) as last_activity,
            julianday(MAX(created_at)) - julianday(MIN(created_at)) as days_active
          FROM context_items
          GROUP BY channel
        `;

        const channels = db.prepare(sql).all() as any[];

        const devChannel = channels.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel.first_activity).toBeDefined();
        expect(devChannel.last_activity).toBeDefined();
        expect(devChannel.days_active).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('context_channel_stats', () => {
    beforeEach(() => {
      // Create comprehensive test data for statistics
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Create items with varied timestamps and updates
      const items = [
        // Dev channel - high activity
        {
          session: testSessionId,
          key: 'dev_task_1',
          value: 'Implement auth',
          channel: 'dev-channel',
          priority: 'high',
          category: 'task',
          created_at: weekAgo,
          updated_at: hourAgo,
        },
        {
          session: testSessionId,
          key: 'dev_bug_1',
          value: 'Fix login bug',
          channel: 'dev-channel',
          priority: 'high',
          category: 'error',
          created_at: twoDaysAgo,
          updated_at: yesterday,
        },
        {
          session: testSessionId,
          key: 'dev_note_1',
          value: 'API docs',
          channel: 'dev-channel',
          priority: 'normal',
          category: 'note',
          created_at: yesterday,
          updated_at: yesterday,
        },
        {
          session: testSessionId2,
          key: 'dev_progress_1',
          value: '50% complete',
          channel: 'dev-channel',
          priority: 'normal',
          category: 'progress',
          created_at: hourAgo,
          updated_at: hourAgo,
        },
        {
          session: testSessionId,
          key: 'dev_decision_1',
          value: 'Use JWT',
          channel: 'dev-channel',
          priority: 'high',
          category: 'decision',
          created_at: twoDaysAgo,
          updated_at: twoDaysAgo,
          is_private: 1,
        },

        // Feature channel - moderate activity
        {
          session: testSessionId2,
          key: 'feat_task_1',
          value: 'Design UI',
          channel: 'feature-auth',
          priority: 'high',
          category: 'task',
          created_at: twoDaysAgo,
          updated_at: hourAgo,
        },
        {
          session: testSessionId2,
          key: 'feat_task_2',
          value: 'Write tests',
          channel: 'feature-auth',
          priority: 'normal',
          category: 'task',
          created_at: yesterday,
          updated_at: yesterday,
        },
        {
          session: testSessionId,
          key: 'feat_warning_1',
          value: 'Deprecation notice',
          channel: 'feature-auth',
          priority: 'high',
          category: 'warning',
          created_at: hourAgo,
          updated_at: hourAgo,
        },

        // General channel - low activity
        {
          session: testSessionId,
          key: 'gen_note_1',
          value: 'Meeting notes',
          channel: 'general',
          priority: 'low',
          category: 'note',
          created_at: weekAgo,
          updated_at: weekAgo,
        },
        {
          session: testSessionId3,
          key: 'gen_task_1',
          value: 'Review PR',
          channel: 'general',
          priority: 'normal',
          category: 'task',
          created_at: yesterday,
          updated_at: yesterday,
        },
      ];

      const stmt = db.prepare(`
        INSERT INTO context_items (
          id, session_id, key, value, channel, priority, category, 
          created_at, updated_at, is_private, size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        stmt.run(
          uuidv4(),
          item.session,
          item.key,
          item.value,
          item.channel,
          item.priority,
          item.category,
          item.created_at.toISOString(),
          item.updated_at.toISOString(),
          item.is_private || 0,
          Buffer.byteLength(item.value, 'utf8')
        );
      }
    });

    describe('Single channel statistics', () => {
      it('should return detailed stats for a specific channel', () => {
        const channel = 'dev-channel';

        // Basic stats
        const basicStats = db
          .prepare(
            `
          SELECT 
            COUNT(*) as total_items,
            COUNT(DISTINCT session_id) as unique_sessions,
            COUNT(DISTINCT category) as unique_categories,
            SUM(size) as total_size,
            AVG(size) as avg_size,
            MIN(created_at) as first_activity,
            MAX(created_at) as last_activity,
            MAX(updated_at) as last_update
          FROM context_items
          WHERE channel = ?
        `
          )
          .get(channel) as any;

        expect(basicStats.total_items).toBe(5);
        expect(basicStats.unique_sessions).toBe(2);
        expect(basicStats.unique_categories).toBe(5); // task, error, note, progress, decision
        expect(basicStats.total_size).toBeGreaterThan(0);
        expect(basicStats.avg_size).toBeGreaterThan(0);
        expect(basicStats.first_activity).toBeDefined();
        expect(basicStats.last_activity).toBeDefined();
      });

      it('should calculate category distribution for a channel', () => {
        const categoryStats = db
          .prepare(
            `
          SELECT 
            category,
            COUNT(*) as count,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM context_items WHERE channel = ?), 2) as percentage
          FROM context_items
          WHERE channel = ?
          GROUP BY category
          ORDER BY count DESC
        `
          )
          .all('dev-channel', 'dev-channel') as any[];

        expect(categoryStats).toHaveLength(5);

        // Verify percentages add up to 100
        const totalPercentage = categoryStats.reduce(
          (sum: number, cat: any) => sum + cat.percentage,
          0
        );
        expect(totalPercentage).toBeCloseTo(100, 1);

        // Each category should have exactly 1 item (20% each)
        categoryStats.forEach((cat: any) => {
          expect(cat.count).toBe(1);
          expect(cat.percentage).toBe(20);
        });
      });

      it('should calculate priority distribution for a channel', () => {
        const priorityStats = db
          .prepare(
            `
          SELECT 
            priority,
            COUNT(*) as count,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM context_items WHERE channel = ?), 2) as percentage
          FROM context_items
          WHERE channel = ?
          GROUP BY priority
          ORDER BY 
            CASE priority 
              WHEN 'high' THEN 1 
              WHEN 'normal' THEN 2 
              WHEN 'low' THEN 3 
            END
        `
          )
          .all('dev-channel', 'dev-channel') as any[];

        expect(priorityStats).toHaveLength(2); // high and normal only in dev-channel

        const highPriority = priorityStats.find((p: any) => p.priority === 'high');
        expect(highPriority.count).toBe(3); // 60%
        expect(highPriority.percentage).toBe(60);

        const normalPriority = priorityStats.find((p: any) => p.priority === 'normal');
        expect(normalPriority.count).toBe(2); // 40%
        expect(normalPriority.percentage).toBe(40);
      });

      it('should calculate activity metrics over time', () => {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const activityStats = db
          .prepare(
            `
          SELECT 
            SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as items_last_24h,
            SUM(CASE WHEN updated_at > ? THEN 1 ELSE 0 END) as updates_last_24h,
            SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as items_last_week,
            SUM(CASE WHEN updated_at > ? THEN 1 ELSE 0 END) as updates_last_week
          FROM context_items
          WHERE channel = ?
        `
          )
          .get(
            oneDayAgo.toISOString(),
            oneDayAgo.toISOString(),
            oneWeekAgo.toISOString(),
            oneWeekAgo.toISOString(),
            'dev-channel'
          ) as any;

        expect(activityStats.items_last_24h).toBe(1); // Only dev_progress_1
        expect(activityStats.updates_last_24h).toBe(2); // dev_task_1 and dev_progress_1
        expect(activityStats.items_last_week).toBe(4); // All items except dev_task_1 (created exactly 7 days ago)
        expect(activityStats.updates_last_week).toBe(5); // All have been updated
      });

      it('should identify top contributors (sessions) to a channel', () => {
        const contributorStats = db
          .prepare(
            `
          SELECT 
            s.id as session_id,
            s.name as session_name,
            COUNT(ci.id) as item_count,
            SUM(ci.size) as total_size,
            MAX(ci.created_at) as last_contribution
          FROM sessions s
          JOIN context_items ci ON s.id = ci.session_id
          WHERE ci.channel = ?
          GROUP BY s.id, s.name
          ORDER BY item_count DESC
        `
          )
          .all('dev-channel') as any[];

        expect(contributorStats).toHaveLength(2);

        // testSessionId should be top contributor (4 items)
        expect(contributorStats[0].session_id).toBe(testSessionId);
        expect(contributorStats[0].item_count).toBe(4);
        expect(contributorStats[0].session_name).toBe('Dev Session');

        // testSessionId2 should have 1 item
        expect(contributorStats[1].session_id).toBe(testSessionId2);
        expect(contributorStats[1].item_count).toBe(1);
      });
    });

    describe('All channels overview statistics', () => {
      it('should return aggregated stats for all channels', () => {
        const overviewStats = db
          .prepare(
            `
          SELECT 
            COUNT(DISTINCT channel) as total_channels,
            COUNT(*) as total_items,
            COUNT(DISTINCT session_id) as total_sessions,
            SUM(size) as total_size,
            COUNT(DISTINCT category) as total_categories
          FROM context_items
        `
          )
          .get() as any;

        expect(overviewStats.total_channels).toBe(3); // dev-channel, feature-auth, general
        expect(overviewStats.total_items).toBe(10);
        expect(overviewStats.total_sessions).toBe(3);
        expect(overviewStats.total_categories).toBe(6); // task, error, note, progress, decision, warning
      });

      it('should rank channels by various metrics', () => {
        // Rank by item count
        const byItemCount = db
          .prepare(
            `
          SELECT 
            channel,
            COUNT(*) as item_count,
            RANK() OVER (ORDER BY COUNT(*) DESC) as rank
          FROM context_items
          GROUP BY channel
          ORDER BY rank
        `
          )
          .all() as any[];

        expect(byItemCount[0].channel).toBe('dev-channel');
        expect(byItemCount[0].item_count).toBe(5);
        expect(byItemCount[0].rank).toBe(1);

        // Rank by recent activity
        const byRecentActivity = db
          .prepare(
            `
          SELECT 
            channel,
            MAX(updated_at) as last_activity,
            RANK() OVER (ORDER BY MAX(updated_at) DESC) as rank
          FROM context_items
          GROUP BY channel
          ORDER BY rank
        `
          )
          .all() as any[];

        // Should be ordered by most recent activity
        expect(byRecentActivity[0].rank).toBe(1);
        expect(byRecentActivity[byRecentActivity.length - 1].channel).toBe('general'); // Least recent
      });

      it('should calculate channel health metrics', () => {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const _oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const healthMetrics = db
          .prepare(
            `
          SELECT 
            channel,
            COUNT(*) as total_items,
            SUM(CASE WHEN updated_at > ? THEN 1 ELSE 0 END) as recent_updates,
            COUNT(DISTINCT session_id) as active_sessions,
            ROUND(
              SUM(CASE WHEN updated_at > ? THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 
              2
            ) as freshness_score,
            julianday('now') - julianday(MAX(updated_at)) as days_since_update
          FROM context_items
          GROUP BY channel
          ORDER BY freshness_score DESC
        `
          )
          .all(oneDayAgo.toISOString(), oneDayAgo.toISOString()) as any[];

        expect(healthMetrics).toHaveLength(3);

        // Dev channel should have highest freshness (most recent updates)
        const devHealth = healthMetrics.find((h: any) => h.channel === 'dev-channel');
        expect(devHealth.recent_updates).toBeGreaterThan(0);
        expect(devHealth.freshness_score).toBeGreaterThan(0);
        expect(devHealth.active_sessions).toBe(2);

        // General channel should have lowest freshness
        const generalHealth = healthMetrics.find((h: any) => h.channel === 'general');
        expect(generalHealth.recent_updates).toBe(0);
        expect(generalHealth.freshness_score).toBe(0);
      });
    });

    describe('Time-based analysis', () => {
      it('should generate hourly activity heatmap for a channel', () => {
        const hourlyStats = db
          .prepare(
            `
          SELECT 
            strftime('%H', created_at) as hour,
            COUNT(*) as items_created,
            COUNT(DISTINCT session_id) as unique_sessions
          FROM context_items
          WHERE channel = ?
          GROUP BY hour
          ORDER BY hour
        `
          )
          .all('dev-channel') as any[];

        // Should have entries for hours when items were created
        expect(hourlyStats.length).toBeGreaterThan(0);
        hourlyStats.forEach((stat: any) => {
          expect(parseInt(stat.hour)).toBeGreaterThanOrEqual(0);
          expect(parseInt(stat.hour)).toBeLessThanOrEqual(23);
          expect(stat.items_created).toBeGreaterThan(0);
        });
      });

      it('should show daily activity trends', () => {
        const dailyTrends = db
          .prepare(
            `
          SELECT 
            DATE(created_at) as date,
            channel,
            COUNT(*) as items_created,
            COUNT(DISTINCT category) as categories_used
          FROM context_items
          WHERE created_at > date('now', '-7 days')
          GROUP BY date, channel
          ORDER BY date DESC, channel
        `
          )
          .all() as any[];

        expect(dailyTrends.length).toBeGreaterThan(0);

        // Verify structure
        dailyTrends.forEach((trend: any) => {
          expect(trend.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(trend.items_created).toBeGreaterThan(0);
          expect(trend.categories_used).toBeGreaterThan(0);
        });
      });

      it('should calculate growth rate over time periods', () => {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

        const growthStats = db
          .prepare(
            `
          SELECT 
            channel,
            SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as items_last_24h,
            SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) as items_previous_24h,
            CASE 
              WHEN SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) = 0 THEN 100
              ELSE ROUND(
                (SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) - 
                 SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END)) * 100.0 / 
                SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 
                2
              )
            END as growth_rate
          FROM context_items
          GROUP BY channel
        `
          )
          .all(
            oneDayAgo.toISOString(),
            twoDaysAgo.toISOString(),
            oneDayAgo.toISOString(),
            twoDaysAgo.toISOString(),
            oneDayAgo.toISOString(),
            oneDayAgo.toISOString(),
            twoDaysAgo.toISOString(),
            oneDayAgo.toISOString(),
            twoDaysAgo.toISOString(),
            oneDayAgo.toISOString()
          ) as any[];

        expect(growthStats).toHaveLength(3);
        growthStats.forEach((stat: any) => {
          expect(stat).toHaveProperty('items_last_24h');
          expect(stat).toHaveProperty('items_previous_24h');
          expect(stat).toHaveProperty('growth_rate');
        });
      });
    });

    describe('Pattern detection and insights', () => {
      it('should identify most frequently updated items', () => {
        const frequentUpdates = db
          .prepare(
            `
          SELECT 
            channel,
            key,
            value,
            julianday(updated_at) - julianday(created_at) as days_between_create_update,
            CASE 
              WHEN julianday(updated_at) - julianday(created_at) > 0 THEN 'frequently_updated'
              ELSE 'stable'
            END as update_pattern
          FROM context_items
          WHERE channel = ?
          ORDER BY days_between_create_update DESC
        `
          )
          .all('dev-channel') as any[];

        // Find items that have been updated after creation
        const updatedItems = frequentUpdates.filter(
          (item: any) => item.update_pattern === 'frequently_updated'
        );
        expect(updatedItems.length).toBeGreaterThan(0);

        // dev_task_1 should be most updated (created week ago, updated hour ago)
        expect(updatedItems[0].key).toBe('dev_task_1');
      });

      it('should detect category usage patterns', () => {
        const categoryPatterns = db
          .prepare(
            `
          WITH category_stats AS (
            SELECT 
              channel,
              category,
              COUNT(*) as usage_count,
              AVG(CASE priority 
                WHEN 'high' THEN 3 
                WHEN 'normal' THEN 2 
                WHEN 'low' THEN 1 
              END) as avg_priority_score
            FROM context_items
            GROUP BY channel, category
          )
          SELECT 
            channel,
            category,
            usage_count,
            ROUND(avg_priority_score, 2) as avg_priority_score,
            CASE 
              WHEN usage_count > 1 THEN 'frequent'
              ELSE 'occasional'
            END as usage_pattern
          FROM category_stats
          ORDER BY channel, usage_count DESC
        `
          )
          .all() as any[];

        expect(categoryPatterns.length).toBeGreaterThan(0);

        // Check feature-auth channel patterns
        const featurePatterns = categoryPatterns.filter((p: any) => p.channel === 'feature-auth');
        const taskPattern = featurePatterns.find((p: any) => p.category === 'task');
        expect(taskPattern).toBeDefined();
        expect(taskPattern.usage_count).toBe(2);
        expect(taskPattern.usage_pattern).toBe('frequent');
      });

      it('should generate actionable insights based on patterns', () => {
        // Simulate insight generation logic
        const insights: string[] = [];

        // Check for stale channels
        const staleChannels = db
          .prepare(
            `
          SELECT 
            channel,
            julianday('now') - julianday(MAX(updated_at)) as days_inactive
          FROM context_items
          GROUP BY channel
          HAVING days_inactive > 3
        `
          )
          .all() as any[];

        if (staleChannels.length > 0) {
          insights.push(`${staleChannels.length} channel(s) have been inactive for over 3 days`);
        }

        // Check for high-priority concentration
        const highPriorityStats = db
          .prepare(
            `
          SELECT 
            channel,
            SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as high_priority_percentage
          FROM context_items
          GROUP BY channel
          HAVING high_priority_percentage > 50
        `
          )
          .all() as any[];

        if (highPriorityStats.length > 0) {
          insights.push(`${highPriorityStats.length} channel(s) have over 50% high-priority items`);
        }

        // Check for single-category channels
        const singleCategoryChannels = db
          .prepare(
            `
          SELECT 
            channel,
            COUNT(DISTINCT category) as category_count
          FROM context_items
          GROUP BY channel
          HAVING category_count = 1
        `
          )
          .all() as any[];

        if (singleCategoryChannels.length > 0) {
          insights.push(`${singleCategoryChannels.length} channel(s) use only a single category`);
        }

        expect(insights.length).toBeGreaterThan(0);
        // At least one insight should be generated from the patterns
        const hasValidInsight = insights.some(
          i =>
            i.includes('inactive') || i.includes('high-priority') || i.includes('single category')
        );
        expect(hasValidInsight).toBe(true);
      });
    });

    describe('Cross-channel comparisons', () => {
      it('should compare channels by multiple metrics', () => {
        const comparison = db
          .prepare(
            `
          SELECT 
            channel,
            COUNT(*) as item_count,
            COUNT(DISTINCT session_id) as session_diversity,
            COUNT(DISTINCT category) as category_diversity,
            AVG(size) as avg_item_size,
            SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as high_priority_ratio,
            julianday('now') - julianday(MIN(created_at)) as channel_age_days,
            julianday('now') - julianday(MAX(updated_at)) as days_since_update
          FROM context_items
          GROUP BY channel
          ORDER BY item_count DESC
        `
          )
          .all() as any[];

        expect(comparison).toHaveLength(3);

        // Verify dev-channel has highest diversity
        const devChannel = comparison.find((c: any) => c.channel === 'dev-channel');
        expect(devChannel.session_diversity).toBe(2);
        expect(devChannel.category_diversity).toBe(5);
        expect(devChannel.item_count).toBe(5);

        // Compare with other channels
        comparison.forEach((channel: any) => {
          expect(channel.item_count).toBeGreaterThan(0);
          expect(channel.high_priority_ratio).toBeGreaterThanOrEqual(0);
          expect(channel.high_priority_ratio).toBeLessThanOrEqual(100);
        });
      });

      it('should identify channel relationships through shared sessions', () => {
        const relationships = db
          .prepare(
            `
          WITH channel_sessions AS (
            SELECT DISTINCT channel, session_id
            FROM context_items
          )
          SELECT 
            cs1.channel as channel1,
            cs2.channel as channel2,
            COUNT(DISTINCT cs1.session_id) as shared_sessions
          FROM channel_sessions cs1
          JOIN channel_sessions cs2 ON cs1.session_id = cs2.session_id
          WHERE cs1.channel < cs2.channel
          GROUP BY cs1.channel, cs2.channel
          HAVING shared_sessions > 0
          ORDER BY shared_sessions DESC
        `
          )
          .all() as any[];

        expect(relationships.length).toBeGreaterThan(0);

        // dev-channel and feature-auth share sessions
        const devFeatureRel = relationships.find(
          (r: any) =>
            (r.channel1 === 'dev-channel' && r.channel2 === 'feature-auth') ||
            (r.channel1 === 'feature-auth' && r.channel2 === 'dev-channel')
        );
        expect(devFeatureRel).toBeDefined();
        expect(devFeatureRel.shared_sessions).toBeGreaterThan(0);
      });
    });

    describe('Error handling and edge cases', () => {
      it('should handle requests for non-existent channels gracefully', () => {
        const stats = db
          .prepare(
            `
          SELECT 
            COUNT(*) as item_count,
            COUNT(DISTINCT session_id) as session_count
          FROM context_items
          WHERE channel = ?
        `
          )
          .get('non-existent-channel') as any;

        expect(stats.item_count).toBe(0);
        expect(stats.session_count).toBe(0);
      });

      it('should handle channels with null or empty categories', () => {
        // Insert item with null category
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, channel, category)
          VALUES (?, ?, ?, ?, ?, NULL)
        `
        ).run(uuidv4(), testSessionId, 'null-cat-item', 'value', 'test-channel');

        const categoryStats = db
          .prepare(
            `
          SELECT 
            COALESCE(category, 'uncategorized') as category,
            COUNT(*) as count
          FROM context_items
          WHERE channel = ?
          GROUP BY category
        `
          )
          .all('test-channel') as any[];

        const uncategorized = categoryStats.find((c: any) => c.category === 'uncategorized');
        expect(uncategorized).toBeDefined();
        expect(uncategorized.count).toBe(1);
      });

      it('should handle division by zero in percentage calculations', () => {
        // Create channel with single item to avoid division issues
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, channel, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, 'single-item', 'value', 'single-item-channel', 'high');

        const stats = db
          .prepare(
            `
          SELECT 
            channel,
            COUNT(*) as total,
            SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_count,
            CASE 
              WHEN COUNT(*) = 0 THEN 0
              ELSE ROUND(SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2)
            END as high_percentage
          FROM context_items
          WHERE channel = ?
          GROUP BY channel
        `
          )
          .get('single-item-channel') as any;

        expect(stats.total).toBe(1);
        expect(stats.high_count).toBe(1);
        expect(stats.high_percentage).toBe(100);
      });

      it('should handle very large result sets efficiently', () => {
        // This is more of a performance consideration test
        // In real implementation, would need pagination
        const largeResultTest = db
          .prepare(
            `
          SELECT 
            channel,
            COUNT(*) as count
          FROM context_items
          GROUP BY channel
          LIMIT 1000
        `
          )
          .all() as any[];

        expect(largeResultTest.length).toBeLessThanOrEqual(1000);
      });
    });
  });

  describe('Integration between list_channels and channel_stats', () => {
    beforeEach(() => {
      // Add some test data for integration tests
      const items = [
        {
          session: testSessionId,
          key: 'int_test_1',
          value: 'Integration test 1',
          channel: 'dev-channel',
          priority: 'high',
          category: 'test',
        },
        {
          session: testSessionId,
          key: 'int_test_2',
          value: 'Integration test 2',
          channel: 'dev-channel',
          priority: 'normal',
          category: 'test',
        },
        {
          session: testSessionId2,
          key: 'int_test_3',
          value: 'Integration test 3',
          channel: 'prod-channel',
          priority: 'high',
          category: 'test',
        },
      ];

      const stmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, channel, priority, category)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        stmt.run(
          uuidv4(),
          item.session,
          item.key,
          item.value,
          item.channel,
          item.priority,
          item.category
        );
      }
    });

    it('should be able to get stats for channels returned by list', () => {
      // First, list channels
      const channels = db
        .prepare(
          `
        SELECT DISTINCT channel
        FROM context_items
        ORDER BY channel
      `
        )
        .all() as any[];

      expect(channels.length).toBeGreaterThan(0);

      // Then, get stats for each channel
      const statsPromises = channels.map((ch: any) => {
        const stats = db
          .prepare(
            `
          SELECT 
            COUNT(*) as item_count,
            COUNT(DISTINCT category) as categories,
            MAX(updated_at) as last_activity
          FROM context_items
          WHERE channel = ?
        `
          )
          .get(ch.channel) as any;

        return {
          channel: ch.channel,
          ...stats,
        };
      });

      const allStats = statsPromises;
      expect(allStats).toHaveLength(channels.length);

      allStats.forEach(stat => {
        expect(stat.item_count).toBeGreaterThan(0);
        expect(stat.categories).toBeGreaterThan(0);
        expect(stat.last_activity).toBeDefined();
      });
    });

    it('should provide consistent data between list and stats views', () => {
      // Get count from list_channels perspective
      const listData = db
        .prepare(
          `
        SELECT 
          channel,
          COUNT(*) as list_count
        FROM context_items
        WHERE channel = ?
        GROUP BY channel
      `
        )
        .get('dev-channel') as any;

      // Get count from channel_stats perspective
      const statsData = db
        .prepare(
          `
        SELECT COUNT(*) as stats_count
        FROM context_items
        WHERE channel = ?
      `
        )
        .get('dev-channel') as any;

      expect(listData.list_count).toBe(statsData.stats_count);
    });
  });
});
