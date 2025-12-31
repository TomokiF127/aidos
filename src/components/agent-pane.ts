/**
 * AIDOS Agent Pane Component
 *
 * 個々のエージェントの状態を表示するペインコンポーネント
 * - ステータス表示
 * - 進捗バー
 * - タスク情報
 * - リアルタイム更新
 */

import blessed from 'blessed';
import type { Agent, AgentStatus, Task } from '../types.js';

// ========================================
// 型定義
// ========================================

export interface AgentPaneConfig {
  parent: blessed.Widgets.Node;
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
  agent: Agent;
}

export interface AgentDisplayState {
  agent: Agent;
  currentTask: Task | null;
  progress: number;
  logs: string[];
}

// ========================================
// ステータスアイコン・カラー
// ========================================

const STATUS_ICONS: Record<AgentStatus, string> = {
  idle: '[ ]',
  thinking: '[~]',
  executing: '[>]',
  blocked: '[!]',
  done: '[v]',
  error: '[x]',
};

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: 'gray',
  thinking: 'yellow',
  executing: 'green',
  blocked: 'magenta',
  done: 'blue',
  error: 'red',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking...',
  executing: 'Executing',
  blocked: 'Blocked',
  done: 'Done',
  error: 'Error',
};

// ========================================
// ヘルパー関数
// ========================================

function createProgressBar(progress: number, width: number = 20): string {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const filled = Math.round((clampedProgress / 100) * width);
  const empty = width - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

function formatRole(role: string): string {
  switch (role) {
    case 'PM':
      return 'Project Manager';
    case 'PL':
      return 'Project Leader';
    case 'Member':
      return 'Team Member';
    default:
      return role;
  }
}

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

// ========================================
// AgentPane クラス
// ========================================

export class AgentPane {
  private box: blessed.Widgets.BoxElement;
  private state: AgentDisplayState;
  private screen: blessed.Widgets.Screen;
  private maxLogLines: number;

  constructor(config: AgentPaneConfig, screen: blessed.Widgets.Screen, maxLogLines: number = 5) {
    this.screen = screen;
    this.maxLogLines = maxLogLines;
    this.state = {
      agent: config.agent,
      currentTask: null,
      progress: 0,
      logs: [],
    };

    // ペイン作成
    this.box = blessed.box({
      parent: config.parent,
      top: config.top,
      left: config.left,
      width: config.width,
      height: config.height,
      label: this.generateLabel(),
      content: this.generateContent(),
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: STATUS_COLORS[config.agent.status],
        },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
    });
  }

  /**
   * ラベルを生成
   */
  private generateLabel(): string {
    const agent = this.state.agent;
    const icon = STATUS_ICONS[agent.status];
    return ` [${agent.id}] ${icon} ${formatRole(agent.role)} `;
  }

  /**
   * コンテンツを生成
   */
  private generateContent(): string {
    const { agent, currentTask, progress } = this.state;

    // 利用可能な幅を計算（ボーダー分を除く）
    const contentWidth = 25;
    const progressBarWidth = Math.max(10, contentWidth - 10);

    let content = '';
    content += `  Status: ${STATUS_LABELS[agent.status]}\n`;
    content += `  Mission: ${truncateString(agent.mission, contentWidth)}\n`;
    content += '\n';

    if (currentTask) {
      content += `  Task: ${truncateString(currentTask.description, contentWidth)}\n`;
      content += `  Progress: ${createProgressBar(progress, progressBarWidth)} ${progress}%\n`;
    } else {
      content += `  Task: (none)\n`;
      content += `  Progress: ${createProgressBar(0, progressBarWidth)} 0%\n`;
    }

    // 最近のログを表示
    if (this.state.logs.length > 0) {
      content += '\n  Recent:\n';
      const recentLogs = this.state.logs.slice(-this.maxLogLines);
      for (const log of recentLogs) {
        content += `    ${truncateString(log, contentWidth - 2)}\n`;
      }
    }

    return content;
  }

  /**
   * エージェント情報を更新
   */
  updateAgent(agent: Agent): void {
    this.state.agent = agent;
    this.refresh();
  }

  /**
   * ステータスを更新
   */
  updateStatus(status: AgentStatus): void {
    this.state.agent.status = status;
    this.refresh();
  }

  /**
   * 現在のタスクを設定
   */
  setCurrentTask(task: Task | null): void {
    this.state.currentTask = task;
    if (task) {
      this.state.progress = task.progress;
    } else {
      this.state.progress = 0;
    }
    this.refresh();
  }

  /**
   * 進捗を更新
   */
  updateProgress(progress: number): void {
    this.state.progress = Math.max(0, Math.min(100, progress));
    if (this.state.currentTask) {
      this.state.currentTask.progress = this.state.progress;
    }
    this.refresh();
  }

  /**
   * ログを追加
   */
  addLog(message: string): void {
    this.state.logs.push(message);
    // ログの最大数を維持
    if (this.state.logs.length > 50) {
      this.state.logs = this.state.logs.slice(-50);
    }
    this.refresh();
  }

  /**
   * ログをクリア
   */
  clearLogs(): void {
    this.state.logs = [];
    this.refresh();
  }

  /**
   * 表示を更新
   */
  private refresh(): void {
    this.box.setLabel(this.generateLabel());
    this.box.setContent(this.generateContent());
    this.box.style.border = { fg: STATUS_COLORS[this.state.agent.status] };
    this.screen.render();
  }

  /**
   * フォーカスを設定
   */
  focus(): void {
    this.box.focus();
    this.box.style.border = { fg: 'cyan' };
    this.screen.render();
  }

  /**
   * フォーカスを解除
   */
  blur(): void {
    this.box.style.border = { fg: STATUS_COLORS[this.state.agent.status] };
    this.screen.render();
  }

  /**
   * ハイライト表示（警告やエラー時）
   */
  highlight(color: string = 'yellow'): void {
    this.box.style.border = { fg: color };
    this.screen.render();
  }

  /**
   * 現在の状態を取得
   */
  getState(): AgentDisplayState {
    return { ...this.state };
  }

  /**
   * エージェントIDを取得
   */
  getAgentId(): string {
    return this.state.agent.id;
  }

  /**
   * blessed boxを取得
   */
  getBox(): blessed.Widgets.BoxElement {
    return this.box;
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.box.destroy();
  }
}

// ========================================
// AgentPaneManager クラス
// ========================================

/**
 * 複数のAgentPaneを管理するマネージャー
 */
export class AgentPaneManager {
  private panes: Map<string, AgentPane> = new Map();
  private screen: blessed.Widgets.Screen;
  private focusedPaneId: string | null = null;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
  }

  /**
   * ペインを作成
   */
  createPane(config: AgentPaneConfig): AgentPane {
    const pane = new AgentPane(config, this.screen);
    this.panes.set(config.agent.id, pane);
    return pane;
  }

  /**
   * ペインを取得
   */
  getPane(agentId: string): AgentPane | undefined {
    return this.panes.get(agentId);
  }

  /**
   * 全ペインを取得
   */
  getAllPanes(): Map<string, AgentPane> {
    return this.panes;
  }

  /**
   * エージェントの状態を更新
   */
  updateAgent(agentId: string, agent: Agent): void {
    const pane = this.panes.get(agentId);
    if (pane) {
      pane.updateAgent(agent);
    }
  }

  /**
   * エージェントのステータスを更新
   */
  updateAgentStatus(agentId: string, status: AgentStatus): void {
    const pane = this.panes.get(agentId);
    if (pane) {
      pane.updateStatus(status);
    }
  }

  /**
   * エージェントの進捗を更新
   */
  updateAgentProgress(agentId: string, progress: number): void {
    const pane = this.panes.get(agentId);
    if (pane) {
      pane.updateProgress(progress);
    }
  }

  /**
   * エージェントのタスクを設定
   */
  setAgentTask(agentId: string, task: Task | null): void {
    const pane = this.panes.get(agentId);
    if (pane) {
      pane.setCurrentTask(task);
    }
  }

  /**
   * エージェントにログを追加
   */
  addAgentLog(agentId: string, message: string): void {
    const pane = this.panes.get(agentId);
    if (pane) {
      pane.addLog(message);
    }
  }

  /**
   * 指定ペインにフォーカス
   */
  focusPane(agentId: string): boolean {
    const pane = this.panes.get(agentId);
    if (!pane) return false;

    // 前のフォーカスを解除
    if (this.focusedPaneId && this.focusedPaneId !== agentId) {
      const prevPane = this.panes.get(this.focusedPaneId);
      if (prevPane) {
        prevPane.blur();
      }
    }

    pane.focus();
    this.focusedPaneId = agentId;
    return true;
  }

  /**
   * 次のペインにフォーカス
   */
  focusNext(): void {
    const paneIds = Array.from(this.panes.keys());
    if (paneIds.length === 0) return;

    const currentIndex = this.focusedPaneId
      ? paneIds.indexOf(this.focusedPaneId)
      : -1;
    const nextIndex = (currentIndex + 1) % paneIds.length;
    this.focusPane(paneIds[nextIndex]);
  }

  /**
   * 前のペインにフォーカス
   */
  focusPrevious(): void {
    const paneIds = Array.from(this.panes.keys());
    if (paneIds.length === 0) return;

    const currentIndex = this.focusedPaneId
      ? paneIds.indexOf(this.focusedPaneId)
      : 0;
    const prevIndex = (currentIndex - 1 + paneIds.length) % paneIds.length;
    this.focusPane(paneIds[prevIndex]);
  }

  /**
   * 現在フォーカスされているペインのIDを取得
   */
  getFocusedPaneId(): string | null {
    return this.focusedPaneId;
  }

  /**
   * ペインを削除
   */
  removePane(agentId: string): boolean {
    const pane = this.panes.get(agentId);
    if (!pane) return false;

    pane.destroy();
    this.panes.delete(agentId);

    if (this.focusedPaneId === agentId) {
      const remainingIds = Array.from(this.panes.keys());
      if (remainingIds.length > 0) {
        this.focusPane(remainingIds[0]);
      } else {
        this.focusedPaneId = null;
      }
    }

    return true;
  }

  /**
   * 全ペインを破棄
   */
  destroy(): void {
    for (const pane of this.panes.values()) {
      pane.destroy();
    }
    this.panes.clear();
    this.focusedPaneId = null;
  }
}

export default AgentPane;
