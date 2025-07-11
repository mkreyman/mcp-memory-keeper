# MCP Memory Keeper - Architecture Documentation

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Database Design](#database-design)
- [Security Considerations](#security-considerations)
- [Performance Optimization](#performance-optimization)
- [Extension Points](#extension-points)
- [Future Considerations](#future-considerations)

## Overview

MCP Memory Keeper is a Model Context Protocol (MCP) server designed to provide persistent context management for AI coding assistants. The architecture prioritizes:

- **Reliability**: SQLite with WAL mode for data persistence
- **Performance**: Efficient indexing and caching strategies
- **Extensibility**: Modular design with clear interfaces
- **Simplicity**: Minimal dependencies, straightforward data flow

## System Architecture

```
┌─────────────────┐     MCP Protocol      ┌──────────────────┐
│                 │◄─────────────────────►│                  │
│  Claude Code/   │                       │  MCP Memory      │
│  Claude Desktop │                       │  Keeper Server   │
│                 │                       │                  │
└─────────────────┘                       └───────┬──────────┘
                                                  │
                                                  │
                                         ┌────────▼──────────┐
                                         │                   │
                                         │   Core Modules    │
                                         │                   │
                                         └───────┬───────────┘
                                                 │
                ┌────────────────┬───────────────┼───────────────┬────────────────┐
                │                │               │               │                │
         ┌──────▼──────┐ ┌──────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
         │   Database  │ │ Validation  │ │    Git     │ │ Knowledge  │ │   Agents    │
         │   Manager   │ │   Module    │ │Integration │ │   Graph    │ │   System    │
         └──────┬──────┘ └─────────────┘ └────────────┘ └────────────┘ └─────────────┘
                │
         ┌──────▼──────┐
         │   SQLite    │
         │  Database   │
         └─────────────┘
```

### Component Responsibilities

1. **MCP Server (index.ts)**

   - Protocol implementation
   - Request routing
   - Response formatting
   - Error handling

2. **Core Modules**

   - Business logic implementation
   - Cross-cutting concerns
   - Module coordination

3. **Utility Modules**
   - Specialized functionality
   - Reusable components
   - External integrations

## Core Components

### 1. MCP Server (`src/index.ts`)

The main entry point that implements the MCP protocol:

```typescript
class MemoryKeeperServer {
  private db: DatabaseManager;
  private currentSessionId?: string;

  constructor() {
    // Initialize database
    this.db = new DatabaseManager({
      filename: 'context.db',
      maxSize: 100 * 1024 * 1024,
      walMode: true,
    });
  }

  // Tool implementations
  async handleToolCall(name: string, args: any): Promise<any> {
    switch (name) {
      case 'context_save':
        return this.contextSave(args);
      // ... other tools
    }
  }
}
```

### 2. Database Manager (`src/utils/database.ts`)

Handles all database operations with transaction support:

```typescript
class DatabaseManager {
  private db: Database.Database;

  // Transaction wrapper for atomic operations
  transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  // Automatic size tracking and cleanup
  getSessionSize(sessionId: string): SessionStats {
    // Efficient size calculation
  }
}
```

### 3. Validation Module (`src/utils/validation.ts`)

Input validation and sanitization:

```typescript
const validateContextSaveArgs = (args: any): ContextSaveArgs => {
  if (!args.key || typeof args.key !== 'string') {
    throw new ValidationError('key is required');
  }
  // Additional validations
  return args as ContextSaveArgs;
};
```

### 4. Git Integration (`src/utils/git.ts`)

Git operations using simple-git:

```typescript
class GitManager {
  private git: SimpleGit;

  async getStatus(): Promise<GitStatus> {
    // Safe git operations with error handling
  }

  async getCurrentBranch(): Promise<string> {
    // Branch detection
  }
}
```

### 5. Knowledge Graph (`src/utils/knowledge-graph.ts`)

Entity and relationship extraction:

```typescript
class KnowledgeGraphManager {
  extractEntities(text: string): Entity[] {
    // NLP-based entity extraction
  }

  findRelationships(entities: Entity[]): Relation[] {
    // Relationship detection
  }
}
```

### 6. Vector Store (`src/utils/vector-store.ts`)

Semantic search implementation:

```typescript
class VectorStore {
  // Character n-gram based embeddings
  createEmbedding(text: string): number[] {
    // Lightweight embedding generation
  }

  cosineSimilarity(a: number[], b: number[]): number {
    // Similarity calculation
  }
}
```

### 7. Multi-Agent System (`src/utils/agents.ts`)

Specialized agents for analysis:

```typescript
abstract class Agent {
  abstract process(task: AgentTask): Promise<AgentResult>;
}

class AnalyzerAgent extends Agent {
  // Pattern detection, trend analysis
}

class SynthesizerAgent extends Agent {
  // Summarization, recommendations
}
```

## Data Flow

### 1. Context Save Flow

```
User Request → MCP Server → Validation → Session Check → Database Insert → Response
                                              ↓
                                    Create session if needed
```

### 2. Search Flow

```
Search Query → Validation → Query Building → Database Search → Ranking → Response
                                                      ↓
                                            Full-text search index
```

### 3. Checkpoint Flow

```
Checkpoint Request → Current State Snapshot → Transaction Begin
                            ↓
                    Save Context Items
                            ↓
                    Save File Cache
                            ↓
                    Save Git Status
                            ↓
                    Transaction Commit → Response
```

## Database Design

### Schema Overview

```sql
-- Core Tables
sessions (id, name, description, branch, parent_id, created_at, updated_at)
context_items (id, session_id, key, value, category, priority, metadata, size, created_at)
file_cache (id, session_id, file_path, content, hash, size, last_read, updated_at)

-- Checkpoint System
checkpoints (id, session_id, name, description, metadata, git_status, git_branch, created_at)
checkpoint_items (id, checkpoint_id, context_item_id)
checkpoint_files (id, checkpoint_id, file_cache_id)

-- Knowledge Graph
entities (id, session_id, type, name, attributes, created_at)
relations (id, session_id, subject_id, predicate, object_id, confidence, created_at)
observations (id, entity_id, observation, source, timestamp)

-- Advanced Features
vector_embeddings (id, content_id, content, embedding, metadata, created_at)
journal_entries (id, session_id, entry, tags, mood, created_at)
compressed_context (id, session_id, original_count, compressed_data, compression_ratio, date_range_start, date_range_end, created_at)
tool_events (id, session_id, tool_name, event_type, data, created_at)
```

### Indexing Strategy

```sql
-- Performance indexes
CREATE INDEX idx_context_items_session ON context_items(session_id);
CREATE INDEX idx_context_items_category ON context_items(category);
CREATE INDEX idx_context_items_priority ON context_items(priority);
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_relations_subject ON relations(subject_id);
CREATE INDEX idx_relations_object ON relations(object_id);
```

### Transaction Patterns

```typescript
// Atomic checkpoint creation
db.transaction(() => {
  const checkpointId = createCheckpoint();
  saveCheckpointItems(checkpointId, items);
  saveCheckpointFiles(checkpointId, files);
  updateSessionTimestamp();
});
```

## Security Considerations

### 1. Input Validation

- All user inputs are validated before processing
- SQL injection prevention through parameterized queries
- Path traversal protection for file operations

### 2. Data Isolation

- Session-based isolation
- No cross-session data leakage
- Secure file path handling

### 3. Error Handling

- No sensitive information in error messages
- Proper error logging without exposing internals
- Graceful degradation on failures

### 4. File Operations

```typescript
// Safe file path resolution
const safePath = path.resolve(basePath, userPath);
if (!safePath.startsWith(basePath)) {
  throw new SecurityError('Invalid file path');
}
```

## Performance Optimization

### 1. Database Optimizations

- **WAL Mode**: Better concurrency
- **Prepared Statements**: Query plan caching
- **Batch Operations**: Reduce round trips
- **Size Tracking**: Automatic cleanup triggers

### 2. Caching Strategy

- In-memory session cache
- Prepared statement caching
- Vector embedding cache

### 3. Search Optimization

- Full-text search indexes
- Limit default results
- Progressive loading

### 4. Memory Management

```typescript
// Streaming large results
function* streamResults(query: string) {
  const stmt = db.prepare(query);
  for (const row of stmt.iterate()) {
    yield processRow(row);
  }
}
```

## Extension Points

### 1. Custom Tools

Add new MCP tools by extending the server:

```typescript
// In index.ts
tools.push({
  name: 'custom_tool',
  description: 'Custom functionality',
  inputSchema: {
    /* schema */
  },
});

// Handler implementation
async function handleCustomTool(args: any) {
  // Implementation
}
```

### 2. Storage Backends

Abstract storage interface for different backends:

```typescript
interface StorageBackend {
  save(item: ContextItem): Promise<string>;
  get(key: string): Promise<ContextItem>;
  search(query: string): Promise<ContextItem[]>;
}
```

### 3. Analysis Plugins

Extend the agent system:

```typescript
class CustomAnalyzer extends Agent {
  async process(task: AgentTask): Promise<AgentResult> {
    // Custom analysis logic
  }
}

// Register with coordinator
coordinator.registerAgent('custom', new CustomAnalyzer());
```

### 4. Export Formats

Add new export formats:

```typescript
interface Exporter {
  export(data: ExportData): Promise<string>;
  getFileExtension(): string;
}

class CSVExporter implements Exporter {
  // CSV export implementation
}
```

### 5. Visualization Export

Export knowledge graphs to popular visualization tools:

```typescript
interface VisualizationExporter {
  exportToD3(graph: GraphData): Promise<D3Format>;
  exportToCytoscape(graph: GraphData): Promise<CytoscapeFormat>;
  exportToNeo4j(graph: GraphData): Promise<CypherQueries>;
  exportToGraphML(graph: GraphData): Promise<string>;
}

// D3.js format example
{
  "nodes": [
    {"id": "1", "group": "function", "value": 10},
    {"id": "2", "group": "class", "value": 20}
  ],
  "links": [
    {"source": "1", "target": "2", "value": 1}
  ]
}

// Cytoscape format example
{
  "elements": {
    "nodes": [
      {"data": {"id": "a", "label": "Node A"}},
      {"data": {"id": "b", "label": "Node B"}}
    ],
    "edges": [
      {"data": {"source": "a", "target": "b"}}
    ]
  }
}
```

## Future Considerations

### 1. Scalability

- **Sharding**: Split large databases by date/session
- **Replication**: Read replicas for search
- **Caching Layer**: Redis for hot data

### 2. Cloud Sync

- **Conflict Resolution**: Three-way merge for sync
- **Encryption**: End-to-end encryption for cloud storage
- **Selective Sync**: Choose what to sync

### 3. Multi-User Support

- **Access Control**: Role-based permissions
- **Audit Trail**: Track all operations
- **Collaboration**: Shared sessions with locking

### 4. Advanced Features

- **Machine Learning**: Better entity extraction
- **Visualization**: Built-in graph rendering with export support
- **Plugins**: Third-party extensions
- **Natural Language**: Query translation capabilities
- **Community Patterns**: Shared rule sets and templates

### 5. Performance Monitoring

```typescript
interface Metrics {
  responseTime: Histogram;
  databaseSize: Gauge;
  activeConnections: Counter;
  errorRate: Counter;
}
```

## Development Guidelines

### 1. Adding New Features

1. Design the database schema
2. Implement validation logic
3. Add core functionality
4. Write comprehensive tests
5. Update documentation

### 2. Testing Strategy

- Unit tests for all modules
- Integration tests for workflows
- Performance tests for large datasets
- Manual testing checklist

### 3. Error Handling

```typescript
// Consistent error handling
try {
  return await operation();
} catch (error) {
  logger.error('Operation failed', { error, context });
  throw new McpError(ErrorCode.INTERNAL_ERROR, 'Operation failed', {
    originalError: error.message,
  });
}
```

### 4. Logging

```typescript
// Structured logging
logger.info('Context saved', {
  sessionId,
  key,
  category,
  size: value.length,
  duration: Date.now() - startTime,
});
```

## Conclusion

MCP Memory Keeper's architecture is designed to be:

- **Simple**: Easy to understand and modify
- **Reliable**: Robust data persistence
- **Performant**: Efficient for typical use cases
- **Extensible**: Clear extension points

The modular design allows for future enhancements while maintaining backward compatibility and system stability.
