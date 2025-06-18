# MCP Memory Keeper - Claude Code Context Management

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
- 💾 SQLite-based persistent storage for Claude AI assistants
- 🚀 Fast and lightweight MCP server implementation
- 🤖 Designed specifically for Claude Code context management

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

## Usage

### Save context
```
mcp_context_save({ key: "current_task", value: "Working on feature X" })
```

### Retrieve context
```
mcp_context_get({ key: "current_task" })
```

### Example Workflow

```javascript
// At the start of your session
mcp_context_save({ 
  key: "project_context", 
  value: "Working on Settings Stage 8 - Context Propagation" 
})

// Save important decisions
mcp_context_save({ 
  key: "decision_auth", 
  value: "Using Mox for mocking instead of Meck" 
})

// Save current progress
mcp_context_save({ 
  key: "last_file", 
  value: "lib/intervisio_app/billing.ex:247 - fixing Context.new()" 
})

// After Claude Code restart, retrieve your context
mcp_context_get({ key: "project_context" })
mcp_context_get({ key: "last_file" })
```

## Development

### Running in Development Mode

```bash
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
│   └── index.ts       # Main MCP server implementation
├── dist/              # Compiled JavaScript (generated)
├── context.db         # SQLite database (auto-created)
├── package.json       # Project configuration
├── tsconfig.json      # TypeScript configuration
└── README.md          # This file
```

## Roadmap

### Current Features (v0.1.0)
- ✅ Basic save/restore functionality
- ✅ Persistent SQLite storage
- ✅ Simple key-value interface

### Planned Features
- [ ] Session management
- [ ] File content caching
- [ ] Context categories and priorities
- [ ] Smart summarization
- [ ] Git integration
- [ ] Web UI for browsing context

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