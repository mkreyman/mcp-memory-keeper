/**
 * Channel utility functions for deriving and managing channel names
 */

/**
 * Derives a channel name from a git branch name
 * @param branch - Git branch name
 * @returns Derived channel name (max 20 chars) or null if branch should be skipped
 */
export function deriveChannelFromBranch(branch: string): string | null {
  if (!branch || branch.trim() === '') return null;

  // Skip main and master branches - they should not have their own channels
  if (branch === 'main' || branch === 'master') return null;

  // Replace special characters with hyphens
  let channel = branch
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');

  // If channel is empty after cleaning, return general
  if (!channel) return 'general';

  // Truncate to 20 characters
  if (channel.length > 20) {
    channel = channel.substring(0, 20);
  }

  return channel;
}

/**
 * Derives a default channel name from branch or session name
 * @param branch - Git branch name (optional)
 * @param sessionName - Session name (optional)
 * @returns Derived channel name (max 20 chars) or 'general' if no inputs
 */
export function deriveDefaultChannel(branch?: string, sessionName?: string): string {
  // First try to derive from branch
  if (branch) {
    const branchChannel = deriveChannelFromBranch(branch);
    if (branchChannel) {
      return branchChannel;
    }
  }

  // If branch derivation failed or returned null (main/master), try session name
  if (sessionName) {
    const sessionChannel = deriveChannelFromBranch(sessionName);
    if (sessionChannel) {
      return sessionChannel;
    }
  }

  // Default fallback
  return 'general';
}

/**
 * Validates a channel name
 * @param channel - Channel name to validate
 * @returns true if valid, false otherwise
 */
export function isValidChannel(channel: string): boolean {
  if (!channel || typeof channel !== 'string') {
    return false;
  }

  // Check length
  if (channel.length === 0 || channel.length > 20) {
    return false;
  }

  // Check format (lowercase letters, numbers, hyphens only)
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(channel);
}

/**
 * Normalizes a channel name to ensure it's valid
 * @param channel - Channel name to normalize
 * @returns Normalized channel name
 */
export function normalizeChannel(channel: string): string {
  if (!channel || typeof channel !== 'string') {
    return 'general';
  }

  // Apply same logic as deriveDefaultChannel
  const normalized = channel
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    return 'general';
  }

  // Truncate if needed
  if (normalized.length > 20) {
    return normalized.substring(0, 20).replace(/-+$/, '');
  }

  return normalized;
}

/**
 * Helper interface for session creation with git info
 */
export interface SessionWithGitInfoOptions {
  name?: string;
  git: {
    getCurrentBranch(): Promise<string | null>;
  };
}

/**
 * Creates a session configuration with automatic channel derivation from git
 * @param options - Options including name and git operations
 * @returns Session configuration with derived channel
 */
export async function createSessionWithGitInfo(options: SessionWithGitInfoOptions): Promise<{
  id: string;
  name: string;
  default_channel: string;
}> {
  const { v4: uuidv4 } = await import('uuid');
  const branch = await options.git.getCurrentBranch();
  const channel =
    deriveChannelFromBranch(branch || '') ||
    deriveChannelFromBranch(options.name || '') ||
    'general';

  return {
    id: uuidv4(),
    name: options.name || `Session ${Date.now()}`,
    default_channel: channel,
  };
}
