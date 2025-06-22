/**
 * Global teardown for Jest tests
 * Ensures all resources are cleaned up after test suite completion
 */
module.exports = async () => {
  // Force cleanup any remaining resources
  process.removeAllListeners();
  
  // Clean up any remaining child processes
  if (global.testProcesses) {
    for (const proc of global.testProcesses) {
      if (proc && !proc.killed) {
        proc.kill('SIGKILL');
      }
    }
  }
  
  // Clean up any remaining database connections
  if (global.testDatabases) {
    for (const db of global.testDatabases) {
      try {
        if (db && typeof db.close === 'function') {
          db.close();
        }
      } catch (error) {
        console.warn('Error closing database during teardown:', error.message);
      }
    }
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  // Give time for cleanup to complete
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('Global teardown completed');
};