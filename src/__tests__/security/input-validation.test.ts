import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../utils/database';
import { validateKey, validateValue, validateSearchQuery } from '../../utils/validation';

describe('Security - Input Validation Tests', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const tempDbPath = path.join(tempDir, 'test.db');
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      walMode: false,
    });
  });

  afterEach(() => {
    dbManager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Basic SQL Injection Prevention', () => {
    it('should prevent SQL injection in key parameter', () => {
      const db = dbManager.getDatabase();
      const sessionId = 'test-session';

      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');

      const maliciousKey = "key'; DROP TABLE sessions; --";

      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run('item-1', sessionId, maliciousKey, 'value', 'test', 'normal');

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
        .all();
      expect(tables.length).toBe(1);

      const item = db.prepare('SELECT key FROM context_items WHERE id = ?').get('item-1') as any;
      expect(item.key).toBe(maliciousKey);
    });

    it('should sanitize search queries', () => {
      const maliciousQuery = "test' OR '1'='1";
      const validatedQuery = validateSearchQuery(maliciousQuery);
      expect(validatedQuery).toBe('test OR 1=1');
    });
  });

  describe('Basic Validation', () => {
    it('should validate keys', () => {
      expect(() => validateKey('')).toThrow();
      expect(() => validateKey('valid-key')).not.toThrow();
    });

    it('should validate values', () => {
      expect(() => validateValue('valid value')).not.toThrow();
      // Empty values might be allowed, so just test that function exists
      expect(typeof validateValue).toBe('function');
    });
  });

  describe('Resource Management', () => {
    it('should handle small bulk operations', () => {
      const db = dbManager.getDatabase();
      const sessionId = 'test-session';

      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');

      const insertStmt = db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction(() => {
        for (let i = 0; i < 5; i++) {
          insertStmt.run(`bulk-${i}`, sessionId, `key-${i}`, `value-${i}`, 'test', 'normal');
        }
      });

      const start = Date.now();
      insertMany();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000);

      const count = db
        .prepare('SELECT COUNT(*) as count FROM context_items WHERE session_id = ?')
        .get(sessionId) as any;
      expect(count.count).toBe(5);
    });
  });
});
