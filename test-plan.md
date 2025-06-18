# MCP Memory Keeper Test Plan

## Critical Tests Needed

### 1. Unit Tests
- [ ] Database operations (CRUD for all tables)
- [ ] Helper functions (hash calculation, summary generation)
- [ ] Git status handling with/without git repo
- [ ] Search query building and sanitization

### 2. Integration Tests
- [ ] Full tool workflows (save → checkpoint → restore)
- [ ] Session management lifecycle
- [ ] Export/import round trips
- [ ] Error handling for all tools

### 3. Manual Testing Checklist
- [ ] Test without git repository
- [ ] Test with large amounts of data
- [ ] Test with special characters in values
- [ ] Test concurrent operations
- [ ] Test malformed import files
- [ ] Test restoration after actual compaction

### 4. Real-World Validation
- [ ] Use during actual coding session
- [ ] Trigger actual context compaction
- [ ] Restore and verify all data intact
- [ ] Test with multiple sessions
- [ ] Verify git commit integration

## How to Add Tests

1. Install test dependencies:
```bash
npm install -D jest @types/jest ts-jest
```

2. Create jest.config.js:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
};
```

3. Add test script to package.json:
```json
"scripts": {
  "test": "jest",
  "test:watch": "jest --watch"
}
```

4. Create tests in `tests/` directory

## Priority Tests

1. **Test context_prepare_compaction** - This is the most critical feature
2. **Test checkpoint/restore cycle** - Data integrity is crucial
3. **Test search functionality** - Security and correctness
4. **Test import/export** - Data portability