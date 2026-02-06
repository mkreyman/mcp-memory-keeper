import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * All known tool names - source of truth for validation.
 * Update this list whenever a tool is added or removed from the
 * ListToolsRequestSchema handler in src/index.ts.
 */
export const ALL_TOOL_NAMES = [
  // Session Management
  'context_session_start',
  'context_session_list',
  'context_set_project_dir',
  // Core Context
  'context_save',
  'context_get',
  'context_status',
  // File Caching
  'context_cache_file',
  'context_file_changed',
  // Checkpoints
  'context_checkpoint',
  'context_restore_checkpoint',
  // Summarization & Compaction
  'context_summarize',
  'context_prepare_compaction',
  // Git Integration
  'context_git_commit',
  // Search
  'context_search',
  'context_search_all',
  'context_semantic_search',
  // Export/Import
  'context_export',
  'context_import',
  // Knowledge Graph
  'context_analyze',
  'context_find_related',
  'context_visualize',
  // Multi-Agent
  'context_delegate',
  // Session Branching/Merging
  'context_branch_session',
  'context_merge_sessions',
  // Journal & Timeline
  'context_journal_entry',
  'context_timeline',
  // Advanced Features
  'context_compress',
  'context_integrate_tool',
  'context_diff',
  // Channel Management
  'context_list_channels',
  'context_channel_stats',
  'context_reassign_channel',
  // Watch
  'context_watch',
  // Batch Operations
  'context_batch_save',
  'context_batch_delete',
  'context_batch_update',
  // Relationships
  'context_link',
  'context_get_related',
] as const;

/** Union type of all valid tool names */
export type ToolName = (typeof ALL_TOOL_NAMES)[number];

/** Pre-computed Set for O(1) lookups — used internally and exported for index.ts */
export const ALL_TOOL_NAMES_SET: ReadonlySet<string> = new Set<string>(ALL_TOOL_NAMES);

/** Built-in default profiles */
export const DEFAULT_PROFILES: Record<string, readonly string[]> = {
  minimal: [
    'context_session_start',
    'context_session_list',
    'context_save',
    'context_get',
    'context_search',
    'context_status',
    'context_checkpoint',
    'context_restore_checkpoint',
  ],
  standard: [
    'context_session_start',
    'context_session_list',
    'context_set_project_dir',
    'context_save',
    'context_get',
    'context_status',
    'context_checkpoint',
    'context_restore_checkpoint',
    'context_search',
    'context_search_all',
    'context_summarize',
    'context_prepare_compaction',
    'context_git_commit',
    'context_export',
    'context_import',
    'context_journal_entry',
    'context_timeline',
    'context_list_channels',
    'context_channel_stats',
    'context_batch_save',
    'context_batch_delete',
    'context_batch_update',
  ],
  full: [...ALL_TOOL_NAMES],
};

export interface ToolProfileConfig {
  profiles: Record<string, string[]>;
}

export interface ResolvedProfile {
  profileName: string;
  tools: Set<string>;
  source: 'env+config' | 'env+builtin' | 'config' | 'default';
  warnings: string[];
}

const CONFIG_DIR = path.join(os.homedir(), '.mcp-memory-keeper');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** Load config file, returning null if absent or invalid */
export function loadConfigFile(configPath: string = CONFIG_FILE): ToolProfileConfig | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !parsed.profiles ||
      typeof parsed.profiles !== 'object' ||
      Array.isArray(parsed.profiles)
    ) {
      console.warn(
        `[MCP-Memory-Keeper] Config file at ${configPath} is missing a valid "profiles" key. Ignoring file.`
      );
      return null;
    }

    // Validated: parsed.profiles is a non-null, non-array object
    return { profiles: parsed.profiles } as ToolProfileConfig;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[MCP-Memory-Keeper] Failed to load config file at ${configPath}: ${message}. Ignoring file.`
    );
    return null;
  }
}

/** Validate tool names against ALL_TOOL_NAMES, returning unknown names */
export function validateToolNames(tools: string[]): string[] {
  return tools.filter(name => !ALL_TOOL_NAMES_SET.has(name));
}

/** Resolve the active profile based on env var and config file */
export function resolveActiveProfile(configPath?: string): ResolvedProfile {
  const warnings: string[] = [];
  let profileName = (process.env.TOOL_PROFILE || '').trim();
  const hasEnvVar = profileName.length > 0;

  if (!hasEnvVar) {
    profileName = 'full';
  }

  const config = loadConfigFile(configPath);

  let toolList: string[] | undefined;
  let source: ResolvedProfile['source'] = 'default';

  // Resolution precedence: config file > built-in defaults
  if (config && config.profiles[profileName] !== undefined) {
    const candidate = config.profiles[profileName];
    // Validate that the profile value is actually an array of strings
    if (!Array.isArray(candidate) || !candidate.every(item => typeof item === 'string')) {
      warnings.push(
        `Profile "${profileName}" in config file is not a valid array of strings. Falling back to built-in default.`
      );
    } else {
      toolList = candidate as string[];
      source = hasEnvVar ? 'env+config' : 'config';
    }
  }

  if (toolList === undefined && DEFAULT_PROFILES[profileName] !== undefined) {
    toolList = [...DEFAULT_PROFILES[profileName]];
    source = hasEnvVar ? 'env+builtin' : 'default';
  }

  if (toolList === undefined) {
    // Profile not found anywhere
    const availableNames = new Set([
      ...Object.keys(DEFAULT_PROFILES),
      ...(config ? Object.keys(config.profiles) : []),
    ]);
    warnings.push(
      `Unknown TOOL_PROFILE "${profileName}". Available profiles: ${[...availableNames].join(', ')}. Using "full".`
    );
    profileName = 'full';
    toolList = [...DEFAULT_PROFILES.full];
    source = 'default';
  }

  // Validate tool names
  const unknownNames = validateToolNames(toolList);
  if (unknownNames.length > 0) {
    warnings.push(
      `Unknown tool names in profile "${profileName}": ${unknownNames.join(', ')}. These will be ignored.`
    );
  }

  // Filter to only valid tools
  const validTools = toolList.filter(name => ALL_TOOL_NAMES_SET.has(name));

  // Guard against empty profile
  if (validTools.length === 0) {
    warnings.push(`Profile "${profileName}" has no valid tools after filtering. Using "full".`);
    profileName = 'full';
    return {
      profileName,
      tools: new Set<string>(ALL_TOOL_NAMES),
      source: 'default',
      warnings,
    };
  }

  return {
    profileName,
    tools: new Set(validTools),
    source,
    warnings,
  };
}
