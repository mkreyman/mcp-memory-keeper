import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import * as fs from 'fs';
import * as path from 'path';

describe('Simplified Sharing Model Tests', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  const testDbPath = path.join(__dirname, `test-simplified-sharing-${Date.now()}.db`);

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    dbManager = new DatabaseManager({ filename: testDbPath });
    repositories = new RepositoryManager(dbManager);
  });

  afterEach(() => {
    dbManager.close();

    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(`${testDbPath}-wal`)) {
      fs.unlinkSync(`${testDbPath}-wal`);
    }
    if (fs.existsSync(`${testDbPath}-shm`)) {
      fs.unlinkSync(`${testDbPath}-shm`);
    }
  });

  describe('Default Sharing Behavior', () => {
    let session1Id: string;
    let session2Id: string;
    let session3Id: string;

    beforeEach(() => {
      // Create test sessions
      const session1 = repositories.sessions.create({ name: 'Session 1' });
      const session2 = repositories.sessions.create({ name: 'Session 2' });
      const session3 = repositories.sessions.create({ name: 'Session 3' });

      session1Id = session1.id;
      session2Id = session2.id;
      session3Id = session3.id;
    });

    it('should make items accessible across sessions by default', () => {
      // Create item in session 1 without private flag
      const _item = repositories.contexts.save(session1Id, {
        key: 'shared_by_default',
        value: 'This should be accessible from all sessions',
        category: 'test',
      });

      // Should be accessible from session 2
      const accessibleItem = repositories.contexts.getAccessibleByKey(
        session2Id,
        'shared_by_default'
      );
      expect(accessibleItem).toBeTruthy();
      expect(accessibleItem?.value).toBe('This should be accessible from all sessions');

      // Should be accessible from session 3
      const accessibleItem3 = repositories.contexts.getAccessibleByKey(
        session3Id,
        'shared_by_default'
      );
      expect(accessibleItem3).toBeTruthy();
      expect(accessibleItem3?.value).toBe('This should be accessible from all sessions');

      // Should be accessible when listing from any session
      const session2Items = repositories.contexts.getAccessibleItems(session2Id);
      expect(session2Items.some(i => i.key === 'shared_by_default')).toBe(true);
    });

    it('should make private items only accessible from creating session', () => {
      // Create private item in session 1
      const _privateItem = repositories.contexts.save(session1Id, {
        key: 'private_notes',
        value: 'Session 1 private thoughts',
        category: 'note',
        isPrivate: true,
      });

      // Should be accessible from session 1
      const fromSession1 = repositories.contexts.getAccessibleByKey(session1Id, 'private_notes');
      expect(fromSession1).toBeTruthy();
      expect(fromSession1?.value).toBe('Session 1 private thoughts');

      // Should NOT be accessible from session 2
      const fromSession2 = repositories.contexts.getAccessibleByKey(session2Id, 'private_notes');
      expect(fromSession2).toBeNull();

      // Should NOT appear in session 2's list
      const session2Items = repositories.contexts.getAccessibleItems(session2Id);
      expect(session2Items.some(i => i.key === 'private_notes')).toBe(false);

      // Should appear in session 1's list
      const session1Items = repositories.contexts.getAccessibleItems(session1Id);
      expect(session1Items.some(i => i.key === 'private_notes')).toBe(true);
    });

    it('should handle mixed public and private items correctly', () => {
      // Create a mix of public and private items
      repositories.contexts.save(session1Id, {
        key: 'public_standard',
        value: 'Team coding standard',
        category: 'standard',
      });

      repositories.contexts.save(session1Id, {
        key: 'private_debug',
        value: 'Debugging notes',
        category: 'note',
        isPrivate: true,
      });

      repositories.contexts.save(session2Id, {
        key: 'another_public',
        value: 'Another shared item',
        category: 'info',
      });

      repositories.contexts.save(session2Id, {
        key: 'session2_private',
        value: 'Session 2 private',
        category: 'note',
        isPrivate: true,
      });

      // Session 1 should see: its private + all public
      const session1Items = repositories.contexts.getAccessibleItems(session1Id);
      expect(session1Items).toHaveLength(3); // public_standard, private_debug, another_public
      expect(session1Items.some(i => i.key === 'public_standard')).toBe(true);
      expect(session1Items.some(i => i.key === 'private_debug')).toBe(true);
      expect(session1Items.some(i => i.key === 'another_public')).toBe(true);
      expect(session1Items.some(i => i.key === 'session2_private')).toBe(false);

      // Session 2 should see: its private + all public
      const session2Items = repositories.contexts.getAccessibleItems(session2Id);
      expect(session2Items).toHaveLength(3); // public_standard, another_public, session2_private
      expect(session2Items.some(i => i.key === 'public_standard')).toBe(true);
      expect(session2Items.some(i => i.key === 'private_debug')).toBe(false);
      expect(session2Items.some(i => i.key === 'another_public')).toBe(true);
      expect(session2Items.some(i => i.key === 'session2_private')).toBe(true);

      // Session 3 should only see public items
      const session3Items = repositories.contexts.getAccessibleItems(session3Id);
      expect(session3Items).toHaveLength(2); // public_standard, another_public
      expect(session3Items.some(i => i.key === 'public_standard')).toBe(true);
      expect(session3Items.some(i => i.key === 'another_public')).toBe(true);
    });
  });

  describe('Search Functionality', () => {
    let session1Id: string;
    let session2Id: string;

    beforeEach(() => {
      const session1 = repositories.sessions.create({ name: 'Session 1' });
      const session2 = repositories.sessions.create({ name: 'Session 2' });

      session1Id = session1.id;
      session2Id = session2.id;

      // Create test data
      repositories.contexts.save(session1Id, {
        key: 'public_auth_pattern',
        value: 'Use JWT for authentication across the app',
        category: 'pattern',
      });

      repositories.contexts.save(session1Id, {
        key: 'private_auth_notes',
        value: 'Authentication debugging notes - token expires too fast',
        category: 'debug',
        isPrivate: true,
      });

      repositories.contexts.save(session2Id, {
        key: 'auth_config',
        value: 'Authentication configuration for production',
        category: 'config',
      });

      repositories.contexts.save(session2Id, {
        key: 'private_password',
        value: 'Temporary password for testing auth',
        category: 'secret',
        isPrivate: true,
      });
    });

    it('should search public items by default', () => {
      // Search without specifying session - should only return public items
      const results = repositories.contexts.search('auth');
      expect(results).toHaveLength(2); // Only public items
      expect(results.some(r => r.key === 'public_auth_pattern')).toBe(true);
      expect(results.some(r => r.key === 'auth_config')).toBe(true);
      expect(results.some(r => r.key === 'private_auth_notes')).toBe(false);
      expect(results.some(r => r.key === 'private_password')).toBe(false);
    });

    it('should include private items when searching with includePrivate from owning session', () => {
      // Search from session 1 with includePrivate
      const results = repositories.contexts.search('auth', session1Id, true);
      expect(results).toHaveLength(3); // public items + session1's private
      expect(results.some(r => r.key === 'public_auth_pattern')).toBe(true);
      expect(results.some(r => r.key === 'auth_config')).toBe(true);
      expect(results.some(r => r.key === 'private_auth_notes')).toBe(true);
      expect(results.some(r => r.key === 'private_password')).toBe(false);
    });

    it('should search across all sessions correctly', () => {
      // Search across all sessions from session 1
      const results = repositories.contexts.searchAcrossSessions('auth', session1Id);
      expect(results).toHaveLength(3); // All public + session1's private
      expect(results.some(r => r.key === 'public_auth_pattern')).toBe(true);
      expect(results.some(r => r.key === 'auth_config')).toBe(true);
      expect(results.some(r => r.key === 'private_auth_notes')).toBe(true);
      expect(results.some(r => r.key === 'private_password')).toBe(false);

      // Search across all sessions without current session - only public
      const publicOnlyResults = repositories.contexts.searchAcrossSessions('auth');
      expect(publicOnlyResults).toHaveLength(2);
      expect(publicOnlyResults.every(r => !r.key.includes('private'))).toBe(true);
    });
  });

  describe('Category Filtering', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repositories.sessions.create({ name: 'Test Session' });
      sessionId = session.id;

      // Create items with different categories and privacy
      repositories.contexts.save(sessionId, {
        key: 'task1',
        value: 'Public task',
        category: 'task',
      });

      repositories.contexts.save(sessionId, {
        key: 'task2',
        value: 'Private task',
        category: 'task',
        isPrivate: true,
      });

      repositories.contexts.save(sessionId, {
        key: 'note1',
        value: 'Public note',
        category: 'note',
      });
    });

    it('should filter by category while respecting privacy', () => {
      // Get tasks from the owning session
      const tasksFromOwner = repositories.contexts.getAccessibleItems(sessionId, {
        category: 'task',
      });
      expect(tasksFromOwner).toHaveLength(2); // Both public and private

      // Get tasks from another session
      const otherSession = repositories.sessions.create({ name: 'Other Session' });
      const tasksFromOther = repositories.contexts.getAccessibleItems(otherSession.id, {
        category: 'task',
      });
      expect(tasksFromOther).toHaveLength(1); // Only public
      expect(tasksFromOther[0].key).toBe('task1');
    });
  });

  describe('Key Uniqueness with Privacy', () => {
    it('should handle same key in different sessions correctly', () => {
      const session1 = repositories.sessions.create({ name: 'Session 1' });
      const session2 = repositories.sessions.create({ name: 'Session 2' });

      // Create items with same key in different sessions
      repositories.contexts.save(session1.id, {
        key: 'config',
        value: 'Session 1 config',
        category: 'config',
      });

      repositories.contexts.save(session2.id, {
        key: 'config',
        value: 'Session 2 config',
        category: 'config',
      });

      // When accessing by key, should get the most relevant one
      const fromSession1 = repositories.contexts.getAccessibleByKey(session1.id, 'config');
      expect(fromSession1?.value).toBe('Session 1 config'); // Should prefer own session's item

      const fromSession2 = repositories.contexts.getAccessibleByKey(session2.id, 'config');
      expect(fromSession2?.value).toBe('Session 2 config'); // Should prefer own session's item

      // Create a third session to test which public item it gets
      const session3 = repositories.sessions.create({ name: 'Session 3' });
      const fromSession3 = repositories.contexts.getAccessibleByKey(session3.id, 'config');
      expect(fromSession3).toBeTruthy(); // Should get one of them (latest by created_at)
    });

    it('should handle private vs public items with same key', () => {
      const session1 = repositories.sessions.create({ name: 'Session 1' });
      const session2 = repositories.sessions.create({ name: 'Session 2' });

      // Session 1 creates a private item
      repositories.contexts.save(session1.id, {
        key: 'secret',
        value: 'Session 1 private secret',
        isPrivate: true,
      });

      // Session 2 creates a public item with same key
      repositories.contexts.save(session2.id, {
        key: 'secret',
        value: 'Session 2 public secret',
        isPrivate: false,
      });

      // Session 1 should see its own private item
      const fromSession1 = repositories.contexts.getAccessibleByKey(session1.id, 'secret');
      expect(fromSession1?.value).toBe('Session 1 private secret');

      // Session 2 should see its own public item
      const fromSession2 = repositories.contexts.getAccessibleByKey(session2.id, 'secret');
      expect(fromSession2?.value).toBe('Session 2 public secret');

      // Session 3 should only see the public item
      const session3 = repositories.sessions.create({ name: 'Session 3' });
      const fromSession3 = repositories.contexts.getAccessibleByKey(session3.id, 'secret');
      expect(fromSession3?.value).toBe('Session 2 public secret');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined privacy flag as public', () => {
      const session = repositories.sessions.create({ name: 'Test Session' });

      // Save without specifying isPrivate
      const _item = repositories.contexts.save(session.id, {
        key: 'default_privacy',
        value: 'Should be public',
      });

      // Verify it's public (is_private = 0)
      expect(_item.is_private).toBe(0);

      // Should be accessible from other sessions
      const otherSession = repositories.sessions.create({ name: 'Other Session' });
      const accessible = repositories.contexts.getAccessibleByKey(
        otherSession.id,
        'default_privacy'
      );
      expect(accessible).toBeTruthy();
    });

    it('should handle empty results gracefully', () => {
      const session = repositories.sessions.create({ name: 'Test Session' });

      // Search for non-existent items
      const searchResults = repositories.contexts.search('nonexistent', session.id);
      expect(searchResults).toHaveLength(0);

      // Get by non-existent key
      const byKey = repositories.contexts.getAccessibleByKey(session.id, 'nonexistent');
      expect(byKey).toBeNull();

      // Get items from empty session
      const items = repositories.contexts.getAccessibleItems(session.id);
      expect(items).toHaveLength(0);
    });
  });
});
