# Issue #13: Add validation for special characters in keys - Test Summary

## Test File Created
`/Users/mkreyman/workspace/mcp-memory-keeper/src/__tests__/integration/issue13-key-validation.test.ts`

## Test Coverage

### 1. validateKey function tests
- **Invalid characters that should be rejected:**
  - Spaces in keys
  - Tabs (`\t`)
  - Newlines (`\n`)
  - Carriage returns (`\r`)
  - Null bytes (`\0`)
  - Control characters (ASCII 0-31 except tab/newline/CR which are tested separately)
  - Backslashes (`\`)
  - Quotes (single, double, backticks)
  - Special shell characters (`|`, `&`, `;`, `<`, `>`, `(`, `)`, `{`, `}`, `[`, `]`, `$`, `#`, `!`, `~`)
  - Wildcards (`*`, `?`)
  - Leading/trailing whitespace

- **Valid characters that should be accepted:**
  - Alphanumeric characters (a-z, A-Z, 0-9)
  - Underscores (`_`)
  - Hyphens (`-`)
  - Dots (`.`)
  - Forward slashes (`/`) for path-like keys
  - Colons (`:`) for namespace separation

- **Edge cases:**
  - Empty keys
  - Null/undefined input
  - Non-string values
  - Keys exceeding 255 character limit
  - Unicode characters (emojis, non-ASCII)
  - Keys that become empty after trimming

### 2. context_save integration tests
- Tests that invalid keys are rejected when saving individual context items
- Tests that valid keys are accepted
- Tests for clear error messaging

### 3. context_batch_save integration tests
- Tests that all keys are validated in batch operations
- Tests that batches with all valid keys succeed
- Tests for detailed error reporting in batch operations

### 4. Security tests
- Path traversal prevention (`../../../etc/passwd`)
- SQL injection prevention (`key'; DROP TABLE...`)
- Script injection prevention (`<script>alert()</script>`)

### 5. Performance tests
- Validates that key validation doesn't significantly impact batch operation performance

### 6. Error message quality tests
- Ensures error messages are helpful and specific to the type of validation failure

## Current Test Results

**Passing tests (11):**
- Basic validation (empty keys, null/undefined, non-string, length limits)
- Valid character acceptance (alphanumeric, underscores, hyphens, dots, slashes, colons)
- Batch operations with valid keys
- Performance tests

**Failing tests (21):**
- All special character rejection tests
- Unicode character handling
- Security validation tests
- Error message quality tests

## What the Senior Developer Needs to Implement

### 1. Enhanced validateKey function in `/src/utils/validation.ts`

The current implementation only does basic validation:
```typescript
export function validateKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new ValidationError('Key must be a non-empty string');
  }

  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Key cannot be empty');
  }

  if (trimmed.length > 255) {
    throw new ValidationError('Key too long (max 255 characters)');
  }

  return trimmed;
}
```

**Needs to add:**
- Regex pattern to validate allowed characters
- Specific error messages for different types of invalid characters
- Rejection of control characters, special shell characters, etc.

### 2. Integration with save operations

- Update `repositories.contexts.save()` to call `validateKey()` before saving
- Update `repositories.contexts.batchSave()` to validate each key and handle validation errors appropriately
- Ensure validation errors are properly propagated with clear messages

### 3. Suggested implementation approach

```typescript
export function validateKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new ValidationError('Key must be a non-empty string');
  }

  // Check for leading/trailing whitespace
  if (key !== key.trim()) {
    throw new ValidationError('Key cannot have leading or trailing whitespace');
  }

  const trimmed = key.trim();
  
  if (trimmed.length === 0) {
    throw new ValidationError('Key cannot be empty');
  }

  if (trimmed.length > 255) {
    throw new ValidationError('Key too long (max 255 characters)');
  }

  // Check for null bytes
  if (trimmed.includes('\0')) {
    throw new ValidationError('Key contains invalid characters (null bytes)');
  }

  // Define allowed pattern: alphanumeric, underscore, hyphen, dot, forward slash, colon
  const validKeyPattern = /^[a-zA-Z0-9_\-\.\/\:]+$/;
  
  if (!validKeyPattern.test(trimmed)) {
    // Provide specific error messages for common mistakes
    if (trimmed.includes(' ')) {
      throw new ValidationError('Key cannot contain spaces. Use underscores or hyphens instead.');
    }
    if (trimmed.includes('\t')) {
      throw new ValidationError('Key cannot contain tabs');
    }
    if (trimmed.includes('\n') || trimmed.includes('\r')) {
      throw new ValidationError('Key cannot contain newlines');
    }
    if (/[\x00-\x1F\x7F]/.test(trimmed)) {
      throw new ValidationError('Key contains control characters');
    }
    if (/[|&;<>(){}[\]$#!~*?"'`\\]/.test(trimmed)) {
      throw new ValidationError('Key contains special characters. Only alphanumeric, underscore, hyphen, dot, forward slash, and colon are allowed.');
    }
    
    // Generic error for any other invalid characters
    throw new ValidationError('Key contains invalid characters. Only alphanumeric, underscore, hyphen, dot, forward slash, and colon are allowed.');
  }

  return trimmed;
}
```

### 4. Additional considerations

- The validation should be consistent across all operations (save, batch_save, etc.)
- Consider adding a configuration option to allow backward compatibility if needed
- Document the allowed key format in the API documentation
- Consider adding a key sanitization function that could suggest valid alternatives

## Running the Tests

To run the failing tests and verify the implementation:
```bash
npm test -- src/__tests__/integration/issue13-key-validation.test.ts
```

## Expected Outcome

Once the validation is implemented:
- All 32 tests should pass
- Invalid keys will be rejected with clear error messages
- The system will be protected against various injection attacks
- Users will have clear guidance on what constitutes a valid key