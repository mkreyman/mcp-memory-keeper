# MCP Memory Keeper - Quick Start Examples

## Table of Contents
- [Quick Start Scenarios](#quick-start-scenarios)
- [Common Workflows](#common-workflows)
- [Working with Channels](#working-with-channels) (NEW v0.10.0)
- [Time-based Queries](#time-based-queries) (NEW v0.10.0)
- [Batch Operations Examples](#batch-operations-examples) (NEW)
- [Channel Reorganization Examples](#channel-reorganization-examples) (NEW)
- [Context Relationships Examples](#context-relationships-examples) (NEW)
- [Real-time Monitoring Examples](#real-time-monitoring-examples) (NEW)
- [Advanced Usage](#advanced-usage)
- [Tips & Best Practices](#tips--best-practices)

## Quick Start Scenarios

### Scenario 1: "I need to share my findings with another session" (v0.9.0+)
Share important discoveries or solutions:

```
# Found a solution to a tricky bug - it's automatically shared!
context_save
{
  "key": "websocket_reconnect_fix",
  "value": "Use exponential backoff with max 30s delay to prevent server overload",
  "category": "solution",
  "priority": "high"
  # Note: This is automatically accessible from ALL sessions (public by default)
}

# If you want to keep something private to your session only:
context_save
{
  "key": "my_debug_notes",
  "value": "Temporary debugging notes - WebSocket fails on line 234",
  "category": "note",
  "private": true  # Only visible in current session
}
```

### Scenario 2: "I'm about to hit context limit"
When you feel the Claude conversation getting long and might hit the context limit:

```
# Quick save everything important
context_prepare_compaction
{}

# This automatically:
# - Creates a checkpoint of current state
# - Identifies critical context items (high priority)
# - Saves recent file changes
# - Generates a summary for easy restoration
# - Returns instructions for next session
```

**Output example:**
```
Checkpoint created: pre-compaction-2024-01-15-14-30
Critical items saved: 12
Files cached: 5
Summary generated

To restore in new session:
context_restore_checkpoint
{ "name": "pre-compaction-2024-01-15-14-30" }
```

### Scenario 3: "I need to switch branches"
Save your work before switching git branches:

```
# Save current work state
context_checkpoint
{ 
  "name": "feature-auth-progress",
  "includeFiles": true,
  "includeGitStatus": true
}

# Switch branches...
# git checkout main

# Later, restore exactly where you left off
context_restore_checkpoint
{ 
  "name": "feature-auth-progress",
  "restoreFiles": true 
}
```

### Scenario 4: "I'm starting work and want to see what others discovered" (v0.9.0+)
All public context is automatically accessible:

```
# Get all accessible context (public items + your private items)
context_get
{}

# Get specific items by key (will find it from any session if public)
context_get
{ "key": "websocket_reconnect_fix" }

# Search across all sessions for specific topics
context_search_all
{ "query": "authentication" }
```

### Scenario 5: "I lost track of what I was doing"
Get a quick summary of recent work:

```
# Get a summary of recent work
context_summarize
{ 
  "categories": ["task", "decision"],
  "maxLength": 500 
}

# Or get everything from current session
context_summarize
{}
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

## Working with Channels (NEW v0.10.0)

Channels provide persistent topic-based organization that survives session crashes. They're perfect for multi-branch development and team collaboration.

### Auto-derived Channels from Git Branches
When you set a project directory, channels are automatically derived from your git branch:

```javascript
// Set project directory - channels will auto-derive from git branch
context_session_start
{
  "name": "Feature Development",
  "projectDir": "/path/to/project"
}
// Branch "feature/user-auth" → channel "feature-user-auth"

// All saves automatically go to the branch-derived channel
context_save
{
  "key": "auth_architecture",
  "value": "Using JWT with refresh tokens stored in Redis",
  "category": "decision",
  "priority": "high"
  // Automatically saved to "feature-user-auth" channel
}
```

### Explicit Channel Management
Override automatic channels or work without git:

```javascript
// Start with a specific default channel
context_session_start
{
  "name": "API Redesign",
  "defaultChannel": "api-v2"
}

// Save to different channels in same session
context_save
{
  "key": "auth_endpoints",
  "value": "POST /auth/login, POST /auth/refresh, POST /auth/logout",
  "category": "note",
  "channel": "api-v2-auth"  // Explicit channel
}

context_save
{
  "key": "user_endpoints", 
  "value": "GET /users, POST /users, PATCH /users/:id",
  "category": "note",
  "channel": "api-v2-users"  // Different channel
}
```

### Cross-Channel Queries
Work across multiple feature branches:

```javascript
// Get all items from a specific channel
context_get
{ "channel": "feature-payments" }

// Get high-priority tasks across ALL channels
context_get
{
  "category": "task",
  "priorities": ["high"]
  // No channel specified = search all channels
}

// Compare decisions across features
const authDecisions = await context_get({ 
  "channel": "feature-auth", 
  "category": "decision" 
});
const paymentDecisions = await context_get({ 
  "channel": "feature-payments", 
  "category": "decision" 
});
```

### Channel Use Cases

#### Multi-Branch Development
```javascript
// Working on authentication feature
// git checkout -b feature/auth
context_save
{
  "key": "auth_status",
  "value": "JWT implementation complete, working on OAuth",
  "category": "progress"
  // Auto-saved to "feature-auth" channel
}

// Switch to payments branch
// git checkout -b feature/payments
context_save
{
  "key": "payment_status",
  "value": "Stripe integration 50% complete",
  "category": "progress"
  // Auto-saved to "feature-payments" channel
}

// Later, check both features' progress
const features = ["feature-auth", "feature-payments"];
for (const channel of features) {
  const progress = await context_get({ 
    "channel": channel, 
    "category": "progress" 
  });
  console.log(`${channel}: ${progress.length} updates`);
}
```

#### Team Collaboration
```javascript
// Frontend developer on UI branch
context_save
{
  "key": "component_library",
  "value": "Using Material-UI v5 with custom theme",
  "category": "decision",
  "channel": "frontend-ui"
}

// Backend developer can check frontend decisions
context_get
{
  "channel": "frontend-ui",
  "category": "decision"
}
```

## Time-based Queries (NEW v0.10.0)

Find context based on when it was created or updated.

### Recent Work Queries
```javascript
// Get everything from today
const today = new Date().toISOString().split('T')[0];
context_get
{
  "createdAfter": `${today}T00:00:00Z`,
  "includeMetadata": true  // See timestamps
}

// Get last 24 hours of high-priority items
const yesterday = new Date(Date.now() - 24*60*60*1000).toISOString();
context_get
{
  "createdAfter": yesterday,
  "priorities": ["high"],
  "sort": "created_desc"
}

// Get this week's decisions
const weekStart = new Date();
weekStart.setDate(weekStart.getDate() - weekStart.getDay());
context_get
{
  "category": "decision",
  "createdAfter": weekStart.toISOString(),
  "sort": "created_asc"
}
```

### Historical Analysis
```javascript
// Find old unfinished tasks
const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString();
context_get
{
  "category": "task",
  "createdBefore": thirtyDaysAgo,
  "includeMetadata": true
}

// Get items from specific date range
context_get
{
  "createdAfter": "2025-01-01T00:00:00Z",
  "createdBefore": "2025-01-31T23:59:59Z",
  "sort": "updated_desc"
}
```

### Pattern Matching with Time Filters
```javascript
// Find all auth-related items from this sprint
const sprintStart = "2025-01-15T00:00:00Z";
context_get
{
  "keyPattern": "auth_.*",
  "createdAfter": sprintStart,
  "includeMetadata": true
}

// Get recent bug fixes
context_get
{
  "keyPattern": "bug_.*|fix_.*",
  "category": "progress",
  "createdAfter": new Date(Date.now() - 7*24*60*60*1000).toISOString(),
  "sort": "created_desc"
}
```

### Pagination for Large Results
```javascript
// Get high-priority items page by page
let offset = 0;
const limit = 20;
let hasMore = true;

while (hasMore) {
  const items = await context_get({
    "priorities": ["high"],
    "sort": "created_desc",
    "limit": limit,
    "offset": offset,
    "includeMetadata": true
  });
  
  console.log(`Page ${offset/limit + 1}: ${items.length} items`);
  
  if (items.length < limit) hasMore = false;
  offset += limit;
}
```

## Batch Operations Examples

### Importing Multiple Items
Save multiple related items in one atomic operation:

```javascript
// Import configuration settings
await context_batch_save({
  items: [
    { key: "api_endpoint", value: "https://api.example.com", category: "note" },
    { key: "api_key", value: "sk-123456", category: "note", priority: "high" },
    { key: "api_timeout", value: "30000", category: "note" },
    { key: "api_retry_count", value: "3", category: "note" }
  ]
});

// Bulk import tasks from planning session
const sprintTasks = [
  { key: "task_001", value: "Set up authentication flow", priority: "high", category: "task", channel: "sprint-15" },
  { key: "task_002", value: "Create user profile page", priority: "normal", category: "task", channel: "sprint-15" },
  { key: "task_003", value: "Add password reset", priority: "high", category: "task", channel: "sprint-15" },
  { key: "task_004", value: "Write API tests", priority: "normal", category: "task", channel: "sprint-15" }
];

await context_batch_save({ 
  items: sprintTasks,
  updateExisting: false  // Don't overwrite if tasks already exist
});
```

### Bulk Updates
Update multiple items at once:

```javascript
// Mark multiple tasks as completed
await context_batch_update({
  updates: [
    { key: "task_001", value: "✓ Set up authentication flow - DONE", priority: "low" },
    { key: "task_002", value: "✓ Create user profile page - DONE", priority: "low" },
    { key: "task_003", value: "✓ Add password reset - DONE", priority: "low" }
  ]
});

// Move items to archive channel
await context_batch_update({
  updates: [
    { key: "old_decision_1", channel: "archive-2024" },
    { key: "old_decision_2", channel: "archive-2024" },
    { key: "old_decision_3", channel: "archive-2024" }
  ]
});
```

### Batch Deletion
Clean up multiple items safely:

```javascript
// Preview what will be deleted
const preview = await context_batch_delete({
  keyPattern: "temp_*",
  dryRun: true
});
console.log(`Will delete ${preview.deletedCount} temporary items`);

// Actually delete them
if (preview.deletedCount > 0) {
  await context_batch_delete({
    keyPattern: "temp_*"
  });
}

// Delete specific test data
await context_batch_delete({
  keys: ["test_user_1", "test_user_2", "test_config"]
});
```

## Channel Reorganization Examples

### Moving Items Between Channels
Reorganize your context when project structure changes:

```javascript
// Move all auth-related items to dedicated channel
await context_reassign_channel({
  keyPattern: "auth_*",
  toChannel: "feature-authentication"
});

// Consolidate sprint work
await context_reassign_channel({
  fromChannel: "sprint-14-overflow",
  toChannel: "sprint-15",
  category: "task",
  priorities: ["high", "normal"]
});

// Archive completed features
const completed = await context_get({ 
  category: "task", 
  keyPattern: "✓ *" 
});

await context_reassign_channel({
  keys: completed.map(item => item.key),
  toChannel: "completed-tasks"
});
```

## Context Relationships Examples

### Building Task Dependencies
Track relationships between your work items:

```javascript
// Create epic with subtasks
await context_save({ 
  key: "epic_user_management", 
  value: "Complete user management system",
  category: "task",
  priority: "high"
});

// Create subtasks and link them
const subtasks = [
  { key: "task_user_crud", value: "User CRUD operations" },
  { key: "task_user_roles", value: "Role-based permissions" },
  { key: "task_user_profile", value: "User profile page" }
];

for (const task of subtasks) {
  await context_save(task);
  await context_link({
    sourceKey: "epic_user_management",
    targetKey: task.key,
    relationship: "contains"
  });
}

// Add dependencies between tasks
await context_link({
  sourceKey: "task_user_profile",
  targetKey: "task_user_crud",
  relationship: "depends_on",
  metadata: { reason: "Profile needs user data" }
});

// Find all epic subtasks
const epicTasks = await context_get_related({
  key: "epic_user_management",
  relationship: "contains"
});
```

### Tracking Documentation
Link code changes to their documentation:

```javascript
// Save implementation note
await context_save({
  key: "impl_auth_service",
  value: "Implemented JWT authentication in auth.service.ts",
  category: "progress"
});

// Save documentation
await context_save({
  key: "doc_auth_guide",
  value: "Authentication guide covering JWT setup and usage",
  category: "note"
});

// Link them
await context_link({
  sourceKey: "impl_auth_service",
  targetKey: "doc_auth_guide",
  relationship: "documented_in"
});

// Later, find all items with documentation
const documented = await context_get_related({
  key: "doc_auth_guide",
  direction: "incoming"
});
```

### Analyzing Impact
Understand what will be affected by changes:

```javascript
// Set up service dependencies
await context_link({
  sourceKey: "service_frontend",
  targetKey: "service_api",
  relationship: "depends_on"
});

await context_link({
  sourceKey: "service_api",
  targetKey: "service_database",
  relationship: "depends_on"
});

await context_link({
  sourceKey: "service_api",
  targetKey: "service_cache",
  relationship: "depends_on"
});

// Find everything that depends on the database
const impacted = await context_get_related({
  key: "service_database",
  relationship: "depends_on",
  direction: "incoming",
  depth: 2  // Check 2 levels deep
});

console.log(`Database change will impact: ${impacted.items.map(i => i.key).join(', ')}`);
```

## Real-time Monitoring Examples

### Watching for Changes
Monitor context changes in real-time:

```javascript
// Create a watcher for high-priority tasks
const watcher = await context_watch({
  action: "create",
  filters: {
    categories: ["task"],
    priorities: ["high"],
    channels: ["sprint-15"]
  }
});

console.log(`Watching for high-priority tasks. Watcher ID: ${watcher.watcherId}`);

// Poll for changes every 30 seconds
setInterval(async () => {
  const changes = await context_watch({
    action: "poll",
    watcherId: watcher.watcherId,
    timeout: 0  // Immediate return
  });
  
  if (changes.items.length > 0) {
    console.log(`New/updated items: ${changes.items.length}`);
    changes.items.forEach(item => {
      console.log(`- ${item.changeType}: ${item.key} - ${item.value}`);
    });
  }
}, 30000);

// Stop watching when done
await context_watch({
  action: "stop",
  watcherId: watcher.watcherId
});
```

### Team Activity Dashboard
Monitor team progress across channels:

```javascript
// Watch all team channels
const teamWatcher = await context_watch({
  action: "create",
  filters: {
    channels: ["frontend", "backend", "devops"],
    categories: ["progress", "task"]
  }
});

// Check for updates
const updates = await context_watch({
  action: "poll",
  watcherId: teamWatcher.watcherId
});

// Group by channel
const byChannel = {};
updates.items.forEach(item => {
  if (!byChannel[item.channel]) byChannel[item.channel] = [];
  byChannel[item.channel].push(item);
});

// Display summary
Object.entries(byChannel).forEach(([channel, items]) => {
  console.log(`${channel}: ${items.length} updates`);
});
```

### Enhanced Timeline with Details
```javascript
// Get detailed timeline for today
context_timeline
{
  "groupBy": "hour",
  "includeItems": true,        // Show actual items
  "categories": ["task", "progress"],
  "relativeTime": true,        // "2 hours ago" format
  "itemsPerPeriod": 5         // Max 5 items per hour
}

// Weekly summary with all details
context_timeline
{
  "startDate": "2025-01-20T00:00:00Z",
  "endDate": "2025-01-26T23:59:59Z",
  "groupBy": "day",
  "includeItems": true,
  "itemsPerPeriod": 10        // Top 10 items per day
}
```

### Combining Filters
```javascript
// Complex query: Recent high-priority auth tasks from feature branch
context_get
{
  "channel": "feature-auth",
  "category": "task", 
  "priorities": ["high"],
  "keyPattern": "auth_.*",
  "createdAfter": new Date(Date.now() - 48*60*60*1000).toISOString(),
  "sort": "priority",          // Sort by priority first
  "includeMetadata": true,
  "limit": 10
}

// Find stale decisions that might need review
context_get
{
  "category": "decision",
  "createdBefore": new Date(Date.now() - 60*24*60*60*1000).toISOString(), // 60+ days old
  "sort": "created_asc",
  "includeMetadata": true
}
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

## Knowledge Graph Examples

### Understanding Code Relationships
Extract entities and relationships from your work:

```typescript
// After working on several files
await context_save({
  key: "auth_implementation",
  value: "The AuthService class uses JWTTokenManager and calls UserRepository.findByEmail",
  category: "progress"
});

await context_save({
  key: "file_changes",
  value: "Modified auth.service.ts which imports from token.manager.ts and user.repository.ts",
  category: "note"
});

// Analyze to build knowledge graph
await context_analyze();
// Output: 
// Entities created: 5 (AuthService, JWTTokenManager, UserRepository, auth.service.ts, etc.)
// Relations created: 3 (uses, calls, imports)

// Find what's connected to AuthService
await context_find_related({ 
  key: "AuthService",
  maxDepth: 2 
});
// Shows: JWTTokenManager, UserRepository, and files that contain them

// Visualize the relationships
const graph = await context_visualize({ type: "graph" });
// Returns nodes and edges for visualization
```

### Tracking Complex Dependencies
When working on interconnected systems:

```typescript
// As you explore the codebase
await context_save({
  key: "api_structure",
  value: "The UserController handles /api/users endpoints and uses UserService",
  category: "note"
});

await context_save({
  key: "service_layer",
  value: "UserService implements IUserService interface and calls UserRepository",
  category: "note"  
});

await context_save({
  key: "data_layer",
  value: "UserRepository extends BaseRepository and connects to PostgreSQL",
  category: "note"
});

// Build the knowledge graph
await context_analyze();

// Find all database-related entities
await context_find_related({
  key: "PostgreSQL",
  relationTypes: ["connects", "stores_in"]
});

// Get a timeline of your discoveries
await context_visualize({ type: "timeline" });
```

## Semantic Search Examples

### Natural Language Queries
Find context using conversational queries:

```typescript
// Ask questions naturally
await context_semantic_search({
  query: "what did we decide about authentication?"
});
// Returns decisions about JWT tokens, session handling, etc.

await context_semantic_search({
  query: "any bugs or issues with the database?"
});
// Finds context items mentioning database problems

await context_semantic_search({
  query: "what needs to be done for security?"
});
// Finds security-related tasks and notes
```

### Finding Related Work
Discover connections between different parts of your work:

```typescript
// After working on authentication
await context_save({
  key: "auth_complete",
  value: "Finished implementing JWT authentication with refresh tokens",
  category: "progress"
});

// Find related work
await context_semantic_search({
  query: "JWT token refresh authentication security",
  topK: 10
});
// Shows all related context: decisions, tasks, progress, warnings

// Find similar implementations
await context_semantic_search({
  query: "Repository pattern data access layer",
  minSimilarity: 0.4
});
```

### Debugging with Semantic Search
Use natural language to find relevant debugging context:

```typescript
// When investigating an issue
await context_semantic_search({
  query: "memory leak WebSocket connection error",
  topK: 5
});

// Find previous similar issues
await context_semantic_search({
  query: "performance optimization database queries slow",
  minSimilarity: 0.3
});

// Search for specific error patterns
await context_semantic_search({
  query: "null pointer exception undefined error",
  sessionId: "previous-debugging-session-id"
});
```

## Multi-Agent Analysis Examples

### Getting Deep Insights
Use the multi-agent system to analyze your work patterns:

```javascript
// Analyze your work patterns
await mcp_context_delegate({
  taskType: "analyze",
  input: {
    analysisType: "patterns"
  }
})
// Shows category distribution, priority patterns, temporal activity, keywords

// Get comprehensive analysis with all insights
await mcp_context_delegate({
  taskType: "analyze",
  input: {
    analysisType: "comprehensive"
  }
})
// Returns patterns + relationships + trends + overall insights
```

### Intelligent Summaries
Generate context-aware summaries:

```javascript
// Create a focused summary
await mcp_context_delegate({
  taskType: "synthesize",
  input: {
    synthesisType: "summary",
    categories: ["task", "decision"],
    maxLength: 500
  }
})

// Get actionable recommendations
await mcp_context_delegate({
  taskType: "synthesize",
  input: {
    synthesisType: "recommendations",
    analysisResults: {
      highPriorityCount: 15,
      contextSize: 2000
    }
  }
})
// Returns immediate actions, short-term goals, and warnings
```

### Advanced Agent Chaining
Process complex analysis workflows:

```javascript
// Analyze then synthesize in one command
await mcp_context_delegate({
  chain: true,
  taskType: ["analyze", "synthesize"],
  input: [
    { 
      analysisType: "comprehensive",
      timeframe: "-7 days"
    },
    { 
      synthesisType: "recommendations"
    }
  ]
})
// First analyzes all patterns, then generates recommendations based on findings
```

## Advanced Features Examples (Phase 4.4)

### Branching Workflow
Use branches to explore different solutions:

```javascript
// Working on a complex refactor
await mcp_context_save({
  key: "refactor_plan",
  value: "Refactor authentication to use OAuth2",
  category: "task",
  priority: "high"
});

// Create a branch to try one approach
await mcp_context_branch_session({
  branchName: "oauth-passport-approach",
  copyDepth: "deep"
});

// Work on the branch...
await mcp_context_save({
  key: "passport_implementation",
  value: "Using Passport.js with Google strategy",
  category: "progress"
});

// If it doesn't work out, switch back
await mcp_context_session_list(); // Find original session
// Or merge if successful
await mcp_context_merge_sessions({
  sourceSessionId: "branch-id",
  conflictResolution: "keep_source"
});
```

### Daily Journal Pattern
Track your daily progress and thoughts:

```javascript
// Morning entry
await mcp_context_journal_entry({
  entry: "Starting work on user dashboard. Goal: complete layout and basic functionality",
  tags: ["planning", "dashboard"],
  mood: "motivated"
});

// Midday reflection
await mcp_context_journal_entry({
  entry: "Hit a snag with responsive design. Taking a different approach using grid instead of flexbox",
  tags: ["challenge", "css", "dashboard"],
  mood: "frustrated"
});

// End of day
await mcp_context_journal_entry({
  entry: "Dashboard layout complete! Grid approach worked perfectly. Ready for functionality tomorrow",
  tags: ["success", "dashboard"],
  mood: "accomplished"
});

// Review the day
await mcp_context_timeline({
  groupBy: "hour",
  startDate: new Date().toISOString().split('T')[0]
});
```

### Space Management with Compression
Keep your context database lean:

```javascript
// Check current session size
await mcp_context_status();

// Compress old low-priority items
await mcp_context_compress({
  olderThan: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
  preserveCategories: ["decision", "task"], // Keep important categories
});

// Compress everything except recent work
await mcp_context_compress({
  olderThan: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
  preserveCategories: ["decision", "critical"],
});
```

### Tool Integration Workflow
Track events from your development tools:

```javascript
// Linter results
await mcp_context_integrate_tool({
  toolName: "eslint",
  eventType: "lint-complete",
  data: {
    errors: 0,
    warnings: 5,
    filesChecked: 45
  }
});

// Test results
await mcp_context_integrate_tool({
  toolName: "jest",
  eventType: "test-run",
  data: {
    passed: 95,
    failed: 2,
    coverage: 87.5,
    important: true // Failed tests are important
  }
});

// Build status
await mcp_context_integrate_tool({
  toolName: "webpack",
  eventType: "build-complete",
  data: {
    duration: "2m 15s",
    bundleSize: "1.2MB",
    success: true
  }
});
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