/**
 * AIDOS Task Editor Component
 *
 * タスクの詳細表示・編集コンポーネント
 * - タスクの詳細表示・編集
 * - 依存関係の編集
 * - 優先度の変更
 */

import blessed from 'blessed';
import { EventEmitter } from 'node:events';
import type { Task, TaskStatus, TaskCategory, DecomposedTask } from '../types.js';

// ========================================
// 型定義
// ========================================

export interface TaskEditorConfig {
  width?: string | number;
  height?: string | number;
  readonly?: boolean;
}

export interface TaskChange {
  field: keyof Task | 'dependency_add' | 'dependency_remove';
  oldValue: unknown;
  newValue: unknown;
}

export interface TaskEditorResult {
  saved: boolean;
  task: Task | null;
  changes: TaskChange[];
}

// ========================================
// カテゴリ・ステータス定義
// ========================================

const TASK_CATEGORIES: TaskCategory[] = ['design', 'implement', 'test', 'document', 'other'];

const TASK_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'completed', 'failed'];

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'gray',
  in_progress: 'yellow',
  completed: 'green',
  failed: 'red',
};

const CATEGORY_ICONS: Record<TaskCategory, string> = {
  design: '[D]',
  implement: '[I]',
  test: '[T]',
  document: '[O]',
  other: '[?]',
};

// ========================================
// TaskEditor クラス
// ========================================

export class TaskEditor extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private dialog: blessed.Widgets.BoxElement | null = null;
  private config: Required<TaskEditorConfig>;

  constructor(screen: blessed.Widgets.Screen, config: TaskEditorConfig = {}) {
    super();
    this.screen = screen;
    this.config = {
      width: config.width ?? '80%',
      height: config.height ?? '80%',
      readonly: config.readonly ?? false,
    };
  }

  /**
   * タスク詳細を表示（読み取り専用）
   */
  async showDetails(task: Task): Promise<void> {
    return new Promise((resolve) => {
      this.dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: this.config.width,
        height: this.config.height,
        label: ` Task Details: ${task.id} `,
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
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
      });

      const content = this.formatTaskDetails(task);
      this.dialog.setContent(content);

      // 閉じるボタン
      const closeBtn = blessed.button({
        parent: this.dialog,
        bottom: 1,
        left: 'center',
        width: 15,
        height: 3,
        content: ' [ESC] Close ',
        style: {
          fg: 'black',
          bg: 'gray',
        },
        border: {
          type: 'line',
        },
      });

      const cleanup = () => {
        if (this.dialog) {
          this.dialog.destroy();
          this.dialog = null;
        }
        this.screen.render();
        resolve();
      };

      closeBtn.on('press', cleanup);

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['escape', 'q'], cleanup);

      this.dialog.focus();
      this.screen.render();
    });
  }

  /**
   * タスクを編集
   */
  async edit(task: Task, availableTasks: Task[] = []): Promise<TaskEditorResult> {
    return new Promise((resolve) => {
      const editedTask = { ...task };
      const changes: TaskChange[] = [];

      this.dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: this.config.width,
        height: this.config.height,
        label: ` Edit Task: ${task.id} `,
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
        tags: true,
      });

      let currentField = 0;
      const fields: { name: string; element: blessed.Widgets.Node }[] = [];

      // Description
      blessed.text({
        parent: this.dialog,
        top: 1,
        left: 2,
        content: '{bold}Description:{/bold}',
        tags: true,
      });

      const descInput = blessed.textarea({
        parent: this.dialog,
        top: 3,
        left: 2,
        width: '96%',
        height: 4,
        border: { type: 'line' },
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'gray' },
          focus: { border: { fg: 'cyan' } },
        },
        inputOnFocus: true,
        mouse: true,
      });
      (descInput as unknown as { setValue(val: string): void }).setValue(task.description);
      fields.push({ name: 'description', element: descInput });

      // Category
      blessed.text({
        parent: this.dialog,
        top: 8,
        left: 2,
        content: '{bold}Category:{/bold}',
        tags: true,
      });

      const categoryList = blessed.list({
        parent: this.dialog,
        top: 10,
        left: 2,
        width: '30%',
        height: 7,
        items: TASK_CATEGORIES.map(c => ` ${CATEGORY_ICONS[c]} ${c.charAt(0).toUpperCase() + c.slice(1)} `),
        keys: true,
        vi: true,
        mouse: true,
        style: {
          selected: { fg: 'black', bg: 'cyan' },
        },
        border: { type: 'line' },
      });
      categoryList.select(TASK_CATEGORIES.indexOf(task.category));
      fields.push({ name: 'category', element: categoryList });

      // Status
      blessed.text({
        parent: this.dialog,
        top: 8,
        left: '35%',
        content: '{bold}Status:{/bold}',
        tags: true,
      });

      const statusList = blessed.list({
        parent: this.dialog,
        top: 10,
        left: '35%',
        width: '30%',
        height: 6,
        items: TASK_STATUSES.map(s => ` [${STATUS_COLORS[s].charAt(0).toUpperCase()}] ${s} `),
        keys: true,
        vi: true,
        mouse: true,
        style: {
          selected: { fg: 'black', bg: 'cyan' },
        },
        border: { type: 'line' },
      });
      statusList.select(TASK_STATUSES.indexOf(task.status));
      fields.push({ name: 'status', element: statusList });

      // Progress
      blessed.text({
        parent: this.dialog,
        top: 8,
        left: '70%',
        content: '{bold}Progress:{/bold}',
        tags: true,
      });

      const progressInput = blessed.textbox({
        parent: this.dialog,
        top: 10,
        left: '70%',
        width: '25%',
        height: 3,
        border: { type: 'line' },
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'gray' },
          focus: { border: { fg: 'cyan' } },
        },
        inputOnFocus: true,
      });
      (progressInput as unknown as { setValue(val: string): void }).setValue(task.progress.toString());
      fields.push({ name: 'progress', element: progressInput });

      // Dependencies
      blessed.text({
        parent: this.dialog,
        top: 18,
        left: 2,
        content: '{bold}Dependencies:{/bold}',
        tags: true,
      });

      const depList = blessed.list({
        parent: this.dialog,
        top: 20,
        left: 2,
        width: '45%',
        height: 8,
        items: task.dependencies.length > 0
          ? task.dependencies.map(d => ` - ${d}`)
          : [' (none)'],
        keys: true,
        vi: true,
        mouse: true,
        style: {
          selected: { fg: 'black', bg: 'cyan' },
        },
        border: { type: 'line' },
      });
      fields.push({ name: 'dependencies', element: depList });

      // Available tasks for adding dependencies
      blessed.text({
        parent: this.dialog,
        top: 18,
        left: '50%',
        content: '{bold}Available Tasks:{/bold}',
        tags: true,
      });

      const availableForDep = availableTasks.filter(t =>
        t.id !== task.id && !editedTask.dependencies.includes(t.id)
      );

      const availableList = blessed.list({
        parent: this.dialog,
        top: 20,
        left: '50%',
        width: '45%',
        height: 8,
        items: availableForDep.length > 0
          ? availableForDep.map(t => ` + ${t.id}: ${t.description.substring(0, 20)}...`)
          : [' (none available)'],
        keys: true,
        vi: true,
        mouse: true,
        style: {
          selected: { fg: 'black', bg: 'cyan' },
        },
        border: { type: 'line' },
      });
      fields.push({ name: 'available', element: availableList });

      // Buttons
      const saveBtn = blessed.button({
        parent: this.dialog,
        bottom: 1,
        left: 2,
        width: 15,
        height: 3,
        content: ' [S] Save ',
        style: {
          fg: 'black',
          bg: 'green',
        },
        border: { type: 'line' },
      });

      const cancelBtn = blessed.button({
        parent: this.dialog,
        bottom: 1,
        left: 20,
        width: 15,
        height: 3,
        content: ' [ESC] Cancel ',
        style: {
          fg: 'black',
          bg: 'red',
        },
        border: { type: 'line' },
      });

      const addDepBtn = blessed.button({
        parent: this.dialog,
        bottom: 1,
        left: '50%',
        width: 18,
        height: 3,
        content: ' [A] Add Dep ',
        style: {
          fg: 'black',
          bg: 'yellow',
        },
        border: { type: 'line' },
      });

      const removeDepBtn = blessed.button({
        parent: this.dialog,
        bottom: 1,
        right: 2,
        width: 18,
        height: 3,
        content: ' [D] Remove Dep ',
        style: {
          fg: 'black',
          bg: 'magenta',
        },
        border: { type: 'line' },
      });

      const cleanup = () => {
        if (this.dialog) {
          this.dialog.destroy();
          this.dialog = null;
        }
        this.screen.render();
      };

      const collectChanges = (): Task => {
        const newDesc = (descInput as unknown as { getValue(): string }).getValue().trim();
        if (newDesc !== task.description) {
          changes.push({ field: 'description', oldValue: task.description, newValue: newDesc });
          editedTask.description = newDesc;
        }

        const newCategory = TASK_CATEGORIES[(categoryList as unknown as { selected: number }).selected];
        if (newCategory !== task.category) {
          changes.push({ field: 'category', oldValue: task.category, newValue: newCategory });
          editedTask.category = newCategory;
        }

        const newStatus = TASK_STATUSES[(statusList as unknown as { selected: number }).selected];
        if (newStatus !== task.status) {
          changes.push({ field: 'status', oldValue: task.status, newValue: newStatus });
          editedTask.status = newStatus;
        }

        const newProgress = parseInt((progressInput as unknown as { getValue(): string }).getValue(), 10);
        if (!isNaN(newProgress) && newProgress !== task.progress) {
          changes.push({ field: 'progress', oldValue: task.progress, newValue: newProgress });
          editedTask.progress = Math.max(0, Math.min(100, newProgress));
        }

        return editedTask;
      };

      const save = () => {
        const finalTask = collectChanges();
        cleanup();
        this.emit('task:saved', finalTask, changes);
        resolve({ saved: true, task: finalTask, changes });
      };

      const cancel = () => {
        cleanup();
        resolve({ saved: false, task: null, changes: [] });
      };

      const addDependency = () => {
        if (availableForDep.length === 0) return;
        const selectedTask = availableForDep[(availableList as unknown as { selected: number }).selected];
        if (selectedTask && !editedTask.dependencies.includes(selectedTask.id)) {
          editedTask.dependencies.push(selectedTask.id);
          changes.push({
            field: 'dependency_add',
            oldValue: null,
            newValue: selectedTask.id,
          });
          depList.setItems(editedTask.dependencies.map(d => ` - ${d}`));
          this.screen.render();
        }
      };

      const removeDependency = () => {
        if (editedTask.dependencies.length === 0) return;
        const selectedDep = editedTask.dependencies[(depList as unknown as { selected: number }).selected];
        if (selectedDep) {
          editedTask.dependencies = editedTask.dependencies.filter(d => d !== selectedDep);
          changes.push({
            field: 'dependency_remove',
            oldValue: selectedDep,
            newValue: null,
          });
          depList.setItems(
            editedTask.dependencies.length > 0
              ? editedTask.dependencies.map(d => ` - ${d}`)
              : [' (none)']
          );
          this.screen.render();
        }
      };

      // Event handlers
      saveBtn.on('press', save);
      cancelBtn.on('press', cancel);
      addDepBtn.on('press', addDependency);
      removeDepBtn.on('press', removeDependency);

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['s', 'S', 'C-s'], save);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['escape', 'q'], cancel);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['a', 'A'], addDependency);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['d', 'D'], removeDependency);

      // Tab navigation between fields
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['tab'], () => {
        currentField = (currentField + 1) % fields.length;
        (fields[currentField].element as unknown as { focus(): void }).focus();
        this.screen.render();
      });

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['S-tab'], () => {
        currentField = (currentField - 1 + fields.length) % fields.length;
        (fields[currentField].element as unknown as { focus(): void }).focus();
        this.screen.render();
      });

      descInput.focus();
      this.screen.render();
    });
  }

  /**
   * タスク詳細をフォーマット
   */
  private formatTaskDetails(task: Task): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(`  {bold}ID:{/bold} ${task.id}`);
    lines.push('');
    lines.push(`  {bold}Description:{/bold}`);
    lines.push(`    ${task.description}`);
    lines.push('');
    lines.push(`  {bold}Category:{/bold} ${CATEGORY_ICONS[task.category]} ${task.category}`);
    lines.push(`  {bold}Status:{/bold} {${STATUS_COLORS[task.status]}-fg}${task.status}{/${STATUS_COLORS[task.status]}-fg}`);
    lines.push(`  {bold}Progress:{/bold} ${this.createProgressBar(task.progress)} ${task.progress}%`);
    lines.push('');
    lines.push(`  {bold}Agent:{/bold} ${task.agentId}`);
    lines.push('');
    lines.push(`  {bold}Dependencies:{/bold}`);
    if (task.dependencies.length > 0) {
      task.dependencies.forEach(dep => {
        lines.push(`    - ${dep}`);
      });
    } else {
      lines.push('    (none)');
    }
    lines.push('');
    lines.push(`  {bold}Created:{/bold} ${task.createdAt.toISOString()}`);
    if (task.completedAt) {
      lines.push(`  {bold}Completed:{/bold} ${task.completedAt.toISOString()}`);
    }
    if (task.output) {
      lines.push('');
      lines.push(`  {bold}Output:{/bold}`);
      lines.push(`    ${task.output}`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * プログレスバーを作成
   */
  private createProgressBar(progress: number): string {
    const width = 20;
    const filled = Math.round((progress / 100) * width);
    const empty = width - filled;
    return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
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
    if (this.dialog) {
      this.dialog.destroy();
      this.dialog = null;
      this.screen.render();
    }
  }

  /**
   * 破棄
   */
  destroy(): void {
    this.close();
    this.removeAllListeners();
  }
}

// ========================================
// TaskListEditor クラス
// ========================================

/**
 * 複数タスクの一覧編集を行うエディタ
 */
export class TaskListEditor extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private dialog: blessed.Widgets.BoxElement | null = null;
  private taskList: blessed.Widgets.ListElement | null = null;
  private tasks: Task[] = [];
  private selectedIndex: number = 0;

  constructor(screen: blessed.Widgets.Screen) {
    super();
    this.screen = screen;
  }

  /**
   * タスク一覧を編集
   */
  async show(tasks: Task[]): Promise<{ tasks: Task[]; modified: boolean }> {
    return new Promise((resolve) => {
      this.tasks = [...tasks];
      let modified = false;

      this.dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '85%',
        height: '85%',
        label: ' Task List Editor ',
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

      // ヘルプテキスト
      blessed.text({
        parent: this.dialog,
        top: 1,
        left: 2,
        content: '{gray-fg}[E]dit  [D]elete  [U]p  [N]Down  [Enter]View  [S]ave  [ESC]Cancel{/gray-fg}',
        tags: true,
      });

      // タスク一覧
      this.taskList = blessed.list({
        parent: this.dialog,
        top: 3,
        left: 2,
        width: '96%',
        height: '80%',
        items: this.formatTaskListItems(),
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
      const saveBtn = blessed.button({
        parent: this.dialog,
        bottom: 1,
        left: 2,
        width: 15,
        height: 3,
        content: ' [S] Save ',
        style: {
          fg: 'black',
          bg: 'green',
        },
        border: { type: 'line' },
      });

      const cancelBtn = blessed.button({
        parent: this.dialog,
        bottom: 1,
        left: 20,
        width: 15,
        height: 3,
        content: ' [ESC] Cancel ',
        style: {
          fg: 'black',
          bg: 'red',
        },
        border: { type: 'line' },
      });

      const cleanup = () => {
        if (this.dialog) {
          this.dialog.destroy();
          this.dialog = null;
          this.taskList = null;
        }
        this.screen.render();
      };

      const save = () => {
        cleanup();
        resolve({ tasks: this.tasks, modified });
      };

      const cancel = () => {
        cleanup();
        resolve({ tasks, modified: false });
      };

      const editTask = async () => {
        if (this.tasks.length === 0) return;
        const task = this.tasks[(this.taskList as unknown as { selected: number }).selected];
        if (!task) return;

        const editor = new TaskEditor(this.screen);
        const result = await editor.edit(task, this.tasks);
        editor.destroy();

        if (result.saved && result.task) {
          this.tasks[(this.taskList as unknown as { selected: number }).selected] = result.task;
          this.taskList!.setItems(this.formatTaskListItems());
          modified = true;
          this.screen.render();
        }
      };

      const deleteTask = () => {
        if (this.tasks.length === 0) return;
        const index = (this.taskList as unknown as { selected: number }).selected;
        this.tasks.splice(index, 1);
        this.taskList!.setItems(this.formatTaskListItems());
        modified = true;
        this.screen.render();
      };

      const moveUp = () => {
        const index = (this.taskList as unknown as { selected: number }).selected;
        if (index > 0) {
          [this.tasks[index - 1], this.tasks[index]] = [this.tasks[index], this.tasks[index - 1]];
          this.taskList!.setItems(this.formatTaskListItems());
          this.taskList!.select(index - 1);
          modified = true;
          this.screen.render();
        }
      };

      const moveDown = () => {
        const index = (this.taskList as unknown as { selected: number }).selected;
        if (index < this.tasks.length - 1) {
          [this.tasks[index], this.tasks[index + 1]] = [this.tasks[index + 1], this.tasks[index]];
          this.taskList!.setItems(this.formatTaskListItems());
          this.taskList!.select(index + 1);
          modified = true;
          this.screen.render();
        }
      };

      const viewTask = async () => {
        if (this.tasks.length === 0) return;
        const task = this.tasks[(this.taskList as unknown as { selected: number }).selected];
        if (!task) return;

        const editor = new TaskEditor(this.screen);
        await editor.showDetails(task);
        editor.destroy();
      };

      // Event handlers
      saveBtn.on('press', save);
      cancelBtn.on('press', cancel);

      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['s', 'S', 'C-s'], save);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['escape', 'q'], cancel);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['e', 'E'], editTask);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['d', 'D'], deleteTask);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['u', 'U'], moveUp);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['n', 'N'], moveDown);
      (this.screen as unknown as { key(keys: string[], handler: () => void): void }).key(['enter'], viewTask);

      this.taskList.focus();
      this.screen.render();
    });
  }

  /**
   * タスク一覧アイテムをフォーマット
   */
  private formatTaskListItems(): string[] {
    if (this.tasks.length === 0) {
      return [' (no tasks)'];
    }

    return this.tasks.map((task, index) => {
      const statusIcon = {
        pending: '[ ]',
        in_progress: '[~]',
        completed: '[v]',
        failed: '[x]',
      }[task.status];

      const categoryIcon = CATEGORY_ICONS[task.category];
      const progress = `${task.progress}%`.padStart(4);
      const desc = task.description.substring(0, 40).padEnd(40);

      return ` ${index + 1}. ${statusIcon} ${categoryIcon} ${desc} ${progress}`;
    });
  }

  /**
   * 破棄
   */
  destroy(): void {
    if (this.dialog) {
      this.dialog.destroy();
      this.dialog = null;
      this.taskList = null;
    }
    this.removeAllListeners();
  }
}

export default TaskEditor;
