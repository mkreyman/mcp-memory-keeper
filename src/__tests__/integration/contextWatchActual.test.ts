import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import { handleContextWatch } from '../../handlers/contextWatchHandlers';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('Context Watch Actual Implementation Tests', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  let tempDbPath: string;
  let testSessionId: string;

  beforeEach(async () => {
    tempDbPath = path.join(os.tmpdir(), `test-context-watch-actual-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });

    // Apply the context watch migration
    const db = dbManager.getDatabase();

    // Import and run the migration
    const migration004 = await import('../../migrations/004_add_context_watch');
    migration004.up(db);

    const migration005 = await import('../../migrations/005_add_context_watch');
    migration005.up(db);

    repositories = new RepositoryManager(dbManager);

    // Create test session
    const session = repositories.sessions.create({
      name: 'Test Session',
      description: 'Test session for context watch',
    });
    testSessionId = session.id;
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

  describe('Basic Watcher Operations', () => {
    it('should create a watcher and detect changes', async () => {
      // Create watcher
      const createResult = await handleContextWatch(
        {
          action: 'create',
          filters: {
            categories: ['task'],
          },
        },
        repositories,
        testSessionId
      );

      const createResponse = JSON.parse((createResult.content[0] as any).text);
      expect(createResponse.created).toBe(true);
      expect(createResponse.watcherId).toMatch(/^watch_[a-f0-9]{8}$/);

      const watcherId = createResponse.watcherId;

      // Add some context items
      repositories.contexts.save(testSessionId, {
        key: 'task_001',
        value: 'First task',
        category: 'task',
      });

      repositories.contexts.save(testSessionId, {
        key: 'note_001',
        value: 'First note',
        category: 'note',
      });

      // Poll for changes
      const pollResult = await handleContextWatch(
        {
          action: 'poll',
          watcherId,
        },
        repositories,
        testSessionId
      );

      const pollResponse = JSON.parse((pollResult.content[0] as any).text);

      // Should only see the task item
      expect(pollResponse.changes).toHaveLength(1);
      expect(pollResponse.changes[0].key).toBe('task_001');
      expect(pollResponse.changes[0].type).toBe('CREATE');
      expect(pollResponse.changes[0].category).toBe('task');
    });

    it('should handle watcher lifecycle', async () => {
      // Create watcher
      const createResult = await handleContextWatch(
        {
          action: 'create',
        },
        repositories,
        testSessionId
      );

      const { watcherId } = JSON.parse((createResult.content[0] as any).text);

      // List watchers
      const listResult = await handleContextWatch(
        {
          action: 'list',
        },
        repositories,
        testSessionId
      );

      const listResponse = JSON.parse((listResult.content[0] as any).text);
      expect(listResponse.total).toBe(1);
      expect(listResponse.watchers[0].watcherId).toBe(watcherId);
      expect(listResponse.watchers[0].active).toBe(true);

      // Stop watcher
      const stopResult = await handleContextWatch(
        {
          action: 'stop',
          watcherId,
        },
        repositories,
        testSessionId
      );

      const stopResponse = JSON.parse((stopResult.content[0] as any).text);
      expect(stopResponse.stopped).toBe(true);

      // Try to poll stopped watcher
      const pollResult = await handleContextWatch(
        {
          action: 'poll',
          watcherId,
        },
        repositories,
        testSessionId
      );

      expect((pollResult.content[0] as any).text).toContain('Error: Watcher is stopped');
    });

    it('should apply filters correctly', async () => {
      // Create watcher with key pattern filter
      const createResult = await handleContextWatch(
        {
          action: 'create',
          filters: {
            keys: ['user_*', '*_config'],
          },
        },
        repositories,
        testSessionId
      );

      const { watcherId } = JSON.parse((createResult.content[0] as any).text);

      // Add various items
      repositories.contexts.save(testSessionId, { key: 'user_profile', value: 'matches' });
      repositories.contexts.save(testSessionId, { key: 'app_config', value: 'matches' });
      repositories.contexts.save(testSessionId, { key: 'system_settings', value: 'no match' });

      // Poll for changes
      const pollResult = await handleContextWatch(
        {
          action: 'poll',
          watcherId,
        },
        repositories,
        testSessionId
      );

      const response = JSON.parse((pollResult.content[0] as any).text);

      expect(response.changes).toHaveLength(2);
      const keys = response.changes.map((c: any) => c.key);
      expect(keys).toContain('user_profile');
      expect(keys).toContain('app_config');
      expect(keys).not.toContain('system_settings');
    });
  });
});
