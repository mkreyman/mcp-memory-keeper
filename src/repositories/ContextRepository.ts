import { BaseRepository } from './BaseRepository.js';
import { ContextItem, CreateContextItemInput } from '../types/entities.js';

// Type for valid sort options (for documentation)
type _SortOption =
  | 'created_desc'
  | 'created_asc'
  | 'updated_desc'
  | 'key_asc'
  | 'key_desc'
  | 'created_at_desc'
  | 'created_at_asc'
  | 'updated_at_desc'
  | 'updated_at_asc';

export class ContextRepository extends BaseRepository {
  // Constants
  private static readonly SQLITE_ESCAPE_CHAR = '\\';

  // Helper methods for DRY code
  private buildSortClause(sort?: string): string {
    const sortMap: Record<string, string> = {
      created_desc: 'created_at DESC',
      created_at_desc: 'created_at DESC',
      created_asc: 'created_at ASC',
      created_at_asc: 'created_at ASC',
      updated_desc: 'updated_at DESC',
      updated_at_desc: 'updated_at DESC',
      updated_at_asc: 'updated_at ASC',
      key_asc: 'key ASC',
      key_desc: 'key DESC',
    };

    const defaultSort = sort?.includes('priority')
      ? 'priority DESC, created_at DESC'
      : 'created_at DESC';
    return sortMap[sort || ''] || defaultSort;
  }

  private parseRelativeTime(relativeTime: string): string | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (relativeTime === 'today') {
      return today.toISOString();
    } else if (relativeTime === 'yesterday') {
      return new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString();
    } else if (relativeTime.match(/^(\d+) hours? ago$/)) {
      const hours = parseInt(relativeTime.match(/^(\d+)/)![1]);
      return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
    } else if (relativeTime.match(/^(\d+) days? ago$/)) {
      const days = parseInt(relativeTime.match(/^(\d+)/)![1]);
      return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    } else if (relativeTime === 'this week') {
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      return startOfWeek.toISOString();
    } else if (relativeTime === 'last week') {
      const startOfLastWeek = new Date(today);
      startOfLastWeek.setDate(today.getDate() - today.getDay() - 7);
      return startOfLastWeek.toISOString();
    }

    return null;
  }

  private convertToGlobPattern(pattern: string): string {
    return pattern
      .replace(/\./g, '?') // . -> single char
      .replace(/\*/g, '*') // * stays as wildcard
      .replace(/^\^/, '') // Remove start anchor
      .replace(/\$$/, ''); // Remove end anchor
  }

  private addPaginationToQuery(
    sql: string,
    params: any[],
    limit?: number,
    offset?: number
  ): string {
    let modifiedSql = sql;
    if (limit) {
      modifiedSql += ' LIMIT ?';
      params.push(limit);
    }

    if (offset && offset > 0) {
      modifiedSql += ' OFFSET ?';
      params.push(offset);
    }
    return modifiedSql;
  }

  private getTotalCount(baseSql: string, params: any[]): number {
    const countSql = baseSql.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countStmt = this.db.prepare(countSql);
    const countResult = countStmt.get(...params) as any;
    return countResult.count || 0;
  }

  save(sessionId: string, input: CreateContextItemInput): ContextItem {
    const id = this.generateId();
    const size = this.calculateSize(input.value);

    // Determine channel - use explicit channel, or session default, or 'general'
    let channel = input.channel;
    if (!channel) {
      const sessionStmt = this.db.prepare('SELECT default_channel FROM sessions WHERE id = ?');
      const session = sessionStmt.get(sessionId) as any;
      channel = session?.default_channel || 'general';
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO context_items 
      (id, session_id, key, value, category, priority, metadata, size, is_private, channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.isPrivate ? 1 : 0,
      channel
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

  // Enhanced search method with all new parameters
  searchEnhanced(options: {
    query: string;
    sessionId: string;
    searchIn?: string[];
    category?: string;
    channel?: string;
    channels?: string[];
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
      query,
      sessionId,
      searchIn = ['key', 'value'],
      category,
      channel,
      channels,
      sort = 'created_desc',
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

    // Add search query with searchIn support
    if (query) {
      const searchConditions: string[] = [];

      // Escape special characters for LIKE operator
      const escapedQuery = query.replace(/[%_\\]/g, `${ContextRepository.SQLITE_ESCAPE_CHAR}$&`);

      if (searchIn.includes('key')) {
        searchConditions.push(`key LIKE ? ESCAPE '${ContextRepository.SQLITE_ESCAPE_CHAR}'`);
        params.push(`%${escapedQuery}%`);
      }

      if (searchIn.includes('value')) {
        searchConditions.push(`value LIKE ? ESCAPE '${ContextRepository.SQLITE_ESCAPE_CHAR}'`);
        params.push(`%${escapedQuery}%`);
      }

      if (searchConditions.length > 0) {
        sql += ` AND (${searchConditions.join(' OR ')})`;
      }
    }

    // Add filters
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (channel) {
      sql += ' AND channel = ?';
      params.push(channel);
    }

    if (channels && channels.length > 0) {
      sql += ` AND channel IN (${channels.map(() => '?').join(',')})`;
      params.push(...channels);
    }

    // Handle relative time parsing for createdAfter
    if (createdAfter) {
      const parsedDate = this.parseRelativeTime(createdAfter);
      const effectiveDate = parsedDate || createdAfter;
      sql += ' AND created_at > ?';
      params.push(effectiveDate);
    }

    // Handle relative time parsing for createdBefore
    if (createdBefore) {
      let effectiveDate = createdBefore;

      // Special handling for "today" and "yesterday" for createdBefore
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (createdBefore === 'today') {
        effectiveDate = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();
      } else if (createdBefore === 'yesterday') {
        effectiveDate = today.toISOString();
      } else {
        const parsedDate = this.parseRelativeTime(createdBefore);
        if (parsedDate) {
          effectiveDate = parsedDate;
        }
      }

      sql += ' AND created_at < ?';
      params.push(effectiveDate);
    }

    if (keyPattern) {
      const globPattern = this.convertToGlobPattern(keyPattern);
      sql += ' AND key GLOB ?';
      params.push(globPattern);
    }

    if (priorities && priorities.length > 0) {
      sql += ` AND priority IN (${priorities.map(() => '?').join(',')})`;
      params.push(...priorities);
    }

    // Add privacy filter
    sql += ' AND (is_private = 0 OR session_id = ?)';
    params.push(sessionId);

    // Count total before pagination
    const totalCount = this.getTotalCount(sql, params);

    // Add sorting
    sql += ` ORDER BY ${this.buildSortClause(sort)}`;

    // Add pagination
    sql = this.addPaginationToQuery(sql, params, limit, offset);

    const stmt = this.db.prepare(sql);
    const items = stmt.all(...params) as ContextItem[];

    return { items, totalCount };
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
      INSERT OR IGNORE INTO context_items (id, session_id, key, value, category, priority, metadata, size, is_private, channel, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
          item.is_private,
          item.channel || 'general',
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

  // Get items by channel
  getByChannel(sessionId: string, channel: string): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items 
      WHERE session_id = ? AND channel = ?
      ORDER BY priority DESC, created_at DESC
    `);
    return stmt.all(sessionId, channel) as ContextItem[];
  }

  // Get items by multiple channels
  getByChannels(sessionId: string, channels: string[]): ContextItem[] {
    if (channels.length === 0) {
      return [];
    }

    const placeholders = channels.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM context_items 
      WHERE session_id = ? AND channel IN (${placeholders})
      ORDER BY priority DESC, created_at DESC
    `);
    return stmt.all(sessionId, ...channels) as ContextItem[];
  }

  // Get items by channel across all sessions
  getByChannelAcrossSessions(channel: string): ContextItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM context_items 
      WHERE channel = ? AND is_private = 0
      ORDER BY priority DESC, created_at DESC
    `);
    return stmt.all(channel) as ContextItem[];
  }

  // Enhanced query method with all new parameters
  queryEnhanced(options: {
    sessionId: string;
    key?: string;
    category?: string;
    channel?: string;
    channels?: string[];
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
      channel,
      channels,
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

    if (channel) {
      sql += ' AND channel = ?';
      params.push(channel);
    }

    if (channels && channels.length > 0) {
      sql += ` AND channel IN (${channels.map(() => '?').join(',')})`;
      params.push(...channels);
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
      const globPattern = this.convertToGlobPattern(keyPattern);
      sql += ' AND key GLOB ?';
      params.push(globPattern);
    }

    if (priorities && priorities.length > 0) {
      sql += ` AND priority IN (${priorities.map(() => '?').join(',')})`;
      params.push(...priorities);
    }

    // Count total before pagination
    const totalCount = this.getTotalCount(sql, params);

    // Add sorting
    sql += ` ORDER BY ${this.buildSortClause(sort)}`;

    // Add pagination
    sql = this.addPaginationToQuery(sql, params, limit, offset);

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
      const parsedStartDate = this.parseRelativeTime(relativeTime);
      if (parsedStartDate) {
        effectiveStartDate = parsedStartDate;
      }

      // Special handling for end dates
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (relativeTime === 'today') {
        effectiveEndDate = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();
      } else if (relativeTime === 'yesterday') {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        effectiveStartDate = yesterday.toISOString();
        effectiveEndDate = today.toISOString();
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

  // Get diff data for context items
  getDiff(options: {
    sessionId: string;
    sinceTimestamp: string;
    category?: string;
    channel?: string;
    channels?: string[];
    limit?: number;
    offset?: number;
    includeValues?: boolean;
  }): {
    added: any[];
    modified: any[];
  } {
    const {
      sessionId,
      sinceTimestamp,
      category,
      channel,
      channels,
      limit,
      offset,
      includeValues = true,
    } = options;

    // Build queries for added and modified items
    let addedSql = `
      SELECT * FROM context_items 
      WHERE session_id = ? 
      AND created_at > ?
      AND (is_private = 0 OR session_id = ?)
    `;
    const addedParams: any[] = [sessionId, sinceTimestamp, sessionId];

    let modifiedSql = `
      SELECT * FROM context_items 
      WHERE session_id = ? 
      AND created_at <= ?
      AND updated_at > ?
      AND created_at != updated_at
      AND (is_private = 0 OR session_id = ?)
    `;
    const modifiedParams: any[] = [sessionId, sinceTimestamp, sinceTimestamp, sessionId];

    // Add category filter
    if (category) {
      addedSql += ' AND category = ?';
      modifiedSql += ' AND category = ?';
      addedParams.push(category);
      modifiedParams.push(category);
    }

    // Add channel filter
    if (channel) {
      addedSql += ' AND channel = ?';
      modifiedSql += ' AND channel = ?';
      addedParams.push(channel);
      modifiedParams.push(channel);
    }

    if (channels && channels.length > 0) {
      const placeholders = channels.map(() => '?').join(',');
      addedSql += ` AND channel IN (${placeholders})`;
      modifiedSql += ` AND channel IN (${placeholders})`;
      addedParams.push(...channels);
      modifiedParams.push(...channels);
    }

    // Add ordering
    addedSql += ' ORDER BY created_at DESC';
    modifiedSql += ' ORDER BY updated_at DESC';

    // Add pagination if requested
    if (limit) {
      addedSql += ' LIMIT ?';
      modifiedSql += ' LIMIT ?';
      addedParams.push(limit);
      modifiedParams.push(limit);

      if (offset) {
        addedSql += ' OFFSET ?';
        modifiedSql += ' OFFSET ?';
        addedParams.push(offset);
        modifiedParams.push(offset);
      }
    }

    // Execute queries
    const addedItems = this.db.prepare(addedSql).all(...addedParams) as ContextItem[];
    const modifiedItems = this.db.prepare(modifiedSql).all(...modifiedParams) as ContextItem[];

    // Filter out values if not needed
    if (!includeValues) {
      const stripValue = (item: ContextItem) => ({
        ...item,
        value: undefined,
      });

      return {
        added: addedItems.map(stripValue),
        modified: modifiedItems.map(stripValue),
      };
    }

    return { added: addedItems, modified: modifiedItems };
  }

  // Get deleted keys by comparing with checkpoint
  getDeletedKeysFromCheckpoint(sessionId: string, checkpointId: string): string[] {
    // Get items from checkpoint
    const checkpointItems = this.db
      .prepare(
        `
        SELECT ci.key FROM context_items ci
        JOIN checkpoint_items cpi ON ci.id = cpi.context_item_id
        WHERE cpi.checkpoint_id = ?
        AND ci.session_id = ?
      `
      )
      .all(checkpointId, sessionId) as any[];

    // Get current items
    const currentItems = this.db
      .prepare('SELECT key FROM context_items WHERE session_id = ?')
      .all(sessionId) as any[];

    const checkpointKeys = new Set(checkpointItems.map((i: any) => i.key));
    const currentKeys = new Set(currentItems.map((i: any) => i.key));

    // Find deleted items
    return Array.from(checkpointKeys).filter(key => !currentKeys.has(key));
  }
}
