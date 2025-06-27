import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { ContextRepository } from '../../repositories/ContextRepository';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Tests for Issue #11: ACTUAL BUG DEMONSTRATION
 *
 * ROOT CAUSE IDENTIFIED:
 * Both searchEnhanced and queryEnhanced incorrectly start with "WHERE session_id = ?"
 * This limits them to only show items from the current session.
 *
 * CORRECT BEHAVIOR (as shown in other methods like getAccessibleItems):
 * Should start with "WHERE (is_private = 0 OR session_id = ?)"
 * This shows: public items from ANY session + private items from OWN session
 *
 * CURRENT INCORRECT BEHAVIOR:
 * Only shows items from current session (both public and private)
 * Misses public items from other sessions entirely
 */
describe('Issue #11: Actual Bug - Incorrect Session Filtering', () => {
  let dbManager: DatabaseManager;
  let tempDbPath: string;
  let db: any;
  let contextRepo: ContextRepository;
  let testSessionId: string;
  let otherSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-actual-bug-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    contextRepo = new ContextRepository(dbManager);

    // Create test sessions
    testSessionId = uuidv4();
    otherSessionId = uuidv4();

    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      testSessionId,
      'Main Test Session'
    );
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(
      otherSessionId,
      'Other Session'
    );

    // Create test data that demonstrates the bug
    const testItems = [
      // Items in main session
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'my_public_auth',
        value: 'Public auth task in my session',
        category: 'task',
        priority: 'high',
        channel: 'main',
        created_at: new Date().toISOString(),
        is_private: 0, // Public - should be visible to all
      },
      {
        id: uuidv4(),
        session_id: testSessionId,
        key: 'my_private_auth',
        value: 'Private auth notes in my session',
        category: 'note',
        priority: 'normal',
        channel: 'main',
        created_at: new Date().toISOString(),
        is_private: 1, // Private - only visible to own session
      },
      // Items in other session
      {
        id: uuidv4(),
        session_id: otherSessionId,
        key: 'other_public_auth',
        value: 'Public auth documentation from other session',
        category: 'docs',
        priority: 'normal',
        channel: 'docs',
        created_at: new Date().toISOString(),
        is_private: 0, // Public - SHOULD be visible to main session but currently ISN'T
      },
      {
        id: uuidv4(),
        session_id: otherSessionId,
        key: 'other_private_auth',
        value: 'Private auth secrets from other session',
        category: 'secret',
        priority: 'high',
        channel: 'security',
        created_at: new Date().toISOString(),
        is_private: 1, // Private - should NOT be visible to main session
      },
    ];

    // Insert test data
    const stmt = db.prepare(`
      INSERT INTO context_items (
        id, session_id, key, value, category, priority, channel, 
        created_at, is_private
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    testItems.forEach(item => {
      stmt.run(
        item.id,
        item.session_id,
        item.key,
        item.value,
        item.category,
        item.priority,
        item.channel,
        item.created_at,
        item.is_private
      );
    });
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (_e) {
      // Ignore cleanup errors
    }
  });

  describe('Demonstrate the ACTUAL bug', () => {
    it('FAILING TEST: searchEnhanced should show public items from other sessions but does not', () => {
      const searchResult = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
      });

      // console.log('searchEnhanced results:', {
      //   total: searchResult.items.length,
      //   items: searchResult.items.map(i => ({
      //     key: i.key,
      //     session_id: i.session_id,
      //     is_private: i.is_private,
      //     from_other_session: i.session_id !== testSessionId,
      //   })),
      // });

      // BUG: This should find the public item 'other_public_auth' from other session
      const publicItemsFromOtherSession = searchResult.items.filter(
        item => item.session_id === otherSessionId && item.is_private === 0
      );

      const privateItemsFromOtherSession = searchResult.items.filter(
        item => item.session_id === otherSessionId && item.is_private === 1
      );

      // console.log('Analysis:', {
      //   publicFromOther: publicItemsFromOtherSession.length,
      //   privateFromOther: privateItemsFromOtherSession.length,
      //   shouldSeePublicFromOther: 1, // other_public_auth
      //   shouldSeePrivateFromOther: 0, // none
      // });

      // THIS TEST WILL FAIL because searchEnhanced incorrectly limits to current session only
      expect(publicItemsFromOtherSession.length).toBe(1); // Should find other_public_auth
      expect(privateItemsFromOtherSession.length).toBe(0); // Should NOT find other_private_auth
    });

    it('FAILING TEST: queryEnhanced should show public items from other sessions but does not', () => {
      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
      });

      // console.log('queryEnhanced results:', {
      //   total: queryResult.items.length,
      //   items: queryResult.items.map(i => ({
      //     key: i.key,
      //     session_id: i.session_id,
      //     is_private: i.is_private,
      //     from_other_session: i.session_id !== testSessionId,
      //   })),
      // });

      // Filter for items with 'auth' to compare with searchEnhanced
      const authItems = queryResult.items.filter(
        item => item.key.includes('auth') || item.value.includes('auth')
      );

      const publicItemsFromOtherSession = authItems.filter(
        item => item.session_id === otherSessionId && item.is_private === 0
      );

      const privateItemsFromOtherSession = authItems.filter(
        item => item.session_id === otherSessionId && item.is_private === 1
      );

      // console.log('Analysis:', {
      //   authItems: authItems.length,
      //   publicFromOther: publicItemsFromOtherSession.length,
      //   privateFromOther: privateItemsFromOtherSession.length,
      //   shouldSeePublicFromOther: 1, // other_public_auth
      //   shouldSeePrivateFromOther: 0, // none
      // });

      // THIS TEST WILL FAIL because queryEnhanced incorrectly limits to current session only
      expect(publicItemsFromOtherSession.length).toBe(1); // Should find other_public_auth
      expect(privateItemsFromOtherSession.length).toBe(0); // Should NOT find other_private_auth
    });

    it('CONTROL TEST: getAccessibleItems shows correct privacy behavior', () => {
      // This method correctly implements the privacy filter
      const accessibleItems = contextRepo.getAccessibleItems(testSessionId);

      // console.log('getAccessibleItems results (CORRECT behavior):', {
      //   total: accessibleItems.length,
      //   items: accessibleItems.map(i => ({
      //     key: i.key,
      //     session_id: i.session_id,
      //     is_private: i.is_private,
      //     from_other_session: i.session_id !== testSessionId,
      //   })),
      // });

      const publicItemsFromOtherSession = accessibleItems.filter(
        item => item.session_id === otherSessionId && item.is_private === 0
      );

      const privateItemsFromOtherSession = accessibleItems.filter(
        item => item.session_id === otherSessionId && item.is_private === 1
      );

      const myPrivateItems = accessibleItems.filter(
        item => item.session_id === testSessionId && item.is_private === 1
      );

      // console.log('Correct privacy analysis:', {
      //   publicFromOther: publicItemsFromOtherSession.length,
      //   privateFromOther: privateItemsFromOtherSession.length,
      //   myPrivateItems: myPrivateItems.length,
      // });

      // This should work correctly
      expect(publicItemsFromOtherSession.length).toBe(1); // Should find other_public_auth
      expect(privateItemsFromOtherSession.length).toBe(0); // Should NOT find other_private_auth
      expect(myPrivateItems.length).toBe(1); // Should find my_private_auth
    });
  });

  describe('Show what the bug causes in practice', () => {
    it('Bug impact: search with filters returns inconsistent results', () => {
      // This demonstrates how the session-only filtering affects real usage

      // User searches for auth-related content with filters
      const searchWithCategory = contextRepo.searchEnhanced({
        query: 'auth',
        sessionId: testSessionId,
        category: 'docs', // This category only exists in other session
      });

      const queryWithCategory = contextRepo.queryEnhanced({
        sessionId: testSessionId,
        category: 'docs',
      });

      // console.log('Search with category filter:', {
      //   searchResults: searchWithCategory.items.length,
      //   queryResults: queryWithCategory.items.length,
      //   searchItems: searchWithCategory.items.map(i => i.key),
      //   queryItems: queryWithCategory.items.map(i => i.key),
      // });

      // FIXED: Both now return 1 result because users can see public docs from other sessions
      expect(searchWithCategory.items.length).toBe(1); // Now correctly finds public docs
      expect(queryWithCategory.items.length).toBe(1); // Now correctly finds public docs

      // This is why users report "filters not working" - they're not seeing expected results
    });

    it('Bug impact: users miss valuable public content from other sessions', () => {
      // User searches for documentation
      const searchForDocs = contextRepo.searchEnhanced({
        query: 'documentation',
        sessionId: testSessionId,
      });

      const allPublicDocs = contextRepo
        .getAccessibleItems(testSessionId)
        .filter(item => item.value.includes('documentation') && item.is_private === 0);

      // console.log('Documentation search impact:', {
      //   searchFound: searchForDocs.items.length,
      //   actualPublicDocs: allPublicDocs.length,
      //   missedDocs: allPublicDocs.length - searchForDocs.items.length,
      //   missedItems: allPublicDocs
      //     .filter(doc => !searchForDocs.items.some(found => found.key === doc.key))
      //     .map(i => ({ key: i.key, session: i.session_id })),
      // });

      // FIXED: Users now find all available public content
      expect(searchForDocs.items.length).toBe(allPublicDocs.length);
    });
  });

  describe('Expected behavior after fix', () => {
    it('After fix: searchEnhanced should work like getAccessibleItems', () => {
      // Once fixed, searchEnhanced should respect privacy like getAccessibleItems
      const searchResult = contextRepo.searchEnhanced({
        query: '', // Empty query to get all items
        sessionId: testSessionId,
      });

      const accessibleItems = contextRepo.getAccessibleItems(testSessionId);

      // After fix, these should return the same items
      expect(searchResult.items.length).toBe(accessibleItems.length);

      const searchKeys = new Set(searchResult.items.map(i => i.key));
      const accessibleKeys = new Set(accessibleItems.map(i => i.key));

      expect(searchKeys).toEqual(accessibleKeys);
    });

    it('After fix: queryEnhanced should work like getAccessibleItems', () => {
      // Once fixed, queryEnhanced should respect privacy like getAccessibleItems
      const queryResult = contextRepo.queryEnhanced({
        sessionId: testSessionId,
      });

      const accessibleItems = contextRepo.getAccessibleItems(testSessionId);

      // After fix, these should return the same items
      expect(queryResult.items.length).toBe(accessibleItems.length);

      const queryKeys = new Set(queryResult.items.map(i => i.key));
      const accessibleKeys = new Set(accessibleItems.map(i => i.key));

      expect(queryKeys).toEqual(accessibleKeys);
    });
  });
});
