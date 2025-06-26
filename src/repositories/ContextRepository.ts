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

  // Enhanced query method with all new parameters
  queryEnhanced(options: {
    sessionId: string;
    key?: string;
    category?: string;
    sort?: string;
    limit?: number;
    offset?: number;
    createdAfter?: string;
    createdBefore?: string;
    keyPattern?: string;
    priorities?: string[];
    includeMetadata?: boolean;
  }): { items: ContextItem[]; totalCount: number } {
    const {
      sessionId,
      key,
      category,
      sort = 'created_at_desc',
      limit,
      offset = 0,
      createdAfter,
      createdBefore,
      keyPattern,
      priorities,
    } = options;

    // Build the base query
    let sql = `
      SELECT * FROM context_items 
      WHERE session_id = ?
    `;
    const params: any[] = [sessionId];

    // Add filters
    if (key) {
      sql += ' AND key = ?';
      params.push(key);
    }

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (createdAfter) {
      sql += ' AND created_at > ?';
      params.push(createdAfter);
    }

    if (createdBefore) {
      sql += ' AND created_at < ?';
      params.push(createdBefore);
    }

    if (keyPattern) {
      // Use GLOB for pattern matching (SQLite's simpler regex-like pattern)
      // Convert JavaScript regex pattern to SQLite GLOB pattern
      const globPattern = keyPattern
        .replace(/\./g, '?') // . -> single char
        .replace(/\*/g, '*') // * stays as wildcard
        .replace(/^\^/, '') // Remove start anchor
        .replace(/\$$/, ''); // Remove end anchor

      sql += ' AND key GLOB ?';
      params.push(globPattern);
    }

    if (priorities && priorities.length > 0) {
      sql += ` AND priority IN (${priorities.map(() => '?').join(',')})`;
      params.push(...priorities);
    }

    // Count total before pagination
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countStmt = this.db.prepare(countSql);
    const countResult = countStmt.get(...params) as any;
    const totalCount = countResult.count || 0;

    // Add sorting
    const sortMap: Record<string, string> = {
      created_at_desc: 'created_at DESC',
      created_at_asc: 'created_at ASC',
      updated_at_desc: 'updated_at DESC',
      updated_at_asc: 'updated_at ASC',
      key_asc: 'key ASC',
      key_desc: 'key DESC',
    };

    sql += ` ORDER BY ${sortMap[sort] || 'created_at DESC'}`;

    // Add pagination
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    if (offset > 0) {
      sql += ' OFFSET ?';
      params.push(offset);
    }

    const stmt = this.db.prepare(sql);
    const items = stmt.all(...params) as ContextItem[];

    return { items, totalCount };
  }

  // Get timeline data with enhanced options
  getTimelineData(options: {
    sessionId: string;
    startDate?: string;
    endDate?: string;
    categories?: string[];
    relativeTime?: string;
    itemsPerPeriod?: number;
    includeItems?: boolean;
    groupBy?: 'hour' | 'day' | 'week';
  }): any[] {
    const {
      sessionId,
      startDate,
      endDate,
      categories,
      relativeTime,
      itemsPerPeriod,
      includeItems,
      groupBy = 'day',
    } = options;

    // Calculate date range from relative time
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (relativeTime) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (relativeTime === 'today') {
        effectiveStartDate = today.toISOString();
        effectiveEndDate = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();
      } else if (relativeTime === 'yesterday') {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        effectiveStartDate = yesterday.toISOString();
        effectiveEndDate = today.toISOString();
      } else if (relativeTime.match(/^(\d+) hours? ago$/)) {
        const hours = parseInt(relativeTime.match(/^(\d+)/)![1]);
        effectiveStartDate = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
      } else if (relativeTime.match(/^(\d+) days? ago$/)) {
        const days = parseInt(relativeTime.match(/^(\d+)/)![1]);
        effectiveStartDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
      } else if (relativeTime === 'this week') {
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        effectiveStartDate = startOfWeek.toISOString();
      } else if (relativeTime === 'last week') {
        const startOfLastWeek = new Date(today);
        startOfLastWeek.setDate(today.getDate() - today.getDay() - 7);
        const endOfLastWeek = new Date(startOfLastWeek);
        endOfLastWeek.setDate(startOfLastWeek.getDate() + 7);
        effectiveStartDate = startOfLastWeek.toISOString();
        effectiveEndDate = endOfLastWeek.toISOString();
      }
    }

    // Build query for timeline
    let dateFmt = '%Y-%m-%d'; // day grouping
    if (groupBy === 'hour') {
      dateFmt = '%Y-%m-%d %H:00';
    } else if (groupBy === 'week') {
      dateFmt = '%Y-W%W';
    }

    let sql = `
      SELECT 
        strftime('${dateFmt}', created_at) as period,
        COUNT(*) as count,
        ${includeItems ? 'GROUP_CONCAT(id) as item_ids' : 'NULL as item_ids'}
      FROM context_items
      WHERE session_id = ?
    `;
    const params: any[] = [sessionId];

    if (effectiveStartDate) {
      sql += ' AND created_at >= ?';
      params.push(effectiveStartDate);
    }

    if (effectiveEndDate) {
      sql += ' AND created_at <= ?';
      params.push(effectiveEndDate);
    }

    if (categories && categories.length > 0) {
      sql += ` AND category IN (${categories.map(() => '?').join(',')})`;
      params.push(...categories);
    }

    sql += ' GROUP BY period ORDER BY period DESC';

    const stmt = this.db.prepare(sql);
    const timeline = stmt.all(...params) as any[];

    // If includeItems is true, fetch the actual items for each period
    if (includeItems && timeline.length > 0) {
      for (const period of timeline) {
        if (period.item_ids) {
          const itemIds = period.item_ids.split(',');
          let itemsToFetch = itemIds;

          // Limit items per period if specified
          if (itemsPerPeriod && itemIds.length > itemsPerPeriod) {
            itemsToFetch = itemIds.slice(0, itemsPerPeriod);
            period.hasMore = true;
            period.totalCount = itemIds.length;
          }

          // Fetch the items
          const itemStmt = this.db.prepare(`
            SELECT * FROM context_items 
            WHERE id IN (${itemsToFetch.map(() => '?').join(',')})
            ORDER BY created_at DESC
          `);
          period.items = itemStmt.all(...itemsToFetch) as ContextItem[];
        }
      }
    }

    return timeline;
  }
}
