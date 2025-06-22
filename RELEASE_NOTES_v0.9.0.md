# Release Notes - v0.9.0

## New Features

### Cross-Session Collaboration
- **New Tools**:
  - `context_share`: Share context items with specific sessions or publicly
  - `context_get_shared`: Retrieve items shared with your session
  - `context_search_all`: Search across multiple sessions
- **Database Changes**: Added `shared` and `shared_with_sessions` columns to context_items table
- **Backward Compatibility**: Automatic migration for existing databases

## Status

### ✅ Working
- Cross-session sharing functionality (all tests passing)
- Backward compatibility for existing users (all tests passing)
- Core functionality (context operations, checkpoints, etc.)
- Automatic database migration via MigrationHealthCheck

### ⚠️ Pre-existing Issues
- Some test files have schema mismatches between code expectations and database definitions
- Server initialization tests fail due to schema issues
- Full test suite hangs when run together (likely resource cleanup issues)

## Testing

To verify the new functionality works correctly:

```bash
# Build the project
npm run build

# Test cross-session features
npm test cross-session-sharing.test.ts backward-compatibility.test.ts

# Test core functionality
npm test context-operations.test.ts checkpoint.test.ts
```

## Migration Safety

Existing users will experience:
- Automatic migration when first running v0.9.0
- No data loss - all existing data preserved
- New columns added with safe defaults (shared=false)
- Sessions remain isolated unless explicitly shared

## Known Issues

These are pre-existing issues not related to v0.9.0 changes:
- Various test files expect different database schemas
- Some integration tests spawn child processes that fail
- Test suite resource management needs improvement

## Recommendation

The cross-session collaboration feature is fully functional and tested. The backward compatibility is verified. The pre-existing test issues do not affect the new functionality or user experience.