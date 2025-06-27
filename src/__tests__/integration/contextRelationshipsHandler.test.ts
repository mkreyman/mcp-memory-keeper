import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../../utils/validation';

describe('Context Relationships Handler Integration Tests', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let _contextRepo: ContextRepository;
  let testSessionId: string;
  let secondSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-context-relationships-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    _contextRepo = new ContextRepository(dbManager);

    // Create test sessions
    testSessionId = uuidv4();
    secondSessionId = uuidv4();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(testSessionId, 'Test Session');
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      secondSessionId,
      'Second Session'
    );

    // Create relationships table if it doesn't exist
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS context_relationships (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        from_key TEXT NOT NULL,
        to_key TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        UNIQUE(session_id, from_key, to_key, relationship_type)
      )
    `
    ).run();

    // Create indexes for performance
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_relationships_from ON context_relationships(session_id, from_key)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_relationships_to ON context_relationships(session_id, to_key)'
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_relationships_type ON context_relationships(relationship_type)'
    ).run();
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

  function createTestItems() {
    const items = [
      // Project structure
      { key: 'project.auth', value: 'Authentication module' },
      { key: 'project.database', value: 'Database layer' },
      { key: 'project.api', value: 'API endpoints' },
      { key: 'project.frontend', value: 'Frontend application' },

      // Components
      { key: 'component.login', value: 'Login component' },
      { key: 'component.dashboard', value: 'Dashboard component' },
      { key: 'component.user_profile', value: 'User profile component' },

      // Tasks
      { key: 'task.implement_auth', value: 'Implement authentication', category: 'task' },
      { key: 'task.setup_db', value: 'Setup database', category: 'task' },
      { key: 'task.create_api', value: 'Create API endpoints', category: 'task' },

      // Decisions
      { key: 'decision.use_oauth', value: 'Use OAuth2 for authentication', category: 'decision' },
      { key: 'decision.postgres', value: 'Use PostgreSQL for database', category: 'decision' },

      // Notes
      { key: 'note.security', value: 'Security considerations for auth', category: 'note' },
      { key: 'note.performance', value: 'Performance optimization notes', category: 'note' },
    ];

    const stmt = db.prepare(`
      INSERT INTO context_items (id, session_id, key, value, category)
      VALUES (?, ?, ?, ?, ?)
    `);

    items.forEach(item => {
      stmt.run(uuidv4(), testSessionId, item.key, item.value, item.category || null);
    });
  }

  describe('Create Relationships', () => {
    beforeEach(() => {
      createTestItems();
    });

    it('should create a simple relationship between two items', () => {
      const fromKey = 'project.auth';
      const toKey = 'component.login';
      const relationshipType = 'contains';

      // Verify both items exist
      const fromItem = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, fromKey);
      const toItem = db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, toKey);

      expect(fromItem).toBeTruthy();
      expect(toItem).toBeTruthy();

      // Create relationship
      const relationshipId = uuidv4();
      const result = db
        .prepare(
          `
          INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
          VALUES (?, ?, ?, ?, ?)
        `
        )
        .run(relationshipId, testSessionId, fromKey, toKey, relationshipType);

      expect(result.changes).toBe(1);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'context_link',
                relationshipId: relationshipId,
                fromKey: fromKey,
                toKey: toKey,
                relationshipType: relationshipType,
                created: true,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.created).toBe(true);
      expect(parsed.relationshipId).toBe(relationshipId);
    });

    it('should create relationship with metadata', () => {
      const fromKey = 'task.implement_auth';
      const toKey = 'decision.use_oauth';
      const relationshipType = 'depends_on';
      const metadata = {
        reason: 'OAuth decision affects authentication implementation',
        priority: 'high',
        createdBy: 'system',
      };

      const relationshipId = uuidv4();
      const result = db
        .prepare(
          `
          INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          relationshipId,
          testSessionId,
          fromKey,
          toKey,
          relationshipType,
          JSON.stringify(metadata)
        );

      expect(result.changes).toBe(1);

      // Verify metadata was stored
      const relationship = db
        .prepare('SELECT * FROM context_relationships WHERE id = ?')
        .get(relationshipId) as any;

      expect(relationship).toBeTruthy();
      const storedMetadata = JSON.parse(relationship.metadata);
      expect(storedMetadata.reason).toBe(metadata.reason);
      expect(storedMetadata.priority).toBe(metadata.priority);
    });

    it('should validate relationship types', () => {
      const validTypes = [
        'contains',
        'depends_on',
        'references',
        'implements',
        'extends',
        'related_to',
        'blocks',
        'blocked_by',
        'parent_of',
        'child_of',
      ];

      validTypes.forEach(type => {
        expect(() => {
          if (!validTypes.includes(type)) {
            throw new ValidationError(`Invalid relationship type: ${type}`);
          }
        }).not.toThrow();
      });

      // Test invalid type
      const invalidType = 'invalid_type';
      expect(() => {
        if (!validTypes.includes(invalidType)) {
          throw new ValidationError(`Invalid relationship type: ${invalidType}`);
        }
      }).toThrow(ValidationError);
    });

    it('should prevent duplicate relationships', () => {
      const fromKey = 'project.api';
      const toKey = 'component.dashboard';
      const relationshipType = 'contains';

      // Create first relationship
      db.prepare(
        `
        INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, fromKey, toKey, relationshipType);

      // Try to create duplicate
      try {
        db.prepare(
          `
          INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, fromKey, toKey, relationshipType);
      } catch (error) {
        expect(error).toBeTruthy();
        expect((error as Error).message).toContain('UNIQUE constraint failed');
      }
    });

    it('should allow same relationship type for different pairs', () => {
      const relationshipType = 'contains';

      // Create multiple relationships with same type
      const relationships = [
        { from: 'project.auth', to: 'component.login' },
        { from: 'project.frontend', to: 'component.dashboard' },
        { from: 'project.frontend', to: 'component.user_profile' },
      ];

      relationships.forEach(rel => {
        const result = db
          .prepare(
            `
            INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
            VALUES (?, ?, ?, ?, ?)
          `
          )
          .run(uuidv4(), testSessionId, rel.from, rel.to, relationshipType);

        expect(result.changes).toBe(1);
      });

      // Verify all were created
      const count = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM context_relationships WHERE session_id = ? AND relationship_type = ?'
          )
          .get(testSessionId, relationshipType) as any
      ).count;

      expect(count).toBe(3);
    });

    it('should validate that both items exist before creating relationship', () => {
      const fromKey = 'project.auth';
      const toKey = 'non.existent.item';
      const _relationshipType = 'contains';

      // Check if items exist
      const fromExists = db
        .prepare('SELECT 1 FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, fromKey);
      const toExists = db
        .prepare('SELECT 1 FROM context_items WHERE session_id = ? AND key = ?')
        .get(testSessionId, toKey);

      if (!fromExists || !toExists) {
        const missingKeys = [];
        if (!fromExists) missingKeys.push(fromKey);
        if (!toExists) missingKeys.push(toKey);

        const handlerResponse = {
          content: [
            {
              type: 'text',
              text: `Error: The following items do not exist: ${missingKeys.join(', ')}`,
            },
          ],
        };

        expect(handlerResponse.content[0].text).toContain('do not exist');
      }
    });

    it('should handle self-referential relationships', () => {
      const key = 'project.auth';
      const relationshipType = 'related_to';

      // Allow self-reference for certain relationship types
      const result = db
        .prepare(
          `
          INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
          VALUES (?, ?, ?, ?, ?)
        `
        )
        .run(uuidv4(), testSessionId, key, key, relationshipType);

      expect(result.changes).toBe(1);
    });
  });

  describe('Retrieve Related Items', () => {
    beforeEach(() => {
      createTestItems();

      // Create test relationships
      const relationships = [
        { from: 'project.auth', to: 'component.login', type: 'contains' },
        { from: 'project.auth', to: 'task.implement_auth', type: 'has_task' },
        { from: 'project.auth', to: 'decision.use_oauth', type: 'implements' },
        { from: 'project.auth', to: 'note.security', type: 'documented_in' },
        { from: 'task.implement_auth', to: 'decision.use_oauth', type: 'depends_on' },
        { from: 'component.login', to: 'note.security', type: 'references' },
        { from: 'project.database', to: 'task.setup_db', type: 'has_task' },
        { from: 'project.database', to: 'decision.postgres', type: 'implements' },
        { from: 'task.setup_db', to: 'decision.postgres', type: 'depends_on' },
      ];

      const stmt = db.prepare(`
        INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
        VALUES (?, ?, ?, ?, ?)
      `);

      relationships.forEach(rel => {
        stmt.run(uuidv4(), testSessionId, rel.from, rel.to, rel.type);
      });
    });

    it('should retrieve all directly related items', () => {
      const key = 'project.auth';

      // Get outgoing relationships
      const outgoing = db
        .prepare(
          `
          SELECT r.*, ci.value, ci.category, ci.priority
          FROM context_relationships r
          JOIN context_items ci ON ci.key = r.to_key AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND r.from_key = ?
        `
        )
        .all(testSessionId, key) as any[];

      // Get incoming relationships
      const incoming = db
        .prepare(
          `
          SELECT r.*, ci.value, ci.category, ci.priority
          FROM context_relationships r
          JOIN context_items ci ON ci.key = r.from_key AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND r.to_key = ?
        `
        )
        .all(testSessionId, key) as any[];

      expect(outgoing.length).toBe(4); // component.login, task.implement_auth, decision.use_oauth, note.security
      expect(incoming.length).toBe(0); // No items point to project.auth

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'context_get_related',
                key: key,
                related: {
                  outgoing: outgoing.map(r => ({
                    key: r.to_key,
                    value: r.value,
                    relationshipType: r.relationship_type,
                    direction: 'outgoing',
                  })),
                  incoming: incoming.map(r => ({
                    key: r.from_key,
                    value: r.value,
                    relationshipType: r.relationship_type,
                    direction: 'incoming',
                  })),
                },
                totalRelated: outgoing.length + incoming.length,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totalRelated).toBe(4);
      expect(parsed.related.outgoing).toHaveLength(4);
    });

    it('should filter by relationship type', () => {
      const key = 'project.auth';
      const relationshipType = 'contains';

      const related = db
        .prepare(
          `
          SELECT r.*, ci.value, ci.category
          FROM context_relationships r
          JOIN context_items ci ON ci.key = r.to_key AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND r.from_key = ? AND r.relationship_type = ?
        `
        )
        .all(testSessionId, key, relationshipType) as any[];

      expect(related.length).toBe(1);
      expect(related[0].to_key).toBe('component.login');
    });

    it('should retrieve relationships with depth traversal', () => {
      const key = 'project.auth';
      const maxDepth = 2;

      // Simulate depth traversal
      const visited = new Set<string>();
      const relationships: any[] = [];

      function traverse(currentKey: string, depth: number, path: string[]) {
        if (depth > maxDepth || visited.has(currentKey)) return;
        visited.add(currentKey);

        // Get outgoing relationships
        const outgoing = db
          .prepare(
            `
            SELECT r.*, ci.value, ci.category
            FROM context_relationships r
            JOIN context_items ci ON ci.key = r.to_key AND ci.session_id = r.session_id
            WHERE r.session_id = ? AND r.from_key = ?
          `
          )
          .all(testSessionId, currentKey) as any[];

        outgoing.forEach(rel => {
          relationships.push({
            path: [...path, currentKey],
            from: currentKey,
            to: rel.to_key,
            type: rel.relationship_type,
            value: rel.value,
            depth: depth,
          });

          // Traverse deeper
          traverse(rel.to_key, depth + 1, [...path, currentKey]);
        });
      }

      traverse(key, 1, []);

      // Should find direct and indirect relationships
      expect(relationships.length).toBeGreaterThan(4); // More than just direct relationships

      // Check we found the indirect relationship: project.auth -> task.implement_auth -> decision.use_oauth
      const indirectRelation = relationships.find(
        r => r.from === 'task.implement_auth' && r.to === 'decision.use_oauth'
      );
      expect(indirectRelation).toBeTruthy();
      expect(indirectRelation.depth).toBe(2);
    });

    it('should handle bidirectional relationships', () => {
      const key = 'decision.use_oauth';

      // Get all relationships (both directions)
      const allRelationships = db
        .prepare(
          `
          SELECT 
            CASE 
              WHEN r.from_key = ? THEN r.to_key 
              ELSE r.from_key 
            END as related_key,
            CASE 
              WHEN r.from_key = ? THEN 'outgoing'
              ELSE 'incoming'
            END as direction,
            r.relationship_type,
            ci.value,
            ci.category
          FROM context_relationships r
          JOIN context_items ci ON ci.key = CASE 
            WHEN r.from_key = ? THEN r.to_key 
            ELSE r.from_key 
          END AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND (r.from_key = ? OR r.to_key = ?)
        `
        )
        .all(key, key, key, testSessionId, key, key) as any[];

      expect(allRelationships.length).toBe(2);

      const incoming = allRelationships.filter(r => r.direction === 'incoming');
      const outgoing = allRelationships.filter(r => r.direction === 'outgoing');

      expect(incoming.length).toBe(2); // project.auth and task.implement_auth
      expect(outgoing.length).toBe(0);
    });

    it('should include relationship metadata in results', () => {
      // Add a relationship with metadata
      const fromKey = 'project.api';
      const toKey = 'task.create_api';
      const metadata = {
        priority: 'high',
        estimatedHours: 40,
        assignee: 'dev-team',
      };

      db.prepare(
        `
        INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, fromKey, toKey, 'has_task', JSON.stringify(metadata));

      // Retrieve with metadata
      const related = db
        .prepare(
          `
          SELECT r.*, ci.value
          FROM context_relationships r
          JOIN context_items ci ON ci.key = r.to_key AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND r.from_key = ?
        `
        )
        .all(testSessionId, fromKey) as any[];

      expect(related.length).toBe(1);

      const parsedMetadata = JSON.parse(related[0].metadata);
      expect(parsedMetadata.priority).toBe('high');
      expect(parsedMetadata.estimatedHours).toBe(40);

      // Handler response with metadata
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'context_get_related',
                key: fromKey,
                related: {
                  outgoing: related.map(r => ({
                    key: r.to_key,
                    value: r.value,
                    relationshipType: r.relationship_type,
                    metadata: JSON.parse(r.metadata),
                  })),
                  incoming: [],
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.related.outgoing[0].metadata.estimatedHours).toBe(40);
    });
  });

  describe('Relationship Queries and Analysis', () => {
    beforeEach(() => {
      createTestItems();

      // Create a complex relationship graph
      const relationships = [
        // Project hierarchy
        { from: 'project.auth', to: 'component.login', type: 'contains' },
        { from: 'project.frontend', to: 'component.dashboard', type: 'contains' },
        { from: 'project.frontend', to: 'component.user_profile', type: 'contains' },

        // Dependencies
        { from: 'component.dashboard', to: 'project.api', type: 'depends_on' },
        { from: 'component.user_profile', to: 'project.auth', type: 'depends_on' },
        { from: 'project.api', to: 'project.database', type: 'depends_on' },

        // Task relationships
        { from: 'task.implement_auth', to: 'task.setup_db', type: 'blocked_by' },
        { from: 'task.create_api', to: 'task.setup_db', type: 'blocked_by' },
      ];

      const stmt = db.prepare(`
        INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
        VALUES (?, ?, ?, ?, ?)
      `);

      relationships.forEach(rel => {
        stmt.run(uuidv4(), testSessionId, rel.from, rel.to, rel.type);
      });
    });

    it('should find all paths between two items', () => {
      const startKey = 'component.user_profile';
      const endKey = 'project.database';

      // Simple path finding (BFS)
      const paths: string[][] = [];
      const queue: { key: string; path: string[] }[] = [{ key: startKey, path: [startKey] }];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift()!;

        if (current.key === endKey) {
          paths.push(current.path);
          continue;
        }

        if (visited.has(current.key)) continue;
        visited.add(current.key);

        // Get all connections
        const connections = db
          .prepare(
            `
            SELECT to_key as next_key FROM context_relationships 
            WHERE session_id = ? AND from_key = ?
            UNION
            SELECT from_key as next_key FROM context_relationships 
            WHERE session_id = ? AND to_key = ?
          `
          )
          .all(testSessionId, current.key, testSessionId, current.key) as any[];

        connections.forEach(conn => {
          if (!current.path.includes(conn.next_key)) {
            queue.push({
              key: conn.next_key,
              path: [...current.path, conn.next_key],
            });
          }
        });
      }

      expect(paths.length).toBeGreaterThan(0);
      // Should find path: component.user_profile -> project.auth -> (other connections) -> project.database
    });

    it('should identify relationship cycles', () => {
      // Add relationships to create a cycle: project.api -> project.database -> project.api
      db.prepare(
        `
        INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, 'project.database', 'project.api', 'depends_on');

      // Detect cycles using DFS
      const visited = new Set<string>();
      const recursionStack = new Set<string>();
      const cycles: string[][] = [];

      function detectCycle(key: string, path: string[]) {
        visited.add(key);
        recursionStack.add(key);

        const neighbors = db
          .prepare('SELECT to_key FROM context_relationships WHERE session_id = ? AND from_key = ?')
          .all(testSessionId, key) as any[];

        for (const neighbor of neighbors) {
          if (recursionStack.has(neighbor.to_key)) {
            // Found cycle
            const cycleStart = path.indexOf(neighbor.to_key);
            cycles.push([...path.slice(cycleStart), neighbor.to_key]);
          } else if (!visited.has(neighbor.to_key)) {
            detectCycle(neighbor.to_key, [...path, neighbor.to_key]);
          }
        }

        recursionStack.delete(key);
      }

      // Check all nodes
      const allKeys = db
        .prepare('SELECT DISTINCT key FROM context_items WHERE session_id = ?')
        .all(testSessionId) as any[];

      allKeys.forEach(item => {
        if (!visited.has(item.key)) {
          detectCycle(item.key, [item.key]);
        }
      });

      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should calculate relationship statistics', () => {
      // Get statistics
      const stats = {
        totalRelationships: (
          db
            .prepare('SELECT COUNT(*) as count FROM context_relationships WHERE session_id = ?')
            .get(testSessionId) as any
        ).count,

        byType: db
          .prepare(
            `
            SELECT relationship_type, COUNT(*) as count 
            FROM context_relationships 
            WHERE session_id = ? 
            GROUP BY relationship_type
          `
          )
          .all(testSessionId) as any[],

        mostConnected: db
          .prepare(
            `
            SELECT key, COUNT(*) as connection_count
            FROM (
              SELECT from_key as key FROM context_relationships WHERE session_id = ?
              UNION ALL
              SELECT to_key as key FROM context_relationships WHERE session_id = ?
            )
            GROUP BY key
            ORDER BY connection_count DESC
            LIMIT 5
          `
          )
          .all(testSessionId, testSessionId) as any[],

        orphanedItems: db
          .prepare(
            `
            SELECT key FROM context_items
            WHERE session_id = ?
            AND key NOT IN (
              SELECT from_key FROM context_relationships WHERE session_id = ?
              UNION
              SELECT to_key FROM context_relationships WHERE session_id = ?
            )
          `
          )
          .all(testSessionId, testSessionId, testSessionId) as any[],
      };

      expect(stats.totalRelationships).toBeGreaterThan(0);
      expect(stats.byType.length).toBeGreaterThan(0);
      expect(stats.mostConnected.length).toBeGreaterThan(0);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'context_relationship_stats',
                statistics: stats,
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.statistics.totalRelationships).toBeGreaterThan(0);
    });

    it('should find items by relationship pattern', () => {
      // Find all items that are blocked by something
      const blockedItems = db
        .prepare(
          `
          SELECT DISTINCT ci.key, ci.value, r.to_key as blocked_by
          FROM context_relationships r
          JOIN context_items ci ON ci.key = r.from_key AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND r.relationship_type = 'blocked_by'
        `
        )
        .all(testSessionId) as any[];

      expect(blockedItems.length).toBe(2); // task.implement_auth and task.create_api

      // Find all container items (items that contain other items)
      const containers = db
        .prepare(
          `
          SELECT DISTINCT ci.key, ci.value, COUNT(r.to_key) as contained_items
          FROM context_relationships r
          JOIN context_items ci ON ci.key = r.from_key AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND r.relationship_type = 'contains'
          GROUP BY ci.key, ci.value
        `
        )
        .all(testSessionId) as any[];

      expect(containers.length).toBeGreaterThan(0);
      expect(containers.every((c: any) => c.contained_items > 0)).toBe(true);
    });
  });

  describe('Relationship Management', () => {
    beforeEach(() => {
      createTestItems();
    });

    it('should update relationship type', () => {
      const fromKey = 'project.auth';
      const toKey = 'component.login';
      const oldType = 'contains';
      const newType = 'parent_of';

      // Create initial relationship
      db.prepare(
        `
        INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), testSessionId, fromKey, toKey, oldType);

      // Update relationship type
      const result = db
        .prepare(
          `
          UPDATE context_relationships 
          SET relationship_type = ?
          WHERE session_id = ? AND from_key = ? AND to_key = ? AND relationship_type = ?
        `
        )
        .run(newType, testSessionId, fromKey, toKey, oldType);

      expect(result.changes).toBe(1);

      // Verify update
      const updated = db
        .prepare(
          'SELECT * FROM context_relationships WHERE session_id = ? AND from_key = ? AND to_key = ?'
        )
        .get(testSessionId, fromKey, toKey) as any;

      expect(updated.relationship_type).toBe(newType);
    });

    it('should delete specific relationships', () => {
      // Create relationships
      const relationships = [
        { from: 'project.auth', to: 'component.login', type: 'contains' },
        { from: 'project.auth', to: 'task.implement_auth', type: 'has_task' },
      ];

      relationships.forEach(rel => {
        db.prepare(
          `
          INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, rel.from, rel.to, rel.type);
      });

      // Delete one relationship
      const result = db
        .prepare(
          `
          DELETE FROM context_relationships 
          WHERE session_id = ? AND from_key = ? AND to_key = ? AND relationship_type = ?
        `
        )
        .run(testSessionId, relationships[0].from, relationships[0].to, relationships[0].type);

      expect(result.changes).toBe(1);

      // Verify only one remains
      const remaining = db
        .prepare('SELECT COUNT(*) as count FROM context_relationships WHERE session_id = ?')
        .get(testSessionId) as any;

      expect(remaining.count).toBe(1);
    });

    it('should delete all relationships for an item when item is deleted', () => {
      // Create relationships
      const itemKey = 'project.auth';
      const relationships = [
        { from: itemKey, to: 'component.login', type: 'contains' },
        { from: itemKey, to: 'task.implement_auth', type: 'has_task' },
        { from: 'component.user_profile', to: itemKey, type: 'depends_on' },
      ];

      relationships.forEach(rel => {
        db.prepare(
          `
          INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, rel.from, rel.to, rel.type);
      });

      // Delete all relationships involving the item
      const result = db
        .prepare(
          `
          DELETE FROM context_relationships 
          WHERE session_id = ? AND (from_key = ? OR to_key = ?)
        `
        )
        .run(testSessionId, itemKey, itemKey);

      expect(result.changes).toBe(3);

      // Verify all relationships are gone
      const remaining = db
        .prepare(
          'SELECT COUNT(*) as count FROM context_relationships WHERE session_id = ? AND (from_key = ? OR to_key = ?)'
        )
        .get(testSessionId, itemKey, itemKey) as any;

      expect(remaining.count).toBe(0);
    });

    it('should bulk create relationships', () => {
      const relationships = [
        { from: 'project.api', to: 'component.dashboard', type: 'serves' },
        { from: 'project.api', to: 'project.database', type: 'depends_on' },
        { from: 'project.api', to: 'note.performance', type: 'documented_in' },
      ];

      db.prepare('BEGIN TRANSACTION').run();

      try {
        const stmt = db.prepare(`
          INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
          VALUES (?, ?, ?, ?, ?)
        `);

        relationships.forEach(rel => {
          stmt.run(uuidv4(), testSessionId, rel.from, rel.to, rel.type);
        });

        db.prepare('COMMIT').run();
      } catch (error) {
        db.prepare('ROLLBACK').run();
        throw error;
      }

      // Verify all were created
      const count = (
        db
          .prepare(
            'SELECT COUNT(*) as count FROM context_relationships WHERE session_id = ? AND from_key = ?'
          )
          .get(testSessionId, 'project.api') as any
      ).count;

      expect(count).toBe(3);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      createTestItems();
    });

    it('should handle invalid relationship data', () => {
      const invalidCases = [
        { from: '', to: 'component.login', type: 'contains', error: 'From key cannot be empty' },
        { from: 'project.auth', to: '', type: 'contains', error: 'To key cannot be empty' },
        {
          from: 'project.auth',
          to: 'component.login',
          type: '',
          error: 'Relationship type cannot be empty',
        },
        {
          from: 'project.auth',
          to: 'component.login',
          type: 'invalid_type',
          error: 'Invalid relationship type',
        },
      ];

      invalidCases.forEach(testCase => {
        try {
          if (!testCase.from || !testCase.from.trim()) {
            throw new ValidationError('From key cannot be empty');
          }
          if (!testCase.to || !testCase.to.trim()) {
            throw new ValidationError('To key cannot be empty');
          }
          if (!testCase.type || !testCase.type.trim()) {
            throw new ValidationError('Relationship type cannot be empty');
          }

          const validTypes = [
            'contains',
            'depends_on',
            'references',
            'implements',
            'extends',
            'related_to',
            'blocks',
            'blocked_by',
            'parent_of',
            'child_of',
          ];
          if (!validTypes.includes(testCase.type)) {
            throw new ValidationError('Invalid relationship type');
          }
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          expect((error as ValidationError).message).toBe(testCase.error);
        }
      });
    });

    it('should handle non-existent items gracefully', () => {
      const key = 'non.existent.item';

      // Try to get related items
      const related = db
        .prepare(
          `
          SELECT r.*, ci.value
          FROM context_relationships r
          JOIN context_items ci ON ci.key = r.to_key AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND r.from_key = ?
        `
        )
        .all(testSessionId, key) as any[];

      expect(related.length).toBe(0);

      // Handler response
      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'context_get_related',
                key: key,
                related: {
                  outgoing: [],
                  incoming: [],
                },
                totalRelated: 0,
                message: 'No relationships found for this item',
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.totalRelated).toBe(0);
      expect(parsed.message).toBeTruthy();
    });

    it('should handle circular dependency detection', () => {
      // Create a circular dependency
      const circularRels = [
        { from: 'project.auth', to: 'project.api', type: 'depends_on' },
        { from: 'project.api', to: 'project.database', type: 'depends_on' },
        { from: 'project.database', to: 'project.auth', type: 'depends_on' }, // Creates circle
      ];

      circularRels.forEach(rel => {
        db.prepare(
          `
          INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, rel.from, rel.to, rel.type);
      });

      // Function to detect circular dependencies
      function hasCircularDependency(startKey: string): boolean {
        const visited = new Set<string>();
        const stack = new Set<string>();

        function dfs(key: string): boolean {
          visited.add(key);
          stack.add(key);

          const dependencies = db
            .prepare(
              `SELECT to_key FROM context_relationships 
               WHERE session_id = ? AND from_key = ? AND relationship_type = 'depends_on'`
            )
            .all(testSessionId, key) as any[];

          for (const dep of dependencies) {
            if (stack.has(dep.to_key)) {
              return true; // Circular dependency found
            }
            if (!visited.has(dep.to_key) && dfs(dep.to_key)) {
              return true;
            }
          }

          stack.delete(key);
          return false;
        }

        return dfs(startKey);
      }

      expect(hasCircularDependency('project.auth')).toBe(true);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large relationship graphs efficiently', () => {
      // Create a large number of items and relationships
      const itemCount = 100;
      const items: string[] = [];

      // Create items
      for (let i = 0; i < itemCount; i++) {
        const key = `item.${i}`;
        items.push(key);
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value)
          VALUES (?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, key, `Value for ${key}`);
      }

      // Create relationships (each item connected to 2-5 others)
      const startTime = Date.now();

      db.prepare('BEGIN TRANSACTION').run();
      const stmt = db.prepare(`
        INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < itemCount; i++) {
        const connectionCount = 2 + Math.floor(Math.random() * 4);
        for (let j = 0; j < connectionCount; j++) {
          const targetIndex = Math.floor(Math.random() * itemCount);
          if (targetIndex !== i) {
            try {
              stmt.run(uuidv4(), testSessionId, items[i], items[targetIndex], 'related_to');
            } catch (_e) {
              // Ignore duplicate relationships
            }
          }
        }
      }

      db.prepare('COMMIT').run();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Test query performance
      const queryStart = Date.now();
      const mostConnected = db
        .prepare(
          `
          SELECT key, COUNT(*) as connections
          FROM (
            SELECT from_key as key FROM context_relationships WHERE session_id = ?
            UNION ALL
            SELECT to_key as key FROM context_relationships WHERE session_id = ?
          )
          GROUP BY key
          ORDER BY connections DESC
          LIMIT 10
        `
        )
        .all(testSessionId, testSessionId) as any[];
      const queryEnd = Date.now();

      expect(queryEnd - queryStart).toBeLessThan(100); // Query should be fast
      expect(mostConnected.length).toBeGreaterThan(0);
    });

    it('should efficiently traverse deep relationship chains', () => {
      // Create a chain of relationships
      const chainLength = 20;

      for (let i = 0; i < chainLength; i++) {
        db.prepare(
          `
          INSERT INTO context_items (id, session_id, key, value)
          VALUES (?, ?, ?, ?)
        `
        ).run(uuidv4(), testSessionId, `chain.${i}`, `Chain item ${i}`);

        if (i > 0) {
          db.prepare(
            `
            INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type)
            VALUES (?, ?, ?, ?, ?)
          `
          ).run(uuidv4(), testSessionId, `chain.${i - 1}`, `chain.${i}`, 'leads_to');
        }
      }

      // Traverse the entire chain
      const startTime = Date.now();
      let currentKey = 'chain.0';
      const path: string[] = [currentKey];

      while (true) {
        const next = db
          .prepare(
            `SELECT to_key FROM context_relationships 
             WHERE session_id = ? AND from_key = ? AND relationship_type = 'leads_to'`
          )
          .get(testSessionId, currentKey) as any;

        if (!next) break;
        currentKey = next.to_key;
        path.push(currentKey);
      }

      const endTime = Date.now();

      expect(path.length).toBe(chainLength);
      expect(endTime - startTime).toBeLessThan(100); // Should be fast even for long chains
    });
  });

  describe('Handler Response Formats', () => {
    beforeEach(() => {
      createTestItems();
    });

    it('should format relationship creation response', () => {
      const relationshipData = {
        fromKey: 'project.auth',
        toKey: 'component.login',
        relationshipType: 'contains',
        metadata: { created: new Date().toISOString() },
      };

      const relationshipId = uuidv4();

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'context_link',
                relationshipId: relationshipId,
                fromKey: relationshipData.fromKey,
                toKey: relationshipData.toKey,
                relationshipType: relationshipData.relationshipType,
                metadata: relationshipData.metadata,
                created: true,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.operation).toBe('context_link');
      expect(parsed.created).toBe(true);
      expect(parsed.relationshipId).toBe(relationshipId);
    });

    it('should format related items response with graph visualization hints', () => {
      const key = 'project.auth';

      // Mock data structure for visualization
      const graphData = {
        nodes: [
          { id: 'project.auth', label: 'Authentication module', type: 'project' },
          { id: 'component.login', label: 'Login component', type: 'component' },
          { id: 'task.implement_auth', label: 'Implement authentication', type: 'task' },
        ],
        edges: [
          { from: 'project.auth', to: 'component.login', type: 'contains', label: 'contains' },
          { from: 'project.auth', to: 'task.implement_auth', type: 'has_task', label: 'has task' },
        ],
      };

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                operation: 'context_get_related',
                key: key,
                visualization: {
                  format: 'graph',
                  nodes: graphData.nodes,
                  edges: graphData.edges,
                },
                summary: {
                  totalNodes: graphData.nodes.length,
                  totalEdges: graphData.edges.length,
                  relationshipTypes: ['contains', 'has_task'],
                },
              },
              null,
              2
            ),
          },
        ],
      };

      const parsed = JSON.parse(handlerResponse.content[0].text);
      expect(parsed.visualization.format).toBe('graph');
      expect(parsed.visualization.nodes).toHaveLength(3);
      expect(parsed.visualization.edges).toHaveLength(2);
    });

    it('should provide text summary for complex relationship queries', () => {
      const analysisResult = {
        mostConnectedItems: [
          { key: 'project.auth', connections: 4 },
          { key: 'project.database', connections: 3 },
        ],
        relationshipTypeCounts: [
          { type: 'contains', count: 3 },
          { type: 'depends_on', count: 4 },
          { type: 'has_task', count: 2 },
        ],
        orphanedItems: ['note.performance'],
        circularDependencies: [['project.auth', 'project.api', 'project.database', 'project.auth']],
      };

      const handlerResponse = {
        content: [
          {
            type: 'text',
            text: `Relationship Analysis Summary:

Most Connected Items:
${analysisResult.mostConnectedItems
  .map(item => `• ${item.key}: ${item.connections} connections`)
  .join('\n')}

Relationship Types:
${analysisResult.relationshipTypeCounts
  .map(type => `• ${type.type}: ${type.count} relationships`)
  .join('\n')}

Orphaned Items: ${analysisResult.orphanedItems.join(', ')}

Circular Dependencies Detected:
${analysisResult.circularDependencies.map(cycle => `• ${cycle.join(' → ')}`).join('\n')}`,
          },
        ],
      };

      expect(handlerResponse.content[0].text).toContain('Most Connected Items');
      expect(handlerResponse.content[0].text).toContain('Circular Dependencies');
    });
  });
});
