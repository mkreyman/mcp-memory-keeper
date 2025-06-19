import { BaseRepository } from './BaseRepository.js';
import { Session, CreateSessionInput } from '../types/entities.js';

export class SessionRepository extends BaseRepository {
  
  create(input: CreateSessionInput): Session {
    const id = this.generateId();
    const timestamp = this.getCurrentTimestamp();
    
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, name, description, branch, working_directory, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      input.name || `Session ${timestamp}`,
      input.description || '',
      input.branch || null,
      input.working_directory || null,
      input.parent_id || null,
      timestamp,
      timestamp
    );
    
    return this.getById(id)!;
  }

  getById(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(id) as Session | null;
  }

  getAll(limit = 50): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit) as Session[];
  }

  getLatest(): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1');
    return stmt.get() as Session | null;
  }

  update(id: string, updates: Partial<Omit<Session, 'id' | 'created_at'>>): void {
    const setClause = Object.keys(updates)
      .filter(key => key !== 'id' && key !== 'created_at')
      .map(key => `${key} = ?`)
      .join(', ');
    
    if (setClause) {
      const values = Object.keys(updates)
        .filter(key => key !== 'id' && key !== 'created_at')
        .map(key => (updates as any)[key]);
      
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      
      stmt.run(...values, id);
    }
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(id);
  }

  findByBranch(branch: string): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE branch = ? ORDER BY created_at DESC');
    return stmt.all(branch) as Session[];
  }

  findByWorkingDirectory(workingDirectory: string): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE working_directory = ? ORDER BY created_at DESC');
    return stmt.all(workingDirectory) as Session[];
  }

  getChildren(parentId: string): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE parent_id = ? ORDER BY created_at DESC');
    return stmt.all(parentId) as Session[];
  }

  getRecent(limit = 10): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?');
    return stmt.all(limit) as Session[];
  }
}