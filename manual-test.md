# Manual Test Script for MCP Memory Keeper

Run these commands in Claude Code after restarting with the new server:

## 1. Basic Functionality Test

```javascript
// Start a new session
mcp_context_session_start({ 
  name: "Test Session", 
  description: "Testing MCP Memory Keeper v0.4.0" 
})

// Save items with different categories and priorities
mcp_context_save({ 
  key: "test_task", 
  value: "Complete the authentication module", 
  category: "task", 
  priority: "high" 
})

mcp_context_save({ 
  key: "important_decision", 
  value: "Use JWT tokens for auth", 
  category: "decision", 
  priority: "high" 
})

mcp_context_save({ 
  key: "progress_note", 
  value: "Finished user model, working on routes", 
  category: "progress", 
  priority: "normal" 
})

// Test retrieval
mcp_context_get({ key: "test_task" })
mcp_context_get({ category: "decision" })

// Check status
mcp_context_status()
```

## 2. Checkpoint Test

```javascript
// Create a checkpoint
mcp_context_checkpoint({ 
  name: "test-checkpoint", 
  description: "Testing checkpoint functionality" 
})

// Add more data
mcp_context_save({ 
  key: "after_checkpoint", 
  value: "This was added after checkpoint", 
  category: "note" 
})

// List sessions to get a new session ID
mcp_context_session_list({ limit: 5 })

// Restore from checkpoint (creates new session)
mcp_context_restore_checkpoint({ name: "test-checkpoint" })

// Verify the restored data
mcp_context_get({ key: "test_task" })
mcp_context_get({ key: "after_checkpoint" })  // Should not exist
```

## 3. Search Test

```javascript
// Search for content
mcp_context_search({ query: "auth" })
mcp_context_search({ query: "task", searchIn: ["key"] })
```

## 4. Summarization Test

```javascript
// Get summary
mcp_context_summarize()
mcp_context_summarize({ categories: ["task", "decision"] })
```

## 5. Smart Compaction Test

```javascript
// Prepare for compaction
mcp_context_prepare_compaction()
// Check the output - it should show critical items and next steps
```

## 6. Export/Import Test

```javascript
// Export current session
mcp_context_export()

// Create new session
mcp_context_session_start({ name: "Import Test" })

// Import the exported data
mcp_context_import({ 
  filePath: "memory-keeper-export-XXXXXXXX.json",  // Use actual filename
  merge: false 
})

// Verify imported data
mcp_context_status()
mcp_context_get({ category: "task" })
```

## Expected Behaviors to Verify

1. ✅ All saves should return confirmation
2. ✅ Gets should return the exact saved values
3. ✅ Checkpoints should preserve all data at that point
4. ✅ Restore should create new session with checkpoint data
5. ✅ Search should find partial matches
6. ✅ Summarization should group by priority and category
7. ✅ Compaction prep should identify high-priority items
8. ✅ Export should create a JSON file
9. ✅ Import should restore all data

## Error Cases to Test

```javascript
// Try to get non-existent key
mcp_context_get({ key: "does_not_exist" })

// Try to restore non-existent checkpoint  
mcp_context_restore_checkpoint({ name: "fake-checkpoint" })

// Try to import non-existent file
mcp_context_import({ filePath: "does-not-exist.json" })
```