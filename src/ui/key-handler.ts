/**
 * AIDOS Key Handler
 *
 * キーボード入力処理を管理
 * - キーバインディング登録
 * - モード別キー処理
 * - vim風操作サポート
 */

import blessed from 'blessed';

// ========================================
// 型定義
// ========================================

export type KeyCallback = () => void;

export interface KeyBinding {
  keys: string[];
  callback: KeyCallback;
  description?: string;
  mode?: string;
}

export interface KeyHandlerConfig {
  enableVimMode?: boolean;
  enableNumberKeys?: boolean;
}

// ========================================
// 標準キーマップ
// ========================================

export const STANDARD_KEYS = {
  // 終了
  QUIT: ['q', 'C-c'],
  ESCAPE: ['escape'],

  // ナビゲーション
  NEXT: ['tab', 'l', 'right'],
  PREV: ['S-tab', 'h', 'left'],
  UP: ['k', 'up'],
  DOWN: ['j', 'down'],

  // アクション
  ENTER: ['enter', 'return'],
  SPACE: ['space'],
  HELP: ['h', '?'],

  // コントロール
  PAUSE: ['p'],
  RESUME: ['r'],
  INTERVENE: ['i'],

  // スクロール
  SCROLL_TOP: ['g'],
  SCROLL_BOTTOM: ['G'],
  PAGE_UP: ['C-u', 'pageup'],
  PAGE_DOWN: ['C-d', 'pagedown'],

  // その他
  CLEAR: ['c'],
  REFRESH: ['R'],
} as const;

// ========================================
// KeyHandler クラス
// ========================================

export class KeyHandler {
  private screen: blessed.Widgets.Screen;
  private bindings: Map<string, KeyBinding> = new Map();
  private activeMode: string = 'normal';
  private config: KeyHandlerConfig;
  private isEnabled: boolean = true;
  private keySequence: string[] = [];
  private sequenceTimeout: NodeJS.Timeout | null = null;

  constructor(screen: blessed.Widgets.Screen, config: KeyHandlerConfig = {}) {
    this.screen = screen;
    this.config = {
      enableVimMode: config.enableVimMode ?? true,
      enableNumberKeys: config.enableNumberKeys ?? true,
    };
  }

  /**
   * キーバインディングを登録
   */
  bind(keys: string | string[], callback: KeyCallback, description?: string, mode?: string): void {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const bindingId = this.generateBindingId(keyArray, mode);

    const binding: KeyBinding = {
      keys: keyArray,
      callback,
      description,
      mode,
    };

    this.bindings.set(bindingId, binding);

    // 画面にキーハンドラを登録
    this.screen.key(keyArray, () => {
      if (!this.isEnabled) return;
      if (mode && this.activeMode !== mode) return;
      callback();
    });
  }

  /**
   * キーバインディングを解除
   */
  unbind(keys: string | string[], mode?: string): void {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const bindingId = this.generateBindingId(keyArray, mode);

    const binding = this.bindings.get(bindingId);
    if (binding) {
      keyArray.forEach(key => (this.screen as unknown as { unkey(key: string): void }).unkey(key));
      this.bindings.delete(bindingId);
    }
  }

  /**
   * バインディングIDを生成
   */
  private generateBindingId(keys: string[], mode?: string): string {
    const keyPart = keys.sort().join('+');
    return mode ? `${mode}:${keyPart}` : keyPart;
  }

  /**
   * モードを設定
   */
  setMode(mode: string): void {
    this.activeMode = mode;
  }

  /**
   * 現在のモードを取得
   */
  getMode(): string {
    return this.activeMode;
  }

  /**
   * キーハンドラーを有効化
   */
  enable(): void {
    this.isEnabled = true;
  }

  /**
   * キーハンドラーを無効化
   */
  disable(): void {
    this.isEnabled = false;
  }

  /**
   * 有効/無効を切り替え
   */
  toggle(): boolean {
    this.isEnabled = !this.isEnabled;
    return this.isEnabled;
  }

  /**
   * キーシーケンスを開始（vim風のマルチキー操作用）
   */
  startSequence(key: string): void {
    this.keySequence.push(key);

    // タイムアウト設定
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
    }
    this.sequenceTimeout = setTimeout(() => {
      this.clearSequence();
    }, 1000);
  }

  /**
   * キーシーケンスをクリア
   */
  clearSequence(): void {
    this.keySequence = [];
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
      this.sequenceTimeout = null;
    }
  }

  /**
   * 現在のキーシーケンスを取得
   */
  getSequence(): string[] {
    return [...this.keySequence];
  }

  /**
   * キーシーケンスがマッチするか確認
   */
  matchSequence(pattern: string[]): boolean {
    if (this.keySequence.length !== pattern.length) return false;
    return pattern.every((key, i) => this.keySequence[i] === key);
  }

  /**
   * 標準キーバインディングを設定
   */
  setupStandardBindings(handlers: Partial<Record<keyof typeof STANDARD_KEYS, KeyCallback>>): void {
    for (const [name, keys] of Object.entries(STANDARD_KEYS)) {
      const handler = handlers[name as keyof typeof STANDARD_KEYS];
      if (handler) {
        this.bind([...keys], handler, name);
      }
    }
  }

  /**
   * 数字キーのバインディングを設定（1-9）
   */
  setupNumberKeys(callback: (num: number) => void): void {
    if (!this.config.enableNumberKeys) return;

    for (let i = 1; i <= 9; i++) {
      this.bind([`${i}`], () => callback(i), `Select item ${i}`);
    }
  }

  /**
   * vim風ナビゲーションを設定
   */
  setupVimNavigation(handlers: {
    up?: KeyCallback;
    down?: KeyCallback;
    left?: KeyCallback;
    right?: KeyCallback;
  }): void {
    if (!this.config.enableVimMode) return;

    if (handlers.up) {
      this.bind(['k', 'up'], handlers.up, 'Move up');
    }
    if (handlers.down) {
      this.bind(['j', 'down'], handlers.down, 'Move down');
    }
    if (handlers.left) {
      this.bind(['h', 'left'], handlers.left, 'Move left');
    }
    if (handlers.right) {
      this.bind(['l', 'right'], handlers.right, 'Move right');
    }
  }

  /**
   * モード別キーバインディングを一括登録
   */
  setupModeBindings(mode: string, bindings: Record<string, { keys: string[]; handler: KeyCallback; description?: string }>): void {
    for (const [_name, binding] of Object.entries(bindings)) {
      this.bind(binding.keys, binding.handler, binding.description, mode);
    }
  }

  /**
   * 現在のすべてのバインディングを取得
   */
  getBindings(): Map<string, KeyBinding> {
    return new Map(this.bindings);
  }

  /**
   * モード別のバインディングを取得
   */
  getBindingsForMode(mode?: string): KeyBinding[] {
    const bindings: KeyBinding[] = [];
    for (const binding of this.bindings.values()) {
      if (!mode || !binding.mode || binding.mode === mode) {
        bindings.push(binding);
      }
    }
    return bindings;
  }

  /**
   * キーバインディングのヘルプテキストを生成
   */
  generateHelpText(mode?: string): string {
    const bindings = this.getBindingsForMode(mode);
    const lines: string[] = [];

    // モードでグループ化
    const grouped = new Map<string, KeyBinding[]>();
    for (const binding of bindings) {
      const group = binding.mode ?? 'global';
      if (!grouped.has(group)) {
        grouped.set(group, []);
      }
      grouped.get(group)!.push(binding);
    }

    for (const [group, groupBindings] of grouped) {
      lines.push(`[${group}]`);
      for (const binding of groupBindings) {
        const keys = binding.keys.join(', ');
        const desc = binding.description ?? 'No description';
        lines.push(`  ${keys.padEnd(15)} ${desc}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * すべてのバインディングをクリア
   */
  clearAll(): void {
    for (const binding of this.bindings.values()) {
      binding.keys.forEach(key => (this.screen as unknown as { unkey(key: string): void }).unkey(key));
    }
    this.bindings.clear();
    this.clearSequence();
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.clearAll();
    this.isEnabled = false;
  }
}

// ========================================
// InputHandler クラス
// ========================================

/**
 * テキスト入力を処理するハンドラー
 */
export class InputHandler {
  private screen: blessed.Widgets.Screen;
  private inputBox: blessed.Widgets.TextboxElement | null = null;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
  }

  /**
   * テキスト入力を表示して結果を取得
   */
  prompt(label: string, defaultValue?: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.inputBox = blessed.textbox({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '60%',
        height: 3,
        label: ` ${label} `,
        border: {
          type: 'line',
        },
        style: {
          fg: 'white',
          bg: 'black',
          border: {
            fg: 'cyan',
          },
          focus: {
            border: {
              fg: 'yellow',
            },
          },
        },
        inputOnFocus: true,
      });

      if (defaultValue) {
        this.inputBox.setValue(defaultValue);
      }

      this.inputBox.on('submit', (value: string) => {
        this.closeInput();
        resolve(value);
      });

      this.inputBox.on('cancel', () => {
        this.closeInput();
        resolve(null);
      });

      this.inputBox.focus();
      this.screen.render();
    });
  }

  /**
   * 確認ダイアログを表示
   */
  confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const confirmBox = blessed.question({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 'shrink',
        label: ' Confirm ',
        border: {
          type: 'line',
        },
        style: {
          fg: 'white',
          bg: 'black',
          border: {
            fg: 'yellow',
          },
        },
      });

      confirmBox.ask(message, (err: unknown, value: string) => {
        confirmBox.destroy();
        this.screen.render();
        resolve(value === 'yes' || value === 'y' || value === 'true');
      });
    });
  }

  /**
   * 入力ボックスを閉じる
   */
  private closeInput(): void {
    if (this.inputBox) {
      this.inputBox.destroy();
      this.inputBox = null;
      this.screen.render();
    }
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.closeInput();
  }
}

// ========================================
// KeyMapPresets
// ========================================

/**
 * 一般的なキーマッププリセット
 */
export const KeyMapPresets = {
  /**
   * vim風キーマップ
   */
  vim: {
    navigation: {
      up: ['k', 'up'],
      down: ['j', 'down'],
      left: ['h', 'left'],
      right: ['l', 'right'],
    },
    scroll: {
      halfPageUp: ['C-u'],
      halfPageDown: ['C-d'],
      pageUp: ['C-b', 'pageup'],
      pageDown: ['C-f', 'pagedown'],
      top: ['gg', 'g'],
      bottom: ['G'],
    },
    actions: {
      yank: ['y'],
      delete: ['d'],
      change: ['c'],
      undo: ['u'],
      redo: ['C-r'],
    },
  },

  /**
   * Emacs風キーマップ
   */
  emacs: {
    navigation: {
      up: ['C-p', 'up'],
      down: ['C-n', 'down'],
      left: ['C-b', 'left'],
      right: ['C-f', 'right'],
    },
    scroll: {
      pageUp: ['M-v', 'pageup'],
      pageDown: ['C-v', 'pagedown'],
      top: ['M-<'],
      bottom: ['M->'],
    },
    actions: {
      kill: ['C-k'],
      yank: ['C-y'],
      undo: ['C-/'],
    },
  },

  /**
   * tmux風キーマップ（Prefix: C-b）
   */
  tmux: {
    panes: {
      split_h: ['%'],
      split_v: ['"'],
      next: ['o'],
      prev: [';'],
      close: ['x'],
    },
    navigation: {
      up: ['up'],
      down: ['down'],
      left: ['left'],
      right: ['right'],
    },
    resize: {
      resize_up: ['C-up'],
      resize_down: ['C-down'],
      resize_left: ['C-left'],
      resize_right: ['C-right'],
    },
  },
};

export default KeyHandler;
