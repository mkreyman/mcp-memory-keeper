import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  ALL_TOOL_NAMES,
  ALL_TOOL_NAMES_SET,
  resolveActiveProfile,
} from '../../utils/tool-profiles';

/**
 * Drift-detection: extract tool names from the ListToolsRequestSchema handler
 * in src/index.ts to verify ALL_TOOL_NAMES stays in sync with actual tool definitions.
 */
function extractToolNamesFromIndexTs(): string[] {
  const indexPath = path.join(__dirname, '..', '..', 'index.ts');
  const src = fs.readFileSync(indexPath, 'utf-8');

  // Find the allTools array: starts after "const allTools" and ends at the matching "];"
  // We look for tool name strings inside the ListToolsRequestSchema handler
  const toolNameRegex = /^\s+name:\s+'(context_[a-z_]+)'/gm;
  const names: string[] = [];
  let match;

  // Only capture tool names outside of block comments (skip commented-out tools)
  // Split by block comment boundaries and only scan non-comment sections
  const sections = src.split(/\/\*[\s\S]*?\*\//);
  for (const section of sections) {
    toolNameRegex.lastIndex = 0;
    while ((match = toolNameRegex.exec(section)) !== null) {
      names.push(match[1]);
    }
  }

  return names;
}

describe('Tool Profile Integration Tests', () => {
  const originalEnv = process.env.TOOL_PROFILE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TOOL_PROFILE = originalEnv;
    } else {
      delete process.env.TOOL_PROFILE;
    }
  });

  describe('Drift detection: ALL_TOOL_NAMES vs index.ts', () => {
    it('ALL_TOOL_NAMES should match active tools defined in index.ts', () => {
      const indexToolNames = extractToolNamesFromIndexTs();
      const allToolNamesArray = [...ALL_TOOL_NAMES];

      // Same count
      expect(allToolNamesArray.length).toBe(indexToolNames.length);

      // Same set of names
      expect(new Set(allToolNamesArray)).toEqual(new Set(indexToolNames));
    });

    it('should not include commented-out tools', () => {
      // context_share and context_get_shared are commented out in index.ts
      expect(ALL_TOOL_NAMES_SET.has('context_share')).toBe(false);
      expect(ALL_TOOL_NAMES_SET.has('context_get_shared')).toBe(false);
    });
  });

  describe('Profile filtering behavior', () => {
    it('minimal profile should include core tools and exclude advanced tools', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const profile = resolveActiveProfile('/nonexistent/config.json');

      // Core tools present
      expect(profile.tools.has('context_save')).toBe(true);
      expect(profile.tools.has('context_get')).toBe(true);
      expect(profile.tools.has('context_search')).toBe(true);
      expect(profile.tools.has('context_checkpoint')).toBe(true);

      // Advanced tools absent
      expect(profile.tools.has('context_analyze')).toBe(false);
      expect(profile.tools.has('context_visualize')).toBe(false);
      expect(profile.tools.has('context_delegate')).toBe(false);
      expect(profile.tools.has('context_semantic_search')).toBe(false);
    });

    it('default (no env var) should expose all tools with backwards-compatible behavior', () => {
      delete process.env.TOOL_PROFILE;
      const profile = resolveActiveProfile('/nonexistent/config.json');
      expect(profile.tools.size).toBe(ALL_TOOL_NAMES.length);
      expect(profile.profileName).toBe('full');
      expect(profile.source).toBe('default');
      expect(profile.warnings).toHaveLength(0);
    });
  });

  describe('CallTool guard behavior', () => {
    it('disabled tool should be in ALL_TOOL_NAMES_SET but not in profile tools', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const profile = resolveActiveProfile('/nonexistent/config.json');

      const disabledTool = 'context_analyze';

      // The guard logic: known tool that is not enabled
      const isKnown = ALL_TOOL_NAMES_SET.has(disabledTool);
      const isEnabled = profile.tools.has(disabledTool);

      expect(isKnown).toBe(true);
      expect(isEnabled).toBe(false);
      // In index.ts: isKnown && !isEnabled → return isError: true
    });

    it('unknown tool should not be in ALL_TOOL_NAMES_SET (falls through to default switch)', () => {
      const unknownTool = 'non_existent_tool';
      expect(ALL_TOOL_NAMES_SET.has(unknownTool)).toBe(false);
      // In index.ts: !isKnown → falls through to default: throw new Error()
    });

    it('enabled tool should pass both checks', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const profile = resolveActiveProfile('/nonexistent/config.json');

      const enabledTool = 'context_save';
      const isKnown = ALL_TOOL_NAMES_SET.has(enabledTool);
      const isEnabled = profile.tools.has(enabledTool);

      expect(isKnown).toBe(true);
      expect(isEnabled).toBe(true);
      // In index.ts: isKnown && isEnabled → guard does not fire, proceeds to switch
    });
  });

  describe('TOOL_PROFILE_CONFIG support', () => {
    it('resolveActiveProfile accepts custom config path (used by TOOL_PROFILE_CONFIG)', () => {
      // This tests the mechanism that index.ts uses:
      // resolveActiveProfile(process.env.TOOL_PROFILE_CONFIG)
      const result = resolveActiveProfile('/nonexistent/custom/path/config.json');
      // Missing file → no config → falls back to built-in 'full'
      expect(result.profileName).toBe('full');
      expect(result.tools.size).toBe(38);
    });
  });
});
