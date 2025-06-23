import { Migration } from '../utils/migrations';

export const simplifySharingMigration: Omit<Migration, 'id' | 'createdAt'> = {
  version: '2.0.0',
  name: 'Simplify sharing model - remove complex sharing, add is_private flag',
  description:
    'Replace broken sharing mechanism with simple is_private flag. Items are shared by default unless marked private.',
  requiresBackup: true,
  dependencies: ['1.2.0'], // Assuming the latest migration from defaults is 1.2.0

  up: `
    -- Add the new is_private column with default false (shared by default)
    ALTER TABLE context_items ADD COLUMN is_private INTEGER DEFAULT 0;
    
    -- All existing items become public (is_private = 0)
    -- This makes all previously saved context accessible across sessions
    UPDATE context_items SET is_private = 0;
    
    -- Create index for performance on the new column
    CREATE INDEX IF NOT EXISTS idx_context_items_private ON context_items(is_private);
    
    -- Drop the old sharing-related columns
    -- SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
    CREATE TABLE context_items_new (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT,
      priority TEXT DEFAULT 'normal',
      metadata TEXT,
      size INTEGER DEFAULT 0,
      is_private INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, key)
    );
    
    -- Copy data from old table to new
    INSERT INTO context_items_new (
      id, session_id, key, value, category, priority, metadata, size, is_private, created_at, updated_at
    )
    SELECT 
      id, session_id, key, value, category, priority, metadata, size, is_private, created_at, updated_at
    FROM context_items;
    
    -- Drop old table and rename new one
    DROP TABLE context_items;
    ALTER TABLE context_items_new RENAME TO context_items;
    
    -- Recreate indexes
    CREATE INDEX IF NOT EXISTS idx_context_items_session ON context_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_context_items_key ON context_items(key);
    CREATE INDEX IF NOT EXISTS idx_context_items_category ON context_items(category);
    CREATE INDEX IF NOT EXISTS idx_context_items_priority ON context_items(priority);
    CREATE INDEX IF NOT EXISTS idx_context_items_private ON context_items(is_private);
    CREATE INDEX IF NOT EXISTS idx_context_items_created ON context_items(created_at);
    
    -- Update the updated_at trigger
    DROP TRIGGER IF EXISTS update_context_items_timestamp;
    CREATE TRIGGER update_context_items_timestamp 
    AFTER UPDATE ON context_items
    BEGIN
      UPDATE context_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `,

  down: `
    -- Revert to the old schema
    CREATE TABLE context_items_old (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT,
      priority TEXT DEFAULT 'normal',
      metadata TEXT,
      size INTEGER DEFAULT 0,
      shared INTEGER DEFAULT 0,
      shared_with_sessions TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, key)
    );
    
    -- Copy data back
    -- Since we made everything public in the up migration, we'll set shared = 1 for all
    INSERT INTO context_items_old (
      id, session_id, key, value, category, priority, metadata, size, shared, created_at, updated_at
    )
    SELECT 
      id, session_id, key, value, category, priority, metadata, size, 
      1, -- All items were made public, so mark as shared
      created_at, updated_at
    FROM context_items;
    
    -- Drop new table and rename old one back
    DROP TABLE context_items;
    ALTER TABLE context_items_old RENAME TO context_items;
    
    -- Recreate original indexes
    CREATE INDEX IF NOT EXISTS idx_context_items_session ON context_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_context_items_key ON context_items(key);
    CREATE INDEX IF NOT EXISTS idx_context_items_category ON context_items(category);
    CREATE INDEX IF NOT EXISTS idx_context_items_priority ON context_items(priority);
    CREATE INDEX IF NOT EXISTS idx_context_items_shared ON context_items(shared);
    CREATE INDEX IF NOT EXISTS idx_context_items_created ON context_items(created_at);
    
    -- Recreate the updated_at trigger
    DROP TRIGGER IF EXISTS update_context_items_timestamp;
    CREATE TRIGGER update_context_items_timestamp 
    AFTER UPDATE ON context_items
    BEGIN
      UPDATE context_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `,
};
