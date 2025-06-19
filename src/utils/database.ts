import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface DatabaseConfig {
  filename: string;
  maxSize?: number; // Maximum database size in bytes
  walMode?: boolean; // Enable WAL mode for better concurrency
}

export class DatabaseManager {
  private db: Database.Database;
  private config: Required<DatabaseConfig>;

  constructor(config: DatabaseConfig) {
    this.config = {
      filename: config.filename,
      maxSize: config.maxSize || 100 * 1024 * 1024, // 100MB default
      walMode: config.walMode !== false // WAL mode enabled by default
    };

    this.db = new Database(this.config.filename);
    this.initialize();
  }

  private initialize(): void {
    // Enable WAL mode for better concurrency
    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
    }

    // Set busy timeout to handle concurrent access
    this.db.pragma('busy_timeout = 5000'); // 5 seconds

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Apply any schema migrations BEFORE creating tables
    this.applyMigrations();
    
    // Create tables
    this.createTables();

    // Set up maintenance triggers
    this.setupMaintenanceTriggers();
  }
  
  private applyMigrations(): void {
    // First check if sessions table exists
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").all();
    if (tables.length > 0) {
      // Table exists, check if working_directory column exists
      const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as any[];
      const hasWorkingDirectory = columns.some((col: any) => col.name === 'working_directory');
      
      if (!hasWorkingDirectory) {
        // Add working_directory column to existing sessions table
        this.db.exec('ALTER TABLE sessions ADD COLUMN working_directory TEXT');
      }
    }
  }

  private createTables(): void {
    this.db.exec(`
      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        branch TEXT,
        working_directory TEXT,
        parent_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES sessions(id)
      );

      -- Enhanced context_items table with size tracking
      CREATE TABLE IF NOT EXISTS context_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        priority TEXT DEFAULT 'normal',
        metadata TEXT,
        size INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, key)
      );

      -- File cache table with size tracking
      CREATE TABLE IF NOT EXISTS file_cache (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content TEXT,
        hash TEXT,
        size INTEGER DEFAULT 0,
        last_read TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, file_path)
      );

      -- Checkpoints table (Phase 2)
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        metadata TEXT,
        git_status TEXT,
        git_branch TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      -- Checkpoint items table (Phase 2)
      CREATE TABLE IF NOT EXISTS checkpoint_items (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL,
        context_item_id TEXT NOT NULL,
        FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
        FOREIGN KEY (context_item_id) REFERENCES context_items(id) ON DELETE CASCADE
      );

      -- Checkpoint files table (Phase 2)
      CREATE TABLE IF NOT EXISTS checkpoint_files (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL,
        file_cache_id TEXT NOT NULL,
        FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
        FOREIGN KEY (file_cache_id) REFERENCES file_cache(id) ON DELETE CASCADE
      );

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_context_items_session ON context_items(session_id);
      CREATE INDEX IF NOT EXISTS idx_context_items_category ON context_items(category);
      CREATE INDEX IF NOT EXISTS idx_context_items_priority ON context_items(priority);
      CREATE INDEX IF NOT EXISTS idx_file_cache_session ON file_cache(session_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);

      -- Knowledge Graph tables (Phase 4.1)
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        attributes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_id TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        observation TEXT NOT NULL,
        source TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      -- Indexes for knowledge graph
      CREATE INDEX IF NOT EXISTS idx_entities_session_type ON entities(session_id, type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_relations_subject ON relations(subject_id);
      CREATE INDEX IF NOT EXISTS idx_relations_object ON relations(object_id);
      CREATE INDEX IF NOT EXISTS idx_relations_predicate ON relations(predicate);
      CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_id);

      -- Vector embeddings table (Phase 4.2)
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (content_id) REFERENCES context_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_vector_content_id ON vector_embeddings(content_id);

      -- Journal entries table (Phase 4.4)
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        entry TEXT NOT NULL,
        tags TEXT,
        mood TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      -- Compressed context table (Phase 4.4)
      CREATE TABLE IF NOT EXISTS compressed_context (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        original_count INTEGER NOT NULL,
        compressed_data TEXT NOT NULL,
        compression_ratio REAL NOT NULL,
        date_range_start TIMESTAMP,
        date_range_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      -- Cross-tool integration events (Phase 4.4)
      CREATE TABLE IF NOT EXISTS tool_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
  }

  private setupMaintenanceTriggers(): void {
    // Update size when inserting/updating context items
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_context_item_size
      AFTER INSERT ON context_items
      BEGIN
        UPDATE context_items 
        SET size = LENGTH(NEW.value) 
        WHERE id = NEW.id;
      END;
    `);

    // Update size when inserting/updating file cache
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_file_cache_size
      AFTER INSERT ON file_cache
      BEGIN
        UPDATE file_cache 
        SET size = LENGTH(NEW.content) 
        WHERE id = NEW.id;
      END;
    `);
  }

  getDatabaseSize(): number {
    const stats = fs.statSync(this.config.filename);
    return stats.size;
  }

  isDatabaseFull(): boolean {
    return this.getDatabaseSize() >= this.config.maxSize;
  }

  getSessionSize(sessionId: string): { items: number; files: number; totalSize: number } {
    const result = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM context_items WHERE session_id = ?) as item_count,
        (SELECT COUNT(*) FROM file_cache WHERE session_id = ?) as file_count,
        (SELECT COALESCE(SUM(size), 0) FROM context_items WHERE session_id = ?) +
        (SELECT COALESCE(SUM(size), 0) FROM file_cache WHERE session_id = ?) as total_size
    `).get(sessionId, sessionId, sessionId, sessionId) as any;

    return {
      items: result.item_count,
      files: result.file_count,
      totalSize: result.total_size
    };
  }

  // Clean up old sessions to free space
  cleanupOldSessions(daysToKeep: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = this.db.prepare(`
      DELETE FROM sessions 
      WHERE created_at < ? 
      AND id NOT IN (
        SELECT session_id FROM checkpoints 
        GROUP BY session_id
      )
    `).run(cutoffDate.toISOString());

    return result.changes;
  }

  // Vacuum database to reclaim space
  vacuum(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.exec('VACUUM');
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  // Transaction wrapper for atomic operations
  transaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }
}