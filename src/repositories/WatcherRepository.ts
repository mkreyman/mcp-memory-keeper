import { DatabaseManager } from '../utils/database';
import { v4 as uuidv4 } from 'uuid';
import { ensureSQLiteFormat } from '../utils/timestamps';

export interface WatcherFilters {
  keys?: string[];
  categories?: string[];
  channels?: string[];
  priorities?: string[];
}

export interface Watcher {
  id: string;
  sessionId?: string;
  filters: WatcherFilters;
  lastSequence: number;
  createdAt: string;
  lastPollAt?: string;
  expiresAt: string;
  metadata?: any;
  isActive: boolean;
}

export interface ContextChange {
  sequenceId: number;
  sessionId: string;
  itemId: string;
  key: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  oldValue?: string;
  newValue?: string;
  oldMetadata?: string;
  newMetadata?: string;
  category?: string;
  priority?: string;
  channel?: string;
  sizeDelta: number;
  createdAt: string;
  createdBy?: string;
}

export class WatcherRepository {
  constructor(private db: DatabaseManager) {}

  createWatcher(params: { sessionId?: string; filters?: WatcherFilters; ttl?: number }): Watcher {
    const id = `watch_${uuidv4().substring(0, 8)}`;
    const now = new Date();
    const ttlSeconds = params.ttl || 3600; // Default 1 hour
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    // Get current max sequence number
    const maxSeqQuery = params.sessionId
      ? 'SELECT MAX(sequence_id) as max_seq FROM context_changes WHERE session_id = ?'
      : 'SELECT MAX(sequence_id) as max_seq FROM context_changes';

    const maxSeqResult = params.sessionId
      ? (this.db.getDatabase().prepare(maxSeqQuery).get(params.sessionId) as any)
      : (this.db.getDatabase().prepare(maxSeqQuery).get() as any);

    const currentSequence = maxSeqResult?.max_seq || 0;

    const stmt = this.db.getDatabase().prepare(`
      INSERT INTO context_watchers (
        id, session_id, filter_keys, filter_categories, filter_channels, filter_priorities,
        last_sequence, created_at, expires_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.sessionId || null,
      JSON.stringify(params.filters?.keys || []),
      JSON.stringify(params.filters?.categories || []),
      JSON.stringify(params.filters?.channels || []),
      JSON.stringify(params.filters?.priorities || []),
      currentSequence,
      ensureSQLiteFormat(now.toISOString()),
      ensureSQLiteFormat(expiresAt.toISOString()),
      1
    );

    return {
      id,
      sessionId: params.sessionId,
      filters: params.filters || {},
      lastSequence: currentSequence,
      createdAt: ensureSQLiteFormat(now.toISOString()),
      expiresAt: ensureSQLiteFormat(expiresAt.toISOString()),
      isActive: true,
    };
  }

  getWatcher(watcherId: string): Watcher | null {
    const watcher = this.db
      .getDatabase()
      .prepare(
        `
      SELECT * FROM context_watchers WHERE id = ?
    `
      )
      .get(watcherId) as any;

    if (!watcher) {
      return null;
    }

    return this.mapWatcherFromDb(watcher);
  }

  pollChanges(
    watcherId: string,
    limit: number = 100
  ): {
    changes: ContextChange[];
    lastSequence: number;
    hasMore: boolean;
    watcherStatus: 'active' | 'expired' | 'deleted';
  } {
    const watcher = this.getWatcher(watcherId);

    if (!watcher) {
      return {
        changes: [],
        lastSequence: 0,
        hasMore: false,
        watcherStatus: 'deleted',
      };
    }

    // Check if stopped
    if (!watcher.isActive) {
      return {
        changes: [],
        lastSequence: watcher.lastSequence,
        hasMore: false,
        watcherStatus: 'expired', // This is what the handler expects for stopped watchers
      };
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(watcher.expiresAt);
    if (now > expiresAt) {
      // Mark as inactive if expired
      this.db
        .getDatabase()
        .prepare('UPDATE context_watchers SET is_active = 0 WHERE id = ?')
        .run(watcherId);
      return {
        changes: [],
        lastSequence: watcher.lastSequence,
        hasMore: false,
        watcherStatus: 'expired',
      };
    }

    // Build query for changes
    let query = `
      SELECT * FROM context_changes 
      WHERE sequence_id > ?
    `;
    const params: any[] = [watcher.lastSequence];

    // Apply session filter
    if (watcher.sessionId) {
      query += ' AND session_id = ?';
      params.push(watcher.sessionId);
    }

    // Apply filters
    const filterConditions: string[] = [];

    // Key filters with wildcard support
    if (watcher.filters.keys && watcher.filters.keys.length > 0) {
      const keyConditions = watcher.filters.keys
        .map((pattern: string) => {
          const sqlPattern = pattern.replace(/\*/g, '%').replace(/\?/g, '_');
          params.push(sqlPattern);
          return 'key LIKE ?';
        })
        .join(' OR ');
      filterConditions.push(`(${keyConditions})`);
    }

    // Category filters
    if (watcher.filters.categories && watcher.filters.categories.length > 0) {
      const placeholders = watcher.filters.categories.map(() => '?').join(',');
      filterConditions.push(`category IN (${placeholders})`);
      params.push(...watcher.filters.categories);
    }

    // Channel filters
    if (watcher.filters.channels && watcher.filters.channels.length > 0) {
      const placeholders = watcher.filters.channels.map(() => '?').join(',');
      filterConditions.push(`channel IN (${placeholders})`);
      params.push(...watcher.filters.channels);
    }

    // Priority filters
    if (watcher.filters.priorities && watcher.filters.priorities.length > 0) {
      const placeholders = watcher.filters.priorities.map(() => '?').join(',');
      filterConditions.push(`priority IN (${placeholders})`);
      params.push(...watcher.filters.priorities);
    }

    if (filterConditions.length > 0) {
      query += ' AND (' + filterConditions.join(' AND ') + ')';
    }

    // Add privacy filter if watching across sessions
    if (!watcher.sessionId) {
      query += ` AND EXISTS (
        SELECT 1 FROM context_items ci 
        WHERE ci.id = context_changes.item_id 
        AND ci.is_private = 0
      )`;
    }

    query += ' ORDER BY sequence_id ASC LIMIT ?';
    params.push(limit + 1); // Get one extra to check hasMore

    const changes = this.db
      .getDatabase()
      .prepare(query)
      .all(...params) as any[];

    const hasMore = changes.length > limit;
    if (hasMore) {
      changes.pop(); // Remove the extra one
    }

    let maxSequence = watcher.lastSequence;
    const mappedChanges = changes.map(change => {
      maxSequence = Math.max(maxSequence, change.sequence_id);
      return this.mapChangeFromDb(change);
    });

    // Update watcher's last sequence and extend expiration
    // Always update on poll to extend expiration
    const newExpiry = new Date(Date.now() + 30 * 60 * 1000); // Extend by 30 minutes
    this.db
      .getDatabase()
      .prepare(
        `
        UPDATE context_watchers 
        SET last_sequence = ?, last_poll_at = ?, expires_at = ?
        WHERE id = ?
      `
      )
      .run(
        maxSequence,
        ensureSQLiteFormat(new Date().toISOString()),
        ensureSQLiteFormat(newExpiry.toISOString()),
        watcherId
      );

    return {
      changes: mappedChanges,
      lastSequence: maxSequence,
      hasMore,
      watcherStatus: 'active',
    };
  }

  stopWatcher(watcherId: string): boolean {
    const result = this.db
      .getDatabase()
      .prepare(
        `
      UPDATE context_watchers SET is_active = 0 WHERE id = ?
    `
      )
      .run(watcherId);

    return result.changes > 0;
  }

  listWatchers(sessionId?: string, includeExpired: boolean = false): Watcher[] {
    let query = 'SELECT * FROM context_watchers';
    const conditions: string[] = [];
    const params: any[] = [];

    if (sessionId) {
      conditions.push('session_id = ?');
      params.push(sessionId);
    }

    if (!includeExpired) {
      conditions.push('is_active = 1');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const watchers = this.db
      .getDatabase()
      .prepare(query)
      .all(...params) as any[];
    return watchers.map(w => this.mapWatcherFromDb(w));
  }

  cleanupExpiredWatchers(): number {
    const result = this.db
      .getDatabase()
      .prepare(
        `
      DELETE FROM context_watchers 
      WHERE expires_at < datetime('now') AND is_active = 1
    `
      )
      .run();

    return result.changes;
  }

  private mapWatcherFromDb(row: any): Watcher {
    return {
      id: row.id,
      sessionId: row.session_id || undefined,
      filters: {
        keys: JSON.parse(row.filter_keys || '[]'),
        categories: JSON.parse(row.filter_categories || '[]'),
        channels: JSON.parse(row.filter_channels || '[]'),
        priorities: JSON.parse(row.filter_priorities || '[]'),
      },
      lastSequence: row.last_sequence,
      createdAt: row.created_at,
      lastPollAt: row.last_poll_at || undefined,
      expiresAt: row.expires_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      isActive: row.is_active === 1,
    };
  }

  private mapChangeFromDb(row: any): ContextChange {
    return {
      sequenceId: row.sequence_id,
      sessionId: row.session_id,
      itemId: row.item_id,
      key: row.key,
      operation: row.operation as 'CREATE' | 'UPDATE' | 'DELETE',
      oldValue: row.old_value || undefined,
      newValue: row.new_value || undefined,
      oldMetadata: row.old_metadata || undefined,
      newMetadata: row.new_metadata || undefined,
      category: row.category || undefined,
      priority: row.priority || undefined,
      channel: row.channel || undefined,
      sizeDelta: row.size_delta || 0,
      createdAt: row.created_at,
      createdBy: row.created_by || undefined,
    };
  }
}
