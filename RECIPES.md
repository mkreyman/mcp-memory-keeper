# MCP Memory Keeper - Recipe Book

## Table of Contents
- [Daily Development Patterns](#daily-development-patterns)
- [Complex Workflow Patterns](#complex-workflow-patterns)
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

## Team Collaboration Patterns

### The Handoff Pattern
Smooth work transitions between team members:

```typescript
// Prepare handoff
await context_save({
  key: "handoff_summary",
  value: "Completed user auth, started on permissions. See handoff_details for specifics",
  category: "note",
  priority: "high"
});

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

---

## Contributing Your Own Recipes

Have a useful pattern? Please contribute! 

1. Fork the repository
2. Add your recipe to the appropriate section
3. Include realistic examples
4. Submit a pull request

Remember: Good recipes are specific, practical, and solve real problems.