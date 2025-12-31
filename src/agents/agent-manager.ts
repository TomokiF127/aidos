/**
 * エージェント管理モジュール
 *
 * エージェントのライフサイクル管理、状態追跡、通信を担当
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  Agent,
  AgentConfig,
  AgentRole,
  AgentStatus,
  Task,
  DecomposedTask,
  AidosConfig,
  DEFAULT_CONFIG,
  AgentError,
  ResourceLimitError,
  BusMessage,
  AgentCreatedPayload,
  AgentStatusChangedPayload,
  MessageType,
} from '../types.js';
import {
  AgentContext,
  AgentState,
  AgentMetrics,
  AgentSummary,
  AgentTreeNode,
  AgentSpawnOptions,
  AgentInstruction,
  AgentExecutionResult,
  AgentArtifact,
  IAgent,
  IAgentFactory,
  isValidTransition,
  DEFAULT_AGENT_CONSTRAINTS,
  toAgentSummary,
} from './agent-types.js';
import { ClaudeCodeAgent, ClaudeCodeAgentOptions } from './claude-code-agent.js';

// ========================================
// Agent Manager Events
// ========================================

export type AgentManagerEvent =
  | 'agent:spawned'
  | 'agent:destroyed'
  | 'agent:status_changed'
  | 'agent:task_assigned'
  | 'agent:task_completed'
  | 'agent:error'
  | 'agent:progress'
  | 'manager:limit_reached';

/**
 * 拡張されたエージェント生成オプション
 */
export interface ExtendedAgentSpawnOptions extends AgentSpawnOptions {
  type?: 'mock' | 'claude-code';
  claudeOptions?: Partial<ClaudeCodeAgentOptions>;
}

// ========================================
// Mock Agent Implementation
// ========================================

/**
 * モック版エージェント実装
 * 実際のAI呼び出しなしで動作をシミュレート
 */
class MockAgent extends EventEmitter implements IAgent {
  readonly id: string;
  readonly role: AgentRole;
  readonly mission: string;

  private _status: AgentStatus = 'idle';
  private context: AgentContext | null = null;
  private currentTask: Task | null = null;
  private pendingTasks: DecomposedTask[] = [];
  private completedTasks: Task[] = [];
  private artifacts: AgentArtifact[] = [];
  private metrics: AgentMetrics = {
    totalTokensUsed: 0,
    totalExecutionTimeMs: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    childrenSpawned: 0,
  };

  constructor(
    id: string,
    role: AgentRole,
    mission: string,
    public readonly parentId: string | null = null
  ) {
    super();
    this.id = id;
    this.role = role;
    this.mission = mission;
  }

  get status(): AgentStatus {
    return this._status;
  }

  /**
   * エージェントを初期化
   */
  async initialize(context: AgentContext): Promise<void> {
    this.context = context;
    this.emit('agent:initialized', {
      agentId: this.id,
      role: this.role,
      mission: this.mission,
    });
  }

  /**
   * 状態を変更
   */
  private setStatus(newStatus: AgentStatus): void {
    const previousStatus = this._status;

    if (!isValidTransition(previousStatus, newStatus)) {
      // 無効な遷移でも警告のみ（柔軟性のため）
      console.warn(
        `Invalid status transition: ${previousStatus} -> ${newStatus}`
      );
    }

    this._status = newStatus;
    this.emit('agent:status_changed', {
      agentId: this.id,
      previousStatus,
      newStatus,
    });
  }

  /**
   * タスクを実行（モック版）
   */
  async execute(instruction: AgentInstruction): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    this.setStatus('thinking');
    this.emit('agent:thinking', { agentId: this.id });

    // 思考をシミュレート
    await this.delay(200);

    this.setStatus('executing');
    this.emit('agent:executing', {
      agentId: this.id,
      action: instruction.content,
    });

    // 実行をシミュレート
    await this.delay(300);

    const executionTimeMs = Date.now() - startTime;
    const tokensUsed = Math.floor(Math.random() * 500) + 100; // モックトークン数

    this.metrics.totalTokensUsed += tokensUsed;
    this.metrics.totalExecutionTimeMs += executionTimeMs;
    this.metrics.tasksCompleted++;

    this.setStatus('done');

    const result: AgentExecutionResult = {
      success: true,
      output: `[Mock] Executed: ${instruction.content}`,
      artifacts: [],
      tokensUsed,
      executionTimeMs,
    };

    this.emit('agent:completed', {
      agentId: this.id,
      result: result.output,
      tokensUsed,
    });

    // 次のタスクのためにidleに戻す
    this.setStatus('idle');

    return result;
  }

  /**
   * エージェントを停止
   */
  async stop(): Promise<void> {
    this.setStatus('idle');
    this.emit('agent:stopped', { agentId: this.id });
  }

  /**
   * 現在の状態を取得
   */
  getState(): AgentState {
    return {
      agent: this.toAgent(),
      currentTask: this.currentTask,
      pendingTasks: [...this.pendingTasks],
      completedTasks: [...this.completedTasks],
      artifacts: [...this.artifacts],
      metrics: { ...this.metrics },
    };
  }

  /**
   * Agent型に変換
   */
  toAgent(): Agent {
    return {
      id: this.id,
      sessionId: this.context?.sessionId || '',
      role: this.role,
      mission: this.mission,
      status: this._status,
      parentId: this.parentId,
      childIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 遅延ユーティリティ
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ========================================
// Agent Manager Class
// ========================================

/**
 * エージェント管理クラス
 */
export class AgentManager extends EventEmitter implements IAgentFactory {
  private agents: Map<string, IAgent> = new Map();
  private agentTree: Map<string, string[]> = new Map(); // parentId -> childIds
  private config: AidosConfig;
  private sessionId: string;

  constructor(sessionId: string, config: Partial<AidosConfig> = {}) {
    super();
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 新しいエージェントを生成
   */
  async spawn(options: ExtendedAgentSpawnOptions): Promise<IAgent> {
    // 同時実行数チェック
    const activeCount = this.getActiveAgentCount();
    if (activeCount >= this.config.agents.maxConcurrent) {
      this.emit('manager:limit_reached', {
        current: activeCount,
        max: this.config.agents.maxConcurrent,
      });
      throw new ResourceLimitError(
        'concurrent_agents',
        activeCount,
        this.config.agents.maxConcurrent
      );
    }

    const agentId = `agent_${randomUUID().substring(0, 8)}`;

    // エージェントタイプに応じてインスタンス生成
    let agent: IAgent;

    if (options.type === 'claude-code') {
      agent = new ClaudeCodeAgent({
        id: agentId,
        role: options.role,
        mission: options.mission,
        parentId: options.parentId,
        workingDirectory: this.config.output.directory,
        ...options.claudeOptions,
      });
    } else {
      // デフォルトはMockAgent
      agent = new MockAgent(
        agentId,
        options.role,
        options.mission,
        options.parentId || null
      );
    }

    // コンテキストを作成して初期化
    const context: AgentContext = {
      sessionId: this.sessionId,
      workingDirectory: this.config.output.directory,
      environment: {},
      constraints: DEFAULT_AGENT_CONSTRAINTS,
      ...options.context,
    };

    await agent.initialize(context);

    // エージェントを登録
    this.agents.set(agentId, agent);

    // 親子関係を更新
    if (options.parentId) {
      const children = this.agentTree.get(options.parentId) || [];
      children.push(agentId);
      this.agentTree.set(options.parentId, children);
    }

    // イベントをフォワード
    this.forwardAgentEvents(agent);

    // スポーンイベントを発行
    this.emit('agent:spawned', {
      agent: agent.getState().agent,
      parentId: options.parentId,
    });

    return agent;
  }

  /**
   * エージェントを破棄
   */
  async destroy(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentError(`Agent not found: ${agentId}`, agentId);
    }

    // 子エージェントを先に破棄
    const childIds = this.agentTree.get(agentId) || [];
    for (const childId of childIds) {
      await this.destroy(childId);
    }

    // エージェントを停止
    await agent.stop();

    // 登録解除
    this.agents.delete(agentId);
    this.agentTree.delete(agentId);

    // 親の子リストから削除
    for (const [parentId, children] of this.agentTree.entries()) {
      const index = children.indexOf(agentId);
      if (index > -1) {
        children.splice(index, 1);
      }
    }

    this.emit('agent:destroyed', { agentId });
  }

  /**
   * エージェントを取得
   */
  getAgent(agentId: string): IAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 全エージェントを取得
   */
  getAllAgents(): IAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 役割でエージェントをフィルタ
   */
  getAgentsByRole(role: AgentRole): IAgent[] {
    return this.getAllAgents().filter((a) => a.role === role);
  }

  /**
   * ステータスでエージェントをフィルタ
   */
  getAgentsByStatus(status: AgentStatus): IAgent[] {
    return this.getAllAgents().filter((a) => a.status === status);
  }

  /**
   * アクティブなエージェント数を取得
   */
  getActiveAgentCount(): number {
    return this.getAgentsByStatus('executing').length +
           this.getAgentsByStatus('thinking').length;
  }

  /**
   * エージェントツリーを構築
   */
  buildAgentTree(): AgentTreeNode[] {
    const rootAgents = this.getAllAgents().filter(
      (a) => (a as MockAgent).parentId === null
    );

    const buildNode = (agent: IAgent, depth: number): AgentTreeNode => {
      const agentId = agent.id;
      const childIds = this.agentTree.get(agentId) || [];
      const children = childIds
        .map((id) => this.agents.get(id))
        .filter((a): a is IAgent => a !== undefined)
        .map((a) => buildNode(a, depth + 1));

      return {
        agent: toAgentSummary(agent.getState().agent),
        children,
        depth,
      };
    };

    return rootAgents.map((a) => buildNode(a, 0));
  }

  /**
   * 全エージェントのサマリーを取得
   */
  getAgentSummaries(): AgentSummary[] {
    return this.getAllAgents().map((a) =>
      toAgentSummary(a.getState().agent)
    );
  }

  /**
   * エージェントにタスクを割り当て
   */
  async assignTask(
    agentId: string,
    task: DecomposedTask
  ): Promise<AgentExecutionResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentError(`Agent not found: ${agentId}`, agentId);
    }

    this.emit('agent:task_assigned', { agentId, task });

    const instruction: AgentInstruction = {
      type: 'task',
      content: task.description,
      priority: this.getPriorityFromTask(task),
      metadata: { taskId: task.id, category: task.category },
    };

    const result = await agent.execute(instruction);

    if (result.success) {
      this.emit('agent:task_completed', { agentId, taskId: task.id, result });
    } else {
      this.emit('agent:error', {
        agentId,
        taskId: task.id,
        error: result.error,
      });
    }

    return result;
  }

  /**
   * 全エージェントを停止
   */
  async stopAll(): Promise<void> {
    const agents = this.getAllAgents();
    await Promise.all(agents.map((a) => a.stop()));
  }

  /**
   * 全エージェントを破棄
   */
  async destroyAll(): Promise<void> {
    // ルートエージェントから破棄（子は再帰的に破棄される）
    const rootAgents = this.getAllAgents().filter(
      (a) => (a as MockAgent).parentId === null
    );

    for (const agent of rootAgents) {
      await this.destroy(agent.id);
    }
  }

  /**
   * メトリクスを集計
   */
  getAggregatedMetrics(): AgentMetrics {
    const agents = this.getAllAgents();
    return agents.reduce(
      (acc, agent) => {
        const metrics = agent.getState().metrics;
        return {
          totalTokensUsed: acc.totalTokensUsed + metrics.totalTokensUsed,
          totalExecutionTimeMs:
            acc.totalExecutionTimeMs + metrics.totalExecutionTimeMs,
          tasksCompleted: acc.tasksCompleted + metrics.tasksCompleted,
          tasksFailed: acc.tasksFailed + metrics.tasksFailed,
          childrenSpawned: acc.childrenSpawned + metrics.childrenSpawned,
        };
      },
      {
        totalTokensUsed: 0,
        totalExecutionTimeMs: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        childrenSpawned: 0,
      }
    );
  }

  /**
   * エージェントのイベントをフォワード
   */
  private forwardAgentEvents(agent: IAgent): void {
    const events = [
      'agent:initialized',
      'agent:status_changed',
      'agent:thinking',
      'agent:executing',
      'agent:completed',
      'agent:stopped',
      'agent:progress',
      'agent:output',
      'agent:error',
    ];

    events.forEach((event) => {
      agent.on(event, (data: unknown) => {
        this.emit(event, data);
      });
    });
  }

  /**
   * タスクから優先度を決定
   */
  private getPriorityFromTask(
    task: DecomposedTask
  ): 'low' | 'normal' | 'high' | 'urgent' {
    if (task.priority <= 1) return 'high';
    if (task.priority <= 2) return 'normal';
    return 'low';
  }
}

// ========================================
// Factory Functions
// ========================================

/**
 * AgentManagerのインスタンスを作成
 */
export function createAgentManager(
  sessionId: string,
  config?: Partial<AidosConfig>
): AgentManager {
  return new AgentManager(sessionId, config);
}
