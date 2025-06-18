import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Summarization Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-summary-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    
    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
      testSessionId, 
      'Summary Test Session',
      'Testing summarization functionality'
    );
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

  describe('context_summarize', () => {
    beforeEach(() => {
      // Add diverse test data
      const items = [
        // Tasks
        { key: 'task_1', value: 'Implement authentication system', category: 'task', priority: 'high' },
        { key: 'task_2', value: 'Add rate limiting to API', category: 'task', priority: 'high' },
        { key: 'task_3', value: 'Write unit tests for auth module', category: 'task', priority: 'normal' },
        { key: 'task_4', value: 'Update documentation', category: 'task', priority: 'low' },
        
        // Decisions
        { key: 'decision_1', value: 'Use JWT for authentication tokens', category: 'decision', priority: 'high' },
        { key: 'decision_2', value: 'Set token expiry to 24 hours', category: 'decision', priority: 'normal' },
        
        // Progress
        { key: 'progress_1', value: 'Completed login endpoint', category: 'progress', priority: 'normal' },
        { key: 'progress_2', value: 'Fixed CORS issues', category: 'progress', priority: 'normal' },
        
        // Notes
        { key: 'note_1', value: 'Redis connection string: redis://localhost:6379', category: 'note', priority: 'normal' },
        { key: 'note_2', value: 'API rate limit: 100 requests per minute', category: 'note', priority: 'normal' },
        
        // Warnings
        { key: 'warning_1', value: 'Deprecation warning in auth library', category: 'warning', priority: 'high' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      });
    });

    it('should summarize all items in session', () => {
      const items = db.prepare(
        'SELECT * FROM context_items WHERE session_id = ? ORDER BY priority DESC, created_at DESC'
      ).all(testSessionId) as any[];

      expect(items).toHaveLength(11);
      
      // Group by category
      const grouped = items.reduce((acc: any, item: any) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
      }, {});

      expect(Object.keys(grouped)).toHaveLength(5);
      expect(grouped.task).toHaveLength(4);
      expect(grouped.decision).toHaveLength(2);
      expect(grouped.progress).toHaveLength(2);
      expect(grouped.note).toHaveLength(2);
      expect(grouped.warning).toHaveLength(1);
    });

    it('should filter by categories', () => {
      const categories = ['task', 'decision'];
      const items = db.prepare(
        `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND category IN (${categories.map(() => '?').join(',')})
         ORDER BY priority DESC, created_at DESC`
      ).all(testSessionId, ...categories) as any[];

      expect(items).toHaveLength(6); // 4 tasks + 2 decisions
      expect(items.every((i: any) => categories.includes(i.category))).toBe(true);
    });

    it('should limit summary length', () => {
      // Add many items
      for (let i = 0; i < 50; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `extra_${i}`, `Extra item ${i}`, 'note');
      }

      // Get limited summary
      const limit = 20;
      const items = db.prepare(
        'SELECT * FROM context_items WHERE session_id = ? ORDER BY priority DESC, created_at DESC LIMIT ?'
      ).all(testSessionId, limit) as any[];

      expect(items).toHaveLength(limit);
    });

    it('should prioritize high priority items', () => {
      const items = db.prepare(
        `SELECT * FROM context_items 
         WHERE session_id = ? 
         ORDER BY 
           CASE priority 
             WHEN 'critical' THEN 1
             WHEN 'high' THEN 2
             WHEN 'normal' THEN 3
             WHEN 'low' THEN 4
           END,
           created_at DESC`
      ).all(testSessionId) as any[];

      // Check that high priority items come first (after critical if any)
      const highPriorityItems = items.filter((i: any) => i.priority === 'high');
      const firstHighIndex = items.findIndex((i: any) => i.priority === 'high');
      
      // Find last high index manually (findLastIndex not available in older Node)
      let lastHighIndex = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].priority === 'high') {
          lastHighIndex = i;
          break;
        }
      }
      
      if (highPriorityItems.length > 0) {
        // All high priority items should be consecutive
        const expectedLastIndex = firstHighIndex + highPriorityItems.length - 1;
        expect(lastHighIndex).toBe(expectedLastIndex);
      }
      
      // Verify we have the expected high priority items
      expect(highPriorityItems).toHaveLength(4); // 2 tasks + 1 decision + 1 warning
    });

    it('should generate summary with statistics', () => {
      // Get statistics
      const stats = db.prepare(
        `SELECT 
          category,
          priority,
          COUNT(*) as count
         FROM context_items 
         WHERE session_id = ?
         GROUP BY category, priority`
      ).all(testSessionId) as any[];

      // Verify statistics
      const taskHighCount = stats.find((s: any) => s.category === 'task' && s.priority === 'high')?.count;
      expect(taskHighCount).toBe(2);

      const totalCount = stats.reduce((sum: number, s: any) => sum + s.count, 0);
      expect(totalCount).toBe(11);
    });

    it('should include session metadata in summary', () => {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(testSessionId) as any;
      
      expect(session.name).toBe('Summary Test Session');
      expect(session.description).toBe('Testing summarization functionality');
      expect(session.created_at).toBeDefined();
    });

    it('should handle empty sessions', () => {
      // Create empty session
      const emptySessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(emptySessionId, 'Empty Session');

      const items = db.prepare(
        'SELECT * FROM context_items WHERE session_id = ?'
      ).all(emptySessionId) as any[];

      expect(items).toHaveLength(0);
    });

    it('should generate category-specific summaries', () => {
      // Tasks summary
      const tasks = db.prepare(
        'SELECT * FROM context_items WHERE session_id = ? AND category = ? ORDER BY priority DESC'
      ).all(testSessionId, 'task') as any[];

      const taskSummary = {
        total: tasks.length,
        high: tasks.filter((t: any) => t.priority === 'high').length,
        normal: tasks.filter((t: any) => t.priority === 'normal').length,
        low: tasks.filter((t: any) => t.priority === 'low').length,
        items: tasks.slice(0, 5) // Top 5 tasks
      };

      expect(taskSummary.total).toBe(4);
      expect(taskSummary.high).toBe(2);
      expect(taskSummary.normal).toBe(1);
      expect(taskSummary.low).toBe(1);
    });

    it('should format summary for AI consumption', () => {
      const items = db.prepare(
        'SELECT * FROM context_items WHERE session_id = ? ORDER BY category, priority DESC'
      ).all(testSessionId) as any[];

      // Format for AI
      const summary: string[] = [];
      let currentCategory = '';
      
      items.forEach((item: any) => {
        if (item.category !== currentCategory) {
          currentCategory = item.category;
          summary.push(`\n## ${currentCategory.toUpperCase()}`);
        }
        const priorityMarker = item.priority === 'high' ? '🔴' : 
                              item.priority === 'normal' ? '🟡' : '⚪';
        summary.push(`${priorityMarker} ${item.key}: ${item.value}`);
      });

      const formattedSummary = summary.join('\n');
      
      expect(formattedSummary).toContain('## TASK');
      expect(formattedSummary).toContain('## DECISION');
      expect(formattedSummary).toContain('🔴'); // High priority markers
    });

    it('should include temporal information in summary', () => {
      // Get items with time info
      const items = db.prepare(
        `SELECT 
          *,
          strftime('%Y-%m-%d %H:%M', created_at) as formatted_time
         FROM context_items 
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT 5`
      ).all(testSessionId) as any[];

      expect(items).toHaveLength(5);
      items.forEach((item: any) => {
        expect(item.formatted_time).toBeDefined();
        expect(item.formatted_time).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
      });
    });
  });

  describe('Summary with file information', () => {
    it('should include file cache statistics', () => {
      // Add some files
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, `/src/file${i}.ts`, `content${i}`, `hash${i}`);
      }

      const fileStats = db.prepare(
        'SELECT COUNT(*) as count, SUM(LENGTH(content)) as total_size FROM file_cache WHERE session_id = ?'
      ).get(testSessionId) as any;

      expect(fileStats.count).toBe(5);
      expect(fileStats.total_size).toBeGreaterThan(0);
    });
  });
});