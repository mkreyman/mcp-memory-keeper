# Smart Project Directory Management

As of version 0.8.3, MCP Memory Keeper provides intelligent assistance for setting up project directories to enable git tracking. This enhancement helps users configure their project directory correctly, especially when starting Claude Code from parent directories.

## How it Works

When you start a new session without providing a `projectDir`, the server will:

1. Check if the current directory has a git repository
2. Scan subdirectories for git repositories
3. Provide smart suggestions for setting up the project directory
4. Prompt for project directory when git operations are attempted

## Examples

### Starting from Parent Directory

```typescript
// If you're in ~/workspace and your project is in ~/workspace/my-project
await mcp.call('context_session_start', {
  name: 'My Feature Work',
  description: 'Working on the new feature'
});

// Response will show:
// Started new session: <session-id>
// Name: My Feature Work
// Git branch: unknown
//
// 💡 Found git repositories in: my-project, another-project
// To enable git tracking, start a session with your project directory:
// context_session_start({ name: "My Feature Work", projectDir: "/Users/you/workspace/my-project" })
```

### Explicit Directory (Override)

```typescript
// You can still explicitly set a different directory if needed
await mcp.call('context_session_start', {
  name: 'Another Project',
  projectDir: '/path/to/different/project'
});

// Response will show:
// Started new session: <session-id>
// Name: Another Project
// Working directory: /path/to/different/project (explicitly set)
// Git branch: develop
```

### Non-Git Directory

```typescript
// If the directory is not a git repository
await mcp.call('context_session_start', {
  name: 'Non-Git Project'
});

// Response will show:
// Started new session: <session-id>
// Name: Non-Git Project
// Working directory: /path/to/current/directory (auto-detected)
// Git: No repository found in working directory
```

### Git Operations Without Project Directory

```typescript
// If you try to commit without setting project directory
await mcp.call('context_git_commit', {
  message: 'feat: Add new feature'
});

// Response will show:
// ⚠️ No project directory set for git tracking!
//
// To enable git tracking for your project, use one of these methods:
//
// 1. For the current session:
//    context_set_project_dir({ projectDir: "/path/to/your/project" })
//
// 2. When starting a new session:
//    context_session_start({ name: "My Session", projectDir: "/path/to/your/project" })
```

## Benefits

1. **Smart Suggestions**: Automatically detects git repositories and suggests the right paths
2. **Clear Guidance**: Provides helpful messages when project directory is needed
3. **Prevents Mistakes**: Avoids using wrong directories when started from parent folders  
4. **Context Preservation**: The working directory is saved with the session for future reference
5. **Backward Compatible**: Existing code that provides `projectDir` continues to work as before

## Database Schema

The sessions table now includes a `working_directory` column to persist this information:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  branch TEXT,
  working_directory TEXT,  -- New column
  parent_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES sessions(id)
);
```

## Migration Support

For existing databases, the schema is automatically updated when the server starts. The migration checks if the `working_directory` column exists and adds it if missing.