# Cross-Session Collaboration in MCP Memory Keeper v0.9.0

## Overview

Version 0.9.0 introduces cross-session collaboration features that allow different AI sessions to share context items. This is particularly useful when:

- Multiple developers or AI agents work on the same project
- You need to hand off work between sessions
- You want to share insights or discoveries across different coding sessions
- Teams need to collaborate through shared context

## New Features

### 1. Share Context Items

Share specific context items with other sessions:

```typescript
// Share with specific sessions
context_share({ 
  key: "phase3_insights", 
  targetSessions: ["session-id-1", "session-id-2"] 
})

// Share publicly (accessible by all sessions)
context_share({ 
  key: "team_guidelines", 
  makePublic: true 
})
```

### 2. Access Shared Items

Retrieve items shared with your session:

```typescript
// Get items shared with current session
context_get_shared({})

// Get all publicly shared items
context_get_shared({ includeAll: true })
```

### 3. Search Across Sessions

Search for context items across multiple sessions:

```typescript
// Search all sessions
context_search_all({ query: "billing" })

// Search specific sessions
context_search_all({ 
  query: "authentication", 
  sessions: ["session-1", "session-2"] 
})
```

## Database Schema Changes

The `context_items` table now includes:
- `shared` (BOOLEAN): Whether the item is shared
- `shared_with_sessions` (TEXT): JSON array of session IDs that can access this item

## Migration Notes

Existing databases will be automatically migrated when using v0.9.0. The migration:
- Adds the new columns with safe defaults
- Preserves all existing data
- Maintains backward compatibility

## Use Cases

### 1. Team Handoffs
When finishing work, share important context with the next developer:

```typescript
// Before ending session
context_save({ 
  key: "current_work_status", 
  value: "Completed authentication module, starting on billing", 
  category: "progress" 
})
context_share({ key: "current_work_status", makePublic: true })
```

### 2. Knowledge Sharing
Share discovered patterns or solutions:

```typescript
context_save({ 
  key: "elixir_pattern_matching_fix", 
  value: "Use pin operator (^) to match existing variables in case statements", 
  category: "solution" 
})
context_share({ key: "elixir_pattern_matching_fix", makePublic: true })
```

### 3. Cross-Agent Collaboration
Different specialized agents can share their findings:

```typescript
// Security agent shares findings
context_save({ key: "security_vulnerabilities", value: "...", priority: "high" })
context_share({ key: "security_vulnerabilities", targetSessions: ["dev-agent-session"] })

// Dev agent retrieves and addresses issues
const vulns = context_get_shared({})
```

## Best Practices

1. **Use Clear Keys**: Make keys descriptive for easy discovery
2. **Categorize Shared Items**: Use categories to organize shared knowledge
3. **Set Appropriate Priorities**: High priority items are listed first
4. **Clean Up**: Remove outdated shared items to keep context relevant
5. **Security**: Only share non-sensitive information

## Troubleshooting

### Items Not Appearing
- Ensure the item was successfully saved before sharing
- Check that session IDs are correct
- Verify the item key exists in the source session

### Search Not Finding Items
- Search is case-insensitive but requires partial matches
- Check if sessions are specified correctly
- Ensure items are properly shared

## Future Enhancements

Planned features for future versions:
- Granular permissions (read-only vs read-write)
- Automatic expiration of shared items
- Team/project-based sharing groups
- Sharing statistics and analytics