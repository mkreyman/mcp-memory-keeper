import Database from 'better-sqlite3';

/**
 * Helper utilities for managing database behavior in tests
 */
export class DatabaseTestHelper {
  private db: Database.Database;
  private originalTriggers: Map<string, string> = new Map();

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Disable timestamp update triggers to prevent unexpected timestamp updates
   * during tests that are sensitive to update counts.
   */
  disableTimestampTriggers(): void {
    const triggerNames = [
      'update_context_items_timestamp',
      'update_sessions_timestamp',
      'update_retention_policies_timestamp',
      'update_feature_flags_timestamp',
      'increment_sequence_update',
    ];

    for (const triggerName of triggerNames) {
      // Get the trigger definition before dropping it
      const triggerDef = this.db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`)
        .get(triggerName) as any;

      if (triggerDef && triggerDef.sql) {
        this.originalTriggers.set(triggerName, triggerDef.sql);
        // Drop the trigger
        this.db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
      }
    }
  }

  /**
   * Re-enable timestamp update triggers after tests
   */
  enableTimestampTriggers(): void {
    for (const [triggerName, sql] of this.originalTriggers) {
      if (sql) {
        try {
          this.db.exec(sql);
        } catch (error) {
          console.warn(`Failed to recreate trigger ${triggerName}:`, error);
        }
      }
    }
    this.originalTriggers.clear();
  }

  /**
   * Normalize timestamps for comparison in tests.
   * Sets all timestamps to a fixed value to avoid timestamp-based failures.
   */
  normalizeTimestamps(items: any[]): any[] {
    const fixedTimestamp = '2024-01-01T00:00:00.000Z';
    return items.map(item => ({
      ...item,
      created_at: fixedTimestamp,
      updated_at: fixedTimestamp,
    }));
  }

  /**
   * Update an item without triggering timestamp updates.
   * Useful for tests that need to control timestamps precisely.
   */
  updateWithoutTimestamp(
    table: string,
    updates: Record<string, any>,
    where: Record<string, any>
  ): void {
    // Build the UPDATE statement
    const setClauses = Object.keys(updates)
      .map(key => `${key} = ?`)
      .join(', ');

    const whereClauses = Object.keys(where)
      .map(key => `${key} = ?`)
      .join(' AND ');

    const sql = `UPDATE ${table} SET ${setClauses} WHERE ${whereClauses}`;
    const values = [...Object.values(updates), ...Object.values(where)];

    // Temporarily disable triggers
    this.disableTimestampTriggers();

    try {
      this.db.prepare(sql).run(...values);
    } finally {
      // Re-enable triggers
      this.enableTimestampTriggers();
    }
  }

  /**
   * Get counts of items by their modification status
   * Useful for tests that check added vs modified items
   */
  getModificationCounts(
    sessionId: string,
    sinceTimestamp: string
  ): { added: number; modified: number } {
    const added = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM context_items 
         WHERE session_id = ? AND created_at > ?`
      )
      .get(sessionId, sinceTimestamp) as any;

    const modified = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM context_items 
         WHERE session_id = ? 
         AND created_at <= ? 
         AND updated_at > ?`
      )
      .get(sessionId, sinceTimestamp, sinceTimestamp) as any;

    return {
      added: added.count,
      modified: modified.count,
    };
  }

  /**
   * Create a test item with controlled timestamps
   */
  createTestItem(params: {
    id: string;
    sessionId: string;
    key: string;
    value: string;
    createdAt?: string;
    updatedAt?: string;
    category?: string;
    priority?: string;
    channel?: string;
  }): void {
    const {
      id,
      sessionId,
      key,
      value,
      createdAt = new Date().toISOString(),
      updatedAt = createdAt,
      category = null,
      priority = 'normal',
      channel = 'general',
    } = params;

    // Temporarily disable triggers to control timestamps
    this.disableTimestampTriggers();

    try {
      this.db
        .prepare(
          `INSERT INTO context_items 
           (id, session_id, key, value, category, priority, channel, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, sessionId, key, value, category, priority, channel, createdAt, updatedAt);
    } finally {
      this.enableTimestampTriggers();
    }
  }

  /**
   * Helper to check if change tracking triggers are affecting counts
   */
  getChangeTrackingCount(sessionId: string, sinceSequence: number = 0): number {
    try {
      const result = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM context_changes 
           WHERE session_id = ? AND sequence_id > ?`
        )
        .get(sessionId, sinceSequence) as any;
      return result.count;
    } catch {
      // Table might not exist in all test environments
      return 0;
    }
  }

  /**
   * Clear all change tracking data for a clean test state
   */
  clearChangeTracking(sessionId?: string): void {
    try {
      if (sessionId) {
        this.db.prepare('DELETE FROM context_changes WHERE session_id = ?').run(sessionId);
      } else {
        this.db.prepare('DELETE FROM context_changes').run();
      }
    } catch {
      // Table might not exist in all test environments
    }
  }
}
