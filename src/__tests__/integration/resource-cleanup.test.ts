import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../utils/database.js';

describe('Resource Cleanup Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should properly close database connections', () => {
    const tempDbPath = path.join(tempDir, 'test.db');
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    const db = dbManager.getDatabase();
    
    // Verify database is open
    expect(() => {
      db.prepare('SELECT 1').get();
    }).not.toThrow();
    
    // Close the database
    dbManager.close();
    
    // Verify database is closed
    expect(() => {
      db.prepare('SELECT 1').get();
    }).toThrow('The database connection is not open');
  });

  it('should release file locks after closing', () => {
    const tempDbPath = path.join(tempDir, 'test.db');
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    
    // Database should be created
    expect(fs.existsSync(tempDbPath)).toBe(true);
    
    // Close the database
    dbManager.close();
    
    // Should be able to delete the file (no locks)
    expect(() => {
      fs.unlinkSync(tempDbPath);
    }).not.toThrow();
  });

  it('should handle errors during initialization gracefully', () => {
    // Try to create database in non-existent directory
    const invalidPath = path.join(tempDir, 'non-existent', 'test.db');
    
    expect(() => {
      new DatabaseManager({ filename: invalidPath });
    }).toThrow();
  });

  it('should clean up WAL files on close', () => {
    const tempDbPath = path.join(tempDir, 'test.db');
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    const db = dbManager.getDatabase();
    
    // Perform some operations to ensure WAL files are created
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run('test', 'Test');
    
    // WAL files should exist
    expect(fs.existsSync(tempDbPath + '-wal')).toBe(true);
    expect(fs.existsSync(tempDbPath + '-shm')).toBe(true);
    
    // Close database
    dbManager.close();
    
    // WAL files should be cleaned up
    // Note: They might still exist but should be minimal size
    if (fs.existsSync(tempDbPath + '-wal')) {
      const walSize = fs.statSync(tempDbPath + '-wal').size;
      expect(walSize).toBe(0);
    }
  });

  it('should handle multiple close calls safely', () => {
    const tempDbPath = path.join(tempDir, 'test.db');
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    
    // First close
    expect(() => {
      dbManager.close();
    }).not.toThrow();
    
    // Second close should not throw
    expect(() => {
      dbManager.close();
    }).not.toThrow();
  });

  it('should release memory for large operations', () => {
    const tempDbPath = path.join(tempDir, 'test.db');
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    const db = dbManager.getDatabase();
    
    // Create session
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run('test', 'Test');
    
    // Insert many items
    const stmt = db.prepare(`
      INSERT INTO context_items (id, session_id, key, value, category, priority)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const largeValue = 'x'.repeat(1000); // 1KB per value
    
    // Use transaction for better performance
    const insertMany = db.transaction((count: number) => {
      for (let i = 0; i < count; i++) {
        stmt.run(`item-${i}`, 'test', `key-${i}`, largeValue, 'test', 'normal');
      }
    });
    
    // Insert 1000 items (1MB of data)
    insertMany(1000);
    
    // Verify data was inserted
    const count = db.prepare('SELECT COUNT(*) as count FROM context_items').get() as any;
    expect(count.count).toBe(1000);
    
    // Close and cleanup
    dbManager.close();
    
    // Memory should be released (hard to test directly, but no errors should occur)
  });

  it('should handle database file corruption gracefully', () => {
    const tempDbPath = path.join(tempDir, 'corrupt.db');
    
    // Create a corrupted database file
    fs.writeFileSync(tempDbPath, 'This is not a valid SQLite database');
    
    // Should throw when trying to open corrupted database
    expect(() => {
      new DatabaseManager({ filename: tempDbPath });
    }).toThrow(/not a database|malformed/);
  });
});