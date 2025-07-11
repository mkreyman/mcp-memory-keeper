import { describe, it, expect } from '@jest/globals';

// Helper functions from the main index.ts file
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function calculateSafeItemCount(items: any[], tokenLimit: number): number {
  if (items.length === 0) return 0;

  let safeCount = 0;
  let currentTokens = 0;

  // Include base response structure in token calculation
  const baseResponse = {
    items: [],
    pagination: {
      total: 0,
      returned: 0,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      totalCount: 0,
      page: 1,
      pageSize: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      previousOffset: null,
      totalSize: 0,
      averageSize: 0,
      defaultsApplied: {},
      truncated: false,
      truncatedCount: 0,
    },
  };

  // Estimate tokens for base response structure
  const baseTokens = estimateTokens(JSON.stringify(baseResponse, null, 2));
  currentTokens = baseTokens;

  // Add items one by one until we approach the token limit
  for (let i = 0; i < items.length; i++) {
    const itemTokens = estimateTokens(JSON.stringify(items[i], null, 2));

    // Leave some buffer (10%) to account for formatting and additional metadata
    if (currentTokens + itemTokens > tokenLimit * 0.9) {
      break;
    }

    currentTokens += itemTokens;
    safeCount++;
  }

  // Always return at least 1 item if any exist, even if it exceeds limit
  // This prevents infinite loops and ensures progress
  return Math.max(safeCount, items.length > 0 ? 1 : 0);
}

describe('Token Limit Enforcement Unit Tests', () => {
  describe('calculateSafeItemCount', () => {
    it('should return 0 for empty items array', () => {
      const result = calculateSafeItemCount([], 20000);
      expect(result).toBe(0);
    });

    it('should return at least 1 item if any exist', () => {
      const largeItem = {
        key: 'large.item',
        value: 'X'.repeat(100000), // Very large item
        category: 'test',
        priority: 'high',
      };

      const result = calculateSafeItemCount([largeItem], 20000);
      expect(result).toBe(1);
    });

    it('should truncate items when approaching token limit', () => {
      // Create multiple medium-sized items
      const items = [];
      for (let i = 0; i < 50; i++) {
        items.push({
          key: `item.${i}`,
          value:
            'This is a medium-sized test value that contains enough text to trigger token limit enforcement when many items are returned together. '.repeat(
              20
            ),
          category: 'test',
          priority: 'high',
        });
      }

      const result = calculateSafeItemCount(items, 20000);
      expect(result).toBeLessThan(50);
      expect(result).toBeGreaterThan(0);
    });

    it('should handle small items that all fit within limit', () => {
      const items = [];
      for (let i = 0; i < 10; i++) {
        items.push({
          key: `small.item.${i}`,
          value: 'Small value',
          category: 'test',
          priority: 'high',
        });
      }

      const result = calculateSafeItemCount(items, 20000);
      expect(result).toBe(10);
    });

    it('should respect token limit with buffer', () => {
      // Create items that would exceed token limit
      const items = [];
      const itemValue = 'X'.repeat(2000); // 2KB item that will definitely cause truncation

      for (let i = 0; i < 100; i++) {
        items.push({
          key: `large.buffer.item.${i}`,
          value: itemValue,
          category: 'test',
          priority: 'high',
        });
      }

      const result = calculateSafeItemCount(items, 20000);

      // Should be significantly less than all items due to token limits
      expect(result).toBeLessThan(100);
      expect(result).toBeGreaterThan(0);

      // Verify that the result respects the buffer by checking actual tokens
      const actualTokens = result * estimateTokens(JSON.stringify(items[0], null, 2));
      expect(actualTokens).toBeLessThan(20000 * 0.9); // Should be under 90% of limit
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens correctly', () => {
      const text = 'This is a test string';
      const tokens = estimateTokens(text);
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    it('should handle empty strings', () => {
      const tokens = estimateTokens('');
      expect(tokens).toBe(0);
    });

    it('should handle large strings', () => {
      const largeText = 'X'.repeat(10000);
      const tokens = estimateTokens(largeText);
      expect(tokens).toBe(2500); // 10000 / 4
    });
  });
});
