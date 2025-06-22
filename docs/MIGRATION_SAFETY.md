# Migration Safety for v0.9.0

## Overview

Version 0.9.0 introduces cross-session collaboration features that require new database columns. This document explains how existing users are protected during the upgrade.

## Migration Process

### Automatic Migration
When an existing user starts the MCP Memory Keeper v0.9.0 for the first time:

1. **Database Detection**: The system detects if it's working with an existing database
2. **Health Check**: The `MigrationHealthCheck` class runs automatically
3. **Schema Discovery**: The system discovers the expected schema from the codebase
4. **Column Addition**: Missing columns are added via `ALTER TABLE` statements
5. **Data Preservation**: All existing data remains intact

### New Columns Added
- `context_items.shared` (BOOLEAN DEFAULT 0)
- `context_items.shared_with_sessions` (TEXT DEFAULT NULL)

### Safety Features

1. **Non-Destructive**: Only adds columns, never removes or modifies existing ones
2. **Safe Defaults**: New columns have safe default values (shared=false)
3. **Transaction Safety**: Migrations run in transactions
4. **Fallback Schema**: If schema discovery fails, uses hardcoded safe schema
5. **Idempotent**: Running migration multiple times is safe

## Test Coverage

### Backward Compatibility Tests
```
✓ should seamlessly migrate existing database on first connection
✓ should handle database with partial schema (some new tables missing)
✓ should not break when database already has new columns
```

### Cross-Session Sharing Tests
```
✓ should add shared columns to existing database
✓ should share item with specific sessions
✓ should share item with multiple sessions
✓ should share item publicly (empty target sessions)
✓ should share by key
✓ should search across sessions
✓ should handle complex sharing scenarios
✓ should handle sharing non-existent items gracefully
✓ should handle sharing by non-existent key gracefully
✓ should handle invalid JSON in shared_with_sessions
```

## Verified Scenarios

1. **v0.8.5 → v0.9.0 Migration**
   - Existing sessions remain intact
   - Existing context items preserve all data
   - Checkpoints continue to work
   - New sharing features become available

2. **Partial Database Migration**
   - Missing tables are created
   - Missing columns are added
   - Existing data is preserved

3. **Already Migrated Database**
   - No errors when columns already exist
   - System continues to work normally

## User Impact

- **Zero Downtime**: Migration happens automatically on first connection
- **No Data Loss**: All existing data is preserved
- **Backward Compatible**: Old features continue to work exactly as before
- **Opt-in Sharing**: Items remain private unless explicitly shared

## Troubleshooting

If migration fails:
1. The system will log detailed error messages
2. The database remains in its original state (transaction rollback)
3. Users can manually run the migration SQL if needed

### Manual Migration SQL
```sql
-- Add sharing columns to context_items if missing
ALTER TABLE context_items ADD COLUMN shared BOOLEAN DEFAULT 0;
ALTER TABLE context_items ADD COLUMN shared_with_sessions TEXT;
```

## Conclusion

The migration process is designed to be completely transparent and safe for existing users. The comprehensive test suite ensures that all edge cases are handled properly.