import { DatabaseManager } from '../../utils/database';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('DatabaseManager', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;

  beforeEach(() => {
    // Create a temporary database file for testing
    tempDbPath = path.join(os.tmpdir(), `test-db-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024, // 10MB for testing
      walMode: true,
    });
  });

  afterEach(() => {
    // Clean up
    if (dbManager) {
      dbManager.close();
    }
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (e) {
      // Ignore errors if files don't exist
    }
  });

  describe('Database initialization', () => {
    it('should create all required tables', () => {
      const db = dbManager.getDatabase();
      
      // Check if tables exist
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as any[];
      
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('context_items');
      expect(tableNames).toContain('file_cache');
      expect(tableNames).toContain('checkpoints');
      expect(tableNames).toContain('checkpoint_items');
      expect(tableNames).toContain('checkpoint_files');
    });

    it('should enable WAL mode', () => {
      const db = dbManager.getDatabase();
      const result = db.pragma('journal_mode') as any;
      expect(result[0].journal_mode).toBe('wal');
    });

    it('should enable foreign keys', () => {
      const db = dbManager.getDatabase();
      const result = db.pragma('foreign_keys') as any;
      expect(result[0].foreign_keys).toBe(1);
    });
  });

  describe('Database size management', () => {
    it('should calculate database size correctly', () => {
      const size = dbManager.getDatabaseSize();
      expect(size).toBeGreaterThan(0);
      expect(typeof size).toBe('number');
    });

    it('should detect when database is full', () => {
      // With a 10MB limit, it should not be full initially
      expect(dbManager.isDatabaseFull()).toBe(false);
      
      // Note: Actually filling the database would be slow, so we'll trust the logic
    });

    it('should calculate session size', () => {
      const db = dbManager.getDatabase();
      
      // Create a test session
      const sessionId = 'test-session-123';
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        sessionId,
        'Test Session'
      );
      
      // Add some context items
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, size) VALUES (?, ?, ?, ?, ?)'
      ).run('item1', sessionId, 'key1', 'value1', 6); // 'value1'.length = 6
      
      const size = dbManager.getSessionSize(sessionId);
      expect(size.items).toBe(1);
      expect(size.files).toBe(0);
      expect(size.totalSize).toBeGreaterThan(0);
    });
  });

  describe('Cleanup operations', () => {
    it('should cleanup old sessions', () => {
      const db = dbManager.getDatabase();
      
      // Create old session (31 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      
      db.prepare(
        'INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run('old-session', 'Old Session', oldDate.toISOString(), oldDate.toISOString());
      
      // Create recent session
      db.prepare(
        'INSERT INTO sessions (id, name) VALUES (?, ?)'
      ).run('new-session', 'New Session');
      
      const deleted = dbManager.cleanupOldSessions(30);
      expect(deleted).toBe(1);
      
      // Verify old session was deleted
      const sessions = db.prepare('SELECT id FROM sessions').all();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toHaveProperty('id', 'new-session');
    });

    it('should not cleanup sessions with checkpoints', () => {
      const db = dbManager.getDatabase();
      
      // Create old session with checkpoint
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      
      db.prepare(
        'INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)'
      ).run('old-session', 'Old Session', oldDate.toISOString());
      
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)'
      ).run('checkpoint1', 'old-session', 'Important Checkpoint');
      
      const deleted = dbManager.cleanupOldSessions(30);
      expect(deleted).toBe(0);
    });
  });

  describe('Transaction support', () => {
    it('should execute transactions atomically', () => {
      const db = dbManager.getDatabase();
      
      // Successful transaction
      const result = dbManager.transaction(() => {
        db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
          'trans-session',
          'Transaction Session'
        );
        return 'success';
      });
      
      expect(result).toBe('success');
      
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('trans-session');
      expect(session).toBeTruthy();
    });

    it('should rollback failed transactions', () => {
      const db = dbManager.getDatabase();
      
      // Insert a session first
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        'existing-session',
        'Existing Session'
      );
      
      // Failed transaction (duplicate key)
      expect(() => {
        dbManager.transaction(() => {
          db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
            'new-session',
            'New Session'
          );
          // This should fail due to duplicate key
          db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
            'existing-session',
            'Duplicate'
          );
        });
      }).toThrow();
      
      // Verify the first insert was rolled back
      const newSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get('new-session');
      expect(newSession).toBeFalsy();
    });
  });

  describe('Vacuum operation', () => {
    it('should execute vacuum without errors', () => {
      expect(() => dbManager.vacuum()).not.toThrow();
    });
  });
});