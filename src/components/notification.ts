/**
 * AIDOS Notification Component
 *
 * 通知システムコンポーネント
 * - トースト通知
 * - 警告・エラー表示
 * - 進捗通知
 */

import blessed from 'blessed';
import { EventEmitter } from 'node:events';

// ========================================
// 型定義
// ========================================

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'progress';

export type NotificationPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  progress?: number;
  createdAt: Date;
  duration: number;
  dismissible: boolean;
  persistent: boolean;
}

export interface NotificationConfig {
  type?: NotificationType;
  title?: string;
  message: string;
  duration?: number;
  dismissible?: boolean;
  persistent?: boolean;
  progress?: number;
  onClick?: () => void;
}

export interface NotificationManagerConfig {
  position?: NotificationPosition;
  maxVisible?: number;
  defaultDuration?: number;
  stackSpacing?: number;
}

// ========================================
// スタイル定義
// ========================================

const NOTIFICATION_STYLES: Record<NotificationType, { borderColor: string; icon: string; titleColor: string }> = {
  info: {
    borderColor: 'cyan',
    icon: '[i]',
    titleColor: 'cyan',
  },
  success: {
    borderColor: 'green',
    icon: '[v]',
    titleColor: 'green',
  },
  warning: {
    borderColor: 'yellow',
    icon: '[!]',
    titleColor: 'yellow',
  },
  error: {
    borderColor: 'red',
    icon: '[x]',
    titleColor: 'red',
  },
  progress: {
    borderColor: 'blue',
    icon: '[~]',
    titleColor: 'blue',
  },
};

// ========================================
// NotificationToast クラス
// ========================================

/**
 * 単一のトースト通知を表現
 */
export class NotificationToast {
  private box: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private notification: Notification;
  private progressBar: blessed.Widgets.ProgressBarElement | null = null;
  private timer: NodeJS.Timeout | null = null;
  private onDismiss: () => void;

  constructor(
    screen: blessed.Widgets.Screen,
    notification: Notification,
    position: { top: number | string; right: number | string },
    onDismiss: () => void
  ) {
    this.screen = screen;
    this.notification = notification;
    this.onDismiss = onDismiss;

    const style = NOTIFICATION_STYLES[notification.type];

    // トーストボックス作成
    this.box = blessed.box({
      parent: screen,
      top: position.top,
      right: position.right,
      width: 40,
      height: notification.type === 'progress' ? 6 : 5,
      label: ` ${style.icon} ${notification.title} `,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: style.borderColor,
        },
      },
      tags: true,
    });

    // メッセージ
    blessed.text({
      parent: this.box,
      top: 0,
      left: 1,
      width: '90%',
      height: 2,
      content: notification.message,
      tags: true,
    });

    // 進捗バー（プログレス通知の場合）
    if (notification.type === 'progress') {
      this.progressBar = blessed.progressbar({
        parent: this.box,
        top: 2,
        left: 1,
        width: '90%',
        height: 1,
        style: {
          bar: {
            bg: 'blue',
          },
        },
        filled: notification.progress ?? 0,
        orientation: 'horizontal',
      });
    }

    // 閉じるボタン（dismissible の場合）
    if (notification.dismissible) {
      const closeBtn = blessed.button({
        parent: this.box,
        top: 0,
        right: 1,
        width: 3,
        height: 1,
        content: 'x',
        style: {
          fg: 'gray',
          hover: {
            fg: 'red',
          },
        },
      });

      closeBtn.on('press', () => this.dismiss());
    }

    // 自動消去タイマー（persistent でない場合）
    if (!notification.persistent && notification.duration > 0) {
      this.timer = setTimeout(() => {
        this.dismiss();
      }, notification.duration);
    }

    screen.render();
  }

  /**
   * 進捗を更新
   */
  updateProgress(progress: number): void {
    if (this.progressBar) {
      this.progressBar.setProgress(Math.max(0, Math.min(100, progress)));
      this.notification.progress = progress;
      this.screen.render();
    }
  }

  /**
   * メッセージを更新
   */
  updateMessage(message: string): void {
    this.notification.message = message;
    const textEl = this.box.children[0] as blessed.Widgets.TextElement;
    if (textEl) {
      textEl.setContent(message);
      this.screen.render();
    }
  }

  /**
   * 位置を更新
   */
  updatePosition(top: number | string): void {
    this.box.top = top;
    this.screen.render();
  }

  /**
   * 通知を消去
   */
  dismiss(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.box.destroy();
    this.screen.render();
    this.onDismiss();
  }

  /**
   * 通知IDを取得
   */
  getId(): string {
    return this.notification.id;
  }

  /**
   * 高さを取得
   */
  getHeight(): number {
    return this.notification.type === 'progress' ? 6 : 5;
  }

  /**
   * 破棄
   */
  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.box.destroy();
  }
}

// ========================================
// NotificationManager クラス
// ========================================

/**
 * 通知を管理するマネージャー
 */
export class NotificationManager extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private config: Required<NotificationManagerConfig>;
  private toasts: Map<string, NotificationToast> = new Map();
  private notificationQueue: Notification[] = [];
  private idCounter: number = 0;

  constructor(screen: blessed.Widgets.Screen, config: NotificationManagerConfig = {}) {
    super();
    this.screen = screen;
    this.config = {
      position: config.position ?? 'top-right',
      maxVisible: config.maxVisible ?? 5,
      defaultDuration: config.defaultDuration ?? 5000,
      stackSpacing: config.stackSpacing ?? 1,
    };
  }

  /**
   * 通知を表示
   */
  show(config: NotificationConfig): string {
    const id = `notification-${++this.idCounter}`;

    const notification: Notification = {
      id,
      type: config.type ?? 'info',
      title: config.title ?? this.getDefaultTitle(config.type ?? 'info'),
      message: config.message,
      progress: config.progress,
      createdAt: new Date(),
      duration: config.duration ?? this.config.defaultDuration,
      dismissible: config.dismissible ?? true,
      persistent: config.persistent ?? false,
    };

    // キューに追加
    this.notificationQueue.push(notification);
    this.emit('notification:created', notification);

    // 表示を更新
    this.updateDisplay();

    return id;
  }

  /**
   * 情報通知
   */
  info(message: string, title?: string): string {
    return this.show({ type: 'info', message, title });
  }

  /**
   * 成功通知
   */
  success(message: string, title?: string): string {
    return this.show({ type: 'success', message, title });
  }

  /**
   * 警告通知
   */
  warning(message: string, title?: string): string {
    return this.show({ type: 'warning', message, title });
  }

  /**
   * エラー通知
   */
  error(message: string, title?: string): string {
    return this.show({
      type: 'error',
      message,
      title,
      duration: 10000, // エラーは長めに表示
    });
  }

  /**
   * 進捗通知を作成
   */
  progress(message: string, title?: string, initialProgress: number = 0): string {
    return this.show({
      type: 'progress',
      message,
      title,
      progress: initialProgress,
      persistent: true, // 進捗通知は永続
      dismissible: false,
    });
  }

  /**
   * 進捗を更新
   */
  updateProgress(id: string, progress: number, message?: string): void {
    const toast = this.toasts.get(id);
    if (toast) {
      toast.updateProgress(progress);
      if (message) {
        toast.updateMessage(message);
      }
      this.emit('notification:progress', { id, progress, message });

      // 100%になったら自動消去
      if (progress >= 100) {
        setTimeout(() => this.dismiss(id), 2000);
      }
    }
  }

  /**
   * 通知を消去
   */
  dismiss(id: string): void {
    const toast = this.toasts.get(id);
    if (toast) {
      toast.dismiss();
      // onDismissコールバックで処理されるので、ここでは何もしない
    } else {
      // キューからも削除
      this.notificationQueue = this.notificationQueue.filter(n => n.id !== id);
    }
  }

  /**
   * すべての通知を消去
   */
  dismissAll(): void {
    for (const toast of this.toasts.values()) {
      toast.destroy();
    }
    this.toasts.clear();
    this.notificationQueue = [];
    this.screen.render();
  }

  /**
   * 表示を更新
   */
  private updateDisplay(): void {
    // 表示可能な数を超えている場合、古いものを削除
    while (this.toasts.size >= this.config.maxVisible && this.notificationQueue.length > 0) {
      const oldest = Array.from(this.toasts.entries())[0];
      if (oldest) {
        oldest[1].dismiss();
      }
    }

    // 新しい通知を表示
    while (this.toasts.size < this.config.maxVisible && this.notificationQueue.length > 0) {
      const notification = this.notificationQueue.shift()!;
      this.createToast(notification);
    }

    // 位置を再計算
    this.repositionToasts();
  }

  /**
   * トーストを作成
   */
  private createToast(notification: Notification): void {
    const position = this.calculatePosition(this.toasts.size);

    const toast = new NotificationToast(
      this.screen,
      notification,
      position,
      () => {
        this.toasts.delete(notification.id);
        this.emit('notification:dismissed', notification.id);
        this.updateDisplay();
      }
    );

    this.toasts.set(notification.id, toast);
    this.emit('notification:shown', notification);
  }

  /**
   * 位置を計算
   */
  private calculatePosition(index: number): { top: number | string; right: number | string } {
    const baseTop = this.getBaseTop();
    const toastHeight = 5;
    const offset = index * (toastHeight + this.config.stackSpacing);

    return {
      top: baseTop + offset,
      right: this.getBaseRight(),
    };
  }

  /**
   * 基準となる上位置を取得
   */
  private getBaseTop(): number {
    switch (this.config.position) {
      case 'top-left':
      case 'top-center':
      case 'top-right':
        return 1;
      case 'bottom-left':
      case 'bottom-center':
      case 'bottom-right':
        return (this.screen.height as number) - 10;
      default:
        return 1;
    }
  }

  /**
   * 基準となる右位置を取得
   */
  private getBaseRight(): number | string {
    switch (this.config.position) {
      case 'top-left':
      case 'bottom-left':
        return '60%';
      case 'top-center':
      case 'bottom-center':
        return '30%';
      case 'top-right':
      case 'bottom-right':
      default:
        return 1;
    }
  }

  /**
   * トーストの位置を再計算
   */
  private repositionToasts(): void {
    const toastArray = Array.from(this.toasts.values());
    let currentTop = this.getBaseTop();

    for (const toast of toastArray) {
      toast.updatePosition(currentTop);
      currentTop += toast.getHeight() + this.config.stackSpacing;
    }
  }

  /**
   * デフォルトタイトルを取得
   */
  private getDefaultTitle(type: NotificationType): string {
    switch (type) {
      case 'info':
        return 'Information';
      case 'success':
        return 'Success';
      case 'warning':
        return 'Warning';
      case 'error':
        return 'Error';
      case 'progress':
        return 'Progress';
    }
  }

  /**
   * 表示中の通知数を取得
   */
  getVisibleCount(): number {
    return this.toasts.size;
  }

  /**
   * キュー内の通知数を取得
   */
  getQueuedCount(): number {
    return this.notificationQueue.length;
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.dismissAll();
    this.removeAllListeners();
  }
}

// ========================================
// StatusBar クラス
// ========================================

/**
 * ステータスバー表示
 */
export class StatusBar {
  private box: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private sections: Map<string, string> = new Map();

  constructor(screen: blessed.Widgets.Screen, position: 'top' | 'bottom' = 'bottom') {
    this.screen = screen;

    this.box = blessed.box({
      parent: screen,
      top: position === 'top' ? 0 : undefined,
      bottom: position === 'bottom' ? 0 : undefined,
      left: 0,
      width: '100%',
      height: 1,
      style: {
        fg: 'white',
        bg: 'blue',
      },
      tags: true,
    });
  }

  /**
   * セクションを設定
   */
  setSection(id: string, content: string): void {
    this.sections.set(id, content);
    this.updateContent();
  }

  /**
   * セクションを削除
   */
  removeSection(id: string): void {
    this.sections.delete(id);
    this.updateContent();
  }

  /**
   * ステータスを設定（全体）
   */
  setStatus(status: string): void {
    this.box.setContent(` ${status}`);
    this.screen.render();
  }

  /**
   * コンテンツを更新
   */
  private updateContent(): void {
    const parts = Array.from(this.sections.values());
    this.box.setContent(' ' + parts.join(' | '));
    this.screen.render();
  }

  /**
   * 一時的なメッセージを表示
   */
  flash(message: string, duration: number = 3000): void {
    const originalContent = this.box.getContent();
    this.box.setContent(` ${message}`);
    this.screen.render();

    setTimeout(() => {
      this.box.setContent(originalContent);
      this.screen.render();
    }, duration);
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.box.destroy();
  }
}

// ========================================
// ヘルパー関数
// ========================================

/**
 * 簡易通知を表示
 */
export function notify(
  screen: blessed.Widgets.Screen,
  message: string,
  type: NotificationType = 'info'
): void {
  const manager = new NotificationManager(screen);
  manager.show({ type, message });
}

/**
 * 確認付き通知を表示
 */
export async function notifyWithConfirm(
  screen: blessed.Widgets.Screen,
  message: string,
  type: NotificationType = 'info'
): Promise<void> {
  return new Promise((resolve) => {
    const box = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 7,
      label: ` ${NOTIFICATION_STYLES[type].icon} ${type.charAt(0).toUpperCase() + type.slice(1)} `,
      content: `\n  ${message}\n\n  {gray-fg}Press any key to continue...{/gray-fg}`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: NOTIFICATION_STYLES[type].borderColor,
        },
      },
      tags: true,
    });

    screen.render();

    (screen as unknown as { onceKey(keys: string[], handler: () => void): void }).onceKey(
      ['enter', 'escape', 'space'],
      () => {
        box.destroy();
        screen.render();
        resolve();
      }
    );
  });
}

export default NotificationManager;
