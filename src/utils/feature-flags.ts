import { DatabaseManager } from './database';
import { v4 as uuidv4 } from 'uuid';

export interface FeatureFlag {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  description?: string;
  
  // Environment/context targeting
  environments?: string[]; // e.g., ['development', 'staging', 'production']
  users?: string[];
  percentage?: number; // 0-100 for gradual rollout
  
  // Scheduling
  enabledFrom?: string; // ISO date
  enabledUntil?: string; // ISO date
  
  // Metadata
  category?: string;
  tags?: string[];
  
  // Tracking
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  lastModifiedBy?: string;
}

export interface FeatureFlagEvaluation {
  flag: FeatureFlag;
  enabled: boolean;
  reason: string;
  context?: {
    environment?: string;
    userId?: string;
    timestamp: string;
  };
}

export interface FeatureFlagStats {
  totalFlags: number;
  enabledFlags: number;
  disabledFlags: number;
  
  byCategory: Record<string, { count: number; enabled: number }>;
  byEnvironment: Record<string, { count: number; enabled: number }>;
  
  scheduledChanges: {
    toEnable: Array<{ flag: string; date: string }>;
    toDisable: Array<{ flag: string; date: string }>;
  };
  
  recentActivity: Array<{
    flag: string;
    action: string;
    timestamp: string;
    user?: string;
  }>;
}

export class FeatureFlagManager {
  private db: DatabaseManager;
  
  constructor(db: DatabaseManager) {
    this.db = db;
    this.initializeTables();
  }
  
  private initializeTables(): void {
    this.db.getDatabase().exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key TEXT UNIQUE NOT NULL,
        enabled BOOLEAN DEFAULT false,
        description TEXT,
        environments TEXT, -- JSON array
        users TEXT, -- JSON array
        percentage INTEGER DEFAULT 0,
        enabled_from TIMESTAMP,
        enabled_until TIMESTAMP,
        category TEXT,
        tags TEXT, -- JSON array
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        last_modified_by TEXT
      );
      
      CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
        id TEXT PRIMARY KEY,
        flag_id TEXT NOT NULL,
        flag_key TEXT NOT NULL,
        enabled BOOLEAN NOT NULL,
        reason TEXT NOT NULL,
        context TEXT, -- JSON
        evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (flag_id) REFERENCES feature_flags(id)
      );
      
      CREATE TABLE IF NOT EXISTS feature_flag_audit (
        id TEXT PRIMARY KEY,
        flag_id TEXT NOT NULL,
        flag_key TEXT NOT NULL,
        action TEXT NOT NULL, -- 'created', 'updated', 'deleted', 'enabled', 'disabled'
        old_value TEXT, -- JSON
        new_value TEXT, -- JSON
        user_id TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(key);
      CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(enabled);
      CREATE INDEX IF NOT EXISTS idx_feature_flags_category ON feature_flags(category);
      CREATE INDEX IF NOT EXISTS idx_evaluations_flag ON feature_flag_evaluations(flag_id);
      CREATE INDEX IF NOT EXISTS idx_evaluations_time ON feature_flag_evaluations(evaluated_at);
      CREATE INDEX IF NOT EXISTS idx_audit_flag ON feature_flag_audit(flag_id);
      CREATE INDEX IF NOT EXISTS idx_audit_time ON feature_flag_audit(timestamp);
    `);
  }
  
  createFlag(flag: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const flagWithDefaults = {
      id,
      createdAt: now,
      updatedAt: now,
      ...flag,
      enabled: flag.enabled ?? false,
      percentage: flag.percentage ?? undefined
    };
    
    this.db.getDatabase().prepare(`
      INSERT INTO feature_flags (
        id, name, key, enabled, description, environments, users, percentage,
        enabled_from, enabled_until, category, tags, created_at, updated_at,
        created_by, last_modified_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, flag.name, flag.key, flag.enabled ? 1 : 0, flag.description,
      flag.environments ? JSON.stringify(flag.environments) : null,
      flag.users ? JSON.stringify(flag.users) : null,
      flag.percentage !== undefined ? flag.percentage : null,
      flag.enabledFrom, flag.enabledUntil, flag.category,
      flag.tags ? JSON.stringify(flag.tags) : null,
      now, now, flag.createdBy, flag.lastModifiedBy
    );
    
    // Log creation
    this.logAudit(id, flag.key, 'created', null, flagWithDefaults, flag.createdBy);
    
    return id;
  }
  
  updateFlag(id: string, updates: Partial<FeatureFlag>, userId?: string): void {
    const existing = this.getFlag(id);
    if (!existing) {
      throw new Error(`Feature flag not found: ${id}`);
    }
    
    const updated = { ...existing, ...updates, id, updatedAt: new Date().toISOString() };
    if (userId) {
      updated.lastModifiedBy = userId;
    }
    
    this.db.getDatabase().prepare(`
      UPDATE feature_flags SET
        name = ?, enabled = ?, description = ?, environments = ?, users = ?,
        percentage = ?, enabled_from = ?, enabled_until = ?, category = ?,
        tags = ?, updated_at = ?, last_modified_by = ?
      WHERE id = ?
    `).run(
      updated.name, updated.enabled ? 1 : 0, updated.description,
      updated.environments ? JSON.stringify(updated.environments) : null,
      updated.users ? JSON.stringify(updated.users) : null,
      updated.percentage !== undefined ? updated.percentage : null,
      updated.enabledFrom, updated.enabledUntil, updated.category,
      updated.tags ? JSON.stringify(updated.tags) : null,
      updated.updatedAt, updated.lastModifiedBy, id
    );
    
    // Log update
    this.logAudit(id, existing.key, 'updated', existing, updated, userId);
  }
  
  getFlag(id: string): FeatureFlag | null {
    const row = this.db.getDatabase().prepare(`
      SELECT * FROM feature_flags WHERE id = ?
    `).get(id) as any;
    
    if (!row) return null;
    return this.rowToFlag(row);
  }
  
  getFlagByKey(key: string): FeatureFlag | null {
    const row = this.db.getDatabase().prepare(`
      SELECT * FROM feature_flags WHERE key = ?
    `).get(key) as any;
    
    if (!row) return null;
    return this.rowToFlag(row);
  }
  
  listFlags(options: {
    category?: string;
    enabled?: boolean;
    environment?: string;
    tag?: string;
    limit?: number;
  } = {}): FeatureFlag[] {
    let query = 'SELECT * FROM feature_flags WHERE 1=1';
    const params: any[] = [];
    
    if (options.category) {
      query += ' AND category = ?';
      params.push(options.category);
    }
    
    if (options.enabled !== undefined) {
      query += ' AND enabled = ?';
      params.push(options.enabled ? 1 : 0);
    }
    
    if (options.environment) {
      query += ' AND (environments IS NULL OR environments LIKE ?)';
      params.push(`%"${options.environment}"%`);
    }
    
    if (options.tag) {
      query += ' AND tags LIKE ?';
      params.push(`%"${options.tag}"%`);
    }
    
    query += ' ORDER BY updated_at DESC';
    
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const rows = this.db.getDatabase().prepare(query).all(...params) as any[];
    return rows.map(row => this.rowToFlag(row));
  }
  
  deleteFlag(id: string, userId?: string): void {
    const existing = this.getFlag(id);
    if (!existing) {
      throw new Error(`Feature flag not found: ${id}`);
    }
    
    // Delete related evaluation records first to avoid foreign key constraints
    this.db.getDatabase().prepare(`
      DELETE FROM feature_flag_evaluations WHERE flag_id = ?
    `).run(id);
    
    // Now delete the flag (audit log can stay for historical purposes)
    this.db.getDatabase().prepare(`
      DELETE FROM feature_flags WHERE id = ?
    `).run(id);
    
    // Log deletion after removing the flag
    this.logAudit(id, existing.key, 'deleted', existing, null, userId);
  }
  
  evaluateFlag(
    key: string, 
    context: {
      environment?: string;
      userId?: string;
      timestamp?: string;
    } = {}
  ): FeatureFlagEvaluation {
    const flag = this.getFlagByKey(key);
    const timestamp = context.timestamp || new Date().toISOString();
    
    if (!flag) {
      const evaluation = {
        flag: {
          id: '',
          name: key,
          key,
          enabled: false,
          createdAt: timestamp,
          updatedAt: timestamp
        } as FeatureFlag,
        enabled: false,
        reason: 'Flag not found',
        context: { ...context, timestamp }
      };
      
      this.logEvaluation('', key, false, 'Flag not found', evaluation.context);
      return evaluation;
    }
    
    let enabled = false;
    let reason = 'Flag disabled';
    
    // Check if flag is globally enabled
    if (!flag.enabled) {
      enabled = false;
      reason = 'Flag globally disabled';
    }
    // Check date constraints
    else if (flag.enabledFrom && new Date(timestamp) < new Date(flag.enabledFrom)) {
      enabled = false;
      reason = `Flag not yet active (starts ${flag.enabledFrom})`;
    }
    else if (flag.enabledUntil && new Date(timestamp) > new Date(flag.enabledUntil)) {
      enabled = false;
      reason = `Flag expired (ended ${flag.enabledUntil})`;
    }
    // Check environment constraints
    else if (flag.environments && flag.environments.length > 0 && context.environment) {
      if (flag.environments.includes(context.environment)) {
        enabled = true;
        reason = `Enabled for environment: ${context.environment}`;
      } else {
        enabled = false;
        reason = `Not enabled for environment: ${context.environment}`;
      }
    }
    // Check user constraints
    else if (flag.users && flag.users.length > 0 && context.userId) {
      if (flag.users.includes(context.userId)) {
        enabled = true;
        reason = `Enabled for user: ${context.userId}`;
      } else {
        enabled = false;
        reason = `Not enabled for user: ${context.userId}`;
      }
    }
    // Check percentage rollout
    else if (flag.percentage !== undefined && flag.percentage !== null) {
      if (flag.percentage === 0) {
        enabled = false;
        reason = `Disabled by percentage rollout (${flag.percentage}%)`;
      } else if (flag.percentage === 100) {
        enabled = true;
        reason = `Enabled by percentage rollout (${flag.percentage}%)`;
      } else {
        // Use hash of key + userId/environment for consistent percentage evaluation
        const hashInput = key + (context.userId || context.environment || 'anonymous');
        const hash = this.simpleHash(hashInput);
        const userPercentile = hash % 100;
        
        if (userPercentile < flag.percentage) {
          enabled = true;
          reason = `Enabled by percentage rollout (${flag.percentage}%)`;
        } else {
          enabled = false;
          reason = `Disabled by percentage rollout (${flag.percentage}%, user at ${userPercentile}%)`;
        }
      }
    }
    // Default to flag enabled state
    else {
      enabled = flag.enabled;
      reason = enabled ? 'Flag enabled' : 'Flag disabled';
    }
    
    const evaluation = {
      flag,
      enabled,
      reason,
      context: { ...context, timestamp }
    };
    
    // Log evaluation
    this.logEvaluation(flag.id, key, enabled, reason, evaluation.context);
    
    return evaluation;
  }
  
  isEnabled(key: string, context: any = {}): boolean {
    return this.evaluateFlag(key, context).enabled;
  }
  
  getStats(): FeatureFlagStats {
    const flags = this.listFlags();
    const enabledFlags = flags.filter(f => f.enabled);
    
    // By category
    const byCategory: Record<string, { count: number; enabled: number }> = {};
    flags.forEach(flag => {
      const category = flag.category || 'uncategorized';
      if (!byCategory[category]) {
        byCategory[category] = { count: 0, enabled: 0 };
      }
      byCategory[category].count++;
      if (flag.enabled) {
        byCategory[category].enabled++;
      }
    });
    
    // By environment
    const byEnvironment: Record<string, { count: number; enabled: number }> = {};
    flags.forEach(flag => {
      const environments = flag.environments || ['default'];
      environments.forEach(env => {
        if (!byEnvironment[env]) {
          byEnvironment[env] = { count: 0, enabled: 0 };
        }
        byEnvironment[env].count++;
        if (flag.enabled) {
          byEnvironment[env].enabled++;
        }
      });
    });
    
    // Scheduled changes
    const now = new Date();
    const toEnable = flags
      .filter(f => !f.enabled && f.enabledFrom && new Date(f.enabledFrom) > now)
      .map(f => ({ flag: f.name, date: f.enabledFrom! }));
    
    const toDisable = flags
      .filter(f => f.enabled && f.enabledUntil && new Date(f.enabledUntil) > now)
      .map(f => ({ flag: f.name, date: f.enabledUntil! }));
    
    // Recent activity
    const recentActivity = this.db.getDatabase().prepare(`
      SELECT flag_key, action, timestamp, user_id 
      FROM feature_flag_audit 
      ORDER BY timestamp DESC 
      LIMIT 10
    `).all() as any[];
    
    return {
      totalFlags: flags.length,
      enabledFlags: enabledFlags.length,
      disabledFlags: flags.length - enabledFlags.length,
      byCategory,
      byEnvironment,
      scheduledChanges: { toEnable, toDisable },
      recentActivity: recentActivity.map(row => ({
        flag: row.flag_key,
        action: row.action,
        timestamp: row.timestamp,
        user: row.user_id
      }))
    };
  }
  
  getEvaluationHistory(flagKey: string, limit: number = 100): any[] {
    return this.db.getDatabase().prepare(`
      SELECT * FROM feature_flag_evaluations 
      WHERE flag_key = ? 
      ORDER BY evaluated_at DESC 
      LIMIT ?
    `).all(flagKey, limit) as any[];
  }
  
  getAuditLog(flagId?: string, limit: number = 50): any[] {
    const query = flagId 
      ? 'SELECT * FROM feature_flag_audit WHERE flag_id = ? ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM feature_flag_audit ORDER BY timestamp DESC LIMIT ?';
    
    const params = flagId ? [flagId, limit] : [limit];
    return this.db.getDatabase().prepare(query).all(...params) as any[];
  }
  
  // Bulk operations
  enableFlag(key: string, userId?: string): void {
    const flag = this.getFlagByKey(key);
    if (!flag) {
      throw new Error(`Feature flag not found: ${key}`);
    }
    
    this.updateFlag(flag.id, { enabled: true }, userId);
    this.logAudit(flag.id, key, 'enabled', { enabled: false }, { enabled: true }, userId);
  }
  
  disableFlag(key: string, userId?: string): void {
    const flag = this.getFlagByKey(key);
    if (!flag) {
      throw new Error(`Feature flag not found: ${key}`);
    }
    
    this.updateFlag(flag.id, { enabled: false }, userId);
    this.logAudit(flag.id, key, 'disabled', { enabled: true }, { enabled: false }, userId);
  }
  
  // Utility methods
  private rowToFlag(row: any): FeatureFlag {
    return {
      id: row.id,
      name: row.name,
      key: row.key,
      enabled: Boolean(row.enabled),
      description: row.description,
      environments: row.environments ? JSON.parse(row.environments) : undefined,
      users: row.users ? JSON.parse(row.users) : undefined,
      percentage: row.percentage,
      enabledFrom: row.enabled_from,
      enabledUntil: row.enabled_until,
      category: row.category,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      lastModifiedBy: row.last_modified_by
    };
  }
  
  private logEvaluation(flagId: string, flagKey: string, enabled: boolean, reason: string, context: any): void {
    // Only log if flag exists (flagId is not empty)
    if (flagId) {
      this.db.getDatabase().prepare(`
        INSERT INTO feature_flag_evaluations (id, flag_id, flag_key, enabled, reason, context)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), flagId, flagKey, enabled ? 1 : 0, reason, JSON.stringify(context));
    }
  }
  
  private logAudit(
    flagId: string, 
    flagKey: string, 
    action: string, 
    oldValue: any, 
    newValue: any, 
    userId?: string
  ): void {
    this.db.getDatabase().prepare(`
      INSERT INTO feature_flag_audit (id, flag_id, flag_key, action, old_value, new_value, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), flagId, flagKey, action,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      userId
    );
  }
  
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
  
  // Predefined feature flags for common features
  static getDefaultFlags(): Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>[] {
    return [
      {
        name: 'Enhanced Search',
        key: 'enhanced_search',
        enabled: true,
        description: 'Enable enhanced search capabilities with filters',
        category: 'search',
        tags: ['core', 'stable']
      },
      {
        name: 'Beta Features',
        key: 'beta_features',
        enabled: false,
        description: 'Enable experimental beta features',
        category: 'experimental',
        tags: ['beta', 'experimental'],
        environments: ['development', 'staging']
      },
      {
        name: 'Advanced Analytics',
        key: 'advanced_analytics',
        enabled: false,
        description: 'Enable detailed analytics and metrics',
        category: 'analytics',
        tags: ['analytics', 'metrics'],
        percentage: 25 // 25% rollout
      },
      {
        name: 'Auto Compression',
        key: 'auto_compression',
        enabled: true,
        description: 'Automatically compress old context data',
        category: 'performance',
        tags: ['performance', 'storage']
      }
    ];
  }
}