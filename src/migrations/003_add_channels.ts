import { Migration } from '../utils/migrations';

export const addChannelsMigration: Omit<Migration, 'id' | 'createdAt'> = {
  version: '3.0.0',
  name: 'Add channels support for context organization',
  description:
    'Add channel column to context_items and default_channel to sessions for better context organization.',
  requiresBackup: true,
  dependencies: ['2.0.0'], // Depends on the simplify-sharing migration

  up: `
    -- Add channel column to context_items table with default 'general'
    -- SQLite doesn't support adding columns with constraints directly, so we need to recreate the table
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
      channel TEXT NOT NULL DEFAULT 'general',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, key)
    );
    
    -- Copy data from old table to new, using 'general' as default channel
    INSERT INTO context_items_new (
      id, session_id, key, value, category, priority, metadata, size, is_private, channel, created_at, updated_at
    )
    SELECT 
      id, session_id, key, value, category, priority, metadata, size, is_private, 'general', created_at, updated_at
    FROM context_items;
    
    -- Drop old table and rename new one
    DROP TABLE context_items;
    ALTER TABLE context_items_new RENAME TO context_items;
    
    -- Recreate all indexes including new channel index
    CREATE INDEX IF NOT EXISTS idx_context_items_session ON context_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_context_items_key ON context_items(key);
    CREATE INDEX IF NOT EXISTS idx_context_items_category ON context_items(category);
    CREATE INDEX IF NOT EXISTS idx_context_items_priority ON context_items(priority);
    CREATE INDEX IF NOT EXISTS idx_context_items_private ON context_items(is_private);
    CREATE INDEX IF NOT EXISTS idx_context_items_created ON context_items(created_at);
    CREATE INDEX IF NOT EXISTS idx_context_items_channel ON context_items(channel);
    CREATE INDEX IF NOT EXISTS idx_context_items_channel_session ON context_items(channel, session_id);
    
    -- Recreate the updated_at trigger
    DROP TRIGGER IF EXISTS update_context_items_timestamp;
    CREATE TRIGGER update_context_items_timestamp 
    AFTER UPDATE ON context_items
    BEGIN
      UPDATE context_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
    
    -- Add default_channel column to sessions table
    -- Again, need to recreate the table
    CREATE TABLE sessions_new (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      branch TEXT,
      working_directory TEXT,
      parent_id TEXT,
      default_channel TEXT NOT NULL DEFAULT 'general',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES sessions(id)
    );
    
    -- Copy data from old sessions table
    INSERT INTO sessions_new (
      id, name, description, branch, working_directory, parent_id, default_channel, created_at, updated_at
    )
    SELECT 
      id, name, description, branch, working_directory, parent_id, 'general', created_at, updated_at
    FROM sessions;
    
    -- Drop old table and rename new one
    DROP TABLE sessions;
    ALTER TABLE sessions_new RENAME TO sessions;
    
    -- Recreate the updated_at trigger for sessions
    DROP TRIGGER IF EXISTS update_sessions_timestamp;
    CREATE TRIGGER update_sessions_timestamp 
    AFTER UPDATE ON sessions
    BEGIN
      UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `,

  down: `
    -- Revert context_items to previous schema
    CREATE TABLE context_items_old (
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
    
    -- Copy data back without channel column
    INSERT INTO context_items_old (
      id, session_id, key, value, category, priority, metadata, size, is_private, created_at, updated_at
    )
    SELECT 
      id, session_id, key, value, category, priority, metadata, size, is_private, created_at, updated_at
    FROM context_items;
    
    -- Drop new table and rename old one back
    DROP TABLE context_items;
    ALTER TABLE context_items_old RENAME TO context_items;
    
    -- Recreate original indexes
    CREATE INDEX IF NOT EXISTS idx_context_items_session ON context_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_context_items_key ON context_items(key);
    CREATE INDEX IF NOT EXISTS idx_context_items_category ON context_items(category);
    CREATE INDEX IF NOT EXISTS idx_context_items_priority ON context_items(priority);
    CREATE INDEX IF NOT EXISTS idx_context_items_private ON context_items(is_private);
    CREATE INDEX IF NOT EXISTS idx_context_items_created ON context_items(created_at);
    
    -- Recreate the updated_at trigger
    DROP TRIGGER IF EXISTS update_context_items_timestamp;
    CREATE TRIGGER update_context_items_timestamp 
    AFTER UPDATE ON context_items
    BEGIN
      UPDATE context_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
    
    -- Revert sessions to previous schema
    CREATE TABLE sessions_old (
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
    
    -- Copy data back without default_channel column
    INSERT INTO sessions_old (
      id, name, description, branch, working_directory, parent_id, created_at, updated_at
    )
    SELECT 
      id, name, description, branch, working_directory, parent_id, created_at, updated_at
    FROM sessions;
    
    -- Drop new table and rename old one back
    DROP TABLE sessions;
    ALTER TABLE sessions_old RENAME TO sessions;
    
    -- Recreate the updated_at trigger for sessions
    DROP TRIGGER IF EXISTS update_sessions_timestamp;
    CREATE TRIGGER update_sessions_timestamp 
    AFTER UPDATE ON sessions
    BEGIN
      UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `,
};
