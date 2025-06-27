# MCP Memory Keeper - Comprehensive Live Testing Plan

## Table of Contents
1. [Testing Overview](#testing-overview)
2. [Pre-Test Setup](#pre-test-setup)
3. [Core Functionality Tests](#core-functionality-tests)
4. [Advanced Feature Tests](#advanced-feature-tests)
5. [Integration Tests](#integration-tests)
6. [Edge Case Tests](#edge-case-tests)
7. [Performance & Stress Tests](#performance--stress-tests)
8. [Multi-Session Tests](#multi-session-tests)
9. [Bug Tracking System](#bug-tracking-system)
10. [Test Execution Tracking](#test-execution-tracking)

## Testing Overview

### Scope
This plan covers live testing of all 40+ tools in the MCP Memory Keeper system, including:
- Session management (5 tools)
- Context storage & retrieval (8 tools)
- Channel management (3 tools)
- Batch operations (4 tools)
- Context relationships (2 tools)
- File management (2 tools)
- Checkpoints (2 tools)
- Real-time monitoring (1 tool)
- Search & analysis (5 tools)
- Export/Import (2 tools)
- Knowledge graph (3 tools)
- Semantic search (1 tool)
- Multi-agent system (1 tool)
- Advanced features (5 tools)

### Success Criteria
- All tools execute without errors
- Data persists correctly between sessions
- Performance meets acceptable thresholds
- Edge cases handled gracefully
- Multi-session collaboration works
- No data loss scenarios

### Test Environment Requirements
- Claude Code with MCP Memory Keeper installed
- Sufficient disk space (>1GB)
- Git repository (optional, for git-integrated features)
- Multiple Claude Code sessions for multi-session tests

## Pre-Test Setup

### 1. Clean Environment Setup
```javascript
// Check if any existing database exists
// If so, backup and remove for clean testing
// Location: ./context.db

// Start fresh
mcp__memory-keeper__context_session_start({
  "name": "Test Suite Session",
  "description": "Comprehensive testing of Memory Keeper v0.11.0"
})

// Verify clean state
mcp__memory-keeper__context_status()
// Expected: 0 items, new session
```

### 2. Test Data Preparation
```javascript
// Create test data generator
const testData = {
  tasks: [
    { key: "task_001", value: "Implement user authentication", priority: "high", category: "task" },
    { key: "task_002", value: "Add data validation", priority: "normal", category: "task" },
    { key: "task_003", value: "Write unit tests", priority: "low", category: "task" }
  ],
  decisions: [
    { key: "decision_jwt", value: "Use JWT for authentication", priority: "high", category: "decision" },
    { key: "decision_db", value: "PostgreSQL for primary database", priority: "high", category: "decision" }
  ],
  progress: [
    { key: "progress_001", value: "Completed login endpoint", category: "progress" },
    { key: "progress_002", value: "Database schema finalized", category: "progress" }
  ]
};
```

## Core Functionality Tests

### Test Suite 1: Session Management

#### Test 1.1: Basic Session Creation
```javascript
// Test: Create a new session
mcp__memory-keeper__context_session_start({
  "name": "Test Session 1",
  "description": "Testing basic session creation"
})

// Verify
mcp__memory-keeper__context_status()
// Expected: Session created with ID, name, and description
```

#### Test 1.2: Session with Project Directory
```javascript
// Test: Create session with git integration
mcp__memory-keeper__context_session_start({
  "name": "Git Integrated Session",
  "projectDir": "/path/to/git/repo",
  "description": "Testing git branch detection"
})

// Verify: Should auto-detect git branch as default channel
mcp__memory-keeper__context_status()
// Expected: defaultChannel derived from git branch
```

#### Test 1.3: Session Continuation
```javascript
// Get current session ID
const sessions = await mcp__memory-keeper__context_session_list({ "limit": 1 })
const previousId = sessions.sessions[0].id

// Test: Continue from previous session
mcp__memory-keeper__context_session_start({
  "name": "Continued Session",
  "continueFrom": previousId
})

// Verify: Should have access to previous session's items
mcp__memory-keeper__context_get({})
// Expected: Items from previous session accessible
```

#### Test 1.4: Session Listing
```javascript
// Test: List sessions with filters
mcp__memory-keeper__context_session_list({
  "limit": 5,
  "afterDate": new Date(Date.now() - 7*24*60*60*1000).toISOString()
})

// Expected: Sessions from last 7 days, max 5 results
```

#### Test 1.5: Set Project Directory
```javascript
// Test: Set project directory after session start
mcp__memory-keeper__context_set_project_dir({
  "projectDir": "/new/project/path"
})

// Verify: Project directory updated
mcp__memory-keeper__context_status()
```

### Test Suite 2: Context Storage & Retrieval

#### Test 2.1: Basic Save and Get
```javascript
// Test: Save a simple item
mcp__memory-keeper__context_save({
  "key": "test_basic",
  "value": "This is a basic test item"
})

// Verify: Retrieve the item
mcp__memory-keeper__context_get({ "key": "test_basic" })
// Expected: Exact match of saved item
```

#### Test 2.2: Save with All Parameters
```javascript
// Test: Save with full metadata
mcp__memory-keeper__context_save({
  "key": "test_full",
  "value": "Complete test with all parameters",
  "category": "task",
  "priority": "high",
  "channel": "test-channel",
  "private": false
})

// Verify all fields saved
mcp__memory-keeper__context_get({ 
  "key": "test_full",
  "includeMetadata": true 
})
```

#### Test 2.3: Private vs Public Items
```javascript
// Test: Save private item
mcp__memory-keeper__context_save({
  "key": "private_note",
  "value": "This should only be visible in current session",
  "private": true
})

// Test: Save public item
mcp__memory-keeper__context_save({
  "key": "public_note",
  "value": "This should be visible from all sessions",
  "private": false
})

// Will test visibility from another session later
```

#### Test 2.4: Advanced Get Queries
```javascript
// Test: Get with multiple filters
mcp__memory-keeper__context_get({
  "category": "task",
  "priorities": ["high", "normal"],
  "channel": "test-channel",
  "includeMetadata": true,
  "sort": "created_desc",
  "limit": 10,
  "offset": 0
})

// Test: Time-based filtering
mcp__memory-keeper__context_get({
  "createdAfter": new Date(Date.now() - 60*60*1000).toISOString(), // Last hour
  "sort": "created_desc"
})

// Test: Pattern matching
mcp__memory-keeper__context_get({
  "keyPattern": "test_.*",
  "includeMetadata": true
})
```

#### Test 2.5: Delete Operations
```javascript
// Test: Delete specific item
mcp__memory-keeper__context_delete({
  "key": "test_basic"
})

// Verify deletion
mcp__memory-keeper__context_get({ "key": "test_basic" })
// Expected: No results
```

### Test Suite 3: Channel Management

#### Test 3.1: List Channels
```javascript
// Create items in different channels
mcp__memory-keeper__context_save({
  "key": "ch1_item1",
  "value": "Channel 1 item",
  "channel": "feature-auth"
})

mcp__memory-keeper__context_save({
  "key": "ch2_item1",
  "value": "Channel 2 item",
  "channel": "feature-payments"
})

// Test: List all channels
mcp__memory-keeper__context_list_channels({
  "sort": "item_count",
  "includeEmpty": false
})
// Expected: Both channels listed with statistics
```

#### Test 3.2: Channel Statistics
```javascript
// Test: Get detailed channel stats
mcp__memory-keeper__context_channel_stats({
  "channel": "feature-auth",
  "includeInsights": true
})
// Expected: Comprehensive stats and AI insights
```

#### Test 3.3: Channel Reassignment
```javascript
// Test: Move items between channels
mcp__memory-keeper__context_reassign_channel({
  "fromChannel": "feature-auth",
  "toChannel": "archived",
  "dryRun": true  // Preview first
})

// If preview looks good, execute
mcp__memory-keeper__context_reassign_channel({
  "fromChannel": "feature-auth",
  "toChannel": "archived",
  "dryRun": false
})

// Verify move
mcp__memory-keeper__context_get({ "channel": "archived" })
```

### Test Suite 4: Batch Operations

#### Test 4.1: Batch Save
```javascript
// Test: Save multiple items atomically
mcp__memory-keeper__context_batch_save({
  "items": [
    { "key": "batch_1", "value": "First batch item", "category": "note" },
    { "key": "batch_2", "value": "Second batch item", "category": "note" },
    { "key": "batch_3", "value": "Third batch item", "category": "note" }
  ],
  "updateExisting": true
})

// Verify all saved
mcp__memory-keeper__context_get({ "keyPattern": "batch_*" })
// Expected: 3 items
```

#### Test 4.2: Batch Delete
```javascript
// Test: Preview batch deletion
mcp__memory-keeper__context_batch_delete({
  "keyPattern": "batch_*",
  "dryRun": true
})

// Execute deletion
mcp__memory-keeper__context_batch_delete({
  "keys": ["batch_1", "batch_2"]
})

// Verify selective deletion
mcp__memory-keeper__context_get({ "keyPattern": "batch_*" })
// Expected: Only batch_3 remains
```

#### Test 4.3: Batch Update
```javascript
// Test: Update multiple items
mcp__memory-keeper__context_batch_update({
  "updates": [
    { "key": "task_001", "priority": "low" },
    { "key": "task_002", "category": "progress", "value": "Task completed" }
  ]
})

// Verify updates
mcp__memory-keeper__context_get({ "keys": ["task_001", "task_002"] })
```

### Test Suite 5: Context Relationships

#### Test 5.1: Create Relationships
```javascript
// Create parent task
mcp__memory-keeper__context_save({
  "key": "epic_user_mgmt",
  "value": "User Management Epic",
  "category": "task",
  "priority": "high"
})

// Create subtasks
mcp__memory-keeper__context_save({
  "key": "task_user_crud",
  "value": "Implement CRUD operations"
})

// Test: Link them
mcp__memory-keeper__context_link({
  "sourceKey": "epic_user_mgmt",
  "targetKey": "task_user_crud",
  "relationship": "contains",
  "metadata": { "estimated_hours": 8 }
})
```

#### Test 5.2: Get Related Items
```javascript
// Test: Find related items
mcp__memory-keeper__context_get_related({
  "key": "epic_user_mgmt",
  "relationship": "contains",
  "depth": 2,
  "direction": "outgoing"
})
// Expected: All subtasks and their dependencies
```

### Test Suite 6: File Management

#### Test 6.1: Cache Files
```javascript
// Test: Cache file content
mcp__memory-keeper__context_cache_file({
  "filePath": "/path/to/test.js",
  "content": "console.log('test file content');"
})

// Verify caching
mcp__memory-keeper__context_file_changed({
  "filePath": "/path/to/test.js",
  "currentContent": "console.log('test file content');"
})
// Expected: changed = false
```

#### Test 6.2: Detect File Changes
```javascript
// Test: Check with modified content
mcp__memory-keeper__context_file_changed({
  "filePath": "/path/to/test.js",
  "currentContent": "console.log('modified content');"
})
// Expected: changed = true
```

### Test Suite 7: Checkpoints

#### Test 7.1: Create Checkpoint
```javascript
// Test: Create comprehensive checkpoint
mcp__memory-keeper__context_checkpoint({
  "name": "test-checkpoint-1",
  "description": "Testing checkpoint functionality",
  "includeFiles": true,
  "includeGitStatus": true
})
// Expected: Checkpoint created with all data
```

#### Test 7.2: Restore Checkpoint
```javascript
// Add more data after checkpoint
mcp__memory-keeper__context_save({
  "key": "after_checkpoint",
  "value": "This was added after checkpoint"
})

// Test: Restore to checkpoint
mcp__memory-keeper__context_restore_checkpoint({
  "name": "test-checkpoint-1",
  "restoreFiles": true,
  "merge": false
})

// Verify: after_checkpoint should not exist
mcp__memory-keeper__context_get({ "key": "after_checkpoint" })
// Expected: No results
```

## Advanced Feature Tests

### Test Suite 8: Real-time Monitoring

#### Test 8.1: Create Watcher
```javascript
// Test: Create watcher for high-priority items
const watcher = await mcp__memory-keeper__context_watch({
  "action": "create",
  "filters": {
    "categories": ["task", "error"],
    "priorities": ["high"],
    "channels": ["test-channel"]
  },
  "includeExisting": false,
  "expiresIn": 300  // 5 minutes
})

// Save watcher ID for polling
const watcherId = watcher.watcherId
```

#### Test 8.2: Poll for Changes
```javascript
// Add items that match watcher criteria
mcp__memory-keeper__context_save({
  "key": "new_high_task",
  "value": "Urgent task added",
  "category": "task",
  "priority": "high",
  "channel": "test-channel"
})

// Test: Poll for changes
mcp__memory-keeper__context_watch({
  "action": "poll",
  "watcherId": watcherId,
  "timeout": 0  // Immediate return
})
// Expected: new_high_task in results
```

#### Test 8.3: Stop Watcher
```javascript
// Test: Stop the watcher
mcp__memory-keeper__context_watch({
  "action": "stop",
  "watcherId": watcherId
})
```

### Test Suite 9: Search & Analysis

#### Test 9.1: Basic Search
```javascript
// Test: Search across all fields
mcp__memory-keeper__context_search({
  "query": "user",
  "searchIn": ["key", "value"],
  "includeMetadata": true
})
```

#### Test 9.2: Advanced Search
```javascript
// Test: Search with filters
mcp__memory-keeper__context_search({
  "query": "task",
  "category": "task",
  "priorities": ["high"],
  "relativeTime": "2 hours ago",
  "sort": "created_desc",
  "limit": 5
})
```

#### Test 9.3: Context Diff
```javascript
// Test: Compare with checkpoint
mcp__memory-keeper__context_diff({
  "since": "test-checkpoint-1",
  "includeValues": true
})

// Test: Compare with time
mcp__memory-keeper__context_diff({
  "since": "1 hour ago",
  "category": "task"
})
```

#### Test 9.4: Summarize
```javascript
// Test: Generate summary
mcp__memory-keeper__context_summarize({
  "categories": ["task", "decision"],
  "maxLength": 500
})
```

#### Test 9.5: Analyze
```javascript
// Test: Analyze context patterns
mcp__memory-keeper__context_analyze({
  "categories": ["task"],
  "maxDepth": 2
})
```

### Test Suite 10: Export/Import

#### Test 10.1: Export Data
```javascript
// Test: Export current session
mcp__memory-keeper__context_export({
  "format": "json",
  "includeMetadata": true,
  "includeStats": true
})
// Note the output file path
```

#### Test 10.2: Import Data
```javascript
// Start new session
mcp__memory-keeper__context_session_start({
  "name": "Import Test Session"
})

// Test: Import the exported data
mcp__memory-keeper__context_import({
  "filePath": "path/from/previous/export",
  "merge": false
})

// Verify import
mcp__memory-keeper__context_status()
```

### Test Suite 11: Knowledge Graph

#### Test 11.1: Find Related
```javascript
// Test: Find related entities
mcp__memory-keeper__context_find_related({
  "key": "epic_user_mgmt",
  "maxDepth": 3,
  "relationTypes": ["contains", "depends_on"]
})
```

#### Test 11.2: Visualize
```javascript
// Test: Generate graph visualization
mcp__memory-keeper__context_visualize({
  "type": "graph",
  "entityTypes": ["task", "decision"]
})

// Test: Timeline visualization
mcp__memory-keeper__context_visualize({
  "type": "timeline",
  "groupBy": "day"
})
```

### Test Suite 12: Semantic Search
```javascript
// Test: Natural language search
mcp__memory-keeper__context_semantic_search({
  "query": "What decisions were made about authentication?",
  "topK": 5,
  "minSimilarity": 0.3
})
```

### Test Suite 13: Multi-Agent System
```javascript
// Test: Delegate analysis
mcp__memory-keeper__context_delegate({
  "taskType": "analyze",
  "input": {
    "analysisType": "patterns",
    "timeframe": "-7 days"
  }
})

// Test: Chain tasks
mcp__memory-keeper__context_delegate({
  "chain": true,
  "taskType": ["analyze", "synthesize"],
  "input": [
    { "analysisType": "comprehensive" },
    { "synthesisType": "recommendations" }
  ]
})
```

### Test Suite 14: Advanced Features

#### Test 14.1: Branch Session
```javascript
// Test: Create a branch
mcp__memory-keeper__context_branch_session({
  "branchName": "experimental-feature",
  "copyDepth": "shallow"
})
```

#### Test 14.2: Merge Sessions
```javascript
// Make changes in branch
mcp__memory-keeper__context_save({
  "key": "branch_change",
  "value": "Change made in branch"
})

// Get branch session ID
const branchSession = await mcp__memory-keeper__context_status()

// Switch back to main session and merge
mcp__memory-keeper__context_merge_sessions({
  "sourceSessionId": branchSession.sessionId,
  "conflictResolution": "keep_source"
})
```

#### Test 14.3: Journal Entry
```javascript
// Test: Add journal entries
mcp__memory-keeper__context_journal_entry({
  "entry": "Started testing Memory Keeper comprehensively",
  "tags": ["testing", "qa"],
  "mood": "focused"
})
```

#### Test 14.4: Timeline
```javascript
// Test: Get detailed timeline
mcp__memory-keeper__context_timeline({
  "groupBy": "hour",
  "includeItems": true,
  "categories": ["task", "progress"],
  "relativeTime": true,
  "itemsPerPeriod": 5
})
```

#### Test 14.5: Compress
```javascript
// Test: Compress old data
mcp__memory-keeper__context_compress({
  "olderThan": new Date(Date.now() - 24*60*60*1000).toISOString(), // 1 day old
  "preserveCategories": ["decision"],
  "targetSize": 1024  // 1MB target
})
```

## Integration Tests

### Test Suite 15: Cross-Tool Integration

#### Test 15.1: Save → Checkpoint → Export → Import Flow
```javascript
// 1. Save critical data
mcp__memory-keeper__context_save({
  "key": "critical_config",
  "value": "Important configuration",
  "priority": "high"
})

// 2. Create checkpoint
mcp__memory-keeper__context_checkpoint({
  "name": "integration-test-checkpoint"
})

// 3. Export
const exportResult = await mcp__memory-keeper__context_export({})

// 4. Clear and import
// Start new session
mcp__memory-keeper__context_session_start({ "name": "Clean Import Test" })

// Import
mcp__memory-keeper__context_import({
  "filePath": exportResult.filePath
})

// Verify critical data exists
mcp__memory-keeper__context_get({ "key": "critical_config" })
```

#### Test 15.2: Git Integration Flow
```javascript
// Test: Git-aware checkpoint
mcp__memory-keeper__context_set_project_dir({
  "projectDir": "/path/to/git/repo"
})

mcp__memory-keeper__context_checkpoint({
  "name": "git-integrated-checkpoint",
  "includeGitStatus": true
})

// Make git commit
mcp__memory-keeper__context_git_commit({
  "message": "Test commit with context",
  "autoSave": true
})
```

#### Test 15.3: Tool Integration
```javascript
// Test: Record tool events
mcp__memory-keeper__context_integrate_tool({
  "toolName": "test-runner",
  "eventType": "test-complete",
  "data": {
    "passed": 45,
    "failed": 2,
    "duration": "2m 30s",
    "important": true
  }
})
```

## Edge Case Tests

### Test Suite 16: Error Handling

#### Test 16.1: Invalid Parameters
```javascript
// Test: Save without required key
try {
  mcp__memory-keeper__context_save({
    "value": "No key provided"
  })
} catch (error) {
  // Expected: Error about missing key
}

// Test: Invalid relationship type
try {
  mcp__memory-keeper__context_link({
    "sourceKey": "item1",
    "targetKey": "item2",
    "relationship": "invalid_type"
  })
} catch (error) {
  // Expected: Error about invalid relationship
}
```

#### Test 16.2: Non-existent Items
```javascript
// Test: Get non-existent item
mcp__memory-keeper__context_get({
  "key": "does_not_exist_123456"
})
// Expected: Empty results

// Test: Link to non-existent item
try {
  mcp__memory-keeper__context_link({
    "sourceKey": "exists",
    "targetKey": "does_not_exist",
    "relationship": "depends_on"
  })
} catch (error) {
  // Expected: Error about item not found
}
```

#### Test 16.3: Empty Operations
```javascript
// Test: Export empty session
mcp__memory-keeper__context_session_start({ "name": "Empty Session" })

try {
  mcp__memory-keeper__context_export({})
} catch (error) {
  // Expected: Warning about empty export
}

// Force empty export
mcp__memory-keeper__context_export({
  "confirmEmpty": true
})
```

### Test Suite 17: Boundary Conditions

#### Test 17.1: Large Values
```javascript
// Test: Save very large value
const largeValue = "x".repeat(100000); // 100KB string
mcp__memory-keeper__context_save({
  "key": "large_value_test",
  "value": largeValue
})

// Verify retrieval
const retrieved = await mcp__memory-keeper__context_get({ "key": "large_value_test" })
// Expected: Full value retrieved
```

#### Test 17.2: Special Characters
```javascript
// Test: Save with special characters
mcp__memory-keeper__context_save({
  "key": "special_chars",
  "value": "Test with 'quotes', \"double quotes\", \n newlines, \t tabs, and émojis 🎉"
})

// Test: Keys with special patterns
mcp__memory-keeper__context_save({
  "key": "user@domain.com",
  "value": "Email as key"
})

mcp__memory-keeper__context_save({
  "key": "path/to/file.js",
  "value": "Path as key"
})
```

#### Test 17.3: Pagination Limits
```javascript
// Create many items
for (let i = 0; i < 150; i++) {
  mcp__memory-keeper__context_save({
    "key": `pagination_test_${i}`,
    "value": `Item ${i}`,
    "category": "test"
  })
}

// Test: Large limit
mcp__memory-keeper__context_get({
  "category": "test",
  "limit": 200  // More than exists
})

// Test: Pagination
mcp__memory-keeper__context_get({
  "category": "test",
  "limit": 50,
  "offset": 100
})
```

## Performance & Stress Tests

### Test Suite 18: Performance Benchmarks

#### Test 18.1: Bulk Operations Performance
```javascript
// Test: Time bulk save of 1000 items
const startTime = Date.now();
const bulkItems = [];
for (let i = 0; i < 1000; i++) {
  bulkItems.push({
    key: `perf_test_${i}`,
    value: `Performance test item ${i}`,
    category: "test",
    priority: i % 3 === 0 ? "high" : "normal"
  });
}

mcp__memory-keeper__context_batch_save({
  "items": bulkItems
})

const duration = Date.now() - startTime;
console.log(`Bulk save 1000 items: ${duration}ms`);
// Expected: < 5000ms
```

#### Test 18.2: Search Performance
```javascript
// Test: Search across large dataset
const searchStart = Date.now();
mcp__memory-keeper__context_search({
  "query": "test",
  "limit": 100
})
const searchDuration = Date.now() - searchStart;
console.log(`Search duration: ${searchDuration}ms`);
// Expected: < 1000ms
```

#### Test 18.3: Complex Queries
```javascript
// Test: Complex filtered query
const complexStart = Date.now();
mcp__memory-keeper__context_get({
  "keyPattern": "perf_test_[0-9]*",
  "priorities": ["high"],
  "createdAfter": new Date(Date.now() - 60*60*1000).toISOString(),
  "sort": "created_desc",
  "includeMetadata": true,
  "limit": 50
})
const complexDuration = Date.now() - complexStart;
console.log(`Complex query duration: ${complexDuration}ms`);
// Expected: < 2000ms
```

### Test Suite 19: Stress Tests

#### Test 19.1: Concurrent Operations
```javascript
// Test: Multiple saves in rapid succession
const promises = [];
for (let i = 0; i < 50; i++) {
  promises.push(
    mcp__memory-keeper__context_save({
      "key": `concurrent_${i}`,
      "value": `Concurrent save ${i}`
    })
  );
}

// Wait for all to complete
await Promise.all(promises);

// Verify all saved
mcp__memory-keeper__context_get({ "keyPattern": "concurrent_*" })
// Expected: 50 items
```

#### Test 19.2: Memory Stress
```javascript
// Test: Create many watchers
const watchers = [];
for (let i = 0; i < 10; i++) {
  const watcher = await mcp__memory-keeper__context_watch({
    "action": "create",
    "filters": {
      "categories": ["task"],
      "channels": [`channel_${i}`]
    }
  });
  watchers.push(watcher.watcherId);
}

// Clean up
for (const watcherId of watchers) {
  mcp__memory-keeper__context_watch({
    "action": "stop",
    "watcherId": watcherId
  });
}
```

#### Test 19.3: Relationship Graph Complexity
```javascript
// Create complex relationship graph
const nodes = 50;
for (let i = 0; i < nodes; i++) {
  mcp__memory-keeper__context_save({
    "key": `node_${i}`,
    "value": `Graph node ${i}`
  });
}

// Create interconnected relationships
for (let i = 0; i < nodes - 1; i++) {
  mcp__memory-keeper__context_link({
    "sourceKey": `node_${i}`,
    "targetKey": `node_${i + 1}`,
    "relationship": "leads_to"
  });
  
  // Add some cross-links
  if (i % 5 === 0 && i + 5 < nodes) {
    mcp__memory-keeper__context_link({
      "sourceKey": `node_${i}`,
      "targetKey": `node_${i + 5}`,
      "relationship": "related_to"
    });
  }
}

// Test: Traverse deep graph
mcp__memory-keeper__context_get_related({
  "key": "node_0",
  "depth": 10,
  "direction": "both"
})
```

## Multi-Session Tests

### Test Suite 20: Cross-Session Collaboration

#### Test 20.1: Public/Private Visibility
```javascript
// Session 1: Save public and private items
const session1 = await mcp__memory-keeper__context_status();

mcp__memory-keeper__context_save({
  "key": "public_shared_info",
  "value": "This is public information",
  "private": false
})

mcp__memory-keeper__context_save({
  "key": "private_session_info",
  "value": "This is private to session 1",
  "private": true
})

// Start Session 2
mcp__memory-keeper__context_session_start({
  "name": "Session 2 - Collaboration Test"
})

// Test: Access from session 2
mcp__memory-keeper__context_get({ "key": "public_shared_info" })
// Expected: Found

mcp__memory-keeper__context_get({ "key": "private_session_info" })
// Expected: Not found
```

#### Test 20.2: Cross-Session Search
```javascript
// Test: Search across all sessions
mcp__memory-keeper__context_search_all({
  "query": "shared",
  "includeShared": true
})
// Expected: Results from multiple sessions
```

#### Test 20.3: Channel Sharing
```javascript
// Session 2: Add to same channel as Session 1
mcp__memory-keeper__context_save({
  "key": "session2_channel_item",
  "value": "Added from session 2",
  "channel": "shared-channel"
})

// Both sessions should see items in shared-channel
mcp__memory-keeper__context_get({ "channel": "shared-channel" })
```

## Bug Tracking System

### Using Memory Keeper for Bug Tracking

#### Setup Bug Tracking Session
```javascript
// Create dedicated bug tracking session
mcp__memory-keeper__context_session_start({
  "name": "MK Test Suite - Bug Tracking",
  "description": "Tracking bugs found during comprehensive testing",
  "defaultChannel": "bugs"
})

// Define bug template
const reportBug = (bugData) => {
  return mcp__memory-keeper__context_save({
    "key": `bug_${Date.now()}_${bugData.test}`,
    "value": JSON.stringify({
      test: bugData.test,
      description: bugData.description,
      expected: bugData.expected,
      actual: bugData.actual,
      severity: bugData.severity,
      reproducible: bugData.reproducible,
      timestamp: new Date().toISOString()
    }),
    "category": "error",
    "priority": bugData.severity === "critical" ? "high" : "normal",
    "channel": `bugs-${bugData.severity}`
  });
};
```

#### Bug Severity Levels
- **Critical**: Data loss, crashes, security issues
- **High**: Feature completely broken, no workaround
- **Medium**: Feature partially broken, workaround exists
- **Low**: Minor issues, cosmetic problems

#### Example Bug Report
```javascript
reportBug({
  test: "Test 7.2: Restore Checkpoint",
  description: "Checkpoint restore fails when includeFiles is true",
  expected: "All files restored from checkpoint",
  actual: "Error: Cannot read property 'files' of undefined",
  severity: "high",
  reproducible: true
})
```

#### Bug Queries
```javascript
// Get all critical bugs
mcp__memory-keeper__context_get({
  "channel": "bugs-critical",
  "sort": "created_desc"
})

// Get bugs from specific test suite
mcp__memory-keeper__context_search({
  "query": "Test Suite 7",
  "category": "error"
})

// Get bug statistics
mcp__memory-keeper__context_channel_stats({
  "channel": "bugs",
  "includeInsights": true
})
```

## Test Execution Tracking

### Test Run Management
```javascript
// Start test run
const testRun = {
  id: `test_run_${Date.now()}`,
  startTime: new Date().toISOString(),
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    memoryKeeperVersion: "0.11.0"
  },
  suites: []
};

// Track suite execution
const trackSuite = (suiteName, tests) => {
  const suite = {
    name: suiteName,
    startTime: new Date().toISOString(),
    tests: tests,
    passed: 0,
    failed: 0,
    skipped: 0
  };
  
  // Execute tests and track results
  tests.forEach(test => {
    try {
      // Run test
      test.execute();
      suite.passed++;
    } catch (error) {
      suite.failed++;
      reportBug({
        test: `${suiteName}: ${test.name}`,
        description: error.message,
        expected: test.expected,
        actual: error.actual || "Error thrown",
        severity: test.critical ? "critical" : "medium",
        reproducible: true
      });
    }
  });
  
  suite.endTime = new Date().toISOString();
  suite.duration = Date.now() - new Date(suite.startTime).getTime();
  
  testRun.suites.push(suite);
  
  // Save suite results
  mcp__memory-keeper__context_save({
    "key": `test_suite_${suiteName}_${testRun.id}`,
    "value": JSON.stringify(suite),
    "category": "progress",
    "channel": "test-results"
  });
};

// Final test run summary
const completeTestRun = () => {
  testRun.endTime = new Date().toISOString();
  testRun.duration = Date.now() - new Date(testRun.startTime).getTime();
  testRun.totalTests = testRun.suites.reduce((sum, s) => sum + s.tests.length, 0);
  testRun.totalPassed = testRun.suites.reduce((sum, s) => sum + s.passed, 0);
  testRun.totalFailed = testRun.suites.reduce((sum, s) => sum + s.failed, 0);
  
  mcp__memory-keeper__context_save({
    "key": `test_run_summary_${testRun.id}`,
    "value": JSON.stringify(testRun),
    "category": "note",
    "priority": "high",
    "channel": "test-summaries"
  });
  
  // Generate report
  mcp__memory-keeper__context_delegate({
    "taskType": "synthesize",
    "input": {
      "synthesisType": "narrative",
      "includeMetrics": true
    }
  });
};
```

### Test Coverage Matrix

| Feature | Basic | Advanced | Edge Cases | Performance | Multi-Session |
|---------|-------|----------|------------|-------------|---------------|
| Session Management | ✓ | ✓ | ✓ | ✓ | ✓ |
| Context Storage | ✓ | ✓ | ✓ | ✓ | ✓ |
| Channels | ✓ | ✓ | ✓ | ✓ | ✓ |
| Batch Ops | ✓ | ✓ | ✓ | ✓ | - |
| Relationships | ✓ | ✓ | ✓ | ✓ | - |
| Files | ✓ | - | ✓ | - | - |
| Checkpoints | ✓ | ✓ | ✓ | - | ✓ |
| Monitoring | ✓ | ✓ | ✓ | ✓ | - |
| Search | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export/Import | ✓ | ✓ | ✓ | - | ✓ |
| Knowledge Graph | ✓ | ✓ | ✓ | ✓ | - |
| Semantic Search | ✓ | - | ✓ | ✓ | - |
| Multi-Agent | ✓ | ✓ | - | - | - |
| Advanced Features | ✓ | ✓ | ✓ | ✓ | ✓ |

### Success Metrics

1. **Functional Coverage**: 100% of tools tested
2. **Edge Case Coverage**: All identified edge cases handled
3. **Performance Benchmarks**: 
   - Save operations: < 100ms
   - Search operations: < 1000ms  
   - Bulk operations (1000 items): < 5000ms
4. **Stability**: No crashes during stress tests
5. **Data Integrity**: No data loss scenarios
6. **Multi-Session**: Proper isolation and sharing

### Next Steps

1. Execute all test suites systematically
2. Document all bugs found using the bug tracking system
3. Prioritize bug fixes based on severity
4. Re-test after fixes
5. Create automated test runner for regression testing
6. Generate comprehensive test report

---

**Note**: This is a living document. Update test cases as new features are added or bugs are discovered.