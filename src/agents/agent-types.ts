/**
 * Agent関連の型定義
 *
 * エージェントの動作、能力、イベントに関する詳細な型を定義
 */

import { EventEmitter } from 'events';
import {
  Agent,
  AgentConfig,
  AgentRole,
  AgentStatus,
  Task,
  DecomposedTask,
  BusMessage,
} from '../types.js';

// ========================================
// Agent Capability Types
// ========================================

/**
 * エージェントが持つ能力の定義
 */
export interface AgentCapability {
  name: string;
  description: string;
  requiredRole: AgentRole[];
}

/**
 * 標準的なエージェント能力
 */
export const AGENT_CAPABILITIES = {
  TASK_DECOMPOSITION: {
    name: 'task_decomposition',
    description: 'タスクを小さなサブタスクに分解する能力',
    requiredRole: ['PM', 'PL'] as AgentRole[],
  },
  CODE_GENERATION: {
    name: 'code_generation',
    description: 'コードを生成する能力',
    requiredRole: ['PL', 'Member'] as AgentRole[],
  },
  CODE_REVIEW: {
    name: 'code_review',
    description: 'コードをレビューする能力',
    requiredRole: ['PM', 'PL'] as AgentRole[],
  },
  TESTING: {
    name: 'testing',
    description: 'テストを実行・作成する能力',
    requiredRole: ['PL', 'Member'] as AgentRole[],
  },
  DOCUMENTATION: {
    name: 'documentation',
    description: 'ドキュメントを作成する能力',
    requiredRole: ['PM', 'PL', 'Member'] as AgentRole[],
  },
} as const;

// ========================================
// Agent Context Types
// ========================================

/**
 * エージェントの実行コンテキスト
 */
export interface AgentContext {
  sessionId: string;
  workingDirectory: string;
  environment: Record<string, string>;
  constraints: AgentConstraints;
}

/**
 * エージェントの制約条件
 */
export interface AgentConstraints {
  maxTokensPerRequest: number;
  maxExecutionTimeMs: number;
  allowedOperations: string[];
  forbiddenPatterns: RegExp[];
}

/**
 * デフォルトの制約条件
 */
export const DEFAULT_AGENT_CONSTRAINTS: AgentConstraints = {
  maxTokensPerRequest: 4096,
  maxExecutionTimeMs: 300000, // 5分
  allowedOperations: ['read', 'write', 'execute', 'network'],
  forbiddenPatterns: [
    /rm\s+-rf\s+\//,  // 危険なコマンド
    /sudo\s+/,        // sudo使用
  ],
};

// ========================================
// Agent Event Types
// ========================================

/**
 * エージェント固有のイベント型
 */
export type AgentEventType =
  | 'agent:initialized'
  | 'agent:thinking'
  | 'agent:executing'
  | 'agent:completed'
  | 'agent:error'
  | 'agent:blocked'
  | 'agent:child_spawned'
  | 'agent:child_completed';

/**
 * エージェントイベントのペイロード
 */
export interface AgentEventPayload {
  agentId: string;
  timestamp: Date;
  data?: unknown;
}

/**
 * エージェント初期化イベント
 */
export interface AgentInitializedEvent extends AgentEventPayload {
  role: AgentRole;
  mission: string;
}

/**
 * エージェント思考中イベント
 */
export interface AgentThinkingEvent extends AgentEventPayload {
  currentTask?: string;
  progress?: number;
}

/**
 * エージェント実行中イベント
 */
export interface AgentExecutingEvent extends AgentEventPayload {
  action: string;
  details?: string;
}

/**
 * エージェント完了イベント
 */
export interface AgentCompletedEvent extends AgentEventPayload {
  result: string;
  tokensUsed: number;
}

/**
 * エージェントエラーイベント
 */
export interface AgentErrorEvent extends AgentEventPayload {
  error: Error;
  recoverable: boolean;
}

/**
 * 子エージェント生成イベント
 */
export interface AgentChildSpawnedEvent extends AgentEventPayload {
  childId: string;
  childRole: AgentRole;
  childMission: string;
}

// ========================================
// Agent Execution Types
// ========================================

/**
 * エージェントの実行結果
 */
export interface AgentExecutionResult {
  success: boolean;
  output: string;
  artifacts: AgentArtifact[];
  tokensUsed: number;
  executionTimeMs: number;
  error?: Error;
}

/**
 * エージェントが生成したアーティファクト
 */
export interface AgentArtifact {
  id: string;
  type: 'code' | 'document' | 'config' | 'test' | 'other';
  path: string;
  content: string;
  createdAt: Date;
}

/**
 * エージェントへの指示
 */
export interface AgentInstruction {
  type: 'task' | 'query' | 'intervention';
  content: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  timeout?: number;
  metadata?: Record<string, unknown>;
}

// ========================================
// Agent State Machine Types
// ========================================

/**
 * エージェントの状態遷移
 */
export type AgentTransition = {
  from: AgentStatus;
  to: AgentStatus;
  trigger: string;
};

/**
 * 有効な状態遷移の定義
 */
export const VALID_AGENT_TRANSITIONS: AgentTransition[] = [
  { from: 'idle', to: 'thinking', trigger: 'start_task' },
  { from: 'thinking', to: 'executing', trigger: 'plan_ready' },
  { from: 'thinking', to: 'blocked', trigger: 'need_input' },
  { from: 'thinking', to: 'error', trigger: 'thinking_failed' },
  { from: 'executing', to: 'done', trigger: 'execution_complete' },
  { from: 'executing', to: 'error', trigger: 'execution_failed' },
  { from: 'executing', to: 'blocked', trigger: 'need_approval' },
  { from: 'blocked', to: 'thinking', trigger: 'input_received' },
  { from: 'blocked', to: 'executing', trigger: 'approved' },
  { from: 'error', to: 'idle', trigger: 'reset' },
  { from: 'done', to: 'idle', trigger: 'reset' },
];

/**
 * 状態遷移が有効かチェック
 */
export function isValidTransition(from: AgentStatus, to: AgentStatus): boolean {
  return VALID_AGENT_TRANSITIONS.some(
    (t) => t.from === from && t.to === to
  );
}

// ========================================
// Agent Interface Types
// ========================================

/**
 * エージェントの基本インターフェース
 */
export interface IAgent extends EventEmitter {
  readonly id: string;
  readonly role: AgentRole;
  readonly status: AgentStatus;
  readonly mission: string;

  /**
   * エージェントを初期化
   */
  initialize(context: AgentContext): Promise<void>;

  /**
   * タスクを実行
   */
  execute(instruction: AgentInstruction): Promise<AgentExecutionResult>;

  /**
   * エージェントを停止
   */
  stop(): Promise<void>;

  /**
   * 現在の状態を取得
   */
  getState(): AgentState;
}

/**
 * エージェントの完全な状態
 */
export interface AgentState {
  agent: Agent;
  currentTask: Task | null;
  pendingTasks: DecomposedTask[];
  completedTasks: Task[];
  artifacts: AgentArtifact[];
  metrics: AgentMetrics;
}

/**
 * エージェントのメトリクス
 */
export interface AgentMetrics {
  totalTokensUsed: number;
  totalExecutionTimeMs: number;
  tasksCompleted: number;
  tasksFailed: number;
  childrenSpawned: number;
}

// ========================================
// Agent Factory Types
// ========================================

/**
 * エージェント生成オプション
 */
export interface AgentSpawnOptions {
  role: AgentRole;
  mission: string;
  parentId?: string;
  context?: Partial<AgentContext>;
  priority?: 'low' | 'normal' | 'high';
}

/**
 * エージェントファクトリインターフェース
 */
export interface IAgentFactory {
  /**
   * 新しいエージェントを生成
   */
  spawn(options: AgentSpawnOptions): Promise<IAgent>;

  /**
   * エージェントを破棄
   */
  destroy(agentId: string): Promise<void>;
}

// ========================================
// Communication Types
// ========================================

/**
 * エージェント間メッセージ
 */
export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response' | 'notification';
  payload: unknown;
  timestamp: Date;
  correlationId?: string;
}

/**
 * エージェント間の通信チャネル
 */
export interface IAgentChannel {
  /**
   * メッセージを送信
   */
  send(message: AgentMessage): Promise<void>;

  /**
   * メッセージをリッスン
   */
  onMessage(handler: (message: AgentMessage) => void): void;

  /**
   * チャネルを閉じる
   */
  close(): void;
}

// ========================================
// Helper Types
// ========================================

/**
 * エージェントのサマリー情報（UI表示用）
 */
export interface AgentSummary {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  mission: string;
  progress: number;
  childCount: number;
  currentAction?: string;
}

/**
 * エージェントツリーのノード
 */
export interface AgentTreeNode {
  agent: AgentSummary;
  children: AgentTreeNode[];
  depth: number;
}

/**
 * Agent型をAgentSummaryに変換
 */
export function toAgentSummary(agent: Agent, currentAction?: string): AgentSummary {
  return {
    id: agent.id,
    role: agent.role,
    status: agent.status,
    mission: agent.mission,
    progress: 0, // 実際の進捗は別途計算
    childCount: agent.childIds.length,
    currentAction,
  };
}
