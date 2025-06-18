import { DatabaseManager } from '../../utils/database';
import { VectorStore } from '../../utils/vector-store';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('VectorStore', () => {
  let dbManager: DatabaseManager;
  let vectorStore: VectorStore;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-vector-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    vectorStore = new VectorStore(db);
    
    // Create test session and context items
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
      testSessionId, 
      'Test Session',
      'Testing vector store'
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

  describe('Embedding creation', () => {
    it('should create consistent embeddings for the same text', () => {
      const text = 'This is a test sentence for embedding';
      const embedding1 = vectorStore.createEmbedding(text);
      const embedding2 = vectorStore.createEmbedding(text);
      
      expect(embedding1).toEqual(embedding2);
      expect(embedding1.length).toBe(384); // Default dimension
    });

    it('should create different embeddings for different text', () => {
      const embedding1 = vectorStore.createEmbedding('First text');
      const embedding2 = vectorStore.createEmbedding('Completely different text');
      
      expect(embedding1).not.toEqual(embedding2);
    });

    it('should normalize embeddings', () => {
      const embedding = vectorStore.createEmbedding('Test text');
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should handle empty text', () => {
      const embedding = vectorStore.createEmbedding('');
      expect(embedding.every(v => v === 0)).toBe(true);
    });
  });

  describe('Document storage', () => {
    it('should store a document with embedding', async () => {
      const contentId = uuidv4();
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        contentId,
        testSessionId,
        'test_key',
        'test value'
      );
      
      const docId = await vectorStore.storeDocument(
        contentId,
        'test_key: test value',
        { category: 'test' }
      );
      
      expect(docId).toBeDefined();
      
      // Verify in database
      const stored = db.prepare('SELECT * FROM vector_embeddings WHERE id = ?').get(docId) as any;
      expect(stored).toBeDefined();
      expect(stored.content).toBe('test_key: test value');
      expect(stored.content_id).toBe(contentId);
      expect(JSON.parse(stored.metadata)).toEqual({ category: 'test' });
    });

    it('should handle documents without metadata', async () => {
      const contentId = uuidv4();
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        contentId,
        testSessionId,
        'test_key',
        'test value'
      );
      
      const docId = await vectorStore.storeDocument(contentId, 'test content');
      
      const stored = db.prepare('SELECT * FROM vector_embeddings WHERE id = ?').get(docId) as any;
      expect(stored.metadata).toBeNull();
    });
  });

  describe('Semantic search', () => {
    beforeEach(async () => {
      // Create test context items with embeddings
      const items = [
        { key: 'auth_task', value: 'Implement user authentication with JWT tokens' },
        { key: 'auth_decision', value: 'Use bcrypt for password hashing' },
        { key: 'db_task', value: 'Set up PostgreSQL database connection' },
        { key: 'api_task', value: 'Create REST API endpoints for user management' },
        { key: 'test_task', value: 'Write unit tests for authentication module' }
      ];
      
      for (const item of items) {
        const itemId = uuidv4();
        db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
          itemId,
          testSessionId,
          item.key,
          item.value
        );
        
        await vectorStore.storeDocument(
          itemId,
          `${item.key}: ${item.value}`,
          { key: item.key }
        );
      }
    });

    it('should find relevant documents by semantic similarity', async () => {
      const results = await vectorStore.search('authentication security', 5, 0.1);
      
      expect(results.length).toBeGreaterThan(0);
      
      // Authentication-related items should rank higher
      const topResults = results.slice(0, 2);
      const authRelated = topResults.filter(r => 
        r.content.toLowerCase().includes('auth') || 
        r.content.toLowerCase().includes('password')
      );
      expect(authRelated.length).toBeGreaterThan(0);
    });

    it('should respect topK parameter', async () => {
      const results = await vectorStore.search('task', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should filter by minimum similarity', async () => {
      const results = await vectorStore.search('completely unrelated query xyz123', 10, 0.8);
      expect(results.length).toBe(0);
    });

    it('should search within a specific session', async () => {
      // Create another session with different content
      const otherSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(otherSessionId, 'Other Session');
      
      const itemId = uuidv4();
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        itemId,
        otherSessionId,
        'other_key',
        'authentication in other session'
      );
      
      await vectorStore.storeDocument(itemId, 'other_key: authentication in other session');
      
      // Search only in test session
      const results = await vectorStore.searchInSession(testSessionId, 'authentication', 10, 0.1);
      
      const otherSessionResults = results.filter(r => r.content.includes('other_key'));
      expect(otherSessionResults.length).toBe(0);
    });
  });

  describe('Related documents', () => {
    let docIds: string[] = [];
    
    beforeEach(async () => {
      const items = [
        { key: 'jwt_info', value: 'JWT tokens expire after 24 hours' },
        { key: 'jwt_impl', value: 'Implement JWT token generation and validation' },
        { key: 'session_info', value: 'Session management using Redis' }
      ];
      
      for (const item of items) {
        const itemId = uuidv4();
        db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
          itemId,
          testSessionId,
          item.key,
          item.value
        );
        
        const docId = await vectorStore.storeDocument(itemId, `${item.key}: ${item.value}`);
        docIds.push(docId);
      }
    });

    it('should find related documents', async () => {
      const relatedToJwt = await vectorStore.findRelated(docIds[0], 5, 0.1);
      
      expect(relatedToJwt.length).toBeGreaterThan(0);
      
      // JWT implementation should be related to JWT info
      const jwtImpl = relatedToJwt.find(r => r.content.includes('jwt_impl'));
      expect(jwtImpl).toBeDefined();
    });

    it('should exclude the source document', async () => {
      const related = await vectorStore.findRelated(docIds[0], 10, 0.0);
      
      const self = related.find(r => r.id === docIds[0]);
      expect(self).toBeUndefined();
    });
  });

  describe('Session embedding updates', () => {
    it('should create embeddings for all context items in a session', async () => {
      // Create context items without embeddings
      const items = [
        { id: uuidv4(), key: 'item1', value: 'First item' },
        { id: uuidv4(), key: 'item2', value: 'Second item' },
        { id: uuidv4(), key: 'item3', value: 'Third item' }
      ];
      
      for (const item of items) {
        db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
          item.id,
          testSessionId,
          item.key,
          item.value
        );
      }
      
      const count = await vectorStore.updateSessionEmbeddings(testSessionId);
      expect(count).toBe(3);
      
      // Verify embeddings were created
      const embeddings = db.prepare(
        'SELECT COUNT(*) as count FROM vector_embeddings WHERE content_id IN (?, ?, ?)'
      ).get(items[0].id, items[1].id, items[2].id) as any;
      
      expect(embeddings.count).toBe(3);
    });

    it('should not duplicate embeddings', async () => {
      const itemId = uuidv4();
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        itemId,
        testSessionId,
        'test',
        'value'
      );
      
      // Create embedding
      await vectorStore.storeDocument(itemId, 'test: value');
      
      // Update should not create duplicate
      const count = await vectorStore.updateSessionEmbeddings(testSessionId);
      expect(count).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should return document count', async () => {
      const stats = vectorStore.getStats();
      expect(stats.totalDocuments).toBe(0);
      
      const itemId = uuidv4();
      db.prepare('INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)').run(
        itemId,
        testSessionId,
        'test',
        'value'
      );
      await vectorStore.storeDocument(itemId, 'test: value');
      
      const newStats = vectorStore.getStats();
      expect(newStats.totalDocuments).toBe(1);
    });
  });
});