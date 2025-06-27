import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
// Removed unused imports: Server, CallToolRequestSchema
import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('Batch Operations E2E Tests', () => {
  let tempDbPath: string;
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  let testSessionId: string;

  // Mock the server handler
  const mockHandleToolCall = async (toolName: string, args: any) => {
    // This simulates what happens in index.ts
    switch (toolName) {
      case 'context_batch_save': {
        const { items, updateExisting = true } = args;
        const sessionId = testSessionId;

        // Validate items
        if (!items || !Array.isArray(items) || items.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No items provided for batch save',
              },
            ],
          };
        }

        // Validate each item
        const validationErrors: any[] = [];
        items.forEach((item: any, index: number) => {
          try {
            if (!item.key || !item.key.trim()) {
              throw new Error('Key is required and cannot be empty');
            }
            if (!item.value) {
              throw new Error('Value is required');
            }
            if (item.category) {
              const validCategories = ['task', 'decision', 'progress', 'note', 'error', 'warning'];
              if (!validCategories.includes(item.category)) {
                throw new Error(`Invalid category: ${item.category}`);
              }
            }
            if (item.priority) {
              const validPriorities = ['high', 'normal', 'low'];
              if (!validPriorities.includes(item.priority)) {
                throw new Error(`Invalid priority: ${item.priority}`);
              }
            }
          } catch (error: any) {
            validationErrors.push({
              index,
              key: item.key || 'undefined',
              error: error.message,
            });
          }
        });

        // Filter out items with validation errors before passing to repository
        const validItemIndices: number[] = [];
        const validItems = items.filter((_, index) => {
          const hasError = validationErrors.some(err => err.index === index);
          if (!hasError) {
            validItemIndices.push(index);
            return true;
          }
          return false;
        });

        if (validationErrors.length === items.length) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    operation: 'batch_save',
                    totalItems: items.length,
                    succeeded: 0,
                    failed: validationErrors.length,
                    totalSize: 0,
                    results: [],
                    errors: validationErrors,
                    timestamp: new Date().toISOString(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        let results: any[] = [];
        let totalSize = 0;

        dbManager.getDatabase().prepare('BEGIN TRANSACTION').run();
        try {
          // Track original indices
          const indexMap = new Map<number, number>();
          validItems.forEach((item, newIdx) => {
            indexMap.set(newIdx, items.indexOf(item));
          });

          const batchResult = repositories.contexts.batchSave(sessionId, validItems, {
            updateExisting,
          });
          totalSize = batchResult.totalSize;

          // Map results back to original indices
          results = batchResult.results
            .filter(r => r.success)
            .map(r => ({
              ...r,
              index: indexMap.get(r.index) ?? r.index,
            }));

          const errors = [
            ...validationErrors,
            ...batchResult.results
              .filter(r => !r.success)
              .map(r => ({
                index: indexMap.get(r.index) ?? r.index,
                key: r.key,
                error: r.error,
              })),
          ];

          dbManager.getDatabase().prepare('COMMIT').run();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    operation: 'batch_save',
                    totalItems: items.length,
                    succeeded: results.length,
                    failed: errors.length,
                    totalSize: totalSize,
                    averageSize: results.length > 0 ? Math.round(totalSize / results.length) : 0,
                    results: results,
                    errors: errors,
                    timestamp: new Date().toISOString(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          dbManager.getDatabase().prepare('ROLLBACK').run();
          return {
            content: [
              {
                type: 'text',
                text: `Batch save failed: ${(error as Error).message}`,
              },
            ],
          };
        }
      }

      case 'context_batch_delete': {
        const { keys, keyPattern, dryRun = false } = args;
        const sessionId = testSessionId;

        if (dryRun) {
          const itemsToDelete = repositories.contexts.getDryRunItems(sessionId, {
            keys,
            keyPattern,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    operation: 'batch_delete',
                    dryRun: true,
                    keys: keys,
                    pattern: keyPattern,
                    itemsToDelete: itemsToDelete,
                    totalItems: itemsToDelete.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        dbManager.getDatabase().prepare('BEGIN TRANSACTION').run();
        try {
          const deleteResult = repositories.contexts.batchDelete(sessionId, { keys, keyPattern });
          dbManager.getDatabase().prepare('COMMIT').run();

          const response = keys
            ? {
                operation: 'batch_delete',
                keys: keys,
                totalRequested: keys.length,
                totalDeleted: deleteResult.totalDeleted,
                notFound: deleteResult.results?.filter(r => !r.deleted).map(r => r.key) || [],
                results: deleteResult.results,
              }
            : {
                operation: 'batch_delete',
                pattern: keyPattern,
                totalDeleted: deleteResult.totalDeleted,
              };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response, null, 2),
              },
            ],
          };
        } catch (error) {
          dbManager.getDatabase().prepare('ROLLBACK').run();
          return {
            content: [
              {
                type: 'text',
                text: `Batch delete failed: ${(error as Error).message}`,
              },
            ],
          };
        }
      }

      case 'context_batch_update': {
        const { updates } = args;
        const sessionId = testSessionId;

        dbManager.getDatabase().prepare('BEGIN TRANSACTION').run();
        try {
          const updateResult = repositories.contexts.batchUpdate(sessionId, updates);
          dbManager.getDatabase().prepare('COMMIT').run();

          const results = updateResult.results.filter(r => r.updated);
          const errors = updateResult.results.filter(r => !r.updated);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    operation: 'batch_update',
                    totalItems: updates.length,
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
        } catch (error) {
          dbManager.getDatabase().prepare('ROLLBACK').run();
          return {
            content: [
              {
                type: 'text',
                text: `Batch update failed: ${(error as Error).message}`,
              },
            ],
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  };

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-batch-e2e-${Date.now()}.db`);
    dbManager = new DatabaseManager({ filename: tempDbPath });
    repositories = new RepositoryManager(dbManager);

    // Create test session
    const session = repositories.sessions.create({
      name: 'E2E Test Session',
      description: 'Testing batch operations E2E',
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

  describe('End-to-End Batch Operations', () => {
    it('should handle complete batch workflow', async () => {
      // 1. Batch Save
      const saveResponse = await mockHandleToolCall('context_batch_save', {
        items: [
          { key: 'user.name', value: 'John Doe', category: 'note', priority: 'normal' },
          { key: 'user.email', value: 'john@example.com', category: 'note', priority: 'high' },
          { key: 'app.version', value: '1.0.0', category: 'note', priority: 'low' },
        ],
      });

      const saveResult = JSON.parse(saveResponse.content[0].text);
      expect(saveResult.operation).toBe('batch_save');
      expect(saveResult.succeeded).toBe(3);
      expect(saveResult.failed).toBe(0);
      expect(saveResult.totalSize).toBeGreaterThan(0);

      // 2. Batch Update
      const updateResponse = await mockHandleToolCall('context_batch_update', {
        updates: [
          { key: 'user.name', value: 'Jane Doe' },
          { key: 'app.version', value: '2.0.0', priority: 'high' },
        ],
      });

      const updateResult = JSON.parse(updateResponse.content[0].text);
      expect(updateResult.operation).toBe('batch_update');
      expect(updateResult.succeeded).toBe(2);
      expect(updateResult.failed).toBe(0);

      // 3. Batch Delete (Dry Run)
      const dryRunResponse = await mockHandleToolCall('context_batch_delete', {
        keys: ['user.email', 'app.version'],
        dryRun: true,
      });

      const dryRunResult = JSON.parse(dryRunResponse.content[0].text);
      expect(dryRunResult.dryRun).toBe(true);
      expect(dryRunResult.totalItems).toBe(2);

      // 4. Batch Delete (Actual)
      const deleteResponse = await mockHandleToolCall('context_batch_delete', {
        keys: ['user.email', 'app.version'],
      });

      const deleteResult = JSON.parse(deleteResponse.content[0].text);
      expect(deleteResult.operation).toBe('batch_delete');
      expect(deleteResult.totalDeleted).toBe(2);

      // Verify final state
      const remaining = repositories.contexts.getBySessionId(testSessionId);
      expect(remaining.length).toBe(1);
      expect(remaining[0].key).toBe('user.name');
      expect(remaining[0].value).toBe('Jane Doe');
    });

    it('should handle validation errors gracefully', async () => {
      const response = await mockHandleToolCall('context_batch_save', {
        items: [
          { key: '', value: 'No key' },
          { key: 'no.value' },
          { key: 'valid.item', value: 'Valid' },
        ],
      });

      const result = JSON.parse(response.content[0].text);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    it('should handle pattern-based operations', async () => {
      // Setup test data
      await mockHandleToolCall('context_batch_save', {
        items: [
          { key: 'temp.file1', value: 'File 1' },
          { key: 'temp.file2', value: 'File 2' },
          { key: 'temp.cache', value: 'Cache' },
          { key: 'keep.this', value: 'Keep' },
        ],
      });

      // Delete by pattern
      const response = await mockHandleToolCall('context_batch_delete', {
        keyPattern: 'temp.*',
      });

      const result = JSON.parse(response.content[0].text);
      expect(result.totalDeleted).toBe(3);

      // Verify only non-matching item remains
      const remaining = repositories.contexts.getBySessionId(testSessionId);
      expect(remaining.length).toBe(1);
      expect(remaining[0].key).toBe('keep.this');
    });
  });
});
