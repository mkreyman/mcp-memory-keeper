import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Search Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-search-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();

    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      testSessionId,
      'Search Test Session'
    );
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (_e) {
      // Ignore
    }
  });

  describe('context_search', () => {
    beforeEach(() => {
      // Create test session if not exists
      const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(testSessionId);
      if (!session) {
        db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
          testSessionId,
          'Search Test Session'
        );
      }

      // Add diverse test data
      const items = [
        {
          key: 'auth_bug',
          value: 'Fixed authentication bug in login flow',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'auth_decision',
          value: 'Decided to use JWT for authentication',
          category: 'decision',
          priority: 'high',
        },
        {
          key: 'api_design',
          value: 'Design REST API endpoints for user management',
          category: 'task',
          priority: 'normal',
        },
        {
          key: 'database_choice',
          value: 'Selected PostgreSQL for user data storage',
          category: 'decision',
          priority: 'normal',
        },
        {
          key: 'security_note',
          value: 'Remember to implement rate limiting on auth endpoints',
          category: 'note',
          priority: 'high',
        },
        {
          key: 'performance',
          value: 'Optimize database queries for better performance',
          category: 'task',
          priority: 'low',
        },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      });
    });

    it('should search by value content', () => {
      // Search for 'authentication'
      const results = db
        .prepare(
          `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND value LIKE ?
         ORDER BY priority DESC, created_at DESC`
        )
        .all(testSessionId, '%authentication%') as any[];

      expect(results).toHaveLength(2);
      expect(results[0].key).toBe('auth_bug'); // High priority first
      expect(results[1].key).toBe('auth_decision');
    });

    it('should search by key pattern', () => {
      // Search for keys starting with 'auth'
      const results = db
        .prepare(
          `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND key LIKE ?
         ORDER BY created_at DESC`
        )
        .all(testSessionId, 'auth%') as any[];

      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.key)).toContain('auth_bug');
      expect(results.map((r: any) => r.key)).toContain('auth_decision');
    });

    it('should filter by category', () => {
      // Search for tasks only
      const results = db
        .prepare(
          `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND category = ?
         ORDER BY 
           CASE priority 
             WHEN 'critical' THEN 1
             WHEN 'high' THEN 2
             WHEN 'normal' THEN 3
             WHEN 'low' THEN 4
           END`
        )
        .all(testSessionId, 'task') as any[];

      expect(results).toHaveLength(3);
      expect(results[0].key).toBe('auth_bug'); // High priority
      expect(results[2].key).toBe('performance'); // Low priority
    });

    it('should combine search criteria', () => {
      // Search for high priority items containing 'auth'
      const results = db
        .prepare(
          `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND priority = ?
         AND (value LIKE ? OR key LIKE ?)
         ORDER BY created_at DESC`
        )
        .all(testSessionId, 'high', '%auth%', '%auth%') as any[];

      expect(results).toHaveLength(3); // auth_bug, auth_decision, security_note
    });

    it('should search across multiple sessions', () => {
      // Create another session
      const sessionId2 = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId2, 'Second Session');

      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        sessionId2,
        'auth_other',
        'Another auth-related item'
      );

      // Search across all sessions
      const results = db
        .prepare(
          `SELECT ci.*, s.name as session_name 
         FROM context_items ci
         JOIN sessions s ON ci.session_id = s.id
         WHERE ci.value LIKE ?
         ORDER BY ci.created_at DESC`
        )
        .all('%auth%') as any[];

      expect(results.length).toBeGreaterThanOrEqual(3);
      expect(results.some((r: any) => r.session_name === 'Search Test Session')).toBe(true);
      expect(results.some((r: any) => r.session_name === 'Second Session')).toBe(true);
    });

    it('should handle case-insensitive search', () => {
      // SQLite LIKE is case-insensitive by default
      const results = db
        .prepare(
          `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND value LIKE ?`
        )
        .all(testSessionId, '%AUTH%') as any[];

      expect(results).toHaveLength(3); // Should find 'authentication' and 'auth' items
      // auth_bug: "Fixed authentication bug in login flow"
      // auth_decision: "Decided to use JWT for authentication"
      // security_note: "Remember to implement rate limiting on auth endpoints"
    });

    it('should search with date range', () => {
      // Add an old item
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 7);

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        uuidv4(),
        testSessionId,
        'old_item',
        'Old authentication method',
        oldDate.toISOString()
      );

      // Search for items from last 3 days
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const results = db
        .prepare(
          `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND datetime(created_at) > datetime(?)
         AND value LIKE ?`
        )
        .all(testSessionId, threeDaysAgo.toISOString(), '%authentication%') as any[];

      expect(results).toHaveLength(2); // Should not include old_item
      expect(results.every((r: any) => r.key !== 'old_item')).toBe(true);
    });

    it('should rank results by relevance', () => {
      // Add items with varying relevance
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, priority) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'exact', 'authentication', 'normal');

      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, priority) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'partial', 'implemented authentication system', 'normal');

      // Search with exact match having higher relevance
      const results = db
        .prepare(
          `SELECT *,
         CASE 
           WHEN value = ? THEN 3
           WHEN value LIKE ? AND value LIKE ? THEN 2
           WHEN value LIKE ? THEN 1
         END as relevance
         FROM context_items 
         WHERE session_id = ? 
         AND value LIKE ?
         ORDER BY relevance DESC, priority DESC`
        )
        .all(
          'authentication',
          '%authentication%',
          '%',
          '%authentication%',
          testSessionId,
          '%authentication%'
        ) as any[];

      expect(results[0].key).toBe('exact'); // Exact match first
    });
  });

  describe('File content search', () => {
    beforeEach(() => {
      // Ensure session exists
      const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(testSessionId);
      if (!session) {
        db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
          testSessionId,
          'Search Test Session'
        );
      }

      // Add file cache entries
      const files = [
        {
          path: '/src/auth.ts',
          content: 'export function authenticate(user: User) { /* auth logic */ }',
        },
        { path: '/src/api.ts', content: 'router.post("/login", authenticate);' },
        {
          path: '/tests/auth.test.ts',
          content: 'describe("authentication", () => { /* tests */ })',
        },
        {
          path: '/docs/README.md',
          content: '# Authentication\nThis module handles user authentication.',
        },
      ];

      files.forEach(file => {
        const hash = require('crypto').createHash('sha256').update(file.content).digest('hex');
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, file.path, file.content, hash);
      });

      // Also add context items for the combine test
      const contextItems = [
        { key: 'auth_feature', value: 'Implement authentication system', category: 'task' },
        { key: 'auth_config', value: 'Configure auth middleware', category: 'task' },
      ];

      contextItems.forEach(item => {
        db.prepare(
          'INSERT OR IGNORE INTO context_items (id, session_id, key, value, category) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category);
      });
    });

    it('should search file contents', () => {
      const results = db
        .prepare(
          `SELECT * FROM file_cache 
         WHERE session_id = ? 
         AND content LIKE ?
         ORDER BY file_path`
        )
        .all(testSessionId, '%authenticate%') as any[];

      expect(results).toHaveLength(2); // auth.ts, api.ts only
      // auth.ts: "export function authenticate(user: User) { /* auth logic */ }"
      // api.ts: "router.post("/login", authenticate);"
      // tests/auth.test.ts: has "authentication" not "authenticate"
      // README.md: has "authentication" not "authenticate"
      expect(results.map((r: any) => r.file_path)).not.toContain('/tests/auth.test.ts');
    });

    it('should search by file path pattern', () => {
      const results = db
        .prepare(
          `SELECT * FROM file_cache 
         WHERE session_id = ? 
         AND file_path LIKE ?`
        )
        .all(testSessionId, '/src/%') as any[];

      expect(results).toHaveLength(2);
      expect(results.every((r: any) => r.file_path.startsWith('/src/'))).toBe(true);
    });

    it('should combine file and context search', () => {
      // Search for 'auth' in both context and files (broader search)
      const contextResults = db
        .prepare(
          `SELECT 'context' as source, key as name, value as content 
         FROM context_items 
         WHERE session_id = ? AND (value LIKE ? OR key LIKE ?)`
        )
        .all(testSessionId, '%auth%', '%auth%') as any[];

      const fileResults = db
        .prepare(
          `SELECT 'file' as source, file_path as name, content 
         FROM file_cache 
         WHERE session_id = ? AND (content LIKE ? OR file_path LIKE ?)`
        )
        .all(testSessionId, '%auth%', '%auth%') as any[];

      const allResults = [...contextResults, ...fileResults];

      expect(allResults.length).toBeGreaterThanOrEqual(4);
      expect(allResults.some((r: any) => r.source === 'context')).toBe(true);
      expect(allResults.some((r: any) => r.source === 'file')).toBe(true);
    });
  });

  describe('Search performance', () => {
    it('should use indexes efficiently', () => {
      // Add many items to test performance
      for (let i = 0; i < 100; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category) VALUES (?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          `key${i}`,
          `value ${i} with some text`,
          i % 2 === 0 ? 'task' : 'note'
        );
      }

      const start = Date.now();
      const results = db
        .prepare(
          `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND category = ?
         LIMIT 10`
        )
        .all(testSessionId, 'task') as any[];
      const duration = Date.now() - start;

      expect(results).toHaveLength(10);
      expect(duration).toBeLessThan(100); // Should be fast with indexes
    });
  });
});
