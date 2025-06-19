import { DatabaseManager } from '../utils/database.js';
import { SessionRepository } from './SessionRepository.js';
import { ContextRepository } from './ContextRepository.js';
import { FileRepository } from './FileRepository.js';
import { CheckpointRepository } from './CheckpointRepository.js';

export class RepositoryManager {
  private dbManager: DatabaseManager;
  
  public readonly sessions: SessionRepository;
  public readonly contexts: ContextRepository;
  public readonly files: FileRepository;
  public readonly checkpoints: CheckpointRepository;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    
    // Initialize all repositories
    this.sessions = new SessionRepository(dbManager);
    this.contexts = new ContextRepository(dbManager);
    this.files = new FileRepository(dbManager);
    this.checkpoints = new CheckpointRepository(dbManager);
  }

  /**
   * Get the underlying database manager
   */
  getDatabaseManager(): DatabaseManager {
    return this.dbManager;
  }

  /**
   * Close all database connections
   */
  close(): void {
    this.dbManager.close();
  }

  /**
   * Get session statistics across all repositories
   */
  getSessionStats(sessionId: string) {
    const contextStats = this.contexts.getStatsBySession(sessionId);
    const fileStats = this.files.getStatsBySession(sessionId);
    const checkpointStats = this.checkpoints.getStatsBySession(sessionId);
    
    return {
      session: this.sessions.getById(sessionId),
      contexts: contextStats,
      files: fileStats,
      checkpoints: checkpointStats,
      totalSize: contextStats.totalSize + fileStats.totalSize
    };
  }

  /**
   * Clean up old data across all repositories
   */
  cleanup(olderThanDays: number): { filesDeleted: number } {
    const filesDeleted = this.files.cleanup(olderThanDays);
    
    return {
      filesDeleted
    };
  }
}