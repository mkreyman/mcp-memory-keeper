/**
 * Timestamp utility functions for converting between ISO and SQLite formats
 *
 * SQLite stores timestamps in "YYYY-MM-DD HH:MM:SS" format
 * JavaScript Date objects use ISO format "YYYY-MM-DDTHH:MM:SS.sssZ"
 */

/**
 * Convert ISO timestamp to SQLite format
 * @param isoTimestamp - ISO format timestamp (e.g., "2025-06-27T02:07:07.253Z")
 * @returns SQLite format timestamp (e.g., "2025-06-27 02:07:07")
 */
export function toSQLiteTimestamp(isoTimestamp: string): string {
  if (!isoTimestamp) {
    throw new Error('Timestamp cannot be null or empty');
  }

  // Handle already converted timestamps (SQLite format)
  if (!isoTimestamp.includes('T') || !isoTimestamp.includes('Z')) {
    // Already in SQLite format or not an ISO timestamp
    return isoTimestamp;
  }

  try {
    // Convert ISO format to SQLite format
    // "2025-06-27T02:07:07.253Z" -> "2025-06-27 02:07:07"
    return isoTimestamp.replace('T', ' ').replace(/\.\d{3}Z$/, '');
  } catch (_error) {
    throw new Error(`Invalid ISO timestamp format: ${isoTimestamp}`);
  }
}

/**
 * Convert SQLite timestamp to ISO format
 * @param sqliteTimestamp - SQLite format timestamp (e.g., "2025-06-27 02:07:07")
 * @returns ISO format timestamp (e.g., "2025-06-27T02:07:07.000Z")
 */
export function toISOTimestamp(sqliteTimestamp: string): string {
  if (!sqliteTimestamp) {
    throw new Error('Timestamp cannot be null or empty');
  }

  // Handle already converted timestamps (ISO format)
  if (sqliteTimestamp.includes('T') && sqliteTimestamp.includes('Z')) {
    // Already in ISO format
    return sqliteTimestamp;
  }

  try {
    // Convert SQLite format to ISO format
    // "2025-06-27 02:07:07" -> "2025-06-27T02:07:07.000Z"
    return sqliteTimestamp.replace(' ', 'T') + '.000Z';
  } catch (_error) {
    throw new Error(`Invalid SQLite timestamp format: ${sqliteTimestamp}`);
  }
}

/**
 * Check if a timestamp is in ISO format
 * @param timestamp - The timestamp to check
 * @returns true if the timestamp is in ISO format
 */
export function isISOTimestamp(timestamp: string): boolean {
  if (!timestamp) return false;

  // ISO format contains 'T' and ends with 'Z'
  return timestamp.includes('T') && timestamp.endsWith('Z');
}

/**
 * Check if a timestamp is in SQLite format
 * @param timestamp - The timestamp to check
 * @returns true if the timestamp is in SQLite format
 */
export function isSQLiteTimestamp(timestamp: string): boolean {
  if (!timestamp) return false;

  // SQLite format contains space and doesn't end with 'Z'
  return timestamp.includes(' ') && !timestamp.endsWith('Z');
}

/**
 * Ensure a timestamp is in SQLite format, converting if necessary
 * @param timestamp - The timestamp in any supported format
 * @returns SQLite format timestamp
 */
export function ensureSQLiteFormat(timestamp: string): string {
  if (!timestamp) {
    throw new Error('Timestamp cannot be null or empty');
  }

  if (isISOTimestamp(timestamp)) {
    return toSQLiteTimestamp(timestamp);
  }

  // Assume it's already SQLite format or handle as-is
  return timestamp;
}

/**
 * Ensure a timestamp is in ISO format, converting if necessary
 * @param timestamp - The timestamp in any supported format
 * @returns ISO format timestamp
 */
export function ensureISOFormat(timestamp: string): string {
  if (!timestamp) {
    throw new Error('Timestamp cannot be null or empty');
  }

  if (isSQLiteTimestamp(timestamp)) {
    return toISOTimestamp(timestamp);
  }

  // Assume it's already ISO format or handle as-is
  return timestamp;
}
