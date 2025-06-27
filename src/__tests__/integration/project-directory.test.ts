import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { simpleGit } from 'simple-git';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

describe('Project Directory Feature Tests', () => {
  let tempProjectPath: string;
  let tempDbPath: string;
  let db: any;

  beforeEach(async () => {
    // Create a temporary project directory with git repo
    tempProjectPath = path.join(os.tmpdir(), `test-project-${Date.now()}`);
    fs.mkdirSync(tempProjectPath, { recursive: true });

    // Initialize git repo in the temp project
    const git = simpleGit(tempProjectPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Create initial commit
    fs.writeFileSync(path.join(tempProjectPath, 'README.md'), '# Test Project');
    await git.add('.');
    await git.commit('Initial commit');

    // Create test database
    tempDbPath = path.join(os.tmpdir(), `test-db-${Date.now()}.db`);
    db = new Database(tempDbPath);

    // Initialize database schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        branch TEXT,
        parent_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS context_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT,
        priority TEXT DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        UNIQUE(session_id, key)
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        git_status TEXT,
        git_branch TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS checkpoint_items (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL,
        context_item_id TEXT NOT NULL,
        FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id),
        FOREIGN KEY (context_item_id) REFERENCES context_items(id)
      );
    `);
  });

  afterEach(() => {
    // Clean up
    db.close();
    try {
      fs.unlinkSync(tempDbPath);
      fs.rmSync(tempProjectPath, { recursive: true, force: true });
    } catch (_e) {
      // Ignore
    }
  });

  describe('Git operations with project directory', () => {
    it('should detect git repository in project directory', async () => {
      const git = simpleGit(tempProjectPath);
      const status = await git.status();
      const branch = await git.branch();

      expect(branch.current).toBeTruthy();
      expect(status.isClean()).toBe(true);
    });

    it('should capture git status for checkpoint', async () => {
      // Create session
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name, branch) VALUES (?, ?, ?)').run(
        sessionId,
        'Test Session',
        'master'
      );

      // Make changes in repo
      fs.writeFileSync(path.join(tempProjectPath, 'new-file.txt'), 'new content');

      // Get git status
      const git = simpleGit(tempProjectPath);
      const status = await git.status();
      const branch = await git.branch();

      const gitStatus = JSON.stringify({
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        staged: status.staged,
        not_added: status.not_added,
        ahead: status.ahead,
        behind: status.behind,
      });

      // Create checkpoint with git status
      const checkpointId = uuidv4();
      db.prepare(
        `
        INSERT INTO checkpoints (id, session_id, name, git_status, git_branch)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(checkpointId, sessionId, 'Test Checkpoint', gitStatus, branch.current);

      // Verify checkpoint
      const checkpoint = db
        .prepare('SELECT * FROM checkpoints WHERE id = ?')
        .get(checkpointId) as any;
      expect(checkpoint.git_branch).toBe(branch.current);

      const savedStatus = JSON.parse(checkpoint.git_status);
      expect(savedStatus.not_added).toContain('new-file.txt');
    });

    it('should handle git commit with context save', async () => {
      const sessionId = uuidv4();
      db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(sessionId, 'Test Session');

      // Add context items
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value, category, priority)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), sessionId, 'current_task', 'Test git integration', 'task', 'high');

      // Make changes and commit
      fs.writeFileSync(path.join(tempProjectPath, 'test.txt'), 'test content');
      const git = simpleGit(tempProjectPath);
      await git.add('.');
      const _commitResult = await git.commit('Test commit');

      // Save commit info as context
      const timestamp = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO context_items (id, session_id, key, value, category)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(uuidv4(), sessionId, `commit_${timestamp}`, 'Test commit', 'git');

      // Create checkpoint for the commit
      const gitStatus = await git.status();
      const gitBranch = await git.branch();

      const checkpointId = uuidv4();
      db.prepare(
        `
        INSERT INTO checkpoints (id, session_id, name, description, git_status, git_branch)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        checkpointId,
        sessionId,
        `git-commit-${timestamp}`,
        `Git commit: Test commit`,
        JSON.stringify(gitStatus),
        gitBranch.current
      );

      // Link context items to checkpoint
      const contextItems = db
        .prepare('SELECT id FROM context_items WHERE session_id = ?')
        .all(sessionId);
      contextItems.forEach((item: any) => {
        db.prepare(
          `
          INSERT INTO checkpoint_items (id, checkpoint_id, context_item_id)
          VALUES (?, ?, ?)
        `
        ).run(uuidv4(), checkpointId, item.id);
      });

      // Verify
      const checkpoint = db
        .prepare('SELECT * FROM checkpoints WHERE id = ?')
        .get(checkpointId) as any;
      expect(checkpoint.name).toContain('git-commit-');
      expect(checkpoint.git_branch).toBeTruthy();

      const linkedItems = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM checkpoint_items WHERE checkpoint_id = ?
      `
        )
        .get(checkpointId) as any;
      expect(linkedItems.count).toBeGreaterThan(0);
    });
  });

  describe('Non-git directory handling', () => {
    it('should handle directory without git gracefully', async () => {
      const nonGitPath = path.join(os.tmpdir(), `non-git-${Date.now()}`);
      fs.mkdirSync(nonGitPath, { recursive: true });

      try {
        const git = simpleGit(nonGitPath);
        let isGitRepo = true;
        let gitError = '';

        try {
          await git.status();
        } catch (error: any) {
          isGitRepo = false;
          gitError = error.message;
        }

        expect(isGitRepo).toBe(false);
        expect(gitError).toContain('not a git repository');
      } finally {
        fs.rmSync(nonGitPath, { recursive: true, force: true });
      }
    });
  });

  describe('Project directory with special characters', () => {
    it('should handle paths with spaces', async () => {
      const pathWithSpaces = path.join(os.tmpdir(), `test project ${Date.now()}`);
      fs.mkdirSync(pathWithSpaces, { recursive: true });

      const git = simpleGit(pathWithSpaces);
      await git.init();
      
      // Configure git for this test to avoid CI failures
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');

      try {
        fs.writeFileSync(path.join(pathWithSpaces, 'test.txt'), 'content');
        await git.add('.');
        await git.commit('Initial commit');

        const status = await git.status();
        expect(status.isClean()).toBe(true);
      } finally {
        fs.rmSync(pathWithSpaces, { recursive: true, force: true });
      }
    });
  });

  describe('Session and project directory integration', () => {
    it('should store git branch with session', async () => {
      const git = simpleGit(tempProjectPath);
      const branch = await git.branch();

      const sessionId = uuidv4();
      db.prepare(
        `
        INSERT INTO sessions (id, name, description, branch)
        VALUES (?, ?, ?, ?)
      `
      ).run(sessionId, 'Feature Development', 'Working on new feature', branch.current);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
      expect(session.branch).toBe(branch.current);
    });

    it('should update session when switching branches', async () => {
      const git = simpleGit(tempProjectPath);

      // Create and switch to new branch
      await git.checkoutLocalBranch('feature-branch');
      const newBranch = await git.branch();

      const sessionId = uuidv4();
      db.prepare(
        `
        INSERT INTO sessions (id, name, branch)
        VALUES (?, ?, ?)
      `
      ).run(sessionId, 'Feature Work', newBranch.current);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
      expect(session.branch).toBe('feature-branch');
    });
  });
});
