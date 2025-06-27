import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RepositoryManager } from '../repositories/RepositoryManager.js';
import { ValidationError } from '../utils/validation.js';

/**
 * Validates filter parameters for watchers
 */
function validateFilters(filters: any): void {
  if (filters) {
    // Validate keys
    if (filters.keys !== undefined && !Array.isArray(filters.keys)) {
      throw new ValidationError('keys filter must be an array');
    }

    // Validate channels
    if (filters.channels !== undefined && !Array.isArray(filters.channels)) {
      throw new ValidationError('channels filter must be an array');
    }

    // Validate categories
    if (filters.categories !== undefined && !Array.isArray(filters.categories)) {
      throw new ValidationError('categories filter must be an array');
    }

    // Validate category values
    if (filters.categories) {
      const validCategories = ['task', 'decision', 'progress', 'note', 'error', 'warning'];
      for (const cat of filters.categories) {
        if (!validCategories.includes(cat)) {
          throw new ValidationError(`Invalid category: ${cat}`);
        }
      }
    }

    // Validate priorities
    if (filters.priorities !== undefined && !Array.isArray(filters.priorities)) {
      throw new ValidationError('priorities filter must be an array');
    }

    // Validate priority values
    if (filters.priorities) {
      const validPriorities = ['high', 'normal', 'low'];
      for (const priority of filters.priorities) {
        if (!validPriorities.includes(priority)) {
          throw new ValidationError(`Invalid priority: ${priority}`);
        }
      }
    }
  }
}

/**
 * context_watch handler - unified handler for all watch operations
 */
export async function handleContextWatch(
  args: any,
  repositories: RepositoryManager,
  currentSessionId: string
): Promise<CallToolResult> {
  const { action, watcherId, filters } = args;

  try {
    switch (action) {
      case 'create': {
        // Validate filters
        validateFilters(filters);

        // Create watcher
        const watcher = repositories.watchers.createWatcher({
          sessionId: currentSessionId,
          filters: filters || {},
          ttl: 1800, // 30 minutes default
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  watcherId: watcher.id,
                  created: true,
                  filters: watcher.filters,
                  currentSequence: watcher.lastSequence,
                  expiresIn: '30 minutes',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'poll': {
        if (!watcherId) {
          throw new ValidationError('watcherId is required for poll action');
        }

        // Poll for changes
        const result = repositories.watchers.pollChanges(watcherId, 100);

        if (result.watcherStatus === 'deleted') {
          throw new ValidationError(`Watcher not found: ${watcherId}`);
        }

        if (result.watcherStatus === 'expired') {
          // Check if it's actually stopped vs expired
          const watcher = repositories.watchers.getWatcher(watcherId);
          if (watcher && !watcher.isActive) {
            throw new ValidationError(`Watcher is stopped: ${watcherId}`);
          }
          throw new ValidationError(`Watcher expired: ${watcherId}`);
        }

        // Transform changes to match test expectations
        const transformedChanges = result.changes.map(change => ({
          type: change.operation,
          key: change.key,
          value: change.operation !== 'DELETE' ? change.newValue : undefined,
          category: change.category,
          channel: change.channel,
          sequence: change.sequenceId,
          timestamp: change.createdAt,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  watcherId,
                  changes: transformedChanges,
                  hasMore: result.hasMore,
                  lastSequence: result.lastSequence,
                  polledAt: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'stop': {
        if (!watcherId) {
          throw new ValidationError('watcherId is required for stop action');
        }

        const stopped = repositories.watchers.stopWatcher(watcherId);

        if (!stopped) {
          throw new ValidationError(`Watcher not found: ${watcherId}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  watcherId,
                  stopped: true,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'list': {
        const watchers = repositories.watchers.listWatchers(currentSessionId);

        const watcherList = watchers.map(w => ({
          watcherId: w.id,
          active: w.isActive,
          filters: w.filters,
          lastSequence: w.lastSequence,
          createdAt: w.createdAt,
          expiresAt: w.expiresAt,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  watchers: watcherList,
                  total: watcherList.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new ValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
      };
    }
    throw error;
  }
}

/**
 * Context watch create handler
 */
export async function handleContextWatchCreate(
  args: any,
  repositories: RepositoryManager,
  currentSessionId: string
): Promise<CallToolResult> {
  return handleContextWatch({ ...args, action: 'create' }, repositories, currentSessionId);
}

/**
 * Context watch poll handler
 */
export async function handleContextWatchPoll(
  args: any,
  repositories: RepositoryManager,
  currentSessionId: string
): Promise<CallToolResult> {
  return handleContextWatch({ ...args, action: 'poll' }, repositories, currentSessionId);
}

/**
 * Context watch stop handler
 */
export async function handleContextWatchStop(
  args: any,
  repositories: RepositoryManager,
  currentSessionId: string
): Promise<CallToolResult> {
  return handleContextWatch({ ...args, action: 'stop' }, repositories, currentSessionId);
}

/**
 * Context watch list handler
 */
export async function handleContextWatchList(
  args: any,
  repositories: RepositoryManager,
  currentSessionId: string
): Promise<CallToolResult> {
  return handleContextWatch({ ...args, action: 'list' }, repositories, currentSessionId);
}
