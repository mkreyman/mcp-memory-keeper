import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ALL_TOOL_NAMES,
  DEFAULT_PROFILES,
  loadConfigFile,
  validateToolNames,
  resolveActiveProfile,
  isToolEnabled,
} from '../../utils/tool-profiles';

describe('Tool Profiles', () => {
  describe('ALL_TOOL_NAMES', () => {
    it('should contain exactly 38 tool names', () => {
      expect(ALL_TOOL_NAMES).toHaveLength(38);
    });

    it('should have no duplicates', () => {
      const unique = new Set(ALL_TOOL_NAMES);
      expect(unique.size).toBe(ALL_TOOL_NAMES.length);
    });

    it('should all start with "context_"', () => {
      for (const name of ALL_TOOL_NAMES) {
        expect(name).toMatch(/^context_/);
      }
    });
  });

  describe('DEFAULT_PROFILES', () => {
    it('should define minimal, standard, and full profiles', () => {
      expect(DEFAULT_PROFILES).toHaveProperty('minimal');
      expect(DEFAULT_PROFILES).toHaveProperty('standard');
      expect(DEFAULT_PROFILES).toHaveProperty('full');
    });

    it('minimal should have 8 tools', () => {
      expect(DEFAULT_PROFILES.minimal).toHaveLength(8);
    });

    it('standard should have 22 tools', () => {
      expect(DEFAULT_PROFILES.standard).toHaveLength(22);
    });

    it('full should have all 38 tools', () => {
      expect(DEFAULT_PROFILES.full).toHaveLength(38);
    });

    it('minimal should be a subset of standard', () => {
      const standardSet = new Set(DEFAULT_PROFILES.standard);
      for (const tool of DEFAULT_PROFILES.minimal) {
        expect(standardSet.has(tool)).toBe(true);
      }
    });

    it('standard should be a subset of full', () => {
      const fullSet = new Set(DEFAULT_PROFILES.full);
      for (const tool of DEFAULT_PROFILES.standard) {
        expect(fullSet.has(tool)).toBe(true);
      }
    });

    it('all tools in each profile should be valid tool names', () => {
      const validSet = new Set(ALL_TOOL_NAMES);
      for (const [_profileName, tools] of Object.entries(DEFAULT_PROFILES)) {
        for (const tool of tools) {
          expect(validSet.has(tool)).toBe(true);
        }
      }
    });

    it('full profile should match ALL_TOOL_NAMES exactly', () => {
      expect(new Set(DEFAULT_PROFILES.full)).toEqual(new Set(ALL_TOOL_NAMES));
    });
  });

  describe('validateToolNames', () => {
    it('should return empty array for all valid names', () => {
      expect(validateToolNames(['context_save', 'context_get'])).toEqual([]);
    });

    it('should return unknown names', () => {
      const result = validateToolNames(['context_save', 'nonexistent_tool', 'another_fake']);
      expect(result).toEqual(['nonexistent_tool', 'another_fake']);
    });

    it('should handle empty array', () => {
      expect(validateToolNames([])).toEqual([]);
    });

    it('should handle all-invalid array', () => {
      const result = validateToolNames(['fake1', 'fake2']);
      expect(result).toEqual(['fake1', 'fake2']);
    });
  });

  describe('loadConfigFile', () => {
    const tmpDir = path.join(os.tmpdir(), 'mcp-mk-tool-profiles-test');

    beforeEach(() => {
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should return null when config file does not exist', () => {
      const result = loadConfigFile(path.join(tmpDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('should parse valid config file', () => {
      const configPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          profiles: {
            minimal: ['context_save', 'context_get'],
          },
        })
      );
      const result = loadConfigFile(configPath);
      expect(result).not.toBeNull();
      expect(result!.profiles.minimal).toEqual(['context_save', 'context_get']);
    });

    it('should return null and warn on JSON syntax error', () => {
      const configPath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(configPath, '{ invalid json }');
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = loadConfigFile(configPath);
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load config file'));
      warnSpy.mockRestore();
    });

    it('should return null and warn on missing profiles key', () => {
      const configPath = path.join(tmpDir, 'no-profiles.json');
      fs.writeFileSync(configPath, JSON.stringify({ something: 'else' }));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = loadConfigFile(configPath);
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing a valid "profiles" key')
      );
      warnSpy.mockRestore();
    });

    it('should handle config file with extra keys gracefully', () => {
      const configPath = path.join(tmpDir, 'extra.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          profiles: { custom: ['context_save'] },
          extraKey: 'ignored',
        })
      );
      const result = loadConfigFile(configPath);
      expect(result).not.toBeNull();
      expect(result!.profiles.custom).toEqual(['context_save']);
    });
  });

  describe('resolveActiveProfile', () => {
    const originalEnv = process.env.TOOL_PROFILE;
    const tmpDir = path.join(os.tmpdir(), 'mcp-mk-resolve-profile-test');

    beforeEach(() => {
      delete process.env.TOOL_PROFILE;
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.TOOL_PROFILE = originalEnv;
      } else {
        delete process.env.TOOL_PROFILE;
      }
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should default to full when no env var and no config', () => {
      const configPath = path.join(tmpDir, 'nonexistent.json');
      const result = resolveActiveProfile(configPath);
      expect(result.profileName).toBe('full');
      expect(result.tools.size).toBe(38);
      expect(result.source).toBe('default');
      expect(result.warnings).toHaveLength(0);
    });

    it('should use env var profile from built-in defaults', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const configPath = path.join(tmpDir, 'nonexistent.json');
      const result = resolveActiveProfile(configPath);
      expect(result.profileName).toBe('minimal');
      expect(result.tools.size).toBe(8);
      expect(result.source).toBe('env+builtin');
    });

    it('should use env var profile from config file (takes precedence)', () => {
      process.env.TOOL_PROFILE = 'minimal';
      const configPath = path.join(tmpDir, 'config.json');
      // Config overrides minimal to have only 2 tools
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          profiles: { minimal: ['context_save', 'context_get'] },
        })
      );
      const result = resolveActiveProfile(configPath);
      expect(result.profileName).toBe('minimal');
      expect(result.tools.size).toBe(2);
      expect(result.source).toBe('env+config');
    });

    it('should warn and fallback to full on invalid profile name', () => {
      process.env.TOOL_PROFILE = 'nonexistent_profile';
      const configPath = path.join(tmpDir, 'nonexistent.json');
      const result = resolveActiveProfile(configPath);
      expect(result.profileName).toBe('full');
      expect(result.tools.size).toBe(38);
      expect(result.source).toBe('default');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Unknown TOOL_PROFILE');
    });

    it('should warn on unknown tool names in profile', () => {
      const configPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          profiles: { custom: ['context_save', 'fake_tool'] },
        })
      );
      process.env.TOOL_PROFILE = 'custom';
      const result = resolveActiveProfile(configPath);
      expect(result.tools.size).toBe(1);
      expect(result.tools.has('context_save')).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('fake_tool');
    });

    it('should fallback to full when profile resolves to empty', () => {
      const configPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          profiles: { empty: ['fake_tool_1', 'fake_tool_2'] },
        })
      );
      process.env.TOOL_PROFILE = 'empty';
      const result = resolveActiveProfile(configPath);
      expect(result.profileName).toBe('full');
      expect(result.tools.size).toBe(38);
      expect(result.warnings.some(w => w.includes('no valid tools'))).toBe(true);
    });

    it('should trim whitespace from TOOL_PROFILE env var', () => {
      process.env.TOOL_PROFILE = '  minimal  ';
      const configPath = path.join(tmpDir, 'nonexistent.json');
      const result = resolveActiveProfile(configPath);
      expect(result.profileName).toBe('minimal');
      expect(result.tools.size).toBe(8);
    });

    it('should support custom profiles from config file', () => {
      const configPath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          profiles: {
            my_workflow: ['context_save', 'context_get', 'context_diff'],
          },
        })
      );
      process.env.TOOL_PROFILE = 'my_workflow';
      const result = resolveActiveProfile(configPath);
      expect(result.profileName).toBe('my_workflow');
      expect(result.tools.size).toBe(3);
      expect(result.source).toBe('env+config');
    });

    it('should use standard profile from env var', () => {
      process.env.TOOL_PROFILE = 'standard';
      const configPath = path.join(tmpDir, 'nonexistent.json');
      const result = resolveActiveProfile(configPath);
      expect(result.profileName).toBe('standard');
      expect(result.tools.size).toBe(22);
      expect(result.source).toBe('env+builtin');
    });
  });

  describe('isToolEnabled', () => {
    it('should return true for enabled tools', () => {
      const enabled = new Set(['context_save', 'context_get']);
      expect(isToolEnabled('context_save', enabled)).toBe(true);
    });

    it('should return false for disabled tools', () => {
      const enabled = new Set(['context_save', 'context_get']);
      expect(isToolEnabled('context_search', enabled)).toBe(false);
    });
  });
});
