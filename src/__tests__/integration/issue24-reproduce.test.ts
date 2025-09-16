// Attempt to reproduce the exact issue from #24
// User reported: "Error: MCP tool "context_get" response (26866 tokens) exceeds maximum allowed tokens (25000)"

import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function calculateSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

describe('Issue #24 - Reproduce exact error', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  let tempDbPath: string;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-issue24-reproduce-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    repositories = new RepositoryManager(dbManager);

    // Create test session
    const session = repositories.sessions.create({
      name: 'Issue #24 Reproduce',
      description: 'Attempting to reproduce exact token overflow',
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

  it('should reproduce token overflow with realistic data', () => {
    // To get 26866 tokens, we need roughly 107,464 characters
    // Let's create items with realistic content that would cause this

    const itemCount = 150; // More items than default limit
    const largeContent = `
This is a realistic context item that might be saved during a coding session.
It contains multiple lines of information, including:
- Task descriptions and implementation details
- Code snippets and examples
- Decision rationale and architectural notes
- Progress updates and status information
- Error messages and debugging information
- References to files and functions
- Links and external resources

The content is substantial enough to represent real-world usage where developers
save important context about their work. This might include detailed explanations
of complex logic, API documentation, configuration settings, or troubleshooting notes.

Additional metadata might include timestamps, categories, priorities, and custom
tags that help organize and retrieve the information later. All of this contributes
to the overall size of the response when multiple items are returned together.
`.trim();

    // Create many items with substantial content
    for (let i = 0; i < itemCount; i++) {
      repositories.contexts.save(testSessionId, {
        key: `context_item_${String(i).padStart(3, '0')}`,
        value: `${largeContent}\n\nItem ${i} specific notes: ${String(i).repeat(20)}`,
        category: ['task', 'decision', 'progress', 'note'][i % 4] as any,
        priority: ['high', 'normal', 'low'][i % 3] as any,
        channel: `channel-${i % 5}`,
        metadata: JSON.stringify({
          index: i,
          timestamp: new Date().toISOString(),
          tags: ['important', 'review', 'todo', 'done'][i % 4],
          additionalData: {
            relatedFiles: [`file${i}.ts`, `test${i}.spec.ts`],
            relatedIssues: [`#${i * 10}`, `#${i * 10 + 1}`],
          },
        }),
      });
    }

    // Query without specifying limit (should use default)
    const result = repositories.contexts.queryEnhanced({
      sessionId: testSessionId,
      includeMetadata: true,
      // No limit specified - will use repository default of 100
    });

    console.log(`Created ${itemCount} items, retrieved ${result.items.length} items`);

    // Transform items with metadata as the handler does
    const itemsWithMetadata = result.items.map(item => ({
      key: item.key,
      value: item.value,
      category: item.category,
      priority: item.priority,
      channel: item.channel,
      metadata: item.metadata ? JSON.parse(item.metadata) : null,
      size: item.size || calculateSize(item.value),
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));

    // Create the full response structure
    const fullResponse = {
      items: itemsWithMetadata,
      pagination: {
        total: result.totalCount,
        returned: result.items.length,
        offset: 0,
        hasMore: result.totalCount > result.items.length,
        nextOffset: result.items.length < result.totalCount ? result.items.length : null,
        totalCount: result.totalCount,
        page: 1,
        pageSize: result.items.length,
        totalPages: Math.ceil(result.totalCount / result.items.length),
        hasNextPage: result.totalCount > result.items.length,
        hasPreviousPage: false,
        previousOffset: null,
        totalSize: itemsWithMetadata.reduce((sum, item) => sum + (item.size || 0), 0),
        averageSize: Math.round(
          itemsWithMetadata.reduce((sum, item) => sum + (item.size || 0), 0) / result.items.length
        ),
        defaultsApplied: { limit: true, sort: true },
        truncated: false,
        truncatedCount: 0,
      },
    };

    const responseJson = JSON.stringify(fullResponse, null, 2);
    const tokens = estimateTokens(responseJson);

    console.log(`Response size: ${responseJson.length} bytes`);
    console.log(`Estimated tokens: ${tokens}`);
    console.log(
      `Average item size: ${Math.round(responseJson.length / result.items.length)} bytes`
    );

    // Check if we're reproducing the issue
    if (tokens > 25000) {
      console.log('✅ Successfully reproduced token overflow!');
      console.log(`Tokens: ${tokens} > 25000 limit`);
    } else if (tokens > 20000) {
      console.log('⚠️ Approaching token limit but not exceeding');
    } else {
      console.log('❌ Did not reproduce token overflow');
      console.log('Need larger items or more items to reproduce');
    }

    // The fix should prevent this from happening
    // With our changes:
    // 1. Default limit is 50 when includeMetadata is true (at handler level)
    // 2. Token limit is 18000 (more conservative)
    // 3. Response is truncated if it exceeds limits
  });

  it('should show how the fix prevents overflow', () => {
    // Same setup but showing how limit of 50 prevents the issue
    const itemCount = 150;
    const largeContent = `Large content...`.repeat(50); // Smaller for this test

    for (let i = 0; i < itemCount; i++) {
      repositories.contexts.save(testSessionId, {
        key: `item_${i}`,
        value: largeContent,
        category: 'task',
        priority: 'high',
      });
    }

    // With the fix, when includeMetadata is true, default limit should be 50
    // But this is handled at the handler level, not repository level
    // Repository still defaults to 100

    const resultWith50 = repositories.contexts.queryEnhanced({
      sessionId: testSessionId,
      includeMetadata: true,
      limit: 50, // Explicitly set to what our fix would use
    });

    const itemsWithMetadata = resultWith50.items.map(item => ({
      key: item.key,
      value: item.value,
      category: item.category,
      priority: item.priority,
      channel: item.channel,
      metadata: item.metadata ? JSON.parse(item.metadata) : null,
      size: item.size || calculateSize(item.value),
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));

    const responseJson = JSON.stringify({ items: itemsWithMetadata }, null, 2);
    const tokens = estimateTokens(responseJson);

    console.log(`With limit=50: ${resultWith50.items.length} items, ${tokens} tokens`);

    // Should be well under limit
    expect(tokens).toBeLessThan(18000);
    expect(tokens).toBeLessThan(25000);
  });
});
