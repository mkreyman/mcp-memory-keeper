# MCP Memory Keeper - Recipe Book

## Table of Contents
- [Daily Development Patterns](#daily-development-patterns)
- [Complex Workflow Patterns](#complex-workflow-patterns)
- [Multi-Branch Development](#multi-branch-development) (NEW v0.10.0)
- [Finding Recent Work](#finding-recent-work) (NEW v0.10.0)
- [Cross-Session Coordination](#cross-session-coordination) (NEW v0.10.0)
- [Team Collaboration Patterns](#team-collaboration-patterns)
- [Debugging & Troubleshooting](#debugging--troubleshooting)
- [Performance Optimization](#performance-optimization)
- [Advanced Techniques](#advanced-techniques)

## Daily Development Patterns

### The Daily Standup Pattern
Save yesterday's progress and today's plan:

```typescript
// Start of day - review yesterday
const sessions = await context_session_list({ limit: 3 });
const yesterday = sessions[0]; // Most recent session

// Start today's session
await context_session_start({ 
  name: `${new Date().toISOString().split('T')[0]} Work`,
  continueFrom: yesterday.id,
  description: "Sprint 15 - User Management" 
});

// Get yesterday's incomplete tasks
const incompleteTasks = await context_get({ 
  sessionId: yesterday.id,
  category: "task" 
});

// During standup
await context_save({ 
  key: "standup_blockers",
  value: "Waiting on API documentation from backend team",
  category: "task",
  priority: "high"
});

await context_save({
  key: "standup_today",
  value: "Complete user deletion feature, start bulk import",
  category: "task",
  priority: "high"
});

// End of standup - checkpoint
await context_checkpoint({ 
  name: "post-standup",
  description: "Daily plan captured" 
});
```

### The Code Review Pattern
Track feedback and required changes systematically:

```typescript
// Before starting review
await context_checkpoint({ 
  name: `pre-review-pr-${prNumber}`,
  includeFiles: true,
  includeGitStatus: true 
});

// During review - capture all feedback
const feedbackItems = [
  { area: "auth", feedback: "Add rate limiting to login endpoint", priority: "high" },
  { area: "auth", feedback: "Validate email format", priority: "normal" },
  { area: "tests", feedback: "Add edge case for expired tokens", priority: "high" },
  { area: "docs", feedback: "Update API documentation", priority: "low" }
];

for (const item of feedbackItems) {
  await context_save({
    key: `review_${prNumber}_${item.area}`,
    value: item.feedback,
    category: "task",
    priority: item.priority,
    metadata: JSON.stringify({ pr: prNumber, reviewer: "john_doe" })
  });
}

// Track implementation progress
await context_save({
  key: `review_${prNumber}_progress`,
  value: "Completed 3/4 feedback items, docs remaining",
  category: "progress"
});

// After completing all changes
await context_save({
  key: `review_${prNumber}_complete`,
  value: `All feedback addressed. Changes: ${changesSummary}`,
  category: "progress",
  metadata: JSON.stringify({ completedAt: new Date().toISOString() })
});

// Create post-review checkpoint
await context_checkpoint({
  name: `post-review-pr-${prNumber}`,
  description: "All review feedback implemented"
});
```

### The Feature Branch Pattern
Manage feature development with context isolation:

```typescript
// Starting new feature branch
await context_session_start({
  name: "Feature: Two-Factor Auth",
  description: "Implement 2FA with TOTP and SMS",
  metadata: JSON.stringify({ 
    branch: "feature/two-factor-auth",
    jiraTicket: "AUTH-123" 
  })
});

// Save feature requirements
await context_save({
  key: "feature_requirements",
  value: "Support TOTP (Google Auth), SMS backup, recovery codes",
  category: "task",
  priority: "high"
});

// Track design decisions
await context_save({
  key: "design_2fa_library",
  value: "Using speakeasy for TOTP - well maintained, TypeScript support",
  category: "decision",
  priority: "high"
});

// Before switching branches
await context_checkpoint({
  name: "feature-2fa-wip",
  includeFiles: true,
  includeGitStatus: true,
  description: "Work in progress - TOTP done, SMS pending"
});

// Switch branches and work on hotfix...

// Return to feature
await context_restore_checkpoint({
  name: "feature-2fa-wip",
  restoreFiles: false // Don't restore files, just context
});
```

## Complex Workflow Patterns

### The Debugging Session Pattern
Systematic bug investigation with full context tracking:

```typescript
// Initialize debugging session
await context_session_start({
  name: `Debug: ${bugId}`,
  description: issueDescription,
  metadata: JSON.stringify({ 
    bugId, 
    severity: "high",
    reportedBy: "customer" 
  })
});

// Save initial state
await context_save({
  key: "bug_description",
  value: "Users report login fails after password reset",
  category: "task",
  priority: "high"
});

// Track reproduction steps
await context_save({
  key: "reproduction_steps",
  value: "1. Reset password\n2. Click email link\n3. Set new password\n4. Try to login - fails",
  category: "note"
});

// Cache relevant files for investigation
const filesToInvestigate = [
  "src/auth/password-reset.ts",
  "src/auth/login.ts",
  "src/models/user.ts"
];

for (const file of filesToInvestigate) {
  await context_cache_file({
    filePath: file,
    content: await readFile(file)
  });
}

// Track hypotheses
const hypotheses = [
  "Token expiration too short",
  "Password hash mismatch",
  "Session not cleared properly",
  "Database sync issue"
];

for (let i = 0; i < hypotheses.length; i++) {
  await context_save({
    key: `hypothesis_${i + 1}`,
    value: hypotheses[i],
    category: "decision",
    metadata: JSON.stringify({ tested: false })
  });
}

// Test each hypothesis
await context_save({
  key: "test_token_expiry",
  value: "Token TTL is 24h, user reported issue after 5 min - not the cause",
  category: "progress"
});

// Found root cause
await context_save({
  key: "root_cause",
  value: "bcrypt rounds mismatch: reset uses 10, login expects 12",
  category: "decision",
  priority: "high",
  metadata: JSON.stringify({ 
    foundAt: new Date().toISOString(),
    fileLocation: "src/auth/password-reset.ts:47" 
  })
});

// Document fix
await context_save({
  key: "fix_applied",
  value: "Updated password-reset.ts to use consistent bcrypt rounds",
  category: "progress",
  metadata: JSON.stringify({ 
    commit: "abc123",
    files: ["src/auth/password-reset.ts"] 
  })
});

// Create debugging artifact
await context_export({
  sessionId: currentSessionId,
  outputPath: `./debug-artifacts/bug-${bugId}.json`
});
```

### The Refactoring Pattern
Safe, trackable refactoring with rollback capability:

```typescript
// Pre-refactor analysis
await context_save({
  key: "refactor_scope",
  value: "Convert callback-based auth to async/await",
  category: "task",
  priority: "high"
});

// Create safety checkpoint
await context_checkpoint({
  name: "pre-refactor-auth-async",
  includeFiles: true,
  includeGitStatus: true,
  description: "Before converting to async/await"
});

// Track files being refactored
const refactorFiles = [
  "src/auth/login.js",
  "src/auth/logout.js", 
  "src/auth/refresh.js"
];

for (const file of refactorFiles) {
  await context_cache_file({
    filePath: file,
    content: await readFile(file),
    metadata: JSON.stringify({ purpose: "refactor_backup" })
  });
}

// Track refactoring decisions
await context_save({
  key: "refactor_decision_error_handling",
  value: "Use try/catch with custom AuthError class",
  category: "decision"
});

// Progress tracking
await context_save({
  key: "refactor_progress_1",
  value: "Completed login.js - all tests passing",
  category: "progress",
  metadata: JSON.stringify({ 
    testsRun: 15,
    testsPassed: 15 
  })
});

// Mid-refactor checkpoint
await context_checkpoint({
  name: "mid-refactor-auth-async",
  description: "Login complete, logout/refresh pending"
});

// If something goes wrong
if (testsFailling) {
  await context_restore_checkpoint({
    name: "pre-refactor-auth-async",
    restoreFiles: true
  });
}
```

### The Learning New Codebase Pattern
Build mental model of unfamiliar code:

```typescript
// Start exploration session
await context_session_start({
  name: "Learning: E-commerce Platform",
  description: "Understanding architecture and key flows"
});

// Map high-level architecture
await context_save({
  key: "architecture_overview",
  value: "Microservices: API Gateway -> Auth, Catalog, Orders, Payment",
  category: "note",
  priority: "high"
});

// Track key discoveries
await context_save({
  key: "discovery_auth_flow",
  value: "JWT with refresh tokens, Redis for sessions, 15min access token TTL",
  category: "note"
});

// Map important files
const keyFiles = {
  "src/gateway/index.ts": "API Gateway entry point",
  "src/auth/jwt.ts": "JWT token management",
  "src/orders/workflow.ts": "Order processing state machine"
};

for (const [file, description] of Object.entries(keyFiles)) {
  await context_save({
    key: `file_map_${file.replace(/\//g, '_')}`,
    value: `${file}: ${description}`,
    category: "note"
  });
  
  await context_cache_file({
    filePath: file,
    content: await readFile(file)
  });
}

// Document flows
await context_save({
  key: "flow_user_checkout",
  value: "Cart -> Validate Inventory -> Create Order -> Process Payment -> Update Inventory -> Send Confirmation",
  category: "note",
  priority: "high"
});

// Track questions for team
await context_save({
  key: "question_payment_retry",
  value: "How are failed payments retried? Don't see retry logic in payment service",
  category: "task",
  priority: "normal"
});

// Create learning checkpoint
await context_checkpoint({
  name: "codebase-exploration-day-1",
  description: "Initial exploration complete"
});
```

## Multi-Branch Development (NEW v0.10.0)

### The Feature Branch Context Pattern
Keep context organized across multiple feature branches:

```typescript
// Set project directory for auto-channel detection
await context_session_start({
  name: "Multi-Feature Development",
  projectDir: "/path/to/project"
});

// Working on auth feature (git branch: feature/auth)
await context_save({
  key: "auth_architecture",
  value: "JWT with refresh tokens, 15min/7day expiry",
  category: "decision",
  priority: "high"
  // Auto-saved to "feature-auth" channel
});

await context_save({
  key: "auth_progress",
  value: "Login/logout complete, working on password reset",
  category: "progress"
  // Auto-saved to "feature-auth" channel
});

// Switch to payments branch (git checkout feature/payments)
await context_save({
  key: "payment_provider",
  value: "Stripe for cards, considering PayPal for international",
  category: "decision",
  priority: "high"
  // Auto-saved to "feature-payments" channel
});

// Later: Review all features
const features = ["feature-auth", "feature-payments", "feature-ui"];
for (const channel of features) {
  const items = await context_get({ 
    channel: channel,
    category: "decision",
    includeMetadata: true
  });
  console.log(`${channel}: ${items.length} decisions`);
}

// Find high-priority items across ALL features
const urgent = await context_get({
  priorities: ["high"],
  sort: "created_desc",
  limit: 10
  // No channel specified = search all channels
});
```

### The Branch Status Dashboard Pattern
Track progress across multiple branches:

```typescript
// Create a status overview function
async function getBranchStatus() {
  const branches = {
    "feature-auth": "Authentication System",
    "feature-payments": "Payment Processing", 
    "feature-search": "Advanced Search",
    "bugfix-memory-leak": "Memory Leak Fix"
  };
  
  const status = {};
  
  for (const [channel, description] of Object.entries(branches)) {
    // Get progress items from last 7 days
    const progress = await context_get({
      channel: channel,
      category: "progress",
      createdAfter: new Date(Date.now() - 7*24*60*60*1000).toISOString(),
      sort: "created_desc",
      limit: 1
    });
    
    // Get open tasks
    const tasks = await context_get({
      channel: channel,
      category: "task",
      priorities: ["high", "normal"]
    });
    
    status[channel] = {
      description,
      lastProgress: progress[0]?.value || "No recent updates",
      openTasks: tasks.length,
      lastUpdate: progress[0]?.metadata?.createdAt || "Unknown"
    };
  }
  
  return status;
}

// Use it for daily standup
const branchStatus = await getBranchStatus();
console.log("Branch Status Report:", JSON.stringify(branchStatus, null, 2));
```

### The Branch Merge Preparation Pattern
Prepare context when merging branches:

```typescript
// Before merging feature branch
const featureChannel = "feature-user-profile";

// Get all decisions made in this feature
const decisions = await context_get({
  channel: featureChannel,
  category: "decision",
  includeMetadata: true
});

// Get unresolved issues
const issues = await context_get({
  channel: featureChannel,
  category: "task",
  keyPattern: "issue_.*|bug_.*"
});

// Create merge summary
await context_save({
  key: "merge_summary_user_profile",
  value: JSON.stringify({
    decisions: decisions.map(d => ({ key: d.key, value: d.value })),
    unresolvedIssues: issues.map(i => i.value),
    mergeDate: new Date().toISOString()
  }),
  category: "note",
  priority: "high",
  channel: "main"  // Save to main branch channel
});

// Archive feature context
await context_checkpoint({
  name: `archive-${featureChannel}`,
  description: "Pre-merge archive of user profile feature"
});
```

## Finding Recent Work (NEW v0.10.0)

### The "What Was I Doing?" Pattern
Quickly find what you were working on:

```typescript
// Find everything from the last 2 hours
const twoHoursAgo = new Date(Date.now() - 2*60*60*1000).toISOString();
const recent = await context_get({
  createdAfter: twoHoursAgo,
  sort: "created_desc",
  includeMetadata: true
});

console.log("Recent activity:");
recent.forEach(item => {
  const time = new Date(item.metadata.createdAt);
  const timeAgo = Math.round((Date.now() - time) / 60000);
  console.log(`${timeAgo}m ago: ${item.key} - ${item.value.substring(0, 50)}...`);
});

// Get today's high-priority items
const today = new Date().toISOString().split('T')[0];
const priorities = await context_get({
  createdAfter: `${today}T00:00:00Z`,
  priorities: ["high"],
  sort: "priority",
  includeMetadata: true
});
```

### The Weekly Review Pattern
Review your week's work:

```typescript
// Get this week's progress
const weekStart = new Date();
weekStart.setDate(weekStart.getDate() - weekStart.getDay());

// Timeline with actual items
const weekActivity = await context_timeline({
  startDate: weekStart.toISOString(),
  groupBy: "day",
  includeItems: true,
  categories: ["progress", "decision"],
  itemsPerPeriod: 5
});

// Find decisions that might need review
const oldDecisions = await context_get({
  category: "decision",
  createdBefore: new Date(Date.now() - 30*24*60*60*1000).toISOString(),
  sort: "created_asc",
  includeMetadata: true
});

console.log(`Found ${oldDecisions.length} decisions older than 30 days that might need review`);

// Get completed tasks
const completedTasks = await context_get({
  category: "progress",
  createdAfter: weekStart.toISOString(),
  keyPattern: ".*complete.*|.*done.*|.*fixed.*",
  sort: "created_desc"
});
```

### The Sprint Velocity Pattern
Track your productivity patterns:

```typescript
// Analyze last 2 weeks
const twoWeeksAgo = new Date(Date.now() - 14*24*60*60*1000);

// Get daily task completion
async function getVelocityData() {
  const velocity = {};
  
  for (let i = 0; i < 14; i++) {
    const dayStart = new Date(twoWeeksAgo);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    
    const dayKey = dayStart.toISOString().split('T')[0];
    
    // Count completed items
    const completed = await context_get({
      category: "progress",
      createdAfter: dayStart.toISOString(),
      createdBefore: dayEnd.toISOString()
    });
    
    // Count new tasks
    const newTasks = await context_get({
      category: "task",
      createdAfter: dayStart.toISOString(),
      createdBefore: dayEnd.toISOString()
    });
    
    velocity[dayKey] = {
      completed: completed.length,
      created: newTasks.length,
      netProgress: completed.length - newTasks.length
    };
  }
  
  return velocity;
}

const velocity = await getVelocityData();
console.log("Two-week velocity:", velocity);
```

## Cross-Session Coordination (NEW v0.10.0)

### The Continuous Context Pattern
Maintain context across Claude restarts:

```typescript
// Before potential context limit
async function saveWorkState() {
  // Get current high-priority items
  const critical = await context_get({
    priorities: ["high"],
    createdAfter: new Date(Date.now() - 24*60*60*1000).toISOString(),
    includeMetadata: true
  });
  
  // Save state summary
  await context_save({
    key: "work_state_summary",
    value: JSON.stringify({
      timestamp: new Date().toISOString(),
      activeItems: critical.map(i => ({ key: i.key, value: i.value })),
      lastActivity: "Implementing OAuth2 callback handler"
    }),
    category: "note",
    priority: "high"
  });
  
  // Create checkpoint
  await context_checkpoint({
    name: "work-state-checkpoint",
    description: "Pre-compaction work state"
  });
}

// In new session
async function restoreWorkState() {
  // Check for recent work state
  const state = await context_get({
    key: "work_state_summary",
    includeMetadata: true
  });
  
  if (state.length > 0) {
    const workState = JSON.parse(state[0].value);
    console.log(`Resuming from ${workState.timestamp}`);
    console.log(`Last activity: ${workState.lastActivity}`);
    console.log(`Active items: ${workState.activeItems.length}`);
  }
  
  // Get recent items from all channels
  const recent = await context_get({
    createdAfter: new Date(Date.now() - 4*60*60*1000).toISOString(),
    sort: "updated_desc",
    limit: 20,
    includeMetadata: true
  });
  
  return recent;
}
```

### The Cross-Channel Search Pattern
Find information across all your work:

```typescript
// Search across all channels for related work
async function findRelatedWork(topic) {
  // Search by pattern
  const patternResults = await context_get({
    keyPattern: `.*${topic}.*`,
    includeMetadata: true
  });
  
  // Search in specific time window
  const recentResults = await context_get({
    createdAfter: new Date(Date.now() - 7*24*60*60*1000).toISOString(),
    includeMetadata: true
  });
  
  // Filter recent results for topic
  const relevantRecent = recentResults.filter(item => 
    item.value.toLowerCase().includes(topic.toLowerCase()) ||
    item.key.toLowerCase().includes(topic.toLowerCase())
  );
  
  // Combine and deduplicate
  const allResults = [...patternResults, ...relevantRecent];
  const unique = Array.from(new Map(allResults.map(item => [item.id, item])).values());
  
  // Group by channel
  const byChannel = {};
  unique.forEach(item => {
    const channel = item.channel || 'default';
    if (!byChannel[channel]) byChannel[channel] = [];
    byChannel[channel].push(item);
  });
  
  return byChannel;
}

// Use it
const authWork = await findRelatedWork("authentication");
console.log("Authentication work found in channels:", Object.keys(authWork));
```

### The Time-Based Context Aggregation Pattern
Aggregate context over time periods:

```typescript
// Daily aggregation function
async function aggregateDailyContext(daysBack = 7) {
  const aggregated = {};
  
  for (let i = 0; i < daysBack; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayStart = new Date(date.setHours(0,0,0,0));
    const dayEnd = new Date(date.setHours(23,59,59,999));
    
    const dayKey = dayStart.toISOString().split('T')[0];
    
    // Get all items for this day
    const dayItems = await context_get({
      createdAfter: dayStart.toISOString(),
      createdBefore: dayEnd.toISOString(),
      includeMetadata: true
    });
    
    // Categorize
    const categorized = {
      tasks: dayItems.filter(i => i.category === 'task'),
      progress: dayItems.filter(i => i.category === 'progress'),
      decisions: dayItems.filter(i => i.category === 'decision'),
      total: dayItems.length
    };
    
    // Get unique channels
    const channels = [...new Set(dayItems.map(i => i.channel || 'default'))];
    
    aggregated[dayKey] = {
      ...categorized,
      channels: channels,
      highlights: dayItems.filter(i => i.priority === 'high').map(i => i.value)
    };
  }
  
  return aggregated;
}

// Generate weekly report
const weekData = await aggregateDailyContext(7);
console.log("Week Summary:", JSON.stringify(weekData, null, 2));

// Find most productive day
const mostProductive = Object.entries(weekData)
  .sort((a, b) => b[1].progress.length - a[1].progress.length)[0];
console.log(`Most productive day: ${mostProductive[0]} with ${mostProductive[1].progress.length} completed items`);
```

## Team Collaboration Patterns

### Cross-Session Knowledge Sharing (v0.9.0+)
Share discoveries and solutions across different AI sessions:

```typescript
// Developer A discovers a tricky bug fix - automatically shared!
await context_save({
  key: "elixir_genserver_timeout_fix",
  value: "Set :infinity timeout for long-running GenServer calls to prevent crashes",
  category: "solution",
  priority: "high"
  // Note: This is automatically accessible from ALL sessions (public by default)
});

// Developer B in another session can immediately access it
const fix = await context_get({ key: "elixir_genserver_timeout_fix" });

// Or search for it across all sessions
const results = await context_search_all({ 
  query: "elixir timeout" 
});

// For session-specific notes, use private flag
await context_save({
  key: "my_debug_session",
  value: "Debugging GenServer locally with IO.inspect",
  category: "note",
  private: true  // Only visible in current session
});

### The Enhanced Handoff Pattern (v0.9.0+)
Smooth work transitions between team members with cross-session sharing:

```typescript
// Prepare handoff with structured data - automatically shared!
await context_save({
  key: "handoff_status",
  value: JSON.stringify({
    completed: ["user auth module", "password reset"],
    inProgress: "email verification - 80% done",
    nextSteps: ["finish email templates", "add rate limiting"],
    blockers: ["need SMTP credentials from DevOps"],
    sessionId: currentSessionId
  }),
  category: "progress",
  priority: "high"
  // Note: This is automatically accessible from ALL sessions (public by default)
});

// Next developer in another session retrieves handoff
const handoffItem = await context_get({ key: "handoff_status" });
const status = JSON.parse(handoffItem.value);

// Or search for handoff items
const handoffs = await context_search_all({ query: "handoff" });

// Document current state
const handoffDetails = {
  completed: [
    "User registration with email verification",
    "Login/logout with JWT",
    "Password reset flow"
  ],
  inProgress: [
    "Role-based permissions (50% done)",
    "Admin user management UI"
  ],
  blocked: [
    "SSO integration - waiting for OAuth credentials"
  ],
  nextSteps: [
    "Complete permissions middleware",
    "Test with admin role",
    "Start on user groups"
  ]
};

await context_save({
  key: "handoff_details",
  value: JSON.stringify(handoffDetails, null, 2),
  category: "note",
  priority: "high"
});

// Key decisions for next person
await context_save({
  key: "handoff_decision_permissions",
  value: "Using RBAC with hierarchical roles. See src/auth/rbac.ts",
  category: "decision",
  priority: "high"
});

// Export for sharing
await context_export({
  sessionId: currentSessionId,
  outputPath: "./handoff-export.json",
  metadata: {
    handoffTo: "teammate@company.com",
    date: new Date().toISOString()
  }
});

// Create checkpoint
await context_checkpoint({
  name: `handoff-${new Date().toISOString().split('T')[0]}`,
  description: "Handoff to Sarah for permissions completion"
});
```

### The Pair Programming Pattern
Track decisions and progress during pairing:

```typescript
// Start pairing session
await context_session_start({
  name: "Pair: Refactor Payment Module",
  description: "Alice (driver) & Bob (navigator)",
  metadata: JSON.stringify({
    participants: ["alice", "bob"],
    startTime: new Date().toISOString()
  })
});

// Track decisions made together
await context_save({
  key: "pair_decision_pattern",
  value: "Agreed: Use Strategy pattern for payment providers",
  category: "decision",
  metadata: JSON.stringify({ agreedBy: ["alice", "bob"] })
});

// Switch driver/navigator
await context_save({
  key: "pair_switch_1",
  value: "Switched: Bob driving, Alice navigating",
  category: "note",
  metadata: JSON.stringify({ time: new Date().toISOString() })
});

// Track discoveries
await context_save({
  key: "pair_discovery_bug",
  value: "Found: Race condition in payment confirmation",
  category: "task",
  priority: "high"
});

// End of session summary
await context_save({
  key: "pair_session_summary",
  value: "Refactored 3 payment providers, found and fixed race condition",
  category: "progress"
});
```

### Team Knowledge Base Pattern (v0.9.0+)
Build a shared knowledge base across all sessions:

```typescript
// Create reusable team patterns
const patterns = {
  "error_handling": "Always use Result<T, E> for fallible operations",
  "testing_strategy": "Use property-based testing for data transformations",
  "api_versioning": "Version all APIs with /v1, /v2 prefixes",
  "code_review": "Require 2 approvals for database migrations"
};

// Save team standards - automatically shared!
for (const [key, value] of Object.entries(patterns)) {
  await context_save({
    key: `team_standard_${key}`,
    value: value,
    category: "standard",
    priority: "normal"
    // Note: This is automatically accessible from ALL sessions (public by default)
  });
}

// Any team member can search standards
const apiStandards = await context_search_all({
  query: "api_versioning"
});
```

### Multi-Agent Collaboration Pattern (v0.9.0+)
Different specialized agents work together on complex tasks:

```typescript
// Security audit agent session
await context_session_start({ 
  name: "Security Audit - Sprint 15",
  description: "Automated security scan"
});

const securityFindings = {
  high: [
    { file: "auth.js", line: 45, issue: "SQL injection risk", cwe: "CWE-89" },
    { file: "upload.js", line: 102, issue: "Path traversal", cwe: "CWE-22" }
  ],
  medium: [
    { file: "api.js", line: 78, issue: "Missing rate limiting", cwe: "CWE-770" }
  ]
};

await context_save({
  key: "security_audit_results",
  value: JSON.stringify(securityFindings),
  category: "security",
  priority: "high"
});

// The results are automatically shared with all sessions!

// Development agent addresses issues
await context_session_start({ 
  name: "Security Fixes - Sprint 15"
});

// Development agent retrieves the audit results
const auditResult = await context_get({ key: "security_audit_results" });
const findings = JSON.parse(auditResult.value);

// Fix each high-priority issue
for (const issue of findings.high) {
  await context_save({
    key: `security_fix_${issue.file}_line${issue.line}`,
    value: `Fixed ${issue.issue} (${issue.cwe}) with parameterized queries`,
    category: "progress",
    priority: "high"
  });
}

// Save fix completion status - automatically shared!
await context_save({
  key: "security_fixes_complete",
  value: "All high-priority security issues resolved",
  category: "progress",
  priority: "high"
});
```

### Cross-Team Learning Pattern (v0.9.0+)
Share lessons learned across different teams:

```typescript
// After resolving a complex bug
const lesson = {
  problem: "Users randomly logged out after deployment",
  rootCause: "Redis session store key prefix changed",
  solution: "Added migration to update existing session keys",
  prevention: "Add session persistence tests to deployment checklist",
  timeToResolve: "4 hours",
  impact: "2000 users affected"
};

await context_save({
  key: `lesson_learned_${Date.now()}`,
  value: JSON.stringify(lesson),
  category: "lesson",
  priority: "high",
  metadata: JSON.stringify({
    team: "platform",
    severity: "high",
    tags: ["redis", "sessions", "deployment"]
  })
});

// The lesson is automatically shared with all teams!

// Other teams can learn from this
const redisLessons = await context_search_all({
  query: "redis session"
});

// QA team updates their checklist
await context_save({
  key: "qa_checklist_update",
  value: "Added: Verify session persistence across deployments",
  category: "process"
});
```

## Debugging & Troubleshooting

### The Production Issue Pattern
Rapid response to production problems:

```typescript
// Emergency response
await context_session_start({
  name: `PROD-ISSUE: ${incidentId}`,
  description: "Payment processing failures",
  metadata: JSON.stringify({
    severity: "P1",
    startTime: new Date().toISOString(),
    affectedServices: ["payment", "orders"]
  })
});

// Initial assessment
await context_save({
  key: "incident_symptoms",
  value: "500 errors on /api/payment/process, started 14:32 UTC",
  category: "task",
  priority: "critical"
});

// Track investigation
await context_save({
  key: "incident_metrics",
  value: "Error rate: 87%, Response time: 15s (normal: 200ms)",
  category: "note",
  priority: "high"
});

// Hypothesis and testing
await context_save({
  key: "incident_hypothesis_db",
  value: "Database connection pool exhausted",
  category: "decision"
});

// Temporary fix
await context_save({
  key: "incident_mitigation",
  value: "Increased connection pool from 10 to 50, errors dropping",
  category: "progress",
  priority: "high"
});

// Root cause
await context_save({
  key: "incident_root_cause", 
  value: "Connection leak in payment status checker - connections not released",
  category: "decision",
  priority: "critical"
});

// Permanent fix
await context_save({
  key: "incident_fix",
  value: "Added connection.release() in finally block, deployed to prod",
  category: "progress"
});

// Post-mortem notes
await context_save({
  key: "incident_postmortem",
  value: "Need monitoring on connection pool usage, add to runbook",
  category: "task"
});
```

### The Performance Optimization Pattern
Systematic performance improvement:

```typescript
// Baseline measurement
await context_save({
  key: "perf_baseline",
  value: "API response time: p50=200ms, p95=800ms, p99=2000ms",
  category: "note",
  priority: "high"
});

// Profile results
await context_save({
  key: "perf_bottleneck_1",
  value: "Database query in getUserPermissions taking 600ms",
  category: "task",
  priority: "high"
});

// Cache implementation
await context_save({
  key: "perf_optimization_cache",
  value: "Added Redis cache for permissions, TTL=5min",
  category: "progress"
});

// Results
await context_save({
  key: "perf_results",
  value: "New metrics: p50=50ms, p95=150ms, p99=400ms (80% improvement)",
  category: "progress",
  priority: "high"
});
```

## Performance Optimization

### The Large Context Management Pattern
Handle large codebases efficiently:

```typescript
// Selective context loading
const categories = ["task", "decision"]; // Only load important items
const recentContext = await context_get({
  categories,
  limit: 50,
  priority: "high"
});

// Periodic cleanup
await context_export({
  beforeDate: "2024-01-01",
  outputPath: "./archives/old-context.json"
});

// Compress old sessions
await context_summarize({
  sessionIds: oldSessionIds,
  compress: true
});
```

### The Search Optimization Pattern
Efficient context retrieval:

```typescript
// Index frequently searched terms
const searchIndex = {
  "auth": ["authentication", "login", "jwt", "session"],
  "payment": ["stripe", "checkout", "subscription"],
  "bug": ["error", "fix", "issue", "problem"]
};

// Tag items for faster search
await context_save({
  key: "auth_bug_001",
  value: "Login fails with special characters",
  category: "task",
  tags: ["auth", "bug", "login"],
  metadata: JSON.stringify({ indexed: true })
});

// Batch search operations
const searchTerms = ["auth", "payment", "bug"];
const results = await Promise.all(
  searchTerms.map(term => context_search({ query: term }))
);
```

## Advanced Techniques

### The Multi-Project Pattern
Manage multiple projects with context isolation:

```typescript
// Project-specific sessions
const projects = {
  "frontend": "React Dashboard",
  "backend": "Node.js API", 
  "mobile": "React Native App"
};

for (const [key, name] of Object.entries(projects)) {
  await context_session_start({
    name: `${key}-work`,
    description: name,
    metadata: JSON.stringify({ project: key })
  });
  
  // Project-specific context...
  
  await context_checkpoint({
    name: `${key}-checkpoint`,
    description: `${name} progress`
  });
}

// Switch between projects
await context_restore_checkpoint({
  name: "frontend-checkpoint"
});
```

### The Time-Boxed Exploration Pattern
Explore solutions with controlled scope:

```typescript
// Set exploration boundary
await context_session_start({
  name: "Spike: GraphQL Migration",
  description: "2-hour timebox to evaluate GraphQL",
  metadata: JSON.stringify({
    timeLimit: "2h",
    startTime: new Date().toISOString()
  })
});

// Track findings
await context_save({
  key: "spike_finding_1",
  value: "GraphQL reduces API calls by 40% for dashboard",
  category: "note"
});

// Decision point
await context_save({
  key: "spike_recommendation",
  value: "Proceed with GraphQL for read-heavy endpoints only",
  category: "decision",
  priority: "high"
});

// Export spike results
await context_export({
  sessionId: currentSessionId,
  outputPath: "./spikes/graphql-evaluation.json"
});
```

### The Continuous Learning Pattern
Build knowledge base over time:

```typescript
// Weekly learning checkpoint
await context_checkpoint({
  name: `learning-week-${weekNumber}`,
  description: "Weekly knowledge checkpoint"
});

// Track learnings
await context_save({
  key: "til_typescript_guards",
  value: "Type guards with 'is' keyword for runtime type safety",
  category: "note",
  tags: ["til", "typescript"]
});

// Build personal knowledge graph
await context_save({
  key: "concept_relationship",
  value: "React.memo relates to useMemo - both for performance",
  category: "note",
  metadata: JSON.stringify({
    concepts: ["React.memo", "useMemo"],
    relationship: "performance optimization"
  })
});
```

## Knowledge Graph Patterns

### The Code Architecture Mapping Pattern
Build a comprehensive understanding of your codebase:

```typescript
// Start architecture analysis
await context_session_start({
  name: "Architecture Analysis",
  description: "Building knowledge graph of system components"
});

// Map major components
const components = [
  { name: "AuthService", type: "service", purpose: "User authentication and authorization" },
  { name: "UserRepository", type: "repository", purpose: "User data persistence" },
  { name: "JWTManager", type: "utility", purpose: "JWT token generation and validation" },
  { name: "EmailService", type: "service", purpose: "Email notifications" }
];

for (const component of components) {
  await context_save({
    key: `component_${component.name}`,
    value: `${component.type}: ${component.purpose}`,
    category: "note",
    metadata: JSON.stringify(component)
  });
}

// Map relationships
await context_save({
  key: "relationship_auth_user",
  value: "AuthService uses UserRepository for user lookup",
  category: "note"
});

await context_save({
  key: "relationship_auth_jwt",
  value: "AuthService depends on JWTManager for token operations",
  category: "note"
});

// Analyze to build graph
await context_analyze();

// Find all auth-related components
const authRelated = await context_find_related({
  key: "AuthService",
  maxDepth: 2
});

// Generate visualization
const graph = await context_visualize({ type: "graph" });
```

### The Dependency Tracking Pattern
Track and understand complex dependencies:

```typescript
// Track package dependencies
await context_save({
  key: "dep_express",
  value: "express@4.18.0 - Web framework, used by API routes",
  category: "note"
});

await context_save({
  key: "dep_bcrypt",
  value: "bcrypt@5.1.0 - Password hashing, critical for auth security",
  category: "note",
  priority: "high"
});

// Track internal dependencies
await context_save({
  key: "module_dependency_chain",
  value: "OrderController -> OrderService -> OrderRepository -> Database",
  category: "note"
});

// Security audit trail
await context_save({
  key: "security_dep_review",
  value: "Reviewed all auth dependencies for vulnerabilities - all clear",
  category: "decision",
  priority: "high",
  metadata: JSON.stringify({ 
    reviewDate: new Date().toISOString(),
    nextReview: "2024-04-01" 
  })
});
```

## Semantic Search Patterns

### The Natural Language Documentation Pattern
Make your context searchable with conversational queries:

```typescript
// Document in natural language
await context_save({
  key: "how_auth_works",
  value: "Our authentication system uses JWT tokens with 15-minute access tokens and 7-day refresh tokens. Users log in with email/password, receive both tokens, and the access token is included in API requests.",
  category: "note",
  priority: "high"
});

await context_save({
  key: "deployment_process",
  value: "To deploy to production: run tests, build Docker image, push to registry, update Kubernetes manifest, apply changes. Rollback by reverting the manifest commit.",
  category: "note"
});

// Search naturally
const authInfo = await context_semantic_search({
  query: "how does user login work?",
  topK: 5
});

const deployInfo = await context_semantic_search({
  query: "what are the steps to deploy?",
  topK: 3
});
```

### The Problem-Solution Mapping Pattern
Link problems to their solutions:

```typescript
// Document problems
await context_save({
  key: "problem_slow_api",
  value: "API responses taking 5+ seconds for user list endpoint",
  category: "task",
  priority: "high"
});

// Document investigation
await context_save({
  key: "investigation_slow_api",
  value: "Found N+1 query problem - fetching permissions for each user separately",
  category: "note"
});

// Document solution
await context_save({
  key: "solution_slow_api",
  value: "Implemented eager loading with JOIN query, reduced response time to 200ms",
  category: "progress"
});

// Later, find similar issues
const similar = await context_semantic_search({
  query: "performance problems with database queries",
  minSimilarity: 0.4
});
```

## Multi-Agent Analysis Patterns

### The Comprehensive Code Review Pattern
Use agents to analyze your work before review:

```typescript
// Analyze your changes
const analysis = await context_delegate({
  taskType: "analyze",
  input: {
    analysisType: "comprehensive",
    timeframe: "-1 day"
  }
});

// Get recommendations
const recommendations = await context_delegate({
  taskType: "synthesize",
  input: {
    synthesisType: "recommendations",
    analysisResults: analysis
  }
});

// Chain for pre-commit check
const preCommitCheck = await context_delegate({
  chain: true,
  taskType: ["analyze", "synthesize"],
  input: [
    { analysisType: "patterns" },
    { synthesisType: "summary", maxLength: 500 }
  ]
});
```

### The Sprint Retrospective Pattern
Analyze sprint patterns and generate insights:

```typescript
// End of sprint analysis
await context_delegate({
  taskType: "analyze",
  input: {
    analysisType: "trends",
    timeframe: "-14 days",
    categories: ["task", "progress", "decision"]
  }
});

// Generate sprint summary
await context_delegate({
  taskType: "synthesize",
  input: {
    synthesisType: "narrative",
    includeMetrics: true,
    includeLearnings: true
  }
});
```

## Session Branching Patterns

### The A/B Implementation Pattern
Try different approaches safely:

```typescript
// Main implementation
await context_save({
  key: "approach_decision",
  value: "Need to implement caching - considering Redis vs in-memory",
  category: "decision",
  priority: "high"
});

// Branch for Redis approach
const redissBranchId = await context_branch_session({
  branchName: "cache-redis-approach",
  copyDepth: "shallow"
});

// Work on Redis implementation
await context_save({
  key: "redis_implementation",
  value: "Implemented distributed cache with Redis, 10ms latency",
  category: "progress"
});

// Branch for in-memory approach
await context_session_start({ id: originalSessionId });
const memoryBranchId = await context_branch_session({
  branchName: "cache-memory-approach", 
  copyDepth: "shallow"
});

// Work on in-memory implementation
await context_save({
  key: "memory_implementation",
  value: "Implemented in-memory LRU cache, 1ms latency but not distributed",
  category: "progress"
});

// Compare and decide
await context_save({
  key: "cache_decision_final",
  value: "Chose Redis - distributed nature crucial for multi-instance deployment",
  category: "decision",
  priority: "high"
});

// Merge the chosen approach
await context_merge_sessions({
  sourceSessionId: redissBranchId,
  conflictResolution: "keep_source"
});
```

### The Safe Experimentation Pattern
Experiment without fear of breaking things:

```typescript
// Before risky changes
await context_checkpoint({
  name: "before-experimental-optimization",
  includeFiles: true,
  includeGitStatus: true
});

// Create experimental branch
await context_branch_session({
  branchName: "experimental-async-refactor",
  copyDepth: "deep"
});

// Document experiments
await context_journal_entry({
  entry: "Trying Promise.all for parallel processing - risky but could 10x performance",
  tags: ["experiment", "performance", "risk"],
  mood: "curious"
});

// If experiment fails
if (experimentFailed) {
  // Just switch back - no cleanup needed
  await context_session_start({ id: originalSessionId });
  
  await context_journal_entry({
    entry: "Experiment failed - Promise.all caused race conditions. Good learning though!",
    tags: ["experiment", "learning", "failed"],
    mood: "disappointed"
  });
}
```

## Time Management Patterns

### The Pomodoro Tracking Pattern
Track productivity with time-boxed sessions:

```typescript
// Start pomodoro
const pomodoroStart = new Date();
await context_save({
  key: `pomodoro_${pomodoroStart.getTime()}_start`,
  value: "Starting 25min focus: Implement user search",
  category: "note",
  metadata: JSON.stringify({ 
    technique: "pomodoro",
    duration: 25,
    startTime: pomodoroStart
  })
});

// End pomodoro
await context_save({
  key: `pomodoro_${pomodoroStart.getTime()}_end`,
  value: "Completed: Basic search working, need to add filters",
  category: "progress"
});

await context_journal_entry({
  entry: "Good focus session. Search is 70% done. Need 1 more pomodoro for filters.",
  tags: ["pomodoro", "productivity"],
  mood: "focused"
});

// Daily summary
const timeline = await context_timeline({
  startDate: new Date().toISOString().split('T')[0],
  groupBy: "hour"
});
```

### The Energy Level Pattern
Track when you're most productive:

```typescript
// Morning check-in
await context_journal_entry({
  entry: "Fresh start, tackling the complex refactoring first",
  tags: ["morning", "energy-high"],
  mood: "energized"
});

// Track complex work
await context_save({
  key: "morning_complex_work",
  value: "Refactored authentication module - redesigned token flow",
  category: "progress",
  metadata: JSON.stringify({ 
    energyLevel: "high",
    complexity: "high",
    timeOfDay: "morning"
  })
});

// Afternoon routine tasks
await context_journal_entry({
  entry: "Energy dipping, switching to code reviews and documentation",
  tags: ["afternoon", "energy-medium"],
  mood: "tired"
});

// Analyze patterns
const energyAnalysis = await context_delegate({
  taskType: "analyze",
  input: {
    analysisType: "patterns",
    focusOn: "productivity-by-time"
  }
});
```

## Integration Patterns

### The CI/CD Context Pattern
Track deployment context:

```typescript
// Pre-deployment checklist
await context_save({
  key: "deploy_checklist",
  value: "✓ Tests passing ✓ Code reviewed ✓ Changelog updated ✓ Rollback plan ready",
  category: "task",
  priority: "high"
});

// Track deployment
await context_integrate_tool({
  toolName: "github-actions",
  eventType: "deployment-started",
  data: {
    version: "v2.3.0",
    environment: "production",
    commit: "abc123def"
  }
});

// Track results
await context_integrate_tool({
  toolName: "monitoring",
  eventType: "deployment-metrics",
  data: {
    errorRate: "0.01%",
    responseTime: "145ms",
    cpuUsage: "35%",
    status: "healthy"
  }
});
```

### The Tool Chain Pattern
Connect your entire tool ecosystem:

```typescript
// Linting results
await context_integrate_tool({
  toolName: "eslint",
  eventType: "lint-complete",
  data: {
    files: 45,
    errors: 0,
    warnings: 3,
    fixable: 2
  }
});

// Test coverage
await context_integrate_tool({
  toolName: "jest",
  eventType: "coverage-report",
  data: {
    lines: "92%",
    branches: "87%",
    functions: "95%",
    statements: "91%",
    important: true // Below 95% threshold
  }
});

// Security scan
await context_integrate_tool({
  toolName: "security-scanner",
  eventType: "scan-complete",
  data: {
    vulnerabilities: {
      critical: 0,
      high: 1,
      medium: 3,
      low: 12
    },
    important: true
  }
});

// Generate tool status summary
const toolStatus = await context_delegate({
  taskType: "synthesize",
  input: {
    synthesisType: "tool-status-report",
    includeRecommendations: true
  }
});
```

---

## Contributing Your Own Recipes

Have a useful pattern? Please contribute! 

1. Fork the repository
2. Add your recipe to the appropriate section
3. Include realistic examples
4. Submit a pull request

Remember: Good recipes should be:
- **Specific**: Solve a real problem
- **Practical**: Easy to adapt to similar situations  
- **Complete**: Include all necessary context
- **Tested**: Based on actual usage