# MCP Memory Keeper - Troubleshooting Guide

## Table of Contents
- [Common Issues](#common-issues)
- [Installation Problems](#installation-problems)
- [Runtime Errors](#runtime-errors)
- [Performance Issues](#performance-issues)
- [Data Recovery](#data-recovery)
- [Debugging Tips](#debugging-tips)

## Common Issues

### "Memory Keeper is not available in Claude"

**Symptoms:**
- Tools don't appear in Claude Code
- Getting "unknown tool" errors

**Solutions:**

1. **Check if Memory Keeper is running:**
   ```bash
   # In Claude Code, check available MCP servers
   # Look for "memory-keeper" in the list
   ```

2. **Verify configuration:**
   Check your Claude Code settings:
   ```json
   {
     "mcpServers": {
       "memory-keeper": {
         "command": "node",
         "args": ["/absolute/path/to/mcp-memory-keeper/dist/index.js"]
       }
     }
   }
   ```

3. **Restart Claude Code:**
   - Completely quit Claude Code
   - Start it again
   - MCP servers are loaded on startup

4. **Check build output:**
   ```bash
   cd /path/to/mcp-memory-keeper
   npm run build
   # Should create dist/index.js
   ```

### "Context not persisting between sessions"

**Symptoms:**
- Lost context after Claude restart
- Empty results from `context_get`

**Solutions:**

1. **Check database location:**
   ```bash
   # Memory Keeper creates context.db in working directory
   ls -la context.db
   ```

2. **Verify session is active:**
   ```typescript
   // Always start or continue a session
   await context_session_start({ 
     description: "My work session" 
   });
   
   // Or check current status
   await context_status();
   ```

3. **Use explicit session IDs:**
   ```typescript
   // Save with session
   await context_save({
     key: "important_note",
     value: "This must persist",
     category: "note"
   });
   
   // Get from specific session
   const sessions = await context_session_list({ limit: 1 });
   await context_get({ 
     sessionId: sessions[0].id 
   });
   ```

### "Can't restore from checkpoint"

**Symptoms:**
- "No checkpoint found" error
- Checkpoint exists but won't restore

**Solutions:**

1. **List available checkpoints:**
   ```typescript
   // See all checkpoints
   const status = await context_status();
   console.log(status); // Shows checkpoint count
   ```

2. **Use exact checkpoint name:**
   ```typescript
   // Create with specific name
   await context_checkpoint({ 
     name: "my-checkpoint-v1" 
   });
   
   // Restore with exact name
   await context_restore_checkpoint({ 
     name: "my-checkpoint-v1" 
   });
   ```

3. **Check checkpoint integrity:**
   If checkpoint is corrupted, try:
   ```typescript
   // Export current state
   await context_export({ 
     format: "json",
     outputPath: "./backup.json" 
   });
   
   // Create fresh checkpoint
   await context_checkpoint({ 
     name: "fresh-checkpoint" 
   });
   ```

## Installation Problems

### "Module not found" errors

**Error:**
```
Error: Cannot find module '@modelcontextprotocol/sdk'
```

**Solution:**
```bash
cd /path/to/mcp-memory-keeper
npm install
npm run build
```

### "SQLite3 was compiled against a different Node.js version"

**Error:**
```
Error: The module 'better-sqlite3' was compiled against a different Node.js version
```

**Solution:**
```bash
# Rebuild native modules
npm rebuild better-sqlite3

# Or clean install
rm -rf node_modules
npm install
```

### TypeScript compilation errors

**Error:**
```
error TS2307: Cannot find module 'simple-git'
```

**Solution:**
```bash
# Install all dependencies
npm install

# If persists, check tsconfig.json
cat tsconfig.json
# Ensure "moduleResolution": "node"
```

## Runtime Errors

### "Database is locked"

**Symptoms:**
- Operations hang or timeout
- "database is locked" errors

**Solutions:**

1. **Close other connections:**
   - Ensure only one Claude Code instance is running
   - Check for hung Node processes:
   ```bash
   ps aux | grep node
   killall node  # Use with caution
   ```

2. **Use WAL mode (default):**
   The database uses WAL mode by default, but verify:
   ```sql
   PRAGMA journal_mode;  -- Should return "wal"
   ```

3. **Recover from locked state:**
   ```bash
   # Make backup first
   cp context.db context.db.backup
   
   # Try to recover
   sqlite3 context.db "PRAGMA integrity_check;"
   ```

### "Out of memory" errors

**Symptoms:**
- Claude Code crashes
- "JavaScript heap out of memory"

**Solutions:**

1. **Limit query results:**
   ```typescript
   // Don't get everything at once
   await context_get({ 
     category: "task",
     limit: 50  // Add limit
   });
   ```

2. **Use summaries for large datasets:**
   ```typescript
   // Instead of getting all items
   await context_summarize({ 
     maxLength: 1000 
   });
   ```

3. **Clean up old sessions:**
   ```typescript
   // Export old data first
   await context_export({
     beforeDate: "2024-01-01",
     outputPath: "./archive.json"
   });
   
   // Then remove from active database
   // (Manual cleanup required in v0.4.0)
   ```

## Performance Issues

### Slow operations

**Symptoms:**
- Commands take several seconds
- Claude Code becomes unresponsive

**Solutions:**

1. **Check database size:**
   ```bash
   ls -lh context.db
   # If > 100MB, consider cleanup
   ```

2. **Optimize queries:**
   ```typescript
   // Use specific filters
   await context_get({ 
     category: "task",
     priority: "high" 
   });
   
   // Instead of getting everything
   await context_get(); // Slow with large dataset
   ```

3. **Regular maintenance:**
   ```typescript
   // Periodically export and start fresh
   await context_export({ 
     format: "json",
     outputPath: "./full-backup.json" 
   });
   
   // Then start new database
   // mv context.db context.db.old
   ```

### High memory usage

**Solutions:**

1. **Limit file caching:**
   ```typescript
   // Only cache small files
   if (fileSize < 1024 * 1024) { // 1MB
     await context_cache_file({
       filePath: file,
       content: content
     });
   }
   ```

2. **Use compression for exports:**
   ```typescript
   await context_export({
     format: "json",
     compress: true,  // Coming in future version
     outputPath: "./backup.json.gz"
   });
   ```

## Data Recovery

### Recover from corrupted database

**Steps:**

1. **Make a backup:**
   ```bash
   cp context.db context.db.corrupted
   ```

2. **Try SQLite recovery:**
   ```bash
   sqlite3 context.db ".recover" | sqlite3 context-recovered.db
   mv context-recovered.db context.db
   ```

3. **Export what you can:**
   ```typescript
   try {
     await context_export({
       format: "json",
       outputPath: "./recovery.json"
     });
   } catch (error) {
     console.error("Export failed:", error);
   }
   ```

### Restore from backup

**If you have JSON exports:**

```typescript
// Start fresh
await context_session_start({ 
  description: "Restored session" 
});

// Import backup
await context_import({
  filePath: "./backup.json",
  mergeStrategy: "replace"
});
```

### Merge multiple databases

**If you have multiple context.db files:**

```bash
# Use SQLite to merge
sqlite3 context-merged.db < create-tables.sql
sqlite3 context-merged.db "ATTACH 'context1.db' as db1; INSERT INTO sessions SELECT * FROM db1.sessions;"
sqlite3 context-merged.db "ATTACH 'context2.db' as db2; INSERT INTO sessions SELECT * FROM db2.sessions;"
```

## Debugging Tips

### Enable verbose logging

**For development:**

```typescript
// Add debug logs to your queries
const result = await context_save({
  key: "debug_test",
  value: "test value"
});
console.log("Save result:", result);
```

### Check database directly

**Using SQLite CLI:**

```bash
sqlite3 context.db

# Useful queries
.tables                          # List all tables
.schema context_items           # Show table structure
SELECT COUNT(*) FROM context_items;  # Count items
SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;  # Recent sessions
```

### Monitor file sizes

```bash
# Watch database growth
watch -n 5 'ls -lh context.db*'

# Check table sizes
sqlite3 context.db "
  SELECT 
    name,
    SUM(pgsize) as size
  FROM dbstat
  GROUP BY name
  ORDER BY size DESC;"
```

### Test individual operations

```typescript
// Test basic operations
async function testMemoryKeeper() {
  console.log("Testing session start...");
  await context_session_start({ description: "Test" });
  
  console.log("Testing save...");
  await context_save({ 
    key: "test", 
    value: "value" 
  });
  
  console.log("Testing get...");
  const result = await context_get({ key: "test" });
  console.log("Result:", result);
  
  console.log("Testing status...");
  const status = await context_status();
  console.log("Status:", status);
}
```

## Getting Help

### Still having issues?

1. **Check the logs:**
   - Claude Code may show errors in developer console
   - Check Node.js output if running manually

2. **Report issues:**
   - GitHub Issues: https://github.com/mkreyman/mcp-memory-keeper/issues
   - Include:
     - Error messages
     - Steps to reproduce
     - Environment (OS, Node version)
     - Memory Keeper version

3. **Community support:**
   - Check existing issues for solutions
   - Join discussions in the repository

### Batch Operations Issues

**"Transaction failed" errors**

**Symptoms:**
- Batch operations fail with transaction errors
- Some items saved but not others

**Solutions:**

1. **Check for conflicts:**
   ```typescript
   // Check if keys already exist
   const existing = await context_get({ 
     keys: ["key1", "key2", "key3"] 
   });
   
   // Use updateExisting flag
   await context_batch_save({
     items: [...],
     updateExisting: true  // Allow updates
   });
   ```

2. **Validate data first:**
   ```typescript
   // Ensure all required fields
   const items = data.map(item => ({
     key: item.key || `generated_${Date.now()}`,
     value: item.value || "",
     category: item.category || "note",
     priority: item.priority || "normal"
   }));
   ```

### Channel Reassignment Problems

**"No items found" when moving channels**

**Solutions:**

1. **Preview with dryRun:**
   ```typescript
   const preview = await context_reassign_channel({
     fromChannel: "old-channel",
     toChannel: "new-channel",
     dryRun: true
   });
   console.log(`Would move ${preview.movedCount} items`);
   ```

2. **Check channel exists:**
   ```typescript
   const channels = await context_list_channels();
   console.log("Available channels:", channels);
   ```

### Relationship Errors

**"Item not found" when creating links**

**Solutions:**

1. **Ensure both items exist:**
   ```typescript
   // Save items first
   await context_save({ key: "item1", value: "..." });
   await context_save({ key: "item2", value: "..." });
   
   // Then link them
   await context_link({
     sourceKey: "item1",
     targetKey: "item2",
     relationship: "related_to"
   });
   ```

2. **Check relationship types:**
   ```typescript
   // Valid relationships:
   const validRelationships = [
     "contains", "depends_on", "references", 
     "implements", "extends", "related_to",
     "blocks", "blocked_by", "parent_of", 
     "child_of", "has_task", "documented_in",
     "serves", "leads_to"
   ];
   ```

### Watcher Not Updating

**"No changes detected" with context_watch**

**Solutions:**

1. **Check watcher expiration:**
   ```typescript
   // Watchers expire after 1 hour by default
   const watcher = await context_watch({
     action: "create",
     expiresIn: 3600  // Seconds
   });
   ```

2. **Use correct filters:**
   ```typescript
   // Be specific with filters
   const watcher = await context_watch({
     action: "create",
     filters: {
       channels: ["my-channel"],  // Must match exactly
       categories: ["task"],      // Case sensitive
       keys: ["prefix_*"]        // Supports wildcards
     }
   });
   ```

### Emergency recovery

If all else fails:

```bash
# 1. Backup everything
cp -r /path/to/mcp-memory-keeper /path/to/backup

# 2. Export any readable data
sqlite3 context.db .dump > emergency-dump.sql

# 3. Fresh install
git pull origin main
npm install
npm run build

# 4. Try to restore from dump
sqlite3 new-context.db < emergency-dump.sql
```

---

Remember: Always backup your context.db file regularly!