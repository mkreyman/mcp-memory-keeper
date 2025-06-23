import Database from 'better-sqlite3';
import { DatabaseManager } from './database';
import * as fs from 'fs';
import * as path from 'path';

export interface MigrationIssue {
  table: string;
  issue: string;
  severity: 'error' | 'warning';
  fix?: string;
}

export interface SchemaColumn {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: any;
  pk: boolean;
}

export class MigrationHealthCheck {
  private db: Database.Database;
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.db = dbManager.getDatabase();
    this.dbManager = dbManager;
  }

  /**
   * Get all tables from the database
   */
  private getAllTables(): string[] {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    return tables.map(t => t.name);
  }

  /**
   * Get columns for a specific table from the actual database
   */
  private getTableColumns(tableName: string): SchemaColumn[] {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
    return columns.map(col => ({
      name: col.name,
      type: col.type,
      notNull: col.notnull === 1,
      defaultValue: col.dflt_value,
      pk: col.pk === 1,
    }));
  }

  /**
   * Dynamically discover the expected schema from SQL create statements in database.ts
   */
  private discoverExpectedSchema(): Map<string, Map<string, string>> {
    const schemaMap = new Map<string, Map<string, string>>();

    // Try to find database.ts or database.js
    let dbFilePath = path.join(__dirname, 'database.ts');
    let dbContent: string;

    try {
      // First try TypeScript source
      dbContent = fs.readFileSync(dbFilePath, 'utf-8');
    } catch (_error) {
      // If TypeScript not found, try JavaScript (compiled)
      try {
        dbFilePath = path.join(__dirname, 'database.js');
        dbContent = fs.readFileSync(dbFilePath, 'utf-8');
      } catch (_error2) {
        // If neither found, return hardcoded critical columns as fallback
        return this.getFallbackSchema();
      }
    }

    // Extract the createTables method content
    const createTablesMatch = dbContent.match(
      /createTables\(\)[\s\S]*?this\.db\.exec\(`([\s\S]*?)`\);/
    );
    if (!createTablesMatch) {
      console.warn('Could not find createTables method in database.ts');
      return schemaMap;
    }

    const sqlContent = createTablesMatch[1];

    // Parse CREATE TABLE statements
    const tableRegex = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\)(?:\s*;|(?=\s*CREATE))/g;
    let match;

    while ((match = tableRegex.exec(sqlContent)) !== null) {
      const tableName = match[1];
      const columnsContent = match[2];

      // Extract column definitions
      const columnMap = new Map<string, string>();

      // First, remove all newlines and extra spaces to handle multi-line definitions
      const cleanedContent = columnsContent.replace(/\n\s*/g, ' ').trim();

      // Split by comma but be careful with constraints
      const parts = cleanedContent.split(/,(?![^(]*\))/);

      for (const part of parts) {
        const line = part.trim();

        // Skip constraint lines
        if (
          !line ||
          line.startsWith('FOREIGN KEY') ||
          line.startsWith('UNIQUE') ||
          line.startsWith('PRIMARY KEY') ||
          line.startsWith('CHECK') ||
          line.startsWith('--')
        ) {
          continue;
        }

        // Extract column name and full definition
        const columnMatch = line.match(/^(\w+)\s+(.+)$/);
        if (columnMatch) {
          const columnName = columnMatch[1];
          const columnDef = columnMatch[2].trim();
          columnMap.set(columnName, columnDef);
        }
      }

      schemaMap.set(tableName, columnMap);
    }

    return schemaMap;
  }

  /**
   * Fallback schema definition for when we can't parse the source files
   */
  private getFallbackSchema(): Map<string, Map<string, string>> {
    const schemaMap = new Map<string, Map<string, string>>();

    // Define critical columns that we know should exist
    const sessionsColumns = new Map<string, string>([
      ['id', 'TEXT PRIMARY KEY'],
      ['name', 'TEXT'],
      ['description', 'TEXT'],
      ['branch', 'TEXT'],
      ['working_directory', 'TEXT'],
      ['parent_id', 'TEXT'],
      ['created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
      ['updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
    ]);

    const contextItemsColumns = new Map<string, string>([
      ['id', 'TEXT PRIMARY KEY'],
      ['session_id', 'TEXT NOT NULL'],
      ['key', 'TEXT NOT NULL'],
      ['value', 'TEXT NOT NULL'],
      ['category', 'TEXT'],
      ['priority', "TEXT DEFAULT 'normal'"],
      ['metadata', 'TEXT'],
      ['size', 'INTEGER DEFAULT 0'],
      ['shared', 'BOOLEAN DEFAULT 0'],
      ['shared_with_sessions', 'TEXT'],
      ['created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
      ['updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
    ]);

    const fileCacheColumns = new Map<string, string>([
      ['id', 'TEXT PRIMARY KEY'],
      ['session_id', 'TEXT NOT NULL'],
      ['file_path', 'TEXT NOT NULL'],
      ['content', 'TEXT'],
      ['hash', 'TEXT'],
      ['size', 'INTEGER DEFAULT 0'],
      ['last_read', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
      ['updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
    ]);

    schemaMap.set('sessions', sessionsColumns);
    schemaMap.set('context_items', contextItemsColumns);
    schemaMap.set('file_cache', fileCacheColumns);

    return schemaMap;
  }

  /**
   * Generate SQLite-safe ALTER TABLE statement
   */
  private generateSafeAlterStatement(
    tableName: string,
    columnName: string,
    columnDef: string
  ): string {
    // SQLite doesn't support CURRENT_TIMESTAMP as default in ALTER TABLE
    // Replace with a static timestamp
    let safeColumnDef = columnDef;

    if (columnDef.includes('CURRENT_TIMESTAMP')) {
      const currentTimestamp = new Date().toISOString();
      safeColumnDef = columnDef.replace(
        /DEFAULT CURRENT_TIMESTAMP/g,
        `DEFAULT '${currentTimestamp}'`
      );
    }

    return `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${safeColumnDef}`;
  }

  /**
   * Check for missing columns by comparing actual DB with expected schema
   */
  checkMissingColumns(): MigrationIssue[] {
    const issues: MigrationIssue[] = [];
    const expectedSchema = this.discoverExpectedSchema();
    const existingTables = this.getAllTables();

    for (const [tableName, expectedColumns] of expectedSchema) {
      if (!existingTables.includes(tableName)) {
        continue; // Skip if table doesn't exist yet
      }

      const actualColumns = this.getTableColumns(tableName);
      const actualColumnNames = new Set(actualColumns.map(c => c.name));

      for (const [columnName, columnDef] of expectedColumns) {
        if (!actualColumnNames.has(columnName)) {
          issues.push({
            table: tableName,
            issue: `Missing column '${columnName}'`,
            severity: 'error',
            fix: this.generateSafeAlterStatement(tableName, columnName, columnDef),
          });
        }
      }
    }

    return issues;
  }

  /**
   * Run all health checks
   */
  runHealthCheck(): {
    issues: MigrationIssue[];
    canAutoFix: boolean;
    summary: string;
  } {
    const missingColumns = this.checkMissingColumns();
    const allIssues = [...missingColumns];

    const errors = allIssues.filter(i => i.severity === 'error');
    const warnings = allIssues.filter(i => i.severity === 'warning');

    const canAutoFix = errors.length > 0 && errors.every(e => e.fix);

    const summary = `Found ${errors.length} errors and ${warnings.length} warnings. ${
      canAutoFix ? 'Auto-fix available.' : 'Database schema is healthy.'
    }`;

    return {
      issues: allIssues,
      canAutoFix,
      summary,
    };
  }

  /**
   * Attempt to auto-fix migration issues
   */
  autoFixIssues(issues: MigrationIssue[]): {
    fixed: string[];
    failed: string[];
  } {
    const fixed: string[] = [];
    const failed: string[] = [];

    // Group fixes by table to run in transaction
    const fixesByTable = new Map<string, MigrationIssue[]>();
    for (const issue of issues) {
      if (issue.fix && issue.severity === 'error') {
        const _table = issue.table;
        if (!fixesByTable.has(_table)) {
          fixesByTable.set(_table, []);
        }
        fixesByTable.get(_table)!.push(issue);
      }
    }

    // Apply fixes table by table
    for (const [_table, tableIssues] of fixesByTable) {
      try {
        this.db.transaction(() => {
          for (const issue of tableIssues) {
            this.db.exec(issue.fix!);
            fixed.push(`Fixed: ${issue.table} - ${issue.issue}`);
          }
        })();
      } catch (error) {
        for (const issue of tableIssues) {
          failed.push(`Failed to fix ${issue.table} - ${issue.issue}: ${error}`);
        }
      }
    }

    return { fixed, failed };
  }

  /**
   * Generate a detailed migration report
   */
  generateReport(): string {
    const healthCheck = this.runHealthCheck();
    const report: string[] = [
      '=== MCP Memory Keeper Migration Health Check ===',
      '',
      `Summary: ${healthCheck.summary}`,
      '',
    ];

    if (healthCheck.issues.length === 0) {
      report.push('✅ All database columns are up to date!');
    } else {
      report.push('Issues found:');
      report.push('');

      for (const issue of healthCheck.issues) {
        const icon = issue.severity === 'error' ? '❌' : '⚠️';
        report.push(`${icon} [${issue.severity.toUpperCase()}] ${issue.table}: ${issue.issue}`);
        if (issue.fix) {
          report.push(`   Fix: ${issue.fix}`);
        }
        report.push('');
      }

      if (healthCheck.canAutoFix) {
        report.push('');
        report.push(
          '💡 Auto-fix is available. The server will apply fixes automatically on startup.'
        );
      }
    }

    return report.join('\n');
  }

  /**
   * Run automatic migration fix if needed
   */
  runAutoFix(): boolean {
    const healthCheck = this.runHealthCheck();

    if (healthCheck.issues.length === 0) {
      return true;
    }

    // Only log in non-test environments
    const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID;

    if (!isTest) {
      // eslint-disable-next-line no-console
      console.log('[MCP Memory Keeper] Running database migration health check...');
      // eslint-disable-next-line no-console
      console.log(this.generateReport());
    }

    if (healthCheck.canAutoFix) {
      if (!isTest) {
        // eslint-disable-next-line no-console
        console.log('[MCP Memory Keeper] Applying automatic fixes...');
      }

      const { fixed, failed } = this.autoFixIssues(healthCheck.issues);

      if (!isTest) {
        // eslint-disable-next-line no-console
        fixed.forEach(f => console.log(`✅ ${f}`));
        failed.forEach(f => console.error(`❌ ${f}`));
      }

      if (failed.length === 0) {
        if (!isTest) {
          // eslint-disable-next-line no-console
          console.log('[MCP Memory Keeper] All migrations applied successfully!');
        }
        return true;
      } else {
        if (!isTest) {
          console.error(
            '[MCP Memory Keeper] Some migrations failed. Manual intervention may be required.'
          );
        }
        return false;
      }
    }

    return false;
  }
}

/**
 * Standalone function to run migration health check from CLI
 */
export async function runMigrationHealthCheckCLI(
  dbPath: string,
  autoFix: boolean = false
): Promise<void> {
  const dbManager = new DatabaseManager({ filename: dbPath });
  const healthCheck = new MigrationHealthCheck(dbManager);

  // eslint-disable-next-line no-console
  console.log(healthCheck.generateReport());

  if (autoFix) {
    const issues = healthCheck.runHealthCheck().issues;
    const fixableIssues = issues.filter(i => i.severity === 'error' && i.fix);

    if (fixableIssues.length > 0) {
      // eslint-disable-next-line no-console
      console.log('\nAttempting auto-fix...');
      const { fixed, failed } = healthCheck.autoFixIssues(fixableIssues);

      // eslint-disable-next-line no-console
      fixed.forEach(f => console.log(`✅ ${f}`));
      // eslint-disable-next-line no-console
      failed.forEach(f => console.log(`❌ ${f}`));

      if (fixed.length > 0) {
        // eslint-disable-next-line no-console
        console.log('\n✅ Auto-fix completed. Please restart the MCP server.');
      }
    }
  }

  dbManager.close();
}
