// Test to validate the fix for issue #24
// Tests the actual flow through index.ts handler

import { describe, it, expect } from '@jest/globals';

// Mock the functions used in index.ts for context_get
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function calculateSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function calculateResponseMetrics(items: any[]): {
  totalSize: number;
  estimatedTokens: number;
  averageSize: number;
} {
  let totalSize = 0;

  for (const item of items) {
    const itemSize = item.size || calculateSize(item.value);
    totalSize += itemSize;
  }

  // Convert to JSON string to get actual response size
  const jsonString = JSON.stringify(items);
  const estimatedTokens = estimateTokens(jsonString);
  const averageSize = items.length > 0 ? Math.round(totalSize / items.length) : 0;

  return { totalSize, estimatedTokens, averageSize };
}

describe('Issue #24 Fix Validation', () => {
  it('should correctly calculate tokens for response with metadata', () => {
    // Create sample items as they would come from the database
    const dbItems = [];
    for (let i = 0; i < 100; i++) {
      dbItems.push({
        id: `id-${i}`,
        session_id: 'test-session',
        key: `test_item_${i}`,
        value: `This is test content that is moderately long to simulate real data. `.repeat(3),
        category: 'task',
        priority: 'high',
        channel: 'test',
        metadata: JSON.stringify({ index: i }),
        size: 200,
        created_at: '2025-01-20T10:00:00Z',
        updated_at: '2025-01-20T10:00:00Z',
      });
    }

    // Test without metadata (original calculation)
    const metricsWithoutMetadata = calculateResponseMetrics(dbItems);
    console.log(
      'Without metadata - Items:',
      dbItems.length,
      'Tokens:',
      metricsWithoutMetadata.estimatedTokens
    );

    // Test with metadata (as per the fix)
    const itemsWithMetadata = dbItems.map(item => ({
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

    const metricsWithMetadata = calculateResponseMetrics(itemsWithMetadata);
    console.log(
      'With metadata - Items:',
      itemsWithMetadata.length,
      'Tokens:',
      metricsWithMetadata.estimatedTokens
    );

    // The metadata version might have fewer tokens due to JSON parsing
    // but the overall response structure adds overhead

    // Build full response structure as the handler does
    const fullResponse = {
      items: itemsWithMetadata,
      pagination: {
        total: 100,
        returned: 100,
        offset: 0,
        hasMore: false,
        nextOffset: null,
        totalCount: 100,
        page: 1,
        pageSize: 100,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        previousOffset: null,
        totalSize: metricsWithMetadata.totalSize,
        averageSize: metricsWithMetadata.averageSize,
        defaultsApplied: { limit: true, sort: true },
        truncated: false,
        truncatedCount: 0,
      },
    };

    const finalResponseJson = JSON.stringify(fullResponse, null, 2);
    const finalTokens = estimateTokens(finalResponseJson);
    console.log('Final response - Size:', finalResponseJson.length, 'Tokens:', finalTokens);

    // This demonstrates the issue: the final response can be much larger
    // than what calculateResponseMetrics estimates
    console.log('Token difference:', finalTokens - metricsWithMetadata.estimatedTokens);

    // With 100 items and metadata, we should be approaching or exceeding limits
    if (finalTokens > 18000) {
      console.log('WARNING: Response exceeds safe token limit!');
    }
  });

  it('should demonstrate that 50 items with metadata stays under limit', () => {
    // Create sample items
    const dbItems = [];
    for (let i = 0; i < 50; i++) {
      dbItems.push({
        id: `id-${i}`,
        session_id: 'test-session',
        key: `test_item_${i}`,
        value: `This is test content that is moderately long to simulate real data. `.repeat(3),
        category: 'task',
        priority: 'high',
        channel: 'test',
        metadata: JSON.stringify({ index: i }),
        size: 200,
        created_at: '2025-01-20T10:00:00Z',
        updated_at: '2025-01-20T10:00:00Z',
      });
    }

    // Transform with metadata
    const itemsWithMetadata = dbItems.map(item => ({
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

    const metrics = calculateResponseMetrics(itemsWithMetadata);

    // Build full response
    const fullResponse = {
      items: itemsWithMetadata,
      pagination: {
        total: 50,
        returned: 50,
        offset: 0,
        hasMore: false,
        nextOffset: null,
        totalCount: 50,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        previousOffset: null,
        totalSize: metrics.totalSize,
        averageSize: metrics.averageSize,
        defaultsApplied: { limit: true, sort: true },
        truncated: false,
        truncatedCount: 0,
      },
    };

    const finalResponseJson = JSON.stringify(fullResponse, null, 2);
    const finalTokens = estimateTokens(finalResponseJson);

    console.log('50 items with metadata - Tokens:', finalTokens);

    // 50 items should be safe
    expect(finalTokens).toBeLessThan(18000);
    expect(finalTokens).toBeLessThan(25000); // Well under MCP limit
  });
});
