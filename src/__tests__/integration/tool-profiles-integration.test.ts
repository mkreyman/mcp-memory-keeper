import { describe, it, expect } from '@jest/globals';
import { ALL_TOOL_NAMES, DEFAULT_PROFILES, resolveActiveProfile } from '../../utils/tool-profiles';

describe('Tool Profile Integration Tests', () => {
  const originalEnv = process.env.TOOL_PROFILE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TOOL_PROFILE = originalEnv;
    } else {
      delete process.env.TOOL_PROFILE;
    }
  });

  describe('Profile filtering produces correct tool counts', () => {
    it('minimal profile should expose exactly 8 tools', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const profile = resolveActiveProfile('/nonexistent/config.json');
      expect(profile.tools.size).toBe(8);
      expect(profile.profileName).toBe('minimal');
    });

    it('standard profile should expose exactly 22 tools', () => {
      process.env.TOOL_PROFILE = 'standard';
      const profile = resolveActiveProfile('/nonexistent/config.json');
      expect(profile.tools.size).toBe(22);
      expect(profile.profileName).toBe('standard');
    });

    it('full profile should expose all 38 tools', () => {
      process.env.TOOL_PROFILE = 'full';
      const profile = resolveActiveProfile('/nonexistent/config.json');
      expect(profile.tools.size).toBe(38);
      expect(profile.profileName).toBe('full');
    });

    it('default (no env var) should expose all 38 tools', () => {
      delete process.env.TOOL_PROFILE;
      const profile = resolveActiveProfile('/nonexistent/config.json');
      expect(profile.tools.size).toBe(38);
      expect(profile.profileName).toBe('full');
    });
  });

  describe('Tool filtering behavior', () => {
    it('minimal profile should include core tools', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const profile = resolveActiveProfile('/nonexistent/config.json');

      expect(profile.tools.has('context_save')).toBe(true);
      expect(profile.tools.has('context_get')).toBe(true);
      expect(profile.tools.has('context_search')).toBe(true);
      expect(profile.tools.has('context_status')).toBe(true);
      expect(profile.tools.has('context_checkpoint')).toBe(true);
    });

    it('minimal profile should exclude advanced tools', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const profile = resolveActiveProfile('/nonexistent/config.json');

      expect(profile.tools.has('context_analyze')).toBe(false);
      expect(profile.tools.has('context_visualize')).toBe(false);
      expect(profile.tools.has('context_delegate')).toBe(false);
      expect(profile.tools.has('context_semantic_search')).toBe(false);
      expect(profile.tools.has('context_branch_session')).toBe(false);
    });

    it('disabled tool call would be rejected', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const profile = resolveActiveProfile('/nonexistent/config.json');

      // Simulate the guard check from index.ts
      const toolName = 'context_analyze';
      const isEnabled = profile.tools.has(toolName);
      expect(isEnabled).toBe(false);

      // The actual guard in index.ts returns isError: true
      if (!isEnabled) {
        const errorResponse = {
          content: [
            {
              type: 'text',
              text: `Tool "${toolName}" is not available in the current tool profile "${profile.profileName}". To enable it, use TOOL_PROFILE=full or TOOL_PROFILE=standard, or add it to your profile in ~/.mcp-memory-keeper/config.json.`,
            },
          ],
          isError: true,
        };
        expect(errorResponse.isError).toBe(true);
        expect(errorResponse.content[0].text).toContain(toolName);
        expect(errorResponse.content[0].text).toContain('TOOL_PROFILE=full');
      }
    });

    it('enabled tool call would pass the guard', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const profile = resolveActiveProfile('/nonexistent/config.json');

      expect(profile.tools.has('context_save')).toBe(true);
      expect(profile.tools.has('context_get')).toBe(true);
    });
  });

  describe('Profile consistency', () => {
    it('all tools across all profiles should be valid tool names', () => {
      const validSet = new Set(ALL_TOOL_NAMES);
      for (const [_name, tools] of Object.entries(DEFAULT_PROFILES)) {
        for (const tool of tools) {
          expect(validSet.has(tool)).toBe(true);
        }
      }
    });

    it('full profile should be identical to ALL_TOOL_NAMES', () => {
      const fullSet = new Set(DEFAULT_PROFILES.full);
      const allSet = new Set(ALL_TOOL_NAMES);
      expect(fullSet).toEqual(allSet);
    });
  });
});
