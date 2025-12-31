/**
 * リソース最適化エンジン
 *
 * Worker数に基づくタスクスケジューリング、負荷分散、優先度ベースの実行順序決定を行う。
 */

import { EventEmitter } from 'events';
import { DecomposedTask, TaskCategory, AidosConfig, DEFAULT_CONFIG } from '../types.js';
import { DependencyGraph, ParallelGroup, GraphNode } from './dependency-graph.js';

// ========================================
// Types
// ========================================

/**
 * Worker状態
 */
export interface WorkerState {
  id: string;
  status: 'idle' | 'busy' | 'error';
  currentTaskId: string | null;
  load: number;           // 現在の負荷（0-1）
  completedTasks: number; // 完了タスク数
  totalExecutionTime: number; // 総実行時間
}

/**
 * スケジュールされたタスク
 */
export interface ScheduledTask {
  task: DecomposedTask;
  workerId: string | null;    // 割り当てられたWorker
  scheduledTime: number;      // スケジュール時間（相対）
  estimatedDuration: number;  // 推定所要時間
  priority: number;           // 調整済み優先度
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed';
}

/**
 * スケジュール結果
 */
export interface ScheduleResult {
  scheduledTasks: ScheduledTask[];
  totalEstimatedTime: number;
  workerUtilization: Map<string, number>; // Worker別利用率
  parallelism: number;        // 平均並列度
}

/**
 * 負荷分散戦略
 */
export type LoadBalancingStrategy =
  | 'round_robin'      // ラウンドロビン
  | 'least_loaded'     // 最小負荷優先
  | 'complexity_aware' // 複雑度考慮
  | 'category_aware';  // カテゴリ考慮

/**
 * リソース最適化オプション
 */
export interface ResourceOptimizerOptions {
  maxWorkers: number;
  strategy: LoadBalancingStrategy;
  priorityBoostForCriticalPath: number; // クリティカルパス上のタスクの優先度ブースト
  timeoutMs: number;
  maxRetries: number;
}

/**
 * リソース最適化イベント
 */
export type ResourceOptimizerEvent =
  | 'schedule:created'
  | 'schedule:updated'
  | 'task:assigned'
  | 'task:completed'
  | 'task:failed'
  | 'worker:overloaded'
  | 'optimization:completed';

/**
 * 複雑度から推定時間への変換（ミリ秒）
 */
const COMPLEXITY_DURATION_MS: Record<DecomposedTask['estimatedComplexity'], number> = {
  low: 30000,     // 30秒
  medium: 60000,  // 1分
  high: 180000,   // 3分
};

/**
 * カテゴリ別の推奨Worker特性
 */
const CATEGORY_WORKER_AFFINITY: Record<TaskCategory, string[]> = {
  design: ['general', 'design'],
  implement: ['general', 'code'],
  test: ['general', 'test'],
  document: ['general', 'doc'],
  other: ['general'],
};

// ========================================
// ResourceOptimizer Class
// ========================================

/**
 * リソース最適化エンジン
 */
export class ResourceOptimizer extends EventEmitter {
  private options: ResourceOptimizerOptions;
  private workers: Map<string, WorkerState> = new Map();
  private scheduledTasks: Map<string, ScheduledTask> = new Map();
  private taskQueue: DecomposedTask[] = [];
  private dependencyGraph: DependencyGraph | null = null;
  private roundRobinIndex: number = 0;

  constructor(options: Partial<ResourceOptimizerOptions> = {}) {
    super();
    this.options = {
      maxWorkers: options.maxWorkers ?? 4,
      strategy: options.strategy ?? 'complexity_aware',
      priorityBoostForCriticalPath: options.priorityBoostForCriticalPath ?? 2,
      timeoutMs: options.timeoutMs ?? 300000,
      maxRetries: options.maxRetries ?? 3,
    };

    this.initializeWorkers();
  }

  // ========================================
  // Worker Management
  // ========================================

  /**
   * Workerを初期化
   */
  private initializeWorkers(): void {
    for (let i = 0; i < this.options.maxWorkers; i++) {
      const workerId = `worker_${i}`;
      this.workers.set(workerId, {
        id: workerId,
        status: 'idle',
        currentTaskId: null,
        load: 0,
        completedTasks: 0,
        totalExecutionTime: 0,
      });
    }
  }

  /**
   * Worker数を調整
   */
  setWorkerCount(count: number): void {
    const currentCount = this.workers.size;

    if (count > currentCount) {
      // Workerを追加
      for (let i = currentCount; i < count; i++) {
        const workerId = `worker_${i}`;
        this.workers.set(workerId, {
          id: workerId,
          status: 'idle',
          currentTaskId: null,
          load: 0,
          completedTasks: 0,
          totalExecutionTime: 0,
        });
      }
    } else if (count < currentCount) {
      // アイドルなWorkerを削除
      const workerIds = Array.from(this.workers.keys());
      for (let i = workerIds.length - 1; i >= count; i--) {
        const worker = this.workers.get(workerIds[i]);
        if (worker && worker.status === 'idle') {
          this.workers.delete(workerIds[i]);
        }
      }
    }

    this.options.maxWorkers = count;
  }

  /**
   * Worker状態を取得
   */
  getWorkerStates(): WorkerState[] {
    return Array.from(this.workers.values());
  }

  /**
   * 利用可能なWorkerを取得
   */
  getAvailableWorkers(): WorkerState[] {
    return Array.from(this.workers.values()).filter((w) => w.status === 'idle');
  }

  // ========================================
  // Task Scheduling
  // ========================================

  /**
   * タスクリストからスケジュールを作成
   */
  createSchedule(
    tasks: DecomposedTask[],
    dependencyGraph?: DependencyGraph
  ): ScheduleResult {
    this.dependencyGraph = dependencyGraph ?? null;
    this.scheduledTasks.clear();
    this.taskQueue = [];

    // クリティカルパス上のタスクを特定
    const criticalPathTasks = new Set<string>();
    if (dependencyGraph) {
      const criticalPath = dependencyGraph.getCriticalPath();
      criticalPath.path.forEach((id) => criticalPathTasks.add(id));
    }

    // タスクをスケジュール
    for (const task of tasks) {
      const priority = this.calculateAdjustedPriority(task, criticalPathTasks);
      const estimatedDuration = COMPLEXITY_DURATION_MS[task.estimatedComplexity];

      const scheduledTask: ScheduledTask = {
        task,
        workerId: null,
        scheduledTime: 0,
        estimatedDuration,
        priority,
        status: 'pending',
      };

      this.scheduledTasks.set(task.id, scheduledTask);
    }

    // スケジューリングを実行
    const result = this.runSchedulingAlgorithm();

    this.emit('schedule:created', result);

    return result;
  }

  /**
   * 調整済み優先度を計算
   */
  private calculateAdjustedPriority(
    task: DecomposedTask,
    criticalPathTasks: Set<string>
  ): number {
    let priority = task.priority;

    // クリティカルパス上のタスクはブースト
    if (criticalPathTasks.has(task.id)) {
      priority -= this.options.priorityBoostForCriticalPath;
    }

    // 複雑度が高いタスクは早めに実行
    if (task.estimatedComplexity === 'high') {
      priority -= 1;
    }

    // 依存されているタスクが多い場合は優先
    if (this.dependencyGraph) {
      const node = this.dependencyGraph.getNode(task.id);
      if (node && node.dependents.size >= 2) {
        priority -= 1;
      }
    }

    return Math.max(1, priority);
  }

  /**
   * スケジューリングアルゴリズムを実行
   */
  private runSchedulingAlgorithm(): ScheduleResult {
    const workerTimelines = new Map<string, number>();
    const workerTasks = new Map<string, ScheduledTask[]>();

    // 初期化
    for (const workerId of this.workers.keys()) {
      workerTimelines.set(workerId, 0);
      workerTasks.set(workerId, []);
    }

    // 優先度でソートしたタスクを取得
    const sortedTasks = this.getSortedPendingTasks();

    // 各タスクをWorkerに割り当て
    for (const scheduledTask of sortedTasks) {
      const workerId = this.selectWorker(scheduledTask, workerTimelines);
      const currentTime = workerTimelines.get(workerId) || 0;

      // 依存関係を考慮した開始時間を計算
      let startTime = currentTime;
      for (const depId of scheduledTask.task.dependencies) {
        const depTask = this.scheduledTasks.get(depId);
        if (depTask) {
          const depEndTime = depTask.scheduledTime + depTask.estimatedDuration;
          startTime = Math.max(startTime, depEndTime);
        }
      }

      scheduledTask.workerId = workerId;
      scheduledTask.scheduledTime = startTime;
      scheduledTask.status = 'scheduled';

      // タイムラインを更新
      workerTimelines.set(workerId, startTime + scheduledTask.estimatedDuration);
      workerTasks.get(workerId)?.push(scheduledTask);
    }

    // 結果を計算
    const totalEstimatedTime = Math.max(...workerTimelines.values());
    const workerUtilization = this.calculateWorkerUtilization(workerTasks, totalEstimatedTime);
    const parallelism = this.calculateAverageParallelism(sortedTasks, totalEstimatedTime);

    return {
      scheduledTasks: Array.from(this.scheduledTasks.values()),
      totalEstimatedTime,
      workerUtilization,
      parallelism,
    };
  }

  /**
   * ペンディングタスクを優先度順に取得
   */
  private getSortedPendingTasks(): ScheduledTask[] {
    return Array.from(this.scheduledTasks.values())
      .filter((t) => t.status === 'pending')
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * タスクに最適なWorkerを選択
   */
  private selectWorker(
    task: ScheduledTask,
    workerTimelines: Map<string, number>
  ): string {
    switch (this.options.strategy) {
      case 'round_robin':
        return this.selectWorkerRoundRobin();

      case 'least_loaded':
        return this.selectWorkerLeastLoaded(workerTimelines);

      case 'complexity_aware':
        return this.selectWorkerComplexityAware(task, workerTimelines);

      case 'category_aware':
        return this.selectWorkerCategoryAware(task, workerTimelines);

      default:
        return this.selectWorkerLeastLoaded(workerTimelines);
    }
  }

  /**
   * ラウンドロビンでWorkerを選択
   */
  private selectWorkerRoundRobin(): string {
    const workerIds = Array.from(this.workers.keys());
    const workerId = workerIds[this.roundRobinIndex % workerIds.length];
    this.roundRobinIndex++;
    return workerId;
  }

  /**
   * 最小負荷のWorkerを選択
   */
  private selectWorkerLeastLoaded(workerTimelines: Map<string, number>): string {
    let minLoad = Infinity;
    let selectedWorker = '';

    for (const [workerId, timeline] of workerTimelines) {
      if (timeline < minLoad) {
        minLoad = timeline;
        selectedWorker = workerId;
      }
    }

    return selectedWorker;
  }

  /**
   * 複雑度を考慮してWorkerを選択
   */
  private selectWorkerComplexityAware(
    task: ScheduledTask,
    workerTimelines: Map<string, number>
  ): string {
    // 高複雑度タスクは負荷の低いWorkerに割り当て
    if (task.task.estimatedComplexity === 'high') {
      return this.selectWorkerLeastLoaded(workerTimelines);
    }

    // 低複雑度タスクは負荷分散のためラウンドロビン
    if (task.task.estimatedComplexity === 'low') {
      return this.selectWorkerRoundRobin();
    }

    // 中複雑度は最小負荷
    return this.selectWorkerLeastLoaded(workerTimelines);
  }

  /**
   * カテゴリを考慮してWorkerを選択
   */
  private selectWorkerCategoryAware(
    task: ScheduledTask,
    workerTimelines: Map<string, number>
  ): string {
    // 現時点ではWorkerに特性がないため、最小負荷を使用
    // 将来的にWorkerにタグ/特性を追加して最適化可能
    return this.selectWorkerLeastLoaded(workerTimelines);
  }

  /**
   * Worker利用率を計算
   */
  private calculateWorkerUtilization(
    workerTasks: Map<string, ScheduledTask[]>,
    totalTime: number
  ): Map<string, number> {
    const utilization = new Map<string, number>();

    for (const [workerId, tasks] of workerTasks) {
      const busyTime = tasks.reduce((sum, t) => sum + t.estimatedDuration, 0);
      utilization.set(workerId, totalTime > 0 ? busyTime / totalTime : 0);
    }

    return utilization;
  }

  /**
   * 平均並列度を計算
   */
  private calculateAverageParallelism(
    tasks: ScheduledTask[],
    totalTime: number
  ): number {
    if (totalTime === 0 || tasks.length === 0) return 0;

    // 各時点での実行中タスク数をサンプリング
    const samplePoints = 100;
    let totalParallelism = 0;

    for (let i = 0; i < samplePoints; i++) {
      const time = (totalTime / samplePoints) * i;
      let runningCount = 0;

      for (const task of tasks) {
        const endTime = task.scheduledTime + task.estimatedDuration;
        if (task.scheduledTime <= time && time < endTime) {
          runningCount++;
        }
      }

      totalParallelism += runningCount;
    }

    return totalParallelism / samplePoints;
  }

  // ========================================
  // Runtime Task Management
  // ========================================

  /**
   * 次に実行すべきタスクを取得
   */
  getNextTasks(completedTaskIds: Set<string>): DecomposedTask[] {
    const readyTasks: DecomposedTask[] = [];

    for (const [taskId, scheduled] of this.scheduledTasks) {
      if (scheduled.status !== 'pending' && scheduled.status !== 'scheduled') {
        continue;
      }

      // 依存関係をチェック
      let allDependenciesMet = true;
      for (const depId of scheduled.task.dependencies) {
        if (!completedTaskIds.has(depId)) {
          allDependenciesMet = false;
          break;
        }
      }

      if (allDependenciesMet) {
        readyTasks.push(scheduled.task);
      }
    }

    // 利用可能なWorker数に制限
    const availableWorkers = this.getAvailableWorkers().length;
    return readyTasks.slice(0, availableWorkers);
  }

  /**
   * タスクをWorkerに割り当て
   */
  assignTask(taskId: string, workerId: string): boolean {
    const scheduled = this.scheduledTasks.get(taskId);
    const worker = this.workers.get(workerId);

    if (!scheduled || !worker) return false;
    if (worker.status !== 'idle') return false;

    scheduled.workerId = workerId;
    scheduled.status = 'running';

    worker.status = 'busy';
    worker.currentTaskId = taskId;
    worker.load = 1;

    this.emit('task:assigned', { taskId, workerId });

    return true;
  }

  /**
   * タスク完了を記録
   */
  completeTask(taskId: string, executionTimeMs: number): void {
    const scheduled = this.scheduledTasks.get(taskId);
    if (!scheduled) return;

    scheduled.status = 'completed';

    if (scheduled.workerId) {
      const worker = this.workers.get(scheduled.workerId);
      if (worker) {
        worker.status = 'idle';
        worker.currentTaskId = null;
        worker.load = 0;
        worker.completedTasks++;
        worker.totalExecutionTime += executionTimeMs;
      }
    }

    this.emit('task:completed', { taskId, executionTimeMs });
  }

  /**
   * タスク失敗を記録
   */
  failTask(taskId: string, error: Error): void {
    const scheduled = this.scheduledTasks.get(taskId);
    if (!scheduled) return;

    scheduled.status = 'failed';

    if (scheduled.workerId) {
      const worker = this.workers.get(scheduled.workerId);
      if (worker) {
        worker.status = 'idle';
        worker.currentTaskId = null;
        worker.load = 0;
      }
    }

    this.emit('task:failed', { taskId, error: error.message });
  }

  // ========================================
  // Load Balancing
  // ========================================

  /**
   * 現在の負荷分散状態を取得
   */
  getLoadDistribution(): { workerId: string; load: number; taskCount: number }[] {
    return Array.from(this.workers.values()).map((worker) => ({
      workerId: worker.id,
      load: worker.load,
      taskCount: worker.completedTasks,
    }));
  }

  /**
   * 負荷が偏っているかチェック
   */
  isLoadImbalanced(threshold: number = 0.3): boolean {
    const loads = Array.from(this.workers.values()).map((w) => w.totalExecutionTime);
    if (loads.length < 2) return false;

    const maxLoad = Math.max(...loads);
    const minLoad = Math.min(...loads);

    if (maxLoad === 0) return false;

    return (maxLoad - minLoad) / maxLoad > threshold;
  }

  /**
   * 負荷を再分散
   */
  rebalance(): void {
    // 現時点では実行中タスクの移動は複雑なため、
    // 新規タスクの割り当て時に自動的にバランスされる
    // 将来的にはタスクマイグレーションを実装可能
  }

  // ========================================
  // Statistics
  // ========================================

  /**
   * スケジューリング統計を取得
   */
  getStatistics(): {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    runningTasks: number;
    pendingTasks: number;
    averageWorkerUtilization: number;
    estimatedRemainingTime: number;
  } {
    const tasks = Array.from(this.scheduledTasks.values());

    const completed = tasks.filter((t) => t.status === 'completed').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    const running = tasks.filter((t) => t.status === 'running').length;
    const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'scheduled').length;

    // 平均Worker利用率
    const workers = Array.from(this.workers.values());
    const busyWorkers = workers.filter((w) => w.status === 'busy').length;
    const avgUtilization = workers.length > 0 ? busyWorkers / workers.length : 0;

    // 残り時間推定
    const remainingTime = tasks
      .filter((t) => t.status === 'pending' || t.status === 'scheduled')
      .reduce((sum, t) => sum + t.estimatedDuration, 0);

    const activeWorkers = Math.max(1, busyWorkers);
    const estimatedRemainingTime = remainingTime / activeWorkers;

    return {
      totalTasks: tasks.length,
      completedTasks: completed,
      failedTasks: failed,
      runningTasks: running,
      pendingTasks: pending,
      averageWorkerUtilization: avgUtilization,
      estimatedRemainingTime,
    };
  }

  /**
   * Worker統計を取得
   */
  getWorkerStatistics(): {
    workerId: string;
    completedTasks: number;
    totalExecutionTime: number;
    averageTaskTime: number;
  }[] {
    return Array.from(this.workers.values()).map((worker) => ({
      workerId: worker.id,
      completedTasks: worker.completedTasks,
      totalExecutionTime: worker.totalExecutionTime,
      averageTaskTime:
        worker.completedTasks > 0
          ? worker.totalExecutionTime / worker.completedTasks
          : 0,
    }));
  }

  // ========================================
  // Reset
  // ========================================

  /**
   * オプティマイザーをリセット
   */
  reset(): void {
    this.scheduledTasks.clear();
    this.taskQueue = [];
    this.roundRobinIndex = 0;

    for (const worker of this.workers.values()) {
      worker.status = 'idle';
      worker.currentTaskId = null;
      worker.load = 0;
      worker.completedTasks = 0;
      worker.totalExecutionTime = 0;
    }
  }
}

// ========================================
// Factory Functions
// ========================================

/**
 * リソースオプティマイザーを作成
 */
export function createResourceOptimizer(
  options?: Partial<ResourceOptimizerOptions>
): ResourceOptimizer {
  return new ResourceOptimizer(options);
}

/**
 * 設定からリソースオプティマイザーを作成
 */
export function createResourceOptimizerFromConfig(
  config: Partial<AidosConfig> = {}
): ResourceOptimizer {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  return new ResourceOptimizer({
    maxWorkers: mergedConfig.agents.maxConcurrent,
    timeoutMs: mergedConfig.agents.timeoutMs,
  });
}
