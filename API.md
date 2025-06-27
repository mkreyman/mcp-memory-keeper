# MCP Memory Keeper - API Reference

## Table of Contents
- [Session Management](#session-management)
- [Context Storage](#context-storage)
- [File Management](#file-management)
- [Checkpoints](#checkpoints)
- [Search & Analysis](#search--analysis)
- [Export/Import](#exportimport)
- [Knowledge Graph](#knowledge-graph)
- [Semantic Search](#semantic-search)
- [Multi-Agent System](#multi-agent-system)
- [Advanced Features](#advanced-features)
- [Error Handling](#error-handling)

## Session Management

### context_session_start

Start a new session or continue from a previous one.

**Parameters:**
```typescript
{
  name?: string;           // Optional session name
  description?: string;    // Optional session description
  continueFrom?: string;   // Previous session ID to continue from
  projectDir?: string;     // Project directory for git tracking
  defaultChannel?: string; // Default channel for context items (auto-derived from git branch if not specified)
}
```

**Returns:**
```typescript
{
  sessionId: string;       // Unique session identifier
  name: string;            // Session name
  description?: string;    // Session description if provided
  parentId?: string;       // Parent session ID if branched
  createdAt: string;       // ISO timestamp
}
```

**Example:**
```typescript
// Start new session
await context_session_start({
  name: "Feature Development",
  description: "Implementing user authentication"
});

// Continue from previous
await context_session_start({
  name: "Feature Dev Day 2",
  continueFrom: "previous-session-id"
});
```

### context_session_list

List recent sessions with optional filtering.

**Parameters:**
```typescript
{
  limit?: number;          // Number of sessions to return (default: 10)
  beforeDate?: string;     // Filter sessions before this date
  afterDate?: string;      // Filter sessions after this date
}
```

**Returns:**
```typescript
{
  sessions: Array<{
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    itemCount: number;
    parentId?: string;
  }>;
  total: number;
}
```

## Context Storage

### context_save

Save context information with categories and priorities.

**Parameters:**
```typescript
{
  key: string;             // Unique identifier for the context item
  value: string;           // Content to save
  category?: 'task' | 'decision' | 'progress' | 'note' | 'warning' | 'error';
  priority?: 'critical' | 'high' | 'normal' | 'low';
  metadata?: any;          // Additional JSON metadata
  private?: boolean;       // If true, item is only visible in current session (default: false - shared across all sessions)
  channel?: string;        // Channel to save to (default: session's defaultChannel or auto-derived from git branch)
}
```

**Returns:**
```typescript
{
  id: string;              // Unique item ID
  key: string;             // The provided key
  sessionId: string;       // Current session ID
  createdAt: string;       // ISO timestamp
}
```

**Example:**
```typescript
// Save public context (default - accessible from all sessions)
await context_save({
  key: "auth_decision",
  value: "Using JWT with 24h expiry and refresh tokens",
  category: "decision",
  priority: "high",
  metadata: { reviewedBy: "team", approvedDate: "2024-01-15" }
});

// Save private context (only visible in current session)
await context_save({
  key: "debug_notes",
  value: "Local testing with mock API keys",
  category: "note",
  private: true
});
```

### context_get

Retrieve context items with flexible filtering. By default, returns all accessible items (public items from all sessions + private items from current session).

**Parameters:**
```typescript
{
  key?: string;            // Specific key to retrieve
  category?: string;       // Filter by category
  priority?: string;       // Filter by priority (deprecated - use priorities)
  priorities?: string[];   // Filter by multiple priorities (NEW v0.10.0)
  sessionId?: string;      // Specific session (default: current)
  limit?: number;          // Maximum items to return
  offset?: number;         // Pagination offset (NEW v0.10.0)
  channel?: string;        // Filter by channel (NEW v0.10.0)
  includeMetadata?: boolean; // Include timestamps and size info (NEW v0.10.0)
  sort?: 'created_asc' | 'created_desc' | 'updated_asc' | 'updated_desc' | 'priority'; // Sort order (NEW v0.10.0)
  createdAfter?: string;   // ISO date - items created after this time (NEW v0.10.0)
  createdBefore?: string;  // ISO date - items created before this time (NEW v0.10.0)
  keyPattern?: string;     // Regex pattern to match keys (NEW v0.10.0)
}
```

**Returns:**
```typescript
{
  items: Array<{
    id: string;
    key: string;
    value: string;
    category?: string;
    priority?: string;
    metadata?: any;
    createdAt: string;
    updatedAt?: string;      // When includeMetadata: true
    size?: number;           // When includeMetadata: true
    channel?: string;        // When includeMetadata: true
  }>;
  count: number;
}
```

**Examples:**
```typescript
// Get items from specific channel
await context_get({ 
  channel: "feature-auth" 
});

// Get recent high-priority items with metadata
await context_get({
  priorities: ["high", "critical"],
  createdAfter: new Date(Date.now() - 24*60*60*1000).toISOString(),
  includeMetadata: true,
  sort: "created_desc"
});

// Paginated results
await context_get({
  category: "task",
  limit: 20,
  offset: 40,  // Skip first 40 items
  sort: "priority"
});

// Pattern matching
await context_get({
  keyPattern: "auth_.*|login_.*",
  channel: "feature-auth"
});
```

### context_delete

Delete a specific context item.

**Parameters:**
```typescript
{
  key: string;             // Key of item to delete
  sessionId?: string;      // Session ID (default: current)
}
```

**Returns:**
```typescript
{
  success: boolean;
  deletedCount: number;
}
```

## File Management

### context_cache_file

Cache file content for change detection.

**Parameters:**
```typescript
{
  filePath: string;        // Absolute or relative file path
  content: string;         // File content
  metadata?: any;          // Additional metadata
}
```

**Returns:**
```typescript
{
  id: string;              // Cache entry ID
  filePath: string;        // Normalized file path
  hash: string;            // SHA-256 hash of content
  size: number;            // Content size in bytes
}
```

### context_file_changed

Check if a file has changed since last cache.

**Parameters:**
```typescript
{
  filePath: string;        // File path to check
  currentContent?: string; // Current content (optional, will read if not provided)
}
```

**Returns:**
```typescript
{
  changed: boolean;        // True if file changed
  previousHash?: string;   // Previous content hash
  currentHash: string;     // Current content hash
  lastCached?: string;     // When file was last cached
}
```

## Checkpoints

### context_checkpoint

Create a complete snapshot of current context.

**Parameters:**
```typescript
{
  name: string;            // Checkpoint name
  description?: string;    // Optional description
  includeFiles?: boolean;  // Include cached files (default: false)
  includeGitStatus?: boolean; // Include git status (default: false)
}
```

**Returns:**
```typescript
{
  checkpointId: string;    // Unique checkpoint ID
  name: string;            // Checkpoint name
  itemCount: number;       // Number of context items
  fileCount: number;       // Number of files included
  gitBranch?: string;      // Current git branch
  gitStatus?: string;      // Git status output
  createdAt: string;       // ISO timestamp
}
```

### context_restore_checkpoint

Restore context from a checkpoint.

**Parameters:**
```typescript
{
  name?: string;           // Checkpoint name (latest if not specified)
  checkpointId?: string;   // Specific checkpoint ID
  restoreFiles?: boolean;  // Restore file cache (default: false)
  merge?: boolean;         // Merge with current context (default: false)
}
```

**Returns:**
```typescript
{
  restoredItems: number;   // Number of items restored
  restoredFiles: number;   // Number of files restored
  sessionId: string;       // New or current session ID
  checkpoint: {
    name: string;
    createdAt: string;
    description?: string;
  };
}
```

## Search & Analysis

### context_search

Full-text search across context items with advanced filtering and sorting.

**Parameters:**
```typescript
{
  query: string;           // Search query (required)
  searchIn?: ('key' | 'value')[];  // Fields to search (default: ['key', 'value'])
  sessionId?: string;      // Session to search (default: current)
  
  // Filtering options
  category?: string;       // Filter by category
  channel?: string;        // Filter by single channel
  channels?: string[];     // Filter by multiple channels
  priorities?: ('high' | 'normal' | 'low')[];  // Filter by priorities
  keyPattern?: string;     // GLOB pattern for key matching (e.g., "user_*")
  
  // Time filtering
  createdAfter?: string;   // ISO date string
  createdBefore?: string;  // ISO date string
  relativeTime?: string;   // Natural language time (e.g., "2 hours ago", "yesterday")
  
  // Sorting and pagination
  sort?: 'created_desc' | 'created_asc' | 'updated_desc' | 'key_asc' | 'key_desc';
  limit?: number;          // Maximum results
  offset?: number;         // Pagination offset
  includeMetadata?: boolean;  // Include detailed metadata
}
```

**Returns (without metadata):**
```typescript
{
  results: Array<{
    key: string;
    value: string;
    category?: string;
    priority: string;
  }>;
}
```

**Returns (with metadata):**
```typescript
{
  items: Array<{
    id: string;
    key: string;
    value: string;
    category?: string;
    priority: string;
    channel: string;
    created_at: string;
    updated_at: string;
    size: number;
    metadata?: any;
  }>;
  totalCount: number;
  page: number;
  pageSize: number;
}
```

**Examples:**
```typescript
// Simple search
await context_search({ query: "api key" });

// Search with time filtering
await context_search({
  query: "error",
  relativeTime: "2 hours ago",
  channel: "debugging"
});

// Advanced filtering with pagination
await context_search({
  query: "config",
  keyPattern: "app_*",
  priorities: ["high"],
  sort: "created_desc",
  limit: 20,
  offset: 0,
  includeMetadata: true
});
```

### context_summarize

Generate AI-friendly summary of context.

**Parameters:**
```typescript
{
  categories?: string[];   // Categories to include
  sessionId?: string;      // Specific session (default: current)
  maxLength?: number;      // Maximum summary length
  format?: 'markdown' | 'json' | 'text';
}
```

**Returns:**
```typescript
{
  summary: string;         // Formatted summary
  stats: {
    totalItems: number;
    byCategory: Record<string, number>;
    byPriority: Record<string, number>;
  };
  sessionInfo: {
    id: string;
    name: string;
    duration: string;
  };
}
```

### context_analyze

Analyze context to extract entities and relationships.

**Parameters:**
```typescript
{
  categories?: string[];   // Categories to analyze
  sessionId?: string;      // Session to analyze
  maxDepth?: number;       // Relationship depth (default: 2)
}
```

**Returns:**
```typescript
{
  entities: Array<{
    id: string;
    type: string;
    name: string;
    count: number;
    attributes?: any;
  }>;
  relations: Array<{
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
  }>;
  stats: {
    totalEntities: number;
    totalRelations: number;
    types: Record<string, number>;
  };
}
```

## Export/Import

### context_export

Export context to JSON file.

**Parameters:**
```typescript
{
  sessionId?: string;      // Session to export (default: current)
  sessionIds?: string[];   // Multiple sessions to export
  format?: 'json' | 'csv'; // Export format (default: json)
  outputPath?: string;     // Custom output path
  includeMetadata?: boolean; // Include system metadata
}
```

**Returns:**
```typescript
{
  filePath: string;        // Output file path
  stats: {
    sessions: number;
    items: number;
    files: number;
    checkpoints: number;
    size: number;         // File size in bytes
  };
}
```

### context_import

Import context from file.

**Parameters:**
```typescript
{
  filePath: string;        // Path to import file
  merge?: boolean;         // Merge with existing (default: false)
  mergeStrategy?: 'skip' | 'overwrite' | 'rename';
  sessionName?: string;    // Override session name
}
```

**Returns:**
```typescript
{
  imported: {
    sessions: number;
    items: number;
    files: number;
    checkpoints: number;
  };
  skipped: number;
  errors: string[];
  sessionIds: string[];    // Imported session IDs
}
```

## Knowledge Graph

### context_find_related

Find entities related to a key.

**Parameters:**
```typescript
{
  key: string;             // Entity key to search from
  maxDepth?: number;       // Relationship depth (default: 2)
  relationTypes?: string[]; // Filter by relation types
  limit?: number;          // Maximum results
}
```

**Returns:**
```typescript
{
  entities: Array<{
    id: string;
    name: string;
    type: string;
    distance: number;      // Relationship distance
    path: string[];        // Relationship path
  }>;
  relations: Array<{
    subject: string;
    predicate: string;
    object: string;
  }>;
}
```

### context_visualize

Generate visualization data for context.

**Parameters:**
```typescript
{
  type: 'graph' | 'timeline' | 'heatmap';
  sessionId?: string;      // Session to visualize
  startDate?: string;      // For timeline view
  endDate?: string;        // For timeline view
  groupBy?: 'hour' | 'day' | 'week'; // Timeline grouping
}
```

**Returns:**
```typescript
// For graph type:
{
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    size: number;
    color?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label: string;
    weight: number;
  }>;
}

// For timeline type:
{
  periods: Array<{
    period: string;
    count: number;
    categories: Record<string, number>;
    events: Array<{
      time: string;
      type: string;
      description: string;
    }>;
  }>;
}
```

## Semantic Search

### context_semantic_search

Search using natural language queries.

**Parameters:**
```typescript
{
  query: string;           // Natural language query
  topK?: number;           // Number of results (default: 10)
  minSimilarity?: number;  // Minimum similarity score (0-1)
  sessionId?: string;      // Specific session or 'all'
  categories?: string[];   // Filter by categories
}
```

**Returns:**
```typescript
{
  results: Array<{
    id: string;
    key: string;
    value: string;
    similarity: number;    // Similarity score (0-1)
    category?: string;
    priority?: string;
    sessionId: string;
  }>;
  queryEmbedding: number[]; // Query vector for debugging
}
```

## Multi-Agent System

### context_delegate

Delegate analysis tasks to specialized agents.

**Parameters:**
```typescript
{
  taskType: 'analyze' | 'synthesize' | string[];  // Task or chain
  input: any | any[];      // Task-specific input
  chain?: boolean;         // Chain multiple tasks
  context?: any;           // Additional context
}
```

**Analysis Input Types:**
```typescript
// Pattern Analysis
{
  analysisType: 'patterns';
  categories?: string[];
  timeframe?: string;
}

// Relationship Analysis
{
  analysisType: 'relationships';
  maxDepth?: number;
  entityTypes?: string[];
}

// Trend Analysis
{
  analysisType: 'trends';
  timeframe?: string;
  metrics?: string[];
}

// Comprehensive Analysis
{
  analysisType: 'comprehensive';
  includeAll?: boolean;
}
```

**Synthesis Input Types:**
```typescript
// Summary Generation
{
  synthesisType: 'summary';
  maxLength?: number;
  categories?: string[];
}

// Recommendations
{
  synthesisType: 'recommendations';
  analysisResults?: any;
  priorities?: string[];
}

// Narrative Report
{
  synthesisType: 'narrative';
  includeMetrics?: boolean;
  includeLearnings?: boolean;
}
```

**Returns:**
```typescript
{
  result: any;             // Task-specific results
  confidence: number;      // Agent confidence (0-1)
  reasoning?: string;      // Agent reasoning
  metadata?: {
    duration: number;      // Processing time (ms)
    agentType: string;     // Agent that processed
    taskId: string;        // Unique task ID
  };
}
```

## Advanced Features

### context_branch_session

Create a branch from current session.

**Parameters:**
```typescript
{
  branchName: string;      // Name for the branch
  copyDepth?: 'shallow' | 'deep'; // What to copy
  description?: string;    // Branch description
}
```

**Returns:**
```typescript
{
  branchId: string;        // New session ID
  parentId: string;        // Parent session ID
  copiedItems: number;     // Items copied
  copiedFiles: number;     // Files copied
}
```

### context_merge_sessions

Merge another session into current.

**Parameters:**
```typescript
{
  sourceSessionId: string; // Session to merge from
  conflictResolution: 'keep_current' | 'keep_source' | 'keep_newest';
  categories?: string[];   // Specific categories to merge
}
```

**Returns:**
```typescript
{
  merged: number;          // Items merged
  conflicts: number;       // Conflicts resolved
  skipped: number;         // Items skipped
  stats: {
    byCategory: Record<string, number>;
    byResolution: Record<string, number>;
  };
}
```

### context_journal_entry

Add a journal entry with tags and mood.

**Parameters:**
```typescript
{
  entry: string;           // Journal entry text
  tags?: string[];         // Tags for categorization
  mood?: 'excited' | 'happy' | 'neutral' | 'frustrated' | 'stressed';
}
```

**Returns:**
```typescript
{
  id: string;              // Entry ID
  createdAt: string;       // Timestamp
  wordCount: number;       // Entry word count
}
```

### context_timeline

Generate timeline view of activity.

**Parameters:**
```typescript
{
  startDate?: string;      // Start date (ISO)
  endDate?: string;        // End date (ISO)
  groupBy?: 'hour' | 'day' | 'week';
  includeJournals?: boolean;
  sessionId?: string;
  includeItems?: boolean;  // Include actual items, not just counts (NEW v0.10.0)
  categories?: string[];   // Filter by specific categories (NEW v0.10.0)
  relativeTime?: boolean;  // Show "2 hours ago" format (NEW v0.10.0)
  itemsPerPeriod?: number; // Max items to show per period (NEW v0.10.0)
}
```

**Returns:**
```typescript
{
  periods: Array<{
    period: string;        // Period label
    startTime: string;     // Period start
    endTime: string;       // Period end
    relativeTime?: string; // When relativeTime: true (NEW v0.10.0)
    items: {
      total: number;
      byCategory: Record<string, number>;
      details?: Array<{    // When includeItems: true (NEW v0.10.0)
        id: string;
        key: string;
        value: string;
        category?: string;
        priority?: string;
        channel?: string;
        createdAt: string;
      }>;
    };
    journals: Array<{
      id: string;
      entry: string;
      mood?: string;
      tags?: string[];
    }>;
    activity: number;      // Activity score
  }>;
  summary: {
    totalPeriods: number;
    totalItems: number;
    totalJournals: number;
    mostActiveperiod: string;
  };
}
```

**Examples:**
```typescript
// Basic timeline for today
await context_timeline({
  groupBy: "hour"
});

// Detailed timeline with items
await context_timeline({
  startDate: "2025-01-20T00:00:00Z",
  endDate: "2025-01-26T23:59:59Z",
  groupBy: "day",
  includeItems: true,
  categories: ["task", "progress"],
  itemsPerPeriod: 10
});

// Timeline with relative times
await context_timeline({
  groupBy: "hour",
  relativeTime: true,
  includeItems: true
});
```

### context_compress

Compress old context to save space.

**Parameters:**
```typescript
{
  olderThan: string;       // ISO date cutoff
  preserveCategories?: string[]; // Categories to keep
  targetSize?: number;     // Target KB (optional)
  sessionId?: string;      // Specific session
}
```

**Returns:**
```typescript
{
  compressed: {
    items: number;         // Items compressed
    originalSize: number;  // Original KB
    compressedSize: number; // Compressed KB
    ratio: number;         // Compression ratio
  };
  preserved: number;       // Items preserved
  deleted: number;         // Items deleted
  summary: {
    byCategory: Record<string, number>;
    dateRange: {
      start: string;
      end: string;
    };
  };
}
```

### context_integrate_tool

Record events from other MCP tools.

**Parameters:**
```typescript
{
  toolName: string;        // Tool identifier
  eventType: string;       // Event type
  data: any;               // Event data
  important?: boolean;     // Create context item
}
```

**Returns:**
```typescript
{
  eventId: string;         // Event ID
  createdAt: string;       // Timestamp
  contextItemId?: string;  // If important=true
}
```

## Error Handling

All tools follow consistent error handling:

**Error Response:**
```typescript
{
  error: {
    code: string;          // Error code
    message: string;       // Human-readable message
    details?: any;         // Additional details
  }
}
```

**Common Error Codes:**
- `INVALID_PARAMS`: Invalid or missing parameters
- `SESSION_NOT_FOUND`: Session does not exist
- `ITEM_NOT_FOUND`: Context item not found
- `FILE_NOT_FOUND`: File does not exist
- `DATABASE_ERROR`: Database operation failed
- `PARSE_ERROR`: Failed to parse data
- `PERMISSION_ERROR`: Insufficient permissions
- `STORAGE_FULL`: Database storage limit reached

**Example Error Handling:**
```typescript
try {
  const result = await context_save({
    key: "example",
    value: "test"
  });
} catch (error) {
  if (error.code === 'STORAGE_FULL') {
    // Compress old data
    await context_compress({
      olderThan: '30 days ago'
    });
    // Retry
  }
}
```

## Best Practices

1. **Session Management**: Start a new session for each major task or feature
2. **Categories**: Use consistent categories for better organization
3. **Priorities**: Reserve 'critical' for truly important items
4. **Keys**: Use descriptive, searchable keys
5. **Metadata**: Store structured data in metadata field
6. **Checkpoints**: Create checkpoints before major changes
7. **Compression**: Regularly compress old data to maintain performance
8. **Search**: Use semantic search for natural language queries

## Performance Tips

1. **Batch Operations**: Use single calls with multiple items when possible
2. **Selective Loading**: Use filters to load only needed context
3. **Regular Cleanup**: Compress or export old sessions
4. **Indexed Searches**: Search by key is faster than full-text
5. **Limit Results**: Always specify reasonable limits

## Pre-built Query Library

Common queries optimized for performance:

### Development Queries
```typescript
// Recent high-priority tasks
{
  category: "task",
  priority: "high",
  limit: 10
}

// Today's decisions
{
  category: "decision",
  afterDate: new Date().toISOString().split('T')[0]
}

// Recent errors with context
{
  category: "error",
  limit: 20,
  includeMetadata: true
}
```

### Analysis Queries
```typescript
// Find related code changes
await context_semantic_search({
  query: "authentication refactor",
  minSimilarity: 0.7,
  categories: ["task", "decision"]
});

// Track feature progress
await context_search({
  query: "feature:user-management status:*",
  searchIn: ["value"],
  categories: ["progress"]
});
```

### Team Queries
```typescript
// Blockers and impediments
{
  query: "blocked OR waiting OR impediment",
  categories: ["task", "warning"],
  priority: "high"
}

// Recent decisions by area
{
  category: "decision",
  query: "area:frontend OR area:backend",
  groupBy: "metadata.area"
}
```

### Performance Queries
```typescript
// Slow operations
{
  query: "duration:>1000ms",
  categories: ["progress"],
  sortBy: "metadata.duration",
  order: "desc"
}

// Memory usage patterns
{
  query: "memory usage",
  categories: ["progress", "warning"],
  timeRange: "-7d"
}
```

---

For more examples and patterns, see [RECIPES.md](./RECIPES.md)