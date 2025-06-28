/**
 * Timezone-Safe Date Testing Utility
 *
 * This utility provides functions for creating timezone-agnostic test dates
 * that ensure consistent behavior across all environments regardless of system timezone.
 *
 * PROBLEM: Tests that use `new Date()` or local timezone methods fail when run in
 * different timezones (e.g., CI/CD running in UTC vs local development in PST/PDT).
 *
 * SOLUTION: Use fixed UTC reference dates and UTC-based date construction to ensure
 * timeline grouping and date calculations work identically everywhere.
 */

/**
 * Fixed reference date in UTC for consistent test behavior
 * This date should be:
 * - Fixed and not based on current time
 * - In UTC timezone (ends with 'Z')
 * - At noon to avoid midnight boundary issues
 */
export const TEST_BASE_DATE = new Date('2025-06-20T12:00:00.000Z');

/**
 * Creates a UTC date offset by the specified number of days from the base date
 * @param daysOffset Number of days to offset (negative for past dates)
 * @param hour Hour in UTC (default: 12 for noon)
 * @param minute Minute (default: 0)
 * @param second Second (default: 0)
 * @returns Date object in UTC
 */
export function createUTCDate(
  daysOffset: number = 0,
  hour: number = 12,
  minute: number = 0,
  second: number = 0
): Date {
  return new Date(
    Date.UTC(
      TEST_BASE_DATE.getUTCFullYear(),
      TEST_BASE_DATE.getUTCMonth(),
      TEST_BASE_DATE.getUTCDate() + daysOffset,
      hour,
      minute,
      second
    )
  );
}

/**
 * Creates a UTC date offset by the specified number of hours from the base date
 * @param hoursOffset Number of hours to offset
 * @returns Date object in UTC
 */
export function createUTCDateByHours(hoursOffset: number): Date {
  return new Date(TEST_BASE_DATE.getTime() + hoursOffset * 60 * 60 * 1000);
}

/**
 * Creates a UTC date offset by the specified number of milliseconds from the base date
 * @param msOffset Number of milliseconds to offset
 * @returns Date object in UTC
 */
export function createUTCDateByMs(msOffset: number): Date {
  return new Date(TEST_BASE_DATE.getTime() + msOffset);
}

/**
 * Creates a set of test dates for timeline testing
 * @returns Object with commonly used test dates
 */
export function createTimelineTestDates() {
  return {
    baseDate: TEST_BASE_DATE,
    today: createUTCDate(0), // 2025-06-20 12:00:00 UTC
    yesterday: createUTCDate(-1), // 2025-06-19 12:00:00 UTC
    threeDaysAgo: createUTCDate(-3), // 2025-06-17 12:00:00 UTC
    fiveDaysAgo: createUTCDate(-5), // 2025-06-15 12:00:00 UTC
    sevenDaysAgo: createUTCDate(-7), // 2025-06-13 12:00:00 UTC
    oneWeekAgo: createUTCDate(-7),
    oneMonthAgo: createUTCDate(-30),
    oneYearAgo: createUTCDate(-365),
  };
}

/**
 * Creates a date range for testing
 * @param startDaysOffset Days offset for start date
 * @param endDaysOffset Days offset for end date (default: 0 = base date)
 * @returns Object with start and end dates
 */
export function createDateRange(startDaysOffset: number, endDaysOffset: number = 0) {
  return {
    startDate: createUTCDate(startDaysOffset),
    endDate: createUTCDate(endDaysOffset),
  };
}

/**
 * Validates that the timezone-safe pattern is working correctly
 * This function can be used in tests to verify consistent behavior
 */
export function validateTimezoneSafety() {
  const testDate = createUTCDate(0);

  // Should always produce the same UTC string regardless of system timezone
  const expectedISOString = '2025-06-20T12:00:00.000Z';

  if (testDate.toISOString() !== expectedISOString) {
    throw new Error(
      `Timezone safety validation failed. Expected: ${expectedISOString}, Got: ${testDate.toISOString()}`
    );
  }

  return true;
}

/**
 * Example usage patterns for timezone-safe testing:
 *
 * // ✅ CORRECT - Timezone-safe pattern
 * const { today, yesterday } = createTimelineTestDates();
 * const items = [
 *   { time: new Date(today.getTime() + 60 * 60 * 1000), data: 'test' },
 *   { time: new Date(yesterday.getTime() + 60 * 60 * 1000), data: 'test' }
 * ];
 *
 * // ✅ CORRECT - For date ranges
 * const { startDate, endDate } = createDateRange(-10, 0);
 *
 * // ❌ WRONG - Timezone-dependent pattern
 * const now = new Date();
 * const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
 *
 * // ❌ WRONG - System timezone dependent
 * const yesterday = new Date();
 * yesterday.setDate(yesterday.getDate() - 1);
 */
