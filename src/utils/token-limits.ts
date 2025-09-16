/**
 * Token limit management utilities for MCP Memory Keeper
 *
 * Provides dynamic calculation of safe limits based on actual content
 * instead of relying on hardcoded values scattered throughout the codebase.
 */

// Validation bounds for environment variables
const VALIDATION_BOUNDS = {
  MAX_TOKENS: { MIN: 1000, MAX: 100000 },
  SAFETY_BUFFER: { MIN: 0.1, MAX: 1.0 },
  MIN_ITEMS: { MIN: 1, MAX: 100 },
  MAX_ITEMS: { MIN: 10, MAX: 1000 },
  CHARS_PER_TOKEN: { MIN: 2.5, MAX: 5.0 }, // Advanced: token estimation ratio
} as const;

// SQL query limits
const QUERY_LIMITS = {
  SAMPLE_SIZE: 10, // Items to sample for average size calculation
} as const;

// JSON formatting
const JSON_INDENT_SPACES = 2;

// Warning threshold for token usage (70% of limit)
export const TOKEN_WARNING_THRESHOLD = 0.7;

/** Interface for context items used in token calculations */
export interface ContextItem {
  key: string;
  value: string;
  category?: string;
  priority?: 'high' | 'normal' | 'low';
  channel?: string;
  metadata?: string | object | null;
  size?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: any; // Allow additional properties
}

export interface TokenLimitConfig {
  /** Maximum tokens allowed by MCP protocol */
  mcpMaxTokens: number;
  /** Safety buffer percentage (0.0 to 1.0) */
  safetyBuffer: number;
  /** Minimum items to return even if it exceeds limits */
  minItems: number;
  /** Maximum items allowed in a single response */
  maxItems: number;
  /** Characters per token ratio for estimation (advanced) */
  charsPerToken: number;
}

/** Default configuration values */
export const DEFAULT_TOKEN_CONFIG: TokenLimitConfig = {
  mcpMaxTokens: 25000,
  safetyBuffer: 0.8, // Use only 80% of the limit for safety
  minItems: 1,
  maxItems: 100,
  charsPerToken: 3.5, // Conservative estimate for JSON content
};

/**
 * Estimates token count for a given text
 * @param text The text to estimate tokens for
 * @param charsPerToken Optional character-to-token ratio (default: 3.5)
 * @returns Estimated number of tokens
 *
 * Token estimation is based on empirical analysis of OpenAI's tokenization:
 * - OpenAI's guideline: ~4 characters per token for English text
 * - Default uses 3.5 chars/token for more conservative estimation
 * - This accounts for JSON formatting, special characters, and metadata overhead
 * - Conservative estimation prevents unexpected token limit errors
 * - Can be configured via MCP_CHARS_PER_TOKEN environment variable
 */
export function estimateTokens(
  text: string,
  charsPerToken: number = DEFAULT_TOKEN_CONFIG.charsPerToken
): number {
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Calculate the size of a value in bytes
 */
export function calculateSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Estimates the overhead of the response structure
 * @param itemCount Number of items in the response
 * @param includeMetadata Whether metadata fields are included
 * @param config Optional token configuration
 * @returns Estimated tokens for the response wrapper
 */
export function estimateResponseOverhead(
  itemCount: number,
  includeMetadata: boolean = false,
  config: TokenLimitConfig = DEFAULT_TOKEN_CONFIG
): number {
  // Base pagination structure
  const basePagination = {
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
    defaultsApplied: { limit: true, sort: true },
    truncated: false,
    truncatedCount: 0,
  };

  // Extended fields when metadata is included
  if (includeMetadata) {
    // Additional overhead for metadata fields:
    // - Timestamps (created_at, updated_at): ~40 chars each
    // - Size field: ~10 chars
    // - Warning messages: up to 200 chars
    // - JSON formatting: ~100 chars
    // Total additional overhead: ~200 tokens
    const METADATA_OVERHEAD_TOKENS = 200;
    return (
      estimateTokens(JSON.stringify(basePagination), config.charsPerToken) +
      METADATA_OVERHEAD_TOKENS
    );
  }

  return estimateTokens(JSON.stringify(basePagination), config.charsPerToken);
}

/**
 * Calculate the safe number of items that can be returned
 * @param items Sample items to calculate with
 * @param includeMetadata Whether metadata will be included
 * @param config Token limit configuration
 * @returns Safe number of items to return
 */
export function calculateSafeItemLimit(
  items: ContextItem[],
  includeMetadata: boolean = false,
  config: TokenLimitConfig = DEFAULT_TOKEN_CONFIG
): number {
  if (items.length === 0) return 0;

  // Calculate safe token limit (with buffer)
  const safeTokenLimit = Math.floor(config.mcpMaxTokens * config.safetyBuffer);

  // Calculate overhead
  const responseOverhead = estimateResponseOverhead(items.length, includeMetadata, config);

  // Calculate average item size from a sample
  // Sample size of 10 items provides good statistical representation
  // while keeping calculation overhead minimal
  const SAMPLE_SIZE = 10;
  const sampleSize = Math.min(SAMPLE_SIZE, items.length);
  const sampleItems = items.slice(0, sampleSize);

  // Helper to safely parse JSON metadata
  const parseMetadata = (metadata: string | object | null | undefined): object | null => {
    if (!metadata) return null;
    if (typeof metadata === 'object') return metadata;
    try {
      return JSON.parse(metadata);
    } catch (error) {
      console.warn('Invalid JSON in metadata, using null:', error);
      return null;
    }
  };

  // Transform items if metadata is included
  const itemsForCalculation = includeMetadata
    ? sampleItems.map(item => ({
        key: item.key,
        value: item.value,
        category: item.category,
        priority: item.priority,
        channel: item.channel,
        metadata: parseMetadata(item.metadata),
        size: item.size || calculateSize(item.value || ''),
        created_at: item.created_at,
        updated_at: item.updated_at,
      }))
    : sampleItems;

  // Calculate average tokens per item
  const totalSampleTokens = itemsForCalculation.reduce((sum, item) => {
    return (
      sum + estimateTokens(JSON.stringify(item, null, JSON_INDENT_SPACES), config.charsPerToken)
    );
  }, 0);
  const avgTokensPerItem = Math.ceil(totalSampleTokens / sampleSize);

  // Calculate how many items can fit
  const availableTokens = safeTokenLimit - responseOverhead;
  const safeItemCount = Math.floor(availableTokens / avgTokensPerItem);

  // Apply min/max constraints
  const finalCount = Math.max(
    config.minItems,
    Math.min(safeItemCount, config.maxItems, items.length)
  );

  // Log calculation details for debugging
  if (process.env.MCP_DEBUG_LOGGING) {
    console.log('[Token Calculation]', {
      safeTokenLimit,
      responseOverhead,
      avgTokensPerItem,
      availableTokens,
      calculatedCount: safeItemCount,
      finalCount,
      includeMetadata,
    });
  }

  return finalCount;
}

/**
 * Dynamically calculate the default limit based on typical item sizes
 * @param sessionId Session to analyze
 * @param includeMetadata Whether metadata will be included
 * @param db Database connection
 * @returns Calculated safe default limit
 */
export function calculateDynamicDefaultLimit(
  sessionId: string,
  includeMetadata: boolean,
  db: any
): number {
  try {
    // Get a sample of recent items to calculate average size
    const sampleQuery = `
      SELECT * FROM context_items
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ${QUERY_LIMITS.SAMPLE_SIZE}
    `;
    const sampleItems = db.prepare(sampleQuery).all(sessionId);

    if (sampleItems.length === 0) {
      // No items yet, use conservative defaults
      // With metadata: 30 items (typically ~800 chars each = ~6,800 tokens)
      // Without metadata: 100 items (typically ~200 chars each = ~5,700 tokens)
      // These defaults ensure first queries don't exceed limits
      const DEFAULT_LIMIT_WITH_METADATA = 30;
      const DEFAULT_LIMIT_WITHOUT_METADATA = 100;
      return includeMetadata ? DEFAULT_LIMIT_WITH_METADATA : DEFAULT_LIMIT_WITHOUT_METADATA;
    }

    // Calculate safe limit based on actual data
    const safeLimit = calculateSafeItemLimit(sampleItems, includeMetadata);

    // Round to nearest 10 for cleaner limits and better user experience
    // Minimum of 10 items to ensure useful results even with large items
    const ROUNDING_FACTOR = 10;
    const MIN_DYNAMIC_LIMIT = 10;
    return Math.max(MIN_DYNAMIC_LIMIT, Math.floor(safeLimit / ROUNDING_FACTOR) * ROUNDING_FACTOR);
  } catch (error) {
    // Fallback to conservative defaults on error

    console.error('Error calculating dynamic limit:', error);
    const FALLBACK_LIMIT_WITH_METADATA = 30;
    const FALLBACK_LIMIT_WITHOUT_METADATA = 100;
    return includeMetadata ? FALLBACK_LIMIT_WITH_METADATA : FALLBACK_LIMIT_WITHOUT_METADATA;
  }
}

/**
 * Check if a response would exceed token limits
 * @param items Items to be returned
 * @param includeMetadata Whether metadata is included
 * @param config Token limit configuration
 * @returns Object with exceedsLimit flag and estimated tokens
 */
export function checkTokenLimit(
  items: ContextItem[],
  includeMetadata: boolean = false,
  config: TokenLimitConfig = DEFAULT_TOKEN_CONFIG
): { exceedsLimit: boolean; estimatedTokens: number; safeItemCount: number } {
  // Transform items if needed
  const itemsForCalculation = includeMetadata
    ? items.map(item => ({
        key: item.key,
        value: item.value,
        category: item.category,
        priority: item.priority,
        channel: item.channel,
        metadata: item.metadata
          ? typeof item.metadata === 'string'
            ? JSON.parse(item.metadata)
            : item.metadata
          : null,
        size: item.size || calculateSize(item.value || ''),
        created_at: item.created_at,
        updated_at: item.updated_at,
      }))
    : items;

  // Build full response structure matching actual handler response
  const response = {
    items: itemsForCalculation,
    pagination: {
      total: items.length,
      returned: items.length,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      truncated: false,
      truncatedCount: 0,
      warning: undefined as string | undefined,
    },
  };

  const responseJson = JSON.stringify(response, null, JSON_INDENT_SPACES);
  const estimatedTokens = estimateTokens(responseJson, config.charsPerToken);
  const safeLimit = Math.floor(config.mcpMaxTokens * config.safetyBuffer);
  const exceedsLimit = estimatedTokens > safeLimit;

  const safeItemCount = exceedsLimit
    ? calculateSafeItemLimit(items, includeMetadata, config)
    : items.length;

  return { exceedsLimit, estimatedTokens, safeItemCount };
}

/**
 * Get configuration from environment or use defaults
 * Validates all environment variables to ensure they're within reasonable bounds
 */
export function getTokenConfig(): TokenLimitConfig {
  const config = { ...DEFAULT_TOKEN_CONFIG };

  // Validate and apply MCP_MAX_TOKENS
  if (process.env.MCP_MAX_TOKENS) {
    const maxTokens = parseInt(process.env.MCP_MAX_TOKENS, 10);
    if (
      !isNaN(maxTokens) &&
      maxTokens >= VALIDATION_BOUNDS.MAX_TOKENS.MIN &&
      maxTokens <= VALIDATION_BOUNDS.MAX_TOKENS.MAX
    ) {
      config.mcpMaxTokens = maxTokens;
    } else {
      console.warn(
        `Invalid MCP_MAX_TOKENS (${process.env.MCP_MAX_TOKENS}), using default ${DEFAULT_TOKEN_CONFIG.mcpMaxTokens}`
      );
    }
  }

  // Validate and apply MCP_TOKEN_SAFETY_BUFFER
  if (process.env.MCP_TOKEN_SAFETY_BUFFER) {
    const buffer = parseFloat(process.env.MCP_TOKEN_SAFETY_BUFFER);
    if (
      !isNaN(buffer) &&
      buffer >= VALIDATION_BOUNDS.SAFETY_BUFFER.MIN &&
      buffer <= VALIDATION_BOUNDS.SAFETY_BUFFER.MAX
    ) {
      config.safetyBuffer = buffer;
    } else {
      console.warn(
        `Invalid MCP_TOKEN_SAFETY_BUFFER (${process.env.MCP_TOKEN_SAFETY_BUFFER}), using default ${DEFAULT_TOKEN_CONFIG.safetyBuffer}`
      );
    }
  }

  // Validate and apply MCP_MIN_ITEMS
  if (process.env.MCP_MIN_ITEMS) {
    const minItems = parseInt(process.env.MCP_MIN_ITEMS, 10);
    if (
      !isNaN(minItems) &&
      minItems >= VALIDATION_BOUNDS.MIN_ITEMS.MIN &&
      minItems <= VALIDATION_BOUNDS.MIN_ITEMS.MAX
    ) {
      config.minItems = minItems;
    } else {
      console.warn(
        `Invalid MCP_MIN_ITEMS (${process.env.MCP_MIN_ITEMS}), using default ${DEFAULT_TOKEN_CONFIG.minItems}`
      );
    }
  }

  // Validate and apply MCP_MAX_ITEMS
  if (process.env.MCP_MAX_ITEMS) {
    const maxItems = parseInt(process.env.MCP_MAX_ITEMS, 10);
    if (
      !isNaN(maxItems) &&
      maxItems >= VALIDATION_BOUNDS.MAX_ITEMS.MIN &&
      maxItems <= VALIDATION_BOUNDS.MAX_ITEMS.MAX
    ) {
      config.maxItems = maxItems;
    } else {
      console.warn(
        `Invalid MCP_MAX_ITEMS (${process.env.MCP_MAX_ITEMS}), using default ${DEFAULT_TOKEN_CONFIG.maxItems}`
      );
    }
  }

  // Validate and apply MCP_CHARS_PER_TOKEN (advanced setting)
  if (process.env.MCP_CHARS_PER_TOKEN) {
    const charsPerToken = parseFloat(process.env.MCP_CHARS_PER_TOKEN);
    if (
      !isNaN(charsPerToken) &&
      charsPerToken >= VALIDATION_BOUNDS.CHARS_PER_TOKEN.MIN &&
      charsPerToken <= VALIDATION_BOUNDS.CHARS_PER_TOKEN.MAX
    ) {
      config.charsPerToken = charsPerToken;
    } else {
      console.warn(
        `Invalid MCP_CHARS_PER_TOKEN (${process.env.MCP_CHARS_PER_TOKEN}), using default ${DEFAULT_TOKEN_CONFIG.charsPerToken}. Valid range: ${VALIDATION_BOUNDS.CHARS_PER_TOKEN.MIN}-${VALIDATION_BOUNDS.CHARS_PER_TOKEN.MAX}`
      );
    }
  }

  // Ensure min <= max
  if (config.minItems > config.maxItems) {
    console.warn(
      `MCP_MIN_ITEMS (${config.minItems}) > MCP_MAX_ITEMS (${config.maxItems}), swapping values`
    );
    [config.minItems, config.maxItems] = [config.maxItems, config.minItems];
  }

  return config;
}
