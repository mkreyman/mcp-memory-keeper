import { DatabaseManager } from './database';
import { v4 as uuidv4 } from 'uuid';

export interface RetentionPolicy {
  id: string;
  name: string;
  enabled?: boolean;

  // Age-based retention
  maxAge?: string; // e.g., "30d", "1y", "6m"

  // Size-based retention
  maxSize?: number; // bytes
  maxItems?: number;

  // Category-specific rules
  categories?: {
    [category: string]: {
      maxAge?: string;
      preserve?: boolean; // never delete
      archiveAfter?: string;
    };
  };

  // Priority-based rules
  preserveHighPriority?: boolean;
  preserveCritical?: boolean;

  // Actions
  action: 'delete' | 'archive' | 'compress';

  // Schedule
  schedule: 'daily' | 'weekly' | 'monthly' | 'manual';
  lastRun?: string;

  // Notifications
  notifyBeforeAction?: boolean;
  dryRun?: boolean;
}

export interface RetentionStats {
  totalItems: number;
  totalSize: number;
  oldestItem: string;
  newestItem: string;
  byCategory: Record<string, { count: number; size: number }>;
  byPriority: Record<string, { count: number; size: number }>;
  eligibleForRetention: {
    items: number;
    size: number;
    savings: number; // percentage
  };
}

export interface RetentionResult {
  policyId: string;
  policyName: string;
  action: string;
  dryRun: boolean;

  processed: {
    items: number;
    size: number;
    sessions: string[];
  };

  saved: {
    size: number;
    items: number;
  };

  errors: string[];
  warnings: string[];

  executionTime: number;
  timestamp: string;
}

export class RetentionManager {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.getDatabase().exec(`
      CREATE TABLE IF NOT EXISTS retention_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        policy_config TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_run TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS retention_logs (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (policy_id) REFERENCES retention_policies(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_retention_logs_policy ON retention_logs(policy_id);
      CREATE INDEX IF NOT EXISTS idx_retention_logs_created ON retention_logs(created_at);
    `);
  }

  // Parse age strings like "30d", "1y", "6m" into Date objects
  private parseAge(ageString: string): Date {
    const match = ageString.match(/^(\d+)([dwmy])$/);
    if (!match) {
      throw new Error(`Invalid age format: ${ageString}. Use format like "30d", "1y", "6m"`);
    }

    const value = parseInt(match[1]);
    const unit = match[2];
    const now = new Date();

    switch (unit) {
      case 'd': // days
        return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
      case 'w': // weeks
        return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
      case 'm': // months (approximate: 30 days)
        return new Date(now.getTime() - value * 30 * 24 * 60 * 60 * 1000);
      case 'y': // years (approximate: 365 days)
        return new Date(now.getTime() - value * 365 * 24 * 60 * 60 * 1000);
      default:
        throw new Error(`Unknown age unit: ${unit}`);
    }
  }

  createPolicy(policy: Omit<RetentionPolicy, 'id'>): string {
    const id = uuidv4();
    const policyWithId = { enabled: true, ...policy, id };

    this.db
      .getDatabase()
      .prepare(
        `
      INSERT INTO retention_policies (id, name, enabled, policy_config)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(id, policy.name, policyWithId.enabled ? 1 : 0, JSON.stringify(policyWithId));

    return id;
  }

  updatePolicy(id: string, updates: Partial<RetentionPolicy>): void {
    const existing = this.getPolicy(id);
    if (!existing) {
      throw new Error(`Policy not found: ${id}`);
    }

    const updated = { ...existing, ...updates, id };

    this.db
      .getDatabase()
      .prepare(
        `
      UPDATE retention_policies 
      SET policy_config = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
      )
      .run(JSON.stringify(updated), id);
  }

  getPolicy(id: string): RetentionPolicy | null {
    const row = this.db
      .getDatabase()
      .prepare(
        `
      SELECT policy_config FROM retention_policies WHERE id = ?
    `
      )
      .get(id) as any;

    if (!row) return null;
    return JSON.parse(row.policy_config);
  }

  listPolicies(): RetentionPolicy[] {
    const rows = this.db
      .getDatabase()
      .prepare(
        `
      SELECT policy_config FROM retention_policies ORDER BY created_at
    `
      )
      .all() as any[];

    return rows.map(row => JSON.parse(row.policy_config));
  }

  deletePolicy(id: string): void {
    this.db
      .getDatabase()
      .prepare(
        `
      DELETE FROM retention_policies WHERE id = ?
    `
      )
      .run(id);
  }

  getRetentionStats(sessionId?: string): RetentionStats {
    const sessionFilter = sessionId ? 'WHERE session_id = ?' : '';
    const params = sessionId ? [sessionId] : [];

    // Get overall stats
    const totalStats = this.db
      .getDatabase()
      .prepare(
        `
      SELECT 
        COUNT(*) as total_items,
        SUM(size) as total_size,
        MIN(created_at) as oldest_item,
        MAX(created_at) as newest_item
      FROM context_items ${sessionFilter}
    `
      )
      .get(...params) as any;

    // Get by category
    const categoryStats = this.db
      .getDatabase()
      .prepare(
        `
      SELECT 
        COALESCE(category, 'uncategorized') as category,
        COUNT(*) as count,
        SUM(size) as size
      FROM context_items ${sessionFilter}
      GROUP BY category
    `
      )
      .all(...params) as any[];

    // Get by priority
    const priorityStats = this.db
      .getDatabase()
      .prepare(
        `
      SELECT 
        COALESCE(priority, 'normal') as priority,
        COUNT(*) as count,
        SUM(size) as size
      FROM context_items ${sessionFilter}
      GROUP BY priority
    `
      )
      .all(...params) as any[];

    // Calculate eligible for retention (older than 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const eligibleStats = this.db
      .getDatabase()
      .prepare(
        `
      SELECT 
        COUNT(*) as eligible_items,
        SUM(size) as eligible_size
      FROM context_items 
      WHERE created_at < ? ${sessionId ? 'AND session_id = ?' : ''}
    `
      )
      .get(thirtyDaysAgo.toISOString(), ...(sessionId ? [sessionId] : [])) as any;

    const byCategory: Record<string, { count: number; size: number }> = {};
    categoryStats.forEach((stat: any) => {
      byCategory[stat.category] = {
        count: stat.count,
        size: stat.size || 0,
      };
    });

    const byPriority: Record<string, { count: number; size: number }> = {};
    priorityStats.forEach((stat: any) => {
      byPriority[stat.priority] = {
        count: stat.count,
        size: stat.size || 0,
      };
    });

    const totalSize = totalStats.total_size || 0;
    const eligibleSize = eligibleStats.eligible_size || 0;

    return {
      totalItems: totalStats.total_items || 0,
      totalSize,
      oldestItem: totalStats.oldest_item || '',
      newestItem: totalStats.newest_item || '',
      byCategory,
      byPriority,
      eligibleForRetention: {
        items: eligibleStats.eligible_items || 0,
        size: eligibleSize,
        savings: totalSize > 0 ? Math.round((eligibleSize / totalSize) * 100) : 0,
      },
    };
  }

  async executePolicy(policyId: string, dryRun: boolean = false): Promise<RetentionResult> {
    const startTime = Date.now();
    const policy = this.getPolicy(policyId);

    if (!policy) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    if (policy.enabled === false) {
      throw new Error(`Policy is disabled: ${policy.name}`);
    }

    const result: RetentionResult = {
      policyId,
      policyName: policy.name,
      action: policy.action,
      dryRun,
      processed: { items: 0, size: 0, sessions: [] },
      saved: { size: 0, items: 0 },
      errors: [],
      warnings: [],
      executionTime: 0,
      timestamp: new Date().toISOString(),
    };

    try {
      // Validate age format if specified
      if (policy.maxAge) {
        this.parseAge(policy.maxAge);
      }

      // Find items eligible for retention
      const eligibleItems = this.findEligibleItems(policy);

      if (eligibleItems.length === 0) {
        result.warnings.push('No items eligible for retention');
        return result;
      }

      result.processed.items = eligibleItems.length;
      result.processed.size = eligibleItems.reduce((sum, item) => sum + (item.size || 0), 0);
      result.processed.sessions = [...new Set(eligibleItems.map(item => item.session_id))];

      if (!dryRun) {
        await this.executeRetentionAction(policy, eligibleItems, result);

        // Update last run timestamp
        this.db
          .getDatabase()
          .prepare(
            `
          UPDATE retention_policies 
          SET last_run = CURRENT_TIMESTAMP 
          WHERE id = ?
        `
          )
          .run(policyId);
      }

      result.saved.items = result.processed.items;
      result.saved.size = result.processed.size;
    } catch (error: any) {
      result.errors.push(error.message);
    }

    result.executionTime = Date.now() - startTime;

    // Log the result
    this.db
      .getDatabase()
      .prepare(
        `
      INSERT INTO retention_logs (id, policy_id, result)
      VALUES (?, ?, ?)
    `
      )
      .run(uuidv4(), policyId, JSON.stringify(result));

    return result;
  }

  private findEligibleItems(policy: RetentionPolicy): any[] {
    let query = 'SELECT * FROM context_items WHERE 1=1';
    const params: any[] = [];

    // Age-based filtering
    if (policy.maxAge) {
      const cutoffDate = this.parseAge(policy.maxAge);
      query += ' AND created_at < ?';
      params.push(cutoffDate.toISOString());
    }

    // Category-specific rules
    if (policy.categories) {
      const preserveCategories = Object.entries(policy.categories)
        .filter(([, rules]) => rules.preserve)
        .map(([category]) => category);

      if (preserveCategories.length > 0) {
        const placeholders = preserveCategories.map(() => '?').join(',');
        query += ` AND COALESCE(category, 'uncategorized') NOT IN (${placeholders})`;
        params.push(...preserveCategories);
      }
    }

    // Priority-based filtering
    if (policy.preserveHighPriority) {
      query += " AND priority != 'high'";
    }

    if (policy.preserveCritical) {
      query += " AND priority != 'critical'";
    }

    query += ' ORDER BY created_at ASC';

    let items = this.db
      .getDatabase()
      .prepare(query)
      .all(...params) as any[];

    // Size-based limiting
    if (policy.maxItems && items.length > policy.maxItems) {
      items = items.slice(0, items.length - policy.maxItems);
    }

    if (policy.maxSize) {
      let currentSize = 0;
      items = items.filter(item => {
        currentSize += item.size || 0;
        return currentSize <= policy.maxSize!;
      });
    }

    return items;
  }

  private async executeRetentionAction(
    policy: RetentionPolicy,
    items: any[],
    result: RetentionResult
  ): Promise<void> {
    switch (policy.action) {
      case 'delete':
        await this.deleteItems(items, result);
        break;
      case 'archive':
        await this.archiveItems(items, result);
        break;
      case 'compress':
        await this.compressItems(items, result);
        break;
      default:
        throw new Error(`Unknown retention action: ${policy.action}`);
    }
  }

  private async deleteItems(items: any[], result: RetentionResult): Promise<void> {
    const db = this.db.getDatabase();
    const deleteStmt = db.prepare('DELETE FROM context_items WHERE id = ?');

    for (const item of items) {
      try {
        deleteStmt.run(item.id);
      } catch (error: any) {
        result.errors.push(`Failed to delete item ${item.id}: ${error.message}`);
      }
    }
  }

  private async archiveItems(items: any[], result: RetentionResult): Promise<void> {
    // Archive to a separate table
    const db = this.db.getDatabase();

    // Create archive table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS context_items_archive (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        priority TEXT,
        metadata TEXT,
        size INTEGER DEFAULT 0,
        created_at TIMESTAMP,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const insertStmt = db.prepare(`
      INSERT INTO context_items_archive 
      (id, session_id, key, value, category, priority, metadata, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteStmt = db.prepare('DELETE FROM context_items WHERE id = ?');

    for (const item of items) {
      try {
        insertStmt.run(
          item.id,
          item.session_id,
          item.key,
          item.value,
          item.category,
          item.priority,
          item.metadata,
          item.size,
          item.created_at
        );
        deleteStmt.run(item.id);
      } catch (error: any) {
        result.errors.push(`Failed to archive item ${item.id}: ${error.message}`);
      }
    }
  }

  private async compressItems(items: any[], result: RetentionResult): Promise<void> {
    // Group items by category and compress
    const itemsByCategory: Record<string, any[]> = {};

    for (const item of items) {
      const category = item.category || 'uncategorized';
      if (!itemsByCategory[category]) {
        itemsByCategory[category] = [];
      }
      itemsByCategory[category].push(item);
    }

    const db = this.db.getDatabase();
    const insertCompressed = db.prepare(`
      INSERT INTO compressed_context 
      (id, session_id, original_count, compressed_data, compression_ratio, date_range_start, date_range_end)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteStmt = db.prepare('DELETE FROM context_items WHERE id = ?');

    for (const [category, categoryItems] of Object.entries(itemsByCategory)) {
      try {
        const compressed = {
          category,
          totalItems: categoryItems.length,
          summary: `${categoryItems.length} items from ${category}`,
          dateRange: {
            start: Math.min(...categoryItems.map(i => new Date(i.created_at).getTime())),
            end: Math.max(...categoryItems.map(i => new Date(i.created_at).getTime())),
          },
          samples: categoryItems.slice(0, 3).map(item => ({
            key: item.key,
            value: item.value.substring(0, 100),
          })),
        };

        const originalSize = JSON.stringify(categoryItems).length;
        const compressedSize = JSON.stringify(compressed).length;
        const ratio = 1 - compressedSize / originalSize;

        insertCompressed.run(
          uuidv4(),
          categoryItems[0].session_id,
          categoryItems.length,
          JSON.stringify(compressed),
          ratio,
          new Date(compressed.dateRange.start).toISOString(),
          new Date(compressed.dateRange.end).toISOString()
        );

        // Delete original items
        for (const item of categoryItems) {
          deleteStmt.run(item.id);
        }
      } catch (error: any) {
        result.errors.push(`Failed to compress ${category} items: ${error.message}`);
      }
    }
  }

  getRetentionLogs(policyId?: string, limit: number = 50): any[] {
    const query = policyId
      ? 'SELECT * FROM retention_logs WHERE policy_id = ? ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM retention_logs ORDER BY created_at DESC LIMIT ?';

    const params = policyId ? [policyId, limit] : [limit];

    return this.db
      .getDatabase()
      .prepare(query)
      .all(...params) as any[];
  }

  // Predefined retention policies
  static getDefaultPolicies(): Omit<RetentionPolicy, 'id'>[] {
    return [
      {
        name: 'Conservative Cleanup',
        enabled: true,
        maxAge: '90d',
        preserveHighPriority: true,
        preserveCritical: true,
        categories: {
          decision: { preserve: true },
          critical: { preserve: true },
        },
        action: 'archive',
        schedule: 'weekly',
        notifyBeforeAction: true,
      },
      {
        name: 'Aggressive Cleanup',
        enabled: false,
        maxAge: '30d',
        maxItems: 1000,
        preserveCritical: true,
        action: 'compress',
        schedule: 'daily',
      },
      {
        name: 'Development Mode',
        enabled: false,
        maxAge: '7d',
        categories: {
          decision: { maxAge: '30d' },
          critical: { preserve: true },
        },
        action: 'delete',
        schedule: 'daily',
      },
    ];
  }
}
