/**
 * AIDOS Worker Pool
 *
 * Worker Threadsを管理するワーカープール
 * AIエージェントの並列実行を担当
 */

import { Worker, isMainThread, parentPort, workerData, MessagePort } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { AgentRole, AgentStatus } from '../types.js';

// ========================================
// Types
// ========================================

export interface WorkerConfig {
  id: string;
  role: AgentRole;
  mission: string;
  sessionId: string;
  parentId?: string;
  workerScript?: string;
}

export type WorkerMessageType =
  | 'status'
  | 'thinking'
  | 'executing'
  | 'progress'
  | 'result'
  | 'error'
  | 'log'
  | 'spawn_request';

export interface WorkerMessage {
  type: WorkerMessageType;
  workerId: string;
  timestamp: Date;
  data: unknown;
}

export interface WorkerResult {
  workerId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
}

export interface WorkerPoolOptions {
  maxWorkers?: number;
  timeoutMs?: number;
  defaultScript?: string;
}

interface ManagedWorker {
  worker: Worker;
  config: WorkerConfig;
  status: AgentStatus;
  startTime: Date;
  timeoutId?: NodeJS.Timeout;
}

// ========================================
// Worker Pool Class
// ========================================

export class WorkerPool extends EventEmitter {
  private workers: Map<string, ManagedWorker> = new Map();
  private results: Map<string, WorkerResult> = new Map();
  private maxWorkers: number;
  private timeoutMs: number;
  private defaultScript: string;
  private pendingQueue: WorkerConfig[] = [];

  constructor(options: WorkerPoolOptions = {}) {
    super();
    this.maxWorkers = options.maxWorkers ?? 5;
    this.timeoutMs = options.timeoutMs ?? 300000; // 5分
    this.defaultScript = options.defaultScript ?? '';
  }

  // ========================================
  // Worker Management
  // ========================================

  /**
   * ワーカーを起動
   */
  async spawn(config: WorkerConfig): Promise<WorkerResult> {
    // 最大数チェック
    if (this.workers.size >= this.maxWorkers) {
      this.pendingQueue.push(config);
      return this.waitForResult(config.id);
    }

    return this.startWorker(config);
  }

  private async startWorker(config: WorkerConfig): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const workerScript = config.workerScript ?? this.defaultScript;

      if (!workerScript) {
        reject(new Error('Worker script not specified'));
        return;
      }

      const worker = new Worker(workerScript, {
        workerData: config,
      });

      const managedWorker: ManagedWorker = {
        worker,
        config,
        status: 'idle',
        startTime: new Date(),
      };

      // タイムアウト設定
      managedWorker.timeoutId = setTimeout(() => {
        this.handleTimeout(config.id);
      }, this.timeoutMs);

      // メッセージハンドリング
      worker.on('message', (msg: WorkerMessage) => {
        this.handleMessage(config.id, msg);

        if (msg.type === 'result' || msg.type === 'error') {
          const result = this.createResult(config.id, msg);
          this.results.set(config.id, result);
          this.cleanup(config.id);
          resolve(result);
        }
      });

      worker.on('error', (error) => {
        const result: WorkerResult = {
          workerId: config.id,
          success: false,
          error: error.message,
          duration: Date.now() - managedWorker.startTime.getTime(),
        };
        this.results.set(config.id, result);
        this.cleanup(config.id);
        resolve(result);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && !this.results.has(config.id)) {
          const result: WorkerResult = {
            workerId: config.id,
            success: false,
            error: `Worker exited with code ${code}`,
            duration: Date.now() - managedWorker.startTime.getTime(),
          };
          this.results.set(config.id, result);
          resolve(result);
        }
        this.cleanup(config.id);
      });

      this.workers.set(config.id, managedWorker);
      this.emit('worker:spawned', config);
    });
  }

  private async waitForResult(workerId: string): Promise<WorkerResult> {
    return new Promise((resolve) => {
      const checkResult = () => {
        const result = this.results.get(workerId);
        if (result) {
          resolve(result);
        } else if (this.pendingQueue.some(c => c.id === workerId)) {
          // まだキューにある場合は待機
          setTimeout(checkResult, 100);
        }
      };

      // キューが処理されるのを監視
      this.on('worker:completed', (completedId: string) => {
        if (completedId === workerId) {
          checkResult();
        } else {
          // 他のワーカーが完了したらキューを処理
          this.processQueue();
        }
      });

      checkResult();
    });
  }

  private processQueue(): void {
    if (this.pendingQueue.length > 0 && this.workers.size < this.maxWorkers) {
      const config = this.pendingQueue.shift()!;
      this.startWorker(config);
    }
  }

  private handleMessage(workerId: string, msg: WorkerMessage): void {
    const managed = this.workers.get(workerId);
    if (!managed) return;

    // ステータス更新
    switch (msg.type) {
      case 'status':
        managed.status = msg.data as AgentStatus;
        break;
      case 'thinking':
        managed.status = 'thinking';
        break;
      case 'executing':
        managed.status = 'executing';
        break;
      case 'spawn_request':
        // 子ワーカー生成リクエスト
        this.emit('spawn_request', {
          parentId: workerId,
          config: msg.data as WorkerConfig,
        });
        break;
    }

    // イベント発火
    this.emit('worker:message', {
      workerId,
      message: msg,
    });
  }

  private handleTimeout(workerId: string): void {
    const managed = this.workers.get(workerId);
    if (!managed) return;

    const result: WorkerResult = {
      workerId,
      success: false,
      error: 'Worker timeout',
      duration: this.timeoutMs,
    };

    this.results.set(workerId, result);
    managed.worker.terminate();
    this.cleanup(workerId);

    this.emit('worker:timeout', workerId);
  }

  private createResult(workerId: string, msg: WorkerMessage): WorkerResult {
    const managed = this.workers.get(workerId);
    const duration = managed
      ? Date.now() - managed.startTime.getTime()
      : 0;

    if (msg.type === 'error') {
      return {
        workerId,
        success: false,
        error: msg.data as string,
        duration,
      };
    }

    return {
      workerId,
      success: true,
      output: msg.data,
      duration,
    };
  }

  private cleanup(workerId: string): void {
    const managed = this.workers.get(workerId);
    if (managed) {
      if (managed.timeoutId) {
        clearTimeout(managed.timeoutId);
      }
      this.workers.delete(workerId);
      this.emit('worker:completed', workerId);
      this.processQueue();
    }
  }

  // ========================================
  // Batch Operations
  // ========================================

  /**
   * 複数のワーカーを並列起動
   */
  async spawnAll(configs: WorkerConfig[]): Promise<Map<string, WorkerResult>> {
    const promises = configs.map(config => this.spawn(config));
    const results = await Promise.all(promises);

    const resultMap = new Map<string, WorkerResult>();
    for (const result of results) {
      resultMap.set(result.workerId, result);
    }

    return resultMap;
  }

  /**
   * すべてのワーカーを終了
   */
  async terminateAll(): Promise<void> {
    const terminatePromises: Promise<void>[] = [];

    for (const [workerId, managed] of this.workers) {
      terminatePromises.push(
        new Promise<void>((resolve) => {
          managed.worker.once('exit', () => resolve());
          managed.worker.terminate();
          this.cleanup(workerId);
        })
      );
    }

    await Promise.all(terminatePromises);
    this.pendingQueue = [];
  }

  // ========================================
  // Status & Information
  // ========================================

  /**
   * ワーカーの状態を取得
   */
  getWorkerStatus(workerId: string): AgentStatus | null {
    const managed = this.workers.get(workerId);
    return managed?.status ?? null;
  }

  /**
   * アクティブなワーカー数
   */
  get activeCount(): number {
    return this.workers.size;
  }

  /**
   * キュー内のワーカー数
   */
  get queuedCount(): number {
    return this.pendingQueue.length;
  }

  /**
   * 結果を取得
   */
  getResult(workerId: string): WorkerResult | undefined {
    return this.results.get(workerId);
  }

  /**
   * すべての結果を取得
   */
  getAllResults(): Map<string, WorkerResult> {
    return new Map(this.results);
  }

  /**
   * アクティブなワーカーのIDリストを取得
   */
  getActiveWorkerIds(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * ワーカー情報を取得
   */
  getWorkerInfo(workerId: string): {
    config: WorkerConfig;
    status: AgentStatus;
    runningTime: number;
  } | null {
    const managed = this.workers.get(workerId);
    if (!managed) return null;

    return {
      config: managed.config,
      status: managed.status,
      runningTime: Date.now() - managed.startTime.getTime(),
    };
  }

  /**
   * プールの統計情報
   */
  getStats(): {
    active: number;
    queued: number;
    completed: number;
    maxWorkers: number;
  } {
    return {
      active: this.workers.size,
      queued: this.pendingQueue.length,
      completed: this.results.size,
      maxWorkers: this.maxWorkers,
    };
  }

  /**
   * 結果をクリア
   */
  clearResults(): void {
    this.results.clear();
  }
}

// ========================================
// Worker Side Helpers
// ========================================

/**
 * ワーカースレッド側で使用するヘルパー
 */
export class WorkerContext {
  private port: MessagePort;
  private config: WorkerConfig;

  constructor() {
    if (isMainThread) {
      throw new Error('WorkerContext must be used in a worker thread');
    }

    if (!parentPort) {
      throw new Error('parentPort is not available');
    }

    this.port = parentPort;
    this.config = workerData as WorkerConfig;
  }

  get id(): string {
    return this.config.id;
  }

  get role(): AgentRole {
    return this.config.role;
  }

  get mission(): string {
    return this.config.mission;
  }

  get sessionId(): string {
    return this.config.sessionId;
  }

  get parentId(): string | undefined {
    return this.config.parentId;
  }

  /**
   * ステータス通知
   */
  sendStatus(status: AgentStatus): void {
    this.send('status', status);
  }

  /**
   * 思考中通知
   */
  sendThinking(message: string): void {
    this.send('thinking', message);
  }

  /**
   * 実行中通知
   */
  sendExecuting(message: string): void {
    this.send('executing', message);
  }

  /**
   * 進捗通知
   */
  sendProgress(progress: number, message?: string): void {
    this.send('progress', { progress, message });
  }

  /**
   * 結果を返す
   */
  sendResult(output: unknown): void {
    this.send('result', output);
  }

  /**
   * エラーを返す
   */
  sendError(error: string | Error): void {
    const errorMessage = error instanceof Error ? error.message : error;
    this.send('error', errorMessage);
  }

  /**
   * ログを送信
   */
  sendLog(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    this.send('log', { level, message });
  }

  /**
   * 子ワーカー生成リクエスト
   */
  requestSpawn(childConfig: Omit<WorkerConfig, 'parentId'>): void {
    this.send('spawn_request', {
      ...childConfig,
      parentId: this.config.id,
    });
  }

  private send(type: WorkerMessageType, data: unknown): void {
    const message: WorkerMessage = {
      type,
      workerId: this.config.id,
      timestamp: new Date(),
      data,
    };
    this.port.postMessage(message);
  }
}

// ========================================
// Utility Functions
// ========================================

/**
 * メインスレッドかどうかを確認
 */
export function isMain(): boolean {
  return isMainThread;
}

/**
 * ワーカースレッドかどうかを確認
 */
export function isWorker(): boolean {
  return !isMainThread;
}

/**
 * ワーカーコンテキストを取得（ワーカー側でのみ使用可能）
 */
export function getWorkerContext(): WorkerContext {
  return new WorkerContext();
}

// ========================================
// Singleton Instance
// ========================================

let poolInstance: WorkerPool | null = null;

export function getWorkerPool(options?: WorkerPoolOptions): WorkerPool {
  if (!poolInstance) {
    poolInstance = new WorkerPool(options);
  }
  return poolInstance;
}

export async function resetWorkerPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.terminateAll();
    poolInstance.removeAllListeners();
    poolInstance = null;
  }
}
