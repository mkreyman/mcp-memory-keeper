import { DatabaseManager } from '../../utils/database';
import { MigrationManager } from '../../utils/migrations';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('Database Migration Integration Tests', () => {
  let dbManager: DatabaseManager;
  let migrationManager: MigrationManager;
  let tempDbPath: string;
  let db: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-migrations-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    migrationManager = new MigrationManager(dbManager);
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (_e) {
      // Ignore
    }
  });

  describe('Migration Management', () => {
    it('should create and retrieve migrations', () => {
      const migration = {
        version: '1.0.0',
        name: 'Add test table',
        description: 'Creates a test table for testing',
        up: 'CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT);',
        down: 'DROP TABLE test_table;',
        requiresBackup: true,
      };

      const migrationId = migrationManager.createMigration(migration);
      expect(migrationId).toBeDefined();
      expect(typeof migrationId).toBe('string');

      const retrieved = migrationManager.getMigration(migration.version);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe(migration.name);
      expect(retrieved!.version).toBe(migration.version);
      expect(retrieved!.up).toBe(migration.up);
      expect(retrieved!.down).toBe(migration.down);
      expect(retrieved!.requiresBackup).toBe(migration.requiresBackup);
    });

    it('should list all migrations', () => {
      const migrations = [
        { version: '1.0.0', name: 'Migration 1', up: 'SELECT 1;' },
        { version: '1.1.0', name: 'Migration 2', up: 'SELECT 2;' },
        { version: '1.2.0', name: 'Migration 3', up: 'SELECT 3;' },
      ];

      const migrationIds = migrations.map(m => migrationManager.createMigration(m));

      const allMigrations = migrationManager.listMigrations();
      expect(allMigrations.length).toBeGreaterThanOrEqual(3);

      const createdMigrations = allMigrations.filter(m => migrationIds.includes(m.id));
      expect(createdMigrations.length).toBe(3);
    });

    it('should filter migrations by applied status', () => {
      const migrations = [
        { version: '2.0.0', name: 'Applied Migration', up: 'SELECT 1;' },
        { version: '2.1.0', name: 'Pending Migration', up: 'SELECT 2;' },
      ];

      migrations.forEach(m => migrationManager.createMigration(m));

      // Apply one migration
      const appliedMigration = migrationManager.getMigration('2.0.0')!;
      db.prepare('UPDATE migrations SET applied_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        appliedMigration.id
      );

      const appliedMigrations = migrationManager.listMigrations({ applied: true });
      const pendingMigrations = migrationManager.listMigrations({ pending: true });

      expect(appliedMigrations.some(m => m.version === '2.0.0')).toBe(true);
      expect(pendingMigrations.some(m => m.version === '2.1.0')).toBe(true);
      expect(pendingMigrations.some(m => m.version === '2.0.0')).toBe(false);
    });

    it('should enforce unique versions', () => {
      const migration1 = { version: '3.0.0', name: 'Migration 1', up: 'SELECT 1;' };
      const migration2 = { version: '3.0.0', name: 'Migration 2', up: 'SELECT 2;' };

      migrationManager.createMigration(migration1);

      expect(() => migrationManager.createMigration(migration2)).toThrow();
    });

    it('should calculate checksums for migrations', () => {
      const migration = {
        version: '4.0.0',
        name: 'Checksum Test',
        up: 'CREATE TABLE checksum_test (id INTEGER);',
        down: 'DROP TABLE checksum_test;',
      };

      migrationManager.createMigration(migration);

      const retrieved = migrationManager.getMigration(migration.version);
      expect(retrieved!.checksum).toBeDefined();
      expect(retrieved!.checksum).toHaveLength(16); // SHA-256 substring
    });
  });

  describe('Migration Status', () => {
    beforeEach(() => {
      // Create test migrations
      const migrations = [
        { version: '5.0.0', name: 'Migration 1', up: 'SELECT 1;' },
        { version: '5.1.0', name: 'Migration 2', up: 'SELECT 2;', requiresBackup: true },
        { version: '5.2.0', name: 'Migration 3', up: 'SELECT 3;' },
      ];

      migrations.forEach(m => migrationManager.createMigration(m));

      // Apply first migration
      const appliedMigration = migrationManager.getMigration('5.0.0')!;
      db.prepare('UPDATE migrations SET applied_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        appliedMigration.id
      );
    });

    it('should provide comprehensive status', () => {
      const status = migrationManager.getStatus();

      expect(status.totalMigrations).toBeGreaterThanOrEqual(3);
      expect(status.appliedMigrations).toBeGreaterThanOrEqual(1);
      expect(status.pendingMigrations).toBeGreaterThanOrEqual(2);

      expect(status.pending.length).toBeGreaterThanOrEqual(2);
      expect(status.applied.length).toBeGreaterThanOrEqual(1);

      expect(status.lastMigration).toBeDefined();
      expect(status.lastMigration!.version).toBe('5.0.0');
    });

    it('should identify migrations requiring backups', () => {
      const status = migrationManager.getStatus();

      const backupRequired = status.pending.find(m => m.requiresBackup);
      expect(backupRequired).toBeDefined();
      expect(backupRequired!.version).toBe('5.1.0');
    });

    it('should handle empty migration state', () => {
      // Clear all migrations
      db.prepare('DELETE FROM migrations').run();

      const status = migrationManager.getStatus();

      expect(status.totalMigrations).toBe(0);
      expect(status.appliedMigrations).toBe(0);
      expect(status.pendingMigrations).toBe(0);
      expect(status.currentVersion).toBe('0.0.0');
      expect(status.lastMigration).toBeUndefined();
    });
  });

  describe('Migration Execution', () => {
    beforeEach(() => {
      // Create test table for migration testing
      db.exec(`
        CREATE TABLE IF NOT EXISTS migration_test (
          id INTEGER PRIMARY KEY,
          name TEXT
        );
      `);
    });

    it('should apply migration successfully', async () => {
      const migration = {
        version: '6.0.0',
        name: 'Add column test',
        up: 'ALTER TABLE migration_test ADD COLUMN email TEXT;',
        down: 'ALTER TABLE migration_test DROP COLUMN email;',
      };

      migrationManager.createMigration(migration);

      const result = await migrationManager.applyMigration('6.0.0', { dryRun: false });

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);

      // Verify migration was marked as applied
      const appliedMigration = migrationManager.getMigration('6.0.0');
      expect(appliedMigration!.appliedAt).toBeDefined();

      // Verify schema change
      const columns = db.prepare('PRAGMA table_info(migration_test)').all();
      expect(columns.some((col: any) => col.name === 'email')).toBe(true);
    });

    it('should perform dry run without changes', async () => {
      const migration = {
        version: '6.1.0',
        name: 'Dry run test',
        up: 'ALTER TABLE migration_test ADD COLUMN phone TEXT;',
      };

      migrationManager.createMigration(migration);

      const result = await migrationManager.applyMigration('6.1.0', { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Dry run - no changes applied');

      // Verify migration was NOT marked as applied
      const appliedMigration = migrationManager.getMigration('6.1.0');
      expect(appliedMigration!.appliedAt).toBeNull();

      // Verify no schema change
      const columns = db.prepare('PRAGMA table_info(migration_test)').all();
      expect(columns.some((col: any) => col.name === 'phone')).toBe(false);
    });

    it('should rollback migration successfully', async () => {
      const migration = {
        version: '6.2.0',
        name: 'Rollback test',
        up: 'ALTER TABLE migration_test ADD COLUMN temp_column TEXT;',
        down: 'ALTER TABLE migration_test DROP COLUMN temp_column;',
      };

      migrationManager.createMigration(migration);

      // Apply migration first
      await migrationManager.applyMigration('6.2.0', { dryRun: false });

      // Verify column was added
      let columns = db.prepare('PRAGMA table_info(migration_test)').all();
      expect(columns.some((col: any) => col.name === 'temp_column')).toBe(true);

      // Rollback migration
      const result = await migrationManager.rollbackMigration('6.2.0', { dryRun: false });

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);

      // Verify migration was marked as rolled back
      const rolledBackMigration = migrationManager.getMigration('6.2.0');
      expect(rolledBackMigration!.appliedAt).toBeNull();
      expect(rolledBackMigration!.rollbackAt).toBeDefined();

      // Verify column was removed
      columns = db.prepare('PRAGMA table_info(migration_test)').all();
      expect(columns.some((col: any) => col.name === 'temp_column')).toBe(false);
    });

    it('should handle migration dependencies', async () => {
      const migrations = [
        { version: '7.0.0', name: 'Base migration', up: 'SELECT 1;' },
        {
          version: '7.1.0',
          name: 'Dependent migration',
          up: 'SELECT 2;',
          dependencies: ['7.0.0'],
        },
      ];

      migrations.forEach(m => migrationManager.createMigration(m));

      // Try to apply dependent migration without dependency
      const failResult = await migrationManager.applyMigration('7.1.0', { dryRun: false });
      expect(failResult.success).toBe(false);
      expect(failResult.errors).toContain('Dependency not satisfied: 7.0.0');

      // Apply base migration first
      await migrationManager.applyMigration('7.0.0', { dryRun: false });

      // Now dependent migration should work
      const successResult = await migrationManager.applyMigration('7.1.0', { dryRun: false });
      expect(successResult.success).toBe(true);
    });

    it('should validate SQL before execution', async () => {
      const migration = {
        version: '7.2.0',
        name: 'Invalid SQL',
        up: '', // Empty SQL
      };

      migrationManager.createMigration(migration);

      const result = await migrationManager.applyMigration('7.2.0', { dryRun: false });
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Empty SQL statement');
    });

    it('should detect dangerous SQL operations', async () => {
      const migration = {
        version: '7.3.0',
        name: 'Dangerous SQL',
        up: 'DELETE FROM migration_test;', // DELETE without WHERE
      };

      migrationManager.createMigration(migration);

      const result = await migrationManager.applyMigration('7.3.0', { dryRun: false });
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Potentially dangerous SQL detected');
    });

    it('should handle transaction rollback on error', async () => {
      const migration = {
        version: '7.4.0',
        name: 'Error migration',
        up: 'ALTER TABLE non_existent_table ADD COLUMN test TEXT;', // Should fail
      };

      migrationManager.createMigration(migration);

      const result = await migrationManager.applyMigration('7.4.0', { dryRun: false });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      // Verify migration was NOT marked as applied
      const failedMigration = migrationManager.getMigration('7.4.0');
      expect(failedMigration!.appliedAt).toBeNull();
    });
  });

  describe('Batch Operations', () => {
    beforeEach(() => {
      // Create multiple pending migrations
      const migrations = [
        { version: '8.0.0', name: 'Migration 1', up: 'SELECT 1;' },
        { version: '8.1.0', name: 'Migration 2', up: 'SELECT 2;' },
        { version: '8.2.0', name: 'Migration 3', up: 'SELECT 3;' },
      ];

      migrations.forEach(m => migrationManager.createMigration(m));
    });

    it('should apply all pending migrations', async () => {
      const results = await migrationManager.applyAllPending({ dryRun: false });

      expect(results.length).toBe(3);
      expect(results.every(r => r.success)).toBe(true);

      // Verify all migrations were applied
      const status = migrationManager.getStatus();
      expect(status.pendingMigrations).toBe(0);
      expect(status.appliedMigrations).toBeGreaterThanOrEqual(3);
    });

    it('should stop on error when configured', async () => {
      // Add a migration that will fail
      const badMigration = {
        version: '8.3.0',
        name: 'Bad Migration',
        up: 'INVALID SQL SYNTAX;',
      };
      migrationManager.createMigration(badMigration);

      const results = await migrationManager.applyAllPending({
        dryRun: false,
        stopOnError: true,
      });

      // Should have tried 4 migrations but stopped at the invalid one
      expect(results.length).toBeLessThanOrEqual(4);
      expect(results.some(r => !r.success)).toBe(true);
    });

    it('should continue on error when configured', async () => {
      // Add a migration that will fail
      const badMigration = {
        version: '8.4.0',
        name: 'Bad Migration',
        up: 'INVALID SQL SYNTAX;',
      };
      migrationManager.createMigration(badMigration);

      const results = await migrationManager.applyAllPending({
        dryRun: false,
        stopOnError: false,
      });

      // Should have tried all 4 migrations
      expect(results.length).toBe(4);
      expect(results.some(r => r.success)).toBe(true);
      expect(results.some(r => !r.success)).toBe(true);
    });
  });

  describe('Logging and Audit', () => {
    it('should log migration execution', async () => {
      const migration = {
        version: '9.0.0',
        name: 'Logging test',
        up: 'SELECT 1;',
      };

      migrationManager.createMigration(migration);
      await migrationManager.applyMigration('9.0.0', { dryRun: false });

      const logs = migrationManager.getMigrationLog('9.0.0');
      expect(logs.length).toBeGreaterThan(0);

      const logEntry = logs[0];
      expect(logEntry.version).toBe('9.0.0');
      expect(logEntry.action).toBe('apply');
      expect(logEntry.success).toBe(1); // SQLite boolean
      expect(logEntry.execution_time).toBeGreaterThanOrEqual(0);
    });

    it('should log rollback operations', async () => {
      const migration = {
        version: '9.1.0',
        name: 'Rollback logging test',
        up: 'SELECT 1;',
        down: 'SELECT 0;',
      };

      migrationManager.createMigration(migration);
      await migrationManager.applyMigration('9.1.0', { dryRun: false });
      await migrationManager.rollbackMigration('9.1.0', { dryRun: false });

      const logs = migrationManager.getMigrationLog('9.1.0');
      expect(logs.length).toBe(2);

      const applyLog = logs.find(l => l.action === 'apply');
      const rollbackLog = logs.find(l => l.action === 'rollback');

      expect(applyLog).toBeDefined();
      expect(rollbackLog).toBeDefined();
    });

    it('should limit log results', () => {
      const logs = migrationManager.getMigrationLog(undefined, 5);
      expect(logs.length).toBeLessThanOrEqual(5);
    });

    it('should log errors properly', async () => {
      const migration = {
        version: '9.2.0',
        name: 'Error logging test',
        up: 'INVALID SQL;',
      };

      migrationManager.createMigration(migration);
      const result = await migrationManager.applyMigration('9.2.0', { dryRun: false });

      expect(result.success).toBe(false);

      const logs = migrationManager.getMigrationLog('9.2.0');
      const errorLog = logs[0];

      expect(errorLog.success).toBe(0); // SQLite boolean
      expect(errorLog.errors).toBeDefined();

      const errors = JSON.parse(errorLog.errors);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('Default Migrations', () => {
    it('should provide default migrations', () => {
      const defaultMigrations = (MigrationManager as any).getDefaultMigrations();

      expect(defaultMigrations.length).toBeGreaterThan(0);
      expect(defaultMigrations[0]).toHaveProperty('version');
      expect(defaultMigrations[0]).toHaveProperty('name');
      expect(defaultMigrations[0]).toHaveProperty('up');
    });

    it('should create default migrations without errors', () => {
      const defaultMigrations = (MigrationManager as any).getDefaultMigrations();

      for (const migration of defaultMigrations) {
        expect(() => migrationManager.createMigration(migration)).not.toThrow();
      }

      const createdMigrations = migrationManager.listMigrations();
      expect(createdMigrations.length).toBe(defaultMigrations.length);
    });

    it('should have proper dependency chains', () => {
      const defaultMigrations = (MigrationManager as any).getDefaultMigrations();

      // Check that dependencies exist
      const versions = defaultMigrations.map((m: any) => m.version);

      for (const migration of defaultMigrations) {
        if (migration.dependencies) {
          for (const dep of migration.dependencies) {
            expect(versions).toContain(dep);
          }
        }
      }
    });

    it('should have rollback SQL for important migrations', () => {
      const defaultMigrations = (MigrationManager as any).getDefaultMigrations();

      // Most default migrations should have rollback capability
      const migrationsWithRollback = defaultMigrations.filter((m: any) => m.down);
      expect(migrationsWithRollback.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent migration application', async () => {
      await expect(migrationManager.applyMigration('non-existent')).rejects.toThrow(
        'Migration not found'
      );
    });

    it('should handle non-existent migration rollback', async () => {
      await expect(migrationManager.rollbackMigration('non-existent')).rejects.toThrow(
        'Migration not found'
      );
    });

    it('should handle double application', async () => {
      const migration = {
        version: '10.0.0',
        name: 'Double apply test',
        up: 'SELECT 1;',
      };

      migrationManager.createMigration(migration);
      await migrationManager.applyMigration('10.0.0', { dryRun: false });

      await expect(migrationManager.applyMigration('10.0.0', { dryRun: false })).rejects.toThrow(
        'already applied'
      );
    });

    it('should handle rollback without down SQL', async () => {
      const migration = {
        version: '10.1.0',
        name: 'No rollback test',
        up: 'SELECT 1;',
        // No down SQL
      };

      migrationManager.createMigration(migration);
      await migrationManager.applyMigration('10.1.0', { dryRun: false });

      await expect(migrationManager.rollbackMigration('10.1.0', { dryRun: false })).rejects.toThrow(
        'no rollback SQL'
      );
    });

    it('should handle rollback of non-applied migration', async () => {
      const migration = {
        version: '10.2.0',
        name: 'Not applied test',
        up: 'SELECT 1;',
        down: 'SELECT 0;',
      };

      migrationManager.createMigration(migration);

      await expect(migrationManager.rollbackMigration('10.2.0', { dryRun: false })).rejects.toThrow(
        'not applied'
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle migrations with no description', () => {
      const migration = {
        version: '11.0.0',
        name: 'No description',
        up: 'SELECT 1;',
      };

      expect(() => migrationManager.createMigration(migration)).not.toThrow();

      const retrieved = migrationManager.getMigration('11.0.0');
      expect(retrieved!.description).toBeNull();
    });

    it('should handle migrations with no dependencies', () => {
      const migration = {
        version: '11.1.0',
        name: 'No dependencies',
        up: 'SELECT 1;',
      };

      migrationManager.createMigration(migration);

      // Should apply without dependency check
      expect(async () => {
        await migrationManager.applyMigration('11.1.0', { dryRun: false });
      }).not.toThrow();
    });

    it('should handle empty migration list for batch operations', async () => {
      // Clear all migrations
      db.prepare('DELETE FROM migrations').run();

      const results = await migrationManager.applyAllPending({ dryRun: false });
      expect(results.length).toBe(0);
    });

    it('should handle very long SQL statements', () => {
      const longSQL = 'SELECT ' + '1,'.repeat(1000) + '1;';

      const migration = {
        version: '11.2.0',
        name: 'Long SQL',
        up: longSQL,
      };

      expect(() => migrationManager.createMigration(migration)).not.toThrow();

      const retrieved = migrationManager.getMigration('11.2.0');
      expect(retrieved!.up).toBe(longSQL);
    });
  });
});
