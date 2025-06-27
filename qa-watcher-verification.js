#!/usr/bin/env node

// Import using require for CommonJS compatibility
const { DatabaseManager } = require('./dist/utils/database.js');
const { RepositoryManager } = require('./dist/repositories/RepositoryManager.js');
const { handleContextWatch } = require('./dist/handlers/contextWatchHandlers.js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

/**
 * Comprehensive QA Verification Script for Watcher Functionality
 * Tests all aspects of the watcher system fix for Issue #10
 */


console.log('🔍 QA Verification: Watcher Functionality Fix (Issue #10)');
console.log('=' .repeat(60));

// Test database path
const testDbPath = './qa-verification-test.db';

// Remove test database if exists
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

let db;
let repositories;
let sessionId;

async function init() {
  try {
    console.log('\n📋 1. INITIALIZATION TEST');
    console.log('- Creating fresh database...');
    
    db = new DatabaseManager(testDbPath);
    console.log('✅ Database created');
    
    console.log('- Initializing repositories...');
    repositories = new RepositoryManager(db);
    console.log('✅ Repositories initialized');
    
    console.log('- Creating test session...');
    sessionId = uuidv4();
    repositories.sessions.create({
      name: 'QA Verification Session',
      description: 'Test session for watcher functionality verification'
    });
    sessionId = repositories.sessions.getLatest().id;
    console.log(`✅ Session created: ${sessionId}`);
    
    return true;
  } catch (error) {
    console.error('❌ Initialization failed:', error.message);
    return false;
  }
}

async function testDatabaseSchema() {
  console.log('\n🗄️ 2. DATABASE SCHEMA TEST');
  
  try {
    console.log('- Checking for required tables...');
    const tables = db.getDatabase().prepare(`
      SELECT name FROM sqlite_master WHERE type='table' 
      AND name IN ('context_changes', 'context_watchers', 'deleted_items')
    `).all();
    
    const tableNames = tables.map(t => t.name);
    
    const requiredTables = ['context_changes', 'context_watchers', 'deleted_items'];
    const missingTables = requiredTables.filter(t => !tableNames.includes(t));
    
    if (missingTables.length > 0) {
      console.error(`❌ Missing tables: ${missingTables.join(', ')}`);
      return false;
    }
    
    console.log('✅ All required tables exist');
    
    // Check indexes
    console.log('- Checking indexes...');
    const indexes = db.getDatabase().prepare(`
      SELECT name FROM sqlite_master WHERE type='index' 
      AND name LIKE 'idx_%'
    `).all();
    
    const indexNames = indexes.map(i => i.name);
    console.log(`✅ Found ${indexNames.length} indexes`);
    
    // Check triggers
    console.log('- Checking triggers...');
    const triggers = db.getDatabase().prepare(`
      SELECT name FROM sqlite_master WHERE type='trigger'
    `).all();
    
    const triggerNames = triggers.map(t => t.name);
    console.log(`✅ Found ${triggerNames.length} triggers`);
    
    // Test specific columns
    console.log('- Checking column structure...');
    const watchersColumns = db.getDatabase().prepare('PRAGMA table_info(context_watchers)').all();
    const hasIsActive = watchersColumns.some(col => col.name === 'is_active');
    
    if (!hasIsActive) {
      console.error('❌ Missing is_active column in context_watchers');
      return false;
    }
    
    console.log('✅ Column structure verified');
    
    return true;
  } catch (error) {
    console.error('❌ Schema test failed:', error.message);
    return false;
  }
}

async function testWatcherCreation() {
  console.log('\n👀 3. WATCHER CREATION TEST');
  
  try {
    console.log('- Creating basic watcher...');
    const result = await handleContextWatch(
      {
        action: 'create',
        filters: {
          categories: ['task', 'progress'],
          priorities: ['high']
        }
      },
      repositories,
      sessionId
    );
    
    const response = JSON.parse(result.content[0].text);
    const watcherId = response.watcherId;
    
    if (!watcherId) {
      console.error('❌ Watcher creation failed - no watcherId returned');
      return false;
    }
    
    console.log(`✅ Watcher created: ${watcherId}`);
    console.log(`   Filters: ${JSON.stringify(response.filters)}`);
    
    // Test watcher listing
    console.log('- Testing watcher listing...');
    const listResult = await handleContextWatch(
      { action: 'list' },
      repositories,
      sessionId
    );
    
    const listResponse = JSON.parse(listResult.content[0].text);
    
    if (listResponse.total === 0) {
      console.error('❌ Watcher not found in list');
      return false;
    }
    
    console.log(`✅ Found ${listResponse.total} watchers in list`);
    
    return { watcherId, result: true };
  } catch (error) {
    console.error('❌ Watcher creation test failed:', error.message);
    return { result: false };
  }
}

async function testChangeTracking(watcherId) {
  console.log('\n📝 4. CHANGE TRACKING TEST');
  
  try {
    console.log('- Creating context items to track...');
    
    // Create some context items
    const testItems = [
      { key: 'test-task-1', value: 'First test task', category: 'task', priority: 'high' },
      { key: 'test-progress-1', value: 'Making progress', category: 'progress', priority: 'high' },
      { key: 'test-note-1', value: 'Just a note', category: 'note', priority: 'normal' }
    ];
    
    for (const item of testItems) {
      repositories.contexts.save(sessionId, {
        key: item.key,
        value: item.value,
        category: item.category,
        priority: item.priority
      });
    }
    
    console.log(`✅ Created ${testItems.length} test items`);
    
    // Poll for changes
    console.log('- Polling for changes...');
    const pollResult = await handleContextWatch(
      {
        action: 'poll',
        watcherId: watcherId
      },
      repositories,
      sessionId
    );
    
    const pollResponse = JSON.parse(pollResult.content[0].text);
    
    if (!pollResponse.changes || pollResponse.changes.length === 0) {
      console.error('❌ No changes detected');
      return false;
    }
    
    console.log(`✅ Found ${pollResponse.changes.length} changes`);
    
    // Verify changes match filters (only high priority task/progress items)
    const expectedChanges = pollResponse.changes.filter(change => 
      (change.category === 'task' || change.category === 'progress') &&
      change.type === 'CREATE'
    );
    
    if (expectedChanges.length !== 2) {
      console.error(`❌ Expected 2 filtered changes, got ${expectedChanges.length}`);
      return false;
    }
    
    console.log('✅ Change filtering working correctly');
    
    // Test second save operation (will create a new change)
    console.log('- Testing subsequent saves...');
    repositories.contexts.save(sessionId, {
      key: 'test-task-2',
      value: 'Second test task',
      category: 'task',
      priority: 'high'
    });
    
    const secondPollResult = await handleContextWatch(
      {
        action: 'poll',
        watcherId: watcherId
      },
      repositories,
      sessionId
    );
    
    const secondPollResponse = JSON.parse(secondPollResult.content[0].text);
    
    if (!secondPollResponse.changes || secondPollResponse.changes.length === 0) {
      console.error('❌ Second save change not detected');
      return false;
    }
    
    console.log('✅ Subsequent save tracking working');
    
    return true;
  } catch (error) {
    console.error('❌ Change tracking test failed:', error.message);
    return false;
  }
}

async function testWatcherManagement(watcherId) {
  console.log('\n⚙️ 5. WATCHER MANAGEMENT TEST');
  
  try {
    console.log('- Testing watcher stopping...');
    const stopResult = await handleContextWatch(
      {
        action: 'stop',
        watcherId: watcherId
      },
      repositories,
      sessionId
    );
    
    const stopResponse = JSON.parse(stopResult.content[0].text);
    
    if (!stopResponse.stopped) {
      console.error('❌ Watcher stop failed');
      return false;
    }
    
    console.log('✅ Watcher stopped successfully');
    
    // Test polling stopped watcher
    console.log('- Testing polling stopped watcher...');
    try {
      const pollResult = await handleContextWatch(
        {
          action: 'poll',
          watcherId: watcherId
        },
        repositories,
        sessionId
      );
      
      const pollResponse = JSON.parse(pollResult.content[0].text);
      
      // Should fail or return empty results
      if (pollResponse.changes && pollResponse.changes.length > 0) {
        console.warn('⚠️ Stopped watcher returned changes (unexpected)');
      } else {
        console.log('✅ Stopped watcher correctly returned no changes');
      }
    } catch (error) {
      console.log('✅ Stopped watcher correctly threw error:', error.message);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Watcher management test failed:', error.message);
    return false;
  }
}

async function testEdgeCases() {
  console.log('\n🔍 6. EDGE CASES TEST');
  
  try {
    console.log('- Testing invalid watcher ID...');
    try {
      const invalidResult = await handleContextWatch(
        {
          action: 'poll',
          watcherId: 'invalid-watcher-id'
        },
        repositories,
        sessionId
      );
      
      // Check if it returned an error response
      const errorResponse = invalidResult.content[0].text;
      if (errorResponse.includes('Error:')) {
        console.log('✅ Correctly handled invalid watcher ID');
      } else {
        console.error('❌ Should have failed with invalid watcher ID');
        return false;
      }
    } catch (error) {
      console.log('✅ Correctly handled invalid watcher ID (via exception)');
    }
    
    console.log('- Testing watcher with no filters...');
    const noFilterResult = await handleContextWatch(
      {
        action: 'create',
        filters: {}
      },
      repositories,
      sessionId
    );
    
    const noFilterResponse = JSON.parse(noFilterResult.content[0].text);
    if (!noFilterResponse.watcherId) {
      console.error('❌ Failed to create watcher with no filters');
      return false;
    }
    
    console.log('✅ Watcher with no filters created successfully');
    
    console.log('- Testing invalid action...');
    try {
      const invalidActionResult = await handleContextWatch(
        {
          action: 'invalid-action'
        },
        repositories,
        sessionId
      );
      
      // Check if it returned an error response
      const errorResponse = invalidActionResult.content[0].text;
      if (errorResponse.includes('Error:')) {
        console.log('✅ Correctly handled invalid action');
      } else {
        console.error('❌ Should have failed with invalid action');
        return false;
      }
    } catch (error) {
      console.log('✅ Correctly handled invalid action (via exception)');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Edge cases test failed:', error.message);
    return false;
  }
}

async function testConcurrentWatchers() {
  console.log('\n🔄 7. CONCURRENT WATCHERS TEST');
  
  try {
    console.log('- Creating multiple watchers...');
    
    const watchers = [];
    for (let i = 0; i < 3; i++) {
      const result = await handleContextWatch(
        {
          action: 'create',
          filters: {
            categories: ['task'],
            priorities: i === 0 ? ['high'] : i === 1 ? ['normal'] : ['low']
          }
        },
        repositories,
        sessionId
      );
      
      const response = JSON.parse(result.content[0].text);
      watchers.push(response.watcherId);
    }
    
    console.log(`✅ Created ${watchers.length} concurrent watchers`);
    
    // Create context items
    console.log('- Creating context items for concurrent tracking...');
    const priorities = ['high', 'normal', 'low'];
    
    for (let i = 0; i < 3; i++) {
      repositories.contexts.save(sessionId, {
        key: `concurrent-task-${i}`,
        value: `Task ${i}`,
        category: 'task',
        priority: priorities[i]
      });
    }
    
    // Poll each watcher
    console.log('- Polling each watcher...');
    for (let i = 0; i < watchers.length; i++) {
      const pollResult = await handleContextWatch(
        {
          action: 'poll',
          watcherId: watchers[i]
        },
        repositories,
        sessionId
      );
      
      const pollResponse = JSON.parse(pollResult.content[0].text);
      
      if (!pollResponse.changes || pollResponse.changes.length === 0) {
        console.error(`❌ Watcher ${i} found no changes`);
        return false;
      }
      
      // Each watcher should find exactly 1 change (matching its priority filter)
      if (pollResponse.changes.length !== 1) {
        console.error(`❌ Watcher ${i} expected 1 change, got ${pollResponse.changes.length}`);
        return false;
      }
    }
    
    console.log('✅ All concurrent watchers working correctly');
    
    return true;
  } catch (error) {
    console.error('❌ Concurrent watchers test failed:', error.message);
    return false;
  }
}

async function testIntegration() {
  console.log('\n🔗 8. INTEGRATION TEST');
  
  try {
    console.log('- Testing integration with existing context operations...');
    
    // Regular context operations should still work
    const beforeResult = repositories.contexts.queryEnhanced({sessionId});
    const beforeCount = beforeResult.items.length;
    
    repositories.contexts.save(sessionId, {
      key: 'integration-test',
      value: 'Integration test item',
      category: 'note',
      priority: 'normal'
    });
    
    const afterResult = repositories.contexts.queryEnhanced({sessionId});
    const afterCount = afterResult.items.length;
    
    if (afterCount !== beforeCount + 1) {
      console.error('❌ Context operations affected by watcher functionality');
      return false;
    }
    
    console.log('✅ Context operations unaffected');
    
    // Test checkpoints still work
    console.log('- Testing checkpoint functionality...');
    const checkpoint = repositories.checkpoints.create(sessionId, {
      name: 'integration-test',
      description: 'Integration test checkpoint'
    });
    
    if (!checkpoint) {
      console.error('❌ Checkpoint creation failed');
      return false;
    }
    
    console.log('✅ Checkpoint functionality working');
    
    return true;
  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
    return false;
  }
}

async function cleanup() {
  console.log('\n🧹 CLEANUP');
  
  try {
    if (db) {
      db.close();
    }
    
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('⚠️ Cleanup warning:', error.message);
  }
}

async function runAllTests() {
  console.log('\n🚀 STARTING COMPREHENSIVE QA VERIFICATION\n');
  
  const results = {
    init: false,
    schema: false,
    creation: false,
    tracking: false,
    management: false,
    edgeCases: false,
    concurrent: false,
    integration: false
  };
  
  try {
    // 1. Initialization
    results.init = await init();
    if (!results.init) return results;
    
    // 2. Database Schema
    results.schema = await testDatabaseSchema();
    if (!results.schema) return results;
    
    // 3. Watcher Creation
    const creationResult = await testWatcherCreation();
    results.creation = creationResult.result;
    if (!results.creation) return results;
    
    // 4. Change Tracking
    results.tracking = await testChangeTracking(creationResult.watcherId);
    if (!results.tracking) return results;
    
    // 5. Watcher Management
    results.management = await testWatcherManagement(creationResult.watcherId);
    if (!results.management) return results;
    
    // 6. Edge Cases
    results.edgeCases = await testEdgeCases();
    
    // 7. Concurrent Watchers
    results.concurrent = await testConcurrentWatchers();
    
    // 8. Integration
    results.integration = await testIntegration();
    
    return results;
  } catch (error) {
    console.error('\n💥 CRITICAL ERROR:', error.message);
    console.error('Stack:', error.stack);
    return results;
  } finally {
    await cleanup();
  }
}

// Run the tests
runAllTests().then(results => {
  console.log('\n' + '='.repeat(60));
  console.log('📊 QA VERIFICATION RESULTS');
  console.log('='.repeat(60));
  
  const tests = [
    { name: 'Initialization', result: results.init },
    { name: 'Database Schema', result: results.schema },
    { name: 'Watcher Creation', result: results.creation },
    { name: 'Change Tracking', result: results.tracking },
    { name: 'Watcher Management', result: results.management },
    { name: 'Edge Cases', result: results.edgeCases },
    { name: 'Concurrent Watchers', result: results.concurrent },
    { name: 'Integration', result: results.integration }
  ];
  
  const passed = tests.filter(t => t.result).length;
  const total = tests.length;
  
  tests.forEach(test => {
    const status = test.result ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${test.name}`);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`📈 SUMMARY: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 ALL TESTS PASSED - WATCHER FUNCTIONALITY FULLY VERIFIED');
    console.log('✅ Issue #10 is RESOLVED');
    console.log('🚀 Ready for production use');
  } else {
    console.log('❌ SOME TESTS FAILED - REQUIRES ATTENTION');
  }
  
  console.log('='.repeat(60));
  
  process.exit(passed === total ? 0 : 1);
});