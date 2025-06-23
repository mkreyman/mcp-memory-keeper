import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Checkpoint Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-checkpoint-${Date.now()}.db`);
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
    } catch (_e) {
      // Ignore
    }
  });

  describe('Checkpoint creation', () => {
    it('should create a checkpoint with all context items', () => {
      // Setup session with context
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Add context items
      const contextItems = [];
      for (let i = 0; i < 5; i++) {
        const itemId = uuidv4();
        contextItems.push(itemId);
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(itemId, sessionId, `key${i}`, `value${i}`);
      }

      // Create checkpoint
      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, description) VALUES (?, ?, ?, ?)'
      ).run(checkpointId, sessionId, 'Test Checkpoint', 'Test Description');

      // Link context items to checkpoint
      contextItems.forEach(itemId => {
        db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, itemId);
      });

      // Verify checkpoint was created
      const checkpoint = db
        .prepare('SELECT * FROM checkpoints WHERE id = ?')
        .get(checkpointId) as any;
      expect(checkpoint).toBeDefined();
      expect(checkpoint.name).toBe('Test Checkpoint');

      // Verify all items are linked
      const linkedItems = db
        .prepare('SELECT COUNT(*) as count FROM checkpoint_items WHERE checkpoint_id = ?')
        .get(checkpointId) as any;
      expect(linkedItems.count).toBe(5);
    });

    it('should include file cache in checkpoint', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Add file cache entries
      const fileIds = [];
      for (let i = 0; i < 3; i++) {
        const fileId = uuidv4();
        fileIds.push(fileId);
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(fileId, sessionId, `/file${i}.txt`, `content${i}`, `hash${i}`);
      }

      // Create checkpoint
      const checkpointId = uuidv4();
      db.prepare('INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)').run(
        checkpointId,
        sessionId,
        'File Checkpoint'
      );

      // Link files to checkpoint
      fileIds.forEach(fileId => {
        db.prepare(
          'INSERT INTO checkpoint_files (id, checkpoint_id, file_cache_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, fileId);
      });

      // Verify files are linked
      const linkedFiles = db
        .prepare('SELECT COUNT(*) as count FROM checkpoint_files WHERE checkpoint_id = ?')
        .get(checkpointId) as any;
      expect(linkedFiles.count).toBe(3);
    });

    it('should capture git status in checkpoint', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      const gitStatus = JSON.stringify({
        modified: ['file1.ts'],
        created: ['file2.ts'],
        staged: ['file1.ts'],
      });

      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, git_status, git_branch) VALUES (?, ?, ?, ?, ?)'
      ).run(checkpointId, sessionId, 'Git Checkpoint', gitStatus, 'feature/test');

      const checkpoint = db
        .prepare('SELECT * FROM checkpoints WHERE id = ?')
        .get(checkpointId) as any;
      expect(checkpoint.git_status).toBe(gitStatus);
      expect(checkpoint.git_branch).toBe('feature/test');
    });
  });

  describe('Checkpoint restoration', () => {
    it('should restore all context items from checkpoint', () => {
      // Create original session
      const originalSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        originalSessionId,
        'Original'
      );

      // Add context items
      const originalItems = [];
      for (let i = 0; i < 3; i++) {
        const itemId = uuidv4();
        originalItems.push({
          id: itemId,
          key: `key${i}`,
          value: `value${i}`,
          category: 'task',
          priority: 'high',
        });
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(itemId, originalSessionId, `key${i}`, `value${i}`, 'task', 'high');
      }

      // Create checkpoint
      const checkpointId = uuidv4();
      db.prepare('INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)').run(
        checkpointId,
        originalSessionId,
        'Restore Test'
      );

      // Link items to checkpoint
      originalItems.forEach(item => {
        db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, item.id);
      });

      // Create new session and restore
      const newSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(newSessionId, 'Restored');

      // Restore items
      const itemsToRestore = db
        .prepare(
          `
        SELECT ci.* FROM context_items ci
        JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
        WHERE cpi.checkpoint_id = ?
      `
        )
        .all(checkpointId) as any[];

      itemsToRestore.forEach((item: any) => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), newSessionId, item.key, item.value, item.category, item.priority);
      });

      // Verify restoration
      const restoredItems = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY key')
        .all(newSessionId) as any[];

      expect(restoredItems).toHaveLength(3);
      expect(restoredItems[0].key).toBe('key0');
      expect(restoredItems[0].value).toBe('value0');
      expect(restoredItems[0].category).toBe('task');
      expect(restoredItems[0].priority).toBe('high');
    });

    it('should restore file cache from checkpoint', () => {
      // Create original session with files
      const originalSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
        originalSessionId,
        'Original'
      );

      // Add files
      const fileId = uuidv4();
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(fileId, originalSessionId, '/test/file.txt', 'file content', 'file hash');

      // Create checkpoint
      const checkpointId = uuidv4();
      db.prepare('INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)').run(
        checkpointId,
        originalSessionId,
        'File Restore Test'
      );

      db.prepare(
        'INSERT INTO checkpoint_files (id, checkpoint_id, file_cache_id) VALUES (?, ?, ?)'
      ).run(uuidv4(), checkpointId, fileId);

      // Restore to new session
      const newSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(newSessionId, 'Restored');

      const filesToRestore = db
        .prepare(
          `
        SELECT fc.* FROM file_cache fc
        JOIN checkpoint_files cpf ON fc.id = cpf.file_cache_id
        WHERE cpf.checkpoint_id = ?
      `
        )
        .all(checkpointId) as any[];

      filesToRestore.forEach((file: any) => {
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), newSessionId, file.file_path, file.content, file.hash);
      });

      // Verify restoration
      const restoredFile = db
        .prepare('SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?')
        .get(newSessionId, '/test/file.txt') as any;

      expect(restoredFile).toBeDefined();
      expect(restoredFile.content).toBe('file content');
      expect(restoredFile.hash).toBe('file hash');
    });
  });

  describe('Checkpoint management', () => {
    it('should list checkpoints for a session', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Create multiple checkpoints
      const checkpoints = [];
      for (let i = 0; i < 3; i++) {
        const checkpointId = uuidv4();
        checkpoints.push({ id: checkpointId, name: `Checkpoint ${i}` });

        const date = new Date();
        date.setMinutes(date.getMinutes() - (3 - i)); // Different timestamps

        db.prepare(
          'INSERT INTO checkpoints (id, session_id, name, created_at) VALUES (?, ?, ?, ?)'
        ).run(checkpointId, sessionId, `Checkpoint ${i}`, date.toISOString());
      }

      // List checkpoints
      const list = db
        .prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC')
        .all(sessionId) as any[];

      expect(list).toHaveLength(3);
      expect(list[0].name).toBe('Checkpoint 2'); // Most recent
      expect(list[2].name).toBe('Checkpoint 0'); // Oldest
    });

    it('should find checkpoint by name', () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      const checkpointId = uuidv4();
      db.prepare('INSERT INTO checkpoints (id, session_id, name) VALUES (?, ?, ?)').run(
        checkpointId,
        sessionId,
        'Named Checkpoint'
      );

      const found = db
        .prepare('SELECT * FROM checkpoints WHERE session_id = ? AND name = ?')
        .get(sessionId, 'Named Checkpoint') as any;

      expect(found).toBeDefined();
      expect(found.id).toBe(checkpointId);
    });
  });
});
