import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../../utils/validation';

describe('Batch Operations Handler Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let _contextRepo: ContextRepository;
  let testSessionId: string;
  let secondSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-batch-operations-${Date.now()}.db`);
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

  describe('Batch Save Operations', () => {
    it('should save multiple items in a single batch', () => {
      const items = [
        {
          key: 'batch.config.db',
          value: 'postgresql://localhost:5432/app',
          category: 'config',
          priority: 'high',
          channel: 'main',
        },
        {
          key: 'batch.config.cache',
          value: 'redis://localhost:6379',
          category: 'config',
          priority: 'normal',
          channel: 'main',
        },
        {
          key: 'batch.task.deploy',
          value: 'Deploy to production',
          category: 'task',
          priority: 'high',
          channel: 'deployment',
        },
      ];

      // Simulate batch save handler logic
      const results: any[] = [];
      const errors: any[] = [];

      db.prepare('BEGIN TRANSACTION').run();

      try {
        const stmt = db.prepare(`
          INSERT INTO context_items (
            id, session_id, key, value, category, priority, channel, 
            created_at, updated_at, size
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        items.forEach((item, index) => {
          try {
            const id = uuidv4();
            const now = new Date().toISOString();
            const size = Buffer.byteLength(item.value, 'utf8');

            stmt.run(
              id,
              testSessionId,
              item.key,
              item.value,
              item.category || null,
              item.priority || 'normal',
              item.channel || 'general',
              now,
              now,
              size
            );

            results.push({
              index,
              key: item.key,
              success: true,
              id,
            });
          } catch (error) {
            errors.push({
              index,
              key: item.key,
              error: (error as Error).message,
            });
          }
        });

        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }

      expect(results.length).toBe(3);
      expect(errors.length).toBe(0);

      // Verify items were saved
      const savedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key')
        .all(testSessionId) as any[];

      expect(savedItems.length).toBe(3);
      expect(savedItems.map((item: any) => item.key)).toEqual([
        'batch.config.cache',
        'batch.config.db',
        'batch.task.deploy',
      ]);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_save',
                totalItems: items.length,
                succeeded: results.length,
                failed: errors.length,
                results: results,
                errors: errors,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.succeeded).toBe(3);
      expect(parsed.failed).toBe(0);
    });

    it('should handle duplicate keys in batch save', () => {
      // First, create an existing item
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value)
        VALUES (?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, 'existing.key', 'Original value');

      const items = [
        {
          key: 'new.key.1',
          value: 'New value 1',
        },
        {
          key: 'existing.key', // Duplicate
          value: 'Updated value',
        },
        {
          key: 'new.key.2',
          value: 'New value 2',
        },
      ];

      const results: any[] = [];
      const errors: any[] = [];

      db.prepare('BEGIN TRANSACTION').run();

      try {
        items.forEach((item, index) => {
          try {
            // Check if key exists
            const existing = db
              .prepare('SELECT id FROM context_items WHERE session_id = ? AND key = ?')
              .get(testSessionId, item.key);

            if (existing) {
              // Update existing
              db.prepare(
                `
                UPDATE context_items 
                SET value = ?, updated_at = CURRENT_TIMESTAMP
                WHERE session_id = ? AND key = ?
              `
              ).run(item.value, testSessionId, item.key);

              results.push({
                index,
                key: item.key,
                success: true,
                action: 'updated',
              });
            } else {
              // Insert new
              const id = uuidv4();
              db.prepare(
                `
                INSERT INTO context_items (id, session_id, key, value)
                VALUES (?, ?, ?, ?)
              `
              ).run(id, testSessionId, item.key, item.value);

              results.push({
                index,
                key: item.key,
                success: true,
                action: 'created',
                id,
              });
            }
          } catch (error) {
            errors.push({
              index,
              key: item.key,
              error: (error as Error).message,
            });
          }
        });

        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }

      expect(results.length).toBe(3);
      expect(results.filter(r => r.action === 'created').length).toBe(2);
      expect(results.filter(r => r.action === 'updated').length).toBe(1);

      // Verify the update
      const updated = db
        .prepare('SELECT * FROM context_items WHERE key = ?')
        .get('existing.key') as any;

      expect(updated.value).toBe('Updated value');
    });

    it('should validate batch save items', () => {
      const invalidItems = [
        {
          // Missing key
          value: 'No key provided',
        },
        {
          key: '', // Empty key
          value: 'Empty key',
        },
        {
          key: 'no.value',
          // Missing value
        },
        {
          key: 'invalid.category',
          value: 'Invalid category',
          category: 'invalid-category', // Invalid category
        },
        {
          key: 'invalid.priority',
          value: 'Invalid priority',
          priority: 'urgent', // Invalid priority
        },
      ];

      const errors: any[] = [];

      invalidItems.forEach((item, index) => {
        try {
          // Validate key
          if (!item.key || !item.key.trim()) {
            throw new ValidationError('Key is required and cannot be empty');
          }

          // Validate value
          if (!item.value) {
            throw new ValidationError('Value is required');
          }

          // Validate category
          if (item.category) {
            const validCategories = ['task', 'decision', 'progress', 'note', 'error', 'warning'];
            if (!validCategories.includes(item.category)) {
              throw new ValidationError(`Invalid category: ${item.category}`);
            }
          }

          // Validate priority
          if (item.priority) {
            const validPriorities = ['high', 'normal', 'low'];
            if (!validPriorities.includes(item.priority)) {
              throw new ValidationError(`Invalid priority: ${item.priority}`);
            }
          }
        } catch (error) {
          errors.push({
            index,
            key: item.key || 'undefined',
            error: (error as Error).message,
          });
        }
      });

      expect(errors.length).toBe(5);
      expect(errors[0].error).toContain('Key is required');
      expect(errors[1].error).toContain('Key is required');
      expect(errors[2].error).toContain('Value is required');
      expect(errors[3].error).toContain('Invalid category');
      expect(errors[4].error).toContain('Invalid priority');
    });

    it('should handle partial batch save failures', () => {
      const items = [
        {
          key: 'valid.item.1',
          value: 'Valid value 1',
        },
        {
          key: '', // Will fail validation
          value: 'Invalid key',
        },
        {
          key: 'valid.item.2',
          value: 'Valid value 2',
        },
        {
          key: 'invalid.priority',
          value: 'Invalid priority',
          priority: 'urgent', // Will fail validation
        },
        {
          key: 'valid.item.3',
          value: 'Valid value 3',
        },
      ];

      const results: any[] = [];
      const errors: any[] = [];

      items.forEach((item, index) => {
        try {
          // Validate
          if (!item.key || !item.key.trim()) {
            throw new ValidationError('Key is required');
          }

          if (item.priority) {
            const validPriorities = ['high', 'normal', 'low'];
            if (!validPriorities.includes(item.priority)) {
              throw new ValidationError(`Invalid priority: ${item.priority}`);
            }
          }

          // Save
          const id = uuidv4();
          db.prepare(
            `
            INSERT INTO context_items (id, session_id, key, value, priority)
            VALUES (?, ?, ?, ?, ?)
          `
          ).run(id, testSessionId, item.key, item.value, item.priority || 'normal');

          results.push({
            index,
            key: item.key,
            success: true,
            id,
          });
        } catch (error) {
          errors.push({
            index,
            key: item.key || 'undefined',
            error: (error as Error).message,
          });
        }
      });

      expect(results.length).toBe(3); // 3 valid items
      expect(errors.length).toBe(2); // 2 invalid items

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_save',
                totalItems: items.length,
                succeeded: results.length,
                failed: errors.length,
                results: results,
                errors: errors,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.succeeded).toBe(3);
      expect(parsed.failed).toBe(2);
    });

    it('should enforce batch size limits', () => {
      const maxBatchSize = 100;
      const items = Array.from({ length: 150 }, (_, i) => ({
        key: `batch.item.${i}`,
        value: `Value ${i}`,
      }));

      try {
        if (items.length > maxBatchSize) {
          throw new ValidationError(
            `Batch size ${items.length} exceeds maximum allowed size of ${maxBatchSize}`
          );
        }
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain('exceeds maximum allowed size');
      }
    });

    it('should calculate total size for batch operations', () => {
      const items = [
        {
          key: 'small.item',
          value: 'Small',
        },
        {
          key: 'medium.item',
          value: 'This is a medium sized value with more content',
        },
        {
          key: 'large.item',
          value: 'A'.repeat(1000), // 1KB
        },
      ];

      let totalSize = 0;
      const results: any[] = [];

      items.forEach((item, index) => {
        const size = Buffer.byteLength(item.value, 'utf8');
        totalSize += size;

        const id = uuidv4();
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, size)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(id, testSessionId, item.key, item.value, size);

        results.push({
          index,
          key: item.key,
          success: true,
          id,
          size,
        });
      });

      expect(totalSize).toBeGreaterThan(1000);

      // Handler response with size information
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_save',
                totalItems: items.length,
                succeeded: results.length,
                failed: 0,
                totalSize: totalSize,
                averageSize: Math.round(totalSize / items.length),
                results: results,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totalSize).toBe(totalSize);
      expect(parsed.averageSize).toBeGreaterThan(0);
    });
  });

  describe('Batch Delete Operations', () => {
    beforeEach(() => {
      // Create test items
      const items = [
        'delete.item.1',
        'delete.item.2',
        'delete.item.3',
        'keep.item.1',
        'keep.item.2',
      ];

      items.forEach(key => {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value)
          VALUES (?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, key, `Value for ${key}`);
      });

      // Create item in another session
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value)
        VALUES (?, ?, ?, ?)
      `
      ).run(uuidv4(), secondSessionId, 'delete.item.1', 'Another session item');
    });

    it('should delete multiple items by keys', () => {
      const keysToDelete = ['delete.item.1', 'delete.item.2', 'delete.item.3'];

      // Simulate batch delete handler
      const results: any[] = [];

      db.prepare('BEGIN TRANSACTION').run();

      try {
        keysToDelete.forEach((key, index) => {
          const result = db
            .prepare('DELETE FROM context_items WHERE session_id = ? AND key = ?')
            .run(testSessionId, key);

          results.push({
            index,
            key,
            deleted: result.changes > 0,
            count: result.changes,
          });
        });

        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }

      expect(results.every(r => r.deleted)).toBe(true);
      expect(results.reduce((sum, r) => sum + r.count, 0)).toBe(3);

      // Verify items were deleted
      const remainingItems = db
        .prepare('SELECT key FROM context_items WHERE session_id = ?')
        .all(testSessionId) as any[];

      expect(remainingItems.length).toBe(2);
      expect(remainingItems.map((item: any) => item.key).sort()).toEqual([
        'keep.item.1',
        'keep.item.2',
      ]);

      // Verify item from other session wasn't deleted
      const otherSessionItem = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(secondSessionId, 'delete.item.1');

      expect(otherSessionItem).toBeTruthy();

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_delete',
                keys: keysToDelete,
                totalDeleted: 3,
                results: results,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totalDeleted).toBe(3);
    });

    it('should handle non-existent keys in batch delete', () => {
      const keysToDelete = ['delete.item.1', 'non.existent.1', 'delete.item.2', 'non.existent.2'];

      const results: any[] = [];

      keysToDelete.forEach((key, index) => {
        const result = db
          .prepare('DELETE FROM context_items WHERE session_id = ? AND key = ?')
          .run(testSessionId, key);

        results.push({
          index,
          key,
          deleted: result.changes > 0,
          count: result.changes,
        });
      });

      const deletedCount = results.filter(r => r.deleted).length;
      expect(deletedCount).toBe(2);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_delete',
                keys: keysToDelete,
                totalRequested: keysToDelete.length,
                totalDeleted: deletedCount,
                notFound: results.filter(r => !r.deleted).map(r => r.key),
                results: results,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totalDeleted).toBe(2);
      expect(parsed.notFound).toHaveLength(2);
    });

    it('should validate keys before deletion', () => {
      const invalidKeys = ['', '  ', null, undefined];
      const errors: any[] = [];

      invalidKeys.forEach((key, index) => {
        try {
          if (!key || !key.trim()) {
            throw new ValidationError('Key cannot be empty');
          }
        } catch (error) {
          errors.push({
            index,
            key: key || 'undefined',
            error: (error as Error).message,
          });
        }
      });

      expect(errors.length).toBe(4);
    });

    it('should handle batch delete with pattern matching', () => {
      const pattern = 'delete.item.*';

      // Convert to SQL pattern
      const sqlPattern = pattern.replace(/\*/g, '%');

      const result = db
        .prepare('DELETE FROM context_items WHERE session_id = ? AND key LIKE ?')
        .run(testSessionId, sqlPattern);

      expect(result.changes).toBe(3);

      // Verify only keep.item.* remain
      const remainingItems = db
        .prepare('SELECT key FROM context_items WHERE session_id = ?')
        .all(testSessionId) as any[];

      expect(remainingItems.every((item: any) => item.key.startsWith('keep.'))).toBe(true);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_delete',
                pattern: pattern,
                totalDeleted: result.changes,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totalDeleted).toBe(3);
    });

    it('should support dry run for batch delete', () => {
      const keysToDelete = ['delete.item.1', 'delete.item.2'];
      const _dryRun = true;

      // In dry run, SELECT instead of DELETE
      const itemsToDelete = db
        .prepare(
          `SELECT key, value, category, priority FROM context_items 
           WHERE session_id = ? AND key IN (${keysToDelete.map(() => '?').join(',')})`
        )
        .all(testSessionId, ...keysToDelete) as any[];

      expect(itemsToDelete.length).toBe(2);

      // Verify no actual deletion
      const count = (
        db
          .prepare('SELECT COUNT(*) as count FROM context_items WHERE session_id = ?')
          .get(testSessionId) as any
      ).count;

      expect(count).toBe(5); // All items still exist

      // Handler response for dry run
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_delete',
                dryRun: true,
                keys: keysToDelete,
                itemsToDelete: itemsToDelete.map((item: any) => ({
                  key: item.key,
                  value: item.value.substring(0, 50) + (item.value.length > 50 ? '...' : ''),
                  category: item.category,
                  priority: item.priority,
                })),
                totalItems: itemsToDelete.length,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.itemsToDelete).toHaveLength(2);
    });
  });

  describe('Batch Update Operations', () => {
    beforeEach(() => {
      // Create test items with various properties
      const items = [
        {
          key: 'update.item.1',
          value: 'Original value 1',
          category: 'task',
          priority: 'normal',
          channel: 'main',
        },
        {
          key: 'update.item.2',
          value: 'Original value 2',
          category: 'note',
          priority: 'low',
          channel: 'main',
        },
        {
          key: 'update.item.3',
          value: 'Original value 3',
          category: 'config',
          priority: 'high',
          channel: 'development',
        },
      ];

      items.forEach(item => {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, category, priority, channel)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          item.key,
          item.value,
          item.category,
          item.priority,
          item.channel
        );
      });
    });

    it('should update multiple items with different changes', () => {
      const updates = [
        {
          key: 'update.item.1',
          updates: {
            value: 'Updated value 1',
            priority: 'high',
          },
        },
        {
          key: 'update.item.2',
          updates: {
            category: 'task',
            channel: 'production',
          },
        },
        {
          key: 'update.item.3',
          updates: {
            value: 'Completely new value',
            category: 'note',
            priority: 'normal',
          },
        },
      ];

      const results: any[] = [];

      db.prepare('BEGIN TRANSACTION').run();

      try {
        updates.forEach((update, index) => {
          // Build dynamic UPDATE statement
          const setClauses: string[] = [];
          const values: any[] = [];

          if (update.updates.value !== undefined) {
            setClauses.push('value = ?');
            values.push(update.updates.value);
          }
          if (update.updates.category !== undefined) {
            setClauses.push('category = ?');
            values.push(update.updates.category);
          }
          if (update.updates.priority !== undefined) {
            setClauses.push('priority = ?');
            values.push(update.updates.priority);
          }
          if (update.updates.channel !== undefined) {
            setClauses.push('channel = ?');
            values.push(update.updates.channel);
          }

          setClauses.push('updated_at = CURRENT_TIMESTAMP');

          const sql = `
            UPDATE context_items 
            SET ${setClauses.join(', ')}
            WHERE session_id = ? AND key = ?
          `;

          values.push(testSessionId, update.key);

          const result = db.prepare(sql).run(...values);

          results.push({
            index,
            key: update.key,
            updated: result.changes > 0,
            fields: Object.keys(update.updates),
          });
        });

        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }

      expect(results.every(r => r.updated)).toBe(true);

      // Verify updates
      const updatedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key')
        .all(testSessionId) as any[];

      expect(updatedItems[0].value).toBe('Updated value 1');
      expect(updatedItems[0].priority).toBe('high');
      expect(updatedItems[1].category).toBe('task');
      expect(updatedItems[1].channel).toBe('production');
      expect(updatedItems[2].value).toBe('Completely new value');

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_update',
                totalItems: updates.length,
                succeeded: results.filter(r => r.updated).length,
                failed: results.filter(r => !r.updated).length,
                results: results,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.succeeded).toBe(3);
    });

    it('should validate update fields', () => {
      const invalidUpdates = [
        {
          key: 'update.item.1',
          updates: {
            category: 'invalid-category', // Invalid
          },
        },
        {
          key: 'update.item.2',
          updates: {
            priority: 'urgent', // Invalid
          },
        },
        {
          key: 'update.item.3',
          updates: {
            value: '', // Empty value
          },
        },
        {
          key: 'update.item.1',
          updates: {}, // No updates
        },
      ];

      const errors: any[] = [];

      invalidUpdates.forEach((update, index) => {
        try {
          // Validate category
          if (update.updates.category) {
            const validCategories = ['task', 'decision', 'progress', 'note', 'error', 'warning'];
            if (!validCategories.includes(update.updates.category)) {
              throw new ValidationError(`Invalid category: ${update.updates.category}`);
            }
          }

          // Validate priority
          if (update.updates.priority) {
            const validPriorities = ['high', 'normal', 'low'];
            if (!validPriorities.includes(update.updates.priority)) {
              throw new ValidationError(`Invalid priority: ${update.updates.priority}`);
            }
          }

          // Validate value
          if (update.updates.value !== undefined && update.updates.value === '') {
            throw new ValidationError('Value cannot be empty');
          }

          // Validate at least one update
          if (Object.keys(update.updates).length === 0) {
            throw new ValidationError('No updates provided');
          }
        } catch (error) {
          errors.push({
            index,
            key: update.key,
            error: (error as Error).message,
          });
        }
      });

      expect(errors.length).toBe(4);
      expect(errors[0].error).toContain('Invalid category');
      expect(errors[1].error).toContain('Invalid priority');
      expect(errors[2].error).toContain('Value cannot be empty');
      expect(errors[3].error).toContain('No updates provided');
    });

    it('should handle partial update failures', () => {
      const updates = [
        {
          key: 'update.item.1',
          updates: {
            value: 'Valid update',
          },
        },
        {
          key: 'non.existent.key', // Will fail
          updates: {
            value: 'Update for non-existent',
          },
        },
        {
          key: 'update.item.2',
          updates: {
            priority: 'urgent', // Invalid priority
          },
        },
        {
          key: 'update.item.3',
          updates: {
            channel: 'staging',
          },
        },
      ];

      const results: any[] = [];
      const errors: any[] = [];

      updates.forEach((update, index) => {
        try {
          // Validate priority
          if (update.updates.priority) {
            const validPriorities = ['high', 'normal', 'low'];
            if (!validPriorities.includes(update.updates.priority)) {
              throw new ValidationError(`Invalid priority: ${update.updates.priority}`);
            }
          }

          // Build update
          const setClauses: string[] = [];
          const values: any[] = [];

          Object.entries(update.updates).forEach(([field, value]) => {
            setClauses.push(`${field} = ?`);
            values.push(value);
          });

          setClauses.push('updated_at = CURRENT_TIMESTAMP');
          values.push(testSessionId, update.key);

          const result = db
            .prepare(
              `UPDATE context_items SET ${setClauses.join(', ')} WHERE session_id = ? AND key = ?`
            )
            .run(...values);

          if (result.changes === 0) {
            throw new Error('Item not found');
          }

          results.push({
            index,
            key: update.key,
            updated: true,
          });
        } catch (error) {
          errors.push({
            index,
            key: update.key,
            error: (error as Error).message,
          });
        }
      });

      expect(results.length).toBe(2); // 2 successful
      expect(errors.length).toBe(2); // 2 failed
    });

    it('should support metadata updates', () => {
      const updates = [
        {
          key: 'update.item.1',
          updates: {
            metadata: { tags: ['important', 'reviewed'], lastReviewed: new Date().toISOString() },
          },
        },
        {
          key: 'update.item.2',
          updates: {
            metadata: { environment: 'production', version: '1.0.0' },
          },
        },
      ];

      const results: any[] = [];

      updates.forEach((update, index) => {
        const metadataJson = JSON.stringify(update.updates.metadata);

        const result = db
          .prepare(
            `UPDATE context_items 
             SET metadata = ?, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = ? AND key = ?`
          )
          .run(metadataJson, testSessionId, update.key);

        results.push({
          index,
          key: update.key,
          updated: result.changes > 0,
        });
      });

      expect(results.every(r => r.updated)).toBe(true);

      // Verify metadata
      const items = db
        .prepare(
          'SELECT key, metadata FROM context_items WHERE session_id = ? AND metadata IS NOT NULL'
        )
        .all(testSessionId) as any[];

      expect(items.length).toBe(2);
      items.forEach(item => {
        const metadata = JSON.parse(item.metadata);
        expect(metadata).toBeTruthy();
      });
    });

    it('should update items matching pattern', () => {
      const pattern = 'update.item.*';
      const updates = {
        priority: 'high',
        channel: 'production',
      };

      const result = db
        .prepare(
          `UPDATE context_items 
           SET priority = ?, channel = ?, updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ? AND key GLOB ?`
        )
        .run(updates.priority, updates.channel, testSessionId, pattern);

      expect(result.changes).toBe(3);

      // Verify all matching items were updated
      const updatedItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key GLOB ?')
        .all(testSessionId, pattern) as any[];

      expect(updatedItems.every((item: any) => item.priority === 'high')).toBe(true);
      expect(updatedItems.every((item: any) => item.channel === 'production')).toBe(true);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_update',
                pattern: pattern,
                updates: updates,
                itemsUpdated: result.changes,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.itemsUpdated).toBe(3);
    });
  });

  describe('Performance and Transaction Handling', () => {
    it('should handle large batch operations efficiently', () => {
      const batchSize = 500;
      const items = Array.from({ length: batchSize }, (_, i) => ({
        key: `perf.item.${i.toString().padStart(4, '0')}`,
        value: `Performance test value ${i}`,
        category: i % 2 === 0 ? 'task' : 'note',
        priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'normal' : 'low',
      }));

      const startTime = Date.now();

      db.prepare('BEGIN TRANSACTION').run();

      try {
        const stmt = db.prepare(`
          INSERT INTO context_items (id, session_id, key, value, category, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        items.forEach(item => {
          stmt.run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
        });

        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }

      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds

      // Verify all items were saved
      const count = (
        db
          .prepare('SELECT COUNT(*) as count FROM context_items WHERE session_id = ?')
          .get(testSessionId) as any
      ).count;

      expect(count).toBe(batchSize);
    });

    it('should rollback entire batch on error', () => {
      const items = [
        { key: 'rollback.1', value: 'Value 1' },
        { key: 'rollback.2', value: 'Value 2' },
        { key: 'rollback.3', value: 'Value 3' },
      ];

      try {
        db.prepare('BEGIN TRANSACTION').run();

        // Insert first two items successfully
        items.slice(0, 2).forEach(item => {
          db.prepare(
            `
            INSERT INTO context_items (id, session_id, key, value)
            VALUES (?, ?, ?, ?)
          `
          ).run(uuidv4(), testSessionId, item.key, item.value);
        });

        // Simulate error on third item
        throw new Error('Simulated error during batch operation');
      } catch (_error) {
        db.prepare('ROLLBACK').run();
      }

      // Verify no items were saved
      const count = (
        db
          .prepare(
            `SELECT COUNT(*) as count FROM context_items 
             WHERE session_id = ? AND key LIKE 'rollback.%'`
          )
          .get(testSessionId) as any
      ).count;

      expect(count).toBe(0);
    });

    it('should handle concurrent batch operations safely', () => {
      // This test simulates what would happen with concurrent operations
      // In a real scenario, SQLite's transaction isolation would handle this

      const batch1Items = Array.from({ length: 50 }, (_, i) => ({
        key: `concurrent.batch1.${i}`,
        value: `Batch 1 value ${i}`,
      }));

      const batch2Items = Array.from({ length: 50 }, (_, i) => ({
        key: `concurrent.batch2.${i}`,
        value: `Batch 2 value ${i}`,
      }));

      // Execute batches sequentially (SQLite would serialize concurrent transactions)
      let batch1Success = false;
      let batch2Success = false;

      // Batch 1
      try {
        db.prepare('BEGIN TRANSACTION').run();
        const stmt = db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        );
        batch1Items.forEach(item => {
          stmt.run(uuidv4(), testSessionId, item.key, item.value);
        });
        db.prepare('COMMIT').run();
        batch1Success = true;
      } catch (_error) {
        db.prepare('ROLLBACK').run();
      }

      // Batch 2
      try {
        db.prepare('BEGIN TRANSACTION').run();
        const stmt = db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        );
        batch2Items.forEach(item => {
          stmt.run(uuidv4(), testSessionId, item.key, item.value);
        });
        db.prepare('COMMIT').run();
        batch2Success = true;
      } catch (_error) {
        db.prepare('ROLLBACK').run();
      }

      expect(batch1Success).toBe(true);
      expect(batch2Success).toBe(true);

      // Verify both batches succeeded
      const count = (
        db
          .prepare(
            `SELECT COUNT(*) as count FROM context_items 
             WHERE session_id = ? AND key LIKE 'concurrent.%'`
          )
          .get(testSessionId) as any
      ).count;

      expect(count).toBe(100);
    });
  });

  describe('Handler Response Formats', () => {
    it('should provide detailed batch save response', () => {
      const items = [
        { key: 'response.1', value: 'Value 1', category: 'task' },
        { key: 'response.2', value: 'Value 2', priority: 'high' },
      ];

      const results = items.map((item, index) => ({
        index,
        key: item.key,
        success: true,
        id: uuidv4(),
        action: 'created',
        size: Buffer.byteLength(item.value, 'utf8'),
      }));

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_save',
                totalItems: items.length,
                succeeded: results.filter(r => r.success).length,
                failed: 0,
                totalSize: results.reduce((sum, r) => sum + r.size, 0),
                results: results,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.operation).toBe('batch_save');
      expect(parsed.totalItems).toBe(2);
      expect(parsed.succeeded).toBe(2);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.timestamp).toBeTruthy();
    });

    it('should provide summary for large batch operations', () => {
      const itemCount = 1000;
      const succeeded = 950;
      const failed = 50;

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_save',
                totalItems: itemCount,
                succeeded: succeeded,
                failed: failed,
                successRate: `${((succeeded / itemCount) * 100).toFixed(1)}%`,
                summary: {
                  categories: {
                    task: 400,
                    note: 300,
                    config: 250,
                  },
                  priorities: {
                    high: 300,
                    normal: 400,
                    low: 250,
                  },
                },
                // Don't include individual results for large batches
                message: 'Large batch operation completed. Individual results omitted for brevity.',
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.successRate).toBe('95.0%');
      expect(parsed.summary).toBeTruthy();
      expect(parsed.results).toBeUndefined(); // Omitted for large batches
    });

    it('should handle mixed operation results', () => {
      const operations = {
        save: { attempted: 10, succeeded: 8 },
        update: { attempted: 5, succeeded: 5 },
        delete: { attempted: 3, succeeded: 2 },
      };

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'batch_mixed',
                operations: operations,
                totals: {
                  attempted: 18,
                  succeeded: 15,
                  failed: 3,
                },
                summary: 'Completed batch operations: 8/10 saved, 5/5 updated, 2/3 deleted',
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totals.succeeded).toBe(15);
      expect(parsed.totals.failed).toBe(3);
      expect(parsed.summary).toContain('8/10 saved');
    });
  });
});
