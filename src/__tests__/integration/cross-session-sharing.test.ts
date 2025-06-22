import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

describe('Cross-Session Sharing Tests', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  const testDbPath = path.join(__dirname, `test-cross-session-${Date.now()}.db`);

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    dbManager = new DatabaseManager({ filename: testDbPath });
    repositories = new RepositoryManager(dbManager);
  });

  afterEach(() => {
    dbManager.close();
    
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

  describe('Database Migration', () => {
    it('should add shared columns to existing database', () => {
      // Close current connection
      dbManager.close();
      
      // Delete the test database to start fresh
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      
      // Create an old-style database without shared columns
      const Database = require('better-sqlite3');
      const db = new Database(testDbPath);
      
      // Create old schema
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          description TEXT,
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(session_id, key)
        );
      `);
      
      // Add some test data
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), sessionId, 'test_key', 'test_value');
      
      db.close();
      
      // Re-open with DatabaseManager - should trigger migration
      dbManager = new DatabaseManager({ filename: testDbPath });
      const migratedDb = dbManager.getDatabase();
      
      // Check that columns were added
      const columns = migratedDb.prepare("PRAGMA table_info(context_items)").all() as any[];
      const columnNames = columns.map(col => col.name);
      
      expect(columnNames).toContain('shared');
      expect(columnNames).toContain('shared_with_sessions');
      
      // Verify existing data is intact
      const session = migratedDb.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
      expect(session).toBeTruthy();
      expect(session.name).toBe('Test Session');
      
      const item = migratedDb.prepare('SELECT * FROM context_items WHERE session_id = ?').get(sessionId) as any;
      expect(item).toBeTruthy();
      expect(item.key).toBe('test_key');
      expect(item.value).toBe('test_value');
      expect(item.shared).toBe(0); // Default value
      expect(item.shared_with_sessions).toBeNull(); // Default value
    });
  });

  describe('Cross-Session Sharing', () => {
    let session1Id: string;
    let session2Id: string;
    let session3Id: string;

    beforeEach(() => {
      // Create test sessions
      const session1 = repositories.sessions.create({ name: 'Session 1' });
      const session2 = repositories.sessions.create({ name: 'Session 2' });
      const session3 = repositories.sessions.create({ name: 'Session 3' });
      
      session1Id = session1.id;
      session2Id = session2.id;
      session3Id = session3.id;
    });

    it('should share item with specific sessions', () => {
      // Create item in session 1
      const item = repositories.contexts.save(session1Id, {
        key: 'shared_insight',
        value: 'Important discovery about the codebase',
        category: 'discovery',
        priority: 'high'
      });

      // Share with session 2
      repositories.contexts.shareItem(item.id, [session2Id]);

      // Session 2 should see it
      const sharedItems = repositories.contexts.getSharedItems(session2Id);
      expect(sharedItems).toHaveLength(1);
      expect(sharedItems[0].key).toBe('shared_insight');
      expect(sharedItems[0].session_id).toBe(session1Id);

      // Session 3 should NOT see it
      const session3SharedItems = repositories.contexts.getSharedItems(session3Id);
      expect(session3SharedItems).toHaveLength(0);
    });

    it('should share item with multiple sessions', () => {
      // Create item
      const item = repositories.contexts.save(session1Id, {
        key: 'team_standard',
        value: 'Always use TypeScript strict mode',
        category: 'standard'
      });

      // Share with both session 2 and 3
      repositories.contexts.shareItem(item.id, [session2Id, session3Id]);

      // Both should see it
      const session2Items = repositories.contexts.getSharedItems(session2Id);
      const session3Items = repositories.contexts.getSharedItems(session3Id);
      
      expect(session2Items).toHaveLength(1);
      expect(session3Items).toHaveLength(1);
      expect(session2Items[0].key).toBe('team_standard');
      expect(session3Items[0].key).toBe('team_standard');
    });

    it('should share item publicly (empty target sessions)', () => {
      // Create and share publicly
      const item = repositories.contexts.save(session1Id, {
        key: 'public_knowledge',
        value: 'This applies to everyone',
        category: 'knowledge'
      });

      repositories.contexts.shareItem(item.id, []);

      // All sessions should see it via getAllSharedItems
      const allShared = repositories.contexts.getAllSharedItems();
      expect(allShared).toHaveLength(1);
      expect(allShared[0].key).toBe('public_knowledge');
    });

    it('should share by key', () => {
      // Create item
      repositories.contexts.save(session1Id, {
        key: 'bug_fix_123',
        value: 'Fixed by adding null check',
        category: 'fix'
      });

      // Share by key
      repositories.contexts.shareByKey(session1Id, 'bug_fix_123', [session2Id]);

      // Verify shared
      const sharedItems = repositories.contexts.getSharedItems(session2Id);
      expect(sharedItems).toHaveLength(1);
      expect(sharedItems[0].key).toBe('bug_fix_123');
    });

    it('should search across sessions', () => {
      // Create items in different sessions
      repositories.contexts.save(session1Id, {
        key: 'auth_pattern',
        value: 'Use JWT for authentication',
        category: 'pattern'
      });

      repositories.contexts.save(session2Id, {
        key: 'auth_bug',
        value: 'Fixed authentication timeout',
        category: 'fix'
      });

      repositories.contexts.save(session3Id, {
        key: 'database_setup',
        value: 'PostgreSQL configuration',
        category: 'config'
      });

      // Search across all sessions
      const authResults = repositories.contexts.searchAcrossSessions('auth');
      expect(authResults).toHaveLength(2);
      expect(authResults.map(r => r.key)).toContain('auth_pattern');
      expect(authResults.map(r => r.key)).toContain('auth_bug');

      // Search in specific sessions
      const session1And2Results = repositories.contexts.searchAcrossSessions('auth', [session1Id, session2Id]);
      expect(session1And2Results).toHaveLength(2);

      // Search in session 3 only
      const session3Results = repositories.contexts.searchAcrossSessions('auth', [session3Id]);
      expect(session3Results).toHaveLength(0);
    });

    it('should handle complex sharing scenarios', () => {
      // Create items with different sharing configurations
      const privateItem = repositories.contexts.save(session1Id, {
        key: 'private_data',
        value: 'Only for session 1',
        category: 'private'
      });

      const sharedItem = repositories.contexts.save(session1Id, {
        key: 'shared_data',
        value: 'Shared with session 2',
        category: 'shared'
      });

      const publicItem = repositories.contexts.save(session1Id, {
        key: 'public_data',
        value: 'Available to all',
        category: 'public'
      });

      // Set up sharing
      repositories.contexts.shareItem(sharedItem.id, [session2Id]);
      repositories.contexts.shareItem(publicItem.id, []); // Public

      // Session 1 should see its own items when searching
      const session1Search = repositories.contexts.searchAcrossSessions('data', [session1Id]);
      expect(session1Search).toHaveLength(3);

      // Session 2 should only see shared items
      const session2Shared = repositories.contexts.getSharedItems(session2Id);
      expect(session2Shared).toHaveLength(1);
      expect(session2Shared[0].key).toBe('shared_data');

      // Get all public items
      const allPublic = repositories.contexts.getAllSharedItems();
      const publicItems = allPublic.filter(item => item.shared_with_sessions === '[]');
      expect(publicItems).toHaveLength(1);
      expect(publicItems[0].key).toBe('public_data');
    });
  });

  describe('Error Handling', () => {
    it('should handle sharing non-existent items gracefully', () => {
      const fakeItemId = uuidv4();
      
      // Should not throw
      expect(() => {
        repositories.contexts.shareItem(fakeItemId, ['session2']);
      }).not.toThrow();
    });

    it('should handle sharing by non-existent key gracefully', () => {
      const session = repositories.sessions.create({ name: 'Test Session' });
      
      // Should not throw
      expect(() => {
        repositories.contexts.shareByKey(session.id, 'non_existent_key', ['session2']);
      }).not.toThrow();
    });

    it('should handle invalid JSON in shared_with_sessions', () => {
      const session = repositories.sessions.create({ name: 'Test Session' });
      const item = repositories.contexts.save(session.id, {
        key: 'test',
        value: 'test'
      });

      // Manually corrupt the JSON
      const db = dbManager.getDatabase();
      db.prepare('UPDATE context_items SET shared = 1, shared_with_sessions = ? WHERE id = ?')
        .run('invalid json', item.id);

      // Should handle gracefully - getSharedItems may throw or return empty
      let sharedItems: any[] = [];
      try {
        sharedItems = repositories.contexts.getSharedItems(session.id);
      } catch (error) {
        // Expected - invalid JSON
      }
      expect(sharedItems).toHaveLength(0); // Should skip invalid items or throw
    });
  });
});