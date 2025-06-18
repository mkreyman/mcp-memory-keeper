import { DatabaseManager } from '../../utils/database';
import { VectorStore } from '../../utils/vector-store';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Semantic Search Integration Tests', () => {
  let dbManager: DatabaseManager;
  let vectorStore: VectorStore;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-semantic-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    vectorStore = new VectorStore(db);
    
    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
      testSessionId, 
      'Semantic Search Test',
      'Testing semantic search integration'
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

  describe('context_semantic_search', () => {
    beforeEach(async () => {
      // Create diverse context items
      const items = [
        {
          key: 'auth_implementation',
          value: 'Implemented JWT authentication with refresh tokens. The tokens expire after 24 hours.',
          category: 'progress',
          priority: 'high'
        },
        {
          key: 'database_decision',
          value: 'Decided to use PostgreSQL for the main database due to its JSON support and reliability.',
          category: 'decision',
          priority: 'high'
        },
        {
          key: 'api_design',
          value: 'Designed RESTful API endpoints following OpenAPI 3.0 specification.',
          category: 'task',
          priority: 'normal'
        },
        {
          key: 'security_note',
          value: 'Remember to implement rate limiting on authentication endpoints to prevent brute force attacks.',
          category: 'note',
          priority: 'high'
        },
        {
          key: 'testing_strategy',
          value: 'Unit tests for individual functions, integration tests for API endpoints, and e2e tests for user flows.',
          category: 'decision',
          priority: 'normal'
        },
        {
          key: 'performance_optimization',
          value: 'Added database indexing on user email field to speed up authentication queries.',
          category: 'progress',
          priority: 'normal'
        },
        {
          key: 'bug_fix',
          value: 'Fixed memory leak in WebSocket connection handler by properly cleaning up event listeners.',
          category: 'progress',
          priority: 'high'
        },
        {
          key: 'architecture_pattern',
          value: 'Using Repository pattern for data access layer to abstract database operations.',
          category: 'decision',
          priority: 'normal'
        }
      ];

      for (const item of items) {
        const itemId = uuidv4();
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(itemId, testSessionId, item.key, item.value, item.category, item.priority);
        
        // Create embedding
        await vectorStore.storeDocument(
          itemId,
          `${item.key}: ${item.value}`,
          { key: item.key, category: item.category, priority: item.priority }
        );
      }
    });

    it('should find relevant results for authentication queries', async () => {
      const results = await vectorStore.searchInSession(
        testSessionId,
        'authentication security tokens',
        5,
        0.1
      );

      expect(results.length).toBeGreaterThan(0);
      
      // Should find auth implementation and security note
      const authResults = results.filter(r => 
        r.content.includes('auth_implementation') || 
        r.content.includes('security_note')
      );
      expect(authResults.length).toBeGreaterThanOrEqual(2);
    });

    it('should find relevant results for database queries', async () => {
      const results = await vectorStore.searchInSession(
        testSessionId,
        'database performance optimization',
        5,
        0.1
      );

      expect(results.length).toBeGreaterThan(0);
      
      // Should find database decision and performance optimization
      const dbResults = results.filter(r => 
        r.content.includes('database_decision') || 
        r.content.includes('performance_optimization')
      );
      expect(dbResults.length).toBeGreaterThanOrEqual(1);
    });

    it('should rank results by similarity', async () => {
      const results = await vectorStore.searchInSession(
        testSessionId,
        'JWT token authentication',
        10,
        0.0
      );

      expect(results.length).toBeGreaterThan(0);
      
      // First result should be the auth implementation
      expect(results[0].content).toContain('auth_implementation');
      expect(results[0].similarity).toBeGreaterThan(0.5);
      
      // Results should be ordered by similarity
      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity).toBeLessThanOrEqual(results[i-1].similarity);
      }
    });

    it('should handle queries with no good matches', async () => {
      const results = await vectorStore.searchInSession(
        testSessionId,
        'quantum computing blockchain AI',
        10,
        0.5 // High threshold
      );

      expect(results.length).toBe(0);
    });

    it('should respect metadata in results', async () => {
      const results = await vectorStore.searchInSession(
        testSessionId,
        'important security decisions',
        10,
        0.1
      );

      const resultsWithMetadata = results.filter(r => r.metadata);
      expect(resultsWithMetadata.length).toBeGreaterThan(0);
      
      // Check metadata structure
      const firstWithMeta = resultsWithMetadata[0];
      expect(firstWithMeta.metadata).toHaveProperty('key');
      expect(firstWithMeta.metadata).toHaveProperty('category');
      expect(firstWithMeta.metadata).toHaveProperty('priority');
    });

    it('should handle natural language queries', async () => {
      const naturalQueries = [
        'what did we decide about the database?',
        'how are we handling user authentication?',
        'what testing approach are we using?',
        'any security concerns to remember?'
      ];

      for (const query of naturalQueries) {
        const results = await vectorStore.searchInSession(testSessionId, query, 3, 0.1);
        expect(results.length).toBeGreaterThan(0);
      }
    });

    it('should find conceptually related items', async () => {
      const results = await vectorStore.searchInSession(
        testSessionId,
        'code quality and maintainability',
        5,
        0.1
      );

      // Should find testing strategy and architecture pattern
      const qualityResults = results.filter(r => 
        r.content.includes('testing_strategy') || 
        r.content.includes('architecture_pattern')
      );
      expect(qualityResults.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and edge cases', () => {
    it('should handle large contexts efficiently', async () => {
      // Create many context items
      const itemCount = 100;
      const promises = [];
      
      for (let i = 0; i < itemCount; i++) {
        const itemId = uuidv4();
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(itemId, testSessionId, `item_${i}`, `This is test content number ${i} with some variation`);
        
        promises.push(vectorStore.storeDocument(
          itemId,
          `item_${i}: This is test content number ${i} with some variation`
        ));
      }
      
      await Promise.all(promises);
      
      const startTime = Date.now();
      const results = await vectorStore.searchInSession(testSessionId, 'test content variation', 10, 0.1);
      const endTime = Date.now();
      
      expect(results.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle special characters in queries', async () => {
      const itemId = uuidv4();
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
      ).run(itemId, testSessionId, 'special_chars', 'Using C++ and C# with ASP.NET @decorators');
      
      await vectorStore.storeDocument(itemId, 'special_chars: Using C++ and C# with ASP.NET @decorators');
      
      const results = await vectorStore.searchInSession(testSessionId, 'C++ C# ASP.NET', 3, 0.1);
      expect(results.length).toBe(1);
      expect(results[0].content).toContain('special_chars');
    });

    it('should handle very long queries', async () => {
      const longQuery = 'authentication ' + 'security '.repeat(50) + 'tokens';
      
      const results = await vectorStore.searchInSession(testSessionId, longQuery, 5, 0.05);
      // Long repetitive queries might have lower similarity scores
      // Just verify it doesn't crash and returns an array
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle empty session gracefully', async () => {
      const emptySessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(emptySessionId, 'Empty Session');
      
      const results = await vectorStore.searchInSession(emptySessionId, 'any query', 10, 0.1);
      expect(results).toEqual([]);
    });
  });

  describe('Multi-session search', () => {
    let otherSessionId: string;

    beforeEach(async () => {
      // Create another session with different content
      otherSessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(otherSessionId, 'Other Project');
      
      const items = [
        { key: 'frontend_framework', value: 'Using React with TypeScript for the frontend application' },
        { key: 'state_management', value: 'Redux Toolkit for global state management' }
      ];
      
      for (const item of items) {
        const itemId = uuidv4();
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
        ).run(itemId, otherSessionId, item.key, item.value);
        
        await vectorStore.storeDocument(itemId, `${item.key}: ${item.value}`);
      }
    });

    it('should search across all sessions when not specified', async () => {
      const results = await vectorStore.search('frontend React TypeScript', 10, 0.1);
      
      // Should find results from other session
      const frontendResults = results.filter(r => r.content.includes('frontend_framework'));
      expect(frontendResults.length).toBe(1);
    });

    it('should isolate search to specific session when specified', async () => {
      const results = await vectorStore.searchInSession(
        testSessionId,
        'React Redux frontend',
        10,
        0.1
      );
      
      // Should not find results from other session
      const frontendResults = results.filter(r => 
        r.content.includes('frontend_framework') || 
        r.content.includes('state_management')
      );
      expect(frontendResults.length).toBe(0);
    });
  });
});