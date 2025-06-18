import { DatabaseManager } from '../../utils/database';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

describe('File Operations Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let tempFileDir: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-files-${Date.now()}.db`);
    tempFileDir = path.join(os.tmpdir(), `test-files-${Date.now()}`);
    
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    
    // Create test directory
    fs.mkdirSync(tempFileDir, { recursive: true });
    
    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(testSessionId, 'File Test Session');
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
      fs.rmSync(tempFileDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
  });

  describe('context_cache_file', () => {
    it('should cache file content with hash', () => {
      const filePath = path.join(tempFileDir, 'test.txt');
      const content = 'This is test file content';
      fs.writeFileSync(filePath, content);
      
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      
      const result = db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, filePath, content, hash);

      expect(result.changes).toBe(1);

      const cached = db.prepare(
        'SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath) as any;

      expect(cached).toBeDefined();
      expect(cached.content).toBe(content);
      expect(cached.hash).toBe(hash);
    });

    it('should update existing file cache', () => {
      const filePath = path.join(tempFileDir, 'update.txt');
      const originalContent = 'Original content';
      const updatedContent = 'Updated content';
      
      // Cache original
      const originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, filePath, originalContent, originalHash);

      // Update cache
      const updatedHash = crypto.createHash('sha256').update(updatedContent).digest('hex');
      db.prepare(
        'UPDATE file_cache SET content = ?, hash = ?, last_read = CURRENT_TIMESTAMP WHERE session_id = ? AND file_path = ?'
      ).run(updatedContent, updatedHash, testSessionId, filePath);

      const cached = db.prepare(
        'SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath) as any;

      expect(cached.content).toBe(updatedContent);
      expect(cached.hash).toBe(updatedHash);
    });

    it('should handle binary file content', () => {
      const filePath = path.join(tempFileDir, 'binary.bin');
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
      fs.writeFileSync(filePath, binaryContent);
      
      const base64Content = binaryContent.toString('base64');
      const hash = crypto.createHash('sha256').update(binaryContent).digest('hex');
      
      const result = db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, filePath, base64Content, hash);

      expect(result.changes).toBe(1);

      const cached = db.prepare(
        'SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath) as any;

      expect(cached.content).toBe(base64Content);
      
      // Verify we can decode back
      const decoded = Buffer.from(cached.content, 'base64');
      expect(decoded.equals(binaryContent)).toBe(true);
    });

    it('should handle very large files', () => {
      const filePath = path.join(tempFileDir, 'large.txt');
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB
      fs.writeFileSync(filePath, largeContent);
      
      const hash = crypto.createHash('sha256').update(largeContent).digest('hex');
      
      const result = db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, filePath, largeContent, hash);

      expect(result.changes).toBe(1);

      const cached = db.prepare(
        'SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath) as any;

      expect(cached.content.length).toBe(1024 * 1024);
      expect(cached.hash).toBe(hash);
    });

    it('should track last read timestamp', async () => {
      const filePath = path.join(tempFileDir, 'timestamp.txt');
      const content = 'Test content';
      
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, filePath, content, 'hash');

      const cached = db.prepare(
        'SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath) as any;

      // Verify we have a last_read timestamp
      expect(cached.last_read).toBeDefined();
      
      const lastRead = new Date(cached.last_read);
      expect(lastRead).toBeInstanceOf(Date);
      
      // The timestamp should be a valid date (not NaN)
      expect(lastRead.getTime()).not.toBeNaN();
      
      // SQLite timestamps can have timezone issues, so we just verify it's reasonable
      // (within 24 hours of now in either direction)
      const now = Date.now();
      const dayInMs = 24 * 60 * 60 * 1000;
      expect(Math.abs(lastRead.getTime() - now)).toBeLessThan(dayInMs);
    });
  });

  describe('context_file_changed', () => {
    it('should detect no change when hash matches', () => {
      const filePath = path.join(tempFileDir, 'unchanged.txt');
      const content = 'Unchanged content';
      fs.writeFileSync(filePath, content);
      
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      
      // Cache the file
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, filePath, content, hash);

      // Check if changed (using same hash)
      const cached = db.prepare(
        'SELECT hash FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath) as any;

      const currentHash = crypto.createHash('sha256').update(content).digest('hex');
      
      expect(cached.hash).toBe(currentHash);
      expect(cached.hash === currentHash).toBe(true); // Not changed
    });

    it('should detect change when hash differs', () => {
      const filePath = path.join(tempFileDir, 'changed.txt');
      const originalContent = 'Original content';
      const newContent = 'Modified content';
      
      const originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');
      
      // Cache original
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, filePath, originalContent, originalHash);

      // Simulate file change
      fs.writeFileSync(filePath, newContent);
      const newHash = crypto.createHash('sha256').update(newContent).digest('hex');

      const cached = db.prepare(
        'SELECT hash FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath) as any;

      expect(cached.hash).toBe(originalHash);
      expect(cached.hash === newHash).toBe(false); // Changed
    });

    it('should handle file not in cache', () => {
      const filePath = path.join(tempFileDir, 'notcached.txt');
      
      const cached = db.prepare(
        'SELECT hash FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath);

      expect(cached).toBeUndefined();
    });

    it('should handle file deletion', () => {
      const filePath = path.join(tempFileDir, 'deleted.txt');
      const content = 'To be deleted';
      fs.writeFileSync(filePath, content);
      
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      
      // Cache the file
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, filePath, content, hash);

      // Delete the file
      fs.unlinkSync(filePath);

      // Check existence
      expect(fs.existsSync(filePath)).toBe(false);
      
      // Cache still exists
      const cached = db.prepare(
        'SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, filePath) as any;

      expect(cached).toBeDefined();
      expect(cached.content).toBe(content); // Can still retrieve content
    });

    it('should handle multiple files efficiently', () => {
      const files: Array<{ path: string; content: string; hash: string }> = [];
      
      // Create and cache multiple files
      for (let i = 0; i < 10; i++) {
        const filePath = path.join(tempFileDir, `file${i}.txt`);
        const content = `Content for file ${i}`;
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        
        fs.writeFileSync(filePath, content);
        files.push({ path: filePath, content, hash });
        
        db.prepare(
          'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, filePath, content, hash);
      }

      // Check all files
      const cachedFiles = db.prepare(
        'SELECT file_path, hash FROM file_cache WHERE session_id = ?'
      ).all(testSessionId) as any[];

      expect(cachedFiles).toHaveLength(10);
      
      // Verify each file
      cachedFiles.forEach((cached: any) => {
        const original = files.find(f => f.path === cached.file_path);
        expect(original).toBeDefined();
        expect(cached.hash).toBe(original!.hash);
      });
    });
  });

  describe('File operations with context', () => {
    it('should link file cache with context items', () => {
      const filePath = path.join(tempFileDir, 'linked.txt');
      const content = 'Linked file content';
      fs.writeFileSync(filePath, content);
      
      // Cache file
      const fileId = uuidv4();
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      db.prepare(
        'INSERT INTO file_cache (id, session_id, file_path, content, hash) VALUES (?, ?, ?, ?, ?)'
      ).run(fileId, testSessionId, filePath, content, hash);

      // Save related context
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, category) VALUES (?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'working_file', filePath, 'file_reference');

      // Query both
      const context = db.prepare(
        'SELECT * FROM context_items WHERE session_id = ? AND key = ?'
      ).get(testSessionId, 'working_file') as any;

      const file = db.prepare(
        'SELECT * FROM file_cache WHERE session_id = ? AND file_path = ?'
      ).get(testSessionId, context.value) as any;

      expect(file).toBeDefined();
      expect(file.content).toBe(content);
    });
  });
});