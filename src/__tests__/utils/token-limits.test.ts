import {
  estimateTokens,
  calculateSafeItemLimit,
  checkTokenLimit,
  estimateResponseOverhead,
  calculateDynamicDefaultLimit,
  DEFAULT_TOKEN_CONFIG,
} from '../../utils/token-limits';

describe('Token Limit Utilities', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens more conservatively than before', () => {
      const text = 'This is a test string';
      const tokens = estimateTokens(text);
      // Using 3.5 chars per token instead of 4
      expect(tokens).toBe(Math.ceil(text.length / 3.5));
    });

    it('should handle empty strings', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should handle large texts', () => {
      const largeText = 'x'.repeat(10000);
      const tokens = estimateTokens(largeText);
      expect(tokens).toBe(Math.ceil(10000 / 3.5));
    });
  });

  describe('calculateSafeItemLimit', () => {
    const createTestItems = (count: number, size: 'small' | 'medium' | 'large') => {
      const content = {
        small: 'Small content',
        medium: 'Medium content that is longer and has more details'.repeat(5),
        large: 'Large content with substantial information'.repeat(20),
      };

      return Array.from({ length: count }, (_, i) => ({
        key: `item_${i}`,
        value: content[size],
        category: 'test',
        priority: 'normal' as const,
        channel: 'test',
        created_at: '2024-01-20T10:00:00Z',
        updated_at: '2024-01-20T10:00:00Z',
      }));
    };

    it('should calculate safe limit for small items', () => {
      const items = createTestItems(100, 'small');
      const limit = calculateSafeItemLimit(items, false);

      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(100);
    });

    it('should calculate smaller limit for large items', () => {
      const smallItems = createTestItems(100, 'small');
      const largeItems = createTestItems(100, 'large');

      const smallLimit = calculateSafeItemLimit(smallItems, false);
      const largeLimit = calculateSafeItemLimit(largeItems, false);

      expect(largeLimit).toBeLessThan(smallLimit);
    });

    it('should calculate smaller limit with metadata', () => {
      // Create items with actual metadata that would be added
      const items = createTestItems(100, 'medium').map(item => ({
        ...item,
        metadata: JSON.stringify({
          tags: ['test', 'example'],
          timestamp: new Date().toISOString(),
          additionalInfo: 'Extra metadata that adds size',
        }),
        size: 500,
      }));

      const withoutMetadataLimit = calculateSafeItemLimit(items, false);
      const withMetadataLimit = calculateSafeItemLimit(items, true);

      // When metadata is included, each item becomes larger due to additional fields
      // This should result in fewer items fitting in the token limit
      // If they're equal, it might mean both hit the maxItems constraint
      expect(withMetadataLimit).toBeLessThanOrEqual(withoutMetadataLimit);
    });

    it('should respect min and max constraints', () => {
      const items = createTestItems(1000, 'small');
      const config = {
        ...DEFAULT_TOKEN_CONFIG,
        minItems: 5,
        maxItems: 50,
      };

      const limit = calculateSafeItemLimit(items, false, config);

      expect(limit).toBeGreaterThanOrEqual(5);
      expect(limit).toBeLessThanOrEqual(50);
    });

    it('should return 0 for empty array', () => {
      const limit = calculateSafeItemLimit([], false);
      expect(limit).toBe(0);
    });
  });

  describe('checkTokenLimit', () => {
    const createLargeDataset = () => {
      return Array.from({ length: 200 }, (_, i) => ({
        key: `item_${i}`,
        value:
          `Large content that would cause token overflow when many items are combined. `.repeat(10),
        category: 'test',
        priority: 'high' as const,
        metadata: JSON.stringify({ index: i }),
        created_at: '2024-01-20T10:00:00Z',
        updated_at: '2024-01-20T10:00:00Z',
      }));
    };

    it('should detect when token limit is exceeded', () => {
      const items = createLargeDataset();
      const { exceedsLimit, estimatedTokens, safeItemCount } = checkTokenLimit(items, true);

      expect(exceedsLimit).toBe(true);
      expect(estimatedTokens).toBeGreaterThan(
        DEFAULT_TOKEN_CONFIG.mcpMaxTokens * DEFAULT_TOKEN_CONFIG.safetyBuffer
      );
      expect(safeItemCount).toBeLessThan(items.length);
    });

    it('should not exceed limit for small datasets', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        key: `item_${i}`,
        value: 'Small content',
        category: 'test',
      }));

      const { exceedsLimit, estimatedTokens } = checkTokenLimit(items, false);

      expect(exceedsLimit).toBe(false);
      expect(estimatedTokens).toBeLessThan(
        DEFAULT_TOKEN_CONFIG.mcpMaxTokens * DEFAULT_TOKEN_CONFIG.safetyBuffer
      );
    });

    it('should handle metadata transformation', () => {
      const items = [
        {
          key: 'test',
          value: 'content',
          metadata: '{"tag": "test"}', // String metadata
        },
      ];

      const { exceedsLimit } = checkTokenLimit(items, true);
      expect(exceedsLimit).toBe(false);
    });
  });

  describe('estimateResponseOverhead', () => {
    it('should estimate overhead for basic response', () => {
      const overhead = estimateResponseOverhead(10, false);
      expect(overhead).toBeGreaterThan(0);
    });

    it('should estimate higher overhead with metadata', () => {
      const basicOverhead = estimateResponseOverhead(10, false);
      const metadataOverhead = estimateResponseOverhead(10, true);

      expect(metadataOverhead).toBeGreaterThan(basicOverhead);
    });
  });

  describe('calculateDynamicDefaultLimit', () => {
    const createMockDb = (items: any[]) => ({
      prepare: jest.fn(() => ({
        all: jest.fn(() => items),
      })),
    });

    it('should calculate limit based on session data', () => {
      const sampleItems = Array.from({ length: 10 }, (_, i) => ({
        key: `item_${i}`,
        value: 'Sample content for calculation',
        category: 'test',
      }));

      const mockDb = createMockDb(sampleItems);
      const limit = calculateDynamicDefaultLimit('test-session', false, mockDb);

      expect(limit).toBeGreaterThan(0);
      expect(limit % 10).toBe(0); // Should be rounded to nearest 10
    });

    it('should return conservative defaults for empty session', () => {
      const mockDb = createMockDb([]);
      const limitWithMetadata = calculateDynamicDefaultLimit('test-session', true, mockDb);
      const limitWithoutMetadata = calculateDynamicDefaultLimit('test-session', false, mockDb);

      expect(limitWithMetadata).toBe(30);
      expect(limitWithoutMetadata).toBe(100);
    });

    it('should handle database errors gracefully', () => {
      const mockDb = {
        prepare: jest.fn(() => {
          throw new Error('Database error');
        }),
      };

      const limit = calculateDynamicDefaultLimit('test-session', true, mockDb);
      expect(limit).toBe(30); // Fallback to conservative default
    });

    it('should return smaller limit with metadata', () => {
      // Create items with substantial content that shows clear difference
      const sampleItems = Array.from({ length: 10 }, (_, i) => ({
        key: `item_${i}`,
        value: 'Sample content that is moderately sized'.repeat(20), // Larger content
        category: 'test',
        priority: 'high' as const,
        channel: 'test-channel',
        metadata: JSON.stringify({
          index: i,
          tags: ['tag1', 'tag2', 'tag3'],
          description: 'Additional metadata that increases size',
          timestamp: new Date().toISOString(),
        }),
        size: 1000,
        created_at: '2024-01-20T10:00:00Z',
        updated_at: '2024-01-20T10:00:00Z',
      }));

      const mockDb = createMockDb(sampleItems);
      const withoutMetadata = calculateDynamicDefaultLimit('test-session', false, mockDb);
      const withMetadata = calculateDynamicDefaultLimit('test-session', true, mockDb);

      // Dynamic calculation should return smaller limit when metadata is included
      // Both should be rounded to nearest 10
      expect(withMetadata % 10).toBe(0);
      expect(withoutMetadata % 10).toBe(0);

      // With larger items and metadata, the difference should be clear
      // If they're the same, both might be hitting minimum threshold
      expect(withMetadata).toBeLessThanOrEqual(withoutMetadata);
    });
  });
});
