/**
 * AIDOS 共通型定義
 */

// ========================================
// Agent関連
// ========================================

export type AgentRole = 'PM' | 'PL' | 'Member';

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'blocked'
  | 'done'
  | 'error';

export interface Agent {
  id: string;
  sessionId: string;
  role: AgentRole;
  mission: string;
  status: AgentStatus;
  parentId: string | null;
  childIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfig {
  role: AgentRole;
  mission: string;
  parentId?: string;
}

// ========================================
// Task関連
// ========================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type TaskCategory = 'design' | 'implement' | 'test' | 'document' | 'other';

export interface Task {
  id: string;
  agentId: string;
  description: string;
  category: TaskCategory;
  status: TaskStatus;
  progress: number; // 0-100
  dependencies: string[];
  output: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface DecomposedTask {
  id: string;
  description: string;
  category: TaskCategory;
  dependencies: string[];
  priority: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

// ========================================
// Session関連
// ========================================

export type SessionStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface Session {
  id: string;
  objective: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ========================================
// Message関連
// ========================================

export type MessageType =
  | 'agent:created'
  | 'agent:status_changed'
  | 'task:started'
  | 'task:progress'
  | 'task:completed'
  | 'task:failed'
  | 'log:message'
  | 'intervention:requested'
  | 'session:started'
  | 'session:completed';

export interface BusMessage<T = unknown> {
  type: MessageType;
  senderId: string;
  timestamp: Date;
  payload: T;
}

// ========================================
// Event Payloads
// ========================================

export interface AgentCreatedPayload {
  agent: Agent;
}

export interface AgentStatusChangedPayload {
  agentId: string;
  previousStatus: AgentStatus;
  newStatus: AgentStatus;
}

export interface TaskProgressPayload {
  taskId: string;
  agentId: string;
  progress: number;
  message?: string;
}

export interface LogMessagePayload {
  agentId: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

// ========================================
// Configuration
// ========================================

export interface AidosConfig {
  api: {
    provider: 'anthropic';
    model: string;
    maxTokens: number;
  };
  agents: {
    maxConcurrent: number;
    timeoutMs: number;
  };
  budget: {
    maxTotalTokens: number;
    maxSessionDurationMs: number;
  };
  output: {
    directory: string;
  };
  ui: {
    theme: 'dark' | 'light';
    logLines: number;
  };
}

export const DEFAULT_CONFIG: AidosConfig = {
  api: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 4096,
  },
  agents: {
    maxConcurrent: 5,
    timeoutMs: 300000, // 5分
  },
  budget: {
    maxTotalTokens: 1000000,
    maxSessionDurationMs: 3600000, // 1時間
  },
  output: {
    directory: './output',
  },
  ui: {
    theme: 'dark',
    logLines: 100,
  },
};

// ========================================
// Error Types
// ========================================

export class AidosError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean
  ) {
    super(message);
    this.name = 'AidosError';
  }
}

export class APIError extends AidosError {
  constructor(message: string, public statusCode: number) {
    super(message, 'API_ERROR', statusCode !== 500);
  }
}

export class AgentError extends AidosError {
  constructor(message: string, public agentId: string) {
    super(message, 'AGENT_ERROR', true);
  }
}

export class BudgetExceededError extends AidosError {
  constructor(current: number, max: number) {
    super(
      `Budget exceeded: ${current}/${max} tokens`,
      'BUDGET_EXCEEDED',
      false
    );
  }
}

export class ResourceLimitError extends AidosError {
  constructor(resource: string, current: number, max: number) {
    super(
      `Resource limit exceeded: ${resource} (${current}/${max})`,
      'RESOURCE_LIMIT',
      false
    );
  }
}

// ========================================
// Phase 2: Intervention Types
// ========================================

export type InterventionType =
  | 'approval'      // 承認要求
  | 'direction'     // 方向修正
  | 'task_edit'     // タスク編集
  | 'abort'         // 中止確認
  | 'custom';       // カスタム

export interface InterventionRequest {
  id: string;
  type: InterventionType;
  title: string;
  message: string;
  options: InterventionOption[];
  agentId: string;
  taskId?: string;
  timeout?: number;       // 自動承認までの時間(ms)
  defaultOption?: string; // タイムアウト時のデフォルト
  createdAt: Date;
}

export interface InterventionOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  isDanger?: boolean;
}

export interface InterventionResponse {
  requestId: string;
  selectedOption: string;
  userInput?: string;
  respondedAt: Date;
}

// ========================================
// Phase 2: Artifact Types
// ========================================

export type ArtifactType =
  | 'code'
  | 'test'
  | 'document'
  | 'config'
  | 'other';

export interface Artifact {
  id: string;
  sessionId: string;
  agentId: string;
  taskId: string;
  type: ArtifactType;
  filename: string;
  path: string;
  content: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// ========================================
// Phase 2: Review Types
// ========================================

export type ReviewSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ReviewComment {
  line?: number;
  column?: number;
  severity: ReviewSeverity;
  message: string;
  suggestion?: string;
  rule?: string;
}

export interface ReviewResult {
  artifactId: string;
  passed: boolean;
  score: number;         // 0-100
  comments: ReviewComment[];
  summary: string;
  reviewedAt: Date;
}

// ========================================
// Phase 2: History Types
// ========================================

export interface SessionSummary {
  id: string;
  objective: string;
  status: SessionStatus;
  taskCount: number;
  completedTaskCount: number;
  agentCount: number;
  duration: number;      // ms
  tokenUsage: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface TaskPattern {
  id: string;
  objectiveKeywords: string[];
  taskTemplates: DecomposedTask[];
  successRate: number;
  usageCount: number;
  lastUsedAt: Date;
}

// ========================================
// Phase 2: Extended Config
// ========================================

export interface InterventionConfig {
  enabled: boolean;
  autoApproveTimeout?: number;  // 自動承認タイムアウト(ms)
  requireApprovalFor: InterventionType[];
}

export interface QualityConfig {
  enableCodeReview: boolean;
  enableTestGeneration: boolean;
  minCodeScore: number;   // 最低品質スコア
}

export interface AidosConfigExtended extends AidosConfig {
  intervention: InterventionConfig;
  quality: QualityConfig;
  prompts: {
    templateDir: string;
  };
}

export const DEFAULT_CONFIG_EXTENDED: AidosConfigExtended = {
  ...DEFAULT_CONFIG,
  intervention: {
    enabled: true,
    autoApproveTimeout: 30000,
    requireApprovalFor: ['abort', 'direction'],
  },
  quality: {
    enableCodeReview: true,
    enableTestGeneration: true,
    minCodeScore: 70,
  },
  prompts: {
    templateDir: './prompts',
  },
};

// ========================================
// Phase 2: Output & Artifact Extended Types
// ========================================

/**
 * 成果物のステータス（レビュー状態を含む）
 */
export type ArtifactStatus = 'draft' | 'reviewed' | 'approved' | 'rejected';

/**
 * 成果物メタデータ
 */
export interface ArtifactMetadata {
  description?: string;
  tags: string[];
  dependencies: string[];
  lineCount: number;
  byteSize: number;
  checksum?: string;
  generatedBy?: string;
  reviewedBy?: string;
  customData?: Record<string, unknown>;
}

/**
 * 成果物拡張インターフェース
 */
export interface ArtifactExtended extends Artifact {
  language?: string;
  status: ArtifactStatus;
  parentVersionId: string | null;
  metadata: ArtifactMetadata;
}

// ========================================
// Phase 2: Quality Types
// ========================================

/**
 * レビューカテゴリ
 */
export type ReviewCategory =
  | 'style'
  | 'performance'
  | 'security'
  | 'maintainability'
  | 'bug'
  | 'documentation'
  | 'best-practice'
  | 'other';

/**
 * 拡張レビューコメント
 */
export interface ReviewCommentExtended extends ReviewComment {
  id: string;
  endLine?: number;
  endColumn?: number;
  category: ReviewCategory;
  autoFixable: boolean;
}

/**
 * レビューサマリー
 */
export interface ReviewSummary {
  totalIssues: number;
  bySeverity: Record<ReviewSeverity, number>;
  byCategory: Record<ReviewCategory, number>;
  improvements: string[];
  strengths: string[];
}

/**
 * 拡張レビュー結果
 */
export interface ReviewResultExtended extends Omit<ReviewResult, 'summary'> {
  artifactName: string;
  language?: string;
  comments: ReviewCommentExtended[];
  summary: ReviewSummary;
  metadata: {
    reviewedAt: Date;
    reviewDurationMs: number;
    rulesApplied: string[];
    linesReviewed: number;
  };
}

// ========================================
// Phase 2: Test Generation Types
// ========================================

/**
 * テストフレームワーク
 */
export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest' | 'swift-testing';

/**
 * テストの種類
 */
export type TestType = 'unit' | 'integration' | 'e2e' | 'snapshot';

/**
 * テストケース
 */
export interface TestCase {
  id: string;
  name: string;
  description: string;
  type: TestType;
  targetFunction?: string;
  targetClass?: string;
  inputs: Array<{
    name: string;
    type: string;
    value: unknown;
    description?: string;
  }>;
  expectedOutput: {
    type: 'value' | 'throws' | 'resolves' | 'rejects' | 'matches' | 'snapshot';
    value?: unknown;
    errorType?: string;
    errorMessage?: string;
    matcher?: string;
  };
  setup?: string;
  teardown?: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
  generated: boolean;
}

/**
 * テストスイート
 */
export interface TestSuite {
  id: string;
  name: string;
  description: string;
  framework: TestFramework;
  language: string;
  sourceArtifactId?: string;
  testCases: TestCase[];
  imports: string[];
  setupCode?: string;
  teardownCode?: string;
  metadata: {
    generatedAt: Date;
    generationDurationMs: number;
    sourceFile?: string;
    targetFunctions: string[];
    targetClasses: string[];
    coverage: {
      functions: number;
      branches: number;
      lines: number;
    };
  };
}

// ========================================
// Phase 2: Config Types
// ========================================

/**
 * 設定ソースの種類
 */
export type ConfigSource = 'default' | 'file' | 'env' | 'runtime';

/**
 * 設定値の出所追跡
 */
export interface ConfigOrigin {
  key: string;
  source: ConfigSource;
  value: unknown;
  originalValue?: unknown;
}

/**
 * 設定バリデーションエラー
 */
export interface ConfigValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

/**
 * 設定バリデーション結果
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: string[];
}

// ========================================
// Phase 2: Prompt Template Types
// ========================================

/**
 * テンプレートカテゴリ
 */
export type PromptTemplateCategory =
  | 'task-decomposition'
  | 'code-generation'
  | 'code-review'
  | 'test-generation'
  | 'documentation'
  | 'debugging'
  | 'refactoring'
  | 'system';

/**
 * プロンプトテンプレート
 */
export interface PromptTemplate {
  id: string;
  name: string;
  category: PromptTemplateCategory;
  description: string;
  template: string;
  requiredVariables: string[];
  optionalVariables: string[];
  version: string;
}

/**
 * テンプレートレンダリング結果
 */
export interface PromptRenderResult {
  prompt: string;
  usedVariables: string[];
  missingVariables: string[];
  warnings: string[];
}

// ========================================
// Phase 3: Done定義・検収関連
// ========================================

/**
 * 要件ステータス
 */
export type RequirementStatusType = 'satisfied' | 'not_satisfied' | 'not_verified';

/**
 * 要件マッピング
 */
export interface RequirementStatus {
  reqId: string;
  description: string;
  status: RequirementStatusType;
  evidence?: string;
}

/**
 * 検証結果
 */
export interface VerificationResult {
  tests: Array<{
    command: string;
    result: 'passed' | 'failed' | 'skipped';
    executedAt: Date;
    details?: string;
  }>;
  manualChecks: Array<{
    description: string;
    result: 'passed' | 'failed' | 'pending';
    checkedBy?: string;
    checkedAt?: Date;
  }>;
}

/**
 * 影響分析
 */
export interface ImpactAnalysis {
  changedFiles: string[];
  affectedFeatures: string[];
  dependencies: string[];
}

/**
 * 破壊的変更情報
 */
export interface BreakingChangeInfo {
  hasBreaking: boolean;
  description?: string;
  migrationRequired?: boolean;
  migrationSteps?: string[];
}

/**
 * Done定義
 */
export interface DoneDefinition {
  taskId: string;
  title: string;
  createdAt: Date;
  requirementsMapping: RequirementStatus[];
  verification: VerificationResult;
  impactAnalysis: ImpactAnalysis;
  breakingChanges: BreakingChangeInfo;
  reproductionCommand: string;
  doneChecklist: string[];
  finalStatus: 'done' | 'blocked' | 'in_progress';
  blockedReason?: string;
}

/**
 * 自己修復設定
 */
export interface SelfHealingConfig {
  maxRetries: number;
  retryDelayMs: number;
  escalationCallback?: (error: Error) => void;
}

/**
 * 修復試行
 */
export interface HealingAttempt {
  attempt: number;
  errorType: 'syntax' | 'type' | 'test' | 'runtime' | 'unknown';
  originalError: string;
  proposedFix: string;
  fixApplied: boolean;
  verificationResult: 'success' | 'failed';
}

/**
 * 修復結果
 */
export interface HealingResult {
  success: boolean;
  attempts: HealingAttempt[];
  finalError?: string;
  escalated: boolean;
}

/**
 * 差分サマリー
 */
export interface DiffSummary {
  changedFiles: number;
  addedLines: number;
  deletedLines: number;
  modifiedLines: number;
}

/**
 * リスク
 */
export interface Risk {
  level: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigation?: string;
}

/**
 * 検収ビュー
 */
export interface AcceptanceView {
  status: 'ready_for_review' | 'blocked' | 'in_progress';
  doneChecklist: Array<{
    item: string;
    checked: boolean;
  }>;
  unmetItems: string[];
  diffSummary: DiffSummary;
  verifyResult: {
    typescript: 'passed' | 'failed';
    tests: 'passed' | 'failed';
    security: 'passed' | 'failed' | 'warning';
    build: 'passed' | 'failed';
  };
  risks: Risk[];
}

/**
 * 要件
 */
export interface Requirement {
  id: string;
  description: string;
  acceptanceCriteria: string[];
  implementation: {
    files: string[];
    functions: string[];
  };
  verification: {
    testFiles: string[];
    commands: string[];
  };
  result: {
    status: 'verified' | 'failed' | 'pending';
    evidence?: string;
    verifiedAt?: Date;
  };
}

/**
 * 要件マトリクス
 */
export interface RequirementsMatrix {
  requirements: Requirement[];
  summary: {
    total: number;
    verified: number;
    failed: number;
    pending: number;
  };
}
