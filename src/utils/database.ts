import Database from 'better-sqlite3';
import { MigrationHealthCheck } from './migrationHealthCheck';

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
      walMode: config.walMode !== false, // WAL mode enabled by default
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

    // First, check if this is an existing database that might need migration
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    if (tables.length > 0) {
      // Existing database - run health check first before creating tables
      const healthCheck = new MigrationHealthCheck(this);
      healthCheck.runAutoFix();
    }

    // Create tables (will use CREATE TABLE IF NOT EXISTS, so safe to run after migrations)
    this.createTables();

    // Apply watcher migrations if needed
    this.applyWatcherMigrations();

    // Set up maintenance triggers
    this.setupMaintenanceTriggers();
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
        default_channel TEXT DEFAULT 'general',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES sessions(id)
      );

      -- Enhanced context_items table with size tracking and simplified sharing
      CREATE TABLE IF NOT EXISTS context_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        priority TEXT DEFAULT 'normal',
        metadata TEXT,
        size INTEGER DEFAULT 0,
        is_private INTEGER DEFAULT 0,
        channel TEXT DEFAULT 'general',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
      CREATE INDEX IF NOT EXISTS idx_context_items_private ON context_items(is_private);
      CREATE INDEX IF NOT EXISTS idx_context_items_channel ON context_items(channel);
      CREATE INDEX IF NOT EXISTS idx_context_items_created ON context_items(created_at);
      CREATE INDEX IF NOT EXISTS idx_context_items_session_created ON context_items(session_id, created_at);
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

      -- Vector Storage tables (Phase 4.2)
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        content_type TEXT NOT NULL, -- 'context_item' or 'file_cache'
        embedding BLOB NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(content_id, content_type)
      );

      CREATE INDEX IF NOT EXISTS idx_embeddings_content ON embeddings(content_id, content_type);

      -- Multi-Agent System tables (Phase 4.3)
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        input TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS agent_results (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        output TEXT NOT NULL,
        confidence REAL DEFAULT 0.0,
        reasoning TEXT,
        processing_time INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_results_task ON agent_results(task_id);

      -- Journal table (Phase 4.4)
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        entry TEXT NOT NULL,
        mood TEXT,
        tags TEXT, -- JSON array of tags
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_journal_session ON journal_entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at);

      -- Context Relationships table
      CREATE TABLE IF NOT EXISTS context_relationships (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        from_key TEXT NOT NULL,
        to_key TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, from_key, to_key, relationship_type)
      );

      CREATE INDEX IF NOT EXISTS idx_relationships_from ON context_relationships(session_id, from_key);
      CREATE INDEX IF NOT EXISTS idx_relationships_to ON context_relationships(session_id, to_key);
      CREATE INDEX IF NOT EXISTS idx_relationships_type ON context_relationships(relationship_type);

      -- Compaction history table (Phase 4.4)
      CREATE TABLE IF NOT EXISTS compaction_history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        items_before INTEGER NOT NULL,
        items_after INTEGER NOT NULL,
        size_before INTEGER NOT NULL,
        size_after INTEGER NOT NULL,
        summary TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      -- Retention Policies table (Phase 5.1)
      CREATE TABLE IF NOT EXISTS retention_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        enabled BOOLEAN DEFAULT 1,
        policy_config TEXT NOT NULL, -- JSON configuration
        last_run TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS retention_executions (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        session_id TEXT,
        dry_run BOOLEAN DEFAULT 1,
        items_affected INTEGER DEFAULT 0,
        size_freed INTEGER DEFAULT 0,
        execution_log TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (policy_id) REFERENCES retention_policies(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS retention_logs (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (policy_id) REFERENCES retention_policies(id) ON DELETE CASCADE
      );

      -- Feature Flags table (Phase 5.2)
      CREATE TABLE IF NOT EXISTS feature_flags (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        enabled BOOLEAN DEFAULT 0,
        category TEXT,
        environments TEXT, -- JSON array
        users TEXT, -- JSON array
        percentage INTEGER DEFAULT 0,
        enabled_from TEXT,
        enabled_until TEXT,
        tags TEXT, -- JSON array
        created_by TEXT,
        last_modified_by TEXT,
        config TEXT, -- JSON configuration
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feature_flag_history (
        id TEXT PRIMARY KEY,
        flag_id TEXT NOT NULL,
        user_id TEXT,
        action TEXT NOT NULL, -- 'created', 'updated', 'evaluated'
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (flag_id) REFERENCES feature_flags(id) ON DELETE CASCADE
      );

      -- Compressed context table for retention policies
      CREATE TABLE IF NOT EXISTS compressed_context (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        original_count INTEGER NOT NULL,
        compressed_data TEXT NOT NULL,
        compression_ratio REAL NOT NULL,
        date_range_start TIMESTAMP NOT NULL,
        date_range_end TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_compressed_session ON compressed_context(session_id);

      -- Database Migrations table (Phase 5.3)
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        up_sql TEXT NOT NULL,
        down_sql TEXT,
        dependencies TEXT, -- JSON array of version strings
        requires_backup BOOLEAN DEFAULT 0,
        checksum TEXT,
        applied_at TIMESTAMP,
        rolled_back_at TIMESTAMP,
        rollback_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS migration_log (
        id TEXT PRIMARY KEY,
        migration_id TEXT NOT NULL,
        version TEXT NOT NULL,
        action TEXT NOT NULL, -- 'apply', 'rollback', 'backup'
        success BOOLEAN NOT NULL,
        errors TEXT, -- JSON array
        warnings TEXT, -- JSON array
        error_message TEXT,
        execution_time INTEGER, -- milliseconds
        rows_affected INTEGER,
        backup_path TEXT,
        duration_ms INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_migrations_version ON migrations(version);
      CREATE INDEX IF NOT EXISTS idx_migrations_applied ON migrations(applied_at);

      -- Migration for existing databases - add new columns if they don't exist
      ${this.getMigrationSQL()}
    `);
  }

  private getMigrationSQL(): string {
    // The shared columns are already defined in the CREATE TABLE statement above
    // This method is kept for potential future migrations
    return '';
  }

  private addColumnIfNotExists(table: string, column: string, definition: string): string {
    // SQLite doesn't support IF NOT EXISTS for columns, so we need to check first
    const hasColumn = this.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM pragma_table_info(?) WHERE name = ?
    `
      )
      .get(table, column) as any;

    if (hasColumn.count === 0) {
      return `ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`;
    }
    return '';
  }

  private setupMaintenanceTriggers(): void {
    // Update timestamp trigger
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_context_items_timestamp 
      AFTER UPDATE ON context_items
      BEGIN
        UPDATE context_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_sessions_timestamp 
      AFTER UPDATE ON sessions
      BEGIN
        UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_retention_policies_timestamp 
      AFTER UPDATE ON retention_policies
      BEGIN
        UPDATE retention_policies SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS update_feature_flags_timestamp 
      AFTER UPDATE ON feature_flags
      BEGIN
        UPDATE feature_flags SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  getDatabaseSize(): number {
    const result = this.db
      .prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()')
      .get() as any;
    return result.size;
  }

  getTableSizes(): Record<string, number> {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as any[];
    const sizes: Record<string, number> = {};

    for (const table of tables) {
      const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as any;
      sizes[table.name] = result.count;
    }

    return sizes;
  }

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  runInTransaction<T>(fn: () => T): T {
    const transaction = this.db.transaction(fn);
    return transaction();
  }

  transaction<T>(fn: () => T): T {
    return this.runInTransaction(fn);
  }

  isDatabaseFull(): boolean {
    const currentSize = this.getDatabaseSize();
    return currentSize >= this.config.maxSize;
  }

  getSessionSize(sessionId: string): { items: number; files: number; totalSize: number } {
    const itemsResult = this.db
      .prepare(
        `
      SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize 
      FROM context_items 
      WHERE session_id = ?
    `
      )
      .get(sessionId) as any;

    const filesResult = this.db
      .prepare(
        `
      SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize 
      FROM file_cache 
      WHERE session_id = ?
    `
      )
      .get(sessionId) as any;

    return {
      items: itemsResult?.count || 0,
      files: filesResult?.count || 0,
      totalSize: (itemsResult?.totalSize || 0) + (filesResult?.totalSize || 0),
    };
  }

  cleanupOldSessions(daysToKeep: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const oldSessions = this.db
      .prepare(
        `
      SELECT id FROM sessions 
      WHERE updated_at < ? 
      ORDER BY updated_at ASC
    `
      )
      .all(cutoffDate.toISOString()) as any[];

    let deletedCount = 0;

    for (const session of oldSessions) {
      try {
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete session ${session.id}:`, error);
      }
    }

    return deletedCount;
  }

  private applyWatcherMigrations(): void {
    try {
      // Check if watcher tables are missing using the needsMigration logic
      const result = this.db
        .prepare(
          `
        SELECT COUNT(*) as count FROM sqlite_master 
        WHERE type='table' AND name IN ('context_changes', 'context_watchers')
      `
        )
        .get() as any;

      const needsMigration = result.count < 2;

      if (needsMigration) {
        // console.log('Applying watcher migrations...');

        // Apply migration 004 - context watch functionality
        this.db.transaction(() => {
          // Create change tracking table
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS context_changes (
              sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              item_id TEXT NOT NULL,
              key TEXT NOT NULL,
              operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
              old_value TEXT,
              new_value TEXT,
              old_metadata TEXT,
              new_metadata TEXT,
              category TEXT,
              priority TEXT,
              channel TEXT,
              size_delta INTEGER DEFAULT 0,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              created_by TEXT,
              FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
          `);

          // Create watchers registry table
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS context_watchers (
              id TEXT PRIMARY KEY,
              session_id TEXT,
              filter_keys TEXT,
              filter_categories TEXT,
              filter_channels TEXT,
              filter_priorities TEXT,
              last_sequence INTEGER DEFAULT 0,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              last_poll_at TIMESTAMP,
              expires_at TIMESTAMP,
              metadata TEXT,
              FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
          `);

          // Create indexes for performance
          this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_changes_sequence ON context_changes(sequence_id);
            CREATE INDEX IF NOT EXISTS idx_changes_session_seq ON context_changes(session_id, sequence_id);
            CREATE INDEX IF NOT EXISTS idx_changes_created ON context_changes(created_at);
            CREATE INDEX IF NOT EXISTS idx_watchers_expires ON context_watchers(expires_at);
            CREATE INDEX IF NOT EXISTS idx_watchers_session ON context_watchers(session_id);
          `);

          // Create triggers for change tracking
          this.db.exec(`
            -- Trigger for INSERT operations on context_items
            CREATE TRIGGER IF NOT EXISTS track_context_insert
            AFTER INSERT ON context_items
            BEGIN
              INSERT INTO context_changes (
                session_id, item_id, key, operation, 
                new_value, new_metadata, category, priority, channel,
                size_delta, created_by
              ) VALUES (
                NEW.session_id, NEW.id, NEW.key, 'CREATE',
                NEW.value, NEW.metadata, NEW.category, NEW.priority, NEW.channel,
                NEW.size, 'context_save'
              );
            END;

            -- Trigger for UPDATE operations on context_items
            CREATE TRIGGER IF NOT EXISTS track_context_update
            AFTER UPDATE ON context_items
            WHEN OLD.value != NEW.value OR 
                 IFNULL(OLD.metadata, '') != IFNULL(NEW.metadata, '') OR 
                 IFNULL(OLD.category, '') != IFNULL(NEW.category, '') OR
                 IFNULL(OLD.priority, '') != IFNULL(NEW.priority, '') OR
                 IFNULL(OLD.channel, '') != IFNULL(NEW.channel, '')
            BEGIN
              INSERT INTO context_changes (
                session_id, item_id, key, operation,
                old_value, new_value, old_metadata, new_metadata,
                category, priority, channel, size_delta, created_by
              ) VALUES (
                NEW.session_id, NEW.id, NEW.key, 'UPDATE',
                OLD.value, NEW.value, OLD.metadata, NEW.metadata,
                NEW.category, NEW.priority, NEW.channel,
                NEW.size - OLD.size, 'context_save'
              );
            END;

            -- Trigger for DELETE operations on context_items
            CREATE TRIGGER IF NOT EXISTS track_context_delete
            AFTER DELETE ON context_items
            BEGIN
              INSERT INTO context_changes (
                session_id, item_id, key, operation,
                old_value, old_metadata, category, priority, channel,
                size_delta, created_by
              ) VALUES (
                OLD.session_id, OLD.id, OLD.key, 'DELETE',
                OLD.value, OLD.metadata, OLD.category, OLD.priority, OLD.channel,
                -OLD.size, 'context_delete'
              );
            END;
          `);
        })();

        // Apply migration 005 - additional watcher functionality
        this.db.transaction(() => {
          // Add is_active column to context_watchers if not exists
          const watchers_columns = this.db
            .prepare('PRAGMA table_info(context_watchers)')
            .all() as any[];
          if (!watchers_columns.some((col: any) => col.name === 'is_active')) {
            this.db.exec('ALTER TABLE context_watchers ADD COLUMN is_active INTEGER DEFAULT 1');
            this.db.exec(
              'CREATE INDEX IF NOT EXISTS idx_watchers_active ON context_watchers(is_active)'
            );
          }

          // Add sequence_number column to context_items if not exists
          const columns = this.db.prepare('PRAGMA table_info(context_items)').all() as any[];
          if (!columns.some((col: any) => col.name === 'sequence_number')) {
            this.db.exec('ALTER TABLE context_items ADD COLUMN sequence_number INTEGER DEFAULT 0');

            // Update existing rows with sequence numbers
            this.db.exec(`
              UPDATE context_items 
              SET sequence_number = (
                SELECT COUNT(*) 
                FROM context_items c2 
                WHERE c2.session_id = context_items.session_id 
                AND c2.created_at <= context_items.created_at
              )
              WHERE sequence_number = 0
            `);

            // Create trigger to auto-increment sequence numbers for new inserts
            this.db.exec(`
              CREATE TRIGGER IF NOT EXISTS increment_sequence_insert
              AFTER INSERT ON context_items
              FOR EACH ROW
              WHEN NEW.sequence_number = 0
              BEGIN
                UPDATE context_items 
                SET sequence_number = (
                  SELECT COALESCE(MAX(sequence_number), 0) + 1 
                  FROM context_items 
                  WHERE session_id = NEW.session_id
                )
                WHERE id = NEW.id;
              END
            `);

            // Create trigger to update sequence numbers on updates
            this.db.exec(`
              CREATE TRIGGER IF NOT EXISTS increment_sequence_update
              AFTER UPDATE OF value, metadata, category, priority, channel ON context_items
              FOR EACH ROW
              WHEN OLD.value != NEW.value OR 
                   IFNULL(OLD.metadata, '') != IFNULL(NEW.metadata, '') OR 
                   IFNULL(OLD.category, '') != IFNULL(NEW.category, '') OR
                   IFNULL(OLD.priority, '') != IFNULL(NEW.priority, '') OR
                   IFNULL(OLD.channel, '') != IFNULL(NEW.channel, '')
              BEGIN
                UPDATE context_items 
                SET sequence_number = (
                  SELECT COALESCE(MAX(sequence_number), 0) + 1 
                  FROM context_items 
                  WHERE session_id = NEW.session_id
                )
                WHERE id = NEW.id;
              END
            `);
          }

          // Create table for tracking deleted items (needed for tests)
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS deleted_items (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              key TEXT NOT NULL,
              category TEXT,
              channel TEXT,
              sequence_number INTEGER NOT NULL,
              deleted_at TEXT DEFAULT (datetime('now')),
              FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
          `);

          this.db.exec(
            'CREATE INDEX IF NOT EXISTS idx_deleted_items_session ON deleted_items(session_id)'
          );
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_deleted_items_key ON deleted_items(key)');
        })();

        // Record migrations in the migrations table for tracking
        try {
          // Check if migrations table exists
          const migrationTableExists = this.db
            .prepare(
              `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='migrations'`
            )
            .get() as any;

          if (migrationTableExists.count > 0) {
            // Record migration 004
            const migration004Exists = this.db
              .prepare('SELECT COUNT(*) as count FROM migrations WHERE version = ?')
              .get('0.4.0') as any;

            if (migration004Exists.count === 0) {
              this.db
                .prepare(
                  `INSERT INTO migrations (id, version, name, description, up_sql, applied_at) 
                   VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
                )
                .run(
                  '004_add_context_watch',
                  '0.4.0',
                  '004_add_context_watch',
                  'Add context watch functionality with change tracking',
                  'See migration file for full SQL'
                );
            }

            // Record migration 005
            const migration005Exists = this.db
              .prepare('SELECT COUNT(*) as count FROM migrations WHERE version = ?')
              .get('0.5.0') as any;

            if (migration005Exists.count === 0) {
              this.db
                .prepare(
                  `INSERT INTO migrations (id, version, name, description, up_sql, applied_at) 
                   VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
                )
                .run(
                  '005_add_context_watch',
                  '0.5.0',
                  '005_add_context_watch',
                  'Add missing context watch functionality',
                  'See migration file for full SQL'
                );
            }
          }
        } catch (error) {
          console.warn('Could not record migrations in tracking table:', error);
        }

        // console.log('Watcher migrations applied successfully');
      } else {
        // console.log('Watcher migrations already applied, skipping.');
      }
    } catch (error) {
      console.error('Failed to apply watcher migrations:', error);
      // For production, we should fail here since watcher functionality is critical
      throw new Error(`Critical error: Watcher migrations failed - ${error}`);
    }
  }
}
