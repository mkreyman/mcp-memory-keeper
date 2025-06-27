import { BaseRepository } from './BaseRepository.js';
import { ContextItem, CreateContextItemInput } from '../types/entities.js';
import { ensureSQLiteFormat } from '../utils/timestamps.js';

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
    // SQLite GLOB supports character classes with brackets, so preserve them
    // Only convert regex-style patterns to GLOB
    return pattern
      .replace(/\./g, '?') // . -> single char
      .replace(/^\^/, '') // Remove start anchor
      .replace(/\$$/, ''); // Remove end anchor
    // Note: * and [...] are already GLOB syntax, so we keep them as-is
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
        effectiveDate = today.toISOString(); // Start of today
      } else if (createdBefore === 'yesterday') {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        effectiveDate = yesterday.toISOString(); // Start of yesterday
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
      sort,
      limit,
      offset = 0,
      createdAfter,
      createdBefore,
      keyPattern,
      priorities,
    } = options;

    // Apply default pagination parameters
    // Default sort: created_desc (most recent first)
    const effectiveSort = sort || 'created_desc';

    // Default limit: 100 items (or unlimited if explicitly set to 0)
    // Negative limits are treated as default
    // Invalid types are treated as default
    let effectiveLimit: number | undefined;
    const numericLimit = typeof limit === 'number' ? limit : undefined;

    if (numericLimit === 0) {
      effectiveLimit = undefined; // Unlimited
    } else if (numericLimit === undefined || numericLimit < 0) {
      effectiveLimit = 100; // Default limit
    } else {
      effectiveLimit = numericLimit; // Use provided limit
    }

    // Validate offset is not negative
    const validOffset = Math.max(0, offset || 0);

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
        effectiveDate = today.toISOString(); // Start of today
      } else if (createdBefore === 'yesterday') {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        effectiveDate = yesterday.toISOString(); // Start of yesterday
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

    // Count total before pagination
    const totalCount = this.getTotalCount(sql, params);

    // Add sorting
    sql += ` ORDER BY ${this.buildSortClause(effectiveSort)}`;

    // Add pagination
    sql = this.addPaginationToQuery(sql, params, effectiveLimit, validOffset);

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
    minItemsPerPeriod?: number;
    showEmpty?: boolean;
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
      minItemsPerPeriod,
      showEmpty = false,
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
    let timeline = stmt.all(...params) as any[];

    // Handle minItemsPerPeriod filter (before showEmpty logic)
    if (minItemsPerPeriod && minItemsPerPeriod > 0 && !showEmpty) {
      // Treat negative values as 0, round fractional values up
      const minItems = Math.max(0, Math.ceil(minItemsPerPeriod));
      timeline = timeline.filter(period => period.count >= minItems);
    }

    // Handle showEmpty - generate empty periods for date ranges
    if (showEmpty && (effectiveStartDate || effectiveEndDate)) {
      const existingPeriods = new Map(timeline.map(p => [p.period, p]));
      const allPeriods: any[] = [];

      // Determine date range
      const start = effectiveStartDate ? new Date(effectiveStartDate) : new Date();
      const end = effectiveEndDate ? new Date(effectiveEndDate) : new Date();

      // Return empty array if end is before start
      if (end < start) {
        return [];
      }

      // Generate all periods in range
      const current = new Date(start);
      let periodCount = 0;
      const maxPeriods = groupBy === 'hour' ? 24 * 365 : 365; // Reasonable limits

      while (current <= end && periodCount < maxPeriods) {
        let periodKey: string;

        if (groupBy === 'hour') {
          periodKey = current.toISOString().slice(0, 13) + ':00';
        } else if (groupBy === 'week') {
          // ISO week format - need to calculate properly
          const thursday = new Date(current);
          thursday.setDate(current.getDate() - current.getDay() + 4); // Thursday of current week
          const yearStart = new Date(thursday.getFullYear(), 0, 1);
          const weekNum = Math.ceil(
            ((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
          );
          periodKey = `${thursday.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
        } else {
          // day
          periodKey = current.toISOString().slice(0, 10);
        }

        // Use existing period data or create empty one
        const existingPeriod = existingPeriods.get(periodKey);
        if (existingPeriod) {
          allPeriods.push(existingPeriod);
        } else {
          allPeriods.push({
            period: periodKey,
            count: 0,
            item_ids: null,
            items: [],
          });
        }

        // Increment current date
        if (groupBy === 'hour') {
          current.setHours(current.getHours() + 1);
        } else if (groupBy === 'week') {
          current.setDate(current.getDate() + 7);
        } else {
          current.setDate(current.getDate() + 1);
        }

        periodCount++;
      }

      // Sort by period descending
      timeline = allPeriods.sort((a, b) => b.period.localeCompare(a.period));

      // Apply minItemsPerPeriod filter after generating empty periods if showEmpty overrides it
      if (minItemsPerPeriod && minItemsPerPeriod > 0) {
        // When showEmpty is true, we still show all periods but can use minItemsPerPeriod for other purposes
        // According to tests, showEmpty should override minItemsPerPeriod behavior
      }
    }

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
        } else {
          // No items for this period
          period.items = [];
        }
      }
    } else if (includeItems) {
      // Ensure all periods have items array when includeItems is true
      for (const period of timeline) {
        if (!period.items) {
          period.items = [];
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

    // Ensure timestamp is in SQLite format for comparison
    const sqliteTimestamp = ensureSQLiteFormat(sinceTimestamp);

    // Build queries for added and modified items
    let addedSql = `
      SELECT * FROM context_items 
      WHERE session_id = ? 
      AND created_at > ?
    `;
    const addedParams: any[] = [sessionId, sqliteTimestamp];

    let modifiedSql = `
      SELECT * FROM context_items 
      WHERE session_id = ? 
      AND created_at <= ?
      AND updated_at > ?
      AND created_at != updated_at
    `;
    const modifiedParams: any[] = [sessionId, sqliteTimestamp, sqliteTimestamp];

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

  // List all channels with metadata
  listChannels(options: {
    sessionId?: string;
    sessionIds?: string[];
    sort?: 'name' | 'count' | 'activity';
    includeEmpty?: boolean;
  }): any[] {
    const { sessionId, sessionIds, sort = 'name', includeEmpty = false } = options;

    // Build the base query
    let sql = `
      SELECT 
        channel,
        COUNT(*) as total_count,
        SUM(CASE WHEN is_private = 0 THEN 1 ELSE 0 END) as public_count,
        SUM(CASE WHEN is_private = 1 THEN 1 ELSE 0 END) as private_count,
        MAX(updated_at) as last_activity,
        GROUP_CONCAT(DISTINCT category) as categories,
        GROUP_CONCAT(DISTINCT priority) as priorities,
        COUNT(DISTINCT session_id) as session_count
      FROM context_items
    `;
    const params: any[] = [];

    // Add session filters
    if (sessionId) {
      sql += ' WHERE session_id = ?';
      params.push(sessionId);
    } else if (sessionIds && sessionIds.length > 0) {
      sql += ` WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`;
      params.push(...sessionIds);
    }

    sql += ' GROUP BY channel';

    // Add having clause if not including empty channels
    if (!includeEmpty) {
      sql += ' HAVING total_count > 0';
    }

    // Add sorting
    switch (sort) {
      case 'count':
        sql += ' ORDER BY total_count DESC, channel ASC';
        break;
      case 'activity':
        sql += ' ORDER BY last_activity DESC, channel ASC';
        break;
      case 'name':
      default:
        sql += ' ORDER BY channel ASC';
        break;
    }

    const stmt = this.db.prepare(sql);
    const channels = stmt.all(...params) as any[];

    // Post-process results
    return channels.map(channel => ({
      ...channel,
      categories: channel.categories ? channel.categories.split(',').filter(Boolean) : [],
      priorities: channel.priorities ? channel.priorities.split(',').filter(Boolean) : [],
    }));
  }

  // Get detailed statistics for channels
  getChannelStats(options: {
    channel?: string;
    sessionId?: string;
    includeTimeSeries?: boolean;
    includeInsights?: boolean;
  }): any {
    const { channel, sessionId, includeTimeSeries = false, includeInsights = false } = options;

    if (channel) {
      // Single channel stats
      return this.getSingleChannelStats(channel, sessionId, includeTimeSeries, includeInsights);
    } else {
      // All channels overview
      return this.getAllChannelsStats(sessionId, includeTimeSeries, includeInsights);
    }
  }

  private getSingleChannelStats(
    channel: string,
    sessionId?: string,
    includeTimeSeries: boolean = false,
    includeInsights: boolean = false
  ): any {
    // Base stats query
    let statsSQL = `
      SELECT 
        ? as channel,
        COUNT(*) as total_items,
        COUNT(DISTINCT session_id) as unique_sessions,
        MAX(updated_at) as last_activity,
        MIN(created_at) as first_activity,
        SUM(size) as total_size,
        AVG(size) as avg_size,
        SUM(CASE WHEN is_private = 0 THEN 1 ELSE 0 END) as public_items,
        SUM(CASE WHEN is_private = 1 THEN 1 ELSE 0 END) as private_items
      FROM context_items
      WHERE channel = ?
    `;
    const statsParams: any[] = [channel, channel];

    if (sessionId) {
      statsSQL += ' AND (is_private = 0 OR session_id = ?)';
      statsParams.push(sessionId);
    }

    const stats = this.db.prepare(statsSQL).get(...statsParams) as any;

    // Category distribution
    let categorySQL = `
      SELECT 
        COALESCE(category, 'uncategorized') as category,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM context_items WHERE channel = ?), 2) as percentage
      FROM context_items
      WHERE channel = ?
    `;
    const categoryParams: any[] = [channel, channel];

    if (sessionId) {
      categorySQL += ' AND (is_private = 0 OR session_id = ?)';
      categoryParams.push(sessionId);
    }

    categorySQL += ' GROUP BY category ORDER BY count DESC';

    const categoryDistribution = this.db.prepare(categorySQL).all(...categoryParams) as any[];

    // Priority distribution
    let prioritySQL = `
      SELECT 
        priority,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM context_items WHERE channel = ?), 2) as percentage
      FROM context_items
      WHERE channel = ?
    `;
    const priorityParams: any[] = [channel, channel];

    if (sessionId) {
      prioritySQL += ' AND (is_private = 0 OR session_id = ?)';
      priorityParams.push(sessionId);
    }

    prioritySQL += ' GROUP BY priority ORDER BY count DESC';

    const priorityDistribution = this.db.prepare(prioritySQL).all(...priorityParams) as any[];

    // Top contributors
    let contributorsSQL = `
      SELECT 
        session_id,
        COUNT(*) as item_count,
        MAX(updated_at) as last_contribution
      FROM context_items
      WHERE channel = ?
    `;
    const contributorsParams: any[] = [channel];

    if (sessionId) {
      contributorsSQL += ' AND (is_private = 0 OR session_id = ?)';
      contributorsParams.push(sessionId);
    }

    contributorsSQL += ' GROUP BY session_id ORDER BY item_count DESC LIMIT 5';

    const topContributors = this.db.prepare(contributorsSQL).all(...contributorsParams) as any[];

    // Activity metrics
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let activitySQL = `
      SELECT 
        SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as items_last_24h,
        SUM(CASE WHEN updated_at > ? THEN 1 ELSE 0 END) as updates_last_24h,
        SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as items_last_week,
        SUM(CASE WHEN updated_at > ? THEN 1 ELSE 0 END) as updates_last_week
      FROM context_items
      WHERE channel = ?
    `;
    const activityParams: any[] = [oneDayAgo, oneDayAgo, oneWeekAgo, oneWeekAgo, channel];

    if (sessionId) {
      activitySQL += ' AND (is_private = 0 OR session_id = ?)';
      activityParams.push(sessionId);
    }

    const activityStats = this.db.prepare(activitySQL).get(...activityParams) as any;

    // Build result
    const result: any = {
      channel,
      stats,
      categoryDistribution,
      priorityDistribution,
      topContributors,
      activityStats,
    };

    // Add time series if requested
    if (includeTimeSeries) {
      const hourlySQL = `
        SELECT 
          strftime('%H', created_at) as hour,
          COUNT(*) as count
        FROM context_items
        WHERE channel = ?
        ${sessionId ? ' AND (is_private = 0 OR session_id = ?)' : ''}
        GROUP BY hour
        ORDER BY hour
      `;
      const hourlyParams = sessionId ? [channel, sessionId] : [channel];
      result.hourlyActivity = this.db.prepare(hourlySQL).all(...hourlyParams) as any[];

      const dailySQL = `
        SELECT 
          strftime('%Y-%m-%d', created_at) as date,
          COUNT(*) as count
        FROM context_items
        WHERE channel = ?
        ${sessionId ? ' AND (is_private = 0 OR session_id = ?)' : ''}
        GROUP BY date
        ORDER BY date DESC
        LIMIT 30
      `;
      const dailyParams = sessionId ? [channel, sessionId] : [channel];
      result.dailyActivity = this.db.prepare(dailySQL).all(...dailyParams) as any[];
    }

    // Add insights if requested
    if (includeInsights) {
      result.insights = this.generateChannelInsights(
        channel,
        stats,
        activityStats,
        categoryDistribution
      );
    }

    return result;
  }

  private getAllChannelsStats(
    sessionId?: string,
    _includeTimeSeries: boolean = false,
    includeInsights: boolean = false
  ): any {
    // Overall stats
    let overallSQL = `
      SELECT 
        COUNT(DISTINCT channel) as total_channels,
        COUNT(*) as total_items,
        COUNT(DISTINCT session_id) as total_sessions,
        SUM(size) as total_size,
        AVG(size) as avg_size_per_item
      FROM context_items
    `;
    const overallParams: any[] = [];

    if (sessionId) {
      overallSQL += ' WHERE (is_private = 0 OR session_id = ?)';
      overallParams.push(sessionId);
    }

    const overallStats = this.db.prepare(overallSQL).get(...overallParams) as any;

    // Channel rankings
    let rankingSQL = `
      SELECT 
        channel,
        COUNT(*) as item_count,
        SUM(size) as total_size,
        MAX(updated_at) as last_activity,
        COUNT(DISTINCT session_id) as session_count,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM context_items${
          sessionId ? ' WHERE (is_private = 0 OR session_id = ?)' : ''
        }), 2) as percentage_of_total
      FROM context_items
    `;
    const rankingParams: any[] = [];

    if (sessionId) {
      rankingSQL += ' WHERE (is_private = 0 OR session_id = ?)';
      rankingParams.push(sessionId);
      rankingParams.unshift(sessionId); // For the subquery
    }

    rankingSQL += ' GROUP BY channel ORDER BY item_count DESC';

    const channelRankings = this.db.prepare(rankingSQL).all(...rankingParams) as any[];

    // Health metrics
    const healthMetrics = channelRankings.map(ch => {
      const daysSinceActivity = Math.floor(
        (Date.now() - new Date(ch.last_activity).getTime()) / (1000 * 60 * 60 * 24)
      );
      const avgItemsPerSession = ch.item_count / ch.session_count;

      return {
        channel: ch.channel,
        health_score: this.calculateHealthScore(
          daysSinceActivity,
          avgItemsPerSession,
          ch.item_count
        ),
        days_since_activity: daysSinceActivity,
        avg_items_per_session: avgItemsPerSession,
      };
    });

    // Channel relationships
    const relationshipSQL = `
      SELECT 
        c1.channel as channel1,
        c2.channel as channel2,
        COUNT(DISTINCT c1.session_id) as shared_sessions
      FROM context_items c1
      JOIN context_items c2 ON c1.session_id = c2.session_id AND c1.channel < c2.channel
      ${sessionId ? 'WHERE (c1.is_private = 0 OR c1.session_id = ?) AND (c2.is_private = 0 OR c2.session_id = ?)' : ''}
      GROUP BY c1.channel, c2.channel
      HAVING shared_sessions > 1
      ORDER BY shared_sessions DESC
      LIMIT 10
    `;
    const relationshipParams = sessionId ? [sessionId, sessionId] : [];
    const channelRelationships = this.db
      .prepare(relationshipSQL)
      .all(...relationshipParams) as any[];

    const result: any = {
      overallStats,
      channelRankings,
      healthMetrics,
      channelRelationships,
    };

    if (includeInsights) {
      result.insights = this.generateOverallInsights(channelRankings, healthMetrics);
    }

    return result;
  }

  private calculateHealthScore(
    daysSinceActivity: number,
    avgItemsPerSession: number,
    totalItems: number
  ): number {
    // Health score based on activity recency, engagement, and size
    let score = 100;

    // Penalize for inactivity
    if (daysSinceActivity > 30) score -= 30;
    else if (daysSinceActivity > 14) score -= 20;
    else if (daysSinceActivity > 7) score -= 10;

    // Reward for engagement
    if (avgItemsPerSession > 10) score += 10;
    else if (avgItemsPerSession > 5) score += 5;

    // Reward for size
    if (totalItems > 100) score += 10;
    else if (totalItems > 50) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  private generateChannelInsights(
    channel: string,
    stats: any,
    activityStats: any,
    categoryDistribution: any[]
  ): string[] {
    const insights: string[] = [];

    // Activity insights
    if (activityStats.items_last_24h === 0 && activityStats.updates_last_24h === 0) {
      insights.push(`Channel "${channel}" has been inactive for the last 24 hours`);
    }

    if (activityStats.items_last_week > activityStats.items_last_24h * 7) {
      insights.push(`Channel "${channel}" shows declining activity compared to weekly average`);
    }

    // Category insights
    if (categoryDistribution.length > 0) {
      const topCategory = categoryDistribution[0];
      if (topCategory.percentage > 60) {
        insights.push(
          `Channel "${channel}" is heavily focused on "${topCategory.category}" (${topCategory.percentage}%)`
        );
      }
    }

    // Size insights
    if (stats.avg_size > 10000) {
      insights.push(
        `Channel "${channel}" contains large items (avg ${Math.round(stats.avg_size / 1024)}KB)`
      );
    }

    return insights;
  }

  private generateOverallInsights(channelRankings: any[], healthMetrics: any[]): string[] {
    const insights: string[] = [];

    // Channel concentration
    if (channelRankings.length > 0) {
      const top3Percentage = channelRankings
        .slice(0, 3)
        .reduce((sum, ch) => sum + parseFloat(ch.percentage_of_total), 0);
      if (top3Percentage > 80) {
        insights.push(
          `Top 3 channels contain ${top3Percentage.toFixed(1)}% of all items - consider better distribution`
        );
      }
    }

    // Health insights
    const unhealthyChannels = healthMetrics.filter(m => m.health_score < 50);
    if (unhealthyChannels.length > 0) {
      insights.push(
        `${unhealthyChannels.length} channels show signs of low health (inactive or low engagement)`
      );
    }

    // Activity patterns
    const inactiveChannels = healthMetrics.filter(m => m.days_since_activity > 30);
    if (inactiveChannels.length > 0) {
      insights.push(`${inactiveChannels.length} channels have been inactive for over 30 days`);
    }

    return insights;
  }

  // Reassign channel for context items
  reassignChannel(options: {
    keys?: string[];
    keyPattern?: string;
    fromChannel?: string;
    toChannel: string;
    sessionId: string;
    category?: string;
    priorities?: string[];
    dryRun?: boolean;
  }): {
    itemsAffected: number;
    itemsMoved: Array<{
      key: string;
      oldChannel: string;
      newChannel: string;
    }>;
    errors?: string[];
  } {
    const {
      keys,
      keyPattern,
      fromChannel,
      toChannel,
      sessionId,
      category,
      priorities,
      dryRun = false,
    } = options;

    const errors: string[] = [];
    const itemsMoved: Array<{ key: string; oldChannel: string; newChannel: string }> = [];

    try {
      // Start transaction
      this.db.prepare('BEGIN TRANSACTION').run();

      // Build the base query
      let sql = 'SELECT id, key, channel FROM context_items WHERE session_id = ?';
      const params: any[] = [sessionId];

      // Add conditions based on parameters
      if (keys && keys.length > 0) {
        const placeholders = keys.map(() => '?').join(',');
        sql += ` AND key IN (${placeholders})`;
        params.push(...keys);
      } else if (keyPattern) {
        // Convert wildcard pattern to SQL GLOB pattern
        sql += ' AND key GLOB ?';
        params.push(keyPattern);
      } else if (fromChannel) {
        sql += ' AND channel = ?';
        params.push(fromChannel);
      }

      // Add category filter
      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      // Add priority filter
      if (priorities && priorities.length > 0) {
        const placeholders = priorities.map(() => '?').join(',');
        sql += ` AND priority IN (${placeholders})`;
        params.push(...priorities);
      }

      // Get items to be moved
      const itemsToMove = this.db.prepare(sql).all(...params) as any[];

      if (itemsToMove.length === 0) {
        this.db.prepare('ROLLBACK').run();
        return {
          itemsAffected: 0,
          itemsMoved: [],
          errors: ['No items found matching the specified criteria'],
        };
      }

      // Prepare response data
      for (const item of itemsToMove) {
        itemsMoved.push({
          key: item.key,
          oldChannel: item.channel,
          newChannel: toChannel,
        });
      }

      // If dry run, rollback and return preview
      if (dryRun) {
        this.db.prepare('ROLLBACK').run();
        return {
          itemsAffected: itemsToMove.length,
          itemsMoved,
        };
      }

      // Perform the update
      const updateSql = `
        UPDATE context_items 
        SET channel = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${itemsToMove.map(() => '?').join(',')})
      `;
      const updateParams = [toChannel, ...itemsToMove.map(item => item.id)];
      const result = this.db.prepare(updateSql).run(...updateParams);

      // Commit transaction
      this.db.prepare('COMMIT').run();

      return {
        itemsAffected: result.changes,
        itemsMoved,
      };
    } catch (error: any) {
      // Rollback on error
      try {
        this.db.prepare('ROLLBACK').run();
      } catch (_e) {
        // Ignore rollback errors
      }

      errors.push(`Database error: ${error.message}`);
      return {
        itemsAffected: 0,
        itemsMoved: [],
        errors,
      };
    }
  }

  // Batch Operations

  /**
   * Save multiple context items in a single transaction
   */
  batchSave(
    sessionId: string,
    items: CreateContextItemInput[],
    options: { updateExisting?: boolean } = {}
  ): {
    results: Array<{
      index: number;
      key: string;
      success: boolean;
      action?: string;
      id?: string;
      size?: number;
      error?: string;
    }>;
    totalSize: number;
  } {
    const { updateExisting = true } = options;
    const results: Array<{
      index: number;
      key: string;
      success: boolean;
      action?: string;
      id?: string;
      size?: number;
      error?: string;
    }> = [];
    let totalSize = 0;

    // Prepare statements
    const checkStmt = this.db.prepare(
      'SELECT id FROM context_items WHERE session_id = ? AND key = ?'
    );
    const insertStmt = this.db.prepare(`
      INSERT INTO context_items (
        id, session_id, key, value, category, priority, channel, 
        created_at, updated_at, size, is_private
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStmt = this.db.prepare(`
      UPDATE context_items 
      SET value = ?, category = ?, priority = ?, channel = ?, 
          updated_at = ?, size = ?
      WHERE session_id = ? AND key = ?
    `);

    // Get session default channel
    const sessionStmt = this.db.prepare('SELECT default_channel FROM sessions WHERE id = ?');
    const session = sessionStmt.get(sessionId) as any;
    const defaultChannel = session?.default_channel || 'general';

    items.forEach((item, index) => {
      try {
        // Skip items with missing required fields
        if (!item.key || !item.value) {
          throw new Error('Missing required fields');
        }

        const size = this.calculateSize(item.value);
        totalSize += size;

        // Check if key exists
        const existing = checkStmt.get(sessionId, item.key);

        if (existing && updateExisting) {
          // Update existing
          const now = ensureSQLiteFormat(new Date().toISOString());
          updateStmt.run(
            item.value,
            item.category || null,
            item.priority || 'normal',
            item.channel || defaultChannel,
            now,
            size,
            sessionId,
            item.key
          );

          results.push({
            index,
            key: item.key,
            success: true,
            action: 'updated',
            size,
          });
        } else if (!existing) {
          // Insert new
          const id = this.generateId();
          const now = ensureSQLiteFormat(new Date().toISOString());

          insertStmt.run(
            id,
            sessionId,
            item.key,
            item.value,
            item.category || null,
            item.priority || 'normal',
            item.channel || defaultChannel,
            now,
            now,
            size,
            item.isPrivate ? 1 : 0
          );

          results.push({
            index,
            key: item.key,
            success: true,
            action: 'created',
            id,
            size,
          });
        } else {
          // Existing but updateExisting is false
          throw new Error('Item with this key already exists');
        }
      } catch (error: any) {
        results.push({
          index,
          key: item.key,
          success: false,
          error: error.message,
        });
      }
    });

    return { results, totalSize };
  }

  /**
   * Delete multiple context items in a single transaction
   */
  batchDelete(
    sessionId: string,
    options: { keys?: string[]; keyPattern?: string }
  ): {
    results?: Array<{
      index: number;
      key: string;
      deleted: boolean;
      count: number;
      error?: string;
    }>;
    totalDeleted: number;
  } {
    const { keys, keyPattern } = options;
    let totalDeleted = 0;

    if (keys) {
      // Delete by specific keys
      const deleteStmt = this.db.prepare(
        'DELETE FROM context_items WHERE session_id = ? AND key = ?'
      );
      const results: Array<{
        index: number;
        key: string;
        deleted: boolean;
        count: number;
        error?: string;
      }> = [];

      keys.forEach((key, index) => {
        if (key && key.trim()) {
          const result = deleteStmt.run(sessionId, key);
          const deleted = result.changes > 0;

          results.push({
            index,
            key,
            deleted,
            count: result.changes,
          });

          totalDeleted += result.changes;
        } else {
          results.push({
            index,
            key: key || 'undefined',
            deleted: false,
            count: 0,
            error: 'Key cannot be empty',
          });
        }
      });

      return { results, totalDeleted };
    } else if (keyPattern) {
      // Delete by pattern
      const sqlPattern = keyPattern.replace(/\*/g, '%').replace(/\?/g, '_');
      const result = this.db
        .prepare('DELETE FROM context_items WHERE session_id = ? AND key LIKE ?')
        .run(sessionId, sqlPattern);

      totalDeleted = result.changes;
      return { totalDeleted };
    }

    return { totalDeleted: 0 };
  }

  /**
   * Update multiple context items in a single transaction
   */
  batchUpdate(
    sessionId: string,
    updates: Array<{
      key: string;
      value?: string;
      category?: string;
      priority?: string;
      channel?: string;
    }>
  ): {
    results: Array<{
      index: number;
      key: string;
      updated: boolean;
      fields?: string[];
      error?: string;
    }>;
  } {
    const results: Array<{
      index: number;
      key: string;
      updated: boolean;
      fields?: string[];
      error?: string;
    }> = [];

    updates.forEach((update, index) => {
      try {
        // Build dynamic UPDATE statement
        const setClauses: string[] = [];
        const values: any[] = [];

        if (update.value !== undefined) {
          setClauses.push('value = ?');
          values.push(update.value);
          setClauses.push('size = ?');
          values.push(this.calculateSize(update.value));
        }
        if (update.category !== undefined) {
          setClauses.push('category = ?');
          values.push(update.category);
        }
        if (update.priority !== undefined) {
          setClauses.push('priority = ?');
          values.push(update.priority);
        }
        if (update.channel !== undefined) {
          setClauses.push('channel = ?');
          values.push(update.channel);
        }

        if (setClauses.length === 0) {
          throw new Error('No updates provided');
        }

        setClauses.push('updated_at = ?');
        values.push(ensureSQLiteFormat(new Date().toISOString()));

        const sql = `
          UPDATE context_items 
          SET ${setClauses.join(', ')}
          WHERE session_id = ? AND key = ?
        `;

        values.push(sessionId, update.key);

        const result = this.db.prepare(sql).run(...values);

        if (result.changes === 0) {
          throw new Error('Item not found');
        }

        results.push({
          index,
          key: update.key,
          updated: true,
          fields: Object.keys(update).filter(k => k !== 'key' && (update as any)[k] !== undefined),
        });
      } catch (error: any) {
        results.push({
          index,
          key: update.key,
          updated: false,
          error: error.message,
        });
      }
    });

    return { results };
  }

  /**
   * Get items for dry run operations
   */
  getDryRunItems(sessionId: string, options: { keys?: string[]; keyPattern?: string }): any[] {
    const { keys, keyPattern } = options;
    let items: any[] = [];

    if (keys) {
      const stmt = this.db.prepare(`
        SELECT key, value, category, priority, channel 
        FROM context_items 
        WHERE session_id = ? AND key = ?
      `);

      keys.forEach(key => {
        if (key && key.trim()) {
          const item = stmt.get(sessionId, key) as any;
          if (item) {
            items.push({
              ...item,
              value: item.value.substring(0, 50) + (item.value.length > 50 ? '...' : ''),
            });
          }
        }
      });
    } else if (keyPattern) {
      const sqlPattern = keyPattern.replace(/\*/g, '%').replace(/\?/g, '_');
      const stmt = this.db.prepare(`
        SELECT key, value, category, priority, channel 
        FROM context_items 
        WHERE session_id = ? AND key LIKE ?
      `);

      const foundItems = stmt.all(sessionId, sqlPattern) as any[];
      items = foundItems.map(item => ({
        ...item,
        value: item.value.substring(0, 50) + (item.value.length > 50 ? '...' : ''),
      }));
    }

    return items;
  }

  // Context Relationships Methods

  createRelationship(params: {
    sessionId: string;
    sourceKey: string;
    targetKey: string;
    relationship: string;
    metadata?: any;
  }): { id: string; created: boolean; error?: string } {
    const { sessionId, sourceKey, targetKey, relationship, metadata } = params;

    // Validate relationship type
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
      'has_task',
      'documented_in',
      'serves',
      'leads_to',
    ];

    if (!validTypes.includes(relationship)) {
      return { id: '', created: false, error: `Invalid relationship type: ${relationship}` };
    }

    // Check if both items exist
    const sourceExists = this.db
      .prepare('SELECT 1 FROM context_items WHERE session_id = ? AND key = ?')
      .get(sessionId, sourceKey);
    const targetExists = this.db
      .prepare('SELECT 1 FROM context_items WHERE session_id = ? AND key = ?')
      .get(sessionId, targetKey);

    if (!sourceExists || !targetExists) {
      const missingKeys = [];
      if (!sourceExists) missingKeys.push(sourceKey);
      if (!targetExists) missingKeys.push(targetKey);
      return {
        id: '',
        created: false,
        error: `The following items do not exist: ${missingKeys.join(', ')}`,
      };
    }

    try {
      const relationshipId = require('uuid').v4();
      const metadataStr = metadata ? JSON.stringify(metadata) : null;

      this.db
        .prepare(
          `INSERT INTO context_relationships (id, session_id, from_key, to_key, relationship_type, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(relationshipId, sessionId, sourceKey, targetKey, relationship, metadataStr);

      return { id: relationshipId, created: true };
    } catch (error: any) {
      if (error.message.includes('UNIQUE constraint failed')) {
        return { id: '', created: false, error: 'Relationship already exists' };
      }
      throw error;
    }
  }

  getRelatedItems(params: {
    sessionId: string;
    key: string;
    relationship?: string;
    depth?: number;
    direction?: 'outgoing' | 'incoming' | 'both';
  }): {
    outgoing: any[];
    incoming: any[];
    graph?: any;
  } {
    const { sessionId, key, relationship, depth = 1, direction = 'both' } = params;

    const result: { outgoing: any[]; incoming: any[]; graph?: any } = {
      outgoing: [],
      incoming: [],
    };

    // Get direct relationships
    if (direction === 'outgoing' || direction === 'both') {
      let outgoingSql = `
        SELECT r.*, ci.value, ci.category, ci.priority
        FROM context_relationships r
        JOIN context_items ci ON ci.key = r.to_key AND ci.session_id = r.session_id
        WHERE r.session_id = ? AND r.from_key = ?
      `;
      const outgoingParams: any[] = [sessionId, key];

      if (relationship) {
        outgoingSql += ' AND r.relationship_type = ?';
        outgoingParams.push(relationship);
      }

      const outgoingRels = this.db.prepare(outgoingSql).all(...outgoingParams) as any[];
      result.outgoing = outgoingRels.map(r => ({
        key: r.to_key,
        value: r.value,
        category: r.category,
        priority: r.priority,
        relationshipType: r.relationship_type,
        relationshipId: r.id,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        direction: 'outgoing',
      }));
    }

    if (direction === 'incoming' || direction === 'both') {
      let incomingSql = `
        SELECT r.*, ci.value, ci.category, ci.priority
        FROM context_relationships r
        JOIN context_items ci ON ci.key = r.from_key AND ci.session_id = r.session_id
        WHERE r.session_id = ? AND r.to_key = ?
      `;
      const incomingParams: any[] = [sessionId, key];

      if (relationship) {
        incomingSql += ' AND r.relationship_type = ?';
        incomingParams.push(relationship);
      }

      const incomingRels = this.db.prepare(incomingSql).all(...incomingParams) as any[];
      result.incoming = incomingRels.map(r => ({
        key: r.from_key,
        value: r.value,
        category: r.category,
        priority: r.priority,
        relationshipType: r.relationship_type,
        relationshipId: r.id,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        direction: 'incoming',
      }));
    }

    // Handle depth traversal if depth > 1
    if (depth > 1) {
      const visited = new Set<string>();
      const relationships: any[] = [];
      const nodes = new Map<string, any>();

      // Add the starting node
      const startItem = this.db
        .prepare('SELECT * FROM context_items WHERE session_id = ? AND key = ?')
        .get(sessionId, key) as any;

      if (startItem) {
        nodes.set(key, {
          id: key,
          label: startItem.value,
          type: startItem.category || 'default',
        });
      }

      // Traverse function
      const traverse = (currentKey: string, currentDepth: number, path: string[]) => {
        if (currentDepth > depth || visited.has(currentKey)) return;
        visited.add(currentKey);

        // Get outgoing relationships
        let sql = `
          SELECT r.*, ci.value, ci.category
          FROM context_relationships r
          JOIN context_items ci ON ci.key = r.to_key AND ci.session_id = r.session_id
          WHERE r.session_id = ? AND r.from_key = ?
        `;
        const params: any[] = [sessionId, currentKey];

        if (relationship) {
          sql += ' AND r.relationship_type = ?';
          params.push(relationship);
        }

        const rels = this.db.prepare(sql).all(...params) as any[];

        rels.forEach(rel => {
          // Add node if not exists
          if (!nodes.has(rel.to_key)) {
            nodes.set(rel.to_key, {
              id: rel.to_key,
              label: rel.value,
              type: rel.category || 'default',
            });
          }

          // Add relationship
          relationships.push({
            path: [...path, currentKey],
            from: currentKey,
            to: rel.to_key,
            type: rel.relationship_type,
            metadata: rel.metadata ? JSON.parse(rel.metadata) : null,
            depth: currentDepth,
          });

          // Detect cycles
          if (path.includes(rel.to_key)) {
            // Cycle detected, don't traverse deeper
            return;
          }

          // Traverse deeper
          traverse(rel.to_key, currentDepth + 1, [...path, currentKey]);
        });

        // Also get incoming relationships if direction is 'both'
        if (direction === 'both') {
          let inSql = `
            SELECT r.*, ci.value, ci.category
            FROM context_relationships r
            JOIN context_items ci ON ci.key = r.from_key AND ci.session_id = r.session_id
            WHERE r.session_id = ? AND r.to_key = ?
          `;
          const inParams: any[] = [sessionId, currentKey];

          if (relationship) {
            inSql += ' AND r.relationship_type = ?';
            inParams.push(relationship);
          }

          const inRels = this.db.prepare(inSql).all(...inParams) as any[];

          inRels.forEach(rel => {
            if (!nodes.has(rel.from_key)) {
              nodes.set(rel.from_key, {
                id: rel.from_key,
                label: rel.value,
                type: rel.category || 'default',
              });
            }

            relationships.push({
              path: [...path, currentKey],
              from: rel.from_key,
              to: currentKey,
              type: rel.relationship_type,
              metadata: rel.metadata ? JSON.parse(rel.metadata) : null,
              depth: currentDepth,
            });

            if (!path.includes(rel.from_key)) {
              traverse(rel.from_key, currentDepth + 1, [...path, currentKey]);
            }
          });
        }
      };

      traverse(key, 1, []);

      // Build graph structure
      result.graph = {
        nodes: Array.from(nodes.values()),
        edges: relationships.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          label: r.type.replace(/_/g, ' '),
          metadata: r.metadata,
        })),
        relationships: relationships,
      };
    }

    return result;
  }

  deleteRelationship(params: {
    sessionId: string;
    sourceKey: string;
    targetKey: string;
    relationship: string;
  }): { deleted: boolean } {
    const { sessionId, sourceKey, targetKey, relationship } = params;

    const result = this.db
      .prepare(
        `DELETE FROM context_relationships 
         WHERE session_id = ? AND from_key = ? AND to_key = ? AND relationship_type = ?`
      )
      .run(sessionId, sourceKey, targetKey, relationship);

    return { deleted: result.changes > 0 };
  }

  deleteAllRelationshipsForItem(sessionId: string, key: string): { deletedCount: number } {
    const result = this.db
      .prepare(
        `DELETE FROM context_relationships 
         WHERE session_id = ? AND (from_key = ? OR to_key = ?)`
      )
      .run(sessionId, key, key);

    return { deletedCount: result.changes };
  }

  getRelationshipStats(sessionId: string): any {
    const totalRelationships = (
      this.db
        .prepare('SELECT COUNT(*) as count FROM context_relationships WHERE session_id = ?')
        .get(sessionId) as any
    ).count;

    const byType = this.db
      .prepare(
        `SELECT relationship_type AS type, COUNT(*) as count 
         FROM context_relationships 
         WHERE session_id = ? 
         GROUP BY relationship_type
         ORDER BY count DESC`
      )
      .all(sessionId) as any[];

    const mostConnected = this.db
      .prepare(
        `SELECT key, COUNT(*) as connection_count
         FROM (
           SELECT from_key as key FROM context_relationships WHERE session_id = ?
           UNION ALL
           SELECT to_key as key FROM context_relationships WHERE session_id = ?
         )
         GROUP BY key
         ORDER BY connection_count DESC
         LIMIT 10`
      )
      .all(sessionId, sessionId) as any[];

    const orphanedItems = this.db
      .prepare(
        `SELECT key, value FROM context_items
         WHERE session_id = ?
         AND key NOT IN (
           SELECT from_key FROM context_relationships WHERE session_id = ?
           UNION
           SELECT to_key FROM context_relationships WHERE session_id = ?
         )
         LIMIT 20`
      )
      .all(sessionId, sessionId, sessionId) as any[];

    return {
      totalRelationships,
      byType,
      mostConnected,
      orphanedItems,
    };
  }

  findCycles(sessionId: string): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycle = (key: string, path: string[]): void => {
      visited.add(key);
      recursionStack.add(key);

      const neighbors = this.db
        .prepare('SELECT to_key FROM context_relationships WHERE session_id = ? AND from_key = ?')
        .all(sessionId, key) as any[];

      for (const neighbor of neighbors) {
        if (recursionStack.has(neighbor.to_key)) {
          // Found cycle
          const cycleStart = path.indexOf(neighbor.to_key);
          if (cycleStart !== -1) {
            cycles.push([...path.slice(cycleStart), neighbor.to_key]);
          } else {
            // The cycle doesn't include the current path, which means we found the target node
            // but it's not in our current path. This can happen when the cycle was entered
            // from a different starting point.
            cycles.push([neighbor.to_key, key, neighbor.to_key]);
          }
        } else if (!visited.has(neighbor.to_key)) {
          detectCycle(neighbor.to_key, [...path, neighbor.to_key]);
        }
      }

      recursionStack.delete(key);
    };

    // Get all unique keys that have relationships
    const allKeys = this.db
      .prepare(
        `SELECT DISTINCT key FROM (
           SELECT from_key as key FROM context_relationships WHERE session_id = ?
           UNION
           SELECT to_key as key FROM context_relationships WHERE session_id = ?
         )`
      )
      .all(sessionId, sessionId) as any[];

    allKeys.forEach(item => {
      if (!visited.has(item.key)) {
        detectCycle(item.key, [item.key]);
      }
    });

    return cycles;
  }
}
