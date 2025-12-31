/**
 * AIDOS Confirm Dialog Component
 *
 * 確認ダイアログコンポーネント
 * - Yes/No/Cancel選択
 * - カスタムボタンラベル
 * - タイムアウト付き自動承認オプション
 */

import blessed from 'blessed';
import { EventEmitter } from 'node:events';

// ========================================
// 型定義
// ========================================

export type DialogResult = 'yes' | 'no' | 'cancel' | 'timeout' | 'custom';

export interface DialogButton {
  label: string;
  value: string;
  shortcut?: string;
  style?: {
    fg?: string;
    bg?: string;
  };
  isDefault?: boolean;
}

export interface ConfirmDialogConfig {
  title: string;
  message: string;
  buttons?: DialogButton[];
  width?: string | number;
  height?: string | number;
  timeoutMs?: number;
  defaultOnTimeout?: string;
  showCountdown?: boolean;
  borderColor?: string;
  type?: 'info' | 'warning' | 'error' | 'question';
}

export interface ConfirmDialogResult {
  button: string;
  timedOut: boolean;
  elapsedMs: number;
}

// ========================================
// デフォルトボタンセット
// ========================================

export const DEFAULT_BUTTONS = {
  YES_NO: [
    { label: 'Yes', value: 'yes', shortcut: 'y', style: { fg: 'black', bg: 'green' } },
    { label: 'No', value: 'no', shortcut: 'n', style: { fg: 'black', bg: 'red' } },
  ] as DialogButton[],

  YES_NO_CANCEL: [
    { label: 'Yes', value: 'yes', shortcut: 'y', style: { fg: 'black', bg: 'green' } },
    { label: 'No', value: 'no', shortcut: 'n', style: { fg: 'black', bg: 'red' } },
    { label: 'Cancel', value: 'cancel', shortcut: 'c', style: { fg: 'black', bg: 'gray' } },
  ] as DialogButton[],

  OK_CANCEL: [
    { label: 'OK', value: 'ok', shortcut: 'o', style: { fg: 'black', bg: 'green' }, isDefault: true },
    { label: 'Cancel', value: 'cancel', shortcut: 'c', style: { fg: 'black', bg: 'gray' } },
  ] as DialogButton[],

  OK: [
    { label: 'OK', value: 'ok', shortcut: 'o', style: { fg: 'black', bg: 'green' }, isDefault: true },
  ] as DialogButton[],

  APPROVE_REJECT: [
    { label: 'Approve', value: 'approve', shortcut: 'a', style: { fg: 'black', bg: 'green' } },
    { label: 'Reject', value: 'reject', shortcut: 'r', style: { fg: 'black', bg: 'red' } },
  ] as DialogButton[],

  RETRY_SKIP_ABORT: [
    { label: 'Retry', value: 'retry', shortcut: 'r', style: { fg: 'black', bg: 'yellow' } },
    { label: 'Skip', value: 'skip', shortcut: 's', style: { fg: 'black', bg: 'gray' } },
    { label: 'Abort', value: 'abort', shortcut: 'a', style: { fg: 'black', bg: 'red' } },
  ] as DialogButton[],
};

// ========================================
// ダイアログタイプ別スタイル
// ========================================

const DIALOG_STYLES = {
  info: {
    borderColor: 'cyan',
    icon: '[i]',
  },
  warning: {
    borderColor: 'yellow',
    icon: '[!]',
  },
  error: {
    borderColor: 'red',
    icon: '[x]',
  },
  question: {
    borderColor: 'magenta',
    icon: '[?]',
  },
};

// ========================================
// ConfirmDialog クラス
// ========================================

export class ConfirmDialog extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private dialog: blessed.Widgets.BoxElement | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  private startTime: number = 0;

  constructor(screen: blessed.Widgets.Screen) {
    super();
    this.screen = screen;
  }

  /**
   * ダイアログを表示
   */
  async show(config: ConfirmDialogConfig): Promise<ConfirmDialogResult> {
    return new Promise((resolve) => {
      this.startTime = Date.now();

      const dialogStyle = config.type ? DIALOG_STYLES[config.type] : DIALOG_STYLES.question;
      const buttons = config.buttons ?? DEFAULT_BUTTONS.YES_NO;

      // ダイアログボックス作成
      this.dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: config.width ?? '50%',
        height: config.height ?? 'shrink',
        label: ` ${dialogStyle.icon} ${config.title} `,
        border: {
          type: 'line',
        },
        style: {
          fg: 'white',
          bg: 'black',
          border: {
            fg: config.borderColor ?? dialogStyle.borderColor,
          },
        },
        tags: true,
        padding: {
          left: 2,
          right: 2,
          top: 1,
          bottom: 1,
        },
      });

      // メッセージ
      const messageBox = blessed.box({
        parent: this.dialog,
        top: 0,
        left: 0,
        width: '100%',
        height: 'shrink',
        content: config.message,
        tags: true,
      });

      // カウントダウン表示エリア
      let countdownBox: blessed.Widgets.TextElement | null = null;
      if (config.timeoutMs && config.showCountdown !== false) {
        countdownBox = blessed.text({
          parent: this.dialog,
          top: 3,
          left: 0,
          width: '100%',
          height: 1,
          content: this.formatCountdown(config.timeoutMs),
          style: {
            fg: 'yellow',
          },
          tags: true,
        });
      }

      // ボタンコンテナ
      const buttonContainer = blessed.box({
        parent: this.dialog,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 3,
      });

      // ボタン作成
      const buttonWidth = Math.floor(100 / buttons.length);
      const buttonElements: blessed.Widgets.ButtonElement[] = [];

      buttons.forEach((btn, index) => {
        const button = blessed.button({
          parent: buttonContainer,
          left: `${index * buttonWidth}%`,
          width: `${buttonWidth}%`,
          height: 3,
          content: ` [${btn.shortcut?.toUpperCase() ?? index + 1}] ${btn.label} `,
          style: {
            fg: btn.style?.fg ?? 'white',
            bg: btn.style?.bg ?? 'gray',
            focus: {
              fg: 'white',
              bg: btn.style?.bg ?? 'gray',
              bold: true,
            },
          },
          border: {
            type: 'line',
          },
        });

        buttonElements.push(button);

        button.on('press', () => {
          this.cleanup();
          resolve({
            button: btn.value,
            timedOut: false,
            elapsedMs: Date.now() - this.startTime,
          });
        });
      });

      // キーバインド
      const setupKeyBindings = () => {
        // ショートカットキー
        buttons.forEach((btn) => {
          if (btn.shortcut) {
            (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(
              [btn.shortcut, btn.shortcut.toUpperCase()],
              () => {
                this.cleanup();
                resolve({
                  button: btn.value,
                  timedOut: false,
                  elapsedMs: Date.now() - this.startTime,
                });
              }
            );
          }
        });

        // ESCでキャンセル（キャンセルボタンがある場合）
        const cancelButton = buttons.find(b => b.value === 'cancel' || b.value === 'no');
        (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['escape'], () => {
          this.cleanup();
          resolve({
            button: cancelButton?.value ?? 'cancel',
            timedOut: false,
            elapsedMs: Date.now() - this.startTime,
          });
        });

        // Enterでデフォルトボタン
        const defaultButton = buttons.find(b => b.isDefault) ?? buttons[0];
        (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['enter'], () => {
          this.cleanup();
          resolve({
            button: defaultButton.value,
            timedOut: false,
            elapsedMs: Date.now() - this.startTime,
          });
        });

        // Tab/Shift+Tabでボタン間移動
        let focusedIndex = buttons.findIndex(b => b.isDefault);
        if (focusedIndex < 0) focusedIndex = 0;
        buttonElements[focusedIndex]?.focus();

        (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['tab'], () => {
          focusedIndex = (focusedIndex + 1) % buttonElements.length;
          buttonElements[focusedIndex]?.focus();
          this.screen.render();
        });

        (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['S-tab'], () => {
          focusedIndex = (focusedIndex - 1 + buttonElements.length) % buttonElements.length;
          buttonElements[focusedIndex]?.focus();
          this.screen.render();
        });
      };

      setupKeyBindings();

      // タイムアウト処理
      if (config.timeoutMs) {
        let remainingMs = config.timeoutMs;

        this.countdownTimer = setInterval(() => {
          remainingMs -= 1000;

          if (countdownBox) {
            countdownBox.setContent(this.formatCountdown(remainingMs));
            this.screen.render();
          }

          if (remainingMs <= 0) {
            this.cleanup();
            const defaultValue = config.defaultOnTimeout ?? buttons[0].value;
            resolve({
              button: defaultValue,
              timedOut: true,
              elapsedMs: Date.now() - this.startTime,
            });
          }
        }, 1000);
      }

      this.dialog.focus();
      this.screen.render();
    });
  }

  /**
   * カウントダウン文字列をフォーマット
   */
  private formatCountdown(ms: number): string {
    const seconds = Math.ceil(ms / 1000);
    return `{yellow-fg}Auto-selecting in ${seconds}s...{/yellow-fg}`;
  }

  /**
   * クリーンアップ
   */
  private cleanup(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.dialog) {
      this.dialog.destroy();
      this.dialog = null;
    }
    this.screen.render();
  }

  /**
   * ダイアログが開いているか
   */
  isOpen(): boolean {
    return this.dialog !== null;
  }

  /**
   * 強制的に閉じる
   */
  close(): void {
    this.cleanup();
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.cleanup();
    this.removeAllListeners();
  }
}

// ========================================
// ヘルパー関数
// ========================================

/**
 * 簡易確認ダイアログを表示
 */
export async function confirm(
  screen: blessed.Widgets.Screen,
  message: string,
  title: string = 'Confirm'
): Promise<boolean> {
  const dialog = new ConfirmDialog(screen);
  const result = await dialog.show({
    title,
    message,
    buttons: DEFAULT_BUTTONS.YES_NO,
    type: 'question',
  });
  dialog.destroy();
  return result.button === 'yes';
}

/**
 * アラートダイアログを表示
 */
export async function alert(
  screen: blessed.Widgets.Screen,
  message: string,
  title: string = 'Alert',
  type: 'info' | 'warning' | 'error' = 'info'
): Promise<void> {
  const dialog = new ConfirmDialog(screen);
  await dialog.show({
    title,
    message,
    buttons: DEFAULT_BUTTONS.OK,
    type,
  });
  dialog.destroy();
}

/**
 * 承認ダイアログを表示
 */
export async function promptApproval(
  screen: blessed.Widgets.Screen,
  message: string,
  options: {
    title?: string;
    timeoutMs?: number;
    defaultOnTimeout?: 'approve' | 'reject';
  } = {}
): Promise<{ approved: boolean; timedOut: boolean }> {
  const dialog = new ConfirmDialog(screen);
  const result = await dialog.show({
    title: options.title ?? 'Approval Required',
    message,
    buttons: DEFAULT_BUTTONS.APPROVE_REJECT,
    type: 'question',
    timeoutMs: options.timeoutMs,
    defaultOnTimeout: options.defaultOnTimeout,
    showCountdown: true,
  });
  dialog.destroy();
  return {
    approved: result.button === 'approve',
    timedOut: result.timedOut,
  };
}

/**
 * 3択ダイアログを表示
 */
export async function promptThreeWay(
  screen: blessed.Widgets.Screen,
  message: string,
  options: {
    title?: string;
    yesLabel?: string;
    noLabel?: string;
    cancelLabel?: string;
  } = {}
): Promise<'yes' | 'no' | 'cancel'> {
  const dialog = new ConfirmDialog(screen);
  const result = await dialog.show({
    title: options.title ?? 'Choose an option',
    message,
    buttons: [
      { label: options.yesLabel ?? 'Yes', value: 'yes', shortcut: 'y', style: { fg: 'black', bg: 'green' } },
      { label: options.noLabel ?? 'No', value: 'no', shortcut: 'n', style: { fg: 'black', bg: 'red' } },
      { label: options.cancelLabel ?? 'Cancel', value: 'cancel', shortcut: 'c', style: { fg: 'black', bg: 'gray' } },
    ],
    type: 'question',
  });
  dialog.destroy();
  return result.button as 'yes' | 'no' | 'cancel';
}

/**
 * リトライダイアログを表示
 */
export async function promptRetry(
  screen: blessed.Widgets.Screen,
  message: string,
  options: {
    title?: string;
    timeoutMs?: number;
    defaultOnTimeout?: 'retry' | 'skip' | 'abort';
  } = {}
): Promise<'retry' | 'skip' | 'abort'> {
  const dialog = new ConfirmDialog(screen);
  const result = await dialog.show({
    title: options.title ?? 'Error Occurred',
    message,
    buttons: DEFAULT_BUTTONS.RETRY_SKIP_ABORT,
    type: 'error',
    timeoutMs: options.timeoutMs,
    defaultOnTimeout: options.defaultOnTimeout,
    showCountdown: true,
  });
  dialog.destroy();
  return result.button as 'retry' | 'skip' | 'abort';
}

// ========================================
// カスタムダイアログビルダー
// ========================================

export class ConfirmDialogBuilder {
  private config: ConfirmDialogConfig;

  constructor(title: string) {
    this.config = {
      title,
      message: '',
    };
  }

  message(msg: string): this {
    this.config.message = msg;
    return this;
  }

  buttons(buttons: DialogButton[]): this {
    this.config.buttons = buttons;
    return this;
  }

  yesNo(): this {
    this.config.buttons = DEFAULT_BUTTONS.YES_NO;
    return this;
  }

  yesNoCancel(): this {
    this.config.buttons = DEFAULT_BUTTONS.YES_NO_CANCEL;
    return this;
  }

  okCancel(): this {
    this.config.buttons = DEFAULT_BUTTONS.OK_CANCEL;
    return this;
  }

  timeout(ms: number, defaultValue?: string): this {
    this.config.timeoutMs = ms;
    this.config.defaultOnTimeout = defaultValue;
    this.config.showCountdown = true;
    return this;
  }

  type(type: 'info' | 'warning' | 'error' | 'question'): this {
    this.config.type = type;
    return this;
  }

  size(width: string | number, height: string | number): this {
    this.config.width = width;
    this.config.height = height;
    return this;
  }

  borderColor(color: string): this {
    this.config.borderColor = color;
    return this;
  }

  async show(screen: blessed.Widgets.Screen): Promise<ConfirmDialogResult> {
    const dialog = new ConfirmDialog(screen);
    const result = await dialog.show(this.config);
    dialog.destroy();
    return result;
  }
}

/**
 * ダイアログビルダーを作成
 */
export function dialog(title: string): ConfirmDialogBuilder {
  return new ConfirmDialogBuilder(title);
}

export default ConfirmDialog;
