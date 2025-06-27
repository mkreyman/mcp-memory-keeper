import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseManager } from '../../utils/database';
import { RepositoryManager } from '../../repositories/RepositoryManager';
import { ValidationError, validateKey } from '../../utils/validation';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Issue #13: Add validation for special characters in keys', () => {
  let dbManager: DatabaseManager;
  let repositories: RepositoryManager;
  let tempDbPath: string;
  let testSessionId: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-context-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    repositories = new RepositoryManager(dbManager);

    // Create test session
    const session = repositories.sessions.create({
      name: 'Test Session',
      description: 'Session for key validation tests',
    });
    testSessionId = session.id;
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (_e) {
      // Ignore
    }
  });

  describe('validateKey function', () => {
    describe('Invalid characters that should be rejected', () => {
      it('should reject keys with spaces', () => {
        expect(() => validateKey('key with spaces')).toThrow(ValidationError);
        expect(() => validateKey('key with spaces')).toThrow(/special characters/i);
      });

      it('should reject keys with tabs', () => {
        expect(() => validateKey('key\twith\ttabs')).toThrow(ValidationError);
        expect(() => validateKey('key\twith\ttabs')).toThrow(/special characters/i);
      });

      it('should reject keys with newlines', () => {
        expect(() => validateKey('key\nwith\nnewlines')).toThrow(ValidationError);
        expect(() => validateKey('key\nwith\nnewlines')).toThrow(/special characters/i);
      });

      it('should reject keys with carriage returns', () => {
        expect(() => validateKey('key\rwith\rreturns')).toThrow(ValidationError);
        expect(() => validateKey('key\rwith\rreturns')).toThrow(/special characters/i);
      });

      it('should reject keys with null bytes', () => {
        expect(() => validateKey('key\0with\0null')).toThrow(ValidationError);
        expect(() => validateKey('key\0with\0null')).toThrow(/invalid characters/i);
      });

      it('should reject keys with control characters', () => {
        // Test various control characters
        const controlChars = [
          '\x00', '\x01', '\x02', '\x03', '\x04', '\x05', '\x06', '\x07',
          '\x08', '\x0B', '\x0C', '\x0E', '\x0F', '\x10', '\x11', '\x12',
          '\x13', '\x14', '\x15', '\x16', '\x17', '\x18', '\x19', '\x1A',
          '\x1B', '\x1C', '\x1D', '\x1E', '\x1F'
        ];

        controlChars.forEach(char => {
          expect(() => validateKey(`key${char}test`)).toThrow(ValidationError);
        });
      });

      it('should reject keys with backslashes', () => {
        expect(() => validateKey('key\\with\\backslashes')).toThrow(ValidationError);
        expect(() => validateKey('key\\with\\backslashes')).toThrow(/special characters/i);
      });

      it('should reject keys with quotes', () => {
        expect(() => validateKey('key"with"quotes')).toThrow(ValidationError);
        expect(() => validateKey("key'with'quotes")).toThrow(ValidationError);
        expect(() => validateKey('key`with`backticks')).toThrow(ValidationError);
      });

      it('should reject keys with special shell characters', () => {
        const shellChars = ['|', '&', ';', '<', '>', '(', ')', '{', '}', '[', ']', '$', '#', '!', '~'];
        shellChars.forEach(char => {
          expect(() => validateKey(`key${char}test`)).toThrow(ValidationError);
          expect(() => validateKey(`key${char}test`)).toThrow(/special characters/i);
        });
      });

      it('should reject keys with wildcards', () => {
        expect(() => validateKey('key*with*asterisks')).toThrow(ValidationError);
        expect(() => validateKey('key?with?questions')).toThrow(ValidationError);
      });

      it('should reject keys that start or end with whitespace', () => {
        expect(() => validateKey(' leading_space')).toThrow(ValidationError);
        expect(() => validateKey('trailing_space ')).toThrow(ValidationError);
        expect(() => validateKey('\tleading_tab')).toThrow(ValidationError);
        expect(() => validateKey('trailing_tab\t')).toThrow(ValidationError);
      });
    });

    describe('Valid characters that should be accepted', () => {
      it('should accept alphanumeric characters', () => {
        expect(validateKey('simpleKey123')).toBe('simpleKey123');
        expect(validateKey('UPPERCASE')).toBe('UPPERCASE');
        expect(validateKey('lowercase')).toBe('lowercase');
        expect(validateKey('MixedCase123')).toBe('MixedCase123');
      });

      it('should accept underscores', () => {
        expect(validateKey('key_with_underscores')).toBe('key_with_underscores');
        expect(validateKey('_leading_underscore')).toBe('_leading_underscore');
        expect(validateKey('trailing_underscore_')).toBe('trailing_underscore_');
      });

      it('should accept hyphens', () => {
        expect(validateKey('key-with-hyphens')).toBe('key-with-hyphens');
        expect(validateKey('kebab-case-key')).toBe('kebab-case-key');
      });

      it('should accept dots', () => {
        expect(validateKey('key.with.dots')).toBe('key.with.dots');
        expect(validateKey('namespace.key')).toBe('namespace.key');
      });

      it('should accept forward slashes for path-like keys', () => {
        expect(validateKey('path/to/key')).toBe('path/to/key');
        expect(validateKey('feature/component/item')).toBe('feature/component/item');
      });

      it('should accept colons for namespace separation', () => {
        expect(validateKey('namespace:key')).toBe('namespace:key');
        expect(validateKey('module:component:item')).toBe('module:component:item');
      });
    });

    describe('Edge cases', () => {
      it('should reject empty keys', () => {
        expect(() => validateKey('')).toThrow(ValidationError);
        expect(() => validateKey('')).toThrow(/empty/i);
      });

      it('should reject null or undefined', () => {
        expect(() => validateKey(null as any)).toThrow(ValidationError);
        expect(() => validateKey(undefined as any)).toThrow(ValidationError);
      });

      it('should reject non-string values', () => {
        expect(() => validateKey(123 as any)).toThrow(ValidationError);
        expect(() => validateKey({} as any)).toThrow(ValidationError);
        expect(() => validateKey([] as any)).toThrow(ValidationError);
      });

      it('should reject keys that are too long', () => {
        const longKey = 'a'.repeat(256);
        expect(() => validateKey(longKey)).toThrow(ValidationError);
        expect(() => validateKey(longKey)).toThrow(/too long/i);
      });

      it('should accept keys at maximum length', () => {
        const maxKey = 'a'.repeat(255);
        expect(validateKey(maxKey)).toBe(maxKey);
      });

      it('should handle Unicode characters appropriately', () => {
        // Should reject emoji and other non-ASCII Unicode
        expect(() => validateKey('key_with_😀_emoji')).toThrow(ValidationError);
        expect(() => validateKey('key_with_中文_characters')).toThrow(ValidationError);
        expect(() => validateKey('key_with_🔥_fire')).toThrow(ValidationError);
        
        // Should reject other Unicode special characters
        expect(() => validateKey('key_with_©_copyright')).toThrow(ValidationError);
        expect(() => validateKey('key_with_™_trademark')).toThrow(ValidationError);
      });

      it('should properly validate keys that become empty after trimming', () => {
        expect(() => validateKey('   ')).toThrow(ValidationError);
        expect(() => validateKey('\t\t\t')).toThrow(ValidationError);
        expect(() => validateKey('\n\n\n')).toThrow(ValidationError);
      });
    });
  });

  describe('context_save with key validation', () => {
    it('should reject invalid keys when saving context', () => {
      const invalidKeys = [
        'key with spaces',
        'key\twith\ttabs',
        'key\nwith\nnewlines',
        'key|with|pipes',
        'key;with;semicolons',
        'key$with$dollars',
      ];

      invalidKeys.forEach(invalidKey => {
        expect(() => {
          repositories.contexts.save(testSessionId, {
            key: invalidKey,
            value: 'test value',
            category: 'task',
            priority: 'normal',
          });
        }).toThrow(ValidationError);
      });
    });

    it('should accept valid keys when saving context', () => {
      const validKeys = [
        'simple_key',
        'key-with-hyphens',
        'key.with.dots',
        'path/to/key',
        'namespace:key',
        'MixedCase123',
      ];

      validKeys.forEach(validKey => {
        const result = repositories.contexts.save(testSessionId, {
          key: validKey,
          value: 'test value',
          category: 'task',
          priority: 'normal',
        });

        expect(result.key).toBe(validKey);
        expect(result.value).toBe('test value');
      });
    });

    it('should provide clear error messages for invalid keys', () => {
      try {
        repositories.contexts.save(testSessionId, {
          key: 'key with spaces',
          value: 'test value',
        });
        fail('Expected ValidationError to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toMatch(/special characters/i);
        expect(error.message).toMatch(/spaces/i);
      }
    });
  });

  describe('context_batch_save with key validation', () => {
    it('should validate all keys in batch save', () => {
      const items = [
        { key: 'valid_key_1', value: 'value1' },
        { key: 'key with spaces', value: 'value2' },
        { key: 'valid_key_3', value: 'value3' },
        { key: 'key\twith\ttabs', value: 'value4' },
      ];

      // Note: Current implementation doesn't validate special characters in batch operations
      // This test expects validation to be added
      const result = repositories.contexts.batchSave(testSessionId, items);
      
      // Once validation is implemented, we expect some items to fail
      const failedItems = result.results.filter(r => !r.success);
      expect(failedItems).toHaveLength(2); // Should fail for items with spaces and tabs
      
      // Check that the error messages mention special characters
      expect(failedItems[0].error).toMatch(/special characters/i);
      expect(failedItems[1].error).toMatch(/special characters/i);
    });

    it('should accept batch with all valid keys', () => {
      const items = [
        { key: 'valid_key_1', value: 'value1' },
        { key: 'valid-key-2', value: 'value2' },
        { key: 'valid.key.3', value: 'value3' },
        { key: 'valid/key/4', value: 'value4' },
      ];

      const result = repositories.contexts.batchSave(testSessionId, items);
      
      const successCount = result.results.filter(r => r.success).length;
      expect(successCount).toBe(4);

      const savedItems = repositories.contexts.getBySessionId(testSessionId);
      expect(savedItems).toHaveLength(4);
    });

    it('should provide detailed error report for batch validation failures', () => {
      const items = [
        { key: 'valid_key', value: 'value1' },
        { key: 'invalid key', value: 'value2' },
        { key: 'another|invalid', value: 'value3' },
      ];

      const result = repositories.contexts.batchSave(testSessionId, items);
      
      // Once validation is implemented, we expect some items to fail
      const failedItems = result.results.filter(r => !r.success);
      expect(failedItems).toHaveLength(2); // Should fail for items with special characters
      
      // Check specific failures
      const invalidKeyResult = result.results.find(r => r.key === 'invalid key');
      expect(invalidKeyResult?.success).toBe(false);
      expect(invalidKeyResult?.error).toMatch(/special characters/i);
      
      const pipeKeyResult = result.results.find(r => r.key === 'another|invalid');
      expect(pipeKeyResult?.success).toBe(false);
      expect(pipeKeyResult?.error).toMatch(/special characters/i);
    });
  });

  describe('Protection against malicious keys', () => {
    it('should prevent path traversal attempts in keys', () => {
      const pathTraversalKeys = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        'key/../../../secret',
        'key/../../admin',
      ];

      pathTraversalKeys.forEach(key => {
        expect(() => validateKey(key)).toThrow(ValidationError);
      });
    });

    it('should prevent SQL injection attempts in keys', () => {
      const sqlInjectionKeys = [
        "key'; DROP TABLE sessions; --",
        'key" OR "1"="1',
        'key`; DELETE FROM context_items; --',
      ];

      sqlInjectionKeys.forEach(key => {
        expect(() => validateKey(key)).toThrow(ValidationError);
      });
    });

    it('should prevent script injection attempts in keys', () => {
      const scriptInjectionKeys = [
        '<script>alert("xss")</script>',
        'key<img src=x onerror=alert(1)>',
        'javascript:alert(1)',
      ];

      scriptInjectionKeys.forEach(key => {
        expect(() => validateKey(key)).toThrow(ValidationError);
      });
    });
  });

  describe('Performance considerations', () => {
    it('should validate keys efficiently for large batches', () => {
      const largeItems = Array.from({ length: 100 }, (_, i) => ({
        key: `valid_key_${i}`,
        value: `value_${i}`,
      }));

      const startTime = Date.now();
      const result = repositories.contexts.batchSave(testSessionId, largeItems);
      const endTime = Date.now();

      const successCount = result.results.filter(r => r.success).length;
      expect(successCount).toBe(100);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Error message quality', () => {
    it('should provide helpful error messages for common mistakes', () => {
      const testCases = [
        {
          key: 'key with spaces',
          expectedError: /spaces are not allowed/i,
        },
        {
          key: 'key\twith\ttabs',
          expectedError: /tabs are not allowed/i,
        },
        {
          key: 'key|pipe',
          expectedError: /special characters/i,
        },
        {
          key: '',
          expectedError: /cannot be empty/i,
        },
        {
          key: 'a'.repeat(256),
          expectedError: /too long.*255 characters/i,
        },
      ];

      testCases.forEach(({ key, expectedError }) => {
        try {
          validateKey(key);
          fail(`Expected ValidationError for key: ${key}`);
        } catch (error: any) {
          expect(error).toBeInstanceOf(ValidationError);
          expect(error.message).toMatch(expectedError);
        }
      });
    });
  });
});