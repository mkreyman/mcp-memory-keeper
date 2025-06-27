import * as path from 'path';
import * as fs from 'fs';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateFilePath(filePath: string, mode: 'read' | 'write'): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new ValidationError('File path must be a non-empty string');
  }

  // Check for null bytes
  if (filePath.includes('\0')) {
    throw new ValidationError('File path contains invalid characters');
  }

  // Check for common Windows reserved names
  const basename = path.basename(filePath).toLowerCase();
  const reservedNames = [
    'con',
    'prn',
    'aux',
    'nul',
    'com1',
    'com2',
    'com3',
    'com4',
    'com5',
    'com6',
    'com7',
    'com8',
    'com9',
    'lpt1',
    'lpt2',
    'lpt3',
    'lpt4',
    'lpt5',
    'lpt6',
    'lpt7',
    'lpt8',
    'lpt9',
  ];
  if (reservedNames.includes(basename.split('.')[0])) {
    throw new ValidationError('File path contains reserved name');
  }

  // Normalize the path
  const normalizedPath = path.normalize(filePath);

  // Check for path traversal attempts
  if (normalizedPath.includes('..') || filePath.includes('../') || filePath.includes('..\\')) {
    throw new ValidationError('Path traversal detected');
  }

  // Block access to system directories
  const blockedPaths = ['/etc/', '/sys/', '/proc/', '\\Windows\\', '\\System32\\'];
  const lowerPath = normalizedPath.toLowerCase();
  for (const blocked of blockedPaths) {
    if (lowerPath.includes(blocked.toLowerCase())) {
      throw new ValidationError('Access to system directories not allowed');
    }
  }

  // Block absolute paths to sensitive files
  if (normalizedPath.startsWith('/etc/passwd') || normalizedPath.includes('\\config\\sam')) {
    throw new ValidationError('Access to sensitive files not allowed');
  }

  if (mode === 'read') {
    // Check if file exists for read operations
    if (!fs.existsSync(normalizedPath)) {
      throw new ValidationError(`File not found: ${normalizedPath}`);
    }
  } else {
    // Check if directory exists for write operations
    const dir = path.dirname(normalizedPath);
    if (!fs.existsSync(dir)) {
      throw new ValidationError(`Directory not found: ${dir}`);
    }
  }

  return normalizedPath;
}

export function validateSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    throw new ValidationError('Search query must be a non-empty string');
  }

  // Remove potentially dangerous SQL characters
  let sanitized = query
    .replace(/['"`;\\]/g, '') // Remove quotes, semicolons, backslashes
    .replace(/--/g, '') // Remove SQL comments
    .replace(/\/\*/g, '') // Remove block comment starts
    .replace(/\*\//g, '') // Remove block comment ends
    .replace(/[%_]/g, '\\$&') // Escape wildcards
    .trim();

  if (sanitized.length === 0) {
    throw new ValidationError('Search query cannot be empty');
  }

  if (sanitized.length > 1000) {
    throw new ValidationError('Search query too long (max 1000 characters)');
  }

  return sanitized;
}

export function validateSessionName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new ValidationError('Session name must be a non-empty string');
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Session name cannot be empty');
  }

  if (trimmed.length > 255) {
    throw new ValidationError('Session name too long (max 255 characters)');
  }

  // Check for path traversal attempts
  if (trimmed.includes('../') || trimmed.includes('..\\')) {
    throw new ValidationError('Session name contains invalid characters');
  }

  // Check for null bytes
  if (trimmed.includes('\0')) {
    throw new ValidationError('Session name contains invalid characters');
  }

  // Check for script injection
  if (/<script|<\/script|javascript:|<iframe|<object|<embed/i.test(trimmed)) {
    throw new ValidationError('Session name contains invalid characters');
  }

  return trimmed;
}

export function validateKey(key: string): string {
  // Type validation
  if (key === null || key === undefined) {
    throw new ValidationError('Key cannot be null or undefined');
  }

  if (typeof key !== 'string') {
    throw new ValidationError('Key must be a string');
  }

  // Empty string check (before trimming)
  if (key === '') {
    throw new ValidationError('Key cannot be empty');
  }

  // Check if key becomes empty after trimming
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Key cannot be empty or contain only whitespace');
  }

  // Length validation
  if (trimmed.length > 255) {
    throw new ValidationError('Key too long (max 255 characters)');
  }

  // Check for invalid characters
  // First check for spaces specifically (for better error messages)
  if (/\s/.test(key)) {
    if (/ /.test(key)) {
      throw new ValidationError('Key contains special characters - spaces are not allowed');
    } else if (/\t/.test(key)) {
      throw new ValidationError('Key contains special characters - tabs are not allowed');
    } else if (/[\n\r]/.test(key)) {
      throw new ValidationError('Key contains special characters (newlines)');
    } else {
      throw new ValidationError('Key contains special characters (whitespace)');
    }
  }

  // Check for null bytes
  if (/\0/.test(key)) {
    throw new ValidationError('Key contains invalid characters (null bytes)');
  }

  // Check for control characters (excluding those already checked)
  // eslint-disable-next-line no-control-regex
  if (/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(key)) {
    throw new ValidationError('Key contains control characters');
  }

  // Check for backslashes
  if (/\\/.test(key)) {
    throw new ValidationError('Key contains special characters (backslashes)');
  }

  // Check for quotes
  if (/['"`]/.test(key)) {
    throw new ValidationError('Key contains quotes');
  }

  // Check for shell special characters (including ~)
  if (/[;|&$<>(){}[\]!#~]/.test(key)) {
    throw new ValidationError('Key contains special characters');
  }

  // Check for wildcards
  if (/[*?]/.test(key)) {
    throw new ValidationError('Key contains wildcards (* or ?)');
  }

  // Only allow basic ASCII characters plus underscore, hyphen, dot, forward slash, and colon
  // This will reject all Unicode including emojis, Chinese characters, etc.
  if (!/^[a-zA-Z0-9_\-./:]+$/.test(key)) {
    throw new ValidationError('Key contains special characters');
  }

  // Path traversal protection
  if (key.includes('../') || key.includes('..\\')) {
    throw new ValidationError('Key cannot contain path traversal sequences');
  }

  // SQL injection protection - check for common SQL keywords in suspicious patterns
  const sqlPatterns = [
    /;\s*(DROP|DELETE|INSERT|UPDATE|SELECT|CREATE|ALTER|TRUNCATE)/i,
    /--\s*$/,
    /\/\*.*\*\//,
    /\bUNION\s+SELECT\b/i,
    /\bOR\s+1\s*=\s*1\b/i,
  ];

  for (const pattern of sqlPatterns) {
    if (pattern.test(key)) {
      throw new ValidationError('Key contains potentially malicious SQL patterns');
    }
  }

  // Script injection protection
  if (/<script|<\/script|javascript:|<iframe|<object|<embed|<img.*on\w+=/i.test(key)) {
    throw new ValidationError('Key contains potentially malicious script patterns');
  }

  // If we get here, the key is valid
  return trimmed;
}

export function validateValue(value: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Value must be a string');
  }

  // Allow empty values but check size
  if (value.length > 1000000) {
    // 1MB limit
    throw new ValidationError('Value too large (max 1MB)');
  }

  return value;
}

export function validateCategory(category?: string): string | undefined {
  if (!category) return undefined;

  const validCategories = [
    'task',
    'decision',
    'progress',
    'note',
    'error',
    'warning',
    'git',
    'system',
  ];
  if (!validCategories.includes(category)) {
    throw new ValidationError(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
  }

  return category;
}

export function validatePriority(priority?: string): string {
  if (!priority) return 'normal';

  const validPriorities = ['high', 'normal', 'low'];
  if (!validPriorities.includes(priority)) {
    throw new ValidationError(`Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
  }

  return priority;
}
