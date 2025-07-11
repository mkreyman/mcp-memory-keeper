#!/usr/bin/env node

import { runMigrationHealthCheckCLI } from '../src/utils/migrationHealthCheck';
import * as path from 'path';
import * as os from 'os';

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const autoFix = args.includes('--fix') || args.includes('-f');
const customPath = args.find(arg => arg.startsWith('--db='))?.split('=')[1];

if (showHelp) {
  console.log(`
MCP Memory Keeper - Migration Health Check

Usage: npm run check-migrations [options]

Options:
  --help, -h     Show this help message
  --fix, -f      Automatically apply fixes for missing columns
  --db=PATH      Use a custom database path (default: ~/.mcp-memory-keeper/memory.db)

Examples:
  npm run check-migrations              # Check for migration issues
  npm run check-migrations --fix        # Check and auto-fix issues
  npm run check-migrations --db=/custom/path/to/db.db

This tool checks your MCP Memory Keeper database for missing columns that may
have been added in newer versions. It can automatically fix most issues by
adding the missing columns with appropriate defaults.
`);
  process.exit(0);
}

// Determine database path
const defaultDbPath = path.join(os.homedir(), '.mcp-memory-keeper', 'memory.db');
const dbPath = customPath || defaultDbPath;

console.log(`\nChecking database at: ${dbPath}\n`);

// Run the health check
runMigrationHealthCheckCLI(dbPath, autoFix)
  .then(() => {
    console.log('\nHealth check completed.');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nError running health check:', error);
    process.exit(1);
  });
