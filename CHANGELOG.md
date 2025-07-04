# Changelog

All notable changes to MCP Memory Keeper will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Pagination Defaults in context_get** - Improved consistency
  - Added proper validation of pagination parameters at handler level
  - Default limit of 100 items now properly applied when not specified
  - Invalid limit/offset values are validated and fallback to defaults
  - Response includes `defaultsApplied` metadata to indicate when defaults were used
  - Consistent behavior with `context_search_all` and other paginated endpoints

### Added

- **Batch Operations** - Atomic multi-item operations

  - `context_batch_save` - Save multiple items in one transaction
  - `context_batch_delete` - Delete multiple items by keys or pattern
  - `context_batch_update` - Update multiple items with partial changes
  - Ensures data consistency with all-or-nothing transactions

- **Channel Reassignment** - Reorganize context items

  - `context_reassign_channel` - Move items between channels
  - Support for key patterns, specific keys, or entire channels
  - Filter by category and priority during moves
  - Dry run option to preview changes

- **Context Relationships** - Build knowledge graphs

  - `context_link` - Create typed relationships between items
  - `context_get_related` - Find related items with traversal
  - 14 relationship types (contains, depends_on, references, etc.)
  - Multi-level depth traversal support
  - Directional queries (incoming/outgoing/both)

- **Real-time Monitoring** - Watch for context changes
  - `context_watch` - Create filtered watchers for changes
  - Support for long polling and immediate returns
  - Filter by keys, categories, channels, priorities
  - Track added vs updated items

### Documentation

- Added comprehensive documentation for all new features in API.md
- Added practical examples in EXAMPLES.md
- Added recipes for common patterns in RECIPES.md
- Added troubleshooting tips for new features

## [0.10.0] - 2025-01-26

### Added

- **Channels** - Persistent topic-based organization (#22)

  - Auto-derived from git branch names (20 chars max)
  - Survives session crashes and restarts
  - `defaultChannel` parameter in `context_session_start`
  - `channel` parameter in `context_save` and `context_get`
  - Perfect for multi-branch development and team collaboration

- **Enhanced Filtering** in `context_get` (#21)

  - `includeMetadata` - Get timestamps and size information
  - `sort` - Sort by created/updated time (asc/desc) or priority
  - `limit` and `offset` - Pagination support
  - `createdAfter` and `createdBefore` - Time-based filtering
  - `keyPattern` - Regex pattern matching for keys
  - `priorities` - Filter by multiple priority levels

- **Enhanced Timeline** (#21)
  - `includeItems` - Show actual items, not just counts
  - `categories` - Filter timeline by specific categories
  - `relativeTime` - Display "2 hours ago" format
  - `itemsPerPeriod` - Limit items shown per time period

### Changed

- Database schema updated with `channel` column in context_items table
- Improved query performance with channel indexing
- Better support for cross-branch context queries

### Technical

- Added channels migration (003_add_channels.ts)
- Enhanced validation for channel names
- Backward compatible - existing items default to 'default' channel

## [0.9.0] - 2025-01-20

### Changed (BREAKING)

- **Simplified Sharing Model** (#19)
  - Context items are now shared across all sessions by default (public)
  - Removed broken `context_share` and `context_get_shared` commands
  - Added `private` flag to `context_save` for session-specific items
  - Database schema updated: replaced `shared` and `shared_with_sessions` columns with `is_private`
  - Migration included to make ALL existing items public (accessible across sessions)

### Fixed

- Cross-session collaboration now works reliably
- Context accessibility is consistent across all retrieval methods
- Search operations properly respect privacy settings

### Removed

- `context_share` tool (sharing is now automatic)
- `context_get_shared` tool (use `context_get` instead)
- Complex sharing mechanism that was causing inconsistencies

## [0.8.4] - 2025-01-19

### Fixed

- Critical fix for "table sessions has no column named working_directory" error
- Added defensive checks before using working_directory column
- Gracefully handles existing databases without the new column

### Added

- Tiered storage and retention policies (planned)
- Feature flags system (planned)
- Database migration system (planned)

## [0.8.3] - 2025-01-19

### Added

- **Smart Project Directory Management**
  - `context_session_start` provides intelligent suggestions when no project directory is set
  - Detects git repositories in current directory and subdirectories
  - Suggests appropriate project paths based on directory structure
  - Working directory is stored in the sessions table when explicitly provided
  - Git-dependent tools now prompt for project directory setup when needed

### Changed

- Sessions table now includes a `working_directory` column
- Improved user guidance for setting up git tracking
- More helpful messages when project directory is not set

### Fixed

- Automatic schema migration for existing databases to add the `working_directory` column

## [0.8.0] - 2024-01-18

### Added

- **Session Branching & Merging** (#14)
  - `context_branch_session` tool for creating session branches
  - Support for shallow (high-priority only) and deep (full copy) branching
  - `context_merge_sessions` tool with three conflict resolution strategies
  - Parent-child relationship tracking in sessions table
- **Journal Entries** (#16)
  - `context_journal_entry` tool for time-stamped reflections
  - Support for tags and mood tracking
  - Integration with timeline visualization
- **Timeline View** (#16)
  - `context_timeline` tool to visualize activity patterns
  - Grouping by hour, day, or week
  - Category distribution over time
  - Journal entry integration
- **Progressive Compression** (#17)
  - `context_compress` tool for intelligent space management
  - Preserve important categories while compressing old data
  - Automatic compression ratio calculation
  - Target size optimization support
- **Cross-Tool Integration** (#18)
  - `context_integrate_tool` to record events from other MCP tools
  - Automatic high-priority context item creation for important events
  - Support for tool event metadata storage

### Changed

- Updated database schema to support new features
- Enhanced documentation with comprehensive examples
- Improved test coverage with 19 new test cases

### Technical

- Added `parent_id` column to sessions table
- New tables: `journal_entries`, `compressed_context`, `tool_events`
- All 255 tests passing

## [0.7.0] - 2024-01-18

### Added

- **Multi-Agent System** (#9)
  - Agent framework with specialized roles
  - `AnalyzerAgent` for pattern detection and relationship analysis
  - `SynthesizerAgent` for summarization and recommendations
  - `AgentCoordinator` for managing agent workflows
  - `context_delegate` tool for intelligent task delegation
  - Agent chaining capability for complex workflows
  - Confidence scoring for agent outputs

### Changed

- Improved documentation with multi-agent examples
- Enhanced EXAMPLES.md with agent usage patterns

### Technical

- Created `src/utils/agents.ts` with complete agent implementation
- Added comprehensive test coverage (30 new tests)
- All 236 tests passing

## [0.6.0] - 2024-01-17

### Added

- **Semantic Search** (#4)
  - `context_semantic_search` tool for natural language queries
  - Lightweight vector embeddings using character n-grams
  - No external dependencies required
  - Similarity threshold filtering
  - Integration with existing search infrastructure

### Changed

- Updated examples with semantic search patterns
- Enhanced documentation for natural language queries

### Technical

- Implemented `VectorStore` class for embedding management
- Added `vector_embeddings` table to database schema
- Comprehensive test coverage for semantic search
- All 206 tests passing

## [0.5.0] - 2024-01-17

### Added

- **Knowledge Graph Integration** (#3)
  - Automatic entity extraction from context
  - Relationship detection between entities
  - `context_analyze` tool for building knowledge graph
  - `context_find_related` tool for exploring connections
  - `context_visualize` tool with graph/timeline/heatmap views
  - Confidence scoring for relationships

### Changed

- Enhanced database schema for knowledge graph support
- Improved context analysis capabilities

### Technical

- New tables: `entities`, `relations`, `observations`
- Added `knowledge-graph.ts` utility module
- Comprehensive test coverage for graph operations

## [0.4.2] - 2024-01-16

### Added

- **Documentation Improvements**
  - Comprehensive TROUBLESHOOTING.md guide
  - Enhanced EXAMPLES.md with real-world scenarios
  - Started RECIPES.md for common patterns

### Fixed

- Git integration error handling
- Session list date filtering

## [0.4.1] - 2024-01-16

### Fixed

- Database initialization race condition
- Checkpoint restoration with missing files
- Search result ranking accuracy

### Changed

- Improved error messages for better debugging
- Enhanced validation for file paths

## [0.4.0] - 2024-01-15

### Added

- **Git Integration** (#2)
  - `context_git_commit` tool with auto-save
  - Automatic context correlation with commits
  - Git status capture in checkpoints
  - Branch tracking

### Changed

- Checkpoint system now includes git information
- Enhanced session metadata with git branch

### Technical

- Added `simple-git` dependency
- Created `git.ts` utility module
- 97% test coverage maintained

## [0.3.0] - 2024-01-14

### Added

- **Smart Compaction** (#1)
  - `context_prepare_compaction` tool
  - Automatic identification of critical items
  - Unfinished task preservation
  - Restoration instructions generation
- **Search Functionality**
  - `context_search` tool with full-text search
  - Search in keys and values
  - Category and session filtering
- **Export/Import**
  - `context_export` tool for JSON/CSV export
  - `context_import` tool with merge strategies
  - Session backup and restore capability

### Changed

- Improved checkpoint metadata
- Enhanced error handling across all tools

### Technical

- Added search indexes for performance
- Implemented streaming for large exports
- Transaction support for atomic operations

## [0.2.0] - 2024-01-13

### Added

- **Checkpoint System**
  - `context_checkpoint` tool for complete snapshots
  - `context_restore_checkpoint` for state restoration
  - File cache inclusion in checkpoints
  - Git status integration
- **Context Summarization**
  - `context_summarize` tool
  - AI-friendly markdown summaries
  - Category and priority grouping
  - Session statistics
- **Enhanced File Management**
  - SHA-256 hash-based change detection
  - File size tracking
  - Automatic cache invalidation

### Changed

- Improved session management with metadata
- Better error messages with error codes
- Enhanced validation for all inputs

### Fixed

- Memory leak in file cache operations
- Session switching race condition

## [0.1.0] - 2024-01-12

### Added

- Initial release
- **Core Features**
  - `context_save` and `context_get` tools
  - `context_delete` for item removal
  - Session management with `context_session_start` and `context_session_list`
  - File caching with `context_cache_file` and `context_file_changed`
  - Status monitoring with `context_status`
- **Database Setup**
  - SQLite with WAL mode
  - Automatic database creation
  - Size tracking and limits
- **MCP Integration**
  - Full MCP protocol implementation
  - Tool discovery and schema validation
  - Error handling and reporting

### Technical

- TypeScript implementation
- Comprehensive test suite
- Zero runtime dependencies (except MCP SDK and SQLite)

## Development Releases

### [0.1.0-beta.2] - 2024-01-11

- Fixed Windows path handling
- Added Node.js 18+ compatibility

### [0.1.0-beta.1] - 2024-01-10

- Initial beta release
- Basic functionality testing
- Community feedback integration

## Legend

- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security updates
- **Technical**: Internal improvements

[Unreleased]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.8.4...v0.9.0
[0.8.4]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.8.0...v0.8.3
[0.8.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mkreyman/mcp-memory-keeper/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mkreyman/mcp-memory-keeper/releases/tag/v0.1.0
