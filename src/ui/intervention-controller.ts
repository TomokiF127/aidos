/**
 * AIDOS Intervention Controller
 *
 * 人間介入機能を提供するコントローラー
 * - 承認フロー（重要な決定前に人間の承認を要求）
 * - 方向修正インターフェース
 * - タスクの動的追加/削除/編集
 */

import blessed from 'blessed';
import { EventEmitter } from 'node:events';
import type { Task, TaskStatus, TaskCategory, DecomposedTask } from '../types.js';

// ========================================
// 型定義
// ========================================

export type InterventionType =
  | 'approval'      // 承認要求
  | 'direction'     // 方向修正
  | 'task_edit'     // タスク編集
  | 'task_add'      // タスク追加
  | 'task_delete'   // タスク削除
  | 'abort'         // 中止
  | 'pause'         // 一時停止
  | 'custom';       // カスタム

export type ApprovalResult = 'approved' | 'rejected' | 'modified' | 'timeout';

export interface InterventionRequest {
  id: string;
  type: InterventionType;
  title: string;
  description: string;
  agentId?: string;
  taskId?: string;
  data?: unknown;
  priority: 'low' | 'normal' | 'high' | 'critical';
  timeoutMs?: number;
  autoApprove?: boolean;
  createdAt: Date;
}

export interface InterventionResponse {
  requestId: string;
  result: ApprovalResult;
  feedback?: string;
  modifiedData?: unknown;
  respondedAt: Date;
}

export interface DirectionCorrection {
  type: 'modify_goal' | 'add_constraint' | 'remove_constraint' | 'change_priority' | 'custom';
  description: string;
  targetAgentId?: string;
  newValue?: unknown;
}

export interface TaskModification {
  taskId: string;
  action: 'update' | 'add' | 'delete' | 'reorder';
  changes?: Partial<Task>;
  newTask?: DecomposedTask;
  newPosition?: number;
}

export interface InterventionControllerConfig {
  defaultTimeoutMs?: number;
  autoApproveOnTimeout?: boolean;
  maxQueueSize?: number;
  notifyOnNewRequest?: boolean;
}

// ========================================
// イベント型
// ========================================

export interface InterventionEvents {
  'request:created': (request: InterventionRequest) => void;
  'request:responded': (response: InterventionResponse) => void;
  'request:timeout': (request: InterventionRequest) => void;
  'direction:changed': (correction: DirectionCorrection) => void;
  'task:modified': (modification: TaskModification) => void;
  'queue:updated': (queueSize: number) => void;
}

// ========================================
// InterventionController クラス
// ========================================

export class InterventionController extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private config: Required<InterventionControllerConfig>;
  private requestQueue: Map<string, InterventionRequest> = new Map();
  private activeDialog: blessed.Widgets.BoxElement | null = null;
  private pendingResolvers: Map<string, (response: InterventionResponse) => void> = new Map();
  private timeoutTimers: Map<string, NodeJS.Timeout> = new Map();
  private requestCounter: number = 0;

  constructor(screen: blessed.Widgets.Screen, config: InterventionControllerConfig = {}) {
    super();
    this.screen = screen;
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? 60000,
      autoApproveOnTimeout: config.autoApproveOnTimeout ?? false,
      maxQueueSize: config.maxQueueSize ?? 100,
      notifyOnNewRequest: config.notifyOnNewRequest ?? true,
    };
  }

  // ========================================
  // 承認フロー
  // ========================================

  /**
   * 承認を要求
   */
  async requestApproval(
    title: string,
    description: string,
    options: {
      agentId?: string;
      taskId?: string;
      priority?: InterventionRequest['priority'];
      timeoutMs?: number;
      autoApprove?: boolean;
      data?: unknown;
    } = {}
  ): Promise<InterventionResponse> {
    const request = this.createRequest('approval', title, description, options);
    return this.processRequest(request);
  }

  /**
   * カスタム承認ダイアログを表示
   */
  async showApprovalDialog(request: InterventionRequest): Promise<InterventionResponse> {
    return new Promise((resolve) => {
      const priorityColors: Record<string, string> = {
        low: 'gray',
        normal: 'white',
        high: 'yellow',
        critical: 'red',
      };

      const borderColor = priorityColors[request.priority] || 'white';

      const dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '70%',
        height: '50%',
        label: ` ${request.title} `,
        content: this.formatApprovalContent(request),
        border: {
          type: 'line',
        },
        style: {
          fg: 'white',
          bg: 'black',
          border: {
            fg: borderColor,
          },
        },
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
      });

      // ボタンコンテナ
      const buttonContainer = blessed.box({
        parent: dialog,
        bottom: 1,
        left: 'center',
        width: '90%',
        height: 3,
      });

      // 承認ボタン
      const approveBtn = blessed.button({
        parent: buttonContainer,
        left: 0,
        width: '30%',
        height: 3,
        content: ' [Y] Approve ',
        style: {
          fg: 'black',
          bg: 'green',
          focus: {
            fg: 'white',
            bg: 'green',
          },
        },
        border: {
          type: 'line',
        },
      });

      // 拒否ボタン
      const rejectBtn = blessed.button({
        parent: buttonContainer,
        left: '35%',
        width: '30%',
        height: 3,
        content: ' [N] Reject ',
        style: {
          fg: 'black',
          bg: 'red',
          focus: {
            fg: 'white',
            bg: 'red',
          },
        },
        border: {
          type: 'line',
        },
      });

      // 修正ボタン
      const modifyBtn = blessed.button({
        parent: buttonContainer,
        left: '70%',
        width: '30%',
        height: 3,
        content: ' [M] Modify ',
        style: {
          fg: 'black',
          bg: 'yellow',
          focus: {
            fg: 'white',
            bg: 'yellow',
          },
        },
        border: {
          type: 'line',
        },
      });

      this.activeDialog = dialog;

      const cleanup = () => {
        this.clearRequestTimeout(request.id);
        dialog.destroy();
        this.activeDialog = null;
        this.screen.render();
      };

      const createResponse = (result: ApprovalResult, feedback?: string): InterventionResponse => ({
        requestId: request.id,
        result,
        feedback,
        respondedAt: new Date(),
      });

      // キーバインド
      const handleKey = (key: string) => {
        if (key === 'y' || key === 'Y') {
          cleanup();
          resolve(createResponse('approved'));
        } else if (key === 'n' || key === 'N') {
          cleanup();
          resolve(createResponse('rejected'));
        } else if (key === 'm' || key === 'M') {
          cleanup();
          resolve(createResponse('modified'));
        } else if (key === 'escape') {
          cleanup();
          resolve(createResponse('rejected', 'Cancelled by user'));
        }
      };

      (this.screen as unknown as { key(keys: string[], handler: (ch: string, key: { name: string }) => void): void }).key(
        ['y', 'Y', 'n', 'N', 'm', 'M', 'escape'],
        (_ch: string, key: { name: string }) => handleKey(key.name)
      );

      // ボタンクリック
      approveBtn.on('press', () => {
        cleanup();
        resolve(createResponse('approved'));
      });

      rejectBtn.on('press', () => {
        cleanup();
        resolve(createResponse('rejected'));
      });

      modifyBtn.on('press', () => {
        cleanup();
        resolve(createResponse('modified'));
      });

      // タイムアウト設定
      if (request.timeoutMs) {
        this.setRequestTimeout(request.id, request.timeoutMs, () => {
          cleanup();
          const result = request.autoApprove ? 'approved' : 'timeout';
          resolve(createResponse(result, 'Request timed out'));
        });
      }

      dialog.focus();
      this.screen.render();
    });
  }

  /**
   * 承認コンテンツをフォーマット
   */
  private formatApprovalContent(request: InterventionRequest): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(`  {bold}Description:{/bold}`);
    lines.push(`  ${request.description}`);
    lines.push('');
    lines.push(`  {bold}Priority:{/bold} ${request.priority.toUpperCase()}`);

    if (request.agentId) {
      lines.push(`  {bold}Agent:{/bold} ${request.agentId}`);
    }

    if (request.taskId) {
      lines.push(`  {bold}Task:{/bold} ${request.taskId}`);
    }

    if (request.timeoutMs) {
      const timeoutSec = Math.round(request.timeoutMs / 1000);
      lines.push(`  {bold}Timeout:{/bold} ${timeoutSec}s`);
      if (request.autoApprove) {
        lines.push(`  {yellow-fg}(Auto-approve on timeout){/yellow-fg}`);
      }
    }

    lines.push('');
    lines.push('  {gray-fg}Press Y to approve, N to reject, M to modify, ESC to cancel{/gray-fg}');
    lines.push('');

    return lines.join('\n');
  }

  // ========================================
  // 方向修正インターフェース
  // ========================================

  /**
   * 方向修正ダイアログを表示
   */
  async showDirectionCorrectionDialog(agentId?: string): Promise<DirectionCorrection | null> {
    return new Promise((resolve) => {
      const dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '70%',
        height: '60%',
        label: ' Direction Correction ',
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

      // 説明テキスト
      blessed.text({
        parent: dialog,
        top: 1,
        left: 2,
        content: '{bold}Select correction type:{/bold}',
        tags: true,
      });

      // オプションリスト
      const list = blessed.list({
        parent: dialog,
        top: 3,
        left: 2,
        width: '96%',
        height: 8,
        items: [
          '1. Modify Goal - Change the current objective',
          '2. Add Constraint - Add a new requirement or limitation',
          '3. Remove Constraint - Remove an existing limitation',
          '4. Change Priority - Adjust task priorities',
          '5. Custom Instruction - Provide custom guidance',
        ],
        keys: true,
        vi: true,
        mouse: true,
        style: {
          selected: {
            fg: 'black',
            bg: 'cyan',
          },
        },
      });

      // 入力フィールド
      const inputLabel = blessed.text({
        parent: dialog,
        top: 12,
        left: 2,
        content: '{bold}Description:{/bold}',
        tags: true,
      });

      const input = blessed.textarea({
        parent: dialog,
        top: 14,
        left: 2,
        width: '96%',
        height: 5,
        border: {
          type: 'line',
        },
        style: {
          fg: 'white',
          bg: 'black',
          border: {
            fg: 'gray',
          },
          focus: {
            border: {
              fg: 'cyan',
            },
          },
        },
        inputOnFocus: true,
        mouse: true,
      });

      // ボタン
      const submitBtn = blessed.button({
        parent: dialog,
        bottom: 1,
        left: 2,
        width: 15,
        height: 3,
        content: ' Submit ',
        style: {
          fg: 'black',
          bg: 'green',
        },
        border: {
          type: 'line',
        },
      });

      const cancelBtn = blessed.button({
        parent: dialog,
        bottom: 1,
        left: 20,
        width: 15,
        height: 3,
        content: ' Cancel ',
        style: {
          fg: 'black',
          bg: 'red',
        },
        border: {
          type: 'line',
        },
      });

      this.activeDialog = dialog;

      const correctionTypes: DirectionCorrection['type'][] = [
        'modify_goal',
        'add_constraint',
        'remove_constraint',
        'change_priority',
        'custom',
      ];

      const cleanup = () => {
        dialog.destroy();
        this.activeDialog = null;
        this.screen.render();
      };

      const submit = () => {
        const selectedIndex = (list as unknown as { selected: number }).selected;
        const description = (input as unknown as { getValue(): string }).getValue().trim();

        if (!description) {
          return;
        }

        cleanup();
        const correction: DirectionCorrection = {
          type: correctionTypes[selectedIndex],
          description,
          targetAgentId: agentId,
        };
        this.emit('direction:changed', correction);
        resolve(correction);
      };

      submitBtn.on('press', submit);

      cancelBtn.on('press', () => {
        cleanup();
        resolve(null);
      });

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['escape'], () => {
        cleanup();
        resolve(null);
      });

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['C-s'], submit);

      list.focus();
      this.screen.render();
    });
  }

  // ========================================
  // タスク管理インターフェース
  // ========================================

  /**
   * タスク追加ダイアログを表示
   */
  async showAddTaskDialog(): Promise<DecomposedTask | null> {
    return new Promise((resolve) => {
      const dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '70%',
        height: '70%',
        label: ' Add New Task ',
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

      // 説明入力
      blessed.text({
        parent: dialog,
        top: 1,
        left: 2,
        content: '{bold}Task Description:{/bold}',
        tags: true,
      });

      const descInput = blessed.textarea({
        parent: dialog,
        top: 3,
        left: 2,
        width: '96%',
        height: 4,
        border: {
          type: 'line',
        },
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'gray' },
          focus: { border: { fg: 'cyan' } },
        },
        inputOnFocus: true,
        mouse: true,
      });

      // カテゴリ選択
      blessed.text({
        parent: dialog,
        top: 8,
        left: 2,
        content: '{bold}Category:{/bold}',
        tags: true,
      });

      const categories: TaskCategory[] = ['design', 'implement', 'test', 'document', 'other'];
      const categoryList = blessed.list({
        parent: dialog,
        top: 10,
        left: 2,
        width: '40%',
        height: 7,
        items: categories.map(c => ` ${c.charAt(0).toUpperCase() + c.slice(1)} `),
        keys: true,
        vi: true,
        mouse: true,
        style: {
          selected: {
            fg: 'black',
            bg: 'cyan',
          },
        },
        border: {
          type: 'line',
        },
      });

      // 優先度選択
      blessed.text({
        parent: dialog,
        top: 8,
        left: '50%',
        content: '{bold}Priority:{/bold}',
        tags: true,
      });

      const priorities = ['1 (Highest)', '2', '3', '4', '5 (Lowest)'];
      const priorityList = blessed.list({
        parent: dialog,
        top: 10,
        left: '50%',
        width: '40%',
        height: 7,
        items: priorities,
        keys: true,
        vi: true,
        mouse: true,
        style: {
          selected: {
            fg: 'black',
            bg: 'cyan',
          },
        },
        border: {
          type: 'line',
        },
      });

      // 複雑度選択
      blessed.text({
        parent: dialog,
        top: 18,
        left: 2,
        content: '{bold}Estimated Complexity:{/bold}',
        tags: true,
      });

      const complexities: DecomposedTask['estimatedComplexity'][] = ['low', 'medium', 'high'];
      const complexityList = blessed.list({
        parent: dialog,
        top: 20,
        left: 2,
        width: '40%',
        height: 5,
        items: complexities.map(c => ` ${c.charAt(0).toUpperCase() + c.slice(1)} `),
        keys: true,
        vi: true,
        mouse: true,
        style: {
          selected: {
            fg: 'black',
            bg: 'cyan',
          },
        },
        border: {
          type: 'line',
        },
      });

      // ボタン
      const submitBtn = blessed.button({
        parent: dialog,
        bottom: 1,
        left: 2,
        width: 15,
        height: 3,
        content: ' Create ',
        style: {
          fg: 'black',
          bg: 'green',
        },
        border: {
          type: 'line',
        },
      });

      const cancelBtn = blessed.button({
        parent: dialog,
        bottom: 1,
        left: 20,
        width: 15,
        height: 3,
        content: ' Cancel ',
        style: {
          fg: 'black',
          bg: 'red',
        },
        border: {
          type: 'line',
        },
      });

      this.activeDialog = dialog;

      const cleanup = () => {
        dialog.destroy();
        this.activeDialog = null;
        this.screen.render();
      };

      const submit = () => {
        const description = (descInput as unknown as { getValue(): string }).getValue().trim();

        if (!description) {
          return;
        }

        const newTask: DecomposedTask = {
          id: `task-${Date.now()}`,
          description,
          category: categories[(categoryList as unknown as { selected: number }).selected],
          dependencies: [],
          priority: (priorityList as unknown as { selected: number }).selected + 1,
          estimatedComplexity: complexities[(complexityList as unknown as { selected: number }).selected],
        };

        cleanup();
        this.emit('task:modified', {
          taskId: newTask.id,
          action: 'add',
          newTask,
        } as TaskModification);
        resolve(newTask);
      };

      submitBtn.on('press', submit);

      cancelBtn.on('press', () => {
        cleanup();
        resolve(null);
      });

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['escape'], () => {
        cleanup();
        resolve(null);
      });

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['C-s'], submit);

      descInput.focus();
      this.screen.render();
    });
  }

  /**
   * タスク削除確認ダイアログ
   */
  async confirmTaskDeletion(task: Task): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: '30%',
        label: ' Confirm Deletion ',
        content: `
  {bold}Are you sure you want to delete this task?{/bold}

  Task ID: ${task.id}
  Description: ${task.description}
  Status: ${task.status}

  {red-fg}This action cannot be undone.{/red-fg}

  Press Y to confirm, N to cancel
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

      this.activeDialog = dialog;

      const cleanup = () => {
        dialog.destroy();
        this.activeDialog = null;
        this.screen.render();
      };

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['y', 'Y'], () => {
        cleanup();
        this.emit('task:modified', {
          taskId: task.id,
          action: 'delete',
        } as TaskModification);
        resolve(true);
      });

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['n', 'N', 'escape'], () => {
        cleanup();
        resolve(false);
      });

      dialog.focus();
      this.screen.render();
    });
  }

  // ========================================
  // リクエスト管理
  // ========================================

  /**
   * リクエストを作成
   */
  private createRequest(
    type: InterventionType,
    title: string,
    description: string,
    options: {
      agentId?: string;
      taskId?: string;
      priority?: InterventionRequest['priority'];
      timeoutMs?: number;
      autoApprove?: boolean;
      data?: unknown;
    }
  ): InterventionRequest {
    const request: InterventionRequest = {
      id: `intervention-${++this.requestCounter}`,
      type,
      title,
      description,
      agentId: options.agentId,
      taskId: options.taskId,
      data: options.data,
      priority: options.priority ?? 'normal',
      timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs,
      autoApprove: options.autoApprove ?? this.config.autoApproveOnTimeout,
      createdAt: new Date(),
    };

    this.requestQueue.set(request.id, request);
    this.emit('request:created', request);
    this.emit('queue:updated', this.requestQueue.size);

    return request;
  }

  /**
   * リクエストを処理
   */
  private async processRequest(request: InterventionRequest): Promise<InterventionResponse> {
    let response: InterventionResponse;

    switch (request.type) {
      case 'approval':
        response = await this.showApprovalDialog(request);
        break;
      default:
        response = await this.showApprovalDialog(request);
    }

    this.requestQueue.delete(request.id);
    this.emit('request:responded', response);
    this.emit('queue:updated', this.requestQueue.size);

    return response;
  }

  /**
   * タイムアウトを設定
   */
  private setRequestTimeout(requestId: string, timeoutMs: number, callback: () => void): void {
    const timer = setTimeout(callback, timeoutMs);
    this.timeoutTimers.set(requestId, timer);
  }

  /**
   * タイムアウトをクリア
   */
  private clearRequestTimeout(requestId: string): void {
    const timer = this.timeoutTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(requestId);
    }
  }

  // ========================================
  // キュー管理
  // ========================================

  /**
   * キューを取得
   */
  getQueue(): InterventionRequest[] {
    return Array.from(this.requestQueue.values());
  }

  /**
   * キューサイズを取得
   */
  getQueueSize(): number {
    return this.requestQueue.size;
  }

  /**
   * 特定のリクエストを取得
   */
  getRequest(requestId: string): InterventionRequest | undefined {
    return this.requestQueue.get(requestId);
  }

  /**
   * リクエストをキャンセル
   */
  cancelRequest(requestId: string): boolean {
    const request = this.requestQueue.get(requestId);
    if (!request) return false;

    this.clearRequestTimeout(requestId);
    this.requestQueue.delete(requestId);

    const resolver = this.pendingResolvers.get(requestId);
    if (resolver) {
      resolver({
        requestId,
        result: 'rejected',
        feedback: 'Request cancelled',
        respondedAt: new Date(),
      });
      this.pendingResolvers.delete(requestId);
    }

    this.emit('queue:updated', this.requestQueue.size);
    return true;
  }

  /**
   * すべてのリクエストをキャンセル
   */
  cancelAllRequests(): void {
    for (const requestId of this.requestQueue.keys()) {
      this.cancelRequest(requestId);
    }
  }

  // ========================================
  // ユーティリティ
  // ========================================

  /**
   * アクティブなダイアログがあるか
   */
  hasActiveDialog(): boolean {
    return this.activeDialog !== null;
  }

  /**
   * アクティブなダイアログを閉じる
   */
  closeActiveDialog(): void {
    if (this.activeDialog) {
      this.activeDialog.destroy();
      this.activeDialog = null;
      this.screen.render();
    }
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.cancelAllRequests();
    this.closeActiveDialog();
    this.removeAllListeners();
  }
}

export default InterventionController;
