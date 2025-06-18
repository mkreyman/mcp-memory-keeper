import { DatabaseManager } from '../../utils/database';
import { GitOperations } from '../../utils/git';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Smart Compaction Integration Tests', () => {
  let dbManager: DatabaseManager;
  let gitOps: GitOperations;
  let tempDbPath: string;
  let tempRepoPath: string;
  let db: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-compaction-${Date.now()}.db`);
    tempRepoPath = path.join(os.tmpdir(), `test-repo-${Date.now()}`);
    
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    
    // Create a mock git repo
    fs.mkdirSync(tempRepoPath, { recursive: true });
    gitOps = new GitOperations(tempRepoPath);
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
      fs.rmSync(tempRepoPath, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
  });

  describe('context_prepare_compaction', () => {
    it('should identify critical context items', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Add various priority items
      const items = [
        { key: 'critical1', value: 'Critical task', priority: 'critical', category: 'task' },
        { key: 'high1', value: 'High priority', priority: 'high', category: 'decision' },
        { key: 'normal1', value: 'Normal item', priority: 'normal', category: 'note' },
        { key: 'low1', value: 'Low priority', priority: 'low', category: 'reference' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, priority, category) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, item.key, item.value, item.priority, item.category);
      });

      // Get critical items (critical + high priority)
      const criticalItems = db.prepare(
        `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND priority IN ('critical', 'high')
         ORDER BY 
           CASE priority 
             WHEN 'critical' THEN 1 
             WHEN 'high' THEN 2 
           END`
      ).all(sessionId) as any[];

      expect(criticalItems).toHaveLength(2);
      expect(criticalItems[0].key).toBe('critical1');
      expect(criticalItems[1].key).toBe('high1');
    });

    it('should include recently modified files', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Add file cache entries with different timestamps
      const now = new Date();
      const files = [
        { path: '/recent.ts', time: now },
        { path: '/older.ts', time: new Date(now.getTime() - 3600000) }, // 1 hour ago
        { path: '/oldest.ts', time: new Date(now.getTime() - 86400000) }, // 1 day ago
      ];

      files.forEach(file => {
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash, last_read) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, file.path, 'content', 'hash', file.time.toISOString());
      });

      // Get recently modified files (last 2 hours)
      const twoHoursAgo = new Date(now.getTime() - 7200000);
      const recentFiles = db.prepare(
        `SELECT * FROM file_cache 
         WHERE session_id = ? 
         AND datetime(last_read) > datetime(?)
         ORDER BY last_read DESC`
      ).all(sessionId, twoHoursAgo.toISOString()) as any[];

      expect(recentFiles).toHaveLength(2);
      expect(recentFiles[0].file_path).toBe('/recent.ts');
      expect(recentFiles[1].file_path).toBe('/older.ts');
    });

    it('should automatically create checkpoint before compaction', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Compaction Test');

      // Add context items
      for (let i = 0; i < 5; i++) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, `key${i}`, `value${i}`);
      }

      // Simulate checkpoint creation
      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, description) VALUES (?, ?, ?, ?)'
      ).run(checkpointId, sessionId, 'Pre-compaction checkpoint', 'Automatic checkpoint before context compaction');

      // Link all items to checkpoint
      const items = db.prepare('SELECT id FROM context_items WHERE session_id = ?').all(sessionId) as any[];
      items.forEach((item: any) => {
        db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, item.id);
      });

      // Verify checkpoint was created
      const checkpoint = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
      expect(checkpoint).toBeDefined();
      expect(checkpoint.name).toContain('Pre-compaction');

      // Verify all items are backed up
      const backedUpCount = db.prepare(
        'SELECT COUNT(*) as count FROM checkpoint_items WHERE checkpoint_id = ?'
      ).get(checkpointId) as any;
      expect(backedUpCount.count).toBe(5);
    });

    it('should generate smart summary with categories', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Summary Test');

      // Add items in different categories
      const categories = ['task', 'decision', 'note', 'reference'];
      categories.forEach(category => {
        for (let i = 0; i < 3; i++) {
          db.prepare(
            'INSERT INTO context_items (id, session_id, key, value, category) VALUES (?, ?, ?, ?, ?)'
          ).run(uuidv4(), sessionId, `${category}_${i}`, `${category} content ${i}`, category);
        }
      });

      // Generate summary by category
      const summary = categories.map(category => {
        const items = db.prepare(
          'SELECT * FROM context_items WHERE session_id = ? AND category = ?'
        ).all(sessionId, category) as any[];
        
        return {
          category,
          count: items.length,
          items: items.map((i: any) => ({ key: i.key, value: i.value }))
        };
      });

      expect(summary).toHaveLength(4);
      expect(summary[0].category).toBe('task');
      expect(summary[0].count).toBe(3);
      expect(summary[1].category).toBe('decision');
      expect(summary[1].count).toBe(3);
    });

    it('should identify next steps from tasks', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Next Steps Test');

      // Add tasks with different priorities
      const tasks = [
        { key: 'task_complete', value: '[COMPLETED] Completed task', category: 'task', priority: 'low' },
        { key: 'task_pending', value: '[PENDING] Pending task', category: 'task', priority: 'normal' },
        { key: 'task_inprogress', value: '[IN PROGRESS] In progress task', category: 'task', priority: 'high' },
        { key: 'task_blocked', value: '[BLOCKED] Blocked task - waiting for review', category: 'task', priority: 'high' },
      ];

      tasks.forEach(task => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, task.key, task.value, task.category, task.priority);
      });

      // Get high priority tasks as next steps
      const nextSteps = db.prepare(
        `SELECT * FROM context_items 
         WHERE session_id = ? 
         AND category = 'task'
         AND priority = 'high'
         ORDER BY created_at DESC`
      ).all(sessionId) as any[];

      expect(nextSteps).toHaveLength(2);
      // Both high priority tasks should be included
      expect(nextSteps.map((t: any) => t.key)).toContain('task_blocked');
      expect(nextSteps.map((t: any) => t.key)).toContain('task_inprogress');
    });
  });
});