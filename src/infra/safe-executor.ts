/**
 * AIDOS Safe Executor
 *
 * コマンドの安全な実行を管理するシステム
 * - Allowlist/Denylistによるコマンド制御
 * - サンドボックスモード（作業ディレクトリ制限）
 * - 承認モード（人間による承認）
 * - タイムアウト制御
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
// Types imported from types.js if needed in the future
// import type { AidosError } from '../types.js';

// ========================================
// Types
// ========================================

export interface ExecutorConfig {
  workingDir: string;
  allowedCommands: string[];
  blockedPatterns: RegExp[];
  requireApproval: boolean;
  timeoutMs: number;
  sandboxMode?: boolean;
  logExecutions?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  blocked?: boolean;
  blockedReason?: string;
  timedOut?: boolean;
  durationMs?: number;
}

export interface ExecutionLog {
  id: string;
  command: string;
  result: ExecutionResult;
  timestamp: Date;
  approved?: boolean;
  approvedBy?: string;
}

export type ExecutorEventType =
  | 'command:allowed'
  | 'command:blocked'
  | 'command:executed'
  | 'command:timeout'
  | 'approval:required'
  | 'approval:received';

export interface CommandCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
}

// ========================================
// Default Configuration
// ========================================

/**
 * デフォルトで許可されるコマンド（安全なもの）
 */
export const DEFAULT_ALLOWED_COMMANDS: string[] = [
  // Git - 読み取り系
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git show',
  'git ls-files',
  'git rev-parse',
  'git describe',
  'git remote',
  'git fetch',
  // Git - 書き込み系（比較的安全）
  'git add',
  'git commit',
  'git push',
  'git pull',
  'git checkout',
  'git switch',
  'git merge',
  'git rebase',
  'git stash',
  'git tag',
  // npm/yarn - 読み取り系
  'npm list',
  'npm outdated',
  'npm view',
  'npm audit',
  'npm run test',
  'npm run build',
  'npm run lint',
  'npm test',
  // npm/yarn - 書き込み系
  'npm install',
  'npm ci',
  'npm update',
  'yarn list',
  'yarn outdated',
  'yarn audit',
  'yarn test',
  'yarn build',
  'yarn install',
  // pnpm
  'pnpm list',
  'pnpm test',
  'pnpm build',
  'pnpm install',
  // 一般的なコマンド
  'ls',
  'pwd',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'find',
  'which',
  'echo',
  'date',
  'whoami',
  // 開発ツール
  'tsc',
  'node',
  'npx',
  'tsx',
  'vitest',
  'jest',
  'eslint',
  'prettier',
];

/**
 * デフォルトでブロックされるパターン（危険なもの）
 */
export const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  // 危険な削除コマンド
  /rm\s+-rf?\s+[\/~]/,                    // rm -rf / or rm -rf ~
  /rm\s+-rf?\s+\.\./,                      // rm -rf ..
  /rm\s+-rf?\s+\*/,                        // rm -rf *
  /rm\s+--no-preserve-root/,               // rm --no-preserve-root

  // システムコマンド
  /\bsudo\b/,                              // sudo
  /\bsu\s/,                                // su
  /\bchmod\s+777\b/,                       // chmod 777
  /\bchown\s+-R\s+root/,                   // chown -R root
  /\bchmod\s+\+s\b/,                       // setuid bit

  // シークレット露出
  /\benv\b.*\|\s*grep.*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i,
  /\bprintenv\b.*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i,
  /\bexport\b.*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i,
  /cat\s+.*\.env\b/,                       // cat .env
  /cat\s+.*credentials/i,                  // cat credentials
  /cat\s+.*secret/i,                       // cat secret

  // ネットワーク攻撃
  /\bcurl\b.*(?:http|https):\/\/(?!localhost|127\.0\.0\.1)/,  // curl to external
  /\bwget\b.*(?:http|https):\/\/(?!localhost|127\.0\.0\.1)/,  // wget to external
  /\bnc\b\s+-l/,                           // netcat listen
  /\bncat\b/,                              // ncat
  /\bnetcat\b/,                            // netcat

  // シェル操作
  /\beval\b/,                              // eval
  /\bexec\b/,                              // exec
  />\s*\/dev\/sd[a-z]/,                    // write to disk device
  />\s*\/etc\//,                           // write to /etc
  /mkfs\./,                                // format disk
  /dd\s+if=/,                              // dd command

  // 危険なgitコマンド
  /git\s+push\s+.*--force/,                // git push --force
  /git\s+push\s+.*-f\b/,                   // git push -f
  /git\s+reset\s+--hard/,                  // git reset --hard
  /git\s+clean\s+-fd/,                     // git clean -fd

  // npm危険コマンド
  /npm\s+publish/,                         // npm publish
  /npm\s+unpublish/,                       // npm unpublish
  /npm\s+deprecate/,                       // npm deprecate

  // 暗号化・ランサムウェア関連
  /\bopenssl\b.*enc\s+-e/,                 // openssl encrypt
  /\bgpg\b.*--encrypt/,                    // gpg encrypt

  // プロセス操作
  /\bkill\s+-9/,                           // kill -9
  /\bkillall\b/,                           // killall
  /\bpkill\b/,                             // pkill

  // 履歴操作
  /history\s+-c/,                          // clear history
  />\s*~\/\.bash_history/,                 // overwrite history
];

// ========================================
// Safe Executor Class
// ========================================

export class SafeExecutor extends EventEmitter {
  private config: ExecutorConfig;
  private executionHistory: ExecutionLog[] = [];
  private maxHistorySize = 1000;
  private pendingApprovals: Map<string, {
    command: string;
    resolve: (approved: boolean) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(config: Partial<ExecutorConfig> & { workingDir: string }) {
    super();
    this.config = {
      workingDir: config.workingDir,
      allowedCommands: config.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS,
      blockedPatterns: config.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS,
      requireApproval: config.requireApproval ?? false,
      timeoutMs: config.timeoutMs ?? 30000,
      sandboxMode: config.sandboxMode ?? true,
      logExecutions: config.logExecutions ?? true,
    };
  }

  // ========================================
  // Command Validation
  // ========================================

  /**
   * コマンドが許可されているかチェック
   */
  isAllowed(command: string): CommandCheckResult {
    const normalizedCommand = command.trim();

    // Step 1: ブロックパターンをチェック
    for (const pattern of this.config.blockedPatterns) {
      if (pattern.test(normalizedCommand)) {
        return {
          allowed: false,
          reason: `Command matches blocked pattern: ${pattern.toString()}`,
        };
      }
    }

    // Step 2: サンドボックスモードでパス検証
    if (this.config.sandboxMode) {
      const pathCheck = this.checkPathSafety(normalizedCommand);
      if (!pathCheck.allowed) {
        return pathCheck;
      }
    }

    // Step 3: 許可リストをチェック
    const isInAllowlist = this.checkAllowlist(normalizedCommand);
    if (!isInAllowlist) {
      return {
        allowed: false,
        reason: 'Command not in allowlist',
        requiresApproval: this.config.requireApproval,
      };
    }

    return { allowed: true };
  }

  /**
   * 許可リストにあるかチェック
   */
  private checkAllowlist(command: string): boolean {
    // コマンドの最初の部分（ベースコマンド）を取得
    const baseCommand = this.extractBaseCommand(command);

    for (const allowed of this.config.allowedCommands) {
      // 完全一致または前方一致（スペース区切り）
      if (command === allowed || command.startsWith(allowed + ' ') || baseCommand === allowed) {
        return true;
      }
    }

    return false;
  }

  /**
   * ベースコマンドを抽出
   */
  private extractBaseCommand(command: string): string {
    // パイプやリダイレクトの前までを取得
    const beforePipe = command.split(/[|><;]/)[0].trim();
    // 最初の単語を取得
    const parts = beforePipe.split(/\s+/);
    return parts[0];
  }

  /**
   * パスの安全性をチェック（サンドボックスモード）
   */
  private checkPathSafety(command: string): CommandCheckResult {
    const workingDir = path.resolve(this.config.workingDir);

    // 親ディレクトリへのアクセスを検出
    if (/\.\./.test(command)) {
      // より詳細なチェック：実際のパスを解決
      const pathMatches = command.match(/(?:^|\s)((?:\.\.\/)+\S+)/g);
      if (pathMatches) {
        for (const match of pathMatches) {
          const targetPath = path.resolve(workingDir, match.trim());
          if (!targetPath.startsWith(workingDir)) {
            return {
              allowed: false,
              reason: `Path escapes working directory: ${match.trim()}`,
            };
          }
        }
      }
    }

    // 絶対パスのチェック
    const absolutePaths = command.match(/(?:^|\s)(\/\S+)/g);
    if (absolutePaths) {
      for (const match of absolutePaths) {
        const targetPath = match.trim();
        // 作業ディレクトリ外のパスへのアクセスを禁止
        // ただし、システムバイナリ（/usr/bin など）は許可
        const allowedSystemPaths = [
          '/usr/bin',
          '/usr/local/bin',
          '/bin',
          '/opt/homebrew',
          '/tmp',
        ];
        const isSystemPath = allowedSystemPaths.some(p => targetPath.startsWith(p));
        const isWithinWorkingDir = targetPath.startsWith(workingDir);

        if (!isSystemPath && !isWithinWorkingDir) {
          return {
            allowed: false,
            reason: `Absolute path outside working directory: ${targetPath}`,
          };
        }
      }
    }

    return { allowed: true };
  }

  // ========================================
  // Execution
  // ========================================

  /**
   * コマンドを実行
   */
  async execute(command: string): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Step 1: コマンドをチェック
    const checkResult = this.isAllowed(command);

    if (!checkResult.allowed) {
      this.emit('command:blocked', { command, reason: checkResult.reason });

      const result: ExecutionResult = {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: -1,
        blocked: true,
        blockedReason: checkResult.reason,
      };

      this.logExecution(command, result, false);
      return result;
    }

    this.emit('command:allowed', { command });

    // Step 2: コマンドを実行
    try {
      const result = await this.spawnCommand(command);
      result.durationMs = Date.now() - startTime;

      this.emit('command:executed', { command, result });
      this.logExecution(command, result, false);

      return result;
    } catch (error) {
      const result: ExecutionResult = {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        exitCode: -1,
        durationMs: Date.now() - startTime,
      };

      this.logExecution(command, result, false);
      return result;
    }
  }

  /**
   * 承認付きでコマンドを実行
   */
  async executeWithApproval(command: string): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Step 1: コマンドをチェック（ブロックパターンは承認があっても実行不可）
    for (const pattern of this.config.blockedPatterns) {
      if (pattern.test(command)) {
        const result: ExecutionResult = {
          success: false,
          stdout: '',
          stderr: '',
          exitCode: -1,
          blocked: true,
          blockedReason: `Command matches blocked pattern (cannot be approved): ${pattern.toString()}`,
        };
        this.emit('command:blocked', { command, reason: result.blockedReason });
        return result;
      }
    }

    // Step 2: 承認を要求
    const approvalId = this.generateId();
    this.emit('approval:required', { command, approvalId });

    // 承認待ち
    const approved = await new Promise<boolean>((resolve, reject) => {
      this.pendingApprovals.set(approvalId, { command, resolve, reject });

      // タイムアウト
      setTimeout(() => {
        if (this.pendingApprovals.has(approvalId)) {
          this.pendingApprovals.delete(approvalId);
          resolve(false); // タイムアウトは拒否扱い
        }
      }, this.config.timeoutMs * 2); // 承認は通常のタイムアウトの2倍待つ
    });

    if (!approved) {
      const result: ExecutionResult = {
        success: false,
        stdout: '',
        stderr: 'Approval denied or timed out',
        exitCode: -1,
        blocked: true,
        blockedReason: 'Approval denied',
        durationMs: Date.now() - startTime,
      };
      return result;
    }

    this.emit('approval:received', { command, approvalId, approved: true });

    // Step 3: 承認されたので実行
    const result = await this.spawnCommand(command);
    result.durationMs = Date.now() - startTime;

    this.emit('command:executed', { command, result });
    this.logExecution(command, result, true);

    return result;
  }

  /**
   * 承認を処理
   */
  approve(approvalId: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      return false;
    }

    this.pendingApprovals.delete(approvalId);
    pending.resolve(approved);
    return true;
  }

  /**
   * 子プロセスでコマンドを実行
   */
  private spawnCommand(command: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      // シェルを使って実行（パイプなどをサポート）
      const child: ChildProcess = spawn('sh', ['-c', command], {
        cwd: this.config.workingDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // タイムアウト設定
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');

        // 強制終了
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);

        this.emit('command:timeout', { command, timeoutMs: this.config.timeoutMs });
      }, this.config.timeoutMs);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        resolve({
          success: code === 0 && !killed,
          stdout,
          stderr,
          exitCode: code ?? -1,
          timedOut: killed,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);

        resolve({
          success: false,
          stdout,
          stderr: error.message,
          exitCode: -1,
        });
      });
    });
  }

  // ========================================
  // Logging & History
  // ========================================

  /**
   * 実行をログに記録
   */
  private logExecution(
    command: string,
    result: ExecutionResult,
    approved: boolean
  ): void {
    if (!this.config.logExecutions) return;

    const log: ExecutionLog = {
      id: this.generateId(),
      command,
      result,
      timestamp: new Date(),
      approved,
    };

    this.executionHistory.push(log);

    // 履歴サイズを制限
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }
  }

  /**
   * 実行履歴を取得
   */
  getHistory(options: {
    limit?: number;
    onlyBlocked?: boolean;
    onlyFailed?: boolean;
  } = {}): ExecutionLog[] {
    let history = [...this.executionHistory];

    if (options.onlyBlocked) {
      history = history.filter(log => log.result.blocked);
    }

    if (options.onlyFailed) {
      history = history.filter(log => !log.result.success);
    }

    if (options.limit) {
      history = history.slice(-options.limit);
    }

    return history;
  }

  /**
   * 履歴をクリア
   */
  clearHistory(): void {
    this.executionHistory = [];
  }

  // ========================================
  // Configuration
  // ========================================

  /**
   * 許可コマンドを追加
   */
  addAllowedCommand(command: string): void {
    if (!this.config.allowedCommands.includes(command)) {
      this.config.allowedCommands.push(command);
    }
  }

  /**
   * 許可コマンドを削除
   */
  removeAllowedCommand(command: string): void {
    const index = this.config.allowedCommands.indexOf(command);
    if (index !== -1) {
      this.config.allowedCommands.splice(index, 1);
    }
  }

  /**
   * ブロックパターンを追加
   */
  addBlockedPattern(pattern: RegExp): void {
    this.config.blockedPatterns.push(pattern);
  }

  /**
   * 設定を取得
   */
  getConfig(): Readonly<ExecutorConfig> {
    return { ...this.config };
  }

  /**
   * 設定を更新
   */
  updateConfig(updates: Partial<Omit<ExecutorConfig, 'workingDir'>>): void {
    Object.assign(this.config, updates);
  }

  // ========================================
  // Utility
  // ========================================

  private generateId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * デバッグ情報を取得
   */
  getDebugInfo(): {
    workingDir: string;
    sandboxMode: boolean;
    requireApproval: boolean;
    timeoutMs: number;
    allowedCommandsCount: number;
    blockedPatternsCount: number;
    historySize: number;
    pendingApprovalsCount: number;
  } {
    return {
      workingDir: this.config.workingDir,
      sandboxMode: this.config.sandboxMode ?? true,
      requireApproval: this.config.requireApproval,
      timeoutMs: this.config.timeoutMs,
      allowedCommandsCount: this.config.allowedCommands.length,
      blockedPatternsCount: this.config.blockedPatterns.length,
      historySize: this.executionHistory.length,
      pendingApprovalsCount: this.pendingApprovals.size,
    };
  }
}

// ========================================
// Error Types
// ========================================

export class CommandBlockedError extends Error {
  constructor(
    public command: string,
    public reason: string
  ) {
    super(`Command blocked: ${reason}`);
    this.name = 'CommandBlockedError';
  }
}

export class CommandTimeoutError extends Error {
  constructor(
    public command: string,
    public timeoutMs: number
  ) {
    super(`Command timed out after ${timeoutMs}ms`);
    this.name = 'CommandTimeoutError';
  }
}

export class ApprovalDeniedError extends Error {
  constructor(public command: string) {
    super('Command approval denied');
    this.name = 'ApprovalDeniedError';
  }
}

// ========================================
// Factory Function
// ========================================

/**
 * プリセット設定でSafeExecutorを作成
 */
export function createSafeExecutor(
  workingDir: string,
  preset: 'strict' | 'moderate' | 'permissive' = 'moderate'
): SafeExecutor {
  const baseConfig = { workingDir };

  switch (preset) {
    case 'strict':
      return new SafeExecutor({
        ...baseConfig,
        requireApproval: true,
        sandboxMode: true,
        timeoutMs: 15000,
        // 読み取り系のみ許可
        allowedCommands: DEFAULT_ALLOWED_COMMANDS.filter(cmd =>
          /^(git\s+(status|diff|log|branch|show)|npm\s+(list|audit)|ls|pwd|cat|head|tail|wc|grep|find|which)/.test(cmd)
        ),
      });

    case 'permissive':
      return new SafeExecutor({
        ...baseConfig,
        requireApproval: false,
        sandboxMode: false,
        timeoutMs: 60000,
        allowedCommands: [
          ...DEFAULT_ALLOWED_COMMANDS,
          // 追加の開発コマンド
          'docker',
          'docker-compose',
          'make',
          'cargo',
          'go',
          'python',
          'pip',
        ],
      });

    case 'moderate':
    default:
      return new SafeExecutor({
        ...baseConfig,
        requireApproval: false,
        sandboxMode: true,
        timeoutMs: 30000,
        allowedCommands: DEFAULT_ALLOWED_COMMANDS,
      });
  }
}
