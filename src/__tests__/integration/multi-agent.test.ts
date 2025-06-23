import { DatabaseManager } from '../../utils/database';
import { KnowledgeGraphManager } from '../../utils/knowledge-graph';
import { VectorStore } from '../../utils/vector-store';
import { AgentCoordinator, AnalyzerAgent, SynthesizerAgent } from '../../utils/agents';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Multi-Agent System Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let testSessionId: string;
  let knowledgeGraph: KnowledgeGraphManager;
  let vectorStore: VectorStore;
  let agentCoordinator: AgentCoordinator;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-multiagent-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();

    // Initialize components
    knowledgeGraph = new KnowledgeGraphManager(db);
    vectorStore = new VectorStore(db);
    agentCoordinator = new AgentCoordinator();

    // Register agents
    const analyzerAgent = new AnalyzerAgent(db, knowledgeGraph, vectorStore);
    const synthesizerAgent = new SynthesizerAgent(db, vectorStore);
    agentCoordinator.registerAgent(analyzerAgent);
    agentCoordinator.registerAgent(synthesizerAgent);

    // Create test session
    testSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name, description) VALUES (?, ?, ?)').run(
      testSessionId,
      'Multi-Agent Test',
      'Testing multi-agent system'
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

  describe('Pattern Analysis', () => {
    beforeEach(() => {
      // Create diverse test data
      const items = [
        // Tasks
        {
          key: 'implement_auth',
          value: 'Implement OAuth2 authentication flow',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'add_tests',
          value: 'Add unit tests for auth module',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'update_docs',
          value: 'Update API documentation',
          category: 'task',
          priority: 'normal',
        },
        {
          key: 'fix_bug_123',
          value: 'Fix login timeout issue',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'refactor_db',
          value: 'Refactor database connection pool',
          category: 'task',
          priority: 'low',
        },

        // Decisions
        {
          key: 'use_jwt',
          value: 'Use JWT tokens with 24h expiry',
          category: 'decision',
          priority: 'high',
        },
        {
          key: 'db_choice',
          value: 'Use PostgreSQL for main database',
          category: 'decision',
          priority: 'high',
        },
        {
          key: 'cache_strategy',
          value: 'Implement Redis caching for sessions',
          category: 'decision',
          priority: 'normal',
        },

        // Progress
        {
          key: 'login_complete',
          value: 'Completed login form UI',
          category: 'progress',
          priority: 'normal',
        },
        {
          key: 'api_designed',
          value: 'Designed REST API endpoints',
          category: 'progress',
          priority: 'normal',
        },
        {
          key: 'tests_passing',
          value: 'All auth tests passing',
          category: 'progress',
          priority: 'normal',
        },

        // Notes
        {
          key: 'security_note',
          value: 'Remember to add rate limiting',
          category: 'note',
          priority: 'high',
        },
        {
          key: 'performance_tip',
          value: 'Consider connection pooling',
          category: 'note',
          priority: 'normal',
        },
      ];

      for (const item of items) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          item.key,
          item.value,
          item.category,
          item.priority,
          new Date().toISOString()
        );
      }
    });

    it('should analyze patterns and provide insights', async () => {
      const task = {
        id: uuidv4(),
        type: 'analyze' as const,
        input: {
          analysisType: 'patterns',
          sessionId: testSessionId,
        },
      };

      const results = await agentCoordinator.delegate(task);

      expect(results.length).toBe(1);
      expect(results[0].agentType).toBe('analyzer');
      expect(results[0].confidence).toBeGreaterThan(0.7);

      const output = results[0].output;
      expect(output.patterns).toBeDefined();
      expect(output.patterns.categoryDistribution.task).toBe(5);
      expect(output.patterns.categoryDistribution.decision).toBe(3);
      expect(output.patterns.priorityDistribution.high).toBe(6);
      expect(output.insights).toBeInstanceOf(Array);
      expect(output.insights.length).toBeGreaterThan(0);
    });

    it('should filter analysis by categories', async () => {
      const task = {
        id: uuidv4(),
        type: 'analyze' as const,
        input: {
          analysisType: 'patterns',
          sessionId: testSessionId,
          categories: ['task', 'decision'],
        },
      };

      const results = await agentCoordinator.delegate(task);

      const output = results[0].output;
      expect(output.itemCount).toBe(8); // 5 tasks + 3 decisions
      expect(output.patterns.categoryDistribution.progress).toBeUndefined();
      expect(output.patterns.categoryDistribution.note).toBeUndefined();
    });

    it('should analyze temporal patterns', async () => {
      const task = {
        id: uuidv4(),
        type: 'analyze' as const,
        input: {
          analysisType: 'patterns',
          sessionId: testSessionId,
          timeframe: '-7 days',
        },
      };

      const results = await agentCoordinator.delegate(task);

      const output = results[0].output;
      expect(output.patterns.temporalPatterns).toBeDefined();
      expect(output.patterns.temporalPatterns.hourly).toBeDefined();
      expect(output.patterns.temporalPatterns.daily).toBeDefined();
    });
  });

  describe('Relationship Analysis', () => {
    beforeEach(() => {
      // Create entities and relationships
      const authService = knowledgeGraph.createEntity(testSessionId, 'class', 'AuthService');
      const tokenManager = knowledgeGraph.createEntity(testSessionId, 'class', 'TokenManager');
      const userRepo = knowledgeGraph.createEntity(testSessionId, 'class', 'UserRepository');
      const database = knowledgeGraph.createEntity(testSessionId, 'module', 'PostgreSQL');

      knowledgeGraph.createRelation(testSessionId, authService.id, 'uses', tokenManager.id);
      knowledgeGraph.createRelation(testSessionId, authService.id, 'calls', userRepo.id);
      knowledgeGraph.createRelation(testSessionId, userRepo.id, 'connects_to', database.id);
      knowledgeGraph.createRelation(
        testSessionId,
        tokenManager.id,
        'generates',
        authService.id,
        0.8
      );
    });

    it('should analyze entity relationships', async () => {
      const task = {
        id: uuidv4(),
        type: 'analyze' as const,
        input: {
          analysisType: 'relationships',
          sessionId: testSessionId,
        },
      };

      const results = await agentCoordinator.delegate(task);

      const output = results[0].output;
      expect(output.analysis.entityCount).toBe(4);
      expect(output.analysis.relationshipTypes).toBeDefined();
      expect(output.analysis.centralNodes).toBeDefined();
      expect(output.analysis.clusters).toBeDefined();
      expect(output.recommendations).toBeInstanceOf(Array);
    });

    it('should find central nodes in graph', async () => {
      const task = {
        id: uuidv4(),
        type: 'analyze' as const,
        input: {
          analysisType: 'relationships',
          sessionId: testSessionId,
          maxDepth: 3,
        },
      };

      const results = await agentCoordinator.delegate(task);

      const output = results[0].output;
      const centralNodes = output.analysis.centralNodes;
      expect(centralNodes.length).toBeGreaterThan(0);
      expect(centralNodes[0].connections).toBeGreaterThan(0);
    });
  });

  describe('Trend Analysis', () => {
    beforeEach(() => {
      // Create items with different timestamps
      const now = new Date();
      const items = [];

      for (let i = 7; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);

        // Simulate increasing activity
        const itemCount = i === 0 ? 5 : i === 1 ? 4 : 2;
        for (let j = 0; j < itemCount; j++) {
          items.push({
            key: `item_${i}_${j}`,
            value: `Activity on day ${i}`,
            category: j % 2 === 0 ? 'task' : 'progress',
            priority: j === 0 ? 'high' : 'normal',
            created_at: date.toISOString(),
          });
        }
      }

      for (const item of items) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          uuidv4(),
          testSessionId,
          item.key,
          item.value,
          item.category,
          item.priority,
          item.created_at
        );
      }
    });

    it('should analyze activity trends', async () => {
      const task = {
        id: uuidv4(),
        type: 'analyze' as const,
        input: {
          analysisType: 'trends',
          sessionId: testSessionId,
          timeframe: '-7 days',
        },
      };

      const results = await agentCoordinator.delegate(task);

      const output = results[0].output;
      expect(output.trends.activityTrend).toBeDefined();
      expect(output.trends.activityTrend.direction).toBe('increasing');
      expect(output.trends.categoryTrends).toBeDefined();
      expect(output.trends.predictions).toBeDefined();
    });
  });

  describe('Synthesis Operations', () => {
    beforeEach(() => {
      // Add diverse content for synthesis
      const items = [
        {
          key: 'critical_bug',
          value: 'Production server memory leak',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'auth_decision',
          value: 'Implement OAuth2 with Google and GitHub',
          category: 'decision',
          priority: 'high',
        },
        {
          key: 'api_progress',
          value: 'Completed 80% of API endpoints',
          category: 'progress',
          priority: 'normal',
        },
        {
          key: 'deploy_task',
          value: 'Deploy to staging environment',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'test_progress',
          value: 'Test coverage at 85%',
          category: 'progress',
          priority: 'normal',
        },
      ];

      for (const item of items) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      }
    });

    it('should create comprehensive summary', async () => {
      const task = {
        id: uuidv4(),
        type: 'synthesize' as const,
        input: {
          synthesisType: 'summary',
          sessionId: testSessionId,
          maxLength: 2000,
        },
      };

      const results = await agentCoordinator.delegate(task);

      expect(results[0].agentType).toBe('synthesizer');
      const output = results[0].output;
      expect(output.summary).toBeDefined();
      expect(output.summary).toContain('Context Summary');
      expect(output.summary).toContain('Key Decisions');
      expect(output.summary).toContain('Current Tasks');
      expect(output.summary.length).toBeLessThanOrEqual(2000);
    });

    it('should generate actionable recommendations', async () => {
      const analysisResults = {
        highPriorityCount: 3,
        contextSize: 500,
        staleTasks: false,
      };

      const task = {
        id: uuidv4(),
        type: 'synthesize' as const,
        input: {
          synthesisType: 'recommendations',
          analysisResults,
        },
      };

      const results = await agentCoordinator.delegate(task);

      const output = results[0].output;
      expect(output.immediate).toBeDefined();
      expect(output.shortTerm).toBeDefined();
      expect(output.longTerm).toBeDefined();
      expect(output.warnings).toBeDefined();
    });
  });

  describe('Agent Chaining', () => {
    beforeEach(() => {
      // Setup comprehensive test data
      const items = [
        {
          key: 'main_feature',
          value: 'Building real-time chat system',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'tech_decision',
          value: 'Use WebSockets for real-time communication',
          category: 'decision',
          priority: 'high',
        },
        {
          key: 'progress_ws',
          value: 'WebSocket server implementation complete',
          category: 'progress',
          priority: 'normal',
        },
        {
          key: 'security_task',
          value: 'Implement message encryption',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'scale_note',
          value: 'Consider horizontal scaling for chat servers',
          category: 'note',
          priority: 'normal',
        },
      ];

      for (const item of items) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      }
    });

    it('should process analysis then synthesis chain', async () => {
      const tasks = [
        {
          id: uuidv4(),
          type: 'analyze' as const,
          input: {
            analysisType: 'comprehensive',
            sessionId: testSessionId,
          },
        },
        {
          id: uuidv4(),
          type: 'synthesize' as const,
          input: {
            synthesisType: 'recommendations',
          },
        },
      ];

      const results = await agentCoordinator.processChain(tasks);

      expect(results.length).toBe(2);
      expect(results[0].agentType).toBe('analyzer');
      expect(results[1].agentType).toBe('synthesizer');

      // Second task should use first task's output
      expect(results[1].output.immediate).toBeDefined();
      expect(results[1].output.shortTerm).toBeDefined();
      expect(results[1].output.longTerm).toBeDefined();
      expect(results[1].output.warnings).toBeDefined();
      // Should have generated some recommendations
      const totalRecommendations =
        results[1].output.immediate.length +
        results[1].output.shortTerm.length +
        results[1].output.longTerm.length;
      expect(totalRecommendations).toBeGreaterThan(0);
    });
  });

  describe('Comprehensive Analysis', () => {
    it('should perform full system analysis', async () => {
      // Add complex data
      const items = [
        {
          key: 'arch_decision',
          value: 'Microservices architecture with API gateway',
          category: 'decision',
          priority: 'high',
        },
        {
          key: 'auth_task',
          value: 'Implement JWT authentication',
          category: 'task',
          priority: 'high',
        },
        {
          key: 'db_progress',
          value: 'Database schema migration complete',
          category: 'progress',
          priority: 'normal',
        },
        {
          key: 'perf_note',
          value: 'Monitor API response times',
          category: 'note',
          priority: 'high',
        },
      ];

      for (const item of items) {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category, priority) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(uuidv4(), testSessionId, item.key, item.value, item.category, item.priority);
      }

      const task = {
        id: uuidv4(),
        type: 'analyze' as const,
        input: {
          analysisType: 'comprehensive',
          sessionId: testSessionId,
        },
      };

      const results = await agentCoordinator.delegate(task);

      const output = results[0].output;
      expect(output.patterns).toBeDefined();
      expect(output.relationships).toBeDefined();
      expect(output.trends).toBeDefined();
      expect(output.overallInsights).toBeDefined();
      expect(output.overallInsights.length).toBeGreaterThan(0);
      expect(results[0].confidence).toBe(0.9);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid task type gracefully', async () => {
      const task = {
        id: uuidv4(),
        type: 'invalid' as any,
        input: {},
      };

      const results = await agentCoordinator.delegate(task);

      expect(results.length).toBe(1);
      expect(results[0].output.error).toBeDefined();
      expect(results[0].confidence).toBe(0);
    });

    it('should handle missing session gracefully', async () => {
      const task = {
        id: uuidv4(),
        type: 'analyze' as const,
        input: {
          analysisType: 'patterns',
          sessionId: 'non-existent-session',
        },
      };

      const results = await agentCoordinator.delegate(task);

      expect(results[0].output.itemCount).toBe(0);
      expect(results[0].confidence).toBeLessThan(0.8); // Lower confidence with no data
    });
  });
});
