import { GitOperations } from '../../utils/git';
import { simpleGit } from 'simple-git';

// Mock simple-git
jest.mock('simple-git', () => ({
  simpleGit: jest.fn()
}));

describe('GitOperations', () => {
  let gitOps: GitOperations;
  let mockGit: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGit = {
      checkIsRepo: jest.fn(),
      status: jest.fn(),
      branch: jest.fn(),
      add: jest.fn(),
      commit: jest.fn(),
    };
    (simpleGit as jest.Mock).mockReturnValue(mockGit);
    gitOps = new GitOperations('/test/repo');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getGitInfo', () => {
    it('should return git info when in a repository', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.status.mockResolvedValue({
        modified: ['file1.ts'],
        created: ['file2.ts'],
        deleted: [],
        staged: ['file1.ts'],
        ahead: 1,
        behind: 0,
      });
      mockGit.branch.mockResolvedValue({ current: 'main' });

      const result = await gitOps.getGitInfo();

      expect(result.isGitRepo).toBe(true);
      expect(result.branch).toBe('main');
      expect(result.status).toContain('modified');
      expect(result.status).toContain('file1.ts');
    });

    it('should handle non-git directories gracefully', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('Not a git repository'));

      const result = await gitOps.getGitInfo();

      expect(result.isGitRepo).toBe(false);
      expect(result.branch).toBe('none');
      expect(result.status).toBe('Not a git repository');
    });

    it('should handle git errors gracefully', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.status.mockRejectedValue(new Error('Git command failed'));

      const result = await gitOps.getGitInfo();

      expect(result.isGitRepo).toBe(false);
      expect(result.branch).toBe('error');
      expect(result.status).toContain('Git error');
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      mockGit.branch.mockResolvedValue({ current: 'feature/test' });

      const branch = await gitOps.getCurrentBranch();

      expect(branch).toBe('feature/test');
    });

    it('should return null when branch cannot be determined', async () => {
      mockGit.branch.mockRejectedValue(new Error('Not a git repository'));

      const branch = await gitOps.getCurrentBranch();

      expect(branch).toBeNull();
    });

    it('should handle empty branch response', async () => {
      // Mock fs.existsSync to prevent fallback to .git/HEAD
      const originalExistsSync = require('fs').existsSync;
      require('fs').existsSync = jest.fn().mockReturnValue(false);
      
      mockGit.branch.mockResolvedValue({ current: '' });

      const branch = await gitOps.getCurrentBranch();
      
      // Restore original
      require('fs').existsSync = originalExistsSync;
      
      // Empty string should return null
      expect(branch).toBeNull();
    });
  });

  describe('safeCommit', () => {
    it('should successfully commit changes', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.status.mockResolvedValue({ files: ['file1.ts'] });
      mockGit.add.mockResolvedValue(undefined);
      mockGit.commit.mockResolvedValue({ commit: 'abc123' });

      const result = await gitOps.safeCommit('Test commit');

      expect(result.success).toBe(true);
      expect(result.commit).toBe('abc123');
      expect(result.error).toBeUndefined();
      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).toHaveBeenCalledWith('Test commit');
    });

    it('should handle non-git directories', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('Not a git repository'));

      const result = await gitOps.safeCommit('Test commit');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not a git repository');
      expect(mockGit.commit).not.toHaveBeenCalled();
    });

    it('should handle no changes to commit', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.status.mockResolvedValue({ files: [] });

      const result = await gitOps.safeCommit('Test commit');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No changes to commit');
      expect(mockGit.commit).not.toHaveBeenCalled();
    });

    it('should handle commit failures', async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.status.mockResolvedValue({ files: ['file1.ts'] });
      mockGit.add.mockResolvedValue(undefined);
      mockGit.commit.mockRejectedValue(new Error('Commit failed'));

      const result = await gitOps.safeCommit('Test commit');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Commit failed');
    });
  });
});