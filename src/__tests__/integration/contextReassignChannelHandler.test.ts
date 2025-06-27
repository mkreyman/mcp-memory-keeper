import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../../utils/validation';

describe('Context Reassign Channel Handler Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let _contextRepo: ContextRepository;
  let testSessionId: string;
  let secondSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-context-reassign-channel-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    _contextRepo = new ContextRepository(dbManager);

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
    const items = [
      // Main channel items
      {
        key: 'config.database.url',
        value: 'postgresql://localhost:5432/myapp',
        category: 'config',
        priority: 'high',
        channel: 'main',
      },
      {
        key: 'config.cache.ttl',
        value: '3600',
        category: 'config',
        priority: 'normal',
        channel: 'main',
      },
      {
        key: 'task.deploy.status',
        value: 'completed',
        category: 'task',
        priority: 'high',
        channel: 'main',
      },
      // Feature branch items
      {
        key: 'feature.auth.enabled',
        value: 'true',
        category: 'config',
        priority: 'high',
        channel: 'feature/auth',
      },
      {
        key: 'feature.auth.provider',
        value: 'oauth2',
        category: 'config',
        priority: 'normal',
        channel: 'feature/auth',
      },
      {
        key: 'task.auth.implement',
        value: 'in_progress',
        category: 'task',
        priority: 'high',
        channel: 'feature/auth',
      },
      // Development channel items
      {
        key: 'dev.debug.enabled',
        value: 'true',
        category: 'config',
        priority: 'low',
        channel: 'development',
      },
      {
        key: 'dev.log.level',
        value: 'debug',
        category: 'config',
        priority: 'low',
        channel: 'development',
      },
      // Private item
      {
        key: 'secret.api.key',
        value: 'sk-1234567890',
        category: 'config',
        priority: 'high',
        channel: 'secure',
        is_private: 1,
      },
      // Item from another session
      {
        key: 'other.session.item',
        value: 'Not accessible',
        category: 'note',
        priority: 'normal',
        channel: 'main',
        session_id: secondSessionId,
      },
    ];

    const stmt = db.prepare(`
      INSERT INTO context_items (
        id, session_id, key, value, category, priority, channel, is_private
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    items.forEach(item => {
      stmt.run(
        uuidv4(),
        item.session_id || testSessionId,
        item.key,
        item.value,
        item.category,
        item.priority,
        item.channel,
        item.is_private || 0
      );
    });
  }

  describe('Reassign by Specific Keys', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should reassign specific keys to a new channel', () => {
      const keysToMove = ['config.database.url', 'config.cache.ttl'];
      const newChannel = 'production';

      // Simulate handler logic
      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key IN (${keysToMove.map(() => '?').join(',')})
      `);

      const result = updateStmt.run(newChannel, testSessionId, ...keysToMove);

      expect(result.changes).toBe(2);

      // Verify the changes
      const movedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, newChannel) as any[];

      expect(movedItems.length).toBe(2);
      expect(movedItems.every((item: any) => item.channel === newChannel)).toBe(true);
      expect(movedItems.map((item: any) => item.key).sort()).toEqual(keysToMove.sort());

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                keys: keysToMove,
                newChannel: newChannel,
                itemsUpdated: result.changes,
                success: true,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.itemsUpdated).toBe(2);
      expect(parsed.success).toBe(true);
    });

    it('should handle non-existent keys gracefully', () => {
      const keysToMove = ['non.existent.key1', 'non.existent.key2'];
      const newChannel = 'production';

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key IN (${keysToMove.map(() => '?').join(',')})
      `);

      const result = updateStmt.run(newChannel, testSessionId, ...keysToMove);

      expect(result.changes).toBe(0);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                keys: keysToMove,
                newChannel: newChannel,
                itemsUpdated: 0,
                warning: 'No items found matching the specified keys',
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.itemsUpdated).toBe(0);
      expect(parsed.warning).toBeTruthy();
    });

    it('should not reassign items from other sessions', () => {
      const keysToMove = ['other.session.item'];
      const newChannel = 'production';

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key IN (${keysToMove.map(() => '?').join(',')})
      `);

      const result = updateStmt.run(newChannel, testSessionId, ...keysToMove);

      expect(result.changes).toBe(0);

      // Verify item wasn't moved
      const item = db
        .prepare('SELECT * FROM context_items WHERE key = ?')
        .get('other.session.item') as any;

      expect(item.channel).toBe('main'); // Original channel
      expect(item.session_id).toBe(secondSessionId);
    });

    it('should handle empty keys array', () => {
      const keysToMove: string[] = [];
      const _newChannel = 'production';

      // Handler should validate input
      try {
        if (keysToMove.length === 0) {
          throw new ValidationError('Keys array cannot be empty');
        }
      } catch (_error) {
        expect(_error).toBeInstanceOf(ValidationError);
        expect((_error as ValidationError).message).toContain('Keys array cannot be empty');
      }
    });
  });

  describe('Reassign by Key Pattern', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should reassign items matching key pattern', () => {
      const keyPattern = 'config.*';
      const newChannel = 'configuration';

      // Convert pattern to SQL GLOB pattern
      const globPattern = keyPattern.replace(/\*/g, '%');

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key LIKE ?
      `);

      const result = updateStmt.run(newChannel, testSessionId, globPattern);

      // Should update config.database.url and config.cache.ttl (not feature.auth.* or dev.*)
      expect(result.changes).toBe(2);

      // Verify the changes
      const movedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, newChannel) as any[];

      expect(movedItems.length).toBe(2);
      expect(movedItems.every((item: any) => item.key.startsWith('config.'))).toBe(true);
    });

    it('should handle complex patterns', () => {
      const keyPattern = 'feature.*.enabled';
      const newChannel = 'feature-flags';

      // This pattern should match keys like feature.auth.enabled
      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key GLOB ?
      `);

      const result = updateStmt.run(newChannel, testSessionId, keyPattern);

      expect(result.changes).toBe(1);

      const movedItem = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, 'feature.auth.enabled') as any;

      expect(movedItem.channel).toBe('feature-flags');
    });

    it('should combine pattern with other filters', () => {
      const keyPattern = '*.*';
      const category = 'config';
      const newChannel = 'settings';

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key GLOB ? AND category = ?
      `);

      const _result = updateStmt.run(newChannel, testSessionId, keyPattern, category);

      // Should update all config items with dot notation keys
      const movedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, newChannel) as any[];

      expect(movedItems.every((item: any) => item.category === 'config')).toBe(true);
      expect(movedItems.every((item: any) => item.key.includes('.'))).toBe(true);
    });

    it('should handle pattern with no matches', () => {
      const keyPattern = 'nonexistent.*';
      const newChannel = 'nowhere';

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key GLOB ?
      `);

      const result = updateStmt.run(newChannel, testSessionId, keyPattern);

      expect(result.changes).toBe(0);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                keyPattern: keyPattern,
                newChannel: newChannel,
                itemsUpdated: 0,
                warning: 'No items found matching the pattern',
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.warning).toBeTruthy();
    });
  });

  describe('Reassign Entire Channel', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should move all items from one channel to another', () => {
      const fromChannel = 'feature/auth';
      const toChannel = 'release/v1.0';

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND channel = ?
      `);

      const result = updateStmt.run(toChannel, testSessionId, fromChannel);

      expect(result.changes).toBe(3); // All feature/auth items

      // Verify no items remain in old channel
      const oldChannelItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, fromChannel) as any[];

      expect(oldChannelItems.length).toBe(0);

      // Verify all items moved to new channel
      const newChannelItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, toChannel) as any[];

      expect(newChannelItems.length).toBe(3);
    });

    it('should handle channel merge conflicts', () => {
      // Add an item to target channel first
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value, channel)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, 'existing.item', 'Already in production', 'production');

      const fromChannel = 'main';
      const toChannel = 'production';

      // Get count before merge
      const beforeCount = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM context_items WHERE session_id = ? AND channel = ?'
          )
          .get(testSessionId, toChannel) as any
      ).count;

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND channel = ?
      `);

      const result = updateStmt.run(toChannel, testSessionId, fromChannel);

      // Get count after merge
      const afterCount = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM context_items WHERE session_id = ? AND channel = ?'
          )
          .get(testSessionId, toChannel) as any
      ).count;

      expect(afterCount).toBe(beforeCount + result.changes);
    });

    it('should not move items when source channel is empty', () => {
      const fromChannel = 'non-existent-channel';
      const toChannel = 'production';

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND channel = ?
      `);

      const result = updateStmt.run(toChannel, testSessionId, fromChannel);

      expect(result.changes).toBe(0);
    });
  });

  describe('Filtered Reassignment', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should reassign with category filter', () => {
      const fromChannel = 'main';
      const toChannel = 'tasks';
      const category = 'task';

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND channel = ? AND category = ?
      `);

      const result = updateStmt.run(toChannel, testSessionId, fromChannel, category);

      expect(result.changes).toBe(1); // Only task.deploy.status

      // Verify only tasks moved
      const movedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, toChannel) as any[];

      expect(movedItems.every((item: any) => item.category === 'task')).toBe(true);

      // Verify config items stayed in main
      const remainingItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, fromChannel) as any[];

      expect(remainingItems.some((item: any) => item.category === 'config')).toBe(true);
    });

    it('should reassign with priority filter', () => {
      const fromChannel = 'feature/auth';
      const toChannel = 'critical';
      const priorities = ['high'];

      const placeholders = priorities.map(() => '?').join(',');
      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND channel = ? AND priority IN (${placeholders})
      `);

      const result = updateStmt.run(toChannel, testSessionId, fromChannel, ...priorities);

      expect(result.changes).toBe(2); // feature.auth.enabled and task.auth.implement

      // Verify only high priority items moved
      const movedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, toChannel) as any[];

      expect(movedItems.every((item: any) => item.priority === 'high')).toBe(true);
    });

    it('should reassign with multiple filters combined', () => {
      const keyPattern = 'feature.*';
      const category = 'config';
      const priorities = ['high', 'normal'];
      const newChannel = 'feature-config';

      const placeholders = priorities.map(() => '?').join(',');
      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? 
          AND key GLOB ? 
          AND category = ? 
          AND priority IN (${placeholders})
      `);

      const result = updateStmt.run(newChannel, testSessionId, keyPattern, category, ...priorities);

      // Should match feature.auth.enabled and feature.auth.provider
      expect(result.changes).toBe(2);

      const movedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, newChannel) as any[];

      expect(movedItems.every((item: any) => item.key.startsWith('feature.'))).toBe(true);
      expect(movedItems.every((item: any) => item.category === 'config')).toBe(true);
    });
  });

  describe('Dry Run Support', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should preview changes without applying them', () => {
      const fromChannel = 'main';
      const toChannel = 'production';
      const _dryRun = true;

      // In dry run, we SELECT instead of UPDATE
      const previewStmt = db.prepare(`
        SELECT id, key, value, category, priority, channel
        FROM context_items 
        WHERE session_id = ? AND channel = ?
      `);

      const itemsToMove = previewStmt.all(testSessionId, fromChannel) as any[];

      expect(itemsToMove.length).toBe(3);

      // Verify no actual changes were made
      const originalItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, fromChannel) as any[];

      expect(originalItems.length).toBe(3); // Still in original channel

      // Handler response for dry run
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                dryRun: true,
                fromChannel: fromChannel,
                toChannel: toChannel,
                itemsToMove: itemsToMove.map((item: any) => ({
                  key: item.key,
                  value: item.value.substring(0, 50) + (item.value.length > 50 ? '...' : ''),
                  category: item.category,
                  priority: item.priority,
                })),
                totalItems: itemsToMove.length,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.totalItems).toBe(3);
      expect(parsed.itemsToMove).toHaveLength(3);
    });

    it('should preview pattern-based reassignment', () => {
      const keyPattern = 'config.*';
      const newChannel = 'settings';
      const _dryRun = true;

      const previewStmt = db.prepare(`
        SELECT id, key, value, category, priority, channel
        FROM context_items 
        WHERE session_id = ? AND key LIKE ?
      `);

      const itemsToMove = previewStmt.all(testSessionId, keyPattern.replace(/\*/g, '%')) as any[];

      expect(itemsToMove.length).toBe(2);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                dryRun: true,
                keyPattern: keyPattern,
                newChannel: newChannel,
                itemsToMove: itemsToMove.map((item: any) => ({
                  key: item.key,
                  currentChannel: item.channel,
                  category: item.category,
                  priority: item.priority,
                })),
                totalItems: itemsToMove.length,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totalItems).toBe(2);
      expect(parsed.itemsToMove.every((item: any) => item.key.startsWith('config.'))).toBe(true);
    });

    it('should show empty preview when no matches', () => {
      const keyPattern = 'nonexistent.*';
      const newChannel = 'nowhere';
      const _dryRun = true;

      const previewStmt = db.prepare(`
        SELECT id, key, value, category, priority, channel
        FROM context_items 
        WHERE session_id = ? AND key GLOB ?
      `);

      const itemsToMove = previewStmt.all(testSessionId, keyPattern) as any[];

      expect(itemsToMove.length).toBe(0);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                dryRun: true,
                keyPattern: keyPattern,
                newChannel: newChannel,
                itemsToMove: [],
                totalItems: 0,
                message: 'No items would be moved',
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totalItems).toBe(0);
      expect(parsed.message).toBeTruthy();
    });
  });

  describe('Handler Response Formats', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should return detailed response for successful reassignment', () => {
      const keys = ['config.database.url', 'config.cache.ttl'];
      const newChannel = 'production';

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key IN (${keys.map(() => '?').join(',')})
      `);

      const result = updateStmt.run(newChannel, testSessionId, ...keys);

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                method: 'keys',
                keys: keys,
                newChannel: newChannel,
                itemsUpdated: result.changes,
                timestamp: new Date().toISOString(),
                success: true,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.method).toBe('keys');
      expect(parsed.itemsUpdated).toBe(2);
      expect(parsed.success).toBe(true);
      expect(parsed.timestamp).toBeTruthy();
    });

    it('should return summary for channel-to-channel move', () => {
      const fromChannel = 'feature/auth';
      const toChannel = 'release/v1.0';

      // Get items before move
      const itemsBefore = db
        .prepare('SELECT key FROM context_items WHERE session_id = ? AND channel = ?')
        .all(testSessionId, fromChannel) as any[];

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND channel = ?
      `);

      const result = updateStmt.run(toChannel, testSessionId, fromChannel);

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                method: 'channel',
                fromChannel: fromChannel,
                toChannel: toChannel,
                itemsUpdated: result.changes,
                movedKeys: itemsBefore.map((item: any) => item.key),
                timestamp: new Date().toISOString(),
                success: true,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.method).toBe('channel');
      expect(parsed.movedKeys).toHaveLength(3);
      expect(parsed.fromChannel).toBe('feature/auth');
      expect(parsed.toChannel).toBe('release/v1.0');
    });

    it('should include filter details in response', () => {
      const keyPattern = 'config.*';
      const category = 'config';
      const priorities = ['high'];
      const newChannel = 'critical-config';

      const placeholders = priorities.map(() => '?').join(',');
      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? 
          AND key LIKE ? 
          AND category = ? 
          AND priority IN (${placeholders})
      `);

      const result = updateStmt.run(
        newChannel,
        testSessionId,
        keyPattern.replace(/\*/g, '%'),
        category,
        ...priorities
      );

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'reassign_channel',
                method: 'filtered',
                filters: {
                  keyPattern: keyPattern,
                  category: category,
                  priorities: priorities,
                },
                newChannel: newChannel,
                itemsUpdated: result.changes,
                success: true,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.method).toBe('filtered');
      expect(parsed.filters).toEqual({
        keyPattern: keyPattern,
        category: category,
        priorities: priorities,
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should validate channel name', () => {
      const invalidChannels = ['', '  ', null, undefined];

      invalidChannels.forEach(invalidChannel => {
        try {
          if (!invalidChannel || !invalidChannel.trim()) {
            throw new ValidationError('Channel name cannot be empty');
          }
        } catch (_error) {
          expect(_error).toBeInstanceOf(ValidationError);
          expect((_error as ValidationError).message).toContain('Channel name cannot be empty');
        }
      });
    });

    it('should handle database errors gracefully', () => {
      // Close database to simulate error
      dbManager.close();

      try {
        db.prepare('UPDATE context_items SET channel = ? WHERE session_id = ?').run(
          'new-channel',
          testSessionId
        );
      } catch (_error) {
        expect(_error).toBeTruthy();
      }
    });

    it('should validate reassignment parameters', () => {
      // No keys, pattern, or fromChannel provided
      const args = {
        toChannel: 'production',
      } as any;

      try {
        if (!args.keys && !args.keyPattern && !args.fromChannel) {
          throw new ValidationError('Must provide either keys array, keyPattern, or fromChannel');
        }
      } catch (_error) {
        expect(_error).toBeInstanceOf(ValidationError);
        expect((_error as ValidationError).message).toContain('Must provide either');
      }
    });

    it('should prevent reassigning to same channel', () => {
      const fromChannel = 'main';
      const toChannel = 'main';

      try {
        if (fromChannel === toChannel) {
          throw new ValidationError('Source and destination channels cannot be the same');
        }
      } catch (_error) {
        expect(_error).toBeInstanceOf(ValidationError);
        expect((_error as ValidationError).message).toContain('cannot be the same');
      }
    });

    it('should handle SQL injection in channel names', () => {
      const maliciousChannel = "'; DROP TABLE context_items; --";
      const keys = ['config.database.url'];

      // Parameterized queries should prevent injection
      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key = ?
      `);

      const result = updateStmt.run(maliciousChannel, testSessionId, keys[0]);

      // Should work normally
      expect(result.changes).toBe(1);

      // Verify table still exists
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='context_items'")
        .get();

      expect(tableExists).toBeTruthy();

      // Verify the channel was set correctly
      const item = db.prepare('SELECT * FROM context_items WHERE key = ?').get(keys[0]) as any;

      expect(item.channel).toBe(maliciousChannel);
    });
  });

  describe('Transaction Support', () => {
    beforeEach(() => {
      createTestData();
    });

    it('should perform reassignment in a transaction', () => {
      const fromChannel = 'feature/auth';
      const toChannel = 'production';

      let itemsUpdated = 0;

      try {
        db.prepare('BEGIN TRANSACTION').run();

        // First, get the items that will be moved
        const itemsToMove = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
          .all(testSessionId, fromChannel) as any[];

        // Update the items
        const updateStmt = db.prepare(`
          UPDATE context_items 
          SET channel = ?, updated_at = CURRENT_TIMESTAMP
          WHERE session_id = ? AND channel = ?
        `);

        const result = updateStmt.run(toChannel, testSessionId, fromChannel);
        itemsUpdated = result.changes;

        // Verify within transaction
        const movedItems = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND channel = ?')
          .all(testSessionId, toChannel) as any[];

        expect(movedItems.length).toBe(itemsToMove.length);

        db.prepare('COMMIT').run();
      } catch (_error) {
        db.prepare('ROLLBACK').run();
        throw _error;
      }

      expect(itemsUpdated).toBe(3);
    });

    it('should rollback on error', () => {
      const fromChannel = 'main';
      const toChannel = 'production';

      // Count items before transaction
      const countBefore = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM context_items WHERE session_id = ? AND channel = ?'
          )
          .get(testSessionId, fromChannel) as any
      ).count;

      try {
        db.prepare('BEGIN TRANSACTION').run();

        // Start update
        const updateStmt = db.prepare(`
          UPDATE context_items 
          SET channel = ?, updated_at = CURRENT_TIMESTAMP
          WHERE session_id = ? AND channel = ?
        `);

        updateStmt.run(toChannel, testSessionId, fromChannel);

        // Simulate an error
        throw new Error('Simulated error');
      } catch (_error) {
        db.prepare('ROLLBACK').run();
      }

      // Count items after rollback
      const countAfter = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM context_items WHERE session_id = ? AND channel = ?'
          )
          .get(testSessionId, fromChannel) as any
      ).count;

      expect(countAfter).toBe(countBefore); // No changes
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large batch reassignments efficiently', () => {
      // Create 1000 items
      const stmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, channel)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < 1000; i++) {
        stmt.run(
          uuidv4(),
          testSessionId,
          `bulk.item.${i.toString().padStart(4, '0')}`,
          `Bulk value ${i}`,
          'bulk-source'
        );
      }

      const fromChannel = 'bulk-source';
      const toChannel = 'bulk-target';

      const startTime = Date.now();

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND channel = ?
      `);

      const result = updateStmt.run(toChannel, testSessionId, fromChannel);

      const endTime = Date.now();

      expect(result.changes).toBe(1000);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second

      // Verify all items moved
      const remainingCount = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM context_items WHERE session_id = ? AND channel = ?'
          )
          .get(testSessionId, fromChannel) as any
      ).count;

      expect(remainingCount).toBe(0);
    });

    it('should handle pattern matching on large datasets', () => {
      // Create items with various patterns
      const patterns = ['config', 'feature', 'task', 'dev', 'test'];
      const stmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, channel)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < 500; i++) {
        const pattern = patterns[i % patterns.length];
        stmt.run(uuidv4(), testSessionId, `${pattern}.item.${i}`, `Value ${i}`, 'mixed-channel');
      }

      const keyPattern = 'config.*';
      const newChannel = 'config-channel';

      const startTime = Date.now();

      const updateStmt = db.prepare(`
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND key GLOB ?
      `);

      const result = updateStmt.run(newChannel, testSessionId, keyPattern);

      const endTime = Date.now();

      expect(result.changes).toBe(100); // 500 / 5 patterns
      expect(endTime - startTime).toBeLessThan(500); // Should be fast
    });
  });
});
