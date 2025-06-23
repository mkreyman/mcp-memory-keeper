import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Advanced Features Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-advanced-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();

    // Create all necessary tables including Phase 4.4 enhancements
    db.exec(`
      -- Sessions table with parent_id for branching
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        branch TEXT,
        parent_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES sessions(id)
      );
      
      -- Context items table
      CREATE TABLE IF NOT EXISTS context_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        priority TEXT DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        UNIQUE(session_id, key)
      );
      
      -- File cache table
      CREATE TABLE IF NOT EXISTS file_cache (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content TEXT,
        hash TEXT,
        last_read TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        UNIQUE(session_id, file_path)
      );
      
      -- Journal entries table
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        entry TEXT NOT NULL,
        tags TEXT,
        mood TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      -- Compressed context table
      CREATE TABLE IF NOT EXISTS compressed_context (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        original_count INTEGER NOT NULL,
        compressed_data TEXT NOT NULL,
        compression_ratio REAL NOT NULL,
        date_range_start TIMESTAMP,
        date_range_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      -- Cross-tool integration events
      CREATE TABLE IF NOT EXISTS tool_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);

    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
      testSessionId,
      'Advanced Features Test',
      'Testing Phase 4.4 features'
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

  describe('Session Branching', () => {
    beforeEach(() => {
      // Add test data to source session
      const items = [
        { key: 'task_1', value: 'High priority task', category: 'task', priority: 'high' },
        { key: 'task_2', value: 'Normal priority task', category: 'task', priority: 'normal' },
        {
          key: 'decision_1',
          value: 'Architecture decision',
          category: 'decision',
          priority: 'high',
        },
        { key: 'note_1', value: 'Implementation note', category: 'note', priority: 'normal' },
      ];

      for (const item of items) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      }

      // Add file cache
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, '/test/file.js', 'console.log("test");', 'abc123');
    });

    it('should create shallow branch with only high priority items', () => {
      // Create branch
      const branchName = 'feature-branch';
      const branchId = uuidv4();

      db.prepare(
        `
        INSERT INTO sessions (id, name, description, parent_id)
        VALUES (?, ?, ?, ?)
      `
      ).run(branchId, branchName, `Branch of test session`, testSessionId);

      // Copy high priority items
      const highPriorityItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND priority = ?')
        .all(testSessionId, 'high') as any[];

      expect(highPriorityItems.length).toBe(2);

      for (const item of highPriorityItems) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), branchId, item.key, item.value, item.category, item.priority);
      }

      // Verify branch has only high priority items
      const branchItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(branchId) as any[];
      expect(branchItems.length).toBe(2);
      expect(branchItems.every((item: any) => item.priority === 'high')).toBe(true);
    });

    it('should create deep branch with all items and files', () => {
      const branchName = 'full-branch';
      const branchId = uuidv4();

      db.prepare(
        `
        INSERT INTO sessions (id, name, description, parent_id)
        VALUES (?, ?, ?, ?)
      `
      ).run(branchId, branchName, `Branch of test session`, testSessionId);

      // Copy all items
      const allItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(testSessionId) as any[];

      for (const item of allItems) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), branchId, item.key, item.value, item.category, item.priority);
      }

      // Copy files
      const files = db
        .prepare('SELECT * FROM file_cache WHERE session_id = ?')
        .all(testSessionId) as any[];

      for (const file of files) {
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), branchId, file.file_path, file.content, file.hash);
      }

      // Verify
      const branchItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(branchId) as any[];
      const branchFiles = db
        .prepare('SELECT * FROM file_cache WHERE session_id = ?')
        .all(branchId) as any[];

      expect(branchItems.length).toBe(4);
      expect(branchFiles.length).toBe(1);
    });

    it('should track parent-child relationship', () => {
      const branchId = uuidv4();

      db.prepare(
        `
        INSERT INTO sessions (id, name, parent_id)
        VALUES (?, ?, ?)
      `
      ).run(branchId, 'child-branch', testSessionId);

      const branch = db.prepare('SELECT * FROM sessions WHERE id = ?').get(branchId) as any;
      expect(branch.parent_id).toBe(testSessionId);
    });
  });

  describe('Session Merging', () => {
    let sourceSessionId: string;
    let targetSessionId: string;

    beforeEach(() => {
      // Create source and target sessions
      sourceSessionId = uuidv4();
      targetSessionId = uuidv4();

      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        sourceSessionId,
        'Source Session'
      );
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        targetSessionId,
        'Target Session'
      );

      // Add items to source
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        sourceSessionId,
        'unique_item',
        'Only in source'
      );
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        sourceSessionId,
        'shared_item',
        'Source version'
      );

      // Add items to target
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        targetSessionId,
        'shared_item',
        'Target version'
      );
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        uuidv4(),
        targetSessionId,
        'target_only',
        'Only in target'
      );
    });

    it('should merge with keep_current conflict resolution', () => {
      const sourceItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(sourceSessionId) as any[];

      for (const item of sourceItems) {
        const existing = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
          .get(targetSessionId, item.key) as any;

        if (!existing) {
          db.prepare(
            'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
          ).run(uuidv4(), targetSessionId, item.key, item.value);
        }
        // keep_current means we don't update existing items
      }

      const finalItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(targetSessionId) as any[];
      const sharedItem = finalItems.find((i: any) => i.key === 'shared_item');

      expect(finalItems.length).toBe(3);
      expect(sharedItem.value).toBe('Target version'); // Kept current
    });

    it('should merge with keep_source conflict resolution', () => {
      const sourceItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(sourceSessionId) as any[];

      for (const item of sourceItems) {
        const existing = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
          .get(targetSessionId, item.key) as any;

        if (existing) {
          db.prepare('UPDATE context_items SET value = ? WHERE session_id = ? AND key = ?').run(
            item.value,
            targetSessionId,
            item.key
          );
        } else {
          db.prepare(
            'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
          ).run(uuidv4(), targetSessionId, item.key, item.value);
        }
      }

      const finalItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(targetSessionId) as any[];
      const sharedItem = finalItems.find((i: any) => i.key === 'shared_item');

      expect(finalItems.length).toBe(3);
      expect(sharedItem.value).toBe('Source version'); // Replaced with source
    });

    it('should merge with keep_newest conflict resolution', () => {
      // First, create the target item with an older timestamp
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 1); // 1 hour ago

      // Update target item to be older
      db.prepare('UPDATE context_items SET created_at = ? WHERE session_id = ? AND key = ?').run(
        oldDate.toISOString(),
        targetSessionId,
        'shared_item'
      );

      // Source item has current timestamp, so it's newer
      const sourceItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(sourceSessionId) as any[];

      for (const item of sourceItems) {
        const existing = db
          .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
          .get(targetSessionId, item.key) as any;

        if (existing) {
          if (new Date(item.created_at) > new Date(existing.created_at)) {
            db.prepare('UPDATE context_items SET value = ? WHERE session_id = ? AND key = ?').run(
              item.value,
              targetSessionId,
              item.key
            );
          }
        } else {
          db.prepare(
            'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
          ).run(uuidv4(), targetSessionId, item.key, item.value);
        }
      }

      const finalItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(targetSessionId) as any[];
      const sharedItem = finalItems.find((i: any) => i.key === 'shared_item');

      expect(finalItems.length).toBe(3);
      expect(sharedItem.value).toBe('Source version'); // Source was newer
    });
  });

  describe('Journal Entries', () => {
    it('should create journal entry with tags and mood', () => {
      const entry = 'Had a productive day working on the authentication module';
      const tags = ['productivity', 'authentication', 'backend'];
      const mood = 'accomplished';

      const id = uuidv4();
      db.prepare(
        `
        INSERT INTO journal_entries (id, session_id, entry, tags, mood)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(id, testSessionId, entry, JSON.stringify(tags), mood);

      const saved = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as any;

      expect(saved.entry).toBe(entry);
      expect(JSON.parse(saved.tags)).toEqual(tags);
      expect(saved.mood).toBe(mood);
    });

    it('should retrieve journal entries by session', () => {
      // Add multiple entries
      const entries = [
        { entry: 'Morning standup went well', mood: 'positive', tags: ['meeting'] },
        { entry: 'Debugging session was challenging', mood: 'frustrated', tags: ['debugging'] },
        { entry: 'Fixed the bug!', mood: 'excited', tags: ['debugging', 'success'] },
      ];

      for (const e of entries) {
        db.prepare(
          `
          INSERT INTO journal_entries (id, session_id, entry, tags, mood)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, e.entry, JSON.stringify(e.tags), e.mood);
      }

      const journalEntries = db
        .prepare('SELECT * FROM journal_entries WHERE session_id = ? ORDER BY created_at')
        .all(testSessionId) as any[];

      expect(journalEntries.length).toBe(3);
      expect(journalEntries[0].entry).toBe('Morning standup went well');
      expect(journalEntries[2].mood).toBe('excited');
    });

    it('should filter journal entries by date range', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Add entry
      db.prepare(
        `
        INSERT INTO journal_entries (id, session_id, entry)
        VALUES (?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, 'Today entry');

      const entries = db
        .prepare(
          'SELECT * FROM journal_entries WHERE session_id = ? AND created_at >= ? AND created_at <= ?'
        )
        .all(testSessionId, yesterday.toISOString(), tomorrow.toISOString()) as any[];

      expect(entries.length).toBe(1);
    });
  });

  describe('Timeline Generation', () => {
    beforeEach(() => {
      // Create items across different dates
      const dates = [
        new Date('2024-01-15T10:00:00'),
        new Date('2024-01-15T14:00:00'),
        new Date('2024-01-16T09:00:00'),
        new Date('2024-01-16T11:00:00'),
        new Date('2024-01-16T15:00:00'),
      ];

      const categories = ['task', 'decision', 'task', 'progress', 'note'];

      dates.forEach((date, index) => {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, category, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(
          uuidv4(),
          testSessionId,
          `item_${index}`,
          `Item ${index}`,
          categories[index],
          date.toISOString()
        );
      });
    });

    it('should group timeline by day', () => {
      const timeline = db
        .prepare(
          `
        SELECT 
          strftime('%Y-%m-%d', created_at) as date,
          COUNT(*) as count,
          category
        FROM context_items
        WHERE session_id = ?
        GROUP BY date, category
        ORDER BY date
      `
        )
        .all(testSessionId) as any[];

      const dateGroups: Record<string, any> = {};
      for (const item of timeline) {
        if (!dateGroups[item.date]) {
          dateGroups[item.date] = { total: 0, categories: {} };
        }
        dateGroups[item.date].categories[item.category] = item.count;
        dateGroups[item.date].total += item.count;
      }

      expect(Object.keys(dateGroups).length).toBe(2); // 2 different days
      expect(dateGroups['2024-01-15'].total).toBe(2);
      expect(dateGroups['2024-01-16'].total).toBe(3);
    });

    it('should group timeline by hour', () => {
      const timeline = db
        .prepare(
          `
        SELECT 
          strftime('%Y-%m-%d', created_at) as date,
          strftime('%H', created_at) as hour,
          COUNT(*) as count
        FROM context_items
        WHERE session_id = ?
        GROUP BY date, hour
        ORDER BY date, hour
      `
        )
        .all(testSessionId) as any[];

      expect(timeline.length).toBe(5); // 5 different hours
      // Just verify we have different hours, don't check specific values due to timezone
      const hours = timeline.map((t: any) => parseInt(t.hour));
      expect(new Set(hours).size).toBe(5); // All hours are different
    });

    it('should include journal entries in timeline', () => {
      // Add journal entry
      db.prepare(
        `
        INSERT INTO journal_entries (id, session_id, entry, created_at)
        VALUES (?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, 'Daily reflection', '2024-01-15T20:00:00');

      const journals = db
        .prepare('SELECT * FROM journal_entries WHERE session_id = ? ORDER BY created_at')
        .all(testSessionId) as any[];

      expect(journals.length).toBe(1);
      expect(journals[0].entry).toBe('Daily reflection');
    });
  });

  describe('Progressive Compression', () => {
    beforeEach(() => {
      // Create old and new items
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);

      const items = [
        {
          key: 'old_task_1',
          value: 'Old task 1',
          created_at: oldDate.toISOString(),
          category: 'task',
        },
        {
          key: 'old_task_2',
          value: 'Old task 2',
          created_at: oldDate.toISOString(),
          category: 'task',
        },
        {
          key: 'old_decision',
          value: 'Old decision',
          created_at: oldDate.toISOString(),
          category: 'decision',
        },
        {
          key: 'recent_task',
          value: 'Recent task',
          created_at: new Date().toISOString(),
          category: 'task',
        },
        {
          key: 'preserve_me',
          value: 'Important decision',
          created_at: oldDate.toISOString(),
          category: 'critical',
        },
      ];

      for (const item of items) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value, category, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.created_at);
      }
    });

    it('should compress old items', () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);

      const itemsToCompress = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND created_at < ?')
        .all(testSessionId, cutoffDate.toISOString()) as any[];

      expect(itemsToCompress.length).toBe(4); // All old items

      // Group by category
      const categoryGroups: Record<string, any[]> = {};
      for (const item of itemsToCompress) {
        const category = item.category || 'uncategorized';
        if (!categoryGroups[category]) {
          categoryGroups[category] = [];
        }
        categoryGroups[category].push(item);
      }

      expect(Object.keys(categoryGroups).length).toBe(3); // task, decision, critical
      expect(categoryGroups.task.length).toBe(2);
    });

    it('should preserve specified categories', () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);
      const preserveCategories = ['critical', 'decision'];

      const query = `
        SELECT * FROM context_items 
        WHERE session_id = ? 
        AND created_at < ?
        AND category NOT IN (${preserveCategories.map(() => '?').join(',')})
      `;

      const itemsToCompress = db
        .prepare(query)
        .all(testSessionId, cutoffDate.toISOString(), ...preserveCategories) as any[];

      expect(itemsToCompress.length).toBe(2); // Only old tasks
      expect(itemsToCompress.every((item: any) => item.category === 'task')).toBe(true);
    });

    it('should calculate compression ratio', () => {
      const items = db
        .prepare('SELECT * FROM context_items WHERE session_id = ?')
        .all(testSessionId) as any[];

      const compressed = {
        categories: {
          task: { count: 3, samples: [] },
          decision: { count: 1, samples: [] },
          critical: { count: 1, samples: [] },
        },
      };

      const originalSize = JSON.stringify(items).length;
      const compressedSize = JSON.stringify(compressed).length;
      const compressionRatio = 1 - compressedSize / originalSize;

      expect(compressionRatio).toBeGreaterThan(0.5); // Should achieve >50% compression
    });

    it('should store compressed data', () => {
      const compressedData = JSON.stringify({
        categories: { task: { count: 2 } },
      });

      const id = uuidv4();
      const now = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO compressed_context (id, session_id, original_count, compressed_data, compression_ratio, date_range_start, date_range_end)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run(id, testSessionId, 2, compressedData, 0.75, now, now);

      const saved = db.prepare('SELECT * FROM compressed_context WHERE id = ?').get(id) as any;

      expect(saved.original_count).toBe(2);
      expect(saved.compression_ratio).toBe(0.75);
      expect(JSON.parse(saved.compressed_data).categories.task.count).toBe(2);
    });
  });

  describe('Cross-Tool Integration', () => {
    it('should record tool events', () => {
      const toolName = 'code-analyzer';
      const eventType = 'analysis-complete';
      const data = { files: 10, issues: 3 };

      const id = uuidv4();
      db.prepare(
        `
        INSERT INTO tool_events (id, session_id, tool_name, event_type, data)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(id, testSessionId, toolName, eventType, JSON.stringify(data));

      const saved = db.prepare('SELECT * FROM tool_events WHERE id = ?').get(id) as any;

      expect(saved.tool_name).toBe(toolName);
      expect(saved.event_type).toBe(eventType);
      expect(JSON.parse(saved.data)).toEqual(data);
    });

    it('should create context item for important events', () => {
      const toolName = 'security-scanner';
      const eventType = 'vulnerability-found';
      const data = {
        severity: 'high',
        file: 'auth.js',
        important: true,
      };

      // Record event
      const eventId = uuidv4();
      db.prepare(
        `
        INSERT INTO tool_events (id, session_id, tool_name, event_type, data)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(eventId, testSessionId, toolName, eventType, JSON.stringify(data));

      // Create context item for important event
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        uuidv4(),
        testSessionId,
        `${toolName}_${eventType}_${Date.now()}`,
        `Tool event: ${toolName} - ${eventType}: ${JSON.stringify(data)}`,
        'tool_event',
        'high'
      );

      const contextItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND category = ?')
        .all(testSessionId, 'tool_event') as any[];

      expect(contextItems.length).toBe(1);
      expect(contextItems[0].priority).toBe('high');
      expect(contextItems[0].value).toContain('vulnerability-found');
    });

    it('should handle events from multiple tools', () => {
      const events = [
        { tool: 'linter', type: 'scan-complete', data: { warnings: 5 } },
        { tool: 'test-runner', type: 'tests-passed', data: { total: 100, passed: 100 } },
        { tool: 'build-tool', type: 'build-success', data: { duration: '45s' } },
      ];

      for (const event of events) {
        db.prepare(
          `
          INSERT INTO tool_events (id, session_id, tool_name, event_type, data)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, event.tool, event.type, JSON.stringify(event.data));
      }

      const allEvents = db
        .prepare('SELECT * FROM tool_events WHERE session_id = ?')
        .all(testSessionId) as any[];

      expect(allEvents.length).toBe(3);
      expect(allEvents.map((e: any) => e.tool_name)).toContain('linter');
      expect(allEvents.map((e: any) => e.tool_name)).toContain('test-runner');
      expect(allEvents.map((e: any) => e.tool_name)).toContain('build-tool');
    });
  });
});
