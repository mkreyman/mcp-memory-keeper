# MCP Memory Keeper - Claude Code Context Management

[![CI](https://github.com/mkreyman/mcp-memory-keeper/actions/workflows/ci.yml/badge.svg)](https://github.com/mkreyman/mcp-memory-keeper/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/mkreyman/mcp-memory-keeper/branch/main/graph/badge.svg)](https://codecov.io/gh/mkreyman/mcp-memory-keeper)
[![npm version](https://badge.fury.io/js/mcp-memory-keeper.svg)](https://badge.fury.io/js/mcp-memory-keeper)

A Model Context Protocol (MCP) server that provides persistent context management for Claude AI coding assistants. Never lose context during compaction again! This MCP server helps Claude Code maintain context across sessions, preserving your work history, decisions, and progress.

## Why MCP Memory Keeper?

Claude Code users often face context loss when the conversation window fills up. This MCP server solves that problem by providing a persistent memory layer for Claude AI. Whether you're working on complex refactoring, multi-file changes, or long debugging sessions, Memory Keeper ensures your Claude assistant remembers important context, decisions, and progress.

### Perfect for:
- Long coding sessions with Claude Code
- Complex projects requiring context preservation
- Teams using Claude AI for collaborative development
- Developers who want persistent context across Claude sessions

## Features

- 🔄 Save and restore context between Claude Code sessions
- 📁 File content caching with change detection  
- 🏷️ Organize context with categories and priorities
- 📺 **Channels** - Persistent topic-based organization (auto-derived from git branch)
- 📸 Checkpoint system for complete context snapshots
- 🤖 Smart compaction helper that never loses critical info
- 🔍 Full-text search across all saved context
- 🕐 **Enhanced filtering** - Time-based queries, regex patterns, pagination
- 💾 Export/import for backup and sharing
- 🌿 Git integration with automatic context correlation
- 📊 AI-friendly summarization with priority awareness
- 🚀 Fast SQLite-based storage optimized for Claude

## Installation

### Method 1: From GitHub (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/mkreyman/mcp-memory-keeper.git
cd mcp-memory-keeper

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Note the absolute path to the project
pwd  # Copy this path for the configuration step
```

### Method 2: From Source

```bash
# 1. Download the source code
# 2. Extract to a directory of your choice
# 3. Navigate to the directory
cd /path/to/mcp-memory-keeper

# 4. Install and build
npm install
npm run build
```

## Configuration

### Claude Code (CLI)

Open a terminal in your project directory and run:

```bash
# Add the Memory Keeper server
claude mcp add memory-keeper node /absolute/path/to/mcp-memory-keeper/dist/index.js

# Example for macOS:
claude mcp add memory-keeper node /Users/username/projects/mcp-memory-keeper/dist/index.js
```

#### Configuration Scopes

Choose where to save the configuration:

```bash
# Project-specific (default) - only for you in this project
claude mcp add memory-keeper node /path/to/mcp-memory-keeper/dist/index.js

# Shared with team via .mcp.json
claude mcp add --scope project memory-keeper node /path/to/mcp-memory-keeper/dist/index.js

# Available across all your projects
claude mcp add --scope user memory-keeper node /path/to/mcp-memory-keeper/dist/index.js
```

#### Verify Configuration

```bash
# List all configured servers
claude mcp list

# Get details for Memory Keeper
claude mcp get memory-keeper
```

### Claude Desktop App

1. Open Claude Desktop settings
2. Navigate to "Developer" → "Model Context Protocol"
3. Click "Add MCP Server"
4. Add the following configuration:

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

**Important**: Replace `/absolute/path/to/mcp-memory-keeper` with the actual path where you cloned/installed the project.

### Example paths:
- macOS: `/Users/username/projects/mcp-memory-keeper/dist/index.js`
- Windows: `C:\\Users\\username\\projects\\mcp-memory-keeper\\dist\\index.js`
- Linux: `/home/username/projects/mcp-memory-keeper/dist/index.js`

### Verify Installation

#### For Claude Code:
1. Restart Claude Code or start a new session
2. The Memory Keeper tools should be available automatically
3. Test with: `mcp_memory_save({ key: "test", value: "Hello Memory Keeper!" })`
4. If not working, check server status:
   ```bash
   claude mcp list  # Should show memory-keeper as "running"
   ```

#### For Claude Desktop:
1. Restart Claude Desktop after adding the configuration
2. In a new conversation, the Memory Keeper tools should be available
3. Test with the same command above

### Troubleshooting

If Memory Keeper isn't working:

```bash
# Remove and re-add the server
claude mcp remove memory-keeper
claude mcp add memory-keeper node /absolute/path/to/mcp-memory-keeper/dist/index.js

# Check logs for errors
# The server output will appear in Claude Code's output panel
```

### Updating to Latest Version

To get the latest features and bug fixes:

```bash
# 1. Navigate to your Memory Keeper directory
cd /path/to/mcp-memory-keeper

# 2. Pull the latest changes
git pull

# 3. Install any new dependencies (if package.json changed)
npm install

# 4. Rebuild the project
npm run build

# 5. Start a new Claude session
# The updated features will be available immediately
```

**Note**: You don't need to reconfigure the MCP server in Claude after updating. Just pull, build, and start a new session!

## Usage

### Session Management

```javascript
// Start a new session
mcp_context_session_start({ 
  name: "Feature Development", 
  description: "Working on user authentication" 
})

// Start a session with project directory for git tracking
mcp_context_session_start({ 
  name: "Feature Development", 
  description: "Working on user authentication",
  projectDir: "/path/to/your/project"
})

// Start a session with a default channel
mcp_context_session_start({ 
  name: "Feature Development", 
  description: "Working on user authentication",
  projectDir: "/path/to/your/project",
  defaultChannel: "auth-feature"  // Will auto-derive from git branch if not specified
})

// Set project directory for current session
mcp_context_set_project_dir({ 
  projectDir: "/path/to/your/project"
})

// List recent sessions
mcp_context_session_list({ limit: 5 })

// Continue from a previous session
mcp_context_session_start({ 
  name: "Feature Dev Continued",
  continueFrom: "previous-session-id" 
})
```

### Working with Channels (NEW in v0.10.0)

Channels provide persistent topic-based organization that survives session crashes and restarts:

```javascript
// Channels are auto-derived from git branch (if projectDir is set)
// Branch "feature/auth-system" becomes channel "feature-auth-system" (20 chars max)

// Save to a specific channel
mcp_context_save({ 
  key: "auth_design", 
  value: "Using JWT with refresh tokens",
  category: "decision",
  priority: "high",
  channel: "auth-feature"  // Explicitly set channel
})

// Get items from a specific channel
mcp_context_get({ channel: "auth-feature" })

// Get items across all channels (default behavior)
mcp_context_get({ category: "task" })

// Channels persist across sessions - perfect for:
// - Multi-branch development
// - Feature-specific context
// - Team collaboration on different topics
```

### Enhanced Context Storage

```javascript
// Save with categories and priorities
mcp_context_save({ 
  key: "current_task", 
  value: "Implement OAuth integration",
  category: "task",
  priority: "high"
})

// Save decisions
mcp_context_save({ 
  key: "auth_strategy", 
  value: "Using JWT tokens with 24h expiry",
  category: "decision",
  priority: "high"
})

// Save progress notes
mcp_context_save({ 
  key: "progress_auth", 
  value: "Completed user model, working on token generation",
  category: "progress",
  priority: "normal"
})

// Retrieve by category
mcp_context_get({ category: "task" })

// Retrieve specific item
mcp_context_get({ key: "current_task" })

// Get context from specific session
mcp_context_get({ 
  sessionId: "session-id-here",
  category: "decision" 
})

// Enhanced filtering (NEW in v0.10.0)
mcp_context_get({
  category: "task",
  priorities: ["high", "normal"],
  includeMetadata: true,      // Get timestamps, size info
  sort: "created_desc",       // created_asc/desc, updated_asc/desc, priority
  limit: 10,                  // Pagination
  offset: 0
})

// Time-based queries (NEW in v0.10.0)
mcp_context_get({
  createdAfter: "2025-01-20T00:00:00Z",
  createdBefore: "2025-01-26T23:59:59Z",
  includeMetadata: true
})

// Pattern matching (NEW in v0.10.0)
mcp_context_get({
  keyPattern: "auth_.*",      // Regex to match keys
  category: "decision"
})
```

### File Caching

```javascript
// Cache file content for change detection
mcp_context_cache_file({ 
  filePath: "/src/auth/user.model.ts",
  content: fileContent 
})

// Check if file has changed
mcp_context_file_changed({ 
  filePath: "/src/auth/user.model.ts",
  currentContent: newFileContent 
})

// Get current session status
mcp_context_status()
```

### Complete Workflow Example

```javascript
// 1. Start a new session
mcp_context_session_start({ 
  name: "Settings Refactor",
  description: "Refactoring settings module for better performance" 
})

// 2. Save high-priority task
mcp_context_save({ 
  key: "main_task",
  value: "Refactor Settings.Context to use behaviors",
  category: "task",
  priority: "high"
})

// 3. Cache important files
mcp_context_cache_file({ 
  filePath: "lib/settings/context.ex",
  content: originalFileContent 
})

// 4. Save decisions as you work
mcp_context_save({ 
  key: "architecture_decision",
  value: "Split settings into read/write modules",
  category: "decision",
  priority: "high"
})

// 5. Track progress
mcp_context_save({ 
  key: "progress_1",
  value: "Completed behavior definition, 5 modules remaining",
  category: "progress",
  priority: "normal"
})

// 6. Before context window fills up
mcp_context_status()  // Check what's saved

// 7. After Claude Code restart
mcp_context_get({ category: "task", priority: "high" })  // Get high priority tasks
mcp_context_get({ key: "architecture_decision" })       // Get specific decisions
mcp_context_file_changed({ filePath: "lib/settings/context.ex" })  // Check for changes
```

### Checkpoints (Phase 2)

Create named snapshots of your entire context that can be restored later:

```javascript
// Create a checkpoint before major changes
mcp_context_checkpoint({ 
  name: "before-refactor",
  description: "State before major settings refactor",
  includeFiles: true,      // Include cached files
  includeGitStatus: true   // Capture git status
})

// Continue working...
// If something goes wrong, restore from checkpoint
mcp_context_restore_checkpoint({ 
  name: "before-refactor",
  restoreFiles: true  // Restore cached files too
})

// Or restore the latest checkpoint
mcp_context_restore_checkpoint({})
```

### Context Summarization (Phase 2)

Get AI-friendly summaries of your saved context:

```javascript
// Get a summary of all context
mcp_context_summarize()

// Get summary of specific categories
mcp_context_summarize({ 
  categories: ["task", "decision"],
  maxLength: 2000 
})

// Summarize a specific session
mcp_context_summarize({ 
  sessionId: "session-id-here",
  categories: ["progress"] 
})
```

Example summary output:
```markdown
# Context Summary

## High Priority Items
- **main_task**: Refactor Settings.Context to use behaviors
- **critical_bug**: Fix memory leak in subscription handler

## Task
- implement_auth: Add OAuth2 authentication flow
- update_tests: Update test suite for new API

## Decision
- architecture_decision: Split settings into read/write modules
- db_choice: Use PostgreSQL for better JSON support
```

### Smart Compaction (Phase 3)

Never lose critical context when Claude's window fills up:

```javascript
// Before context window fills
mcp_context_prepare_compaction()

// This automatically:
// - Creates a checkpoint
// - Identifies high-priority items
// - Captures unfinished tasks
// - Saves all decisions
// - Generates a summary
// - Prepares restoration instructions
```

### Git Integration (Phase 3)

Track git changes in your project directory and save context with commits:

```javascript
// First, set your project directory (if not done during session start)
mcp_context_set_project_dir({ 
  projectDir: "/path/to/your/project"
})

// Commit with auto-save
mcp_context_git_commit({ 
  message: "feat: Add user authentication",
  autoSave: true  // Creates checkpoint with commit
})

// Context is automatically linked to the commit
// Note: If no project directory is set, you'll see a helpful message
// explaining how to enable git tracking for your project
```

### Context Search (Phase 3)

Find anything in your saved context:

```javascript
// Search in keys and values
mcp_context_search({ query: "authentication" })

// Search only in keys
mcp_context_search({ 
  query: "config",
  searchIn: ["key"] 
})

// Search in specific session
mcp_context_search({ 
  query: "bug",
  sessionId: "session-id" 
})
```

### Export/Import (Phase 3)

Share context or backup your work:

```javascript
// Export current session
mcp_context_export()  // Creates memory-keeper-export-xxx.json

// Export specific session
mcp_context_export({ 
  sessionId: "session-id",
  format: "json" 
})

// Import from file
mcp_context_import({ 
  filePath: "memory-keeper-export-xxx.json" 
})

// Merge into current session
mcp_context_import({ 
  filePath: "backup.json",
  merge: true 
})
```

### Knowledge Graph (Phase 4)

Automatically extract entities and relationships from your context:

```javascript
// Analyze context to build knowledge graph
mcp_context_analyze()

// Or analyze specific categories
mcp_context_analyze({ 
  categories: ["task", "decision"] 
})

// Find related entities
mcp_context_find_related({ 
  key: "AuthService",
  maxDepth: 2 
})

// Generate visualization data
mcp_context_visualize({ 
  type: "graph" 
})

// Timeline view
mcp_context_visualize({ 
  type: "timeline" 
})

// Category/priority heatmap
mcp_context_visualize({ 
  type: "heatmap" 
})
```

### Semantic Search (Phase 4.2)

Find context using natural language queries:

```javascript
// Search with natural language
mcp_context_semantic_search({ 
  query: "how are we handling user authentication?",
  topK: 5 
})

// Find the most relevant security decisions
mcp_context_semantic_search({ 
  query: "security concerns and decisions",
  minSimilarity: 0.5 
})

// Search with specific similarity threshold
mcp_context_semantic_search({ 
  query: "database performance optimization",
  topK: 10,
  minSimilarity: 0.3 
})
```

### Multi-Agent System (Phase 4.3)

Delegate complex analysis tasks to specialized agents:

```javascript
// Analyze patterns in your context
mcp_context_delegate({
  taskType: "analyze",
  input: {
    analysisType: "patterns",
    categories: ["task", "decision"]
  }
})

// Get comprehensive analysis
mcp_context_delegate({
  taskType: "analyze", 
  input: {
    analysisType: "comprehensive"
  }
})

// Analyze relationships between entities
mcp_context_delegate({
  taskType: "analyze",
  input: {
    analysisType: "relationships",
    maxDepth: 3
  }
})

// Create intelligent summaries
mcp_context_delegate({
  taskType: "synthesize",
  input: {
    synthesisType: "summary",
    maxLength: 1000
  }
})

// Get actionable recommendations
mcp_context_delegate({
  taskType: "synthesize",
  input: {
    synthesisType: "recommendations",
    analysisResults: {} // Can pass previous analysis results
  }
})

// Chain multiple agent tasks
mcp_context_delegate({
  chain: true,
  taskType: ["analyze", "synthesize"],
  input: [
    { analysisType: "comprehensive" },
    { synthesisType: "recommendations" }
  ]
})
```

Agent Types:
- **Analyzer Agent**: Detects patterns, analyzes relationships, tracks trends
- **Synthesizer Agent**: Creates summaries, merges insights, generates recommendations

### Session Branching & Merging (Phase 4.4)

Explore alternatives without losing your original work:

```javascript
// Create a branch to try something new
mcp_context_branch_session({
  branchName: "experimental-refactor",
  copyDepth: "shallow" // Only copy high-priority items
})

// Or create a full copy
mcp_context_branch_session({
  branchName: "feature-complete-copy",
  copyDepth: "deep" // Copy everything
})

// Later, merge changes back
mcp_context_merge_sessions({
  sourceSessionId: "branch-session-id",
  conflictResolution: "keep_newest" // or "keep_current", "keep_source"
})
```

### Journal Entries (Phase 4.4)

Track your thoughts and progress with timestamped journal entries:

```javascript
// Add a journal entry
mcp_context_journal_entry({
  entry: "Completed the authentication module. Tests are passing!",
  tags: ["milestone", "authentication"],
  mood: "accomplished"
})

// Entries are included in timeline views
mcp_context_timeline({
  groupBy: "day"
})
```

### Timeline & Activity Tracking (Phase 4.4)

Visualize your work patterns over time:

```javascript
// Get activity timeline
mcp_context_timeline({
  startDate: "2024-01-01",
  endDate: "2024-01-31",
  groupBy: "day" // or "hour", "week"
})

// Enhanced timeline (NEW in v0.10.0)
mcp_context_timeline({
  groupBy: "hour",
  includeItems: true,         // Show actual items, not just counts
  categories: ["task", "progress"],  // Filter by categories
  relativeTime: true,         // Show "2 hours ago" format
  itemsPerPeriod: 10         // Limit items shown per time period
})

// Shows:
// - Context items created per day/hour
// - Category distribution over time
// - Journal entries with moods and tags
// - Actual item details when includeItems: true
```

### Progressive Compression (Phase 4.4)

Save space by intelligently compressing old context:

```javascript
// Compress items older than 30 days
mcp_context_compress({
  olderThan: "2024-01-01",
  preserveCategories: ["decision", "critical"], // Keep these
  targetSize: 1000 // Target size in KB (optional)
})

// Compression summary shows:
// - Items compressed
// - Space saved
// - Compression ratio
// - Categories affected
```

### Cross-Tool Integration (Phase 4.4)

Track events from other MCP tools:

```javascript
// Record events from other tools
mcp_context_integrate_tool({
  toolName: "code-analyzer",
  eventType: "security-scan-complete",
  data: {
    vulnerabilities: 0,
    filesScanned: 150,
    important: true // Creates high-priority context item
  }
})
```

## Documentation

- **[Quick Start Examples](./EXAMPLES.md)** - Real-world scenarios and workflows
- **[API Reference](./API.md)** - Complete tool documentation with all parameters and examples
- **[Recipe Book](./RECIPES.md)** - Common patterns and best practices for daily development
- **[Troubleshooting Guide](./TROUBLESHOOTING.md)** - Common issues and solutions
- **[Architecture Overview](./ARCHITECTURE.md)** - System design and technical details
- **[Contributing Guide](./CONTRIBUTING.md)** - How to contribute to the project
- **[Changelog](./CHANGELOG.md)** - Version history and release notes

## Development

### Running in Development Mode

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run with auto-reload
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Project Structure

```
mcp-memory-keeper/
├── src/
│   ├── index.ts           # Main MCP server implementation
│   ├── utils/             # Utility modules
│   │   ├── database.ts    # Database management
│   │   ├── validation.ts  # Input validation
│   │   ├── git.ts         # Git operations
│   │   ├── knowledge-graph.ts # Knowledge graph management
│   │   ├── vector-store.ts    # Vector embeddings
│   │   └── agents.ts      # Multi-agent system
│   └── __tests__/         # Test files
├── dist/                  # Compiled JavaScript (generated)
├── context.db             # SQLite database (auto-created)
├── EXAMPLES.md            # Quick start examples
├── TROUBLESHOOTING.md     # Common issues and solutions
├── package.json           # Project configuration
├── tsconfig.json          # TypeScript configuration
├── jest.config.js         # Test configuration
└── README.md              # This file
```

### Testing

The project includes comprehensive test coverage:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run specific test file
npm test -- summarization.test.ts
```

Test categories:
- **Unit Tests**: Input validation, database operations, git integration
- **Integration Tests**: Full tool workflows, error scenarios, edge cases
- **Coverage**: 97%+ coverage on critical modules

## Feature Status

| Feature | Maturity | Version | Use Case |
|---------|----------|---------|----------|
| Basic Save/Get | ✅ Stable | v0.1+ | Daily context management |
| Sessions | ✅ Stable | v0.2+ | Multi-project work |
| File Caching | ✅ Stable | v0.2+ | Track file changes |
| Checkpoints | ✅ Stable | v0.3+ | Context preservation |
| Smart Compaction | ✅ Stable | v0.3+ | Pre-compaction prep |
| Git Integration | ✅ Stable | v0.3+ | Commit context tracking |
| Search | ✅ Stable | v0.3+ | Find saved items |
| Export/Import | ✅ Stable | v0.3+ | Backup & sharing |
| Knowledge Graph | ✅ Stable | v0.5+ | Code relationship analysis |
| Visualization | ✅ Stable | v0.5+ | Context exploration |
| Semantic Search | ✅ Stable | v0.6+ | Natural language queries |
| Multi-Agent | ✅ Stable | v0.7+ | Intelligent processing |

### Current Features (v0.10.0)
- ✅ **Session Management**: Create, list, and continue sessions with branching support
- ✅ **Channels**: Persistent topic-based organization (auto-derived from git branch)
- ✅ **Context Storage**: Save/retrieve context with categories (task, decision, progress, note) and priorities
- ✅ **Enhanced Filtering**: Time-based queries, regex patterns, sorting, pagination
- ✅ **File Caching**: Track file changes with SHA-256 hashing
- ✅ **Checkpoints**: Create and restore complete context snapshots
- ✅ **Smart Compaction**: Never lose critical context when hitting limits
- ✅ **Git Integration**: Auto-save context on commits with branch tracking
- ✅ **Search**: Full-text search across all saved context
- ✅ **Export/Import**: Backup and share context as JSON
- ✅ **SQLite Storage**: Persistent, reliable data storage with WAL mode
- ✅ **Knowledge Graph**: Automatic entity and relationship extraction from context
- ✅ **Visualization**: Generate graph, timeline, and heatmap data for context exploration
- ✅ **Semantic Search**: Natural language search using lightweight vector embeddings
- ✅ **Multi-Agent System**: Intelligent analysis with specialized analyzer and synthesizer agents
- ✅ **Session Branching**: Create branches to explore alternatives without losing original context
- ✅ **Session Merging**: Merge branches back with conflict resolution options
- ✅ **Journal Entries**: Time-stamped entries with tags and mood tracking
- ✅ **Enhanced Timeline**: Activity patterns with item details and relative time
- ✅ **Progressive Compression**: Intelligently compress old context to save space
- ✅ **Cross-Tool Integration**: Track events from other MCP tools

### Roadmap

#### Phase 4: Advanced Features (In Development)
- 🚧 **Knowledge Graph**: Entity-relation tracking for code understanding
- 🚧 **Vector Search**: Semantic search using natural language
- 📋 **Multi-Agent Processing**: Intelligent analysis and synthesis
- 📋 **Time-Aware Context**: Timeline views and journal entries

#### Phase 5: Documentation & Polish
- ✅ **Examples**: Comprehensive quick-start scenarios
- ✅ **Troubleshooting**: Common issues and solutions
- 🚧 **Recipes**: Common patterns and workflows
- 📋 **Video Tutorials**: Visual guides for key features

#### Future Enhancements
- [ ] Web UI for browsing context history
- [ ] Multi-user/team collaboration features
- [ ] Cloud sync and sharing
- [ ] Integration with other AI assistants
- [ ] Advanced analytics and insights
- [ ] Custom context templates
- [ ] Automatic retention policies

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Mark Kreyman

## Acknowledgments

- Built for the Claude Code community
- Inspired by the need for better context management in AI coding sessions
- Thanks to Anthropic for the MCP protocol

## Support

If you encounter any issues or have questions:
- Open an issue on [GitHub](https://github.com/mkreyman/mcp-memory-keeper/issues)
- Check the [MCP documentation](https://modelcontextprotocol.io/)
- Join the Claude Code community discussions

## Keywords

Claude Code context management, MCP server, Claude AI memory, persistent context, Model Context Protocol, Claude assistant memory, AI coding context, Claude Code MCP, context preservation, Claude AI tools