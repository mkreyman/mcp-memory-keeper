import { BaseRepository } from './BaseRepository.js';
import { ContextItem, CreateContextItemInput } from '../types/entities.js';

export class ContextRepository extends BaseRepository {
  save(sessionId: string, input: CreateContextItemInput): ContextItem {
    const id = this.generateId();
    const size = this.calculateSize(input.value);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO context_items 
      (id, session_id, key, value, category, priority, metadata, size, is_private)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      sessionId,
      input.key,
      input.value,
      input.category || null,
      input.priority || 'normal',
      input.metadata || null,
      size,
      input.isPrivate ? 1 : 0
    );

    return this.getById(id)!;
  }

  getById(id: string): ContextItem | null {
    const stmt = this.db.prepare('SELECT * FROM context_items WHERE id = ?');
    return stmt.get(id) as ContextItem | null;
  }

  getBySessionId(sessionId: string): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items 
      WHERE session_id = ? 
      ORDER BY priority DESC, created_at DESC
    `);
    return stmt.all(sessionId) as ContextItem[];
  }

  getByKey(sessionId: string, key: string): ContextItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items 
      WHERE session_id = ? AND key = ?
    `);
    return stmt.get(sessionId, key) as ContextItem | null;
  }

  getByCategory(sessionId: string, category: string): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items 
      WHERE session_id = ? AND category = ?
      ORDER BY priority DESC, created_at DESC
    `);
    return stmt.all(sessionId, category) as ContextItem[];
  }

  getByPriority(sessionId: string, priority: 'high' | 'normal' | 'low'): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items 
      WHERE session_id = ? AND priority = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(sessionId, priority) as ContextItem[];
  }

  search(query: string, sessionId?: string, includePrivate: boolean = false): ContextItem[] {
    let sql = `
      SELECT * FROM context_items 
      WHERE (key LIKE ? OR value LIKE ?)
    `;
    const params: any[] = [`%${query}%`, `%${query}%`];

    if (sessionId) {
      if (includePrivate) {
        sql += ' AND (is_private = 0 OR session_id = ?)';
        params.push(sessionId);
      } else {
        sql += ' AND is_private = 0';
      }
    } else {
      sql += ' AND is_private = 0';
    }

    sql += ' ORDER BY priority DESC, created_at DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as ContextItem[];
  }

  update(
    id: string,
    updates: Partial<Omit<ContextItem, 'id' | 'session_id' | 'created_at'>>
  ): void {
    const fieldsToUpdate: Record<string, any> = { ...updates };

    const setClause = Object.keys(fieldsToUpdate)
      .filter(key => key !== 'id' && key !== 'session_id' && key !== 'created_at')
      .map(key => `${key} = ?`)
      .join(', ');

    if (setClause) {
      const values = Object.keys(fieldsToUpdate)
        .filter(key => key !== 'id' && key !== 'session_id' && key !== 'created_at')
        .map(key => fieldsToUpdate[key]);

      const stmt = this.db.prepare(`
        UPDATE context_items 
        SET ${setClause}
        WHERE id = ?
      `);

      stmt.run(...values, id);
    }
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM context_items WHERE id = ?');
    stmt.run(id);
  }

  deleteBySessionId(sessionId: string): void {
    const stmt = this.db.prepare('DELETE FROM context_items WHERE session_id = ?');
    stmt.run(sessionId);
  }

  deleteByKey(sessionId: string, key: string): void {
    const stmt = this.db.prepare('DELETE FROM context_items WHERE session_id = ? AND key = ?');
    stmt.run(sessionId, key);
  }

  copyBetweenSessions(fromSessionId: string, toSessionId: string): number {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO context_items (id, session_id, key, value, category, priority, metadata, size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const items = this.getBySessionId(fromSessionId);
    let copied = 0;

    for (const item of items) {
      try {
        stmt.run(
          this.generateId(),
          toSessionId,
          item.key,
          item.value,
          item.category,
          item.priority,
          item.metadata,
          item.size,
          item.created_at
        );
        copied++;
      } catch (_error) {
        // Skip items that would cause unique constraint violations
        console.warn(`Skipping duplicate key '${item.key}' when copying to session ${toSessionId}`);
      }
    }

    return copied;
  }

  // Get items accessible from a specific session (all public items + own private items)
  getAccessibleItems(
    sessionId: string,
    options?: { category?: string; key?: string }
  ): ContextItem[] {
    let sql = `
      SELECT * FROM context_items 
      WHERE (is_private = 0 OR session_id = ?)
    `;
    const params: any[] = [sessionId];

    if (options?.key) {
      sql += ' AND key = ?';
      params.push(options.key);
    }

    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    sql += ' ORDER BY priority DESC, created_at DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as ContextItem[];
  }

  // Get a specific item by key, respecting privacy
  getAccessibleByKey(sessionId: string, key: string): ContextItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items 
      WHERE key = ? AND (is_private = 0 OR session_id = ?)
      ORDER BY 
        CASE WHEN session_id = ? THEN 0 ELSE 1 END,  -- Prioritize own session's items
        created_at DESC
      LIMIT 1
    `);
    const result = stmt.get(key, sessionId, sessionId) as ContextItem | undefined;
    return result || null;
  }

  searchAcrossSessions(query: string, currentSessionId?: string): ContextItem[] {
    let sql = `
      SELECT * FROM context_items 
      WHERE (key LIKE ? OR value LIKE ?) AND is_private = 0
    `;
    const params: any[] = [`%${query}%`, `%${query}%`];

    // Include private items from current session if provided
    if (currentSessionId) {
      sql = `
        SELECT * FROM context_items 
        WHERE (key LIKE ? OR value LIKE ?) 
        AND (is_private = 0 OR session_id = ?)
      `;
      params.push(currentSessionId);
    }

    sql += ' ORDER BY priority DESC, created_at DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as ContextItem[];
  }

  getStatsBySession(sessionId: string): {
    count: number;
    totalSize: number;
    byCategory: Record<string, number>;
    byPriority: Record<string, number>;
  } {
    const countStmt = this.db.prepare(
      'SELECT COUNT(*) as count, SUM(size) as totalSize FROM context_items WHERE session_id = ?'
    );
    const result = countStmt.get(sessionId) as any;

    const categoryStmt = this.db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM context_items 
      WHERE session_id = ? 
      GROUP BY category
    `);
    const categories = categoryStmt.all(sessionId) as any[];

    const priorityStmt = this.db.prepare(`
      SELECT priority, COUNT(*) as count 
      FROM context_items 
      WHERE session_id = ? 
      GROUP BY priority
    `);
    const priorities = priorityStmt.all(sessionId) as any[];

    return {
      count: result.count || 0,
      totalSize: result.totalSize || 0,
      byCategory: categories.reduce((acc, cat) => {
        acc[cat.category || 'uncategorized'] = cat.count;
        return acc;
      }, {}),
      byPriority: priorities.reduce((acc, pri) => {
        acc[pri.priority] = pri.count;
        return acc;
      }, {}),
    };
  }
}
