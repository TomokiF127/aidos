/**
 * AIDOS Dashboard
 *
 * メインダッシュボードコンポーネント
 * - 全体レイアウト管理
 * - ヘッダー/フッター
 * - Agent ペイン配置
 * - ログストリーム表示
 * - キーボード操作統合
 */

import blessed from 'blessed';
import { LayoutManager, type LayoutRegion, type PaneConfig } from './layout-manager.js';
import { KeyHandler, type KeyBinding } from './key-handler.js';
import { AgentPane, AgentPaneManager } from '../components/agent-pane.js';
import { LogStream } from '../components/log-stream.js';
import type { Agent, AgentStatus, Task, AidosConfig, SessionStatus } from '../types.js';

// ========================================
// 型定義
// ========================================

export interface DashboardConfig {
  title?: string;
  version?: string;
  config?: Partial<AidosConfig>;
}

export interface SessionInfo {
  id: string;
  objective: string;
  status: SessionStatus;
  startTime: Date;
  agentCount: number;
  taskCount: number;
  completedTasks: number;
}

export type DashboardMode = 'normal' | 'paused' | 'intervention' | 'help';

// ========================================
// Dashboard クラス
// ========================================

export class Dashboard {
  private screen: blessed.Widgets.Screen;
  private header: blessed.Widgets.BoxElement;
  private footer: blessed.Widgets.BoxElement;
  private agentContainer: blessed.Widgets.BoxElement;
  private layoutManager: LayoutManager;
  private keyHandler: KeyHandler;
  private agentPaneManager: AgentPaneManager;
  private logStream: LogStream;

  private title: string;
  private version: string;
  private mode: DashboardMode = 'normal';
  private sessionInfo: SessionInfo | null = null;
  private overallProgress: number = 0;

  private helpBox: blessed.Widgets.BoxElement | null = null;
  private interventionBox: blessed.Widgets.BoxElement | null = null;

  constructor(config: DashboardConfig = {}) {
    this.title = config.title ?? 'AIDOS';
    this.version = config.version ?? '0.1.0';

    // スクリーン作成
    this.screen = blessed.screen({
      smartCSR: true,
      title: `${this.title} - AI-Driven Orchestration System`,
      fullUnicode: true,
    });

    // ヘッダー作成
    this.header = this.createHeader();

    // フッター作成
    this.footer = this.createFooter();

    // Agentコンテナ作成
    this.agentContainer = this.createAgentContainer();

    // ログストリーム作成
    this.logStream = new LogStream(
      {
        parent: this.screen,
        top: '60%',
        left: 0,
        width: '100%',
        height: '30%-3',
        label: 'System Logs',
        maxLines: config.config?.ui?.logLines ?? 100,
      },
      this.screen
    );

    // レイアウトマネージャー作成
    const containerRegion: LayoutRegion = {
      top: 3,
      left: 0,
      width: this.screen.width as number,
      height: Math.floor((this.screen.height as number) * 0.55),
    };
    this.layoutManager = new LayoutManager(this.screen, containerRegion);

    // AgentPaneManager作成
    this.agentPaneManager = new AgentPaneManager(this.screen);

    // キーハンドラー作成
    this.keyHandler = new KeyHandler(this.screen);

    // 画面に要素を追加
    this.screen.append(this.header);
    this.screen.append(this.agentContainer);
    this.screen.append(this.footer);

    // デフォルトキーバインド設定
    this.setupDefaultKeyBindings();
  }

  /**
   * ヘッダーを作成
   */
  private createHeader(): blessed.Widgets.BoxElement {
    return blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: this.generateHeaderContent(),
      style: {
        fg: 'white',
        bg: 'blue',
      },
      border: {
        type: 'line',
      },
      tags: true,
    });
  }

  /**
   * ヘッダーコンテンツを生成
   */
  private generateHeaderContent(): string {
    const progressBar = this.createProgressBar(this.overallProgress, 10);
    const agentCount = this.sessionInfo?.agentCount ?? 0;
    const taskInfo = this.sessionInfo
      ? `${this.sessionInfo.completedTasks}/${this.sessionInfo.taskCount}`
      : '0/0';

    let content = ` ${this.title} v${this.version}`;
    content += ` | ${progressBar} ${this.overallProgress}%`;
    content += ` | Agents: ${agentCount}`;
    content += ` | Tasks: ${taskInfo}`;

    if (this.sessionInfo) {
      const elapsed = Math.round((Date.now() - this.sessionInfo.startTime.getTime()) / 1000);
      content += ` | Time: ${this.formatTime(elapsed)}`;
    }

    return content;
  }

  /**
   * フッターを作成
   */
  private createFooter(): blessed.Widgets.BoxElement {
    return blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: this.generateFooterContent(),
      style: {
        fg: 'white',
        bg: 'gray',
      },
      border: {
        type: 'line',
      },
      tags: true,
    });
  }

  /**
   * フッターコンテンツを生成
   */
  private generateFooterContent(): string {
    const modeIndicator = this.getModeIndicator();
    const focusedPane = this.agentPaneManager.getFocusedPaneId() ?? 'none';

    let content = ` [h]elp [q]uit [p]ause [r]esume [i]ntervene`;
    content += ` | Mode: ${modeIndicator}`;
    content += ` | Focus: ${focusedPane}`;

    return content;
  }

  /**
   * モードインジケーターを取得
   */
  private getModeIndicator(): string {
    switch (this.mode) {
      case 'normal':
        return '{green-fg}RUNNING{/green-fg}';
      case 'paused':
        return '{yellow-fg}PAUSED{/yellow-fg}';
      case 'intervention':
        return '{magenta-fg}INTERVENTION{/magenta-fg}';
      case 'help':
        return '{cyan-fg}HELP{/cyan-fg}';
    }
  }

  /**
   * Agentコンテナを作成
   */
  private createAgentContainer(): blessed.Widgets.BoxElement {
    return blessed.box({
      top: 3,
      left: 0,
      width: '100%',
      height: '55%-3',
    });
  }

  /**
   * デフォルトキーバインドを設定
   */
  private setupDefaultKeyBindings(): void {
    // 終了
    this.keyHandler.bind(['q', 'C-c', 'escape'], () => {
      this.destroy();
      process.exit(0);
    });

    // ヘルプ表示/非表示
    this.keyHandler.bind(['h', '?'], () => {
      this.toggleHelp();
    });

    // 一時停止/再開
    this.keyHandler.bind(['p'], () => {
      this.pause();
    });

    this.keyHandler.bind(['r'], () => {
      this.resume();
    });

    // 介入モード
    this.keyHandler.bind(['i'], () => {
      this.startIntervention();
    });

    // フォーカス移動
    this.keyHandler.bind(['tab'], () => {
      this.agentPaneManager.focusNext();
      this.updateFooter();
    });

    this.keyHandler.bind(['S-tab'], () => {
      this.agentPaneManager.focusPrevious();
      this.updateFooter();
    });

    // ログスクロール
    this.keyHandler.bind(['j', 'down'], () => {
      this.logStream.scrollDown();
    });

    this.keyHandler.bind(['k', 'up'], () => {
      this.logStream.scrollUp();
    });

    this.keyHandler.bind(['g'], () => {
      this.logStream.scrollToTop();
    });

    this.keyHandler.bind(['G'], () => {
      this.logStream.scrollToBottom();
    });

    // ログクリア
    this.keyHandler.bind(['c'], () => {
      this.logStream.clear();
      this.logStream.system('Logs cleared');
    });

    // 数字キーでペイン選択
    for (let i = 1; i <= 9; i++) {
      this.keyHandler.bind([`${i}`], () => {
        const paneIds = Array.from(this.agentPaneManager.getAllPanes().keys());
        if (paneIds[i - 1]) {
          this.agentPaneManager.focusPane(paneIds[i - 1]);
          this.updateFooter();
        }
      });
    }
  }

  /**
   * プログレスバーを作成
   */
  private createProgressBar(progress: number, width: number): string {
    const filled = Math.round((progress / 100) * width);
    const empty = width - filled;
    return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
  }

  /**
   * 時間をフォーマット
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * セッション情報を設定
   */
  setSessionInfo(info: SessionInfo): void {
    this.sessionInfo = info;
    this.updateHeader();
  }

  /**
   * 全体の進捗を更新
   */
  updateOverallProgress(progress: number): void {
    this.overallProgress = Math.max(0, Math.min(100, progress));
    this.updateHeader();
  }

  /**
   * ヘッダーを更新
   */
  updateHeader(): void {
    this.header.setContent(this.generateHeaderContent());
    this.screen.render();
  }

  /**
   * フッターを更新
   */
  updateFooter(): void {
    this.footer.setContent(this.generateFooterContent());
    this.screen.render();
  }

  /**
   * Agentを追加
   */
  addAgent(agent: Agent): AgentPane {
    const panes = this.agentPaneManager.getAllPanes();
    const agentCount = panes.size + 1;

    // レイアウト位置を計算
    const positions = this.calculateAgentPositions(agentCount);
    const position = positions[agentCount - 1];

    // AgentPaneを作成
    const pane = this.agentPaneManager.createPane({
      parent: this.agentContainer,
      top: position.top,
      left: position.left,
      width: position.width,
      height: position.height,
      agent,
    });

    // 既存のペインも再配置
    this.repositionAgentPanes();

    if (this.sessionInfo) {
      this.sessionInfo.agentCount = agentCount;
      this.updateHeader();
    }

    this.logStream.info(agent.id, `Agent created: ${agent.mission}`);

    return pane;
  }

  /**
   * Agent位置を計算
   */
  private calculateAgentPositions(count: number): PaneConfig[] {
    if (count <= 0) return [];

    if (count === 1) {
      return [{ id: 'agent-0', top: 0, left: 0, width: '100%', height: '100%' }];
    }
    if (count === 2) {
      return [
        { id: 'agent-0', top: 0, left: 0, width: '50%', height: '100%' },
        { id: 'agent-1', top: 0, left: '50%', width: '50%', height: '100%' },
      ];
    }
    if (count === 3) {
      return [
        { id: 'agent-0', top: 0, left: 0, width: '33%', height: '100%' },
        { id: 'agent-1', top: 0, left: '33%', width: '34%', height: '100%' },
        { id: 'agent-2', top: 0, left: '67%', width: '33%', height: '100%' },
      ];
    }
    if (count === 4) {
      return [
        { id: 'agent-0', top: 0, left: 0, width: '50%', height: '50%' },
        { id: 'agent-1', top: 0, left: '50%', width: '50%', height: '50%' },
        { id: 'agent-2', top: '50%', left: 0, width: '50%', height: '50%' },
        { id: 'agent-3', top: '50%', left: '50%', width: '50%', height: '50%' },
      ];
    }

    // 5以上はグリッド
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const panes: PaneConfig[] = [];

    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const widthPercent = Math.floor(100 / cols);
      const heightPercent = Math.floor(100 / rows);

      panes.push({
        id: `agent-${i}`,
        top: `${row * heightPercent}%`,
        left: `${col * widthPercent}%`,
        width: `${widthPercent}%`,
        height: `${heightPercent}%`,
      });
    }

    return panes;
  }

  /**
   * Agentペインを再配置
   */
  private repositionAgentPanes(): void {
    const panes = Array.from(this.agentPaneManager.getAllPanes().entries());
    const positions = this.calculateAgentPositions(panes.length);

    panes.forEach(([_id, pane], index) => {
      const pos = positions[index];
      if (pos) {
        const box = pane.getBox();
        box.top = pos.top;
        box.left = pos.left;
        box.width = pos.width;
        box.height = pos.height;
      }
    });

    this.screen.render();
  }

  /**
   * Agentのステータスを更新
   */
  updateAgentStatus(agentId: string, status: AgentStatus): void {
    this.agentPaneManager.updateAgentStatus(agentId, status);
    this.logStream.info(agentId, `Status changed to: ${status}`);
  }

  /**
   * Agentの進捗を更新
   */
  updateAgentProgress(agentId: string, progress: number): void {
    this.agentPaneManager.updateAgentProgress(agentId, progress);
  }

  /**
   * Agentのタスクを設定
   */
  setAgentTask(agentId: string, task: Task | null): void {
    this.agentPaneManager.setAgentTask(agentId, task);
    if (task) {
      this.logStream.info(agentId, `Task started: ${task.description}`);
    }
  }

  /**
   * ログを追加
   */
  log(level: 'debug' | 'info' | 'warn' | 'error', source: string, message: string): void {
    this.logStream.log(level, source, message);
  }

  /**
   * 一時停止
   */
  pause(): void {
    this.mode = 'paused';
    this.logStream.pause();
    this.logStream.system('Session paused', 'warn');
    this.updateFooter();
  }

  /**
   * 再開
   */
  resume(): void {
    if (this.mode === 'paused') {
      this.mode = 'normal';
      this.logStream.resume();
      this.logStream.system('Session resumed');
      this.updateFooter();
    }
  }

  /**
   * 介入モードを開始
   */
  startIntervention(): void {
    this.mode = 'intervention';
    this.logStream.system('Intervention mode started', 'warn');
    this.updateFooter();
    this.showInterventionDialog();
  }

  /**
   * 介入ダイアログを表示
   */
  private showInterventionDialog(): void {
    if (this.interventionBox) return;

    this.interventionBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '40%',
      label: ' Intervention Mode ',
      content: `
  Intervention Controls:

  [Enter] Send command to focused agent
  [a] Abort current task
  [s] Skip current task
  [m] Modify mission
  [Esc] Exit intervention mode

  Type your command below:
`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'magenta',
        },
      },
      tags: true,
    });

    this.screen.render();

    // ESCで閉じる
    const closeHandler = () => {
      this.closeInterventionDialog();
    };
    (this.screen as unknown as { onceKey(keys: string[], cb: () => void): void }).onceKey(['escape'], closeHandler);
  }

  /**
   * 介入ダイアログを閉じる
   */
  private closeInterventionDialog(): void {
    if (this.interventionBox) {
      this.interventionBox.destroy();
      this.interventionBox = null;
      this.mode = 'normal';
      this.updateFooter();
      this.screen.render();
    }
  }

  /**
   * ヘルプ表示を切り替え
   */
  toggleHelp(): void {
    if (this.helpBox) {
      this.closeHelp();
    } else {
      this.showHelp();
    }
  }

  /**
   * ヘルプを表示
   */
  private showHelp(): void {
    this.mode = 'help';

    this.helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '70%',
      label: ' AIDOS Help ',
      content: `
  {bold}Keyboard Shortcuts:{/bold}

  {cyan-fg}General:{/cyan-fg}
    h, ?        Show this help
    q, Ctrl+C   Quit application

  {cyan-fg}Session Control:{/cyan-fg}
    p           Pause session
    r           Resume session
    i           Enter intervention mode

  {cyan-fg}Navigation:{/cyan-fg}
    Tab         Focus next agent pane
    Shift+Tab   Focus previous agent pane
    1-9         Focus agent pane by number

  {cyan-fg}Logs:{/cyan-fg}
    j, Down     Scroll logs down
    k, Up       Scroll logs up
    g           Scroll to top
    G           Scroll to bottom
    c           Clear logs

  {cyan-fg}Intervention Mode:{/cyan-fg}
    Enter       Send command
    a           Abort task
    s           Skip task
    Esc         Exit intervention

  {gray-fg}Press any key to close this help...{/gray-fg}
`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'cyan',
        },
      },
      tags: true,
    });

    this.updateFooter();
    this.screen.render();

    // 任意のキーで閉じる
    (this.screen as unknown as { onceKey(keys: string[], cb: () => void): void }).onceKey(['escape', 'enter', 'space', 'q'], () => {
      this.closeHelp();
    });
  }

  /**
   * ヘルプを閉じる
   */
  private closeHelp(): void {
    if (this.helpBox) {
      this.helpBox.destroy();
      this.helpBox = null;
      this.mode = 'normal';
      this.updateFooter();
      this.screen.render();
    }
  }

  /**
   * 完了メッセージを表示
   */
  showCompletion(message: string): void {
    const completionBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: '30%',
      label: ' Session Complete ',
      content: `
  {green-fg}${message}{/green-fg}

  Session has completed successfully.

  Press any key to exit...
`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'green',
        },
      },
      tags: true,
    });

    this.screen.render();

    (this.screen as unknown as { onceKey(keys: string[], cb: () => void): void }).onceKey(['escape', 'enter', 'space', 'q'], () => {
      completionBox.destroy();
      this.destroy();
      process.exit(0);
    });
  }

  /**
   * エラーメッセージを表示
   */
  showError(error: string): void {
    this.logStream.error('System', error);

    const errorBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '30%',
      label: ' Error ',
      content: `
  {red-fg}${error}{/red-fg}

  Press any key to continue...
`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'red',
        },
      },
      tags: true,
    });

    this.screen.render();

    (this.screen as unknown as { onceKey(keys: string[], cb: () => void): void }).onceKey(['escape', 'enter', 'space'], () => {
      errorBox.destroy();
      this.screen.render();
    });
  }

  /**
   * スクリーンを取得
   */
  getScreen(): blessed.Widgets.Screen {
    return this.screen;
  }

  /**
   * ログストリームを取得
   */
  getLogStream(): LogStream {
    return this.logStream;
  }

  /**
   * AgentPaneManagerを取得
   */
  getAgentPaneManager(): AgentPaneManager {
    return this.agentPaneManager;
  }

  /**
   * キーハンドラーを取得
   */
  getKeyHandler(): KeyHandler {
    return this.keyHandler;
  }

  /**
   * 現在のモードを取得
   */
  getMode(): DashboardMode {
    return this.mode;
  }

  /**
   * レンダリング
   */
  render(): void {
    this.screen.render();
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.keyHandler.destroy();
    this.agentPaneManager.destroy();
    this.logStream.destroy();
    this.layoutManager.destroy();
    this.screen.destroy();
  }
}

export default Dashboard;
