import { DatabaseManager } from '../../utils/database';
import { KnowledgeGraphManager } from '../../utils/knowledge-graph';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('KnowledgeGraphManager', () => {
  let dbManager: DatabaseManager;
  let knowledgeGraph: KnowledgeGraphManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-kg-${Date.now()}.db`);
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
      'Test Session',
      'Testing knowledge graph'
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

  describe('Entity operations', () => {
    it('should create an entity', () => {
      const entity = knowledgeGraph.createEntity(testSessionId, 'file', 'user.model.ts', {
        language: 'typescript',
        size: 1024,
      });

      expect(entity.id).toBeDefined();
      expect(entity.session_id).toBe(testSessionId);
      expect(entity.type).toBe('file');
      expect(entity.name).toBe('user.model.ts');
      expect(entity.attributes).toEqual({ language: 'typescript', size: 1024 });

      // Verify in database
      const saved = db.prepare('SELECT * FROM entities WHERE id = ?').get(entity.id) as any;
      expect(saved).toBeDefined();
      expect(saved.name).toBe('user.model.ts');
    });

    it('should find entity by name', () => {
      const created = knowledgeGraph.createEntity(testSessionId, 'function', 'getUserById');

      const found = knowledgeGraph.findEntity(testSessionId, 'getUserById');
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.type).toBe('function');
    });

    it('should find entity by name and type', () => {
      knowledgeGraph.createEntity(testSessionId, 'function', 'test');
      knowledgeGraph.createEntity(testSessionId, 'class', 'test');

      const func = knowledgeGraph.findEntity(testSessionId, 'test', 'function');
      const cls = knowledgeGraph.findEntity(testSessionId, 'test', 'class');

      expect(func?.type).toBe('function');
      expect(cls?.type).toBe('class');
      expect(func?.id).not.toBe(cls?.id);
    });

    it('should get entities by type', () => {
      knowledgeGraph.createEntity(testSessionId, 'file', 'index.ts');
      knowledgeGraph.createEntity(testSessionId, 'file', 'utils.ts');
      knowledgeGraph.createEntity(testSessionId, 'function', 'main');

      const files = knowledgeGraph.getEntitiesByType(testSessionId, 'file');
      expect(files).toHaveLength(2);
      expect(files.every(f => f.type === 'file')).toBe(true);
    });
  });

  describe('Relation operations', () => {
    it('should create a relation between entities', () => {
      const file = knowledgeGraph.createEntity(testSessionId, 'file', 'user.ts');
      const func = knowledgeGraph.createEntity(testSessionId, 'function', 'createUser');

      const relation = knowledgeGraph.createRelation(
        testSessionId,
        file.id,
        'contains',
        func.id,
        0.9
      );

      expect(relation.subject_id).toBe(file.id);
      expect(relation.object_id).toBe(func.id);
      expect(relation.predicate).toBe('contains');
      expect(relation.confidence).toBe(0.9);
    });

    it('should get relations for an entity', () => {
      const class1 = knowledgeGraph.createEntity(testSessionId, 'class', 'User');
      const class2 = knowledgeGraph.createEntity(testSessionId, 'class', 'BaseModel');
      const interface1 = knowledgeGraph.createEntity(testSessionId, 'interface', 'IUser');

      knowledgeGraph.createRelation(testSessionId, class1.id, 'extends', class2.id);
      knowledgeGraph.createRelation(testSessionId, class1.id, 'implements', interface1.id);

      const subjectRelations = knowledgeGraph.getRelations(class1.id, 'subject');
      expect(subjectRelations).toHaveLength(2);

      const objectRelations = knowledgeGraph.getRelations(class1.id, 'object');
      expect(objectRelations).toHaveLength(0);

      const allRelations = knowledgeGraph.getRelations(class1.id, 'both');
      expect(allRelations).toHaveLength(2);
    });
  });

  describe('Observation operations', () => {
    it('should add observations to entities', () => {
      const entity = knowledgeGraph.createEntity(testSessionId, 'function', 'calculateTotal');

      const _obs1 = knowledgeGraph.addObservation(
        entity.id,
        'Has high cyclomatic complexity',
        'code-analysis'
      );

      const _obs2 = knowledgeGraph.addObservation(
        entity.id,
        'Called 50 times in tests',
        'test-coverage'
      );

      const observations = knowledgeGraph.getObservations(entity.id);
      expect(observations).toHaveLength(2);
      // Check both observations exist, order may vary
      const observationTexts = observations.map(o => o.observation);
      expect(observationTexts).toContain('Called 50 times in tests');
      expect(observationTexts).toContain('Has high cyclomatic complexity');
    });
  });

  describe('Graph traversal', () => {
    it('should find connected entities', () => {
      // Create a simple graph: A -> B -> C
      //                            -> D
      const a = knowledgeGraph.createEntity(testSessionId, 'module', 'A');
      const b = knowledgeGraph.createEntity(testSessionId, 'module', 'B');
      const c = knowledgeGraph.createEntity(testSessionId, 'module', 'C');
      const d = knowledgeGraph.createEntity(testSessionId, 'module', 'D');

      knowledgeGraph.createRelation(testSessionId, a.id, 'imports', b.id);
      knowledgeGraph.createRelation(testSessionId, b.id, 'imports', c.id);
      knowledgeGraph.createRelation(testSessionId, b.id, 'imports', d.id);

      const connected = knowledgeGraph.getConnectedEntities(a.id, 2);
      expect(connected.size).toBe(4); // A, B, C, D

      const connectedDepth1 = knowledgeGraph.getConnectedEntities(a.id, 1);
      expect(connectedDepth1.size).toBe(2); // A, B
    });

    it('should handle circular relationships', () => {
      // Create circular graph: A -> B -> C -> A
      const a = knowledgeGraph.createEntity(testSessionId, 'class', 'A');
      const b = knowledgeGraph.createEntity(testSessionId, 'class', 'B');
      const c = knowledgeGraph.createEntity(testSessionId, 'class', 'C');

      knowledgeGraph.createRelation(testSessionId, a.id, 'uses', b.id);
      knowledgeGraph.createRelation(testSessionId, b.id, 'uses', c.id);
      knowledgeGraph.createRelation(testSessionId, c.id, 'uses', a.id);

      const connected = knowledgeGraph.getConnectedEntities(a.id, 10);
      expect(connected.size).toBe(3); // Should not infinite loop
    });
  });

  describe('Context analysis', () => {
    it('should extract file entities', () => {
      const text = `
        Working on file user.model.ts which imports from auth.service.ts.
        The component called "UserList.tsx" needs to be updated.
      `;

      const analysis = knowledgeGraph.analyzeContext(testSessionId, text);

      expect(analysis.entities).toContainEqual({
        type: 'file',
        name: 'user.model.ts',
        confidence: 0.9,
      });

      expect(analysis.entities).toContainEqual({
        type: 'file',
        name: 'auth.service.ts',
        confidence: 0.9,
      });

      expect(analysis.entities).toContainEqual({
        type: 'file',
        name: 'UserList.tsx',
        confidence: 0.9,
      });
    });

    it('should extract function entities', () => {
      const text = `
        The function getUserById needs refactoring.
        Also, const calculateTotal = (items) => { ... }
        let processData = function() { ... }
      `;

      const analysis = knowledgeGraph.analyzeContext(testSessionId, text);

      const functions = analysis.entities.filter(e => e.type === 'function');
      expect(functions).toHaveLength(3);
      expect(functions.map(f => f.name)).toContain('getUserById');
      expect(functions.map(f => f.name)).toContain('calculateTotal');
      expect(functions.map(f => f.name)).toContain('processData');
    });

    it('should extract class entities', () => {
      const text = `
        class UserModel extends BaseModel { }
        interface IAuthService { }
        type UserRole = 'admin' | 'user';
      `;

      const analysis = knowledgeGraph.analyzeContext(testSessionId, text);

      const classes = analysis.entities.filter(e => e.type === 'class');
      expect(classes.map(c => c.name)).toContain('UserModel');
      expect(classes.map(c => c.name)).toContain('IAuthService');
      expect(classes.map(c => c.name)).toContain('UserRole');
    });

    it('should extract relationships', () => {
      const text = `
        UserService calls validateUser function.
        The AuthModule uses TokenService.
        UserModel implements IUser interface.
      `;

      const analysis = knowledgeGraph.analyzeContext(testSessionId, text);

      expect(analysis.relations).toContainEqual({
        subject: 'UserService',
        predicate: 'calls',
        object: 'validateUser',
        confidence: 0.7,
      });

      expect(analysis.relations).toContainEqual({
        subject: 'UserModel',
        predicate: 'implements',
        object: 'IUser',
        confidence: 0.8,
      });
    });
  });

  describe('Visualization support', () => {
    it('should generate graph data', () => {
      // Create some entities and relations
      const user = knowledgeGraph.createEntity(testSessionId, 'class', 'User');
      const auth = knowledgeGraph.createEntity(testSessionId, 'service', 'AuthService');
      const db = knowledgeGraph.createEntity(testSessionId, 'database', 'UserDB');

      knowledgeGraph.createRelation(testSessionId, auth.id, 'validates', user.id, 0.9);
      knowledgeGraph.createRelation(testSessionId, auth.id, 'queries', db.id, 0.8);

      const graphData = knowledgeGraph.getGraphData(testSessionId);

      expect(graphData.nodes).toHaveLength(3);
      expect(graphData.edges).toHaveLength(2);

      expect(graphData.nodes.map(n => n.name)).toContain('User');
      expect(graphData.nodes.map(n => n.name)).toContain('AuthService');
      expect(graphData.nodes.map(n => n.name)).toContain('UserDB');

      expect(graphData.edges).toContainEqual({
        source: auth.id,
        target: user.id,
        predicate: 'validates',
        confidence: 0.9,
      });
    });

    it('should filter graph data by entity types', () => {
      knowledgeGraph.createEntity(testSessionId, 'class', 'User');
      knowledgeGraph.createEntity(testSessionId, 'class', 'Product');
      knowledgeGraph.createEntity(testSessionId, 'service', 'AuthService');
      knowledgeGraph.createEntity(testSessionId, 'database', 'UserDB');

      const classesOnly = knowledgeGraph.getGraphData(testSessionId, ['class']);
      expect(classesOnly.nodes).toHaveLength(2);
      expect(classesOnly.nodes.every(n => n.type === 'class')).toBe(true);
    });
  });

  describe('Cleanup operations', () => {
    it('should prune orphaned entities', () => {
      // Create entities with relations
      const a = knowledgeGraph.createEntity(testSessionId, 'module', 'A');
      const b = knowledgeGraph.createEntity(testSessionId, 'module', 'B');
      knowledgeGraph.createRelation(testSessionId, a.id, 'imports', b.id);

      // Create orphaned entities
      knowledgeGraph.createEntity(testSessionId, 'module', 'Orphan1');
      knowledgeGraph.createEntity(testSessionId, 'module', 'Orphan2');

      // Entity with observation is not orphaned
      const withObs = knowledgeGraph.createEntity(testSessionId, 'module', 'WithObservation');
      knowledgeGraph.addObservation(withObs.id, 'Important note');

      const pruned = knowledgeGraph.pruneOrphanedEntities(testSessionId);
      expect(pruned).toBe(2); // Orphan1 and Orphan2

      // Verify they were deleted
      const remaining = knowledgeGraph.getEntitiesByType(testSessionId, 'module');
      expect(remaining).toHaveLength(3); // A, B, WithObservation
    });
  });
});
