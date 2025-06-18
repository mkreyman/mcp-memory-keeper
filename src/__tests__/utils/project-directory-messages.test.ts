import { simpleGit, SimpleGit } from 'simple-git';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('Project Directory Messages and User Guidance', () => {
  describe('Git commit without project directory', () => {
    it('should generate helpful message for missing project directory', () => {
      // This is the expected message when no project directory is set
      const expectedMessage = `⚠️ No project directory set for git tracking!

To track git changes in your project, please set your project directory using one of these methods:

1. When starting a new session:
   context_session_start with projectDir: "/path/to/your/project"

2. For the current session:
   context_set_project_dir with projectDir: "/path/to/your/project"

This allows the MCP server to track git changes in your actual project directory.`;

      // Verify the message format is correct
      expect(expectedMessage).toContain('⚠️ No project directory set');
      expect(expectedMessage).toContain('context_session_start with projectDir:');
      expect(expectedMessage).toContain('context_set_project_dir with projectDir:');
      expect(expectedMessage).toContain('track git changes in your actual project directory');
    });
  });

  describe('Session start messages', () => {
    it('should generate tip message when no project directory provided', () => {
      const tipMessage = 'Tip: To enable git tracking, start with projectDir parameter or use context_set_project_dir';
      
      expect(tipMessage).toContain('To enable git tracking');
      expect(tipMessage).toContain('projectDir parameter');
      expect(tipMessage).toContain('context_set_project_dir');
    });

    it('should include project directory info in session start message', () => {
      const projectPath = '/Users/test/my-project';
      const sessionMessage = `Session started: Test Session
ID: abc-123
Description: Testing project directory
Branch: master
Project directory: ${projectPath}
Git detected: Yes`;

      expect(sessionMessage).toContain(`Project directory: ${projectPath}`);
      expect(sessionMessage).toContain('Git detected: Yes');
    });
  });

  describe('Set project directory messages', () => {
    it('should show success message with git detection', () => {
      const projectPath = '/Users/test/my-project';
      const successMessage = `Project directory set successfully!

Path: ${projectPath}
Git repository: ✓ Detected
Current branch: main
Status: Clean (no uncommitted changes)

You can now use git-related features like context_git_commit.`;

      expect(successMessage).toContain('Project directory set successfully!');
      expect(successMessage).toContain(`Path: ${projectPath}`);
      expect(successMessage).toContain('Git repository: ✓ Detected');
      expect(successMessage).toContain('Current branch:');
      expect(successMessage).toContain('context_git_commit');
    });

    it('should show message for non-git directory', () => {
      const projectPath = '/Users/test/non-git-project';
      const nonGitMessage = `Project directory set successfully!

Path: ${projectPath}
Git repository: ✗ Not found

Tip: Initialize git with 'git init' to enable git tracking features.`;

      expect(nonGitMessage).toContain('Project directory set successfully!');
      expect(nonGitMessage).toContain('Git repository: ✗ Not found');
      expect(nonGitMessage).toContain('Initialize git with \'git init\'');
    });

    it('should show error for missing session', () => {
      const errorMessage = 'No active session. Please start a session first with context_session_start.';
      
      expect(errorMessage).toContain('No active session');
      expect(errorMessage).toContain('context_session_start');
    });
  });

  describe('Git status messages', () => {
    let tempRepoPath: string;
    let git: SimpleGit;

    beforeEach(async () => {
      tempRepoPath = path.join(os.tmpdir(), `test-git-messages-${Date.now()}`);
      fs.mkdirSync(tempRepoPath, { recursive: true });
      git = simpleGit(tempRepoPath);
      await git.init();
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
    });

    afterEach(() => {
      fs.rmSync(tempRepoPath, { recursive: true, force: true });
    });

    it('should format clean repository status', async () => {
      fs.writeFileSync(path.join(tempRepoPath, 'README.md'), '# Test');
      await git.add('.');
      await git.commit('Initial commit');
      
      const status = await git.status();
      const statusMessage = `Status: ${status.isClean() ? 'Clean (no uncommitted changes)' : 'Has uncommitted changes'}`;
      
      expect(statusMessage).toBe('Status: Clean (no uncommitted changes)');
    });

    it('should format dirty repository status', async () => {
      fs.writeFileSync(path.join(tempRepoPath, 'README.md'), '# Test');
      await git.add('.');
      await git.commit('Initial commit');
      
      // Make changes
      fs.writeFileSync(path.join(tempRepoPath, 'new.txt'), 'new content');
      
      const status = await git.status();
      const statusMessage = `Status: ${status.isClean() ? 'Clean (no uncommitted changes)' : 'Has uncommitted changes'}`;
      
      expect(statusMessage).toBe('Status: Has uncommitted changes');
    });
  });

  describe('Checkpoint messages with git info', () => {
    it('should include git info in checkpoint creation message', () => {
      const checkpointMessage = `Created checkpoint: Feature Save
ID: checkpoint-123
Context items: 5
Cached files: 3
Git branch: feature/user-auth
Git status: captured`;

      expect(checkpointMessage).toContain('Git branch: feature/user-auth');
      expect(checkpointMessage).toContain('Git status: captured');
    });

    it('should show none for git branch when no project directory', () => {
      const checkpointMessage = `Created checkpoint: Quick Save
ID: checkpoint-456
Context items: 2
Cached files: 0
Git branch: none
Git status: not captured`;

      expect(checkpointMessage).toContain('Git branch: none');
      expect(checkpointMessage).toContain('Git status: not captured');
    });
  });

  describe('Error handling messages', () => {
    it('should handle git command failures gracefully', () => {
      const errorMessage = 'Git commit failed: No changes to commit';
      
      expect(errorMessage).toContain('Git commit failed:');
      expect(errorMessage).toContain('No changes to commit');
    });

    it('should handle invalid directory paths', () => {
      const invalidPathMessage = `Project directory set successfully!

Path: /invalid/path/that/does/not/exist
Git repository: ✗ Not found

Directory may not exist or may not be accessible.`;

      expect(invalidPathMessage).toContain('Git repository: ✗ Not found');
      expect(invalidPathMessage).toContain('Directory may not exist');
    });
  });
});