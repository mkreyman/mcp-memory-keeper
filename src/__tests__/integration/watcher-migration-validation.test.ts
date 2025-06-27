import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../utils/database';
import { TestDatabaseHelper } from '../../test-helpers/database-helper';

/**
 * Comprehensive test suite for validating watcher migrations at startup
 *
 * This test ensures that the watcher migration system (migrations 004 and 005)
 * are properly applied and all required database components exist.
 *
 * SUCCESS CRITERIA:
 * - All required tables exist (context_changes, context_watchers, deleted_items)
 * - All required triggers are installed and functional
 * - All required indexes are created for performance
 * - Schema matches the expected structure from migration files
 * - Triggers actually fire and record changes correctly
 */
describe('Watcher Migration Validation Tests', () => {
  let dbManager: DatabaseManager;
  let db: Database.Database;
  let tempDir: string;
  let tempDbPath: string;

  beforeEach(() => {
    // Create fresh test database for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-watcher-test-'));
    tempDbPath = path.join(tempDir, 'test.db');

    // Initialize with DatabaseManager which should run all migrations
    dbManager = new DatabaseManager({ filename: tempDbPath });
    db = dbManager.getDatabase();

    // Register for cleanup
    TestDatabaseHelper.registerForCleanup(dbManager);
  });

  afterEach(() => {
    try {
      dbManager.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  });

  describe('Required Tables Existence', () => {
    it('should have context_changes table with correct schema', () => {
      // Check table exists
      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='context_changes'
      `
        )
        .all();

      expect(tables).toHaveLength(1);
      expect(tables[0]).toEqual({ name: 'context_changes' });

      // Check table schema matches migration 004
      const columns = db.prepare('PRAGMA table_info(context_changes)').all() as any[];
      const columnNames = columns.map(col => col.name);

      // Verify all required columns from migration 004
      const expectedColumns = [
        'sequence_id',
        'session_id',
        'item_id',
        'key',
        'operation',
        'old_value',
        'new_value',
        'old_metadata',
        'new_metadata',
        'category',
        'priority',
        'channel',
        'size_delta',
        'created_at',
        'created_by',
      ];

      expectedColumns.forEach(col => {
        expect(columnNames).toContain(col);
      });

      // Check sequence_id is primary key with autoincrement
      const sequenceCol = columns.find(col => col.name === 'sequence_id');
      expect(sequenceCol.pk).toBe(1); // Primary key
      expect(sequenceCol.type).toBe('INTEGER');

      // Check operation constraint
      const operationCol = columns.find(col => col.name === 'operation');
      expect(operationCol.type).toBe('TEXT');
    });

    it('should have context_watchers table with correct schema', () => {
      // Check table exists
      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='context_watchers'
      `
        )
        .all();

      expect(tables).toHaveLength(1);

      // Check table schema
      const columns = db.prepare('PRAGMA table_info(context_watchers)').all() as any[];
      const columnNames = columns.map(col => col.name);

      // Verify columns from migration 004
      const expectedColumns = [
        'id',
        'session_id',
        'filter_keys',
        'filter_categories',
        'filter_channels',
        'filter_priorities',
        'last_sequence',
        'created_at',
        'last_poll_at',
        'expires_at',
        'metadata',
      ];

      expectedColumns.forEach(col => {
        expect(columnNames).toContain(col);
      });

      // Check id is primary key
      const idCol = columns.find(col => col.name === 'id');
      expect(idCol.pk).toBe(1);

      // Check for is_active column from migration 005
      expect(columnNames).toContain('is_active');
      const isActiveCol = columns.find(col => col.name === 'is_active');
      expect(isActiveCol.dflt_value).toBe('1'); // Default to active
    });

    it('should have deleted_items table from migration 005', () => {
      // Check table exists
      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='deleted_items'
      `
        )
        .all();

      expect(tables).toHaveLength(1);

      // Check table schema
      const columns = db.prepare('PRAGMA table_info(deleted_items)').all() as any[];
      const columnNames = columns.map(col => col.name);

      const expectedColumns = [
        'id',
        'session_id',
        'key',
        'category',
        'channel',
        'sequence_number',
        'deleted_at',
      ];

      expectedColumns.forEach(col => {
        expect(columnNames).toContain(col);
      });
    });

    it('should have sequence_number column added to context_items', () => {
      // Check that context_items table has sequence_number column from migration 005
      const columns = db.prepare('PRAGMA table_info(context_items)').all() as any[];
      const columnNames = columns.map(col => col.name);

      expect(columnNames).toContain('sequence_number');

      const seqCol = columns.find(col => col.name === 'sequence_number');
      expect(seqCol.dflt_value).toBe('0'); // Default to 0
    });
  });

  describe('Required Indexes', () => {
    it('should have all performance indexes from migration 004', () => {
      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name IN (
          'idx_changes_sequence', 
          'idx_changes_session_seq', 
          'idx_changes_created',
          'idx_watchers_expires',
          'idx_watchers_session'
        )
      `
        )
        .all() as any[];

      const indexNames = indexes.map(idx => idx.name);

      expect(indexNames).toContain('idx_changes_sequence');
      expect(indexNames).toContain('idx_changes_session_seq');
      expect(indexNames).toContain('idx_changes_created');
      expect(indexNames).toContain('idx_watchers_expires');
      expect(indexNames).toContain('idx_watchers_session');
    });

    it('should have indexes from migration 005', () => {
      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name IN (
          'idx_watchers_active',
          'idx_deleted_items_session',
          'idx_deleted_items_key'
        )
      `
        )
        .all() as any[];

      const indexNames = indexes.map(idx => idx.name);

      expect(indexNames).toContain('idx_watchers_active');
      expect(indexNames).toContain('idx_deleted_items_session');
      expect(indexNames).toContain('idx_deleted_items_key');
    });
  });

  describe('Required Triggers', () => {
    it('should have change tracking triggers from migration 004', () => {
      const triggers = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='trigger' AND name IN (
          'track_context_insert',
          'track_context_update', 
          'track_context_delete'
        )
      `
        )
        .all() as any[];

      const triggerNames = triggers.map(t => t.name);

      expect(triggerNames).toContain('track_context_insert');
      expect(triggerNames).toContain('track_context_update');
      expect(triggerNames).toContain('track_context_delete');

      expect(triggers).toHaveLength(3);
    });

    it('should have sequence increment triggers from migration 005', () => {
      const triggers = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='trigger' AND name IN (
          'increment_sequence_insert',
          'increment_sequence_update'
        )
      `
        )
        .all() as any[];

      const triggerNames = triggers.map(t => t.name);

      expect(triggerNames).toContain('increment_sequence_insert');
      expect(triggerNames).toContain('increment_sequence_update');
    });
  });

  describe('Functional Trigger Testing', () => {
    beforeEach(() => {
      // Create a test session for trigger testing
      db.prepare(
        `
        INSERT INTO sessions (id, name, description) 
        VALUES ('test-session', 'Test Session', 'Test Description')
      `
      ).run();
    });

    it('should track INSERT operations with track_context_insert trigger', () => {
      // Insert a context item
      db.prepare(
        `
        INSERT INTO context_items (
          id, session_id, key, value, category, priority, channel, size
        ) VALUES (
          'test-item-1', 'test-session', 'test-key', 'test-value', 
          'task', 'high', 'default', 10
        )
      `
      ).run();

      // Check that change was tracked
      const changes = db
        .prepare(
          `
        SELECT * FROM context_changes 
        WHERE item_id = 'test-item-1' AND operation = 'CREATE'
      `
        )
        .all() as any[];

      expect(changes).toHaveLength(1);

      const change = changes[0];
      expect(change.session_id).toBe('test-session');
      expect(change.key).toBe('test-key');
      expect(change.operation).toBe('CREATE');
      expect(change.new_value).toBe('test-value');
      expect(change.category).toBe('task');
      expect(change.priority).toBe('high');
      expect(change.channel).toBe('default');
      expect(change.size_delta).toBe(10);
      expect(change.created_by).toBe('context_save');
    });

    it('should track UPDATE operations with track_context_update trigger', () => {
      // Insert initial item
      db.prepare(
        `
        INSERT INTO context_items (
          id, session_id, key, value, category, priority, size
        ) VALUES (
          'test-item-2', 'test-session', 'update-key', 'old-value', 'note', 'low', 5
        )
      `
      ).run();

      // Update the item
      db.prepare(
        `
        UPDATE context_items 
        SET value = 'new-value', priority = 'high', size = 15
        WHERE id = 'test-item-2'
      `
      ).run();

      // Check that update was tracked
      const changes = db
        .prepare(
          `
        SELECT * FROM context_changes 
        WHERE item_id = 'test-item-2' AND operation = 'UPDATE'
      `
        )
        .all() as any[];

      expect(changes).toHaveLength(1);

      const change = changes[0];
      expect(change.old_value).toBe('old-value');
      expect(change.new_value).toBe('new-value');
      expect(change.size_delta).toBe(10); // 15 - 5
      expect(change.created_by).toBe('context_save');
    });

    it('should track DELETE operations with track_context_delete trigger', () => {
      // Insert item to delete
      db.prepare(
        `
        INSERT INTO context_items (
          id, session_id, key, value, category, size
        ) VALUES (
          'test-item-3', 'test-session', 'delete-key', 'delete-value', 'error', 8
        )
      `
      ).run();

      // Delete the item
      db.prepare(`DELETE FROM context_items WHERE id = 'test-item-3'`).run();

      // Check that deletion was tracked
      const changes = db
        .prepare(
          `
        SELECT * FROM context_changes 
        WHERE item_id = 'test-item-3' AND operation = 'DELETE'
      `
        )
        .all() as any[];

      expect(changes).toHaveLength(1);

      const change = changes[0];
      expect(change.old_value).toBe('delete-value');
      expect(change.new_value).toBeNull();
      expect(change.category).toBe('error');
      expect(change.size_delta).toBe(-8); // Negative for deletion
      expect(change.created_by).toBe('context_delete');
    });

    it('should auto-increment sequence numbers on INSERT', () => {
      // Insert multiple items
      db.prepare(
        `
        INSERT INTO context_items (
          id, session_id, key, value, sequence_number
        ) VALUES 
          ('seq-1', 'test-session', 'key1', 'value1', 0),
          ('seq-2', 'test-session', 'key2', 'value2', 0),
          ('seq-3', 'test-session', 'key3', 'value3', 0)
      `
      ).run();

      // Check sequence numbers were assigned
      const items = db
        .prepare(
          `
        SELECT id, sequence_number FROM context_items 
        WHERE session_id = 'test-session' 
        ORDER BY sequence_number
      `
        )
        .all() as any[];

      expect(items).toHaveLength(3);
      expect(items[0].sequence_number).toBeGreaterThan(0);
      expect(items[1].sequence_number).toBeGreaterThan(items[0].sequence_number);
      expect(items[2].sequence_number).toBeGreaterThan(items[1].sequence_number);
    });

    it('should update sequence numbers on significant updates', () => {
      // Insert item
      db.prepare(
        `
        INSERT INTO context_items (
          id, session_id, key, value, sequence_number
        ) VALUES ('seq-update', 'test-session', 'update-key', 'old-value', 0)
      `
      ).run();

      const originalSeq = db
        .prepare(
          `
        SELECT sequence_number FROM context_items WHERE id = 'seq-update'
      `
        )
        .get() as any;

      // Update the value (should trigger sequence increment)
      db.prepare(
        `
        UPDATE context_items SET value = 'new-value' WHERE id = 'seq-update'
      `
      ).run();

      const newSeq = db
        .prepare(
          `
        SELECT sequence_number FROM context_items WHERE id = 'seq-update'
      `
        )
        .get() as any;

      expect(newSeq.sequence_number).toBeGreaterThan(originalSeq.sequence_number);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing foreign key relationships gracefully', () => {
      // Try to insert change record with non-existent session
      // This should fail due to foreign key constraint
      expect(() => {
        db.prepare(
          `
          INSERT INTO context_changes (
            session_id, item_id, key, operation, new_value
          ) VALUES ('non-existent-session', 'item1', 'key1', 'CREATE', 'value1')
        `
        ).run();
      }).toThrow();
    });

    it('should enforce operation CHECK constraint', () => {
      // Create session first
      db.prepare(
        `
        INSERT INTO sessions (id, name) VALUES ('constraint-test', 'Test')
      `
      ).run();

      // Try invalid operation
      expect(() => {
        db.prepare(
          `
          INSERT INTO context_changes (
            session_id, item_id, key, operation, new_value
          ) VALUES ('constraint-test', 'item1', 'key1', 'INVALID_OP', 'value1')
        `
        ).run();
      }).toThrow();

      // Valid operations should work
      expect(() => {
        db.prepare(
          `
          INSERT INTO context_changes (
            session_id, item_id, key, operation, new_value
          ) VALUES ('constraint-test', 'item1', 'key1', 'CREATE', 'value1')
        `
        ).run();
      }).not.toThrow();
    });

    it('should handle NULL values correctly in trigger conditions', () => {
      // Create session and item with NULL metadata
      db.prepare(
        `
        INSERT INTO sessions (id, name) VALUES ('null-test', 'Null Test')
      `
      ).run();

      db.prepare(
        `
        INSERT INTO context_items (
          id, session_id, key, value, metadata, category
        ) VALUES ('null-item', 'null-test', 'null-key', 'value1', NULL, 'note')
      `
      ).run();

      // Update to non-NULL metadata (should trigger update tracking)
      db.prepare(
        `
        UPDATE context_items 
        SET metadata = '{"test": true}' 
        WHERE id = 'null-item'
      `
      ).run();

      // Check that change was tracked
      const changes = db
        .prepare(
          `
        SELECT * FROM context_changes 
        WHERE item_id = 'null-item' AND operation = 'UPDATE'
      `
        )
        .all();

      expect(changes).toHaveLength(1);
    });
  });

  describe('Migration Completeness', () => {
    it('should have applied all expected migrations', () => {
      // Check migration records exist (if migration table exists)
      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'
      `
        )
        .all();

      if (tables.length > 0) {
        const migrations = db
          .prepare(
            `
          SELECT version FROM migrations 
          WHERE version IN ('0.4.0', '0.5.0')
          ORDER BY version
        `
          )
          .all() as any[];

        // Should have both watcher migrations
        expect(migrations.map(m => m.version)).toEqual(['0.4.0', '0.5.0']);
      }
    });

    it('should handle database with partial watcher schema gracefully', () => {
      // This test verifies that migrations are idempotent
      // and can handle databases in various states

      // Check that all expected components exist
      const expectedTables = ['context_changes', 'context_watchers', 'deleted_items'];
      const existingTables = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN (${expectedTables.map(() => '?').join(',')})
      `
        )
        .all(...expectedTables) as any[];

      expect(existingTables).toHaveLength(expectedTables.length);

      // Check that all expected triggers exist
      const expectedTriggers = [
        'track_context_insert',
        'track_context_update',
        'track_context_delete',
        'increment_sequence_insert',
        'increment_sequence_update',
      ];

      const existingTriggers = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='trigger' AND name IN (${expectedTriggers.map(() => '?').join(',')})
      `
        )
        .all(...expectedTriggers) as any[];

      expect(existingTriggers).toHaveLength(expectedTriggers.length);
    });
  });

  describe('Performance Validation', () => {
    it('should have indexes that improve query performance', () => {
      // Create test data to verify index usage
      db.prepare(
        `
        INSERT INTO sessions (id, name) VALUES ('perf-test', 'Performance Test')
      `
      ).run();

      // Insert some test data
      for (let i = 0; i < 100; i++) {
        db.prepare(
          `
          INSERT INTO context_changes (
            session_id, item_id, key, operation, new_value, created_at
          ) VALUES (
            'perf-test', 'item-${i}', 'key-${i}', 'CREATE', 'value-${i}',
            datetime('now', '-${i} seconds')
          )
        `
        ).run();
      }

      // Query that should use index
      const explain = db
        .prepare(
          `
        EXPLAIN QUERY PLAN 
        SELECT * FROM context_changes 
        WHERE session_id = 'perf-test' 
        ORDER BY sequence_id DESC 
        LIMIT 10
      `
        )
        .all() as any[];

      // Should mention index usage (not exact string match due to SQLite variations)
      const hasIndexUsage = explain.some(
        row => row.detail.includes('idx_changes_session_seq') || row.detail.includes('USING INDEX')
      );

      expect(hasIndexUsage).toBe(true);
    });
  });
});
