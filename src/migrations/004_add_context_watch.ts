import { Database } from 'better-sqlite3';

export const version = '0.4.0';
export const description = 'Add context watch functionality with change tracking';

export function up(db: Database): void {
  db.transaction(() => {
    // Create change tracking table
    db.exec(`
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
    db.exec(`
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
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_changes_sequence ON context_changes(sequence_id);
      CREATE INDEX IF NOT EXISTS idx_changes_session_seq ON context_changes(session_id, sequence_id);
      CREATE INDEX IF NOT EXISTS idx_changes_created ON context_changes(created_at);
      CREATE INDEX IF NOT EXISTS idx_watchers_expires ON context_watchers(expires_at);
      CREATE INDEX IF NOT EXISTS idx_watchers_session ON context_watchers(session_id);
    `);

    // Create triggers for change tracking
    db.exec(`
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

    // Add migration record
    db.prepare(
      `
      INSERT INTO migrations (id, version, name, description, up_sql, applied_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `
    ).run(
      version,
      version,
      '004_add_context_watch',
      description,
      'See migration file for full SQL'
    );
  })();
}

export function down(db: Database): void {
  db.transaction(() => {
    // Drop triggers
    db.exec(`
      DROP TRIGGER IF EXISTS track_context_insert;
      DROP TRIGGER IF EXISTS track_context_update;
      DROP TRIGGER IF EXISTS track_context_delete;
    `);

    // Drop indexes
    db.exec(`
      DROP INDEX IF EXISTS idx_changes_sequence;
      DROP INDEX IF EXISTS idx_changes_session_seq;
      DROP INDEX IF EXISTS idx_changes_created;
      DROP INDEX IF EXISTS idx_watchers_expires;
      DROP INDEX IF EXISTS idx_watchers_session;
    `);

    // Drop tables
    db.exec(`
      DROP TABLE IF EXISTS context_watchers;
      DROP TABLE IF EXISTS context_changes;
    `);

    // Remove migration record
    db.prepare('DELETE FROM migrations WHERE version = ?').run(version);
  })();
}

// Helper to check if migration is needed
export function needsMigration(db: Database): boolean {
  const result = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM sqlite_master 
    WHERE type='table' AND name IN ('context_changes', 'context_watchers')
  `
    )
    .get() as any;

  return result.count < 2;
}
