import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../utils/database';
import { MigrationHealthCheck } from '../../utils/migrationHealthCheck';
import Database from 'better-sqlite3';

describe('MigrationHealthCheck', () => {
  let tempDir: string;
  let dbPath: string;
  let dbManager: DatabaseManager;
  let healthCheck: MigrationHealthCheck;

  beforeEach(() => {
    // Create temporary directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    dbPath = path.join(tempDir, 'test.db');
  });

  afterEach(() => {
    // Clean up
    if (dbManager) {
      dbManager.close();
    }
    // Remove temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Missing column detection', () => {
    it('should detect missing metadata column in context_items table', () => {
      // Create a database with old schema (missing metadata column)
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE context_items (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          category TEXT,
          priority TEXT DEFAULT 'normal',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);

      // Create health check without initializing DatabaseManager to avoid auto-fix
      const dbManager = new Database(dbPath);
      healthCheck = new MigrationHealthCheck({ getDatabase: () => dbManager } as any);
      const result = healthCheck.runHealthCheck();

      db.close();
      dbManager.close();

      // Should detect missing columns
      expect(result.issues.length).toBeGreaterThan(0);
      const metadataIssue = result.issues.find(
        issue => issue.table === 'context_items' && issue.issue.includes('metadata')
      );
      expect(metadataIssue).toBeDefined();
      expect(metadataIssue?.severity).toBe('error');
      expect(metadataIssue?.fix).toContain('ALTER TABLE context_items ADD COLUMN metadata TEXT');
    });

    it('should detect multiple missing columns', () => {
      // Create a database with very old schema
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE context_items (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);

      // Create health check without initializing DatabaseManager
      const dbManager = new Database(dbPath);
      healthCheck = new MigrationHealthCheck({ getDatabase: () => dbManager } as any);
      const result = healthCheck.runHealthCheck();

      db.close();
      dbManager.close();

      // Should detect multiple missing columns
      const missingColumns = ['category', 'priority', 'metadata', 'size'];
      for (const column of missingColumns) {
        const issue = result.issues.find(
          i => i.table === 'context_items' && i.issue.includes(column)
        );
        expect(issue).toBeDefined();
      }

      // updated_at might exist depending on schema version, check separately
      const hasUpdatedAt = result.issues.some(
        i => i.table === 'context_items' && i.issue.includes('updated_at')
      );
      if (hasUpdatedAt) {
        expect(result.issues.length).toBeGreaterThanOrEqual(missingColumns.length + 1);
      } else {
        expect(result.issues.length).toBeGreaterThanOrEqual(missingColumns.length);
      }
    });
  });

  describe('Auto-fix functionality', () => {
    it('should successfully add missing columns', () => {
      // Create a database with old schema
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE context_items (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          category TEXT,
          priority TEXT DEFAULT 'normal',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
      `);
      db.close();

      // Create proper DatabaseManager instance but prevent auto-fix during init
      const testDb = new Database(dbPath);
      const mockDbManager = {
        getDatabase: () => testDb,
        close: () => testDb.close(),
      } as any;

      healthCheck = new MigrationHealthCheck(mockDbManager);

      // First check what issues exist
      const beforeFix = healthCheck.runHealthCheck();
      expect(beforeFix.issues.length).toBeGreaterThan(0);
      expect(beforeFix.canAutoFix).toBe(true);

      // Apply auto-fix
      const success = healthCheck.runAutoFix();
      expect(success).toBe(true);

      // Verify fixes were applied
      const afterFix = healthCheck.runHealthCheck();
      expect(afterFix.issues.length).toBe(0);
      expect(afterFix.summary).toContain('Database schema is healthy');

      mockDbManager.close();
    });

    it('should handle errors gracefully when fix fails', () => {
      // Create a database with correct schema first
      dbManager = new DatabaseManager({ filename: dbPath });
      const db = dbManager.getDatabase();

      // Drop a column to simulate missing column
      db.exec(`
        CREATE TABLE temp_context_items AS SELECT id, session_id, key, value, category, priority, created_at FROM context_items;
        DROP TABLE context_items;
        ALTER TABLE temp_context_items RENAME TO context_items;
      `);

      // Create health check instance
      healthCheck = new MigrationHealthCheck(dbManager);
      const result = healthCheck.runHealthCheck();
      expect(result.issues.length).toBeGreaterThan(0);

      // Mock exec to simulate failure
      const originalExec = db.exec.bind(db);
      db.exec = jest.fn().mockImplementation(() => {
        throw new Error('Simulated database error');
      });

      // Try to auto-fix (should fail gracefully)
      const { fixed, failed } = healthCheck.autoFixIssues(result.issues);
      expect(fixed.length).toBe(0);
      expect(failed.length).toBeGreaterThan(0);

      // Restore original exec
      db.exec = originalExec;
    });
  });

  describe('Schema discovery', () => {
    it('should correctly parse schema from database.ts file', () => {
      // Create a new database with full schema
      dbManager = new DatabaseManager({ filename: dbPath });
      healthCheck = new MigrationHealthCheck(dbManager);

      // Run health check on a properly initialized database
      const result = healthCheck.runHealthCheck();

      // Should have no issues
      expect(result.issues.length).toBe(0);
      expect(result.summary).toContain('Database schema is healthy');
    });

    it('should work with empty database (new user)', () => {
      // Create completely empty database
      const db = new Database(dbPath);
      db.close();

      // Run health check
      dbManager = new DatabaseManager({ filename: dbPath });
      healthCheck = new MigrationHealthCheck(dbManager);

      // Check should pass - tables will be created during initialization
      const result = healthCheck.runHealthCheck();
      expect(result.summary).toContain('Database schema is healthy');
    });
  });

  describe('Integration with DatabaseManager', () => {
    it('should automatically fix issues on database initialization', () => {
      // Create a database with old schema
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE context_items (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.close();

      // Initialize DatabaseManager (should auto-fix)
      dbManager = new DatabaseManager({ filename: dbPath });

      // Verify columns were added
      const db2 = dbManager.getDatabase();
      const columns = db2.prepare('PRAGMA table_info(context_items)').all() as any[];
      const columnNames = columns.map((col: any) => col.name);

      expect(columnNames).toContain('metadata');
      expect(columnNames).toContain('size');
      expect(columnNames).toContain('category');
      expect(columnNames).toContain('priority');
      // Note: context_items table only has created_at, not updated_at
    });

    it('should handle concurrent database access during migration', () => {
      // Create a database with old schema
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.close();

      // Initialize multiple DatabaseManager instances concurrently
      const managers: DatabaseManager[] = [];
      const promises = [];

      for (let i = 0; i < 3; i++) {
        promises.push(
          new Promise(resolve => {
            setTimeout(() => {
              const manager = new DatabaseManager({ filename: dbPath });
              managers.push(manager);
              resolve(manager);
            }, i * 10); // Stagger slightly
          })
        );
      }

      return Promise.all(promises).then(() => {
        // All should complete successfully
        expect(managers.length).toBe(3);

        // Check that migrations were applied
        const db = managers[0].getDatabase();
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as any[];
        expect(tables.length).toBeGreaterThan(10); // Should have all tables

        // Clean up
        managers.forEach(m => m.close());
      });
    });
  });
});
