import { Database } from 'better-sqlite3';

export const version = '0.5.0';
export const description = 'Add missing context watch functionality';

export const up = (db: Database): void => {
  db.transaction(() => {
    // Add is_active column to context_watchers if not exists
    const watchers_columns = db.prepare('PRAGMA table_info(context_watchers)').all() as any[];
    if (!watchers_columns.some((col: any) => col.name === 'is_active')) {
      db.exec('ALTER TABLE context_watchers ADD COLUMN is_active INTEGER DEFAULT 1');
      db.exec('CREATE INDEX IF NOT EXISTS idx_watchers_active ON context_watchers(is_active)');
    }

    // Add sequence_number column to context_items if not exists
    const columns = db.prepare('PRAGMA table_info(context_items)').all() as any[];
    if (!columns.some((col: any) => col.name === 'sequence_number')) {
      db.exec('ALTER TABLE context_items ADD COLUMN sequence_number INTEGER DEFAULT 0');

      // Update existing rows with sequence numbers
      db.exec(`
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
      db.exec(`
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
      db.exec(`
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
    db.exec(`
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

    db.exec('CREATE INDEX IF NOT EXISTS idx_deleted_items_session ON deleted_items(session_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_deleted_items_key ON deleted_items(key)');
  })();
};

export const down = (db: Database): void => {
  db.transaction(() => {
    // Drop triggers
    db.exec('DROP TRIGGER IF EXISTS increment_sequence_insert');
    db.exec('DROP TRIGGER IF EXISTS increment_sequence_update');

    // Drop indexes
    db.exec('DROP INDEX IF EXISTS idx_watchers_active');
    db.exec('DROP INDEX IF EXISTS idx_deleted_items_session');
    db.exec('DROP INDEX IF EXISTS idx_deleted_items_key');

    // Drop tables
    db.exec('DROP TABLE IF EXISTS deleted_items');

    // Note: We don't remove the sequence_number and is_active columns as it might break existing data
  })();
};
