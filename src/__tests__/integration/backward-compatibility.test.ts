import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

describe('Backward Compatibility Tests', () => {
  const testDbPath = path.join(__dirname, `test-backward-compat-${Date.now()}.db`);

  afterEach(() => {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(`${testDbPath}-wal`)) {
      fs.unlinkSync(`${testDbPath}-wal`);
    }
    if (fs.existsSync(`${testDbPath}-shm`)) {
      fs.unlinkSync(`${testDbPath}-shm`);
    }
  });

  describe('Migration from v0.8.5 to v0.9.0', () => {
    it('should seamlessly migrate existing database on first connection', () => {
      // Step 1: Create a v0.8.5-style database
      const oldDb = new Database(testDbPath);
      
      // Create old schema without shared columns
      oldDb.exec(`
        CREATE TABLE sessions (
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
        
        CREATE TABLE context_items (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          category TEXT,
          priority TEXT DEFAULT 'normal',
          metadata TEXT,
          size INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          UNIQUE(session_id, key)
        );
        
        CREATE TABLE file_cache (
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
        
        CREATE TABLE checkpoints (
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
        
        -- Add all the other tables that existed in v0.8.5
        CREATE TABLE checkpoint_items (
          id TEXT PRIMARY KEY,
          checkpoint_id TEXT NOT NULL,
          context_item_id TEXT NOT NULL,
          FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
          FOREIGN KEY (context_item_id) REFERENCES context_items(id) ON DELETE CASCADE
        );
        
        CREATE TABLE checkpoint_files (
          id TEXT PRIMARY KEY,
          checkpoint_id TEXT NOT NULL,
          file_cache_id TEXT NOT NULL,
          FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE,
          FOREIGN KEY (file_cache_id) REFERENCES file_cache(id) ON DELETE CASCADE
        );
        
        -- Create indexes
        CREATE INDEX idx_context_items_session ON context_items(session_id);
        CREATE INDEX idx_context_items_category ON context_items(category);
        CREATE INDEX idx_context_items_priority ON context_items(priority);
        CREATE INDEX idx_file_cache_session ON file_cache(session_id);
        CREATE INDEX idx_checkpoints_session ON checkpoints(session_id);
      `);
      
      // Add some test data
      const sessionId = uuidv4();
      const itemId = uuidv4();
      const checkpointId = uuidv4();
      
      oldDb.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)')
        .run(sessionId, 'Legacy Session', 'Created with v0.8.5');
      
      oldDb.prepare('INSERT INTO context_items (id, session_id, key, value, category, priority, size) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(itemId, sessionId, 'legacy_key', 'This is legacy data', 'legacy', 'high', 100);
      
      oldDb.prepare('INSERT INTO checkpoints (id, session_id, name, description) VALUES (?, ?, ?, ?)')
        .run(checkpointId, sessionId, 'legacy-checkpoint', 'Checkpoint from v0.8.5');
      
      oldDb.prepare('INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)')
        .run(uuidv4(), checkpointId, itemId);
      
      oldDb.close();
      
      // Step 2: Open with new DatabaseManager (should trigger migration)
      const dbManager = new DatabaseManager({ filename: testDbPath });
      const repositories = new RepositoryManager(dbManager);
      
      // Step 3: Verify migration succeeded
      const db = dbManager.getDatabase();
      
      // Check that new columns were added
      const contextColumns = db.prepare("PRAGMA table_info(context_items)").all() as any[];
      const columnNames = contextColumns.map(col => col.name);
      
      expect(columnNames).toContain('shared');
      expect(columnNames).toContain('shared_with_sessions');
      
      // Step 4: Verify existing data is intact
      const session = repositories.sessions.getById(sessionId);
      expect(session).toBeTruthy();
      expect(session?.name).toBe('Legacy Session');
      expect(session?.description).toBe('Created with v0.8.5');
      
      const item = repositories.contexts.getByKey(sessionId, 'legacy_key');
      expect(item).toBeTruthy();
      expect(item?.value).toBe('This is legacy data');
      expect(item?.category).toBe('legacy');
      expect(item?.priority).toBe('high');
      expect(item?.shared).toBe(0); // Default value (SQLite stores boolean as 0/1)
      expect(item?.shared_with_sessions).toBeNull(); // Default value
      
      const checkpoints = repositories.checkpoints.getBySessionId(sessionId);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].name).toBe('legacy-checkpoint');
      
      // Step 5: Verify new functionality works
      const newItem = repositories.contexts.save(sessionId, {
        key: 'new_feature_test',
        value: 'Testing cross-session sharing',
        category: 'test'
      });
      
      // Share the new item
      repositories.contexts.shareItem(newItem.id, []);
      
      // Verify it's shared
      const sharedItems = repositories.contexts.getAllSharedItems();
      expect(sharedItems).toHaveLength(1);
      expect(sharedItems[0].key).toBe('new_feature_test');
      
      // Step 6: Verify old items can be shared
      repositories.contexts.shareByKey(sessionId, 'legacy_key', ['test-session']);
      
      const updatedItem = repositories.contexts.getByKey(sessionId, 'legacy_key');
      expect(updatedItem?.shared).toBe(1); // SQLite stores boolean as 0/1
      expect(updatedItem?.shared_with_sessions).toBe('["test-session"]');
      
      dbManager.close();
    });
    
    it('should handle database with partial schema (some new tables missing)', () => {
      // Create a database with only some tables
      const partialDb = new Database(testDbPath);
      
      partialDb.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE context_items (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(session_id, key)
        );
      `);
      
      const sessionId = uuidv4();
      partialDb.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)')
        .run(sessionId, 'Partial Session');
      
      partialDb.close();
      
      // Open with DatabaseManager
      const dbManager = new DatabaseManager({ filename: testDbPath });
      const db = dbManager.getDatabase();
      
      // Verify all tables exist now
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[];
      const tableNames = tables.map(t => t.name);
      
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('context_items');
      expect(tableNames).toContain('file_cache');
      expect(tableNames).toContain('checkpoints');
      expect(tableNames).toContain('entities');
      expect(tableNames).toContain('relations');
      expect(tableNames).toContain('embeddings');
      expect(tableNames).toContain('journal_entries');
      
      // Verify new columns were added to context_items
      const contextColumns = db.prepare("PRAGMA table_info(context_items)").all() as any[];
      const columnNames = contextColumns.map(col => col.name);
      
      expect(columnNames).toContain('shared');
      expect(columnNames).toContain('shared_with_sessions');
      expect(columnNames).toContain('category');
      expect(columnNames).toContain('priority');
      expect(columnNames).toContain('metadata');
      expect(columnNames).toContain('size');
      expect(columnNames).toContain('updated_at');
      
      dbManager.close();
    });
    
    it('should not break when database already has new columns', () => {
      // Create a database that already has the new columns
      const newDb = new Database(testDbPath);
      
      newDb.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          description TEXT,
          branch TEXT,
          working_directory TEXT,
          parent_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE context_items (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          category TEXT,
          priority TEXT DEFAULT 'normal',
          metadata TEXT,
          size INTEGER DEFAULT 0,
          shared BOOLEAN DEFAULT 0,
          shared_with_sessions TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(session_id, key)
        );
      `);
      
      newDb.close();
      
      // Open with DatabaseManager - should not error
      const dbManager = new DatabaseManager({ filename: testDbPath });
      const repositories = new RepositoryManager(dbManager);
      
      // Create and share an item to verify everything works
      const session = repositories.sessions.create({ name: 'Test Session' });
      const item = repositories.contexts.save(session.id, {
        key: 'test',
        value: 'test'
      });
      
      repositories.contexts.shareItem(item.id, []);
      
      const sharedItems = repositories.contexts.getAllSharedItems();
      expect(sharedItems).toHaveLength(1);
      
      dbManager.close();
    });
  });
});