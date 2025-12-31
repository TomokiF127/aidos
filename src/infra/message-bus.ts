/**
 * AIDOS Message Bus
 *
 * EventEmitterベースのメッセージバス実装
 * Agent間の非同期通信を担当
 */

import { EventEmitter } from 'node:events';
import type {
  BusMessage,
  MessageType,
  AgentCreatedPayload,
  AgentStatusChangedPayload,
  TaskProgressPayload,
  LogMessagePayload,
} from '../types.js';

// ========================================
// Types
// ========================================

export type MessageHandler<T = unknown> = (message: BusMessage<T>) => void | Promise<void>;

export interface Subscription {
  unsubscribe: () => void;
}

export interface MessageBusOptions {
  maxListeners?: number;
  enableLogging?: boolean;
}

// Type-safe payload mappings
type PayloadMap = {
  'agent:created': AgentCreatedPayload;
  'agent:status_changed': AgentStatusChangedPayload;
  'task:started': { taskId: string; agentId: string };
  'task:progress': TaskProgressPayload;
  'task:completed': { taskId: string; agentId: string; output: string };
  'task:failed': { taskId: string; agentId: string; error: string };
  'log:message': LogMessagePayload;
  'intervention:requested': { agentId: string; reason: string; context: unknown };
  'session:started': { sessionId: string; objective: string };
  'session:completed': { sessionId: string; status: 'completed' | 'failed' };
};

// ========================================
// Message Bus Class
// ========================================

export class MessageBus {
  private emitter: EventEmitter;
  private enableLogging: boolean;
  private messageHistory: BusMessage[] = [];
  private maxHistorySize = 1000;

  constructor(options: MessageBusOptions = {}) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(options.maxListeners ?? 100);
    this.enableLogging = options.enableLogging ?? false;
  }

  // ========================================
  // Publishing
  // ========================================

  /**
   * メッセージを発行
   */
  publish<T extends MessageType>(
    type: T,
    senderId: string,
    payload: T extends keyof PayloadMap ? PayloadMap[T] : unknown
  ): void {
    const message: BusMessage = {
      type,
      senderId,
      timestamp: new Date(),
      payload,
    };

    // 履歴に追加
    this.addToHistory(message);

    if (this.enableLogging) {
      console.log(`[MessageBus] ${type} from ${senderId}:`, payload);
    }

    // 特定タイプのリスナーに通知
    this.emitter.emit(type, message);

    // ワイルドカードリスナーに通知
    this.emitter.emit('*', message);
  }

  /**
   * 型安全なメッセージ発行ヘルパー
   */
  publishAgentCreated(senderId: string, payload: AgentCreatedPayload): void {
    this.publish('agent:created', senderId, payload);
  }

  publishAgentStatusChanged(senderId: string, payload: AgentStatusChangedPayload): void {
    this.publish('agent:status_changed', senderId, payload);
  }

  publishTaskStarted(senderId: string, payload: { taskId: string; agentId: string }): void {
    this.publish('task:started', senderId, payload);
  }

  publishTaskProgress(senderId: string, payload: TaskProgressPayload): void {
    this.publish('task:progress', senderId, payload);
  }

  publishTaskCompleted(
    senderId: string,
    payload: { taskId: string; agentId: string; output: string }
  ): void {
    this.publish('task:completed', senderId, payload);
  }

  publishTaskFailed(
    senderId: string,
    payload: { taskId: string; agentId: string; error: string }
  ): void {
    this.publish('task:failed', senderId, payload);
  }

  publishLog(senderId: string, payload: LogMessagePayload): void {
    this.publish('log:message', senderId, payload);
  }

  publishInterventionRequested(
    senderId: string,
    payload: { agentId: string; reason: string; context: unknown }
  ): void {
    this.publish('intervention:requested', senderId, payload);
  }

  publishSessionStarted(senderId: string, payload: { sessionId: string; objective: string }): void {
    this.publish('session:started', senderId, payload);
  }

  publishSessionCompleted(
    senderId: string,
    payload: { sessionId: string; status: 'completed' | 'failed' }
  ): void {
    this.publish('session:completed', senderId, payload);
  }

  // ========================================
  // Subscribing
  // ========================================

  /**
   * 特定のメッセージタイプを購読
   */
  subscribe<T extends MessageType>(
    type: T,
    handler: MessageHandler<T extends keyof PayloadMap ? PayloadMap[T] : unknown>
  ): Subscription {
    this.emitter.on(type, handler);

    return {
      unsubscribe: () => {
        this.emitter.off(type, handler);
      },
    };
  }

  /**
   * すべてのメッセージを購読
   */
  subscribeAll(handler: MessageHandler): Subscription {
    this.emitter.on('*', handler);

    return {
      unsubscribe: () => {
        this.emitter.off('*', handler);
      },
    };
  }

  /**
   * 一度だけ購読
   */
  once<T extends MessageType>(
    type: T,
    handler: MessageHandler<T extends keyof PayloadMap ? PayloadMap[T] : unknown>
  ): Subscription {
    const wrappedHandler = (message: BusMessage) => {
      handler(message as BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>);
    };

    this.emitter.once(type, wrappedHandler);

    return {
      unsubscribe: () => {
        this.emitter.off(type, wrappedHandler);
      },
    };
  }

  /**
   * 条件付き購読（フィルター付き）
   */
  subscribeFiltered<T extends MessageType>(
    type: T,
    filter: (message: BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>) => boolean,
    handler: MessageHandler<T extends keyof PayloadMap ? PayloadMap[T] : unknown>
  ): Subscription {
    const wrappedHandler = (message: BusMessage) => {
      if (filter(message as BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>)) {
        handler(message as BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>);
      }
    };

    this.emitter.on(type, wrappedHandler);

    return {
      unsubscribe: () => {
        this.emitter.off(type, wrappedHandler);
      },
    };
  }

  // ========================================
  // Promise-based API
  // ========================================

  /**
   * 次のメッセージを待機
   */
  waitFor<T extends MessageType>(
    type: T,
    timeout?: number
  ): Promise<BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;

      const handler = (message: BusMessage) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(message as BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>);
      };

      this.emitter.once(type, handler);

      if (timeout) {
        timeoutId = setTimeout(() => {
          this.emitter.off(type, handler);
          reject(new Error(`Timeout waiting for message type: ${type}`));
        }, timeout);
      }
    });
  }

  /**
   * 条件を満たすメッセージを待機
   */
  waitForCondition<T extends MessageType>(
    type: T,
    condition: (message: BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>) => boolean,
    timeout?: number
  ): Promise<BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;

      const handler = (message: BusMessage) => {
        if (condition(message as BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>)) {
          if (timeoutId) clearTimeout(timeoutId);
          this.emitter.off(type, handler);
          resolve(message as BusMessage<T extends keyof PayloadMap ? PayloadMap[T] : unknown>);
        }
      };

      this.emitter.on(type, handler);

      if (timeout) {
        timeoutId = setTimeout(() => {
          this.emitter.off(type, handler);
          reject(new Error(`Timeout waiting for condition on message type: ${type}`));
        }, timeout);
      }
    });
  }

  // ========================================
  // History & Debugging
  // ========================================

  private addToHistory(message: BusMessage): void {
    this.messageHistory.push(message);

    // 履歴サイズを制限
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }
  }

  /**
   * メッセージ履歴を取得
   */
  getHistory(options: {
    limit?: number;
    type?: MessageType;
    senderId?: string;
  } = {}): BusMessage[] {
    let history = [...this.messageHistory];

    if (options.type) {
      history = history.filter(m => m.type === options.type);
    }

    if (options.senderId) {
      history = history.filter(m => m.senderId === options.senderId);
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
    this.messageHistory = [];
  }

  /**
   * リスナー数を取得
   */
  getListenerCount(type?: MessageType): number {
    if (type) {
      return this.emitter.listenerCount(type);
    }

    // 全タイプのリスナー数を合計
    const types: MessageType[] = [
      'agent:created',
      'agent:status_changed',
      'task:started',
      'task:progress',
      'task:completed',
      'task:failed',
      'log:message',
      'intervention:requested',
      'session:started',
      'session:completed',
    ];

    return types.reduce((sum, t) => sum + this.emitter.listenerCount(t), 0);
  }

  /**
   * すべてのリスナーを削除
   */
  removeAllListeners(type?: MessageType): void {
    if (type) {
      this.emitter.removeAllListeners(type);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  /**
   * デバッグ情報を取得
   */
  getDebugInfo(): {
    historySize: number;
    listenerCounts: Record<string, number>;
  } {
    const types: MessageType[] = [
      'agent:created',
      'agent:status_changed',
      'task:started',
      'task:progress',
      'task:completed',
      'task:failed',
      'log:message',
      'intervention:requested',
      'session:started',
      'session:completed',
    ];

    const listenerCounts: Record<string, number> = {};
    for (const type of types) {
      listenerCounts[type] = this.emitter.listenerCount(type);
    }
    listenerCounts['*'] = this.emitter.listenerCount('*');

    return {
      historySize: this.messageHistory.length,
      listenerCounts,
    };
  }
}

// ========================================
// Singleton Instance
// ========================================

let busInstance: MessageBus | null = null;

export function getMessageBus(options?: MessageBusOptions): MessageBus {
  if (!busInstance) {
    busInstance = new MessageBus(options);
  }
  return busInstance;
}

export function resetMessageBus(): void {
  if (busInstance) {
    busInstance.removeAllListeners();
    busInstance.clearHistory();
    busInstance = null;
  }
}
