# MCP Memory Keeper - Quick Start Examples

## Table of Contents
- [Quick Start Scenarios](#quick-start-scenarios)
- [Common Workflows](#common-workflows)
- [Advanced Usage](#advanced-usage)
- [Tips & Best Practices](#tips--best-practices)

## Quick Start Scenarios

### Scenario 1: "I'm about to hit context limit"
When you feel the Claude conversation getting long and might hit the context limit:

```typescript
// Quick save everything important
await context_prepare_compaction();

// This automatically:
// - Creates a checkpoint of current state
// - Identifies critical context items (high priority)
// - Saves recent file changes
// - Generates a summary for easy restoration
// - Returns instructions for next session
```

**Output example:**
```
Checkpoint created: pre-compaction-2024-01-15-14-30
Critical items saved: 12
Files cached: 5
Summary generated

To restore in new session:
context_restore_checkpoint({ name: "pre-compaction-2024-01-15-14-30" })
```

### Scenario 2: "I need to switch branches"
Save your work before switching git branches:

```typescript
// Save current work state
await context_checkpoint({ 
  name: "feature-auth-progress",
  includeFiles: true,
  includeGitStatus: true
});

// Switch branches...
// git checkout main

// Later, restore exactly where you left off
await context_restore_checkpoint({ 
  name: "feature-auth-progress",
  restoreFiles: true 
});
```

### Scenario 3: "I lost track of what I was doing"
Get a quick summary of recent work:

```typescript
// Get a summary of recent work
await context_summarize({ 
  categories: ["task", "decision"],
  maxLength: 500 
});

// Or get everything from current session
await context_summarize();
```

**Output example:**
```
## Session Summary: Implementing Authentication

### TASKS (4)
🔴 high: Implement JWT refresh token rotation
🔴 high: Add rate limiting to login endpoint
🟡 normal: Write tests for auth middleware
⚪ low: Update API documentation

### DECISIONS (2)
🔴 high: Use Redis for session storage
🟡 normal: Set token expiry to 24 hours

Total items: 6
Session started: 2024-01-15 09:00
Last update: 2024-01-15 14:30
```

### Scenario 4: "Starting fresh but want previous context"
Continue from a previous session:

```typescript
// List recent sessions
const sessions = await context_session_list({ limit: 5 });

// Start new session continuing from previous
await context_session_start({ 
  continueFrom: sessions[0].id,
  description: "Feature X - Day 2" 
});
```

## Common Workflows

### The Morning Startup Pattern
Start your day with context from yesterday:

```typescript
// 1. Check what you were working on
const sessions = await context_session_list({ limit: 3 });
console.log(sessions); // See recent work

// 2. Start today's session
await context_session_start({
  description: "Continue authentication feature",
  continueFrom: sessions[0].id // Yesterday's session
});

// 3. Review current tasks
const tasks = await context_get({ category: "task" });
```

### The Code Review Pattern
Track feedback and required changes:

```typescript
// Before code review
await context_checkpoint({ 
  name: "pre-review-pr-123",
  includeFiles: true 
});

// During review - save feedback
await context_save({
  key: "review_feedback_auth",
  value: "Add input validation to login endpoint",
  category: "task",
  priority: "high"
});

await context_save({
  key: "review_feedback_tests",
  value: "Need tests for error cases",
  category: "task",
  priority: "high"
});

// After implementing changes
await context_save({
  key: "review_complete",
  value: "All feedback addressed for PR #123",
  category: "progress"
});
```

### The Debugging Session Pattern
Track investigation progress:

```typescript
// Start debugging
await context_save({
  key: "bug_description",
  value: "Users report login fails after password reset",
  category: "task",
  priority: "high"
});

// Track hypotheses
await context_save({
  key: "hypothesis_1",
  value: "Password reset token might be expiring too quickly",
  category: "decision"
});

// Cache relevant files
await context_cache_file({
  filePath: "src/auth/password-reset.ts",
  content: fileContent
});

// Test hypothesis
await context_save({
  key: "test_result_1",
  value: "Token TTL is 1 hour - seems reasonable",
  category: "progress"
});

// Found the issue
await context_save({
  key: "bug_root_cause",
  value: "Password hash comparison using wrong algorithm after reset",
  category: "decision",
  priority: "high"
});

// Solution
await context_save({
  key: "bug_solution",
  value: "Fixed hash algorithm in password-reset.ts line 47",
  category: "progress"
});
```

### The Feature Development Pattern
Organize feature implementation:

```typescript
// Planning phase
await context_save({
  key: "feature_requirements",
  value: "Add two-factor authentication with SMS and TOTP support",
  category: "task",
  priority: "high"
});

await context_save({
  key: "feature_design",
  value: "Use speakeasy for TOTP, Twilio for SMS",
  category: "decision"
});

// Implementation tracking
await context_save({
  key: "task_totp_setup",
  value: "Implement TOTP secret generation and QR code",
  category: "task",
  priority: "high"
});

// Cache important files as you work
await context_cache_file({
  filePath: "src/auth/two-factor.ts",
  content: twoFactorImplementation
});

// Track completion
await context_save({
  key: "progress_totp",
  value: "TOTP implementation complete, tested with Google Authenticator",
  category: "progress"
});
```

## Advanced Usage

### Smart Search Across Sessions
Find information from any previous session:

```typescript
// Search for all authentication-related work
const results = await context_search({
  query: "authentication",
  includeAllSessions: true
});

// Search in specific categories
const decisions = await context_search({
  query: "database",
  categories: ["decision"]
});
```

### Git Integration Workflow
Automatically save context on commits:

```typescript
// Configure git integration
await context_git_commit({
  autoSave: true,
  includeMessage: true
});

// Now every git commit will:
// 1. Create a checkpoint
// 2. Include context summary in commit message
// 3. Save the commit hash with the checkpoint
```

### Export and Backup
Regular backups of your context:

```typescript
// Export current session
await context_export({
  format: "json",
  sessionId: currentSessionId,
  outputPath: "./backups/session-2024-01-15.json"
});

// Export everything
await context_export({
  format: "json",
  includeAllSessions: true,
  outputPath: "./backups/full-backup.json"
});

// Later, import on new machine
await context_import({
  filePath: "./backups/full-backup.json",
  mergeStrategy: "skip_existing"
});
```

### File Change Detection
Track which files you've modified:

```typescript
// Cache files at start of work
const filesToTrack = [
  "src/auth/login.ts",
  "src/auth/middleware.ts",
  "tests/auth.test.ts"
];

for (const file of filesToTrack) {
  await context_cache_file({
    filePath: file,
    content: fs.readFileSync(file, 'utf-8')
  });
}

// Later, check what changed
for (const file of filesToTrack) {
  const changed = await context_file_changed({ filePath: file });
  if (changed) {
    console.log(`Modified: ${file}`);
  }
}
```

## Tips & Best Practices

### 1. Use Meaningful Keys
```typescript
// ❌ Bad
await context_save({ key: "thing1", value: "fix bug" });

// ✅ Good  
await context_save({ 
  key: "bug_auth_session_timeout",
  value: "Users logged out after 5 minutes instead of 24 hours"
});
```

### 2. Leverage Categories
```typescript
// Organize by type
- "task" - Things to do
- "decision" - Architectural/design decisions  
- "progress" - Completed work
- "note" - Important information
- "warning" - Issues to watch out for
- "error" - Problems encountered
```

### 3. Set Priorities
```typescript
// Use priorities to bubble up important items
await context_save({
  key: "critical_bug",
  value: "Production login is broken",
  category: "task",
  priority: "high" // Will appear first in summaries
});
```

### 4. Regular Checkpoints
```typescript
// Create checkpoints at natural breakpoints
- Before switching tasks
- Before meetings  
- End of day
- Before risky changes
- After completing features
```

### 5. Descriptive Session Names
```typescript
// ❌ Bad
await context_session_start({ description: "work" });

// ✅ Good
await context_session_start({ 
  description: "Implementing OAuth2 integration with Google" 
});
```

### 6. Clean Up Old Sessions
```typescript
// List old sessions
const oldSessions = await context_session_list({ 
  limit: 20,
  beforeDate: "2024-01-01" 
});

// Export for archive
await context_export({
  sessionIds: oldSessions.map(s => s.id),
  outputPath: "./archive/old-sessions.json"
});

// Then clean up database
// (Manual cleanup commands coming in future version)
```

## Real-World Example: Full Day Workflow

```typescript
// 9:00 AM - Start work
await context_session_start({
  description: "Sprint 15 - User Management Features"
});

// Check yesterday's progress
const yesterday = await context_get({ 
  sessionId: "previous-session-id",
  category: "task"
});

// 9:30 AM - Plan today's work  
await context_save({
  key: "today_plan",
  value: "1. Fix user deletion bug\n2. Add bulk import\n3. Review PR #456",
  category: "task",
  priority: "high"
});

// 10:00 AM - Start debugging
await context_save({
  key: "bug_user_deletion", 
  value: "Soft delete not working, users still appear in list",
  category: "task",
  priority: "high"
});

// Cache the problematic file
await context_cache_file({
  filePath: "src/users/delete-handler.ts",
  content: deleteHandlerContent
});

// 11:00 AM - Found issue
await context_save({
  key: "bug_user_deletion_solved",
  value: "Missing where clause in query, fixed line 234",
  category: "progress"
});

// 2:00 PM - Before complex refactoring
await context_checkpoint({
  name: "before-bulk-import-feature",
  includeFiles: true
});

// 4:00 PM - Context getting full
const summary = await context_prepare_compaction();
console.log(summary); // See what will be saved

// 5:00 PM - End of day
await context_save({
  key: "eod_summary",
  value: "Completed: user deletion bug, bulk import 70% done\nTomorrow: finish bulk import, review PR",
  category: "progress"
});

await context_checkpoint({
  name: "eod-2024-01-15",
  includeGitStatus: true
});
```

---

Need more examples? Check out:
- [RECIPES.md](./RECIPES.md) - Common patterns and solutions
- [API.md](./API.md) - Full API reference
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions