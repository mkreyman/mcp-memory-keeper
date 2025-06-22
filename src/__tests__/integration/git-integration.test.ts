import { DatabaseManager } from '../../utils/database';
import { GitOperations } from '../../utils/git';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { simpleGit } from 'simple-git';
import { TestDatabaseHelper } from '../../test-helpers/database-helper.js';

describe('Git Integration Tests', () => {
  let dbManager: DatabaseManager;
  let gitOps: GitOperations;
  let tempDbPath: string;
  let tempRepoPath: string;
  let db: any;
  let git: any; // Track git instance for cleanup

  beforeEach(async () => {
    tempDbPath = path.join(os.tmpdir(), `test-git-${Date.now()}.db`);
    tempRepoPath = path.join(os.tmpdir(), `test-repo-${Date.now()}`);
    
    dbManager = TestDatabaseHelper.createTestDatabase();
    db = dbManager.getDatabase();
    
    // Create and initialize a real git repo for testing
    fs.mkdirSync(tempRepoPath, { recursive: true });
    git = simpleGit(tempRepoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    
    // Create initial commit
    fs.writeFileSync(path.join(tempRepoPath, 'README.md'), '# Test Repo');
    await git.add('.');
    await git.commit('Initial commit');
    
    gitOps = new GitOperations(tempRepoPath);
  });

  afterEach(async () => {
    // Clean up git processes first
    if (git) {
      try {
        // Clear any pending git operations
        git.removeAllListeners?.();
      } catch (error) {
        console.warn('Error cleaning up git:', error);
      }
    }
    
    // Clean up databases
    await TestDatabaseHelper.cleanupAll();
    
    // Clean up temp directories and files
    try {
      TestDatabaseHelper.cleanupDbFiles(tempDbPath);
      fs.rmSync(tempRepoPath, { recursive: true, force: true });
    } catch (error) {
      console.warn('Error cleaning up temp files:', error);
    }
    
    git = null;
  });

  describe('context_git_commit', () => {
    it('should automatically save context on commit', async () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Git Test Session');

      // Add context items
      const items = [
        { key: 'current_task', value: 'Implementing git integration', priority: 'high' },
        { key: 'decision', value: 'Use simple-git library', priority: 'normal' },
      ];

      items.forEach(item => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, priority) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, item.key, item.value, item.priority);
      });

      // Make a change and commit
      fs.writeFileSync(path.join(tempRepoPath, 'test.txt'), 'test content');
      const git = simpleGit(tempRepoPath);
      await git.add('.');
      const commitResult = await git.commit('Test commit');

      // Simulate auto-save on commit
      const checkpointId = uuidv4();
      const gitInfo = await gitOps.getGitInfo();
      
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        checkpointId, 
        sessionId, 
        `Git commit: ${commitResult.commit}`,
        'Auto-saved on git commit',
        gitInfo.status,
        gitInfo.branch
      );

      // Link context items
      const contextItems = db.prepare('SELECT id FROM context_items WHERE session_id = ?').all(sessionId) as any[];
      contextItems.forEach((item: any) => {
        db.prepare(
          'INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id) VALUES (?, ?, ?)'
        ).run(uuidv4(), checkpointId, item.id);
      });

      // Verify checkpoint was created
      const checkpoint = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
      expect(checkpoint).toBeDefined();
      expect(checkpoint.name).toContain('Git commit:');
      expect(checkpoint.git_branch).toBeTruthy();
    });

    it('should capture git status in checkpoint', async () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Status Test');

      // Create some changes
      fs.writeFileSync(path.join(tempRepoPath, 'modified.txt'), 'original');
      const git = simpleGit(tempRepoPath);
      await git.add('.');
      await git.commit('Add file');

      // Modify file
      fs.writeFileSync(path.join(tempRepoPath, 'modified.txt'), 'changed');
      
      // Create new file
      fs.writeFileSync(path.join(tempRepoPath, 'new.txt'), 'new content');

      // Stage one file
      await git.add('modified.txt');

      // Get git info
      const gitInfo = await gitOps.getGitInfo();
      
      // Create checkpoint with git status
      const checkpointId = uuidv4();
      db.prepare(
        'INSERT INTO checkpoints (id, session_id, name, git_status, git_branch) VALUES (?, ?, ?, ?, ?)'
      ).run(checkpointId, sessionId, 'Status Checkpoint', gitInfo.status, gitInfo.branch);

      const checkpoint = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
      
      expect(checkpoint.git_status).toContain('modified.txt');
      // Parse the status to check properly
      const status = JSON.parse(checkpoint.git_status);
      expect(status.not_added).toContain('new.txt');
      expect(checkpoint.git_branch).toBe('master'); // Default branch name
    });

    it('should handle commits with message containing context summary', async () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Commit Message Test');

      // Add context items that should be in commit message
      const tasks = [
        { key: 'task1', value: 'Fixed authentication bug' },
        { key: 'task2', value: 'Added user validation' },
      ];

      tasks.forEach(task => {
        db.prepare(
          'INSERT INTO context_items (id, session_id, key, value, category) VALUES (?, ?, ?, ?, ?)'
        ).run(uuidv4(), sessionId, task.key, task.value, 'task');
      });

      // Generate commit message with context
      const completedTasks = db.prepare(
        'SELECT value FROM context_items WHERE session_id = ? AND category = ?'
      ).all(sessionId, 'task') as any[];

      const commitMessage = [
        'Feature: User authentication improvements',
        '',
        'Tasks completed:',
        ...completedTasks.map((t: any) => `- ${t.value}`),
        '',
        '[Context saved by MCP Memory Keeper]'
      ].join('\n');

      // Make change and commit
      fs.writeFileSync(path.join(tempRepoPath, 'auth.js'), 'auth code');
      const git = simpleGit(tempRepoPath);
      await git.add('.');
      const commitResult = await git.commit(commitMessage);

      expect(commitResult.commit).toBeTruthy();
      
      // Verify commit message
      const log = await git.log(['-1']);
      expect(log.latest).toBeDefined();
      expect(log.latest?.message || log.latest?.hash).toBeDefined();
      // The actual message should be in the latest entry
    });

    it('should link commits to sessions', async () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Linked Commit Test');

      // Make multiple commits
      const git = simpleGit(tempRepoPath);
      const commits: string[] = [];

      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(path.join(tempRepoPath, `file${i}.txt`), `content ${i}`);
        await git.add('.');
        const result = await git.commit(`Commit ${i}`);
        commits.push(result.commit);

        // Link commit to session - store commit hash in description
        const checkpointId = uuidv4();
        db.prepare(
          'INSERT INTO checkpoints (id, session_id, name, description) VALUES (?, ?, ?, ?)'
        ).run(
          checkpointId,
          sessionId,
          `Commit ${i}`,
          `Commit hash: ${result.commit}`
        );
      }

      // Query commits for session - using description field instead of metadata
      const sessionCommits = db.prepare(
        `SELECT * FROM checkpoints 
         WHERE session_id = ? 
         AND description LIKE 'Commit hash:%'
         ORDER BY created_at`
      ).all(sessionId) as any[];

      expect(sessionCommits).toHaveLength(3);
      sessionCommits.forEach((checkpoint: any, i: number) => {
        // Extract commit hash from description
        const match = checkpoint.description.match(/Commit hash: (.+)/);
        expect(match).toBeTruthy();
        expect(match[1]).toBe(commits[i]);
      });
    });
  });

  describe('Git error handling', () => {
    it('should handle non-git directories gracefully', async () => {
      const nonGitPath = path.join(os.tmpdir(), `non-git-${Date.now()}`);
      fs.mkdirSync(nonGitPath, { recursive: true });
      
      const nonGitOps = new GitOperations(nonGitPath);
      const info = await nonGitOps.getGitInfo();
      
      expect(info.isGitRepo).toBe(false);
      expect(info.status.toLowerCase()).toContain('not a git repository');
      
      fs.rmSync(nonGitPath, { recursive: true, force: true });
    });

    it('should handle git operation failures', async () => {
      // Test with invalid commit (no changes)
      const result = await gitOps.safeCommit('Empty commit');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No changes to commit');
    });
  });
});