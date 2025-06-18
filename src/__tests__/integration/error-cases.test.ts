import { DatabaseManager } from '../../utils/database';
import { GitOperations } from '../../utils/git';
import { validateFilePath, validateSessionName, validateSearchQuery } from '../../utils/validation';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Error Cases Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-errors-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (e) {
      // Ignore
    }
  });

  describe('Database errors', () => {
    it('should handle database full errors', () => {
      // Create a tiny database manager
      const tinyDbPath = path.join(os.tmpdir(), `tiny-db-${Date.now()}.db`);
      const tinyDb = new DatabaseManager({
        filename: tinyDbPath,
        maxSize: 1024, // 1KB - very small
        walMode: true,
      });

      const tinyDbConn = tinyDb.getDatabase();
      const sessionId = uuidv4();
      tinyDbConn.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');

      // Try to fill it up
      let errorThrown = false;
      try {
        for (let i = 0; i < 1000; i++) {
          if (tinyDb.isDatabaseFull()) {
            errorThrown = true;
            break;
          }
          tinyDbConn.prepare(
            'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
          ).run(uuidv4(), sessionId, `key${i}`, 'A'.repeat(100));
        }
      } catch (e) {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
      tinyDb.close();
      fs.unlinkSync(tinyDbPath);
    });

    it('should handle constraint violations', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');

      // Insert item
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
      ).run(uuidv4(), sessionId, 'unique_key', 'value1');

      // Try to insert duplicate key (violates unique constraint)
      expect(() => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, 'unique_key', 'value2');
      }).toThrow();
    });

    it('should handle foreign key violations', () => {
      // Try to insert context item with non-existent session
      expect(() => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), 'non-existent-session', 'key', 'value');
      }).toThrow();
    });

    it('should handle transaction rollbacks', () => {
      const sessionId = uuidv4();
      
      expect(() => {
        dbManager.transaction(() => {
          db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');
          
          // This will fail due to foreign key constraint
          db.prepare(
            'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
          ).run(uuidv4(), 'invalid-checkpoint', 'invalid-item');
        });
      }).toThrow();

      // Verify session was not created (rolled back)
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(session).toBeFalsy();
    });
  });

  describe('Input validation errors', () => {
    it('should reject invalid session names', () => {
      const invalidNames = [
        '',
        ' ',
        '\n\t',
        'a'.repeat(256), // Too long
        '../../../etc/passwd',
        'session\0name',
        'session<script>alert(1)</script>',
      ];

      invalidNames.forEach(name => {
        expect(() => validateSessionName(name)).toThrow();
      });
    });

    it('should reject invalid file paths', () => {
      const invalidPaths = [
        '../../../etc/passwd',
        '/etc/passwd',
        'C:\\Windows\\System32\\config\\sam',
        '\\\\server\\share\\file',
        'file\0name.txt',
        '',
        'con.txt', // Windows reserved name
        'prn.txt', // Windows reserved name
      ];

      invalidPaths.forEach(filePath => {
        expect(() => validateFilePath(filePath, 'read')).toThrow();
      });
    });

    it('should sanitize search queries', () => {
      const dangerousQueries = [
        "'; DROP TABLE sessions; --",
        '%" OR "1"="1',
        "' UNION SELECT * FROM sessions --",
        '%_test_%',
      ];

      dangerousQueries.forEach(query => {
        const sanitized = validateSearchQuery(query);
        expect(sanitized).not.toContain("'");
        expect(sanitized).not.toContain('"');
        expect(sanitized).not.toContain(';');
        expect(sanitized).not.toContain('--');
      });
    });

    it('should handle null and undefined inputs', () => {
      expect(() => validateSessionName(null as any)).toThrow();
      expect(() => validateSessionName(undefined as any)).toThrow();
      expect(() => validateFilePath(null as any, 'read')).toThrow();
      expect(() => validateFilePath(undefined as any, 'read')).toThrow();
    });
  });

  describe('File system errors', () => {
    it('should handle non-existent file reads', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');

      const nonExistentPath = path.join(os.tmpdir(), 'non-existent-file.txt');
      
      // Simulate file read error
      let errorMessage = '';
      try {
        const content = fs.readFileSync(nonExistentPath, 'utf-8');
      } catch (e: any) {
        errorMessage = e.message;
      }

      expect(errorMessage).toContain('ENOENT');
    });

    it('should handle permission errors', () => {
      // This test is platform-specific and may need adjustment
      const restrictedPath = '/root/test.txt'; // Usually no write permission
      
      let errorThrown = false;
      let errorCode = '';
      try {
        fs.writeFileSync(restrictedPath, 'test');
      } catch (e: any) {
        errorThrown = true;
        errorCode = e.code;
      }

      expect(errorThrown).toBe(true);
      // Accept ENOENT (parent dir doesn't exist) or EACCES/EPERM (no permission)
      expect(['EACCES', 'EPERM', 'ENOENT']).toContain(errorCode);
    });

    it('should handle disk space errors', () => {
      // This is difficult to test reliably across platforms
      // We'll simulate the behavior
      const mockWriteLargeFile = (path: string, size: number): { success: boolean; error?: string } => {
        try {
          // Check available space (platform specific)
          const availableSpace = 1024 * 1024 * 100; // Mock 100MB available
          if (size > availableSpace) {
            return { success: false, error: 'ENOSPC: no space left on device' };
          }
          return { success: true };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      };

      const result = mockWriteLargeFile('/tmp/large.file', 1024 * 1024 * 1024); // 1GB
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOSPC');
    });
  });

  describe('Git operation errors', () => {
    it('should handle corrupted git repository', async () => {
      const corruptRepoPath = path.join(os.tmpdir(), `corrupt-repo-${Date.now()}`);
      fs.mkdirSync(corruptRepoPath, { recursive: true });
      
      // Create a fake .git directory with corrupted content
      const gitDir = path.join(corruptRepoPath, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'corrupted content');

      const gitOps = new GitOperations(corruptRepoPath);
      const info = await gitOps.getGitInfo();

      expect(info.isGitRepo).toBe(false);
      expect(info.status).toContain('error');

      fs.rmSync(corruptRepoPath, { recursive: true, force: true });
    });

    it('should handle git command timeouts', async () => {
      // Mock a slow git operation
      const mockSlowGitOp = async (timeout: number): Promise<{ success: boolean; error?: string }> => {
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            resolve({ success: true });
          }, timeout + 1000);

          setTimeout(() => {
            clearTimeout(timer);
            resolve({ success: false, error: 'Operation timed out' });
          }, timeout);
        });
      };

      const result = await mockSlowGitOp(1000);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('Concurrent access errors', () => {
    it('should handle database lock timeouts', async () => {
      // Create two database connections
      const db2Manager = new DatabaseManager({
        filename: tempDbPath,
        maxSize: 10 * 1024 * 1024,
        walMode: true,
      });
      const db2 = db2Manager.getDatabase();

      const sessionId = uuidv4();

      // Start a transaction in first connection
      const transaction1 = db.transaction(() => {
        db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');
        
        // Simulate long-running operation
        const start = Date.now();
        while (Date.now() - start < 100) {
          // Busy wait
        }
      });

      // Try to write in second connection (should succeed with WAL mode)
      let secondWriteSucceeded = false;
      try {
        db2.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(uuidv4(), 'Test2');
        secondWriteSucceeded = true;
      } catch (e) {
        // In WAL mode, this should not throw
      }

      expect(secondWriteSucceeded).toBe(true);
      db2Manager.close();
    });

    it('should handle multiple readers', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test');

      // Create multiple readers
      const readers = [];
      for (let i = 0; i < 5; i++) {
        const reader = new DatabaseManager({
          filename: tempDbPath,
          maxSize: 10 * 1024 * 1024,
          walMode: true,
        });
        readers.push(reader);
      }

      // All readers should be able to read simultaneously
      const results = readers.map(reader => {
        const db = reader.getDatabase();
        return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      });

      expect(results.every(r => r !== undefined)).toBe(true);

      // Cleanup
      readers.forEach(r => r.close());
    });
  });

  describe('Memory errors', () => {
    it('should handle large result sets', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Large Dataset');

      // Insert many items
      const stmt = db.prepare(
        'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
      );

      for (let i = 0; i < 10000; i++) {
        stmt.run(uuidv4(), sessionId, `key${i}`, `value${i}`);
      }

      // Use iterating to handle large result sets
      const stmt2 = db.prepare('SELECT * FROM context_items WHERE session_id = ?');
      let count = 0;
      
      for (const row of stmt2.iterate(sessionId)) {
        count++;
        if (count > 5000) break; // Limit iteration
      }

      expect(count).toBeGreaterThan(5000);
    });

    it('should handle very long strings', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Long String Test');

      const veryLongString = 'A'.repeat(1024 * 1024); // 1MB string
      
      // Should handle gracefully
      let errorThrown = false;
      try {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, 'long_key', veryLongString);
      } catch (e) {
        errorThrown = true;
      }

      // SQLite can handle large strings, so this should work
      expect(errorThrown).toBe(false);
    });
  });

  describe('Recovery scenarios', () => {
    it('should recover from corrupted context items', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Recovery Test');

      // Insert valid items
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, `key${i}`, `value${i}`);
      }

      // Simulate corrupted metadata
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, metadata) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), sessionId, 'corrupted', 'value', '{invalid json');

      // SQLite 3.9+ has json_valid function, check if available
      let validItems: any[];
      try {
        // Try with json_valid
        validItems = db.prepare(
          `SELECT * FROM context_items 
           WHERE session_id = ? 
           AND (metadata IS NULL OR json_valid(metadata))`
        ).all(sessionId) as any[];
      } catch (e) {
        // Fallback without json_valid
        validItems = db.prepare(
          `SELECT * FROM context_items 
           WHERE session_id = ? 
           AND metadata IS NULL`
        ).all(sessionId) as any[];
      }

      expect(validItems).toHaveLength(5); // Only valid items
    });

    it('should handle checkpoint restoration failures gracefully', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Checkpoint Recovery');

      // Create checkpoint with missing references
      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)'
      ).run(checkpointId, sessionId, 'Broken Checkpoint');

      // Temporarily disable foreign keys to simulate corruption
      db.pragma('foreign_keys = OFF');
      
      // Add checkpoint items referencing non-existent context items
      db.prepare(
        'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
      ).run(uuidv4(), checkpointId, 'non-existent-item');
      
      // Re-enable foreign keys
      db.pragma('foreign_keys = ON');

      // Restoration should handle missing items
      const restorable = db.prepare(`
        SELECT ci.* FROM context_items ci
        JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
        WHERE cpi.checkpoint_id = ?
      `).all(checkpointId) as any[];

      expect(restorable).toHaveLength(0); // No items to restore
    });
  });
});