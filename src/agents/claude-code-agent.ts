/**
 * Claude Code Agent
 *
 * Claude Codeプロセスをラップし、IAgentインターフェースを実装
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import {
  IAgent,
  AgentContext,
  AgentInstruction,
  AgentExecutionResult,
  AgentState,
  AgentArtifact,
  AgentMetrics,
  isValidTransition,
} from './agent-types.js';
import { ClaudeOutputParser } from './claude-output-parser.js';
import { Agent, AgentRole, AgentStatus, Task, DecomposedTask } from '../types.js';

// ========================================
// Types
// ========================================

export interface ClaudeCodeAgentOptions {
  id?: string;
  role: AgentRole;
  mission: string;
  parentId?: string;
  workingDirectory?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  timeoutMs?: number;
  maxBudgetUsd?: number;
}

// ========================================
// Claude Code Agent
// ========================================

export class ClaudeCodeAgent extends EventEmitter implements IAgent {
  readonly id: string;
  readonly role: AgentRole;
  readonly mission: string;
  readonly parentId?: string;

  private _status: AgentStatus = 'idle';
  private process: ChildProcess | null = null;
  private parser: ClaudeOutputParser;
  private context: AgentContext | null = null;
  private currentTask: Task | null = null;
  private completedTasks: Task[] = [];
  private artifacts: AgentArtifact[] = [];
  private metrics: AgentMetrics = {
    totalTokensUsed: 0,
    totalExecutionTimeMs: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    childrenSpawned: 0,
  };

  private readonly options: ClaudeCodeAgentOptions;

  constructor(options: ClaudeCodeAgentOptions) {
    super();
    this.id = options.id || `claude-${randomUUID().slice(0, 8)}`;
    this.role = options.role;
    this.mission = options.mission;
    this.parentId = options.parentId;
    this.options = options;
    this.parser = new ClaudeOutputParser();

    this.setupParserEvents();
  }

  get status(): AgentStatus {
    return this._status;
  }

  /**
   * パーサーイベントをセットアップ
   */
  private setupParserEvents(): void {
    this.parser.on('thinking', ({ content }) => {
      this.emit('agent:thinking', {
        agentId: this.id,
        timestamp: new Date(),
        currentTask: content.slice(0, 100),
        progress: this.parser.getProgress(),
      });
    });

    this.parser.on('tool_use', ({ name, input }) => {
      this.emit('agent:executing', {
        agentId: this.id,
        timestamp: new Date(),
        action: name,
        details: JSON.stringify(input).slice(0, 200),
      });
    });

    this.parser.on('text', ({ content }) => {
      this.emit('agent:output', {
        agentId: this.id,
        timestamp: new Date(),
        content,
      });
    });

    this.parser.on('result', ({ success, costUsd, durationMs }) => {
      if (durationMs) {
        this.metrics.totalExecutionTimeMs += durationMs;
      }
      // トークン使用量は概算（$0.003/1K input, $0.015/1K output）
      if (costUsd) {
        this.metrics.totalTokensUsed += Math.round(costUsd / 0.01 * 1000);
      }
    });

    this.parser.on('error', ({ message }) => {
      this.emit('agent:error', {
        agentId: this.id,
        timestamp: new Date(),
        error: new Error(message),
        recoverable: true,
      });
    });
  }

  /**
   * 状態を変更
   */
  private setStatus(newStatus: AgentStatus): void {
    if (this._status === newStatus) return;

    if (!isValidTransition(this._status, newStatus)) {
      // 強制遷移を許可（エラーリカバリ等）
      console.warn(`Invalid transition: ${this._status} -> ${newStatus}`);
    }

    const previousStatus = this._status;
    this._status = newStatus;

    this.emit('agent:status_changed', {
      agentId: this.id,
      previousStatus,
      newStatus,
      timestamp: new Date(),
    });
  }

  /**
   * エージェントを初期化
   */
  async initialize(context: AgentContext): Promise<void> {
    this.context = context;
    this.emit('agent:initialized', {
      agentId: this.id,
      timestamp: new Date(),
      role: this.role,
      mission: this.mission,
    });
  }

  /**
   * タスクを実行
   */
  async execute(instruction: AgentInstruction): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    this.setStatus('thinking');
    this.parser.reset();

    try {
      const result = await this.runClaudeCode(instruction.content);

      this.setStatus('done');
      this.metrics.tasksCompleted++;

      return {
        success: true,
        output: result,
        artifacts: this.artifacts,
        tokensUsed: this.metrics.totalTokensUsed,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      this.setStatus('error');
      this.metrics.tasksFailed++;

      return {
        success: false,
        output: '',
        artifacts: [],
        tokensUsed: this.metrics.totalTokensUsed,
        executionTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Claude Codeプロセスを実行
   */
  private runClaudeCode(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs();
      const workingDir = this.options.workingDirectory || this.context?.workingDirectory || process.cwd();

      // APIキーを除外してOAuth認証を使用
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;

      this.process = spawn('claude', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...env,
          ...this.context?.environment,
        },
      });

      let output = '';
      let errorOutput = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.parser.processChunk(chunk);

        // 実行中状態に遷移
        if (this._status === 'thinking') {
          this.setStatus('executing');
        }

        // 進捗イベント発行
        this.emit('agent:progress', {
          agentId: this.id,
          progress: this.parser.getProgress(),
          timestamp: new Date(),
        });
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      this.process.on('close', (code) => {
        this.parser.flush();
        this.process = null;

        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Claude Code exited with code ${code}: ${errorOutput}`));
        }
      });

      this.process.on('error', (error) => {
        this.process = null;
        reject(error);
      });

      // タイムアウト設定
      const timeoutMs = this.options.timeoutMs || 600000; // デフォルト10分
      const timeoutId = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGTERM');
          setTimeout(() => {
            if (this.process) {
              this.process.kill('SIGKILL');
            }
          }, 5000);
          reject(new Error(`Timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.process.on('close', () => {
        clearTimeout(timeoutId);
      });

      // プロンプトを送信
      this.process.stdin?.write(prompt);
      this.process.stdin?.end();
    });
  }

  /**
   * Claude Code引数を構築
   */
  private buildArgs(): string[] {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
    ];

    if (this.options.allowedTools && this.options.allowedTools.length > 0) {
      args.push('--allowedTools', this.options.allowedTools.join(','));
    }

    if (this.options.disallowedTools && this.options.disallowedTools.length > 0) {
      args.push('--disallowedTools', this.options.disallowedTools.join(','));
    }

    if (this.options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(this.options.maxBudgetUsd));
    }

    return args;
  }

  /**
   * エージェントを停止
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');

      // 5秒後にSIGKILL
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.process?.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.process = null;
    }

    this.setStatus('idle');
  }

  /**
   * 現在の状態を取得
   */
  getState(): AgentState {
    const agent: Agent = {
      id: this.id,
      sessionId: this.context?.sessionId || '',
      role: this.role,
      mission: this.mission,
      status: this._status,
      parentId: this.parentId ?? null,
      childIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return {
      agent,
      currentTask: this.currentTask,
      pendingTasks: [],
      completedTasks: this.completedTasks,
      artifacts: this.artifacts,
      metrics: this.metrics,
    };
  }

  /**
   * 進捗率を取得
   */
  getProgress(): number {
    return this.parser.getProgress();
  }
}

export default ClaudeCodeAgent;
