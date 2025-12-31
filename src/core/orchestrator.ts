/**
 * メインオーケストレーター
 *
 * AIDOS全体の制御を担当。タスク分解、エージェント生成、実行フロー管理を統括。
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  Session,
  SessionStatus,
  Task,
  TaskStatus,
  DecomposedTask,
  AidosConfig,
  DEFAULT_CONFIG,
  AidosError,
  BudgetExceededError,
  BusMessage,
  MessageType,
  LogMessagePayload,
  TaskProgressPayload,
} from '../types.js';
import {
  TaskDecomposer,
  DecomposeResult,
  getTaskDecomposer,
} from './task-decomposer.js';
import {
  AgentManager,
  createAgentManager,
} from '../agents/agent-manager.js';
import {
  AgentExecutionResult,
  AgentMetrics,
  AgentTreeNode,
  AgentSummary,
} from '../agents/agent-types.js';

// ========================================
// Types
// ========================================

/**
 * オーケストレーターイベント
 */
export type OrchestratorEvent =
  | 'session:started'
  | 'session:paused'
  | 'session:resumed'
  | 'session:completed'
  | 'session:failed'
  | 'task:scheduled'
  | 'task:started'
  | 'task:progress'
  | 'task:completed'
  | 'task:failed'
  | 'phase:changed'
  | 'log:message'
  | 'intervention:requested'
  | 'budget:warning'
  | 'budget:exceeded';

/**
 * 実行フェーズ
 */
export type ExecutionPhase =
  | 'idle'
  | 'decomposing'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'completed'
  | 'failed';

/**
 * オーケストレーターオプション
 */
export interface OrchestratorOptions {
  useMockDecomposer?: boolean;
  autoStart?: boolean;
  maxRetries?: number;
  budgetWarningThreshold?: number; // 0-1
}

/**
 * セッション統計情報
 */
export interface SessionStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  totalTokensUsed: number;
  elapsedTimeMs: number;
  agentCount: number;
}

/**
 * オーケストレーター状態
 */
export interface OrchestratorState {
  session: Session | null;
  phase: ExecutionPhase;
  tasks: Map<string, Task>;
  decomposedTasks: DecomposedTask[];
  stats: SessionStats;
  agentTree: AgentTreeNode[];
}

// ========================================
// Orchestrator Class
// ========================================

/**
 * メインオーケストレーター
 */
export class Orchestrator extends EventEmitter {
  private config: AidosConfig;
  private options: Required<OrchestratorOptions>;
  private session: Session | null = null;
  private phase: ExecutionPhase = 'idle';
  private tasks: Map<string, Task> = new Map();
  private decomposedTasks: DecomposedTask[] = [];
  private taskQueue: DecomposedTask[] = [];
  private startTime: number = 0;

  private decomposer: TaskDecomposer;
  private agentManager: AgentManager | null = null;

  constructor(
    config: Partial<AidosConfig> = {},
    options: OrchestratorOptions = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.options = {
      useMockDecomposer: options.useMockDecomposer ?? true,
      autoStart: options.autoStart ?? false,
      maxRetries: options.maxRetries ?? 3,
      budgetWarningThreshold: options.budgetWarningThreshold ?? 0.8,
    };

    this.decomposer = getTaskDecomposer(this.config);
    this.setupDecomposerEvents();
  }

  // ========================================
  // Public API
  // ========================================

  /**
   * 新しいセッションを開始
   */
  async startSession(objective: string): Promise<Session> {
    if (this.session && this.session.status === 'active') {
      throw new AidosError(
        'Session already active',
        'SESSION_ACTIVE',
        false
      );
    }

    const sessionId = `session_${randomUUID().substring(0, 8)}`;
    this.startTime = Date.now();

    this.session = {
      id: sessionId,
      objective,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // AgentManagerを初期化
    this.agentManager = createAgentManager(sessionId, this.config);
    this.setupAgentManagerEvents();

    this.emit('session:started', { session: this.session });
    this.log('info', `Session started: ${objective}`);

    // タスク分解フェーズへ
    await this.decomposeObjective(objective);

    // 自動開始が有効な場合は実行開始
    if (this.options.autoStart) {
      await this.execute();
    }

    return this.session;
  }

  /**
   * 実行を開始/再開
   */
  async execute(): Promise<void> {
    if (!this.session || this.session.status !== 'active') {
      throw new AidosError('No active session', 'NO_SESSION', false);
    }

    if (this.phase === 'executing') {
      this.log('warn', 'Already executing');
      return;
    }

    this.setPhase('executing');

    try {
      await this.executeTaskQueue();
      this.setPhase('completed');
      this.completeSession('completed');
    } catch (error) {
      this.setPhase('failed');
      this.completeSession('failed');
      throw error;
    }
  }

  /**
   * セッションを一時停止
   */
  async pause(): Promise<void> {
    if (!this.session || this.session.status !== 'active') {
      throw new AidosError('No active session', 'NO_SESSION', false);
    }

    this.session.status = 'paused';
    this.session.updatedAt = new Date();

    if (this.agentManager) {
      await this.agentManager.stopAll();
    }

    this.emit('session:paused', { session: this.session });
    this.log('info', 'Session paused');
  }

  /**
   * セッションを再開
   */
  async resume(): Promise<void> {
    if (!this.session || this.session.status !== 'paused') {
      throw new AidosError(
        'Session is not paused',
        'SESSION_NOT_PAUSED',
        false
      );
    }

    this.session.status = 'active';
    this.session.updatedAt = new Date();

    this.emit('session:resumed', { session: this.session });
    this.log('info', 'Session resumed');

    // 実行を再開
    await this.execute();
  }

  /**
   * セッションを停止
   */
  async stop(): Promise<void> {
    if (!this.session) {
      return;
    }

    if (this.agentManager) {
      await this.agentManager.destroyAll();
    }

    this.completeSession('failed');
    this.log('info', 'Session stopped');
  }

  /**
   * 現在の状態を取得
   */
  getState(): OrchestratorState {
    return {
      session: this.session,
      phase: this.phase,
      tasks: new Map(this.tasks),
      decomposedTasks: [...this.decomposedTasks],
      stats: this.getStats(),
      agentTree: this.agentManager?.buildAgentTree() || [],
    };
  }

  /**
   * セッション統計を取得
   */
  getStats(): SessionStats {
    const tasks = Array.from(this.tasks.values());
    const metrics = this.agentManager?.getAggregatedMetrics() || {
      totalTokensUsed: 0,
      totalExecutionTimeMs: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      childrenSpawned: 0,
    };

    return {
      totalTasks: this.decomposedTasks.length,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
      failedTasks: tasks.filter((t) => t.status === 'failed').length,
      pendingTasks: tasks.filter((t) => t.status === 'pending').length,
      inProgressTasks: tasks.filter((t) => t.status === 'in_progress').length,
      totalTokensUsed: metrics.totalTokensUsed,
      elapsedTimeMs: this.startTime ? Date.now() - this.startTime : 0,
      agentCount: this.agentManager?.getAllAgents().length || 0,
    };
  }

  /**
   * エージェントサマリーを取得
   */
  getAgentSummaries(): AgentSummary[] {
    return this.agentManager?.getAgentSummaries() || [];
  }

  // ========================================
  // Private Methods - Decomposition
  // ========================================

  /**
   * 目的をタスクに分解
   */
  private async decomposeObjective(objective: string): Promise<void> {
    this.setPhase('decomposing');
    this.log('info', `Decomposing objective: ${objective}`);

    try {
      const result = await this.decomposer.decompose(objective, {
        useApi: !this.options.useMockDecomposer,
      });

      this.decomposedTasks = result.tasks;
      this.taskQueue = this.decomposer.topologicalSort(result.tasks);

      // タスクを初期化
      for (const task of result.tasks) {
        this.tasks.set(task.id, this.createTaskFromDecomposed(task));
      }

      this.log(
        'info',
        `Decomposed into ${result.tasks.length} tasks`
      );
      this.log('debug', `Reasoning: ${result.reasoning}`);

      this.setPhase('planning');
    } catch (error) {
      this.log('error', `Decomposition failed: ${error}`);
      throw error;
    }
  }

  /**
   * DecomposedTaskからTaskを作成
   */
  private createTaskFromDecomposed(decomposed: DecomposedTask): Task {
    return {
      id: decomposed.id,
      agentId: '', // 後でアサイン
      description: decomposed.description,
      category: decomposed.category,
      status: 'pending',
      progress: 0,
      dependencies: decomposed.dependencies,
      output: null,
      createdAt: new Date(),
      completedAt: null,
    };
  }

  // ========================================
  // Private Methods - Execution
  // ========================================

  /**
   * タスクキューを実行
   */
  private async executeTaskQueue(): Promise<void> {
    if (!this.agentManager) {
      throw new AidosError('AgentManager not initialized', 'NO_AGENT_MANAGER', false);
    }

    // PMエージェントを生成
    const pmAgent = await this.agentManager.spawn({
      role: 'PM',
      mission: this.session!.objective,
    });

    this.log('info', `PM Agent spawned: ${pmAgent.id}`);

    // 並列実行可能なグループを取得
    const groups = this.decomposer.getParallelGroups(this.decomposedTasks);

    for (const group of groups) {
      // バジェットチェック
      this.checkBudget();

      // グループ内のタスクを並列実行
      await this.executeTaskGroup(group);

      // セッションがアクティブでなくなった場合は中断
      if (this.session?.status !== 'active') {
        break;
      }
    }
  }

  /**
   * タスクグループを並列実行
   */
  private async executeTaskGroup(group: DecomposedTask[]): Promise<void> {
    if (!this.agentManager) return;

    const promises = group.map(async (decomposedTask) => {
      const task = this.tasks.get(decomposedTask.id);
      if (!task) return;

      // PLエージェントを生成
      const plAgent = await this.agentManager!.spawn({
        role: 'PL',
        mission: decomposedTask.description,
      });

      this.emit('task:scheduled', { task: decomposedTask });

      try {
        // タスク開始
        this.updateTaskStatus(task.id, 'in_progress');
        this.emit('task:started', { taskId: task.id, agentId: plAgent.id });

        // タスク実行
        const result = await this.agentManager!.assignTask(
          plAgent.id,
          decomposedTask
        );

        if (result.success) {
          this.updateTaskStatus(task.id, 'completed', result.output);
          this.emit('task:completed', {
            taskId: task.id,
            agentId: plAgent.id,
            result,
          });
        } else {
          this.updateTaskStatus(task.id, 'failed');
          this.emit('task:failed', {
            taskId: task.id,
            agentId: plAgent.id,
            error: result.error,
          });
        }
      } catch (error) {
        this.updateTaskStatus(task.id, 'failed');
        this.emit('task:failed', {
          taskId: task.id,
          error,
        });
      }
    });

    await Promise.all(promises);
  }

  /**
   * タスクステータスを更新
   */
  private updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    output?: string
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = status;
    if (status === 'completed') {
      task.progress = 100;
      task.completedAt = new Date();
      if (output) task.output = output;
    } else if (status === 'in_progress') {
      task.progress = 50; // 簡略化
    }

    this.tasks.set(taskId, task);
  }

  // ========================================
  // Private Methods - Budget & Resources
  // ========================================

  /**
   * バジェットをチェック
   */
  private checkBudget(): void {
    const stats = this.getStats();

    // トークン数チェック
    const tokenUsageRatio =
      stats.totalTokensUsed / this.config.budget.maxTotalTokens;

    if (tokenUsageRatio >= 1) {
      throw new BudgetExceededError(
        stats.totalTokensUsed,
        this.config.budget.maxTotalTokens
      );
    }

    if (tokenUsageRatio >= this.options.budgetWarningThreshold) {
      this.emit('budget:warning', {
        current: stats.totalTokensUsed,
        max: this.config.budget.maxTotalTokens,
        ratio: tokenUsageRatio,
      });
    }

    // 時間チェック
    if (stats.elapsedTimeMs >= this.config.budget.maxSessionDurationMs) {
      throw new AidosError(
        'Session duration exceeded',
        'DURATION_EXCEEDED',
        false
      );
    }
  }

  // ========================================
  // Private Methods - Session Management
  // ========================================

  /**
   * セッションを完了
   */
  private completeSession(status: 'completed' | 'failed'): void {
    if (!this.session) return;

    this.session.status = status;
    this.session.updatedAt = new Date();

    if (status === 'completed') {
      this.emit('session:completed', {
        session: this.session,
        stats: this.getStats(),
      });
    } else {
      this.emit('session:failed', {
        session: this.session,
        stats: this.getStats(),
      });
    }
  }

  /**
   * フェーズを変更
   */
  private setPhase(phase: ExecutionPhase): void {
    const previousPhase = this.phase;
    this.phase = phase;
    this.emit('phase:changed', { previousPhase, newPhase: phase });
  }

  // ========================================
  // Private Methods - Event Setup
  // ========================================

  /**
   * タスク分解器のイベントをセットアップ
   */
  private setupDecomposerEvents(): void {
    this.decomposer.on('decompose:progress', (data: { step: string }) => {
      this.log('debug', `Decomposition progress: ${data.step}`);
    });

    this.decomposer.on('decompose:error', (data: { error: string }) => {
      this.log('error', `Decomposition error: ${data.error}`);
    });
  }

  /**
   * AgentManagerのイベントをセットアップ
   */
  private setupAgentManagerEvents(): void {
    if (!this.agentManager) return;

    this.agentManager.on('agent:spawned', (data: { agent: { id: string; role: string } }) => {
      this.log('info', `Agent spawned: ${data.agent.id} (${data.agent.role})`);
    });

    this.agentManager.on('agent:destroyed', (data: { agentId: string }) => {
      this.log('debug', `Agent destroyed: ${data.agentId}`);
    });

    this.agentManager.on('agent:status_changed', (data: { agentId: string; previousStatus: string; newStatus: string }) => {
      this.log(
        'debug',
        `Agent ${data.agentId}: ${data.previousStatus} -> ${data.newStatus}`
      );
    });

    this.agentManager.on('agent:error', (data: { agentId: string; error: string }) => {
      this.log('error', `Agent ${data.agentId} error: ${data.error}`);
    });

    this.agentManager.on('manager:limit_reached', (data: { current: number; max: number }) => {
      this.log(
        'warn',
        `Agent limit reached: ${data.current}/${data.max}`
      );
    });
  }

  /**
   * ログを出力
   */
  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string
  ): void {
    const payload: LogMessagePayload = {
      agentId: 'orchestrator',
      level,
      message,
    };

    this.emit('log:message', payload);

    // コンソールにも出力（デバッグ用）
    const prefix = `[${level.toUpperCase()}] [Orchestrator]`;
    switch (level) {
      case 'debug':
        // debug出力は環境変数でコントロール
        if (process.env.DEBUG) console.debug(prefix, message);
        break;
      case 'info':
        console.info(prefix, message);
        break;
      case 'warn':
        console.warn(prefix, message);
        break;
      case 'error':
        console.error(prefix, message);
        break;
    }
  }
}

// ========================================
// Factory Functions
// ========================================

/**
 * オーケストレーターを作成
 */
export function createOrchestrator(
  config?: Partial<AidosConfig>,
  options?: OrchestratorOptions
): Orchestrator {
  return new Orchestrator(config, options);
}

// ========================================
// Singleton Instance (オプション)
// ========================================

let orchestratorInstance: Orchestrator | null = null;

/**
 * シングルトンオーケストレーターを取得
 */
export function getOrchestrator(
  config?: Partial<AidosConfig>,
  options?: OrchestratorOptions
): Orchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new Orchestrator(config, options);
  }
  return orchestratorInstance;
}

/**
 * オーケストレーターをリセット（テスト用）
 */
export function resetOrchestrator(): void {
  orchestratorInstance = null;
}
