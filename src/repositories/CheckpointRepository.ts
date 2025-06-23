import { BaseRepository } from './BaseRepository.js';
import { Checkpoint, CreateCheckpointInput } from '../types/entities.js';

export class CheckpointRepository extends BaseRepository {
  create(sessionId: string, input: CreateCheckpointInput): Checkpoint {
    const id = this.generateId();
    const timestamp = this.getCurrentTimestamp();

    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      sessionId,
      input.name,
      input.description || null,
      input.git_status || null,
      input.git_branch || null,
      timestamp
    );

    return this.getById(id)!;
  }

  getById(id: string): Checkpoint | null {
    const stmt = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?');
    return stmt.get(id) as Checkpoint | null;
  }

  getByName(sessionId: string, name: string): Checkpoint | null {
    const stmt = this.db.prepare(`
      SELECT * FROM checkpoints 
      WHERE session_id = ? AND name = ?
    `);
    return stmt.get(sessionId, name) as Checkpoint | null;
  }

  getBySessionId(sessionId: string): Checkpoint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM checkpoints 
      WHERE session_id = ? 
      ORDER BY created_at DESC
    `);
    return stmt.all(sessionId) as Checkpoint[];
  }

  delete(id: string): void {
    // Delete related checkpoint items and files first
    this.db.prepare('DELETE FROM checkpoint_items WHERE checkpoint_id = ?').run(id);
    this.db.prepare('DELETE FROM checkpoint_files WHERE checkpoint_id = ?').run(id);

    // Delete the checkpoint
    this.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(id);
  }

  deleteBySessionId(sessionId: string): void {
    const checkpoints = this.getBySessionId(sessionId);
    for (const checkpoint of checkpoints) {
      this.delete(checkpoint.id);
    }
  }

  // Checkpoint Items Management
  addContextItem(checkpointId: string, contextItemId: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id)
      VALUES (?, ?, ?)
    `);
    stmt.run(this.generateId(), checkpointId, contextItemId);
  }

  addContextItems(checkpointId: string, contextItemIds: string[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id)
      VALUES (?, ?, ?)
    `);

    for (const itemId of contextItemIds) {
      stmt.run(this.generateId(), checkpointId, itemId);
    }
  }

  getContextItemIds(checkpointId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT context_item_id 
      FROM checkpoint_items 
      WHERE checkpoint_id = ?
    `);
    return stmt.all(checkpointId).map((row: any) => row.context_item_id);
  }

  // Checkpoint Files Management
  addFile(checkpointId: string, fileCacheId: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoint_files (id, checkpoint_id, file_cache_id)
      VALUES (?, ?, ?)
    `);
    stmt.run(this.generateId(), checkpointId, fileCacheId);
  }

  addFiles(checkpointId: string, fileCacheIds: string[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoint_files (id, checkpoint_id, file_cache_id)
      VALUES (?, ?, ?)
    `);

    for (const fileId of fileCacheIds) {
      stmt.run(this.generateId(), checkpointId, fileId);
    }
  }

  getFileCacheIds(checkpointId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT file_cache_id 
      FROM checkpoint_files 
      WHERE checkpoint_id = ?
    `);
    return stmt.all(checkpointId).map((row: any) => row.file_cache_id);
  }

  // Complete checkpoint with items and files
  createComplete(
    sessionId: string,
    input: CreateCheckpointInput,
    contextItemIds: string[] = [],
    fileCacheIds: string[] = []
  ): Checkpoint {
    const checkpoint = this.create(sessionId, input);

    if (contextItemIds.length > 0) {
      this.addContextItems(checkpoint.id, contextItemIds);
    }

    if (fileCacheIds.length > 0) {
      this.addFiles(checkpoint.id, fileCacheIds);
    }

    return checkpoint;
  }

  getStatsBySession(sessionId: string): { count: number; totalItems: number; totalFiles: number } {
    const checkpointCount = this.db
      .prepare(
        `
      SELECT COUNT(*) as count 
      FROM checkpoints 
      WHERE session_id = ?
    `
      )
      .get(sessionId) as any;

    const itemCount = this.db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM checkpoint_items ci
      JOIN checkpoints c ON ci.checkpoint_id = c.id
      WHERE c.session_id = ?
    `
      )
      .get(sessionId) as any;

    const fileCount = this.db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM checkpoint_files cf
      JOIN checkpoints c ON cf.checkpoint_id = c.id
      WHERE c.session_id = ?
    `
      )
      .get(sessionId) as any;

    return {
      count: checkpointCount.count || 0,
      totalItems: itemCount.count || 0,
      totalFiles: fileCount.count || 0,
    };
  }
}
