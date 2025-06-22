import { DatabaseManager } from '../utils/database.js';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Test helper for managing database connections and cleanup
 */
export class TestDatabaseHelper {
  private static instances: DatabaseManager[] = [];
  private static rawDatabases: Database.Database[] = [];

  /**
   * Create a test database with automatic cleanup tracking
   */
  static createTestDatabase(): DatabaseManager {
    const tempDbPath = path.join(os.tmpdir(), `test-db-${Date.now()}-${Math.random()}.db`);
    const dbManager = new DatabaseManager({ filename: tempDbPath });
    this.instances.push(dbManager);
    return dbManager;
  }

  /**
   * Create a raw database connection with automatic cleanup tracking
   */
  static createRawDatabase(filename?: string): Database.Database {
    const tempDbPath = filename || path.join(os.tmpdir(), `test-raw-db-${Date.now()}-${Math.random()}.db`);
    const db = new Database(tempDbPath);
    this.rawDatabases.push(db);
    return db;
  }

  /**
   * Clean up all tracked database instances
   */
  static async cleanupAll(): Promise<void> {
    // Close DatabaseManager instances
    await Promise.all(this.instances.map(async (db) => {
      try {
        db.close();
      } catch (error) {
        console.warn('Error closing DatabaseManager:', error);
      }
    }));

    // Close raw Database instances
    for (const db of this.rawDatabases) {
      try {
        if (db.open) {
          db.close();
        }
      } catch (error) {
        console.warn('Error closing raw Database:', error);
      }
    }

    // Clean up temporary files
    this.instances = [];
    this.rawDatabases = [];
  }

  /**
   * Register a database for cleanup without creating it
   */
  static registerForCleanup(db: DatabaseManager | Database.Database): void {
    if (db instanceof DatabaseManager) {
      this.instances.push(db);
    } else {
      this.rawDatabases.push(db);
    }
  }

  /**
   * Clean up WAL and SHM files for a database
   */
  static cleanupDbFiles(dbPath: string): void {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    } catch (error) {
      console.warn('Error cleaning up database files:', error);
    }
  }
}

// Global setup for test process tracking
declare global {
  var testDatabases: (DatabaseManager | Database.Database)[];
  var testProcesses: any[];
}

// Initialize global arrays
global.testDatabases = global.testDatabases || [];
global.testProcesses = global.testProcesses || [];