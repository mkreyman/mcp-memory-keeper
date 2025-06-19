import { BaseRepository } from './BaseRepository.js';
import { FileCache, CreateFileCacheInput } from '../types/entities.js';

export class FileRepository extends BaseRepository {
  
  cache(sessionId: string, input: CreateFileCacheInput): FileCache {
    const id = this.generateId();
    const size = this.calculateSize(input.content);
    const timestamp = this.getCurrentTimestamp();
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO file_cache 
      (id, session_id, file_path, content, hash, size, last_read, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      sessionId,
      input.file_path,
      input.content,
      input.hash || null,
      size,
      timestamp,
      timestamp
    );
    
    return this.getById(id)!;
  }

  getById(id: string): FileCache | null {
    const stmt = this.db.prepare('SELECT * FROM file_cache WHERE id = ?');
    return stmt.get(id) as FileCache | null;
  }

  getBySessionId(sessionId: string): FileCache[] {
    const stmt = this.db.prepare(`
      SELECT * FROM file_cache 
      WHERE session_id = ? 
      ORDER BY last_read DESC
    `);
    return stmt.all(sessionId) as FileCache[];
  }

  getByFilePath(sessionId: string, filePath: string): FileCache | null {
    const stmt = this.db.prepare(`
      SELECT * FROM file_cache 
      WHERE session_id = ? AND file_path = ?
    `);
    return stmt.get(sessionId, filePath) as FileCache | null;
  }

  hasChanged(sessionId: string, filePath: string, currentContent: string): boolean {
    const cached = this.getByFilePath(sessionId, filePath);
    if (!cached) {
      return true; // No cached version, so it's "changed"
    }
    
    return cached.content !== currentContent;
  }

  updateContent(sessionId: string, filePath: string, content: string, hash?: string): void {
    const size = this.calculateSize(content);
    const timestamp = this.getCurrentTimestamp();
    
    const stmt = this.db.prepare(`
      UPDATE file_cache 
      SET content = ?, hash = ?, size = ?, last_read = ?, updated_at = ?
      WHERE session_id = ? AND file_path = ?
    `);
    
    stmt.run(content, hash || null, size, timestamp, timestamp, sessionId, filePath);
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM file_cache WHERE id = ?');
    stmt.run(id);
  }

  deleteBySessionId(sessionId: string): void {
    const stmt = this.db.prepare('DELETE FROM file_cache WHERE session_id = ?');
    stmt.run(sessionId);
  }

  deleteByFilePath(sessionId: string, filePath: string): void {
    const stmt = this.db.prepare('DELETE FROM file_cache WHERE session_id = ? AND file_path = ?');
    stmt.run(sessionId, filePath);
  }

  copyBetweenSessions(fromSessionId: string, toSessionId: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO file_cache (id, session_id, file_path, content, hash, size, last_read, updated_at)
      SELECT ?, ?, file_path, content, hash, size, last_read, ?
      FROM file_cache
      WHERE session_id = ?
    `);
    
    const files = this.getBySessionId(fromSessionId);
    let copied = 0;
    
    for (const file of files) {
      stmt.run(this.generateId(), toSessionId, this.getCurrentTimestamp(), fromSessionId);
      copied++;
    }
    
    return copied;
  }

  getStatsBySession(sessionId: string): { count: number; totalSize: number } {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count, SUM(size) as totalSize 
      FROM file_cache 
      WHERE session_id = ?
    `);
    const result = stmt.get(sessionId) as any;
    
    return {
      count: result.count || 0,
      totalSize: result.totalSize || 0
    };
  }

  cleanup(olderThanDays: number): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    const stmt = this.db.prepare(`
      DELETE FROM file_cache 
      WHERE last_read < ?
    `);
    
    const result = stmt.run(cutoffDate.toISOString());
    return result.changes;
  }
}