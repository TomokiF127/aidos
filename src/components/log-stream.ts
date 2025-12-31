/**
 * AIDOS Log Stream Component
 *
 * リアルタイムログ表示コンポーネント
 * - 複数ソースからのログ集約
 * - レベル別フィルタリング
 * - 自動スクロール
 * - タイムスタンプ表示
 */

import blessed from 'blessed';
import type { LogMessagePayload } from '../types.js';

// ========================================
// 型定義
// ========================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogStreamConfig {
  parent: blessed.Widgets.Node;
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
  label?: string;
  maxLines?: number;
  showTimestamp?: boolean;
  showLevel?: boolean;
  showSource?: boolean;
  minLevel?: LogLevel;
}

// ========================================
// ログレベル設定
// ========================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: 'gray',
  info: 'white',
  warn: 'yellow',
  error: 'red',
};

const LOG_PREFIXES: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

// ========================================
// LogStream クラス
// ========================================

export class LogStream {
  private logWidget: blessed.Widgets.Log;
  private screen: blessed.Widgets.Screen;
  private entries: LogEntry[] = [];
  private maxLines: number;
  private showTimestamp: boolean;
  private showLevel: boolean;
  private showSource: boolean;
  private minLevel: LogLevel;
  private isPaused: boolean = false;
  private filterSource: string | null = null;

  constructor(config: LogStreamConfig, screen: blessed.Widgets.Screen) {
    this.screen = screen;
    this.maxLines = config.maxLines ?? 500;
    this.showTimestamp = config.showTimestamp ?? true;
    this.showLevel = config.showLevel ?? true;
    this.showSource = config.showSource ?? true;
    this.minLevel = config.minLevel ?? 'debug';

    // ログウィジェット作成
    this.logWidget = blessed.log({
      parent: config.parent,
      top: config.top,
      left: config.left,
      width: config.width,
      height: config.height,
      label: config.label ? ` ${config.label} ` : ' [Logs] ',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'gray',
        },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        track: {
          bg: 'gray',
        },
        style: {
          inverse: true,
        },
      },
      mouse: true,
      keys: true,
      vi: true,
    });
  }

  /**
   * ログを追加
   */
  log(level: LogLevel, source: string, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      source,
      message,
    };

    this.entries.push(entry);

    // 最大行数を維持
    if (this.entries.length > this.maxLines) {
      this.entries = this.entries.slice(-this.maxLines);
    }

    // フィルタリング条件をチェック
    if (!this.shouldDisplay(entry)) {
      return;
    }

    // 一時停止中でなければ表示
    if (!this.isPaused) {
      this.displayEntry(entry);
    }
  }

  /**
   * BusMessageからログを追加
   */
  logFromPayload(payload: LogMessagePayload): void {
    this.log(payload.level, payload.agentId, payload.message);
  }

  /**
   * ショートカットメソッド
   */
  debug(source: string, message: string): void {
    this.log('debug', source, message);
  }

  info(source: string, message: string): void {
    this.log('info', source, message);
  }

  warn(source: string, message: string): void {
    this.log('warn', source, message);
  }

  error(source: string, message: string): void {
    this.log('error', source, message);
  }

  /**
   * システムログ（ソースを'System'として追加）
   */
  system(message: string, level: LogLevel = 'info'): void {
    this.log(level, 'System', message);
  }

  /**
   * エントリを表示すべきか判定
   */
  private shouldDisplay(entry: LogEntry): boolean {
    // レベルフィルター
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.minLevel]) {
      return false;
    }

    // ソースフィルター
    if (this.filterSource && entry.source !== this.filterSource) {
      return false;
    }

    return true;
  }

  /**
   * エントリを表示
   */
  private displayEntry(entry: LogEntry): void {
    const formattedLine = this.formatEntry(entry);
    this.logWidget.log(formattedLine);
    this.screen.render();
  }

  /**
   * エントリをフォーマット
   */
  private formatEntry(entry: LogEntry): string {
    const parts: string[] = [];

    // タイムスタンプ
    if (this.showTimestamp) {
      const time = entry.timestamp.toISOString().slice(11, 19);
      parts.push(`{gray-fg}${time}{/gray-fg}`);
    }

    // レベル
    if (this.showLevel) {
      const color = LOG_COLORS[entry.level];
      const prefix = LOG_PREFIXES[entry.level];
      parts.push(`{${color}-fg}[${prefix}]{/${color}-fg}`);
    }

    // ソース
    if (this.showSource) {
      parts.push(`{cyan-fg}[${entry.source}]{/cyan-fg}`);
    }

    // メッセージ
    const color = LOG_COLORS[entry.level];
    parts.push(`{${color}-fg}${entry.message}{/${color}-fg}`);

    return parts.join(' ');
  }

  /**
   * 最小ログレベルを設定
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
    this.refresh();
  }

  /**
   * ソースフィルターを設定
   */
  setSourceFilter(source: string | null): void {
    this.filterSource = source;
    this.refresh();
  }

  /**
   * 一時停止
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * 再開
   */
  resume(): void {
    this.isPaused = false;
    // 一時停止中に追加されたログを表示
    this.refresh();
  }

  /**
   * 一時停止状態を切り替え
   */
  togglePause(): boolean {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.isPaused;
  }

  /**
   * 表示を更新（フィルター変更時など）
   */
  refresh(): void {
    // ログをクリア
    this.logWidget.setContent('');

    // フィルターを適用して再表示
    for (const entry of this.entries) {
      if (this.shouldDisplay(entry)) {
        this.displayEntry(entry);
      }
    }
  }

  /**
   * ログをクリア
   */
  clear(): void {
    this.entries = [];
    this.logWidget.setContent('');
    this.screen.render();
  }

  /**
   * 先頭にスクロール
   */
  scrollToTop(): void {
    this.logWidget.setScrollPerc(0);
    this.screen.render();
  }

  /**
   * 末尾にスクロール
   */
  scrollToBottom(): void {
    this.logWidget.setScrollPerc(100);
    this.screen.render();
  }

  /**
   * 上にスクロール
   */
  scrollUp(lines: number = 1): void {
    this.logWidget.scroll(-lines);
    this.screen.render();
  }

  /**
   * 下にスクロール
   */
  scrollDown(lines: number = 1): void {
    this.logWidget.scroll(lines);
    this.screen.render();
  }

  /**
   * ログをエクスポート
   */
  exportLogs(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * ログを文字列としてエクスポート
   */
  exportAsText(): string {
    return this.entries
      .map(entry => {
        const time = entry.timestamp.toISOString();
        return `${time} [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`;
      })
      .join('\n');
  }

  /**
   * 特定レベルのログ数を取得
   */
  getLogCount(level?: LogLevel): number {
    if (!level) {
      return this.entries.length;
    }
    return this.entries.filter(e => e.level === level).length;
  }

  /**
   * エラーログがあるかチェック
   */
  hasErrors(): boolean {
    return this.entries.some(e => e.level === 'error');
  }

  /**
   * 警告ログがあるかチェック
   */
  hasWarnings(): boolean {
    return this.entries.some(e => e.level === 'warn');
  }

  /**
   * ラベルを更新
   */
  setLabel(label: string): void {
    this.logWidget.setLabel(` ${label} `);
    this.screen.render();
  }

  /**
   * ボーダー色を更新
   */
  setBorderColor(color: string): void {
    this.logWidget.style.border = { fg: color };
    this.screen.render();
  }

  /**
   * フォーカスを設定
   */
  focus(): void {
    this.logWidget.focus();
    this.logWidget.style.border = { fg: 'cyan' };
    this.screen.render();
  }

  /**
   * フォーカスを解除
   */
  blur(): void {
    this.logWidget.style.border = { fg: 'gray' };
    this.screen.render();
  }

  /**
   * 一時停止中かどうか
   */
  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * blessed ウィジェットを取得
   */
  getWidget(): blessed.Widgets.Log {
    return this.logWidget;
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.logWidget.destroy();
    this.entries = [];
  }
}

// ========================================
// LogStreamManager クラス
// ========================================

/**
 * 複数のLogStreamを管理し、グローバルなログ集約を行う
 */
export class LogStreamManager {
  private streams: Map<string, LogStream> = new Map();
  private globalStream: LogStream | null = null;
  private screen: blessed.Widgets.Screen;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
  }

  /**
   * グローバルストリームを設定
   */
  setGlobalStream(stream: LogStream): void {
    this.globalStream = stream;
  }

  /**
   * ストリームを作成
   */
  createStream(id: string, config: LogStreamConfig): LogStream {
    const stream = new LogStream(config, this.screen);
    this.streams.set(id, stream);
    return stream;
  }

  /**
   * ストリームを取得
   */
  getStream(id: string): LogStream | undefined {
    return this.streams.get(id);
  }

  /**
   * グローバルストリームを取得
   */
  getGlobalStream(): LogStream | null {
    return this.globalStream;
  }

  /**
   * グローバルログを追加（全ストリームに配信）
   */
  broadcast(level: LogLevel, source: string, message: string): void {
    // グローバルストリームに追加
    if (this.globalStream) {
      this.globalStream.log(level, source, message);
    }

    // ソースに対応するストリームがあれば追加
    const sourceStream = this.streams.get(source);
    if (sourceStream) {
      sourceStream.log(level, source, message);
    }
  }

  /**
   * 全ストリームをクリア
   */
  clearAll(): void {
    if (this.globalStream) {
      this.globalStream.clear();
    }
    for (const stream of this.streams.values()) {
      stream.clear();
    }
  }

  /**
   * 全ストリームを一時停止
   */
  pauseAll(): void {
    if (this.globalStream) {
      this.globalStream.pause();
    }
    for (const stream of this.streams.values()) {
      stream.pause();
    }
  }

  /**
   * 全ストリームを再開
   */
  resumeAll(): void {
    if (this.globalStream) {
      this.globalStream.resume();
    }
    for (const stream of this.streams.values()) {
      stream.resume();
    }
  }

  /**
   * ストリームを削除
   */
  removeStream(id: string): boolean {
    const stream = this.streams.get(id);
    if (!stream) return false;

    stream.destroy();
    this.streams.delete(id);
    return true;
  }

  /**
   * 全ストリームを破棄
   */
  destroy(): void {
    if (this.globalStream) {
      this.globalStream.destroy();
      this.globalStream = null;
    }
    for (const stream of this.streams.values()) {
      stream.destroy();
    }
    this.streams.clear();
  }
}

export default LogStream;
