import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../utils/database.js';

describe('Database Initialization Tests', () => {
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    tempDbPath = path.join(tempDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create sessions table with working_directory column on fresh database', () => {
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    const db = dbManager.getDatabase();
    
    // Check that sessions table has working_directory column
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as any[];
    const columnNames = columns.map((col: any) => col.name);
    
    expect(columnNames).toContain('working_directory');
    
    dbManager.close();
  });

  it('should add working_directory column to existing database without it', () => {
    // Create database with old schema
    const db = new Database(tempDbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        branch TEXT,
        parent_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.close();
    
    // Now open with DatabaseManager which should run migrations
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    const migratedDb = dbManager.getDatabase();
    
    // Check that working_directory column was added
    const columns = migratedDb.prepare("PRAGMA table_info(sessions)").all() as any[];
    const columnNames = columns.map((col: any) => col.name);
    
    expect(columnNames).toContain('working_directory');
    
    dbManager.close();
  });

  it('should handle duplicate table creation gracefully', () => {
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    const db = dbManager.getDatabase();
    
    // Try to create sessions table again (like the bug in index.ts)
    expect(() => {
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          description TEXT,
          branch TEXT
        );
      `);
    }).toThrow(); // Should throw because table already exists
    
    // But CREATE TABLE IF NOT EXISTS should work
    expect(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          name TEXT,
          description TEXT,
          branch TEXT
        );
      `);
    }).not.toThrow();
    
    // And the column should still be there
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as any[];
    const columnNames = columns.map((col: any) => col.name);
    expect(columnNames).toContain('working_directory');
    
    dbManager.close();
  });

  it('should allow INSERT with working_directory column', () => {
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    const db = dbManager.getDatabase();
    
    // This should work
    expect(() => {
      db.prepare(`
        INSERT INTO sessions (id, name, description, branch, working_directory)
        VALUES (?, ?, ?, ?, ?)
      `).run('test-id', 'Test Session', 'Test Description', 'main', '/path/to/project');
    }).not.toThrow();
    
    // Verify the data
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get('test-id') as any;
    expect(session.working_directory).toBe('/path/to/project');
    
    dbManager.close();
  });
});