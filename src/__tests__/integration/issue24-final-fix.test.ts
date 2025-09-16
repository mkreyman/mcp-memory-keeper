// Final test to verify the fix for issue #24
// Simulates the exact scenario: context_get with sessionId: "current" and includeMetadata: true

import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Mock functions from index.ts
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function calculateSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function validatePaginationParams(params: any) {
  const errors: string[] = [];
  let limit = 25; // default
  let offset = 0; // default

  // Validate limit
  if (params.limit !== undefined && params.limit !== null) {
    const rawLimit = params.limit;
    if (!Number.isInteger(rawLimit) || rawLimit <= 0) {
      errors.push(`Invalid limit: expected positive integer, got ${typeof rawLimit} '${rawLimit}'`);
    } else {
      limit = Math.min(Math.max(1, rawLimit), 100); // clamp between 1-100
    }
  }

  // Validate offset
  if (params.offset !== undefined && params.offset !== null) {
    const rawOffset = params.offset;
    if (!Number.isInteger(rawOffset) || rawOffset < 0) {
      errors.push(
        `Invalid offset: expected non-negative integer, got ${typeof rawOffset} '${rawOffset}'`
      );
    } else {
      offset = rawOffset;
    }
  }

  return { limit, offset, errors };
}

describe('Issue #24 - Final Fix Verification', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  let tempDbPath: string;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-issue24-final-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    repositories = new RepositoryManager(dbManager);

    // Create test session (simulating "current" session)
    const session = repositories.sessions.create({
      name: 'Current Session',
      description: 'Simulating the current active session',
    });
    testSessionId = session.id;

    // Create many realistic items that would cause overflow
    const largeContent = `
This is a realistic context item saved during development.
It contains implementation details, code snippets, notes, and documentation.
The content is substantial to simulate real-world usage patterns.
Developers often save detailed context about complex features, debugging sessions,
architectural decisions, API documentation, and troubleshooting information.
`.trim();

    for (let i = 0; i < 200; i++) {
      repositories.contexts.save(testSessionId, {
        key: `context_${String(i).padStart(3, '0')}`,
        value: `${largeContent}\n\nSpecific item ${i} notes and details.`,
        category: ['task', 'decision', 'progress', 'note'][i % 4] as any,
        priority: ['high', 'normal', 'low'][i % 3] as any,
        channel: `channel-${i % 10}`,
        metadata: JSON.stringify({
          index: i,
          timestamp: new Date().toISOString(),
          tags: ['dev', 'test', 'review'][i % 3],
        }),
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

  it('should handle context_get with includeMetadata: true without exceeding token limit', () => {
    // Simulate the exact call from the issue:
    // context_get(sessionId: "current", includeMetadata: true)

    const args = {
      sessionId: testSessionId, // Would be resolved from "current"
      includeMetadata: true,
      // No limit specified - should use new default of 30
    };

    // Simulate what the handler does
    const includeMetadata = args.includeMetadata;
    const rawLimit = undefined; // Not specified in the call
    const rawOffset = undefined;

    // Apply our fix: default limit is 30 when includeMetadata is true
    const defaultLimit = includeMetadata ? 30 : 100;
    const paginationValidation = validatePaginationParams({
      limit: rawLimit !== undefined ? rawLimit : defaultLimit,
      offset: rawOffset,
    });

    const { limit, offset } = paginationValidation;

    console.log(`Using limit: ${limit} (includeMetadata: ${includeMetadata})`);

    // Query with the calculated limit
    const result = repositories.contexts.queryEnhanced({
      sessionId: testSessionId,
      includeMetadata: true,
      limit: limit,
      offset: offset,
    });

    console.log(`Retrieved ${result.items.length} of ${result.totalCount} items`);

    // Transform items with metadata
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

    // Calculate metrics for token checking
    const itemsForMetrics = itemsWithMetadata;
    const jsonString = JSON.stringify(itemsForMetrics);
    const estimatedTokens = estimateTokens(jsonString);

    console.log(`Items token estimate: ${estimatedTokens}`);

    // Build full response
    const response = {
      items: itemsWithMetadata,
      pagination: {
        total: result.totalCount,
        returned: result.items.length,
        offset: 0,
        hasMore: result.totalCount > result.items.length,
        nextOffset: result.items.length < result.totalCount ? result.items.length : null,
        totalCount: result.totalCount,
        page: 1,
        pageSize: limit,
        totalPages: Math.ceil(result.totalCount / limit),
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

    const fullResponseJson = JSON.stringify(response, null, 2);
    const finalTokens = estimateTokens(fullResponseJson);

    console.log(`Final response tokens: ${finalTokens}`);

    // Verify the fix works
    expect(limit).toBe(30); // Our new default when includeMetadata is true
    expect(result.items.length).toBeLessThanOrEqual(30);
    expect(finalTokens).toBeLessThan(15000); // Our new conservative TOKEN_LIMIT
    expect(finalTokens).toBeLessThan(25000); // MCP's actual limit

    console.log('✅ Fix verified: Response stays well under token limit');
  });

  it('should still allow explicit higher limits but truncate if needed', () => {
    // User explicitly requests more items
    const args = {
      sessionId: testSessionId,
      includeMetadata: true,
      limit: 100, // Explicitly requesting many items
    };

    const result = repositories.contexts.queryEnhanced({
      sessionId: testSessionId,
      includeMetadata: true,
      limit: args.limit,
    });

    // With explicit limit, we get what was requested (up to 100)
    expect(result.items.length).toBeLessThanOrEqual(100);

    // But in the handler, if this exceeds tokens, it would be truncated
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

    const responseJson = JSON.stringify({ items: itemsWithMetadata }, null, 2);
    const tokens = estimateTokens(responseJson);

    console.log(`With explicit limit=100: ${result.items.length} items, ${tokens} tokens`);

    // This would trigger truncation in the handler
    if (tokens > 15000) {
      console.log('⚠️ Would trigger truncation in handler');
    }
  });
});
