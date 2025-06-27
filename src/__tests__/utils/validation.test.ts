import {
  ValidationError,
  validateFilePath,
  validateSearchQuery,
  validateSessionName,
  validateKey,
  validateValue,
  validateCategory,
  validatePriority,
} from '../../utils/validation';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs');

describe('Validation Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateFilePath', () => {
    it('should accept valid file paths for write', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = validateFilePath('/tmp/test.txt', 'write');
      expect(result).toBe(path.normalize('/tmp/test.txt'));
    });

    it('should accept valid file paths for read', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = validateFilePath('/tmp/test.txt', 'read');
      expect(result).toBe(path.normalize('/tmp/test.txt'));
    });

    it('should reject empty file paths', () => {
      expect(() => validateFilePath('', 'read')).toThrow(ValidationError);
      expect(() => validateFilePath('', 'read')).toThrow('File path must be a non-empty string');
    });

    it('should reject null/undefined file paths', () => {
      expect(() => validateFilePath(null as any, 'read')).toThrow(ValidationError);
      expect(() => validateFilePath(undefined as any, 'read')).toThrow(ValidationError);
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateFilePath('../../../etc/passwd', 'read')).toThrow(ValidationError);
      expect(() => validateFilePath('../../../etc/passwd', 'read')).toThrow(
        'Path traversal detected'
      );
    });

    it('should reject non-existent files for read', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(() => validateFilePath('/tmp/nonexistent.txt', 'read')).toThrow(ValidationError);
      expect(() => validateFilePath('/tmp/nonexistent.txt', 'read')).toThrow('File not found');
    });

    it('should reject non-existent directories for write', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(() => validateFilePath('/nonexistent/dir/file.txt', 'write')).toThrow(ValidationError);
      expect(() => validateFilePath('/nonexistent/dir/file.txt', 'write')).toThrow(
        'Directory not found'
      );
    });
  });

  describe('validateSearchQuery', () => {
    it('should accept valid search queries', () => {
      expect(validateSearchQuery('test query')).toBe('test query');
      expect(validateSearchQuery('  spaces  ')).toBe('spaces');
    });

    it('should escape SQL wildcards', () => {
      expect(validateSearchQuery('test%query')).toBe('test\\%query');
      expect(validateSearchQuery('test_query')).toBe('test\\_query');
    });

    it('should reject empty queries', () => {
      expect(() => validateSearchQuery('')).toThrow(ValidationError);
      expect(() => validateSearchQuery('   ')).toThrow('Search query cannot be empty');
    });

    it('should reject null/undefined queries', () => {
      expect(() => validateSearchQuery(null as any)).toThrow(ValidationError);
      expect(() => validateSearchQuery(undefined as any)).toThrow(ValidationError);
    });

    it('should reject queries that are too long', () => {
      const longQuery = 'a'.repeat(1001);
      expect(() => validateSearchQuery(longQuery)).toThrow(ValidationError);
      expect(() => validateSearchQuery(longQuery)).toThrow('Search query too long');
    });
  });

  describe('validateSessionName', () => {
    it('should accept valid session names', () => {
      expect(validateSessionName('My Session')).toBe('My Session');
      expect(validateSessionName('  Trimmed  ')).toBe('Trimmed');
    });

    it('should reject empty session names', () => {
      expect(() => validateSessionName('')).toThrow(ValidationError);
      expect(() => validateSessionName('   ')).toThrow('Session name cannot be empty');
    });

    it('should reject null/undefined session names', () => {
      expect(() => validateSessionName(null as any)).toThrow(ValidationError);
      expect(() => validateSessionName(undefined as any)).toThrow(ValidationError);
    });

    it('should reject session names that are too long', () => {
      const longName = 'a'.repeat(256);
      expect(() => validateSessionName(longName)).toThrow(ValidationError);
      expect(() => validateSessionName(longName)).toThrow('Session name too long');
    });
  });

  describe('validateKey', () => {
    it('should accept valid keys', () => {
      expect(validateKey('my_key')).toBe('my_key');
      expect(validateKey('valid_key_123')).toBe('valid_key_123');
      expect(validateKey('key-with-hyphens')).toBe('key-with-hyphens');
      expect(validateKey('key.with.dots')).toBe('key.with.dots');
      expect(validateKey('path/to/key')).toBe('path/to/key');
      expect(validateKey('namespace:key')).toBe('namespace:key');
    });

    it('should reject keys with leading or trailing whitespace', () => {
      expect(() => validateKey('  trimmed_key  ')).toThrow(ValidationError);
      expect(() => validateKey(' leading_space')).toThrow(ValidationError);
      expect(() => validateKey('trailing_space ')).toThrow(ValidationError);
      expect(() => validateKey('\ttab_key')).toThrow(ValidationError);
    });

    it('should reject empty keys', () => {
      expect(() => validateKey('')).toThrow(ValidationError);
      expect(() => validateKey('   ')).toThrow('Key cannot be empty');
    });

    it('should reject null/undefined keys', () => {
      expect(() => validateKey(null as any)).toThrow(ValidationError);
      expect(() => validateKey(undefined as any)).toThrow(ValidationError);
    });

    it('should reject keys that are too long', () => {
      const longKey = 'k'.repeat(256);
      expect(() => validateKey(longKey)).toThrow(ValidationError);
      expect(() => validateKey(longKey)).toThrow('Key too long');
    });
  });

  describe('validateValue', () => {
    it('should accept valid values', () => {
      expect(validateValue('test value')).toBe('test value');
      expect(validateValue('')).toBe(''); // Empty values are allowed
    });

    it('should reject non-string values', () => {
      expect(() => validateValue(123 as any)).toThrow(ValidationError);
      expect(() => validateValue(null as any)).toThrow('Value must be a string');
    });

    it('should reject values that are too large', () => {
      const largeValue = 'v'.repeat(1000001);
      expect(() => validateValue(largeValue)).toThrow(ValidationError);
      expect(() => validateValue(largeValue)).toThrow('Value too large');
    });
  });

  describe('validateCategory', () => {
    it('should accept valid categories', () => {
      expect(validateCategory('task')).toBe('task');
      expect(validateCategory('decision')).toBe('decision');
      expect(validateCategory('progress')).toBe('progress');
      expect(validateCategory('note')).toBe('note');
      expect(validateCategory('error')).toBe('error');
      expect(validateCategory('warning')).toBe('warning');
      expect(validateCategory('git')).toBe('git');
      expect(validateCategory('system')).toBe('system');
    });

    it('should return undefined for empty category', () => {
      expect(validateCategory('')).toBeUndefined();
      expect(validateCategory(undefined)).toBeUndefined();
    });

    it('should reject invalid categories', () => {
      expect(() => validateCategory('invalid')).toThrow(ValidationError);
      expect(() => validateCategory('invalid')).toThrow('Invalid category');
    });
  });

  describe('validatePriority', () => {
    it('should accept valid priorities', () => {
      expect(validatePriority('high')).toBe('high');
      expect(validatePriority('normal')).toBe('normal');
      expect(validatePriority('low')).toBe('low');
    });

    it('should default to normal for empty priority', () => {
      expect(validatePriority('')).toBe('normal');
      expect(validatePriority(undefined)).toBe('normal');
    });

    it('should reject invalid priorities', () => {
      expect(() => validatePriority('urgent')).toThrow(ValidationError);
      expect(() => validatePriority('invalid')).toThrow('Invalid priority');
    });
  });
});
