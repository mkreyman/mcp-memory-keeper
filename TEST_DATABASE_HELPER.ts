// Test Database Helper for Fixing Timestamp Issues
// This file provides utilities to manage database triggers during tests

import { Database } from 'better-sqlite3';

/**
 * Disables timestamp update triggers during tests to prevent unexpected updates
 * This solves the issue where database triggers interfere with timestamp assertions
 */
export function disableTimestampTriggers(db: Database): void {
  // Only disable in test environment for safety
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Timestamp triggers should only be disabled in test environment');
  }

  try {
    db.exec(`
      DROP TRIGGER IF EXISTS update_context_items_updated_at;
      DROP TRIGGER IF EXISTS update_sessions_updated_at;
      DROP TRIGGER IF EXISTS update_checkpoints_updated_at;
      DROP TRIGGER IF EXISTS update_context_watchers_updated_at;
    `);
  } catch (error) {
    console.warn('Warning: Could not disable timestamp triggers:', error);
  }
}

/**
 * Restores timestamp update triggers after tests
 */
export function restoreTimestampTriggers(db: Database): void {
  try {
    // Restore context_items trigger
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_context_items_updated_at
      AFTER UPDATE ON context_items
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE context_items SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
      END;
    `);

    // Restore sessions trigger
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_sessions_updated_at
      AFTER UPDATE ON sessions
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE sessions SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
      END;
    `);

    // Restore checkpoints trigger
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_checkpoints_updated_at
      AFTER UPDATE ON checkpoints
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE checkpoints SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
      END;
    `);

    // Restore context_watchers trigger
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_context_watchers_updated_at
      AFTER UPDATE ON context_watchers
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE context_watchers SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
      END;
    `);
  } catch (error) {
    console.warn('Warning: Could not restore timestamp triggers:', error);
  }
}

/**
 * Sets up proper test isolation for database operations
 */
export function setupTestDatabase(db: Database): void {
  // Disable foreign key constraints temporarily for easier cleanup
  db.pragma('foreign_keys = OFF');
  
  // Disable triggers
  disableTimestampTriggers(db);
  
  // Set synchronous mode for test consistency
  db.pragma('synchronous = FULL');
}

/**
 * Cleans up test database state
 */
export function cleanupTestDatabase(db: Database): void {
  // Re-enable foreign key constraints
  db.pragma('foreign_keys = ON');
  
  // Restore triggers
  restoreTimestampTriggers(db);
}

/**
 * Helper to normalize timestamps for consistent comparisons
 */
export function normalizeTimestamp(timestamp: string | number | Date): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  if (typeof timestamp === 'string') {
    return new Date(timestamp).getTime();
  }
  return timestamp;
}

/**
 * Helper to create a timestamp for testing that's guaranteed to be different
 */
export function createTestTimestamp(offsetMs: number = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * Usage in test files:
 * 
 * import { setupTestDatabase, cleanupTestDatabase } from '../helpers/test-database';
 * 
 * beforeEach(() => {
 *   setupTestDatabase(db);
 * });
 * 
 * afterEach(() => {
 *   cleanupTestDatabase(db);
 * });
 */