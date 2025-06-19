import Database from 'better-sqlite3';
import { DatabaseManager } from '../utils/database.js';

export abstract class BaseRepository {
  protected db: Database.Database;
  protected dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    this.db = dbManager.getDatabase();
  }

  protected calculateSize(value: string): number {
    return Buffer.byteLength(value, 'utf8');
  }

  protected generateId(): string {
    // Using crypto.randomUUID() for better performance if available
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback to uuid v4 pattern
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  protected getCurrentTimestamp(): string {
    return new Date().toISOString();
  }
}