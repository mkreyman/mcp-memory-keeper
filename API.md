# MCP Memory Keeper - API Reference

## Table of Contents
- [Session Management](#session-management)
- [Context Storage](#context-storage)
- [Channel Management](#channel-management)
- [Batch Operations](#batch-operations)
- [Context Relationships](#context-relationships)
- [File Management](#file-management)
- [Checkpoints](#checkpoints)
- [Real-time Monitoring](#real-time-monitoring)
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

## Channel Management

### context_list_channels

List all channels across sessions with comprehensive statistics and insights.

**Parameters:**
```typescript
{
  sessionId?: string;      // Filter by specific session (default: all sessions)
  includeEmpty?: boolean;  // Include channels with zero items (default: false)
  sort?: 'name' | 'item_count' | 'last_activity'; // Sort order (default: 'name')
  limit?: number;          // Maximum channels to return
  offset?: number;         // Pagination offset
}
```

**Returns:**
```typescript
{
  channels: Array<{
    channel: string;       // Channel name
    itemCount: number;     // Total items in this channel
    sessions: number;      // Number of sessions using this channel
    lastActivity: string;  // ISO timestamp of most recent activity
    categories: Record<string, number>; // Item count by category
    priorities: Record<string, number>; // Item count by priority
  }>;
  totalChannels: number;   // Total number of channels found
  stats: {
    totalItems: number;    // Total items across all channels
    averageItemsPerChannel: number;
    mostActiveChannel: string;
    leastActiveChannel: string;
  };
}
```

**Examples:**
```typescript
// List all active channels
await context_list_channels();

// List channels for current session only
await context_list_channels({
  sessionId: "current"
});

// Get top 10 most active channels
await context_list_channels({
  sort: "item_count",
  limit: 10
});

// Include empty channels for cleanup
await context_list_channels({
  includeEmpty: true,
  sort: "last_activity"
});
```

**Use Cases:**
1. **Channel Discovery**: Find all channels being used across your project
2. **Activity Monitoring**: Identify most/least active channels
3. **Organization Review**: See how work is distributed across channels
4. **Cleanup**: Find empty or abandoned channels
5. **Team Coordination**: Understand channel usage patterns across sessions

### context_channel_stats

Get detailed statistics and insights for a specific channel.

**Parameters:**
```typescript
{
  channel: string;         // Channel name (required)
  sessionId?: string;      // Filter by specific session (default: all sessions)
  includeInsights?: boolean; // Generate AI-friendly insights (default: true)
  timeRange?: {           // Optional time range for analysis
    start?: string;       // ISO timestamp
    end?: string;         // ISO timestamp
  };
}
```

**Returns:**
```typescript
{
  channel: string;         // Channel name
  stats: {
    totalItems: number;    // Total items in channel
    totalSessions: number; // Sessions using this channel
    privateItems: number;  // Number of private items
    publicItems: number;   // Number of public items
    
    byCategory: Record<string, number>;  // Item distribution by category
    byPriority: Record<string, number>;  // Item distribution by priority
    bySession: Array<{     // Per-session breakdown
      sessionId: string;
      sessionName: string;
      itemCount: number;
      lastActivity: string;
    }>;
    
    activity: {
      firstItem: string;   // ISO timestamp of first item
      lastItem: string;    // ISO timestamp of last item
      durationDays: number; // Days between first and last item
      averageItemsPerDay: number;
      activityTrend: 'increasing' | 'stable' | 'decreasing';
    };
    
    topKeys: Array<{       // Most common keys
      key: string;
      count: number;
    }>;
    
    sizeMetrics: {         // Storage metrics
      totalSize: number;   // Total size in bytes
      averageSize: number; // Average item size
      largestItem: {
        key: string;
        size: number;
      };
    };
  };
  
  insights?: {             // When includeInsights: true
    summary: string;       // Natural language summary
    patterns: string[];    // Identified patterns
    recommendations: string[]; // Suggested actions
    relatedChannels: string[]; // Channels with similar content
  };
}
```

**Examples:**
```typescript
// Get comprehensive stats for a channel
await context_channel_stats({
  channel: "feature-auth"
});

// Focus on recent activity
await context_channel_stats({
  channel: "debugging",
  timeRange: {
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // Last 7 days
  }
});

// Get stats without AI insights (faster)
await context_channel_stats({
  channel: "feature-payments",
  includeInsights: false
});

// Session-specific channel stats
await context_channel_stats({
  channel: "main",
  sessionId: "current"
});
```

**Use Cases:**
1. **Progress Tracking**: Monitor activity and trends in feature channels
2. **Resource Planning**: Identify channels consuming most storage
3. **Quality Analysis**: Review priority and category distributions
4. **Team Insights**: Understand how different sessions contribute to a channel
5. **Decision Making**: Use AI insights to guide channel organization

**Error Scenarios:**
- `CHANNEL_NOT_FOUND`: Specified channel does not exist
- `INVALID_PARAMS`: Missing required channel parameter
- `DATABASE_ERROR`: Database read error during analysis

**Performance Considerations:**
- Channel stats are computed in real-time from the database
- For large channels (>1000 items), consider using `includeInsights: false` for faster response
- Results are not cached, so repeated calls will re-compute statistics
- Time range filtering can significantly improve performance for historical channels

**Best Practices:**
1. **Regular Monitoring**: Check channel stats periodically to maintain organization
2. **Channel Naming**: Use consistent, descriptive channel names (e.g., "feature-{name}", "bugfix-{id}")
3. **Privacy Boundaries**: Remember that private items are only visible in their creating session
4. **Cleanup Strategy**: Use stats to identify channels ready for archival or deletion
5. **Team Coordination**: Share channel stats to align team understanding

### context_reassign_channel

Move context items between channels based on keys, patterns, or entire channels. This is useful for reorganizing work when branches are renamed, features are merged, or you need to consolidate related items.

**Parameters:**
```typescript
{
  toChannel: string;         // Target channel to move items to (required)
  keys?: string[];           // Specific keys to reassign
  keyPattern?: string;       // Pattern to match keys (supports wildcards: *, ?)
  fromChannel?: string;      // Source channel to move all items from
  category?: 'task' | 'decision' | 'progress' | 'note' | 'error' | 'warning';
  priorities?: ('high' | 'normal' | 'low')[];
  sessionId?: string;        // Session ID (defaults to current)
  dryRun?: boolean;          // Preview changes without applying them (default: false)
}
```

**Returns:**
```typescript
{
  success: boolean;
  movedCount: number;        // Number of items moved
  items: Array<{             // Details of moved items (or items that would be moved if dryRun)
    id: string;
    key: string;
    fromChannel: string;
    toChannel: string;
  }>;
}
```

**Examples:**
```typescript
// Move specific items to a new channel
await context_reassign_channel({
  keys: ["auth_config", "auth_tokens", "auth_middleware"],
  toChannel: "feature-authentication"
});

// Move all items matching a pattern
await context_reassign_channel({
  keyPattern: "test_*",
  toChannel: "testing"
});

// Move entire channel contents
await context_reassign_channel({
  fromChannel: "feature-old-auth",
  toChannel: "feature-new-auth"
});

// Move high-priority tasks only
await context_reassign_channel({
  fromChannel: "backlog",
  toChannel: "sprint-15",
  category: "task",
  priorities: ["high"]
});

// Preview changes before applying
const preview = await context_reassign_channel({
  keyPattern: "legacy_*",
  toChannel: "archive",
  dryRun: true
});
console.log(`Would move ${preview.movedCount} items`);
```

**Use Cases:**
1. **Branch Renaming**: When git branches are renamed, move all items to match
2. **Feature Consolidation**: Merge items from multiple feature branches
3. **Sprint Planning**: Move high-priority items to current sprint channel
4. **Cleanup**: Move completed or obsolete items to archive channels
5. **Team Handoffs**: Reassign work items between team channels

**Best Practices:**
1. Always use `dryRun: true` first to preview large moves
2. Create the target channel through normal saves if it doesn't exist
3. Use specific filters (category, priority) to avoid moving unintended items
4. Document channel moves in your team's workflow

## Batch Operations

### context_batch_save

Save multiple context items in a single atomic operation. This ensures all items are saved together or none are saved, maintaining data consistency.

**Parameters:**
```typescript
{
  items: Array<{
    key: string;             // Unique key for the context item
    value: string;           // Context value to save
    category?: 'task' | 'decision' | 'progress' | 'note' | 'error' | 'warning';
    priority?: 'high' | 'normal' | 'low';
    channel?: string;        // Channel to organize this item
  }>;
  updateExisting?: boolean;  // Update existing items with same key (default: true)
}
```

**Returns:**
```typescript
{
  success: boolean;
  savedCount: number;        // Number of items saved
  updatedCount: number;      // Number of existing items updated
  items: Array<{             // Details of saved items
    id: string;
    key: string;
    isNew: boolean;          // true if newly created, false if updated
  }>;
}
```

**Examples:**
```typescript
// Save multiple related configuration items
await context_batch_save({
  items: [
    { key: "db_host", value: "localhost", category: "note" },
    { key: "db_port", value: "5432", category: "note" },
    { key: "db_name", value: "myapp", category: "note" },
    { key: "db_pool_size", value: "10", category: "note" }
  ]
});

// Import task list with priorities
const tasks = [
  { key: "task_auth", value: "Implement OAuth2", priority: "high", category: "task" },
  { key: "task_tests", value: "Add integration tests", priority: "normal", category: "task" },
  { key: "task_docs", value: "Update API docs", priority: "low", category: "task" }
];
await context_batch_save({ items: tasks });

// Save items to specific channel
await context_batch_save({
  items: [
    { key: "sprint_15_goal", value: "Complete user management", channel: "sprint-15" },
    { key: "sprint_15_capacity", value: "40 story points", channel: "sprint-15" },
    { key: "sprint_15_risks", value: "Backend API delays", channel: "sprint-15" }
  ]
});
```

**Use Cases:**
1. **Bulk Import**: Import configuration, tasks, or notes from external sources
2. **Atomic Updates**: Ensure related items are saved together
3. **Template Application**: Apply predefined sets of context items
4. **Migration**: Move data between systems while maintaining consistency

### context_batch_delete

Delete multiple context items by keys or pattern in a single atomic operation.

**Parameters:**
```typescript
{
  keys?: string[];           // Array of specific keys to delete
  keyPattern?: string;       // Pattern to match keys for deletion (supports wildcards: *, ?)
  sessionId?: string;        // Session ID (defaults to current)
  dryRun?: boolean;          // Preview items to be deleted without actually deleting (default: false)
}
```

**Returns:**
```typescript
{
  success: boolean;
  deletedCount: number;      // Number of items deleted
  items: Array<{             // Details of deleted items (or items that would be deleted if dryRun)
    id: string;
    key: string;
    value: string;           // Included in dryRun to help identify items
  }>;
}
```

**Examples:**
```typescript
// Delete specific items
await context_batch_delete({
  keys: ["temp_file_1", "temp_file_2", "temp_cache"]
});

// Delete all items matching pattern
await context_batch_delete({
  keyPattern: "test_*"
});

// Preview deletion
const preview = await context_batch_delete({
  keyPattern: "old_*",
  dryRun: true
});
console.log(`Would delete ${preview.deletedCount} items`);

// Clean up session-specific temporary items
await context_batch_delete({
  keyPattern: "tmp_*",
  sessionId: "specific-session-id"
});
```

**Use Cases:**
1. **Cleanup**: Remove temporary or obsolete items
2. **Reset**: Clear specific categories of data
3. **Testing**: Clean up test data after test runs
4. **Maintenance**: Remove old or unused context items

### context_batch_update

Update multiple context items with partial updates in a single atomic operation. Only specified fields are updated; others remain unchanged.

**Parameters:**
```typescript
{
  updates: Array<{
    key: string;             // Key of the item to update (required)
    value?: string;          // New value (optional)
    category?: 'task' | 'decision' | 'progress' | 'note' | 'error' | 'warning';
    priority?: 'high' | 'normal' | 'low';
    channel?: string;        // New channel (optional)
  }>;
  sessionId?: string;        // Session ID (defaults to current)
}
```

**Returns:**
```typescript
{
  success: boolean;
  updatedCount: number;      // Number of items updated
  failedCount: number;       // Number of items that couldn't be updated
  results: Array<{           // Details of update results
    key: string;
    success: boolean;
    error?: string;          // Error message if update failed
    changes?: {              // What was changed
      value?: boolean;
      category?: boolean;
      priority?: boolean;
      channel?: boolean;
    };
  }>;
}
```

**Examples:**
```typescript
// Update priorities for multiple tasks
await context_batch_update({
  updates: [
    { key: "task_auth", priority: "high" },
    { key: "task_ui", priority: "high" },
    { key: "task_docs", priority: "low" }
  ]
});

// Move items to new channel and update category
await context_batch_update({
  updates: [
    { key: "decision_1", channel: "archived", category: "note" },
    { key: "decision_2", channel: "archived", category: "note" },
    { key: "decision_3", channel: "archived", category: "note" }
  ]
});

// Update values while keeping other fields
await context_batch_update({
  updates: [
    { key: "config_timeout", value: "30000" },
    { key: "config_retries", value: "5" },
    { key: "config_batch_size", value: "100" }
  ]
});
```

**Use Cases:**
1. **Bulk Status Updates**: Update multiple task statuses or priorities
2. **Reorganization**: Move groups of items to different channels
3. **Metadata Updates**: Update categories or priorities in bulk
4. **Configuration Changes**: Update multiple configuration values

**Best Practices for Batch Operations:**
1. Use transactions to ensure atomicity - all operations succeed or all fail
2. Always validate data before batch operations
3. Use `dryRun` for delete operations to preview effects
4. Consider performance impact for large batches (>1000 items)
5. Log batch operations for audit trails

## Context Relationships

### context_link

Create a relationship between two context items. This enables building a graph of related items for better organization and discovery.

**Parameters:**
```typescript
{
  sourceKey: string;         // Key of the source context item
  targetKey: string;         // Key of the target context item
  relationship: string;      // Type of relationship (see enum below)
  metadata?: object;         // Optional metadata for the relationship
}
```

**Relationship Types:**
- `contains` - Source contains target (e.g., epic contains task)
- `depends_on` - Source depends on target
- `references` - Source references target
- `implements` - Source implements target
- `extends` - Source extends target
- `related_to` - General relationship
- `blocks` - Source blocks target
- `blocked_by` - Source is blocked by target
- `parent_of` - Source is parent of target
- `child_of` - Source is child of target
- `has_task` - Source has associated task
- `documented_in` - Source is documented in target
- `serves` - Source serves target
- `leads_to` - Source leads to target

**Returns:**
```typescript
{
  success: boolean;
  relationshipId: string;    // Unique ID for the relationship
  source: {
    key: string;
    exists: boolean;         // Whether source item exists
  };
  target: {
    key: string;
    exists: boolean;         // Whether target item exists
  };
}
```

**Examples:**
```typescript
// Link epic to its tasks
await context_link({
  sourceKey: "epic_user_management",
  targetKey: "task_create_user_api",
  relationship: "contains"
});

// Document dependencies
await context_link({
  sourceKey: "service_auth",
  targetKey: "service_database",
  relationship: "depends_on",
  metadata: { critical: true, version: "1.0" }
});

// Track blocking relationships
await context_link({
  sourceKey: "task_frontend_integration",
  targetKey: "task_api_completion",
  relationship: "blocked_by"
});

// Reference documentation
await context_link({
  sourceKey: "feature_oauth",
  targetKey: "doc_oauth_setup",
  relationship: "documented_in"
});
```

### context_get_related

Get items related to a given context item, with support for multi-level traversal and filtering.

**Parameters:**
```typescript
{
  key: string;               // Key of the context item to find relationships for
  relationship?: string;     // Filter by specific relationship type
  depth?: number;            // Traversal depth for multi-level relationships (default: 1)
  direction?: 'outgoing' | 'incoming' | 'both'; // Direction of relationships (default: 'both')
}
```

**Returns:**
```typescript
{
  items: Array<{
    key: string;
    value: string;
    category?: string;
    priority: string;
    relationship: string;    // How this item is related
    direction: 'outgoing' | 'incoming';
    distance: number;        // How many hops from source (1 = direct)
    path: string[];          // Path of keys from source to this item
    metadata?: object;       // Relationship metadata
  }>;
  totalCount: number;
  graph: {                   // Summary of the relationship graph
    nodes: number;           // Total unique items in graph
    edges: number;           // Total relationships
    maxDepth: number;        // Deepest connection found
  };
}
```

**Examples:**
```typescript
// Get all directly related items
const related = await context_get_related({
  key: "epic_user_management"
});

// Get only dependencies
const deps = await context_get_related({
  key: "service_api",
  relationship: "depends_on",
  direction: "outgoing"
});

// Find what blocks a task (incoming "blocks" = outgoing "blocked_by")
const blockers = await context_get_related({
  key: "task_deploy",
  relationship: "blocked_by",
  direction: "outgoing"
});

// Traverse multiple levels to find all connected items
const fullGraph = await context_get_related({
  key: "feature_auth",
  depth: 3,
  direction: "both"
});
```

**Use Cases:**
1. **Dependency Analysis**: Understand what a component depends on
2. **Impact Assessment**: Find all items affected by a change
3. **Task Management**: Track blockers and dependencies
4. **Documentation Discovery**: Find related docs and examples
5. **Feature Mapping**: Understand all components of a feature

**Best Practices:**
1. Use specific relationship types for clearer organization
2. Limit depth for large graphs to avoid performance issues
3. Add metadata to relationships for richer context
4. Regularly review and update relationships
5. Use bidirectional relationships thoughtfully (blocks/blocked_by)

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

Restore context from a checkpoint by creating a new session with the checkpoint data.

**Important**: This operation creates a NEW session to preserve data safety. Your current session and all its data remain accessible.

**Parameters:**
```typescript
{
  name?: string;           // Checkpoint name (latest if not specified)
  checkpointId?: string;   // Specific checkpoint ID
  restoreFiles?: boolean;  // Restore file cache (default: true)
}
```

**Returns:**
Enhanced user-friendly message explaining:
- New session creation for data safety
- How to access your previous work
- Session switching guidance
- Data recovery instructions

**Behavior:**
1. Creates a new session named "Restored from: {checkpoint-name}"
2. Copies all checkpoint data to the new session
3. Switches you to the new session
4. Preserves your original session completely
5. Provides clear guidance for session management

**Example Response:**
```
✅ Successfully restored from checkpoint: My Checkpoint

🔄 Data Safety: A new session was created to preserve your current work
📋 New Session: 1a2b3c4d ("Restored from: My Checkpoint")
🔙 Original Session: Working Session remains accessible

📊 Restored Data:
- Context items: 15
- Files: 3
- Git branch: main
- Checkpoint created: 2024-01-15T10:30:00Z

💡 Next Steps:
- You are now working in the restored session
- Your previous work is safely preserved in session 2
- Use context_session_list to see all sessions
- Switch sessions anytime without losing data

🆘 Need your previous work? Use context_search_all to find items across sessions
```

## Real-time Monitoring

### context_watch

Create, manage, and poll real-time watchers for context changes. This powerful feature enables real-time monitoring of context items based on flexible filters.

#### Actions

##### create
Create a new watcher with filters for real-time monitoring.

**Parameters:**
```typescript
{
  action: 'create';
  filters?: {
    keys?: string[];         // Specific keys to watch (supports wildcards: "user_*", "*_config")
    categories?: ('task' | 'decision' | 'progress' | 'note' | 'warning' | 'error')[];
    channels?: string[];     // Specific channels to monitor
    priorities?: ('critical' | 'high' | 'normal' | 'low')[];
    sessionIds?: string[];   // Specific sessions (default: current session only)
  };
  includeExisting?: boolean; // Include existing items in first poll (default: false)
  expiresIn?: number;        // Expiration time in seconds (default: 3600)
}
```

**Returns:**
```typescript
{
  watcherId: string;         // Unique watcher identifier
  filters: {                 // Applied filters
    keys?: string[];
    categories?: string[];
    channels?: string[];
    priorities?: string[];
    sessionIds?: string[];
  };
  createdAt: string;         // ISO timestamp
  expiresAt: string;         // ISO timestamp when watcher expires
  lastSequence: number;      // Starting sequence number
}
```

##### poll
Poll for changes since last check. Returns only new or updated items.

**Parameters:**
```typescript
{
  action: 'poll';
  watcherId: string;         // Watcher ID from create action
  timeout?: number;          // Long-polling timeout in seconds (default: 0 - immediate return)
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
    priority: string;
    channel: string;
    sessionId: string;
    createdAt: string;
    updatedAt?: string;
    changeType: 'added' | 'updated';  // Type of change
  }>;
  lastSequence: number;      // Updated sequence number
  hasMore: boolean;          // If more changes are available
  metadata: {
    pollTime: string;        // ISO timestamp of poll
    itemCount: number;       // Number of items returned
    expired: boolean;        // If watcher has expired
  };
}
```

##### stop
Stop and remove a watcher.

**Parameters:**
```typescript
{
  action: 'stop';
  watcherId: string;         // Watcher ID to stop
}
```

**Returns:**
```typescript
{
  success: boolean;
  watcherId: string;
  itemsDelivered: number;    // Total items delivered by this watcher
  duration: number;          // How long watcher was active (seconds)
}
```

##### list
List all active watchers for the current session.

**Parameters:**
```typescript
{
  action: 'list';
  includeExpired?: boolean;  // Include expired watchers (default: false)
}
```

**Returns:**
```typescript
{
  watchers: Array<{
    watcherId: string;
    filters: {
      keys?: string[];
      categories?: string[];
      channels?: string[];
      priorities?: string[];
      sessionIds?: string[];
    };
    createdAt: string;
    expiresAt: string;
    lastPoll?: string;       // Last poll timestamp
    lastSequence: number;
    itemsDelivered: number;  // Total items delivered
    active: boolean;         // If watcher is still active
  }>;
  total: number;
}
```

#### Examples

**Basic Monitoring:**
```typescript
// Watch for high-priority tasks
const watcher = await context_watch({
  action: 'create',
  filters: {
    categories: ['task'],
    priorities: ['high', 'critical']
  }
});

// Poll for changes
const changes = await context_watch({
  action: 'poll',
  watcherId: watcher.watcherId
});

if (changes.items.length > 0) {
  console.log(`${changes.items.length} new high-priority tasks`);
}
```

**Wildcard Key Monitoring:**
```typescript
// Watch for all user-related and config changes
const watcher = await context_watch({
  action: 'create',
  filters: {
    keys: ['user_*', '*_config', 'auth_*']
  },
  includeExisting: true  // Get current state first
});
```

**Channel-specific Monitoring:**
```typescript
// Monitor specific feature channels
const watcher = await context_watch({
  action: 'create',
  filters: {
    channels: ['feature-auth', 'feature-payments'],
    categories: ['error', 'warning']
  },
  expiresIn: 7200  // 2-hour expiration
});
```

**Long Polling:**
```typescript
// Wait up to 30 seconds for changes
const changes = await context_watch({
  action: 'poll',
  watcherId: watcher.watcherId,
  timeout: 30  // Wait up to 30 seconds
});
```

**Multi-session Monitoring:**
```typescript
// Watch across multiple sessions
const watcher = await context_watch({
  action: 'create',
  filters: {
    sessionIds: ['session-1', 'session-2', 'current'],
    categories: ['decision']
  }
});
```

**Continuous Monitoring Loop:**
```typescript
// Create watcher
const watcher = await context_watch({
  action: 'create',
  filters: { categories: ['error', 'warning'] }
});

// Monitoring loop
let running = true;
while (running) {
  try {
    const changes = await context_watch({
      action: 'poll',
      watcherId: watcher.watcherId,
      timeout: 30  // Long poll
    });
    
    for (const item of changes.items) {
      console.log(`[${item.changeType}] ${item.category}: ${item.key}`);
      // Process changes...
    }
    
    if (changes.metadata.expired) {
      console.log('Watcher expired');
      running = false;
    }
  } catch (error) {
    console.error('Poll error:', error);
    await new Promise(r => setTimeout(r, 5000));  // Wait 5s on error
  }
}

// Cleanup
await context_watch({
  action: 'stop',
  watcherId: watcher.watcherId
});
```

**Managing Multiple Watchers:**
```typescript
// List all active watchers
const { watchers } = await context_watch({ action: 'list' });

console.log(`Active watchers: ${watchers.length}`);
for (const w of watchers) {
  console.log(`- ${w.watcherId}: ${w.itemsDelivered} items delivered`);
  if (w.filters.categories) {
    console.log(`  Categories: ${w.filters.categories.join(', ')}`);
  }
}

// Stop all watchers
for (const w of watchers) {
  await context_watch({
    action: 'stop',
    watcherId: w.watcherId
  });
}
```

#### Use Cases

1. **Error Monitoring**: Watch for errors and warnings in real-time
2. **Task Tracking**: Monitor new high-priority tasks across team sessions
3. **Configuration Changes**: Track when configuration items are modified
4. **Progress Updates**: Follow progress on specific features or tasks
5. **Decision Tracking**: Monitor important decisions as they're made
6. **Multi-Agent Coordination**: Watch for updates from other AI agents
7. **Debugging**: Monitor specific keys during debugging sessions
8. **Audit Trail**: Track all changes in critical channels

#### Best Practices

1. **Filter Specificity**: Use specific filters to reduce unnecessary polling overhead
2. **Expiration Management**: Set appropriate expiration times based on use case
3. **Error Handling**: Always handle expired watchers and network errors
4. **Cleanup**: Stop watchers when no longer needed to free resources
5. **Polling Strategy**: Use long-polling for real-time needs, short intervals for batch processing
6. **Wildcard Usage**: Use wildcards thoughtfully to balance coverage and performance
7. **Session Scope**: Remember watchers are session-specific by default

#### Performance Considerations

- Watchers use sequence-based tracking for efficient change detection
- Each poll only returns changes since the last sequence number
- Long-polling reduces request overhead for real-time monitoring
- Expired watchers are automatically cleaned up
- Maximum 100 watchers per session (configurable)
- Wildcard matching is performed server-side for efficiency

#### Error Scenarios

- `WATCHER_NOT_FOUND`: Invalid or expired watcher ID
- `INVALID_ACTION`: Unknown action specified
- `INVALID_FILTERS`: Invalid filter parameters
- `MAX_WATCHERS_EXCEEDED`: Too many active watchers
- `SESSION_NOT_FOUND`: Invalid session ID in filters
- `INVALID_TIMEOUT`: Timeout value out of acceptable range

#### Privacy and Security

- Watchers respect privacy boundaries: private items only visible in their creating session
- Cross-session monitoring requires explicit session IDs in filters
- Watchers automatically expire to prevent resource leaks
- Each watcher has a unique, unguessable ID
- Polling from expired watchers returns empty results

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

### context_diff

Track changes to context items since a specific point in time. Useful for understanding what has been added, modified, or deleted.

**Parameters:**
```typescript
{
  since: string;           // Required: ISO timestamp, checkpoint name/ID, or relative time (e.g., "2 hours ago")
  sessionId?: string;      // Session to analyze (default: current)
  category?: string;       // Filter by category
  channel?: string;        // Filter by single channel
  channels?: string[];     // Filter by multiple channels
  includeValues?: boolean; // Include full item values (default: true)
  limit?: number;          // Maximum items per category
  offset?: number;         // Pagination offset
}
```

**Returns:**
```typescript
{
  added: Array<{
    key: string;
    value?: string;        // if includeValues is true
    category?: string;
    priority: string;
    channel: string;
    created_at: string;
  }>;
  modified: Array<{
    key: string;
    value?: string;        // if includeValues is true
    category?: string;
    priority: string;
    channel: string;
    updated_at: string;
  }>;
  deleted: string[];       // Array of deleted keys (only available with checkpoint comparison)
  summary: string;         // e.g., "5 added, 3 modified, 2 deleted"
  period: {
    from: string;          // ISO timestamp
    to: string;            // ISO timestamp (current time)
  };
}
```

**Examples:**
```typescript
// Compare with checkpoint
await context_diff({ since: "my-checkpoint" });

// Compare with timestamp
await context_diff({ since: "2024-01-01T00:00:00Z" });

// Compare with relative time
await context_diff({ 
  since: "2 hours ago",
  channel: "feature-branch"
});

// Get summary without values
await context_diff({
  since: "yesterday",
  includeValues: false,
  category: "task"
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

Export context data to a JSON file with enhanced validation and statistics.

**Parameters:**
```typescript
{
  sessionId?: string;      // Session to export (default: current)
  sessionIds?: string[];   // Multiple sessions to export
  format?: 'json' | 'csv'; // Export format (default: json)
  outputPath?: string;     // Custom output path
  includeMetadata?: boolean; // Include system metadata
  confirmEmpty?: boolean;  // Bypass empty export warning (default: false) [NEW v0.11.0]
  includeStats?: boolean;  // Include detailed statistics (default: false) [NEW v0.11.0]
}
```

**Returns (Standard):**
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

**Returns (With includeStats=true):**
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
  detailedStats: {         // Additional statistics [NEW v0.11.0]
    byCategory: Record<string, number>;     // Item count by category
    byPriority: Record<string, number>;     // Item count by priority
    byChannel: Record<string, number>;      // Item count by channel
    dateRange: {
      earliest: string;    // ISO timestamp of earliest item
      latest: string;      // ISO timestamp of latest item
    };
    averageItemSize: number;  // Average item size in bytes
    totalValueSize: number;   // Total size of all item values
  };
}
```

**Error Scenarios:**
- `EMPTY_EXPORT`: Attempted to export with no data (unless confirmEmpty=true)
- `NO_SESSION`: No active session and no sessionId provided
- `SESSION_NOT_FOUND`: Specified session does not exist
- `INVALID_FORMAT`: Unsupported export format
- `FILE_WRITE_ERROR`: Failed to write export file
- `DATABASE_ERROR`: Database read error during export

**Examples:**
```typescript
// Basic export of current session
await context_export();

// Export with detailed statistics
await context_export({
  includeStats: true
});

// Export multiple sessions
await context_export({
  sessionIds: ["session-1", "session-2"],
  outputPath: "./exports/multi-session-backup.json",
  includeStats: true
});

// Force export even if empty
await context_export({
  confirmEmpty: true  // No warning for empty exports
});

// Handle empty export scenario
try {
  await context_export();
} catch (error) {
  if (error.code === 'EMPTY_EXPORT') {
    console.log("No data to export. Use confirmEmpty:true to bypass.");
    // Either add some data or confirm empty export
    await context_export({ confirmEmpty: true });
  }
}
```

**Best Practices:**
1. **Regular Backups**: Export important sessions regularly
2. **Include Statistics**: Use `includeStats:true` for export verification
3. **Check Empty Exports**: Handle EMPTY_EXPORT errors appropriately
4. **Archive Old Sessions**: Export and compress old sessions to save space
5. **Version Control**: Consider adding exports to version control for team sharing

**Backward Compatibility:**
- The `confirmEmpty` and `includeStats` parameters are optional
- Existing code will continue to work without changes
- Empty exports will show a warning but can be bypassed with `confirmEmpty:true`

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