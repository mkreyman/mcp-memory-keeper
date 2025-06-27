/**
 * QA Verification Test for Issue #12 UX Improvements
 * 
 * This test verifies that the UX improvements for checkpoint restore behavior
 * successfully resolve user confusion while preserving data safety.
 * 
 * Areas tested:
 * 1. Enhanced messaging clarity
 * 2. User guidance and next steps
 * 3. Functional preservation (no regressions)
 * 4. Data safety communication
 * 5. Cross-session navigation help
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class UXVerificationTest {
  constructor() {
    this.testResults = [];
    this.sessionId = null;
    this.checkpointName = 'Test Checkpoint';
    this.testDbPath = path.join(os.tmpdir(), `ux-test-${Date.now()}.db`);
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
    console.log(logMessage);
    this.testResults.push({ timestamp, type, message });
  }

  async runMcpCommand(tool, args = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['dist/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CONTEXT_DB_PATH: this.testDbPath }
      });

      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: tool,
          arguments: args
        }
      };

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed with code ${code}: ${errorOutput}`));
        } else {
          try {
            // Parse the JSON-RPC response
            const lines = output.trim().split('\n');
            const lastLine = lines[lines.length - 1];
            const response = JSON.parse(lastLine);
            resolve(response.result);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        }
      });

      child.stdin.write(JSON.stringify(request) + '\n');
      child.stdin.end();
    });
  }

  async setupTestEnvironment() {
    this.log('Setting up test environment');
    
    try {
      // Start a new session
      const sessionResult = await this.runMcpCommand('mcp__memory-keeper__context_session_start', {
        name: 'UX Test Session'
      });
      this.log('Created test session');

      // Add some test data
      await this.runMcpCommand('mcp__memory-keeper__context_save', {
        key: 'current_task',
        value: 'Working on feature implementation',
        category: 'task',
        priority: 'high'
      });

      await this.runMcpCommand('mcp__memory-keeper__context_save', {
        key: 'progress_note',
        value: 'Made significant progress today',
        category: 'progress',
        priority: 'normal'
      });

      this.log('Added test context items');

      // Create a checkpoint
      await this.runMcpCommand('mcp__memory-keeper__context_checkpoint', {
        name: this.checkpointName,
        description: 'Test checkpoint for UX verification'
      });

      this.log('Created test checkpoint');

      // Add more data after checkpoint (to simulate ongoing work)
      await this.runMcpCommand('mcp__memory-keeper__context_save', {
        key: 'post_checkpoint_work',
        value: 'Continued working after checkpoint',
        category: 'task',
        priority: 'high'
      });

      this.log('Added post-checkpoint work');

      return true;
    } catch (error) {
      this.log(`Setup failed: ${error.message}`, 'error');
      return false;
    }
  }

  async testEnhancedMessaging() {
    this.log('Testing enhanced messaging clarity');
    
    try {
      // Restore checkpoint and analyze the output
      const restoreResult = await this.runMcpCommand('mcp__memory-keeper__context_restore_checkpoint', {
        name: this.checkpointName
      });

      const output = restoreResult.content[0].text;
      this.log('Received restore output');

      // Test message components
      const testCases = [
        {
          name: 'Success confirmation',
          pattern: /✅.*Successfully restored.*checkpoint/i,
          description: 'Clearly indicates successful restoration'
        },
        {
          name: 'Data safety explanation',
          pattern: /🔄.*Data Safety.*new session.*preserve/i,
          description: 'Explains why new session was created'
        },
        {
          name: 'New session identification',
          pattern: /📋.*New Session.*[a-f0-9]{8}/i,
          description: 'Provides new session ID and name'
        },
        {
          name: 'Original session preservation',
          pattern: /🔙.*Original Session.*remains accessible/i,
          description: 'Confirms original work is preserved'
        },
        {
          name: 'Restored data summary',
          pattern: /📊.*Restored Data.*Context items.*Files/i,
          description: 'Shows what was restored'
        },
        {
          name: 'Next steps guidance',
          pattern: /💡.*Next Steps.*working in.*restored session/i,
          description: 'Provides clear next steps'
        },
        {
          name: 'Session navigation help',
          pattern: /context_session_list.*see all sessions/i,
          description: 'Tells user how to manage sessions'
        },
        {
          name: 'Cross-session search help',
          pattern: /🆘.*context_search_all.*find items across sessions/i,
          description: 'Provides recovery guidance'
        }
      ];

      let passedTests = 0;
      for (const test of testCases) {
        if (test.pattern.test(output)) {
          this.log(`✅ ${test.name}: PASS - ${test.description}`, 'success');
          passedTests++;
        } else {
          this.log(`❌ ${test.name}: FAIL - ${test.description}`, 'error');
          this.log(`   Output did not match pattern: ${test.pattern}`, 'error');
        }
      }

      const totalTests = testCases.length;
      this.log(`Enhanced messaging: ${passedTests}/${totalTests} tests passed`);

      return {
        passed: passedTests,
        total: totalTests,
        success: passedTests === totalTests,
        output: output
      };

    } catch (error) {
      this.log(`Enhanced messaging test failed: ${error.message}`, 'error');
      return { passed: 0, total: 8, success: false, error: error.message };
    }
  }

  async testUserGuidanceClarity() {
    this.log('Testing user guidance and workflow clarity');

    try {
      // Test that user can follow the guidance to find their data
      
      // 1. Test session listing
      const sessionList = await this.runMcpCommand('mcp__memory-keeper__context_session_list');
      const sessionCount = sessionList.content[0].text.split('\n').filter(line => line.includes('Session ID')).length;
      
      if (sessionCount >= 2) {
        this.log('✅ Session listing works - can see multiple sessions', 'success');
      } else {
        this.log('❌ Session listing issue - expected multiple sessions', 'error');
      }

      // 2. Test cross-session search
      const searchResult = await this.runMcpCommand('mcp__memory-keeper__context_search_all', {
        query: 'post_checkpoint_work'
      });

      const searchOutput = searchResult.content[0].text;
      if (searchOutput.includes('post_checkpoint_work')) {
        this.log('✅ Cross-session search works - can find original work', 'success');
      } else {
        this.log('❌ Cross-session search failed to find original work', 'error');
      }

      // 3. Test that guidance helps user understand their situation
      const guidanceTests = [
        {
          name: 'Session count information',
          test: sessionCount >= 2,
          description: 'User can see they have multiple sessions'
        },
        {
          name: 'Cross-session recovery',
          test: searchOutput.includes('post_checkpoint_work'),
          description: 'User can recover their original work'
        }
      ];

      const passedGuidance = guidanceTests.filter(t => t.test).length;
      this.log(`User guidance: ${passedGuidance}/${guidanceTests.length} tests passed`);

      return {
        passed: passedGuidance,
        total: guidanceTests.length,
        success: passedGuidance === guidanceTests.length
      };

    } catch (error) {
      this.log(`User guidance test failed: ${error.message}`, 'error');
      return { passed: 0, total: 2, success: false, error: error.message };
    }
  }

  async testFunctionalPreservation() {
    this.log('Testing functional preservation (no regressions)');

    try {
      // Verify core functionality still works
      const tests = [];

      // 1. Test that new session was created
      const sessionList = await this.runMcpCommand('mcp__memory-keeper__context_session_list');
      const hasNewSession = sessionList.content[0].text.includes('Restored from:');
      tests.push({
        name: 'New session creation',
        passed: hasNewSession,
        description: 'New session created with correct naming'
      });

      // 2. Test that original session data is preserved
      const searchAll = await this.runMcpCommand('mcp__memory-keeper__context_search_all', {
        query: 'post_checkpoint_work'
      });
      const originalDataExists = searchAll.content[0].text.includes('post_checkpoint_work');
      tests.push({
        name: 'Original data preservation',
        passed: originalDataExists,
        description: 'Original session data remains intact'
      });

      // 3. Test that restored data is accessible
      const currentItems = await this.runMcpCommand('mcp__memory-keeper__context_get', {});
      const restoredDataExists = currentItems.content[0].text.includes('current_task');
      tests.push({
        name: 'Restored data accessibility',
        passed: restoredDataExists,
        description: 'Restored data is accessible in new session'
      });

      // 4. Test that checkpoint functionality still works
      try {
        await this.runMcpCommand('mcp__memory-keeper__context_checkpoint', {
          name: 'Post-restore checkpoint'
        });
        tests.push({
          name: 'Checkpoint functionality',
          passed: true,
          description: 'Can create checkpoints after restore'
        });
      } catch (error) {
        tests.push({
          name: 'Checkpoint functionality',
          passed: false,
          description: 'Checkpoint creation failed after restore'
        });
      }

      const passedFunctional = tests.filter(t => t.passed).length;
      tests.forEach(test => {
        const status = test.passed ? '✅' : '❌';
        this.log(`${status} ${test.name}: ${test.description}`, test.passed ? 'success' : 'error');
      });

      this.log(`Functional preservation: ${passedFunctional}/${tests.length} tests passed`);

      return {
        passed: passedFunctional,
        total: tests.length,
        success: passedFunctional === tests.length,
        tests: tests
      };

    } catch (error) {
      this.log(`Functional preservation test failed: ${error.message}`, 'error');
      return { passed: 0, total: 4, success: false, error: error.message };
    }
  }

  async testEdgeCases() {
    this.log('Testing edge cases and error messaging');

    try {
      const tests = [];

      // 1. Test restore with non-existent checkpoint
      try {
        const invalidRestore = await this.runMcpCommand('mcp__memory-keeper__context_restore_checkpoint', {
          name: 'NonExistent Checkpoint'
        });
        const errorMessage = invalidRestore.content[0].text;
        tests.push({
          name: 'Invalid checkpoint handling',
          passed: errorMessage.includes('No checkpoint found'),
          description: 'Clear error message for missing checkpoint'
        });
      } catch (error) {
        tests.push({
          name: 'Invalid checkpoint handling',
          passed: false,
          description: 'Failed to handle invalid checkpoint gracefully'
        });
      }

      // 2. Test restore without parameters (should get latest)
      try {
        await this.runMcpCommand('mcp__memory-keeper__context_restore_checkpoint', {});
        tests.push({
          name: 'Default restore behavior',
          passed: true,
          description: 'Can restore latest checkpoint without parameters'
        });
      } catch (error) {
        tests.push({
          name: 'Default restore behavior',
          passed: false,
          description: 'Failed to restore latest checkpoint'
        });
      }

      const passedEdgeCases = tests.filter(t => t.passed).length;
      tests.forEach(test => {
        const status = test.passed ? '✅' : '❌';
        this.log(`${status} ${test.name}: ${test.description}`, test.passed ? 'success' : 'error');
      });

      this.log(`Edge cases: ${passedEdgeCases}/${tests.length} tests passed`);

      return {
        passed: passedEdgeCases,
        total: tests.length,
        success: passedEdgeCases === tests.length,
        tests: tests
      };

    } catch (error) {
      this.log(`Edge cases test failed: ${error.message}`, 'error');
      return { passed: 0, total: 2, success: false, error: error.message };
    }
  }

  async runFullVerification() {
    this.log('=== Starting Issue #12 UX Improvements Verification ===');

    // Setup test environment
    const setupSuccess = await this.setupTestEnvironment();
    if (!setupSuccess) {
      this.log('Setup failed, cannot continue verification', 'error');
      return this.generateReport();
    }

    // Run all verification tests
    const results = {};
    
    results.messaging = await this.testEnhancedMessaging();
    results.guidance = await this.testUserGuidanceClarity();
    results.functional = await this.testFunctionalPreservation();
    results.edgeCases = await this.testEdgeCases();

    // Generate comprehensive report
    return this.generateReport(results);
  }

  generateReport(results = {}) {
    const report = {
      timestamp: new Date().toISOString(),
      testResults: this.testResults,
      summary: {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        categories: {}
      },
      verification: {}
    };

    if (Object.keys(results).length > 0) {
      // Calculate totals
      for (const [category, result] of Object.entries(results)) {
        report.summary.totalTests += result.total || 0;
        report.summary.passedTests += result.passed || 0;
        report.summary.categories[category] = {
          total: result.total || 0,
          passed: result.passed || 0,
          success: result.success || false
        };
      }
      
      report.summary.failedTests = report.summary.totalTests - report.summary.passedTests;
      report.verification = results;
    }

    // Overall success criteria
    const overallSuccess = Object.values(results).every(r => r.success);
    report.overallSuccess = overallSuccess;

    // Success criteria for Issue #12
    report.issue12Resolution = {
      uxImprovementsVerified: results.messaging?.success || false,
      userGuidanceEffective: results.guidance?.success || false,
      noFunctionalRegressions: results.functional?.success || false,
      edgeCasesHandled: results.edgeCases?.success || false,
      resolutionSuccess: overallSuccess
    };

    this.log('=== Verification Complete ===');
    this.log(`Overall Success: ${overallSuccess ? 'PASS' : 'FAIL'}`);
    this.log(`Tests Passed: ${report.summary.passedTests}/${report.summary.totalTests}`);

    return report;
  }

  cleanup() {
    // Clean up test database
    try {
      if (fs.existsSync(this.testDbPath)) {
        fs.unlinkSync(this.testDbPath);
      }
      if (fs.existsSync(`${this.testDbPath}-wal`)) {
        fs.unlinkSync(`${this.testDbPath}-wal`);
      }
      if (fs.existsSync(`${this.testDbPath}-shm`)) {
        fs.unlinkSync(`${this.testDbPath}-shm`);
      }
      this.log('Cleaned up test database');
    } catch (error) {
      this.log(`Cleanup warning: ${error.message}`, 'warn');
    }
  }
}

// Run the verification if called directly
if (require.main === module) {
  const test = new UXVerificationTest();
  test.runFullVerification()
    .then(report => {
      console.log('\n=== FINAL REPORT ===');
      console.log(JSON.stringify(report, null, 2));
      
      // Save report to file
      const reportPath = path.join(__dirname, 'qa-verification-issue12-report.json');
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\nReport saved to: ${reportPath}`);
      
      process.exit(report.overallSuccess ? 0 : 1);
    })
    .catch(error => {
      console.error('Verification failed:', error);
      process.exit(1);
    })
    .finally(() => {
      test.cleanup();
    });
}

module.exports = UXVerificationTest;