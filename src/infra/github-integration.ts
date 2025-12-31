/**
 * AIDOS GitHub Integration
 *
 * GitHub PR作成・管理のための統合モジュール
 * gh CLIを使用してPR作成、ブランチ管理、CI監視を行う
 */

import { EventEmitter } from 'node:events';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ========================================
// Types
// ========================================

export interface PRCreateOptions {
  title: string;
  body: string;
  base?: string;
  draft?: boolean;
  labels?: string[];
}

export interface PRInfo {
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
  checks: PRCheck[];
}

export interface PRCheck {
  name: string;
  status: 'pending' | 'success' | 'failure';
  conclusion?: string;
}

export interface BranchInfo {
  name: string;
  exists: boolean;
  isRemote: boolean;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

export interface GitHubIntegrationOptions {
  defaultBase?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class GitHubIntegrationError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'GitHubIntegrationError';
  }
}

// ========================================
// GitHub Integration Class
// ========================================

export class GitHubIntegration extends EventEmitter {
  private defaultBase: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(options: GitHubIntegrationOptions = {}) {
    super();
    this.defaultBase = options.defaultBase ?? 'main';
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
  }

  // ========================================
  // Initialization & Validation
  // ========================================

  /**
   * gh CLIがインストールされているか確認
   */
  async checkGhInstalled(): Promise<boolean> {
    try {
      await this.execCommand('gh --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * gh CLIが認証済みか確認
   */
  async checkGhAuthenticated(): Promise<boolean> {
    try {
      await this.execCommand('gh auth status');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 初期化チェック（gh CLIのインストールと認証確認）
   */
  async initialize(): Promise<void> {
    const isInstalled = await this.checkGhInstalled();
    if (!isInstalled) {
      throw new GitHubIntegrationError(
        'gh CLI is not installed. Please install it: https://cli.github.com/',
        'GH_NOT_INSTALLED',
        false
      );
    }

    const isAuthenticated = await this.checkGhAuthenticated();
    if (!isAuthenticated) {
      throw new GitHubIntegrationError(
        'gh CLI is not authenticated. Please run: gh auth login',
        'GH_NOT_AUTHENTICATED',
        false
      );
    }
  }

  /**
   * Gitリポジトリ内にいるか確認
   */
  async isInGitRepo(): Promise<boolean> {
    try {
      await this.execCommand('git rev-parse --git-dir');
      return true;
    } catch {
      return false;
    }
  }

  // ========================================
  // Branch Management
  // ========================================

  /**
   * 新しいブランチを作成
   */
  async createBranch(name: string): Promise<void> {
    const exists = await this.branchExists(name);
    if (exists) {
      throw new GitHubIntegrationError(
        `Branch '${name}' already exists`,
        'BRANCH_EXISTS',
        true
      );
    }

    await this.execCommand(`git checkout -b ${this.escapeShell(name)}`);
    this.emit('branch:created', { name });
  }

  /**
   * フィーチャーブランチを作成（AIDOS用命名規則）
   */
  async createFeatureBranch(taskId: string): Promise<string> {
    const branchName = `feature/aidos-${taskId}`;
    await this.createBranch(branchName);
    return branchName;
  }

  /**
   * ブランチが存在するか確認
   */
  async branchExists(name: string): Promise<boolean> {
    try {
      await this.execCommand(`git rev-parse --verify ${this.escapeShell(name)}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * リモートブランチが存在するか確認
   */
  async remoteBranchExists(name: string): Promise<boolean> {
    try {
      await this.execCommand(`git ls-remote --heads origin ${this.escapeShell(name)}`);
      const result = await this.execCommand(`git ls-remote --heads origin ${this.escapeShell(name)}`);
      return result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 現在のブランチ名を取得
   */
  async getCurrentBranch(): Promise<string> {
    const result = await this.execCommand('git branch --show-current');
    return result.stdout.trim();
  }

  /**
   * ブランチを切り替え
   */
  async checkoutBranch(name: string): Promise<void> {
    await this.execCommand(`git checkout ${this.escapeShell(name)}`);
  }

  /**
   * ブランチをリモートにプッシュ
   */
  async pushBranch(name?: string, setUpstream: boolean = true): Promise<void> {
    const branch = name ?? await this.getCurrentBranch();
    const upstreamFlag = setUpstream ? '-u' : '';
    await this.execCommand(`git push ${upstreamFlag} origin ${this.escapeShell(branch)}`);
  }

  // ========================================
  // Commit Information
  // ========================================

  /**
   * 最新のコミット情報を取得
   */
  async getLatestCommit(): Promise<CommitInfo> {
    const result = await this.execCommand(
      'git log -1 --format="%H|%s|%an|%aI"'
    );
    const [hash, message, author, dateStr] = result.stdout.trim().split('|');
    return {
      hash,
      message,
      author,
      date: new Date(dateStr),
    };
  }

  /**
   * ベースブランチからの全コミットを取得
   */
  async getCommitsSinceBase(base?: string): Promise<CommitInfo[]> {
    const baseBranch = base ?? this.defaultBase;
    try {
      const result = await this.execCommand(
        `git log ${this.escapeShell(baseBranch)}..HEAD --format="%H|%s|%an|%aI"`
      );

      if (!result.stdout.trim()) {
        return [];
      }

      return result.stdout.trim().split('\n').map(line => {
        const [hash, message, author, dateStr] = line.split('|');
        return {
          hash,
          message,
          author,
          date: new Date(dateStr),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * 変更されたファイル一覧を取得
   */
  async getChangedFiles(base?: string): Promise<string[]> {
    const baseBranch = base ?? this.defaultBase;
    try {
      const result = await this.execCommand(
        `git diff --name-only ${this.escapeShell(baseBranch)}...HEAD`
      );
      return result.stdout.trim().split('\n').filter(f => f.length > 0);
    } catch {
      return [];
    }
  }

  // ========================================
  // PR Creation & Management
  // ========================================

  /**
   * PRを作成
   */
  async createPR(options: PRCreateOptions): Promise<PRInfo> {
    const base = options.base ?? this.defaultBase;
    const currentBranch = await this.getCurrentBranch();

    // ブランチをプッシュ
    await this.pushBranch(currentBranch);

    // PRコマンドを構築
    const args: string[] = [
      'gh pr create',
      `--base ${this.escapeShell(base)}`,
      `--title ${this.escapeShell(options.title)}`,
      `--body ${this.escapeShell(options.body)}`,
    ];

    if (options.draft) {
      args.push('--draft');
    }

    if (options.labels && options.labels.length > 0) {
      args.push(`--label ${options.labels.map(l => this.escapeShell(l)).join(',')}`);
    }

    const result = await this.execCommand(args.join(' '));
    const url = result.stdout.trim();
    const prNumber = this.extractPRNumber(url);

    const prInfo = await this.getPRStatus(prNumber);
    this.emit('pr:created', prInfo);

    return prInfo;
  }

  /**
   * PRのステータスを取得
   */
  async getPRStatus(prNumber: number): Promise<PRInfo> {
    const result = await this.execCommand(
      `gh pr view ${prNumber} --json number,url,state,statusCheckRollup`
    );

    const data = JSON.parse(result.stdout);
    const checks = this.parseChecks(data.statusCheckRollup || []);

    return {
      number: data.number,
      url: data.url,
      state: data.state.toLowerCase() as 'open' | 'closed' | 'merged',
      checks,
    };
  }

  /**
   * CIの完了を待機
   */
  async waitForCI(prNumber: number, timeoutMs?: number): Promise<boolean> {
    const timeout = timeoutMs ?? 600000; // デフォルト10分
    const startTime = Date.now();
    const pollInterval = 10000; // 10秒間隔

    this.emit('ci:pending', { prNumber });

    while (Date.now() - startTime < timeout) {
      const prInfo = await this.getPRStatus(prNumber);

      // すべてのチェックを確認
      const allCompleted = prInfo.checks.every(
        check => check.status !== 'pending'
      );

      if (allCompleted) {
        const allPassed = prInfo.checks.every(
          check => check.status === 'success'
        );

        this.emit('ci:completed', {
          prNumber,
          success: allPassed,
          checks: prInfo.checks,
        });

        return allPassed;
      }

      await this.sleep(pollInterval);
    }

    this.emit('ci:completed', {
      prNumber,
      success: false,
      error: 'CI timeout',
    });

    return false;
  }

  /**
   * PRにコメントを追加
   */
  async addPRComment(prNumber: number, body: string): Promise<void> {
    await this.execCommand(
      `gh pr comment ${prNumber} --body ${this.escapeShell(body)}`
    );
    this.emit('pr:updated', { prNumber, action: 'comment_added' });
  }

  /**
   * PRをマージ
   */
  async mergePR(
    prNumber: number,
    options: { squash?: boolean; delete_branch?: boolean } = {}
  ): Promise<void> {
    const args = ['gh pr merge', String(prNumber)];

    if (options.squash) {
      args.push('--squash');
    } else {
      args.push('--merge');
    }

    if (options.delete_branch) {
      args.push('--delete-branch');
    }

    await this.execCommand(args.join(' '));
    this.emit('pr:updated', { prNumber, action: 'merged' });
  }

  // ========================================
  // PR Body Generation
  // ========================================

  /**
   * PRのbodyを自動生成
   */
  async generatePRBody(taskId: string, testResults?: string): Promise<string> {
    const commits = await this.getCommitsSinceBase();
    const changedFiles = await this.getChangedFiles();

    // コミットメッセージからサマリーを生成
    const summary = commits.length > 0
      ? commits.map(c => `- ${c.message}`).join('\n')
      : '- No commits yet';

    // ファイルリストを生成
    const fileList = changedFiles.length > 0
      ? changedFiles.map(f => `- \`${f}\``).join('\n')
      : '- No files changed';

    // テスト結果セクション
    const testSection = testResults
      ? this.formatTestResults(testResults)
      : '_Tests not run yet_';

    const body = `## Summary
${summary}

## Changes
${fileList}

## Test Results
${testSection}

## Checklist
- [ ] Tests pass
- [ ] No lint errors
- [ ] Documentation updated

---
**Task ID**: \`${taskId}\`

:robot: Generated by AIDOS`;

    return body;
  }

  /**
   * コミットメッセージからPRタイトルを自動生成
   */
  async generatePRTitle(): Promise<string> {
    const commits = await this.getCommitsSinceBase();

    if (commits.length === 0) {
      return 'WIP: No commits yet';
    }

    if (commits.length === 1) {
      return commits[0].message;
    }

    // 複数コミットの場合は最初のコミットを基に
    const firstCommit = commits[commits.length - 1]; // 時系列で最初
    const prefix = this.extractCommitPrefix(firstCommit.message);

    return prefix
      ? `${prefix}: Multiple changes`
      : `Update: ${commits.length} changes`;
  }

  // ========================================
  // Helper Methods
  // ========================================

  private async execCommand(
    command: string
  ): Promise<{ stdout: string; stderr: string }> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const result = await execAsync(command, {
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        });
        return result;
      } catch (error) {
        lastError = error as Error;

        // リトライ可能なエラーの場合のみリトライ
        if (this.isRetryableError(error)) {
          await this.sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('rate limit')
      );
    }
    return false;
  }

  private escapeShell(str: string): string {
    // シングルクォートでエスケープ
    return `'${str.replace(/'/g, "'\\''")}'`;
  }

  private extractPRNumber(url: string): number {
    const match = url.match(/\/pull\/(\d+)/);
    if (!match) {
      throw new GitHubIntegrationError(
        `Could not extract PR number from URL: ${url}`,
        'INVALID_PR_URL',
        false
      );
    }
    return parseInt(match[1], 10);
  }

  private parseChecks(statusCheckRollup: unknown[]): PRCheck[] {
    if (!Array.isArray(statusCheckRollup)) {
      return [];
    }

    return statusCheckRollup.map((item: unknown) => {
      const check = item as Record<string, unknown>;
      const state = String(check.state || check.status || '').toLowerCase();
      let status: PRCheck['status'];

      if (state === 'success' || state === 'completed') {
        status = 'success';
      } else if (state === 'failure' || state === 'failed' || state === 'error') {
        status = 'failure';
      } else {
        status = 'pending';
      }

      return {
        name: String(check.name || check.context || 'Unknown'),
        status,
        conclusion: check.conclusion ? String(check.conclusion) : undefined,
      };
    });
  }

  private formatTestResults(testResults: string): string {
    // テスト結果をマークダウンコードブロックでラップ
    const lines = testResults.split('\n');
    const maxLines = 50;

    if (lines.length > maxLines) {
      const truncated = lines.slice(0, maxLines).join('\n');
      return `\`\`\`\n${truncated}\n... (truncated)\n\`\`\``;
    }

    return `\`\`\`\n${testResults}\n\`\`\``;
  }

  private extractCommitPrefix(message: string): string | null {
    // 一般的なコミットプレフィックスを抽出
    const prefixPatterns = [
      /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?:/i,
      /^(add|update|remove|fix|refactor|improve|implement):/i,
    ];

    for (const pattern of prefixPatterns) {
      const match = message.match(pattern);
      if (match) {
        return match[1].toLowerCase();
      }
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ========================================
// Singleton Instance
// ========================================

let integrationInstance: GitHubIntegration | null = null;

export function getGitHubIntegration(
  options?: GitHubIntegrationOptions
): GitHubIntegration {
  if (!integrationInstance) {
    integrationInstance = new GitHubIntegration(options);
  }
  return integrationInstance;
}

export function resetGitHubIntegration(): void {
  if (integrationInstance) {
    integrationInstance.removeAllListeners();
    integrationInstance = null;
  }
}
