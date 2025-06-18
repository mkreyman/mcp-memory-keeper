import { 
  Agent, 
  AnalyzerAgent, 
  SynthesizerAgent, 
  AgentCoordinator,
  AgentTask,
  AgentResult
} from '../../utils/agents';
import { KnowledgeGraphManager } from '../../utils/knowledge-graph';
import { VectorStore } from '../../utils/vector-store';
import Database from 'better-sqlite3';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Agents', () => {
  let db: Database.Database;
  let knowledgeGraph: KnowledgeGraphManager;
  let vectorStore: VectorStore;
  let tempDbPath: string;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-agents-${Date.now()}.db`);
    db = new Database(tempDbPath);
    
    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS context_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        priority TEXT DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        attributes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_id TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (subject_id) REFERENCES entities(id),
        FOREIGN KEY (object_id) REFERENCES entities(id)
      );
      
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    knowledgeGraph = new KnowledgeGraphManager(db);
    vectorStore = new VectorStore(db);
    
    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(testSessionId, 'Test Session');
  });

  afterEach(() => {
    db.close();
    try {
      fs.unlinkSync(tempDbPath);
    } catch (e) {
      // Ignore
    }
  });

  describe('AnalyzerAgent', () => {
    let analyzerAgent: AnalyzerAgent;

    beforeEach(() => {
      analyzerAgent = new AnalyzerAgent(db, knowledgeGraph, vectorStore);
      
      // Add test data
      const items = [
        { key: 'task_1', value: 'Implement authentication', category: 'task', priority: 'high' },
        { key: 'task_2', value: 'Write unit tests', category: 'task', priority: 'normal' },
        { key: 'decision_1', value: 'Use JWT tokens', category: 'decision', priority: 'high' },
        { key: 'progress_1', value: 'Completed login form', category: 'progress', priority: 'normal' },
        { key: 'note_1', value: 'Remember to add rate limiting', category: 'note', priority: 'high' },
      ];
      
      for (const item of items) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      }
    });

    it('should analyze patterns in context', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'analyze',
        input: {
          analysisType: 'patterns',
          sessionId: testSessionId
        }
      };

      const result = await analyzerAgent.process(task);

      expect(result.taskId).toBe(task.id);
      expect(result.agentType).toBe('analyzer');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.output.patterns).toBeDefined();
      expect(result.output.patterns.categoryDistribution).toBeDefined();
      expect(result.output.patterns.priorityDistribution).toBeDefined();
      expect(result.output.itemCount).toBe(5);
    });

    it('should analyze relationships', async () => {
      // Add some entities
      const entity1 = knowledgeGraph.createEntity(testSessionId, 'class', 'AuthService');
      const entity2 = knowledgeGraph.createEntity(testSessionId, 'class', 'TokenManager');
      knowledgeGraph.createRelation(testSessionId, entity1.id, 'uses', entity2.id);

      const task: AgentTask = {
        id: uuidv4(),
        type: 'analyze',
        input: {
          analysisType: 'relationships',
          sessionId: testSessionId
        }
      };

      const result = await analyzerAgent.process(task);

      expect(result.output.analysis).toBeDefined();
      expect(result.output.analysis.entityCount).toBeGreaterThan(0);
      expect(result.output.recommendations).toBeDefined();
    });

    it('should analyze trends', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'analyze',
        input: {
          analysisType: 'trends',
          sessionId: testSessionId,
          timeframe: '-7 days'
        }
      };

      const result = await analyzerAgent.process(task);

      expect(result.output.trends).toBeDefined();
      expect(result.output.trends.activityTrend).toBeDefined();
      expect(result.output.summary).toBeDefined();
    });

    it('should perform comprehensive analysis', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'analyze',
        input: {
          analysisType: 'comprehensive',
          sessionId: testSessionId
        }
      };

      const result = await analyzerAgent.process(task);

      expect(result.output.patterns).toBeDefined();
      expect(result.output.relationships).toBeDefined();
      expect(result.output.trends).toBeDefined();
      expect(result.output.overallInsights).toBeDefined();
      expect(result.confidence).toBe(0.9);
    });

    it('should handle unknown analysis type', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'analyze',
        input: {
          analysisType: 'unknown',
          sessionId: testSessionId
        }
      };

      const result = await analyzerAgent.process(task);

      expect(result.output.error).toBeDefined();
      expect(result.confidence).toBe(0);
    });

    it('should filter by categories', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'analyze',
        input: {
          analysisType: 'patterns',
          sessionId: testSessionId,
          categories: ['task']
        }
      };

      const result = await analyzerAgent.process(task);

      expect(result.output.itemCount).toBe(2); // Only 2 tasks
      expect(Object.keys(result.output.patterns.categoryDistribution)).toEqual(['task']);
    });
  });

  describe('SynthesizerAgent', () => {
    let synthesizerAgent: SynthesizerAgent;

    beforeEach(() => {
      synthesizerAgent = new SynthesizerAgent(db, vectorStore);
      
      // Add test data
      const items = [
        { key: 'task_1', value: 'Implement authentication with OAuth2', category: 'task', priority: 'high' },
        { key: 'task_2', value: 'Add rate limiting to API endpoints', category: 'task', priority: 'high' },
        { key: 'decision_1', value: 'Use Redis for session storage', category: 'decision', priority: 'high' },
        { key: 'progress_1', value: 'Completed user registration flow', category: 'progress', priority: 'normal' },
      ];
      
      for (const item of items) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      }
    });

    it('should create summary', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'synthesize',
        input: {
          synthesisType: 'summary',
          sessionId: testSessionId,
          maxLength: 1000
        }
      };

      const result = await synthesizerAgent.process(task);

      expect(result.output.summary).toBeDefined();
      expect(result.output.summary).toContain('Context Summary');
      expect(result.output.itemCount).toBe(4);
      expect(result.output.categories).toContain('task');
      expect(result.output.categories).toContain('decision');
    });

    it('should create summary with category filter', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'synthesize',
        input: {
          synthesisType: 'summary',
          sessionId: testSessionId,
          categories: ['task']
        }
      };

      const result = await synthesizerAgent.process(task);

      expect(result.output.summary).toContain('Current Tasks');
      expect(result.output.categories).toEqual(['task']);
    });

    it('should merge insights', async () => {
      const insights = [
        { patterns: { keywords: ['auth', 'security'] }, themes: ['authentication'] },
        { patterns: { keywords: ['api', 'rate'] }, themes: ['performance'] }
      ];

      const task: AgentTask = {
        id: uuidv4(),
        type: 'synthesize',
        input: {
          synthesisType: 'merge',
          insights
        }
      };

      const result = await synthesizerAgent.process(task);

      expect(result.output.patterns).toBeDefined();
      expect(result.output.overallThemes).toContain('authentication');
      expect(result.output.overallThemes).toContain('performance');
    });

    it('should generate recommendations', async () => {
      const analysisResults = {
        highPriorityCount: 10,
        staleTasks: true,
        contextSize: 1500
      };

      const task: AgentTask = {
        id: uuidv4(),
        type: 'synthesize',
        input: {
          synthesisType: 'recommendations',
          analysisResults
        }
      };

      const result = await synthesizerAgent.process(task);

      expect(result.output.immediate).toBeDefined();
      expect(result.output.shortTerm).toBeDefined();
      expect(result.output.longTerm).toBeDefined();
      expect(result.output.warnings).toBeDefined();
      expect(result.output.warnings).toContain('Context size is large - consider compaction');
    });

    it('should handle unknown synthesis type', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'synthesize',
        input: {
          synthesisType: 'unknown'
        }
      };

      const result = await synthesizerAgent.process(task);

      expect(result.output.error).toBeDefined();
      expect(result.confidence).toBe(0);
    });
  });

  describe('AgentCoordinator', () => {
    let coordinator: AgentCoordinator;
    let analyzerAgent: AnalyzerAgent;
    let synthesizerAgent: SynthesizerAgent;

    beforeEach(() => {
      coordinator = new AgentCoordinator();
      analyzerAgent = new AnalyzerAgent(db, knowledgeGraph, vectorStore);
      synthesizerAgent = new SynthesizerAgent(db, vectorStore);
      
      coordinator.registerAgent(analyzerAgent);
      coordinator.registerAgent(synthesizerAgent);
    });

    it('should delegate to appropriate agent', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'analyze',
        input: {
          analysisType: 'patterns',
          sessionId: testSessionId
        }
      };

      const results = await coordinator.delegate(task);

      expect(results.length).toBe(1);
      expect(results[0].agentType).toBe('analyzer');
    });

    it('should handle no suitable agent', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'unknown' as any,
        input: {}
      };

      const results = await coordinator.delegate(task);

      expect(results.length).toBe(1);
      expect(results[0].output.error).toBeDefined();
      expect(results[0].agentType).toBe('coordinator');
    });

    it('should process task chain', async () => {
      // Add test data
      db.prepare(
        'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), testSessionId, 'test_task', 'Test task description', 'task', 'high');

      const tasks: AgentTask[] = [
        {
          id: uuidv4(),
          type: 'analyze',
          input: {
            analysisType: 'patterns',
            sessionId: testSessionId
          }
        },
        {
          id: uuidv4(),
          type: 'synthesize',
          input: {
            synthesisType: 'recommendations'
          }
        }
      ];

      const results = await coordinator.processChain(tasks);

      expect(results.length).toBe(2);
      expect(results[0].agentType).toBe('analyzer');
      expect(results[1].agentType).toBe('synthesizer');
      expect(results[1].output).toBeDefined(); // Should have used previous output as context
    });

    it('should get best result', async () => {
      const task: AgentTask = {
        id: uuidv4(),
        type: 'analyze',
        input: {
          analysisType: 'patterns',
          sessionId: testSessionId
        }
      };

      await coordinator.delegate(task);
      const best = coordinator.getBestResult(task.id);

      expect(best).toBeDefined();
      expect(best?.agentType).toBe('analyzer');
    });

    it('should get agent capabilities', () => {
      const capabilities = coordinator.getAgentCapabilities();

      expect(capabilities.analyzer).toBeDefined();
      expect(capabilities.synthesizer).toBeDefined();
      expect(capabilities.analyzer.length).toBeGreaterThan(0);
      expect(capabilities.synthesizer.length).toBeGreaterThan(0);
    });
  });

  describe('Agent base class', () => {
    class TestAgent extends Agent {
      async process(task: AgentTask): Promise<AgentResult> {
        return {
          taskId: task.id,
          agentType: this.name,
          output: { test: true },
          confidence: 1.0,
          processingTime: 0
        };
      }
    }

    it('should check if agent can handle task', () => {
      const agent = new TestAgent('test', [
        {
          name: 'test_capability',
          description: 'Test capability',
          inputTypes: ['test'],
          outputTypes: ['result']
        }
      ]);

      expect(agent.canHandle({ id: '1', type: 'test' as any, input: {} })).toBe(true);
      expect(agent.canHandle({ id: '2', type: 'other' as any, input: {} })).toBe(false);
    });

    it('should return agent name', () => {
      const agent = new TestAgent('test-agent', []);
      expect(agent.getName()).toBe('test-agent');
    });
  });
});