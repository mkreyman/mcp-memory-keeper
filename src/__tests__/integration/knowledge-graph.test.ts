import { DatabaseManager } from '../../utils/database';
import { KnowledgeGraphManager } from '../../utils/knowledge-graph';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Knowledge Graph Integration Tests', () => {
  let dbManager: DatabaseManager;
  let knowledgeGraph: KnowledgeGraphManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-kg-integration-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    knowledgeGraph = new KnowledgeGraphManager(db);
    
    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
      testSessionId, 
      'KG Integration Test',
      'Testing knowledge graph integration'
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

  describe('context_analyze', () => {
    beforeEach(() => {
      // Add some context items to analyze
      const items = [
        {
          key: 'task_auth',
          value: 'Working on AuthService class that implements authentication using JWT tokens',
          category: 'task'
        },
        {
          key: 'decision_db',
          value: 'UserModel extends BaseModel and uses PostgreSQL database',
          category: 'decision'
        },
        {
          key: 'progress_api',
          value: 'The function validateToken calls checkExpiry and getUserById',
          category: 'progress'
        },
        {
          key: 'note_files',
          value: 'Modified files: auth.service.ts, user.model.ts, and token.utils.ts',
          category: 'note'
        }
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category);
      });
    });

    it('should analyze all context items and extract entities', () => {
      // Simulate context_analyze tool call
      const items = db.prepare('SELECT * FROM context_items WHERE session_id = ?').all(testSessionId) as any[];
      
      let entitiesCreated = 0;
      let relationsCreated = 0;
      
      for (const item of items) {
        const analysis = knowledgeGraph.analyzeContext(testSessionId, item.value);
        
        for (const entityData of analysis.entities) {
          const existing = knowledgeGraph.findEntity(testSessionId, entityData.name, entityData.type);
          if (!existing) {
            knowledgeGraph.createEntity(
              testSessionId,
              entityData.type,
              entityData.name,
              { confidence: entityData.confidence, source: item.key }
            );
            entitiesCreated++;
          }
        }
        
        for (const relationData of analysis.relations) {
          const subject = knowledgeGraph.findEntity(testSessionId, relationData.subject);
          const object = knowledgeGraph.findEntity(testSessionId, relationData.object);
          
          if (subject && object) {
            knowledgeGraph.createRelation(
              testSessionId,
              subject.id,
              relationData.predicate,
              object.id,
              relationData.confidence
            );
            relationsCreated++;
          }
        }
      }

      expect(entitiesCreated).toBeGreaterThan(0);
      
      // Verify specific entities were created
      expect(knowledgeGraph.findEntity(testSessionId, 'AuthService')).toBeDefined();
      expect(knowledgeGraph.findEntity(testSessionId, 'auth.service.ts')).toBeDefined();
      expect(knowledgeGraph.findEntity(testSessionId, 'validateToken')).toBeDefined();
    });

    it('should analyze specific categories only', () => {
      const categories = ['task', 'decision'];
      const items = db.prepare(
        `SELECT * FROM context_items WHERE session_id = ? AND category IN (${categories.map(() => '?').join(',')})`
      ).all(testSessionId, ...categories) as any[];
      
      expect(items).toHaveLength(2);
      
      for (const item of items) {
        const analysis = knowledgeGraph.analyzeContext(testSessionId, item.value);
        expect(analysis.entities.length).toBeGreaterThan(0);
      }
    });
  });

  describe('context_find_related', () => {
    beforeEach(() => {
      // Create a network of entities
      const authService = knowledgeGraph.createEntity(testSessionId, 'class', 'AuthService');
      const userModel = knowledgeGraph.createEntity(testSessionId, 'class', 'UserModel');
      const tokenUtil = knowledgeGraph.createEntity(testSessionId, 'module', 'TokenUtil');
      const database = knowledgeGraph.createEntity(testSessionId, 'database', 'PostgreSQL');
      const validateFunc = knowledgeGraph.createEntity(testSessionId, 'function', 'validateToken');
      
      // Create relations
      knowledgeGraph.createRelation(testSessionId, authService.id, 'uses', userModel.id);
      knowledgeGraph.createRelation(testSessionId, authService.id, 'imports', tokenUtil.id);
      knowledgeGraph.createRelation(testSessionId, userModel.id, 'stores_in', database.id);
      knowledgeGraph.createRelation(testSessionId, authService.id, 'contains', validateFunc.id);
      
      // Add a context item that references AuthService
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value) VALUES (?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'auth_task', 'Working on AuthService authentication');
    });

    it('should find related entities by entity name', () => {
      const entity = knowledgeGraph.findEntity(testSessionId, 'AuthService');
      expect(entity).toBeDefined();
      
      const connected = knowledgeGraph.getConnectedEntities(entity!.id, 2);
      expect(connected.size).toBeGreaterThan(1);
      
      // Should include AuthService and its connections
      const entities = Array.from(connected).map(id => {
        const e = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
        return e.name;
      });
      
      expect(entities).toContain('AuthService');
      expect(entities).toContain('UserModel');
      expect(entities).toContain('TokenUtil');
      expect(entities).toContain('validateToken');
    });

    it('should find related entities by context key', () => {
      const contextItem = db.prepare(
        'SELECT * FROM context_items WHERE session_id = ? AND key = ?'
      ).get(testSessionId, 'auth_task') as any;
      
      expect(contextItem).toBeDefined();
      
      // Extract entity from context
      const analysis = knowledgeGraph.analyzeContext(testSessionId, contextItem.value);
      expect(analysis.entities.length).toBeGreaterThan(0);
      
      const entity = knowledgeGraph.findEntity(testSessionId, 'AuthService');
      expect(entity).toBeDefined();
    });

    it('should filter by relation types', () => {
      const entity = knowledgeGraph.findEntity(testSessionId, 'AuthService');
      const relations = knowledgeGraph.getRelations(entity!.id);
      
      const usesRelations = relations.filter(r => r.predicate === 'uses');
      const importsRelations = relations.filter(r => r.predicate === 'imports');
      
      expect(usesRelations.length).toBeGreaterThan(0);
      expect(importsRelations.length).toBeGreaterThan(0);
    });
  });

  describe('context_visualize', () => {
    beforeEach(() => {
      // Create entities for visualization
      knowledgeGraph.createEntity(testSessionId, 'class', 'User');
      knowledgeGraph.createEntity(testSessionId, 'class', 'Product');
      knowledgeGraph.createEntity(testSessionId, 'service', 'AuthService');
      
      // Create context items with different categories and times
      const now = new Date();
      for (let i = 0; i < 10; i++) {
        const category = ['task', 'decision', 'progress'][i % 3];
        const priority = ['high', 'normal', 'low'][i % 3];
        
        db.prepare(
          `INSERT INTO context_items 
           (id, session_id, key, value, category, priority, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uuidv4(),
          testSessionId,
          `item_${i}`,
          `Test item ${i}`,
          category,
          priority,
          new Date(now.getTime() - i * 3600000).toISOString() // 1 hour apart
        );
      }
    });

    it('should generate graph visualization data', () => {
      const user = knowledgeGraph.findEntity(testSessionId, 'User');
      const auth = knowledgeGraph.findEntity(testSessionId, 'AuthService');
      
      knowledgeGraph.createRelation(testSessionId, auth!.id, 'validates', user!.id);
      
      const graphData = knowledgeGraph.getGraphData(testSessionId);
      
      expect(graphData.nodes.length).toBeGreaterThan(0);
      expect(graphData.edges.length).toBeGreaterThan(0);
      
      // Verify structure
      expect(graphData.nodes[0]).toHaveProperty('id');
      expect(graphData.nodes[0]).toHaveProperty('type');
      expect(graphData.nodes[0]).toHaveProperty('name');
      
      expect(graphData.edges[0]).toHaveProperty('source');
      expect(graphData.edges[0]).toHaveProperty('target');
      expect(graphData.edges[0]).toHaveProperty('predicate');
    });

    it('should generate timeline visualization data', () => {
      const timeline = db.prepare(`
        SELECT 
          strftime('%Y-%m-%d %H:00', created_at) as hour,
          COUNT(*) as events,
          GROUP_CONCAT(DISTINCT category) as categories
        FROM context_items
        WHERE session_id = ?
        GROUP BY hour
        ORDER BY hour DESC
        LIMIT 24
      `).all(testSessionId) as any[];
      
      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline[0]).toHaveProperty('hour');
      expect(timeline[0]).toHaveProperty('events');
      expect(timeline[0]).toHaveProperty('categories');
    });

    it('should generate heatmap visualization data', () => {
      const heatmap = db.prepare(`
        SELECT 
          category,
          priority,
          COUNT(*) as count
        FROM context_items
        WHERE session_id = ?
        GROUP BY category, priority
      `).all(testSessionId) as any[];
      
      expect(heatmap.length).toBeGreaterThan(0);
      expect(heatmap[0]).toHaveProperty('category');
      expect(heatmap[0]).toHaveProperty('priority');
      expect(heatmap[0]).toHaveProperty('count');
      
      // Verify we have data for different category/priority combinations
      const categories = new Set(heatmap.map(h => h.category));
      const priorities = new Set(heatmap.map(h => h.priority));
      
      expect(categories.size).toBeGreaterThanOrEqual(2);
      expect(priorities.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle code analysis workflow', () => {
      // Simulate analyzing a codebase
      const codeContext = [
        'The AuthController class handles authentication endpoints',
        'It uses AuthService which implements IAuthService interface',
        'AuthService calls UserRepository to fetch user data',
        'The validateToken function uses jwt.verify from jsonwebtoken library',
        'Files involved: auth.controller.ts, auth.service.ts, user.repository.ts'
      ];

      // Analyze each piece of context
      const allEntities = new Set<string>();
      const allRelations: any[] = [];
      
      codeContext.forEach(text => {
        const analysis = knowledgeGraph.analyzeContext(testSessionId, text);
        
        analysis.entities.forEach(e => {
          if (!knowledgeGraph.findEntity(testSessionId, e.name, e.type)) {
            knowledgeGraph.createEntity(testSessionId, e.type, e.name);
            allEntities.add(e.name);
          }
        });
        
        analysis.relations.forEach(r => {
          const subject = knowledgeGraph.findEntity(testSessionId, r.subject);
          const object = knowledgeGraph.findEntity(testSessionId, r.object);
          
          if (subject && object) {
            knowledgeGraph.createRelation(
              testSessionId,
              subject.id,
              r.predicate,
              object.id,
              r.confidence
            );
            allRelations.push(r);
          }
        });
      });

      // Verify entities were extracted
      expect(allEntities.size).toBeGreaterThan(5);
      expect(allEntities).toContain('AuthController');
      expect(allEntities).toContain('AuthService');
      expect(allEntities).toContain('auth.controller.ts');
      
      // Verify relationships
      expect(allRelations.length).toBeGreaterThan(0);
      
      // Test finding related entities
      const authService = knowledgeGraph.findEntity(testSessionId, 'AuthService');
      if (authService) {
        const connected = knowledgeGraph.getConnectedEntities(authService.id, 2);
        expect(connected.size).toBeGreaterThan(1);
      }
    });

    it('should maintain graph consistency across operations', () => {
      // Create initial graph
      const module1 = knowledgeGraph.createEntity(testSessionId, 'module', 'CoreModule');
      const module2 = knowledgeGraph.createEntity(testSessionId, 'module', 'UtilsModule');
      const service = knowledgeGraph.createEntity(testSessionId, 'service', 'DataService');
      
      knowledgeGraph.createRelation(testSessionId, module1.id, 'imports', module2.id);
      knowledgeGraph.createRelation(testSessionId, module1.id, 'provides', service.id);
      
      // Add observations
      knowledgeGraph.addObservation(service.id, 'Handles data transformation');
      
      // Verify graph integrity
      const graphData = knowledgeGraph.getGraphData(testSessionId);
      expect(graphData.nodes).toHaveLength(3);
      expect(graphData.edges).toHaveLength(2);
      
      // Test pruning doesn't remove entities with relations
      const pruned = knowledgeGraph.pruneOrphanedEntities(testSessionId);
      expect(pruned).toBe(0);
      
      // All entities should still exist
      expect(knowledgeGraph.findEntity(testSessionId, 'CoreModule')).toBeDefined();
      expect(knowledgeGraph.findEntity(testSessionId, 'UtilsModule')).toBeDefined();
      expect(knowledgeGraph.findEntity(testSessionId, 'DataService')).toBeDefined();
    });
  });
});