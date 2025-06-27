import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('Backward Compatibility Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let repositories: RepositoryManager;
  let testSessionId: string;
  let _server: Server;

  // Mock handler function to test actual handler logic
  async function callContextGet(args: any): Promise<any> {
    // This simulates the actual handler logic from index.ts
    const {
      key,
      category,
      channel,
      channels,
      sessionId: specificSessionId,
      includeMetadata,
      sort,
      limit,
      offset,
      createdAfter,
      createdBefore,
      keyPattern,
      priorities,
    } = args;
    const targetSessionId = specificSessionId || testSessionId;

    // Use enhanced query for complex queries or when we need pagination
    if (
      sort !== undefined ||
      limit !== undefined ||
      offset ||
      createdAfter ||
      createdBefore ||
      keyPattern ||
      priorities ||
      channel ||
      channels ||
      includeMetadata ||
      (!key && !category) // If listing all items without filters, use pagination
    ) {
      const result = repositories.contexts.queryEnhanced({
        sessionId: targetSessionId,
        key,
        category,
        channel,
        channels,
        sort,
        limit,
        offset,
        createdAfter,
        createdBefore,
        keyPattern,
        priorities,
        includeMetadata,
      });

      if (result.items.length === 0) {
        return { content: [{ type: 'text', text: 'No matching context found' }] };
      }

      // Return enhanced format
      const response: any = {
        items: result.items,
        pagination: {
          total: result.totalCount,
          returned: result.items.length,
          offset: offset || 0,
          hasMore: false, // Simplified for test
          nextOffset: null,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };
    }

    // Backward compatible simple queries
    let rows;
    if (key) {
      const item = repositories.contexts.getAccessibleByKey(targetSessionId, key);
      rows = item ? [item] : [];
    } else {
      rows = repositories.contexts.getAccessibleItems(targetSessionId, { category });
    }

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No matching context found' }] };
    }

    if (key && rows.length === 1) {
      // Single item requested - return just the value
      const item = rows[0] as any;
      return { content: [{ type: 'text', text: item.value }] };
    }

    // Multiple items - return formatted list
    const items = rows
      .map(
        (r: any) =>
          `• [${r.priority}] ${r.key}: ${r.value.substring(0, 100)}${r.value.length > 100 ? '...' : ''}`
      )
      .join('\n');

    return {
      content: [{ type: 'text', text: `Found ${rows.length} context items:\n\n${items}` }],
    };
  }

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-backward-compat-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    repositories = new RepositoryManager(dbManager);

    // Create test session
    const session = repositories.sessions.create({ name: 'Test Session' });
    testSessionId = session.id;

    // Create test data
    repositories.contexts.save(testSessionId, {
      key: 'single.item',
      value: 'This is a single item value',
      category: 'test',
      priority: 'normal',
    });

    repositories.contexts.save(testSessionId, {
      key: 'category.item1',
      value: 'Category test item 1',
      category: 'testcat',
      priority: 'high',
    });

    repositories.contexts.save(testSessionId, {
      key: 'category.item2',
      value: 'Category test item 2',
      category: 'testcat',
      priority: 'normal',
    });

    // Create many items to test pagination
    for (let i = 0; i < 150; i++) {
      repositories.contexts.save(testSessionId, {
        key: `bulk.item.${i.toString().padStart(3, '0')}`,
        value: `Bulk item value ${i}`,
        category: 'bulk',
        priority: i % 2 === 0 ? 'high' : 'normal',
      });
    }
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

  describe('Single Item Retrieval (Backward Compatible)', () => {
    it('should return just the value for single item by key', async () => {
      const result = await callContextGet({ key: 'single.item' });

      expect(result.content[0].text).toBe('This is a single item value');
      // Should NOT include pagination or JSON structure
      expect(result.content[0].text).not.toContain('pagination');
      expect(result.content[0].text).not.toContain('{');
    });

    it('should return "No matching context found" for non-existent key', async () => {
      const result = await callContextGet({ key: 'non.existent' });

      expect(result.content[0].text).toBe('No matching context found');
    });
  });

  describe('Category Filtering (Backward Compatible)', () => {
    it('should return formatted list for category filter only', async () => {
      const result = await callContextGet({ category: 'testcat' });

      expect(result.content[0].text).toContain('Found 2 context items:');
      expect(result.content[0].text).toContain('• [high] category.item1:');
      expect(result.content[0].text).toContain('• [normal] category.item2:');
      // Should NOT include pagination
      expect(result.content[0].text).not.toContain('pagination');
    });
  });

  describe('Enhanced Queries (New Format)', () => {
    it('should return paginated format when listing all items', async () => {
      const result = await callContextGet({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveProperty('items');
      expect(parsed).toHaveProperty('pagination');
      expect(parsed.pagination.total).toBe(153); // All test items
      expect(parsed.pagination.returned).toBe(100); // Default limit
    });

    it('should return paginated format when using limit', async () => {
      const result = await callContextGet({ category: 'bulk', limit: 10 });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveProperty('items');
      expect(parsed).toHaveProperty('pagination');
      expect(parsed.items).toHaveLength(10);
      expect(parsed.pagination.returned).toBe(10);
    });

    it('should return paginated format when using sort', async () => {
      const result = await callContextGet({ category: 'bulk', sort: 'key_asc' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveProperty('items');
      expect(parsed).toHaveProperty('pagination');
      expect(parsed.items[0].key).toBe('bulk.item.000');
    });

    it('should return paginated format when using includeMetadata', async () => {
      const result = await callContextGet({ key: 'single.item', includeMetadata: true });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveProperty('items');
      expect(parsed).toHaveProperty('pagination');
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]).toHaveProperty('size');
      expect(parsed.items[0]).toHaveProperty('created_at');
    });
  });

  describe('Mixed Scenarios', () => {
    it('should use simple format for key+category filter', async () => {
      // Even with both key and category, if key is specified, use simple format
      const result = await callContextGet({ key: 'single.item', category: 'test' });

      expect(result.content[0].text).toBe('This is a single item value');
      expect(result.content[0].text).not.toContain('pagination');
    });

    it('should use enhanced format when channel is specified', async () => {
      const result = await callContextGet({ category: 'test', channel: 'general' });
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toHaveProperty('pagination');
    });
  });
});
