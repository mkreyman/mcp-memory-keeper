import { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface Entity {
  id: string;
  session_id: string;
  type: string;
  name: string;
  attributes?: Record<string, any>;
  created_at?: string;
}

export interface Relation {
  id: string;
  session_id: string;
  subject_id: string;
  predicate: string;
  object_id: string;
  confidence: number;
  created_at?: string;
}

export interface Observation {
  id: string;
  entity_id: string;
  observation: string;
  source?: string;
  timestamp?: string;
}

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  attributes?: Record<string, any>;
}

export interface GraphEdge {
  source: string;
  target: string;
  predicate: string;
  confidence: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class KnowledgeGraphManager {
  constructor(private db: Database) {}

  // Entity operations
  createEntity(
    sessionId: string,
    type: string,
    name: string,
    attributes?: Record<string, any>
  ): Entity {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO entities (id, session_id, type, name, attributes)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, sessionId, type, name, attributes ? JSON.stringify(attributes) : null);

    return { id, session_id: sessionId, type, name, attributes };
  }

  findEntity(sessionId: string, name: string, type?: string): Entity | null {
    let query = 'SELECT * FROM entities WHERE session_id = ? AND name = ?';
    const params: any[] = [sessionId, name];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    const row = this.db.prepare(query).get(...params) as any;

    if (!row) return null;

    return {
      ...row,
      attributes: row.attributes ? JSON.parse(row.attributes) : undefined,
    };
  }

  getEntitiesByType(sessionId: string, type: string): Entity[] {
    const rows = this.db
      .prepare('SELECT * FROM entities WHERE session_id = ? AND type = ? ORDER BY created_at DESC')
      .all(sessionId, type) as any[];

    return rows.map(row => ({
      ...row,
      attributes: row.attributes ? JSON.parse(row.attributes) : undefined,
    }));
  }

  // Relation operations
  createRelation(
    sessionId: string,
    subjectId: string,
    predicate: string,
    objectId: string,
    confidence: number = 1.0
  ): Relation {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO relations (id, session_id, subject_id, predicate, object_id, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, sessionId, subjectId, predicate, objectId, confidence);

    return {
      id,
      session_id: sessionId,
      subject_id: subjectId,
      predicate,
      object_id: objectId,
      confidence,
    };
  }

  getRelations(entityId: string, direction: 'subject' | 'object' | 'both' = 'both'): Relation[] {
    let query = '';
    const params: string[] = [];

    if (direction === 'subject' || direction === 'both') {
      query = 'SELECT * FROM relations WHERE subject_id = ?';
      params.push(entityId);
    }

    if (direction === 'object') {
      query = 'SELECT * FROM relations WHERE object_id = ?';
      params.push(entityId);
    } else if (direction === 'both') {
      query += ' UNION SELECT * FROM relations WHERE object_id = ?';
      params.push(entityId);
    }

    return this.db.prepare(query).all(...params) as Relation[];
  }

  // Observation operations
  addObservation(entityId: string, observation: string, source?: string): Observation {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO observations (id, entity_id, observation, source)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(id, entityId, observation, source || null);

    return { id, entity_id: entityId, observation, source };
  }

  getObservations(entityId: string): Observation[] {
    return this.db
      .prepare('SELECT * FROM observations WHERE entity_id = ? ORDER BY timestamp DESC')
      .all(entityId) as Observation[];
  }

  // Graph traversal
  getConnectedEntities(entityId: string, maxDepth: number = 2): Set<string> {
    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [{ id: entityId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const relations = this.getRelations(id);

      for (const rel of relations) {
        const nextId = rel.subject_id === id ? rel.object_id : rel.subject_id;
        if (!visited.has(nextId)) {
          queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }

    return visited;
  }

  // Analysis operations
  analyzeContext(
    sessionId: string,
    text: string
  ): {
    entities: Array<{ type: string; name: string; confidence: number }>;
    relations: Array<{ subject: string; predicate: string; object: string; confidence: number }>;
  } {
    const entities: Array<{ type: string; name: string; confidence: number }> = [];
    const relations: Array<{
      subject: string;
      predicate: string;
      object: string;
      confidence: number;
    }> = [];

    // Simple pattern matching for common entities
    // Files - multiple patterns to catch various mentions
    const filePatterns = [
      /(?:file|module|component)\s+(?:called\s+)?["`']?([a-zA-Z0-9_\-./]+\.[a-zA-Z]+)["`']?/gi,
      /(?:modified|updated|created)\s+(?:files?\s+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z]+)/gi,
      /([a-zA-Z0-9_\-./]+\.[a-zA-Z]+)\s+(?:which|that|file)/gi,
      /(?:from|imports?)\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z]+)/gi,
      /([a-zA-Z0-9_\-./]+\.(?:ts|js|tsx|jsx|py|java|cpp|cs|rb|go))\b/gi,
    ];

    let match;
    const foundFiles = new Set<string>();
    for (const pattern of filePatterns) {
      pattern.lastIndex = 0; // Reset regex
      while ((match = pattern.exec(text)) !== null) {
        if (!foundFiles.has(match[1])) {
          entities.push({ type: 'file', name: match[1], confidence: 0.9 });
          foundFiles.add(match[1]);
        }
      }
    }

    // Functions/Methods - multiple patterns
    const functionPatterns = [
      /(?:function|method|def)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:function|\()/g,
      /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*function/g,
      /[Tt]he\s+(?:function|method)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ];

    const foundFunctions = new Set<string>();
    for (const pattern of functionPatterns) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (!foundFunctions.has(match[1])) {
          entities.push({ type: 'function', name: match[1], confidence: 0.8 });
          foundFunctions.add(match[1]);
        }
      }
    }

    // Classes/Interfaces/Services - case sensitive for better matching
    const classPatterns = [
      /(?:class|interface|type)\s+([A-Z][a-zA-Z0-9_]*)/g,
      /([A-Z][a-zA-Z0-9_]*)\s+(?:class|interface|service|model|controller|repository)/gi,
      /[Tt]he\s+([A-Z][a-zA-Z0-9_]*)\s+(?:class|interface|service)/g,
      /([A-Z][a-zA-Z0-9_]*Service|[A-Z][a-zA-Z0-9_]*Controller|[A-Z][a-zA-Z0-9_]*Model|[A-Z][a-zA-Z0-9_]*Repository)\b/g,
    ];

    const foundClasses = new Set<string>();
    for (const pattern of classPatterns) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        if (!foundClasses.has(match[1])) {
          entities.push({ type: 'class', name: match[1], confidence: 0.8 });
          foundClasses.add(match[1]);
        }
      }
    }

    // Simple relation extraction - expanded patterns
    const relationPatterns = [
      {
        // eslint-disable-next-line no-useless-escape
        pattern: /([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:calls|invokes|uses)\s+([a-zA-Z_][a-zA-Z0-9_\.]*)/g,
        predicate: 'calls',
      },
      {
        pattern: /([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:implements|extends)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
        predicate: 'implements',
      },
      {
        pattern: /([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:imports|requires)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
        predicate: 'imports',
      },
      {
        pattern: /([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:contains|has)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
        predicate: 'contains',
      },
    ];

    for (const { pattern, predicate } of relationPatterns) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        relations.push({
          subject: match[1],
          predicate,
          object: match[2],
          confidence: predicate === 'implements' ? 0.8 : 0.7,
        });
      }
    }

    return { entities, relations };
  }

  // Visualization support
  getGraphData(sessionId: string, entityTypes?: string[]): GraphData {
    let entityQuery = 'SELECT * FROM entities WHERE session_id = ?';
    const entityParams: any[] = [sessionId];

    if (entityTypes && entityTypes.length > 0) {
      entityQuery += ` AND type IN (${entityTypes.map(() => '?').join(',')})`;
      entityParams.push(...entityTypes);
    }

    const entities = this.db.prepare(entityQuery).all(...entityParams) as any[];
    const entityIds = entities.map(e => e.id);

    if (entityIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    const relations = this.db
      .prepare(
        `
      SELECT * FROM relations 
      WHERE session_id = ? 
      AND subject_id IN (${entityIds.map(() => '?').join(',')})
      AND object_id IN (${entityIds.map(() => '?').join(',')})
    `
      )
      .all(sessionId, ...entityIds, ...entityIds) as Relation[];

    const nodes: GraphNode[] = entities.map(e => ({
      id: e.id,
      type: e.type,
      name: e.name,
      attributes: e.attributes ? JSON.parse(e.attributes) : undefined,
    }));

    const edges: GraphEdge[] = relations.map(r => ({
      source: r.subject_id,
      target: r.object_id,
      predicate: r.predicate,
      confidence: r.confidence,
    }));

    return { nodes, edges };
  }

  // Cleanup operations
  pruneOrphanedEntities(sessionId: string): number {
    // Find entities with no relations
    const orphaned = this.db
      .prepare(
        `
      SELECT e.id FROM entities e
      WHERE e.session_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM relations r 
        WHERE r.subject_id = e.id OR r.object_id = e.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM observations o 
        WHERE o.entity_id = e.id
      )
    `
      )
      .all(sessionId) as any[];

    if (orphaned.length === 0) return 0;

    const ids = orphaned.map(o => o.id);
    this.db
      .prepare(`DELETE FROM entities WHERE id IN (${ids.map(() => '?').join(',')})`)
      .run(...ids);

    return orphaned.length;
  }
}
