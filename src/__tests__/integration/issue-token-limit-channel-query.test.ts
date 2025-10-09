/**
 * Test for token limit issue with channel queries
 *
 * Reproduces the bug where context_get with limit: 50 still exceeds token limits
 * when querying a channel with large items.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database.js';
import { RepositoryManager } from '../../repositories/RepositoryManager.js';
import { checkTokenLimit, getTokenConfig } from '../../utils/token-limits.js';

describe('Token Limit with Channel Query Bug', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  let sessionId: string;

  beforeEach(() => {
    dbManager = new DatabaseManager({ filename: ':memory:' });
    repositories = new RepositoryManager(dbManager);
    const session = repositories.sessions.create({
      name: 'Test Session',
      defaultChannel: 'test-channel',
    });
    sessionId = session.id;
  });

  afterEach(() => {
    dbManager.close();
  });

  it('should enforce token limits even when limit parameter is provided', () => {
    // Create 50 large context items (each ~1000 chars)
    const largeValue = 'x'.repeat(1000);
    for (let i = 0; i < 50; i++) {
      repositories.contexts.save(sessionId, {
        key: `large-item-${i}`,
        value: largeValue,
        channel: 'outbound-call-center',
        priority: 'normal',
      });
    }

    // Query with limit: 50
    const result = repositories.contexts.queryEnhanced({
      sessionId,
      channel: 'outbound-call-center',
      limit: 50,
      sort: 'updated_desc',
      includeMetadata: false,
    });

    expect(result.items.length).toBe(50);

    // Check if response would exceed token limit
    const tokenConfig = getTokenConfig();
    const { exceedsLimit, safeItemCount } = checkTokenLimit(result.items, false, tokenConfig);

    // Build the actual response structure
    const response = {
      items: result.items,
      pagination: {
        total: result.totalCount,
        returned: result.items.length,
        offset: 0,
        hasMore: false,
        nextOffset: null,
        truncated: false,
        truncatedCount: 0,
      },
    };

    const responseJson = JSON.stringify(response, null, 2);
    const actualTokens = Math.ceil(responseJson.length / tokenConfig.charsPerToken);

    // The bug: even with limit: 50, the response can exceed token limits
    if (actualTokens > tokenConfig.mcpMaxTokens) {
      // BUG REPRODUCED: The response exceeds token limits
      // Verify that checkTokenLimit correctly detected the issue
      expect(exceedsLimit).toBe(true);
      expect(safeItemCount).toBeLessThan(50);
      expect(actualTokens).toBeGreaterThan(tokenConfig.mcpMaxTokens);
    }
  });

  it('should respect token limits over user-provided limit parameter', () => {
    // Create 100 large context items (each ~800 chars)
    const largeValue = 'y'.repeat(800);
    for (let i = 0; i < 100; i++) {
      repositories.contexts.save(sessionId, {
        key: `item-${i}`,
        value: largeValue,
        channel: 'test-channel',
        priority: 'normal',
      });
    }

    // Query with limit: 50 (user expectation)
    const result = repositories.contexts.queryEnhanced({
      sessionId,
      channel: 'test-channel',
      limit: 50,
      sort: 'created_desc',
      includeMetadata: false,
    });

    // Simulate the context_get handler logic
    const tokenConfig = getTokenConfig();
    const { exceedsLimit, safeItemCount } = checkTokenLimit(result.items, false, tokenConfig);

    let actualItems = result.items;
    let wasTruncated = false;

    if (exceedsLimit && safeItemCount < result.items.length) {
      actualItems = result.items.slice(0, safeItemCount);
      wasTruncated = true;
    }

    // Build response
    const response = {
      items: actualItems,
      pagination: {
        total: result.totalCount,
        returned: actualItems.length,
        offset: 0,
        hasMore: wasTruncated || actualItems.length < result.totalCount,
        nextOffset: wasTruncated ? actualItems.length : null,
        truncated: wasTruncated,
        truncatedCount: wasTruncated ? result.items.length - actualItems.length : 0,
      },
    };

    const responseJson = JSON.stringify(response, null, 2);
    const actualTokens = Math.ceil(responseJson.length / tokenConfig.charsPerToken);

    // Verify token limit is not exceeded
    expect(actualTokens).toBeLessThanOrEqual(tokenConfig.mcpMaxTokens);

    // Verify truncation occurred if needed
    if (exceedsLimit) {
      expect(wasTruncated).toBe(true);
      expect(actualItems.length).toBeLessThan(50);
      expect(actualItems.length).toBe(safeItemCount);
    }
  });
});
