import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

export interface GitInfo {
  status: string;
  branch: string;
  isGitRepo: boolean;
}

export class GitOperations {
  private git: SimpleGit;

  constructor(workingDirectory: string = process.cwd()) {
    this.git = simpleGit(workingDirectory);
  }

  async getGitInfo(): Promise<GitInfo> {
    try {
      // Check if we're in a git repository
      const isRepo = await this.isGitRepository();
      if (!isRepo) {
        return {
          status: 'Not a git repository',
          branch: 'none',
          isGitRepo: false,
        };
      }

      // Get status and branch info
      const [status, branch] = await Promise.all([this.git.status(), this.git.branch()]);

      return {
        status: JSON.stringify({
          modified: status.modified,
          created: status.created,
          deleted: status.deleted,
          staged: status.staged,
          not_added: status.not_added, // untracked files
          ahead: status.ahead,
          behind: status.behind,
        }),
        branch: branch.current,
        isGitRepo: true,
      };
    } catch (_error) {
      // Handle any git errors gracefully
      return {
        status: `Git error: ${_error instanceof Error ? _error.message : String(_error)}`,
        branch: 'error',
        isGitRepo: false,
      };
    }
  }

  async getCurrentBranch(): Promise<string | null> {
    try {
      // First try using git command
      const branch = await this.git.branch();
      if (branch.current && branch.current.trim() !== '') {
        return branch.current;
      }

      // Fallback to reading .git/HEAD
      const gitHeadPath = path.join(process.cwd(), '.git', 'HEAD');
      if (fs.existsSync(gitHeadPath)) {
        const headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
        if (headContent.startsWith('ref: refs/heads/')) {
          return headContent.replace('ref: refs/heads/', '');
        }
      }

      return null;
    } catch (_error) {
      return null;
    }
  }

  async safeCommit(
    message: string
  ): Promise<{ success: boolean; commit?: string; error?: string }> {
    try {
      // Check if we're in a git repository
      const isRepo = await this.isGitRepository();
      if (!isRepo) {
        return {
          success: false,
          error: 'Not a git repository',
        };
      }

      // Check if there are changes to commit
      const status = await this.git.status();
      if (status.files.length === 0) {
        return {
          success: false,
          error: 'No changes to commit',
        };
      }

      // Add all changes and commit
      await this.git.add('.');
      const commitResult = await this.git.commit(message);

      return {
        success: true,
        commit: commitResult.commit,
      };
    } catch (_error) {
      return {
        success: false,
        error: _error instanceof Error ? _error.message : String(_error),
      };
    }
  }

  private async isGitRepository(): Promise<boolean> {
    try {
      await this.git.checkIsRepo();
      return true;
    } catch {
      return false;
    }
  }
}
