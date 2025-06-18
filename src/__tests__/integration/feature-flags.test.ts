import { DatabaseManager } from '../../utils/database';
import { FeatureFlagManager, FeatureFlag } from '../../utils/feature-flags';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Feature Flags Integration Tests', () => {
  let dbManager: DatabaseManager;
  let featureFlagManager: FeatureFlagManager;
  let tempDbPath: string;
  let db: any;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `test-feature-flags-${Date.now()}.db`);
    dbManager = new DatabaseManager({
      filename: tempDbPath,
      maxSize: 10 * 1024 * 1024,
      walMode: true,
    });
    db = dbManager.getDatabase();
    featureFlagManager = new FeatureFlagManager(dbManager);
  });

  afterEach(() => {
    dbManager.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.unlinkSync(`${tempDbPath}-wal`);
      fs.unlinkSync(`${tempDbPath}-shm`);
    } catch (e) {
      // Ignore
    }
  });

  describe('Flag Management', () => {
    it('should create and retrieve feature flags', () => {
      const flag = {
        name: 'Test Feature',
        key: 'test_feature',
        enabled: true,
        description: 'A test feature flag',
        category: 'testing',
        tags: ['test', 'demo']
      };

      const flagId = featureFlagManager.createFlag(flag);
      expect(flagId).toBeDefined();
      expect(typeof flagId).toBe('string');

      const retrieved = featureFlagManager.getFlag(flagId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe(flag.name);
      expect(retrieved!.key).toBe(flag.key);
      expect(retrieved!.enabled).toBe(flag.enabled);
      expect(retrieved!.description).toBe(flag.description);
      expect(retrieved!.category).toBe(flag.category);
      expect(retrieved!.tags).toEqual(flag.tags);
    });

    it('should retrieve flags by key', () => {
      const flag = {
        name: 'Key Test',
        key: 'key_test_flag',
        enabled: false,
        description: 'Testing key retrieval'
      };

      featureFlagManager.createFlag(flag);
      
      const retrieved = featureFlagManager.getFlagByKey(flag.key);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe(flag.name);
      expect(retrieved!.key).toBe(flag.key);
    });

    it('should list all flags', () => {
      const flags = [
        { name: 'Flag 1', key: 'flag_1', enabled: true, category: 'core' },
        { name: 'Flag 2', key: 'flag_2', enabled: false, category: 'experimental' },
        { name: 'Flag 3', key: 'flag_3', enabled: true, category: 'core' }
      ];

      const flagIds = flags.map(f => featureFlagManager.createFlag(f));
      
      const allFlags = featureFlagManager.listFlags();
      expect(allFlags.length).toBeGreaterThanOrEqual(3);
      
      const createdFlags = allFlags.filter(f => flagIds.includes(f.id));
      expect(createdFlags.length).toBe(3);
    });

    it('should filter flags by category', () => {
      const flags = [
        { name: 'Core Flag', key: 'core_flag', enabled: true, category: 'core' },
        { name: 'Experimental Flag', key: 'exp_flag', enabled: true, category: 'experimental' }
      ];

      flags.forEach(f => featureFlagManager.createFlag(f));
      
      const coreFlags = featureFlagManager.listFlags({ category: 'core' });
      expect(coreFlags.length).toBeGreaterThanOrEqual(1);
      expect(coreFlags.every(f => f.category === 'core')).toBe(true);
    });

    it('should filter flags by enabled status', () => {
      const flags = [
        { name: 'Enabled Flag', key: 'enabled_flag', enabled: true },
        { name: 'Disabled Flag', key: 'disabled_flag', enabled: false }
      ];

      flags.forEach(f => featureFlagManager.createFlag(f));
      
      const enabledFlags = featureFlagManager.listFlags({ enabled: true });
      const disabledFlags = featureFlagManager.listFlags({ enabled: false });
      
      expect(enabledFlags.every(f => f.enabled === true)).toBe(true);
      expect(disabledFlags.every(f => f.enabled === false)).toBe(true);
    });

    it('should update existing flags', () => {
      const flag = {
        name: 'Original Flag',
        key: 'update_test',
        enabled: false,
        description: 'Original description'
      };

      const flagId = featureFlagManager.createFlag(flag);
      
      featureFlagManager.updateFlag(flagId, {
        name: 'Updated Flag',
        enabled: true,
        description: 'Updated description',
        category: 'updated'
      });

      const updated = featureFlagManager.getFlag(flagId);
      expect(updated!.name).toBe('Updated Flag');
      expect(updated!.enabled).toBe(true);
      expect(updated!.description).toBe('Updated description');
      expect(updated!.category).toBe('updated');
      expect(updated!.key).toBe('update_test'); // Should remain unchanged
    });

    it('should delete flags', () => {
      const flag = {
        name: 'Temporary Flag',
        key: 'temp_flag',
        enabled: true
      };

      const flagId = featureFlagManager.createFlag(flag);
      expect(featureFlagManager.getFlag(flagId)).toBeDefined();

      featureFlagManager.deleteFlag(flagId);
      expect(featureFlagManager.getFlag(flagId)).toBeNull();
    });

    it('should enforce unique keys', () => {
      const flag1 = { name: 'Flag 1', key: 'duplicate_key', enabled: true };
      const flag2 = { name: 'Flag 2', key: 'duplicate_key', enabled: false };

      featureFlagManager.createFlag(flag1);
      
      expect(() => featureFlagManager.createFlag(flag2)).toThrow();
    });
  });

  describe('Flag Evaluation', () => {
    it('should evaluate enabled flags as true', () => {
      const flag = {
        name: 'Enabled Test',
        key: 'enabled_test',
        enabled: true
      };

      featureFlagManager.createFlag(flag);
      
      const evaluation = featureFlagManager.evaluateFlag('enabled_test');
      expect(evaluation.enabled).toBe(true);
      expect(evaluation.reason).toBe('Flag enabled');
    });

    it('should evaluate disabled flags as false', () => {
      const flag = {
        name: 'Disabled Test',
        key: 'disabled_test',
        enabled: false
      };

      featureFlagManager.createFlag(flag);
      
      const evaluation = featureFlagManager.evaluateFlag('disabled_test');
      expect(evaluation.enabled).toBe(false);
      expect(evaluation.reason).toBe('Flag globally disabled');
    });

    it('should handle non-existent flags', () => {
      const evaluation = featureFlagManager.evaluateFlag('non_existent');
      expect(evaluation.enabled).toBe(false);
      expect(evaluation.reason).toBe('Flag not found');
    });

    it('should respect environment constraints', () => {
      const flag = {
        name: 'Environment Test',
        key: 'env_test',
        enabled: true,
        environments: ['development', 'staging']
      };

      featureFlagManager.createFlag(flag);
      
      // Should be enabled in development
      const devEval = featureFlagManager.evaluateFlag('env_test', { environment: 'development' });
      expect(devEval.enabled).toBe(true);
      expect(devEval.reason).toBe('Enabled for environment: development');
      
      // Should be disabled in production
      const prodEval = featureFlagManager.evaluateFlag('env_test', { environment: 'production' });
      expect(prodEval.enabled).toBe(false);
      expect(prodEval.reason).toBe('Not enabled for environment: production');
    });

    it('should respect user constraints', () => {
      const flag = {
        name: 'User Test',
        key: 'user_test',
        enabled: true,
        users: ['user1', 'user2']
      };

      featureFlagManager.createFlag(flag);
      
      // Should be enabled for user1
      const user1Eval = featureFlagManager.evaluateFlag('user_test', { userId: 'user1' });
      expect(user1Eval.enabled).toBe(true);
      expect(user1Eval.reason).toBe('Enabled for user: user1');
      
      // Should be disabled for user3
      const user3Eval = featureFlagManager.evaluateFlag('user_test', { userId: 'user3' });
      expect(user3Eval.enabled).toBe(false);
      expect(user3Eval.reason).toBe('Not enabled for user: user3');
    });

    it('should respect percentage rollout', () => {
      const flag = {
        name: 'Percentage Test',
        key: 'percentage_test',
        enabled: true,
        percentage: 50 // 50% rollout
      };

      featureFlagManager.createFlag(flag);
      
      // Test with different user IDs to get different hash values
      const results = [];
      for (let i = 0; i < 100; i++) {
        const evaluation = featureFlagManager.evaluateFlag('percentage_test', { userId: `user${i}` });
        results.push(evaluation.enabled);
      }
      
      const enabledCount = results.filter(r => r).length;
      // Should be roughly 50% (allow for some variance due to hashing)
      expect(enabledCount).toBeGreaterThan(30);
      expect(enabledCount).toBeLessThan(70);
    });

    it('should respect date constraints', () => {
      const now = new Date();
      const future = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day in future
      const past = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day in past

      const futureFlag = {
        name: 'Future Flag',
        key: 'future_flag',
        enabled: true,
        enabledFrom: future.toISOString()
      };

      const expiredFlag = {
        name: 'Expired Flag',
        key: 'expired_flag',
        enabled: true,
        enabledUntil: past.toISOString()
      };

      featureFlagManager.createFlag(futureFlag);
      featureFlagManager.createFlag(expiredFlag);
      
      const futureEval = featureFlagManager.evaluateFlag('future_flag');
      expect(futureEval.enabled).toBe(false);
      expect(futureEval.reason).toContain('not yet active');
      
      const expiredEval = featureFlagManager.evaluateFlag('expired_flag');
      expect(expiredEval.enabled).toBe(false);
      expect(expiredEval.reason).toContain('expired');
    });

    it('should provide isEnabled shortcut', () => {
      const flag = {
        name: 'Shortcut Test',
        key: 'shortcut_test',
        enabled: true
      };

      featureFlagManager.createFlag(flag);
      
      expect(featureFlagManager.isEnabled('shortcut_test')).toBe(true);
      expect(featureFlagManager.isEnabled('non_existent')).toBe(false);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      // Create test flags
      const flags = [
        { name: 'Core Flag 1', key: 'core_1', enabled: true, category: 'core', environments: ['production'] },
        { name: 'Core Flag 2', key: 'core_2', enabled: false, category: 'core', environments: ['production'] },
        { name: 'Experimental Flag', key: 'exp_1', enabled: true, category: 'experimental', environments: ['development'] },
        { name: 'Beta Flag', key: 'beta_1', enabled: false, category: 'beta', environments: ['staging'] }
      ];

      flags.forEach(f => featureFlagManager.createFlag(f));
    });

    it('should calculate overall statistics', () => {
      const stats = featureFlagManager.getStats();
      
      expect(stats.totalFlags).toBe(4);
      expect(stats.enabledFlags).toBe(2);
      expect(stats.disabledFlags).toBe(2);
    });

    it('should group statistics by category', () => {
      const stats = featureFlagManager.getStats();
      
      expect(stats.byCategory.core.count).toBe(2);
      expect(stats.byCategory.core.enabled).toBe(1);
      expect(stats.byCategory.experimental.count).toBe(1);
      expect(stats.byCategory.experimental.enabled).toBe(1);
    });

    it('should group statistics by environment', () => {
      const stats = featureFlagManager.getStats();
      
      expect(stats.byEnvironment.production.count).toBe(2);
      expect(stats.byEnvironment.production.enabled).toBe(1);
      expect(stats.byEnvironment.development.count).toBe(1);
      expect(stats.byEnvironment.development.enabled).toBe(1);
    });

    it('should track recent activity', () => {
      const stats = featureFlagManager.getStats();
      
      expect(stats.recentActivity.length).toBeGreaterThan(0);
      expect(stats.recentActivity[0]).toHaveProperty('flag');
      expect(stats.recentActivity[0]).toHaveProperty('action');
      expect(stats.recentActivity[0]).toHaveProperty('timestamp');
    });

    it('should identify scheduled changes', () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      
      const scheduledFlag = {
        name: 'Scheduled Flag',
        key: 'scheduled_flag',
        enabled: false,
        enabledFrom: future
      };

      featureFlagManager.createFlag(scheduledFlag);
      
      const stats = featureFlagManager.getStats();
      expect(stats.scheduledChanges.toEnable.length).toBeGreaterThan(0);
      expect(stats.scheduledChanges.toEnable[0].flag).toBe('Scheduled Flag');
    });
  });

  describe('Audit and Logging', () => {
    it('should log flag evaluations', () => {
      const flag = {
        name: 'Audit Test',
        key: 'audit_test',
        enabled: true
      };

      const flagId = featureFlagManager.createFlag(flag);
      
      // Perform some evaluations
      featureFlagManager.evaluateFlag('audit_test', { userId: 'test_user' });
      featureFlagManager.evaluateFlag('audit_test', { environment: 'test' });
      
      const history = featureFlagManager.getEvaluationHistory('audit_test');
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0]).toHaveProperty('enabled');
      expect(history[0]).toHaveProperty('reason');
    });

    it('should maintain audit log', () => {
      const flag = {
        name: 'Audit Flag',
        key: 'audit_flag',
        enabled: false
      };

      const flagId = featureFlagManager.createFlag(flag);
      
      // Update the flag
      featureFlagManager.updateFlag(flagId, { enabled: true }, 'test_user');
      
      // Delete the flag
      featureFlagManager.deleteFlag(flagId, 'test_user');
      
      const auditLog = featureFlagManager.getAuditLog(flagId);
      expect(auditLog.length).toBeGreaterThanOrEqual(3); // create, update, delete
      
      const actions = auditLog.map(entry => entry.action);
      expect(actions).toContain('created');
      expect(actions).toContain('updated');
      expect(actions).toContain('deleted');
    });

    it('should track user information in audit log', () => {
      const flag = {
        name: 'User Tracking',
        key: 'user_tracking',
        enabled: true
      };

      const flagId = featureFlagManager.createFlag(flag);
      featureFlagManager.updateFlag(flagId, { description: 'Updated' }, 'specific_user');
      
      const auditLog = featureFlagManager.getAuditLog(flagId);
      const updateEntry = auditLog.find(entry => entry.action === 'updated');
      expect(updateEntry.user_id).toBe('specific_user');
    });
  });

  describe('Bulk Operations', () => {
    it('should enable flags by key', () => {
      const flag = {
        name: 'Bulk Enable Test',
        key: 'bulk_enable',
        enabled: false
      };

      featureFlagManager.createFlag(flag);
      
      featureFlagManager.enableFlag('bulk_enable', 'admin_user');
      
      const updated = featureFlagManager.getFlagByKey('bulk_enable');
      expect(updated!.enabled).toBe(true);
      
      // Check audit log
      const auditLog = featureFlagManager.getAuditLog(updated!.id);
      const enableEntry = auditLog.find(entry => entry.action === 'enabled');
      expect(enableEntry).toBeDefined();
      expect(enableEntry.user_id).toBe('admin_user');
    });

    it('should disable flags by key', () => {
      const flag = {
        name: 'Bulk Disable Test',
        key: 'bulk_disable',
        enabled: true
      };

      featureFlagManager.createFlag(flag);
      
      featureFlagManager.disableFlag('bulk_disable', 'admin_user');
      
      const updated = featureFlagManager.getFlagByKey('bulk_disable');
      expect(updated!.enabled).toBe(false);
      
      // Check audit log
      const auditLog = featureFlagManager.getAuditLog(updated!.id);
      const disableEntry = auditLog.find(entry => entry.action === 'disabled');
      expect(disableEntry).toBeDefined();
    });
  });

  describe('Default Flags', () => {
    it('should provide default flags', () => {
      const defaultFlags = (FeatureFlagManager as any).getDefaultFlags();
      
      expect(defaultFlags.length).toBeGreaterThan(0);
      expect(defaultFlags[0]).toHaveProperty('name');
      expect(defaultFlags[0]).toHaveProperty('key');
      expect(defaultFlags[0]).toHaveProperty('enabled');
    });

    it('should create default flags without errors', () => {
      const defaultFlags = (FeatureFlagManager as any).getDefaultFlags();
      
      for (const flag of defaultFlags) {
        expect(() => featureFlagManager.createFlag(flag)).not.toThrow();
      }
      
      const createdFlags = featureFlagManager.listFlags();
      expect(createdFlags.length).toBe(defaultFlags.length);
    });

    it('should have meaningful default flag categories', () => {
      const defaultFlags = (FeatureFlagManager as any).getDefaultFlags();
      
      const categories = defaultFlags.map((f: any) => f.category).filter(Boolean);
      expect(categories.length).toBeGreaterThan(0);
      
      // Should have common categories
      const categorySet = new Set(categories);
      expect(categorySet.size).toBeGreaterThan(1); // Multiple categories
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent flag updates', () => {
      expect(() => featureFlagManager.updateFlag('non-existent', { enabled: true }))
        .toThrow('Feature flag not found');
    });

    it('should handle non-existent flag deletions', () => {
      expect(() => featureFlagManager.deleteFlag('non-existent'))
        .toThrow('Feature flag not found');
    });

    it('should handle non-existent flag enable/disable', () => {
      expect(() => featureFlagManager.enableFlag('non-existent'))
        .toThrow('Feature flag not found');
      
      expect(() => featureFlagManager.disableFlag('non-existent'))
        .toThrow('Feature flag not found');
    });

    it('should validate required fields', () => {
      expect(() => featureFlagManager.createFlag({ name: 'Test' } as any))
        .toThrow();
      
      expect(() => featureFlagManager.createFlag({ key: 'test' } as any))
        .toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle flags with no constraints as always enabled when flag is enabled', () => {
      const flag = {
        name: 'No Constraints',
        key: 'no_constraints',
        enabled: true
      };

      featureFlagManager.createFlag(flag);
      
      const eval1 = featureFlagManager.evaluateFlag('no_constraints', { userId: 'any_user' });
      const eval2 = featureFlagManager.evaluateFlag('no_constraints', { environment: 'any_env' });
      const eval3 = featureFlagManager.evaluateFlag('no_constraints', {});
      
      expect(eval1.enabled).toBe(true);
      expect(eval2.enabled).toBe(true);
      expect(eval3.enabled).toBe(true);
    });

    it('should handle empty arrays as no constraints', () => {
      const flag = {
        name: 'Empty Arrays',
        key: 'empty_arrays',
        enabled: true,
        environments: [],
        users: []
      };

      featureFlagManager.createFlag(flag);
      
      const evaluation = featureFlagManager.evaluateFlag('empty_arrays', { userId: 'test' });
      expect(evaluation.enabled).toBe(true);
    });

    it('should handle zero percentage as always disabled', () => {
      const flag = {
        name: 'Zero Percent',
        key: 'zero_percent',
        enabled: true,
        percentage: 0
      };

      featureFlagManager.createFlag(flag);
      
      const evaluation = featureFlagManager.evaluateFlag('zero_percent', { userId: 'test' });
      expect(evaluation.enabled).toBe(false);
      expect(evaluation.reason).toContain('percentage rollout (0%)');
    });

    it('should handle 100 percentage as always enabled', () => {
      const flag = {
        name: 'Full Percent',
        key: 'full_percent',
        enabled: true,
        percentage: 100
      };

      featureFlagManager.createFlag(flag);
      
      const evaluation = featureFlagManager.evaluateFlag('full_percent', { userId: 'test' });
      expect(evaluation.enabled).toBe(true);
      expect(evaluation.reason).toContain('percentage rollout (100%)');
    });
  });
});