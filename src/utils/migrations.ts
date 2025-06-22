import { DatabaseManager } from './database';
import { v4 as uuidv4 } from 'uuid';

export interface Migration {
  id: string;
  version: string;
  name: string;
  description?: string;
  
  // Migration execution
  up: string; // SQL for applying migration
  down?: string; // SQL for rolling back migration
  
  // Dependencies and constraints
  dependencies?: string[]; // Required migration versions
  requiresBackup?: boolean; // Whether backup is needed before running
  
  // Metadata
  createdAt: string;
  appliedAt?: string;
  rollbackAt?: string;
  checksum?: string; // Hash of the migration content
}

export interface MigrationResult {
  migrationId: string;
  version: string;
  name: string;
  success: boolean;
  errors: string[];
  warnings: string[];
  executionTime: number;
  rowsAffected?: number;
  backupCreated?: string;
  timestamp: string;
}

export interface MigrationStatus {
  currentVersion: string;
  totalMigrations: number;
  appliedMigrations: number;
  pendingMigrations: number;
  
  pending: Array<{
    version: string;
    name: string;
    requiresBackup: boolean;
  }>;
  
  applied: Array<{
    version: string;
    name: string;
    appliedAt: string;
  }>;
  
  lastMigration?: {
    version: string;
    name: string;
    appliedAt: string;
  };
}

export class MigrationManager {
  private db: DatabaseManager;
  
  constructor(db: DatabaseManager) {
    this.db = db;
    this.initializeMigrationTables();
  }
  
  private initializeMigrationTables(): void {
    this.db.getDatabase().exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        version TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        up_sql TEXT NOT NULL,
        down_sql TEXT,
        dependencies TEXT, -- JSON array
        requires_backup BOOLEAN DEFAULT false,
        checksum TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        applied_at TIMESTAMP,
        rollback_at TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS migration_log (
        id TEXT PRIMARY KEY,
        migration_id TEXT NOT NULL,
        version TEXT NOT NULL,
        action TEXT NOT NULL, -- 'apply', 'rollback', 'backup'
        success BOOLEAN NOT NULL,
        errors TEXT, -- JSON array
        warnings TEXT, -- JSON array
        execution_time INTEGER, -- milliseconds
        rows_affected INTEGER,
        backup_path TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (migration_id) REFERENCES migrations(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_migrations_version ON migrations(version);
      CREATE INDEX IF NOT EXISTS idx_migrations_applied ON migrations(applied_at);
      CREATE INDEX IF NOT EXISTS idx_migration_log_version ON migration_log(version);
      CREATE INDEX IF NOT EXISTS idx_migration_log_timestamp ON migration_log(timestamp);
    `);
  }
  
  createMigration(migration: Omit<Migration, 'id' | 'createdAt'>): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    // Calculate checksum
    const checksum = this.calculateChecksum(migration.up + (migration.down || ''));
    
    const migrationWithDefaults = {
      id,
      createdAt: now,
      checksum,
      requiresBackup: false,
      ...migration
    };
    
    this.db.getDatabase().prepare(`
      INSERT INTO migrations (
        id, version, name, description, up_sql, down_sql, dependencies,
        requires_backup, checksum, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, migration.version, migration.name, migration.description,
      migration.up, migration.down,
      migration.dependencies ? JSON.stringify(migration.dependencies) : null,
      migration.requiresBackup ? 1 : 0,
      checksum, now
    );
    
    return id;
  }
  
  getMigration(version: string): Migration | null {
    const row = this.db.getDatabase().prepare(`
      SELECT * FROM migrations WHERE version = ?
    `).get(version) as any;
    
    if (!row) return null;
    return this.rowToMigration(row);
  }
  
  listMigrations(options: {
    applied?: boolean;
    pending?: boolean;
    limit?: number;
  } = {}): Migration[] {
    let query = 'SELECT * FROM migrations WHERE 1=1';
    const params: any[] = [];
    
    if (options.applied === true) {
      query += ' AND applied_at IS NOT NULL';
    } else if (options.applied === false) {
      query += ' AND applied_at IS NULL';
    }
    
    if (options.pending === true) {
      query += ' AND applied_at IS NULL';
    } else if (options.pending === false) {
      query += ' AND applied_at IS NOT NULL';
    }
    
    query += ' ORDER BY version';
    
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    const rows = this.db.getDatabase().prepare(query).all(...params) as any[];
    return rows.map(row => this.rowToMigration(row));
  }
  
  getStatus(): MigrationStatus {
    const allMigrations = this.listMigrations();
    const appliedMigrations = allMigrations.filter(m => m.appliedAt);
    const pendingMigrations = allMigrations.filter(m => !m.appliedAt);
    
    const lastMigration = appliedMigrations
      .sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''))
      [0];
    
    return {
      currentVersion: lastMigration?.version || '0.0.0',
      totalMigrations: allMigrations.length,
      appliedMigrations: appliedMigrations.length,
      pendingMigrations: pendingMigrations.length,
      pending: pendingMigrations.map(m => ({
        version: m.version,
        name: m.name,
        requiresBackup: m.requiresBackup || false
      })),
      applied: appliedMigrations.map(m => ({
        version: m.version,
        name: m.name,
        appliedAt: m.appliedAt!
      })),
      lastMigration: lastMigration ? {
        version: lastMigration.version,
        name: lastMigration.name,
        appliedAt: lastMigration.appliedAt!
      } : undefined
    };
  }
  
  async applyMigration(version: string, options: {
    dryRun?: boolean;
    createBackup?: boolean;
  } = {}): Promise<MigrationResult> {
    const startTime = Date.now();
    const migration = this.getMigration(version);
    
    if (!migration) {
      throw new Error(`Migration not found: ${version}`);
    }
    
    if (migration.appliedAt) {
      throw new Error(`Migration ${version} is already applied`);
    }
    
    const result: MigrationResult = {
      migrationId: migration.id,
      version: migration.version,
      name: migration.name,
      success: false,
      errors: [],
      warnings: [],
      executionTime: 0,
      timestamp: new Date().toISOString()
    };
    
    try {
      // Check dependencies
      if (migration.dependencies) {
        for (const depVersion of migration.dependencies) {
          const dep = this.getMigration(depVersion);
          if (!dep || !dep.appliedAt) {
            result.errors.push(`Dependency not satisfied: ${depVersion}`);
            result.success = false;
            result.executionTime = Date.now() - startTime;
            this.logMigration(result, 'apply', result.backupCreated);
            return result;
          }
        }
      }
      
      // Validate migration SQL
      try {
        this.validateSQL(migration.up);
      } catch (error: any) {
        result.errors.push(error.message);
        result.success = false;
        result.executionTime = Date.now() - startTime;
        this.logMigration(result, 'apply', result.backupCreated);
        return result;
      }
      
      // Create backup if required or requested
      let backupPath: string | undefined;
      if ((migration.requiresBackup || options.createBackup) && !options.dryRun) {
        backupPath = await this.createBackup(version);
        result.backupCreated = backupPath;
      }
      
      if (!options.dryRun) {
        // Execute migration
        const db = this.db.getDatabase();
        
        // Begin transaction
        db.exec('BEGIN TRANSACTION');
        
        try {
          // Execute the migration SQL
          db.exec(migration.up);
          result.rowsAffected = (db as any).changes || 0;
          
          // Mark migration as applied
          db.prepare(`
            UPDATE migrations 
            SET applied_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `).run(migration.id);
          
          // Commit transaction
          db.exec('COMMIT');
          
          result.success = true;
        } catch (error: any) {
          // Rollback transaction
          db.exec('ROLLBACK');
          throw error;
        }
      } else {
        result.success = true;
        result.warnings.push('Dry run - no changes applied');
      }
      
    } catch (error: any) {
      result.errors.push(error.message);
      result.success = false;
    }
    
    result.executionTime = Date.now() - startTime;
    
    // Log the result
    this.logMigration(result, 'apply', result.backupCreated);
    
    return result;
  }
  
  async rollbackMigration(version: string, options: {
    dryRun?: boolean;
    createBackup?: boolean;
  } = {}): Promise<MigrationResult> {
    const startTime = Date.now();
    const migration = this.getMigration(version);
    
    if (!migration) {
      throw new Error(`Migration not found: ${version}`);
    }
    
    if (!migration.appliedAt) {
      throw new Error(`Migration ${version} is not applied`);
    }
    
    if (!migration.down) {
      throw new Error(`Migration ${version} has no rollback SQL`);
    }
    
    const result: MigrationResult = {
      migrationId: migration.id,
      version: migration.version,
      name: migration.name,
      success: false,
      errors: [],
      warnings: [],
      executionTime: 0,
      timestamp: new Date().toISOString()
    };
    
    try {
      // Create backup if requested
      let backupPath: string | undefined;
      if (options.createBackup && !options.dryRun) {
        backupPath = await this.createBackup(version);
        result.backupCreated = backupPath;
      }
      
      // Validate rollback SQL
      this.validateSQL(migration.down);
      
      if (!options.dryRun) {
        // Execute rollback
        const db = this.db.getDatabase();
        
        // Begin transaction
        db.exec('BEGIN TRANSACTION');
        
        try {
          // Execute the rollback SQL
          db.exec(migration.down);
          result.rowsAffected = (db as any).changes || 0;
          
          // Mark migration as rolled back
          db.prepare(`
            UPDATE migrations 
            SET applied_at = NULL, rollback_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `).run(migration.id);
          
          // Commit transaction
          db.exec('COMMIT');
          
          result.success = true;
        } catch (error: any) {
          // Rollback transaction
          db.exec('ROLLBACK');
          throw error;
        }
      } else {
        result.success = true;
        result.warnings.push('Dry run - no changes applied');
      }
      
    } catch (error: any) {
      result.errors.push(error.message);
      result.success = false;
    }
    
    result.executionTime = Date.now() - startTime;
    
    // Log the result
    this.logMigration(result, 'rollback', result.backupCreated);
    
    return result;
  }
  
  async applyAllPending(options: {
    dryRun?: boolean;
    createBackups?: boolean;
    stopOnError?: boolean;
  } = {}): Promise<MigrationResult[]> {
    const pendingMigrations = this.listMigrations({ pending: true });
    const results: MigrationResult[] = [];
    
    for (const migration of pendingMigrations) {
      try {
        const result = await this.applyMigration(migration.version, {
          dryRun: options.dryRun,
          createBackup: options.createBackups
        });
        results.push(result);
        
        if (!result.success && options.stopOnError) {
          break;
        }
      } catch (error: any) {
        const errorResult: MigrationResult = {
          migrationId: migration.id,
          version: migration.version,
          name: migration.name,
          success: false,
          errors: [error.message],
          warnings: [],
          executionTime: 0,
          timestamp: new Date().toISOString()
        };
        results.push(errorResult);
        
        if (options.stopOnError) {
          break;
        }
      }
    }
    
    return results;
  }
  
  getMigrationLog(version?: string, limit: number = 50): any[] {
    const query = version 
      ? 'SELECT * FROM migration_log WHERE version = ? ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM migration_log ORDER BY timestamp DESC LIMIT ?';
    
    const params = version ? [version, limit] : [limit];
    return this.db.getDatabase().prepare(query).all(...params) as any[];
  }
  
  private async createBackup(version: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `context_backup_${version}_${timestamp}.db`;
    
    // For SQLite, we can create a backup by copying the database file
    // In a more complex implementation, you might use SQLite backup API
    const fs = require('fs');
    fs.copyFileSync(this.db.getDatabase().name, backupPath);
    
    return backupPath;
  }
  
  private validateSQL(sql: string): void {
    // Basic SQL validation
    if (!sql || sql.trim().length === 0) {
      throw new Error('Empty SQL statement');
    }
    
    // Check for potentially dangerous operations
    const dangerousPatterns = [
      /DROP\s+DATABASE/i,
      /DELETE\s+FROM\s+\w+\s*;?\s*$/i, // DELETE without WHERE
      /TRUNCATE/i
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(sql)) {
        throw new Error('Potentially dangerous SQL detected');
      }
    }
  }
  
  private calculateChecksum(content: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
  
  private rowToMigration(row: any): Migration {
    return {
      id: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      up: row.up_sql,
      down: row.down_sql,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : undefined,
      requiresBackup: Boolean(row.requires_backup),
      checksum: row.checksum,
      createdAt: row.created_at,
      appliedAt: row.applied_at,
      rollbackAt: row.rollback_at
    };
  }
  
  private logMigration(result: MigrationResult, action: string, backupPath?: string): void {
    this.db.getDatabase().prepare(`
      INSERT INTO migration_log (
        id, migration_id, version, action, success, errors, warnings,
        execution_time, rows_affected, backup_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), result.migrationId, result.version, action,
      result.success ? 1 : 0,
      result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      result.warnings.length > 0 ? JSON.stringify(result.warnings) : null,
      result.executionTime, result.rowsAffected, backupPath
    );
  }
  
  // Predefined migrations for common schema updates
  static getDefaultMigrations(): Omit<Migration, 'id' | 'createdAt'>[] {
    return [
      {
        version: '1.0.0',
        name: 'Add size column to context_items',
        description: 'Add size tracking for context items',
        up: `
          ALTER TABLE context_items ADD COLUMN size INTEGER DEFAULT 0;
          UPDATE context_items SET size = LENGTH(value) WHERE size = 0;
        `,
        down: `
          ALTER TABLE context_items DROP COLUMN size;
        `
      },
      {
        version: '1.1.0',
        name: 'Create compressed_context table',
        description: 'Support for context compression',
        up: `
          CREATE TABLE IF NOT EXISTS compressed_context (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            original_count INTEGER NOT NULL,
            compressed_data TEXT NOT NULL,
            compression_ratio REAL NOT NULL,
            date_range_start TIMESTAMP NOT NULL,
            date_range_end TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
          );
          CREATE INDEX IF NOT EXISTS idx_compressed_session ON compressed_context(session_id);
        `,
        down: `
          DROP TABLE IF EXISTS compressed_context;
        `,
        dependencies: ['1.0.0']
      },
      {
        version: '1.2.0',
        name: 'Add metadata support',
        description: 'Add metadata column for extensibility',
        up: `
          ALTER TABLE context_items ADD COLUMN metadata TEXT;
          ALTER TABLE sessions ADD COLUMN metadata TEXT;
        `,
        down: `
          ALTER TABLE context_items DROP COLUMN metadata;
          ALTER TABLE sessions DROP COLUMN metadata;
        `,
        dependencies: ['1.1.0']
      }
    ];
  }
}