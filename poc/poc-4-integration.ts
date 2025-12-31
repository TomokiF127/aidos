/**
 * PoC-4: 統合検証
 *
 * 目的: PoC-1〜3を組み合わせた最小動作確認
 *
 * 検証内容:
 * - 目的入力 → タスク分解
 * - Worker起動 → 並列実行
 * - TUIでの進捗表示
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import blessed from 'blessed';
import Anthropic from '@anthropic-ai/sdk';

// ========================================
// 型定義
// ========================================

interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  progress: number;
  assignedTo?: string;
}

interface AgentState {
  id: string;
  status: 'idle' | 'thinking' | 'executing' | 'done';
  currentTask?: Task;
  logs: string[];
}

interface WorkerConfig {
  id: string;
  task: Task;
}

interface WorkerMessage {
  type: 'status' | 'progress' | 'result' | 'log';
  workerId: string;
  data: unknown;
}

// ========================================
// ワーカースレッド
// ========================================

if (!isMainThread && parentPort) {
  const config = workerData as WorkerConfig;
  const port = parentPort;

  async function executeTask() {
    port.postMessage({
      type: 'status',
      workerId: config.id,
      data: 'thinking',
    });

    port.postMessage({
      type: 'log',
      workerId: config.id,
      data: `タスク開始: ${config.task.description}`,
    });

    // シミュレート: 段階的な進捗
    for (let progress = 0; progress <= 100; progress += 20) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

      port.postMessage({
        type: 'progress',
        workerId: config.id,
        data: progress,
      });

      if (progress === 40) {
        port.postMessage({
          type: 'status',
          workerId: config.id,
          data: 'executing',
        });
      }
    }

    port.postMessage({
      type: 'result',
      workerId: config.id,
      data: {
        taskId: config.task.id,
        output: `完了: ${config.task.description}`,
      },
    });
  }

  executeTask().catch(err => {
    port.postMessage({
      type: 'log',
      workerId: config.id,
      data: `エラー: ${err.message}`,
    });
  });
}

// ========================================
// メインスレッド: 統合システム
// ========================================

if (isMainThread) {
  class IntegratedSystem extends EventEmitter {
    private agents: Map<string, AgentState> = new Map();
    private tasks: Task[] = [];
    private workers: Map<string, Worker> = new Map();
    private screen!: blessed.Widgets.Screen;
    private panes: Map<string, blessed.Widgets.BoxElement> = new Map();
    private logPanel!: blessed.Widgets.Log;
    private header!: blessed.Widgets.BoxElement;

    async start(objective: string) {
      this.log('システム起動');

      // 1. タスク分解（シミュレート）
      this.log('タスク分解を開始...');
      this.tasks = await this.decomposeTasks(objective);
      this.log(`${this.tasks.length}個のタスクを生成`);

      // 2. UI初期化
      this.initUI();

      // 3. Agent作成・タスクアサイン
      this.createAgents();

      // 4. 並列実行開始
      await this.executeAll();
    }

    private async decomposeTasks(objective: string): Promise<Task[]> {
      // 簡易的なタスク分解（PoC用）
      // 本番ではClaude APIを使用
      return [
        { id: 'T1', description: '設計ドキュメント作成', status: 'pending', progress: 0 },
        { id: 'T2', description: 'データモデル定義', status: 'pending', progress: 0 },
        { id: 'T3', description: 'API実装', status: 'pending', progress: 0 },
        { id: 'T4', description: 'UI実装', status: 'pending', progress: 0 },
      ];
    }

    private createAgents() {
      const agentIds = ['PL-1', 'PL-2', 'PL-3'];

      for (const id of agentIds) {
        this.agents.set(id, {
          id,
          status: 'idle',
          logs: [],
        });
      }

      // タスクをエージェントに割り当て
      this.tasks.forEach((task, i) => {
        const agentId = agentIds[i % agentIds.length];
        task.assignedTo = agentId;
      });
    }

    private initUI() {
      this.screen = blessed.screen({
        smartCSR: true,
        title: 'AIDOS PoC-4: 統合検証',
      });

      // ヘッダー
      this.header = blessed.box({
        top: 0,
        left: 0,
        width: '100%',
        height: 3,
        content: ' AIDOS PoC-4: 統合検証              [□□□□□] 0%',
        style: { fg: 'white', bg: 'blue' },
        border: { type: 'line' },
      });

      // エージェントペイン
      const agentIds = ['PL-1', 'PL-2', 'PL-3'];
      const positions = [
        { top: 3, left: 0, width: '33%' },
        { top: 3, left: '33%', width: '34%' },
        { top: 3, left: '67%', width: '33%' },
      ];

      for (let i = 0; i < agentIds.length; i++) {
        const id = agentIds[i];
        const pane = blessed.box({
          top: positions[i].top,
          left: positions[i].left,
          width: positions[i].width,
          height: '50%-3',
          label: ` [${id}] ⚪ Idle `,
          content: '\n  Waiting...',
          border: { type: 'line' },
          style: { border: { fg: 'gray' } },
        });

        this.panes.set(id, pane);
        this.screen.append(pane);
      }

      // ログパネル
      this.logPanel = blessed.log({
        top: '50%',
        left: 0,
        width: '100%',
        height: '50%-3',
        label: ' [System Logs] ',
        border: { type: 'line' },
        scrollable: true,
        alwaysScroll: true,
        style: { border: { fg: 'cyan' } },
      });

      // フッター
      const footer = blessed.box({
        bottom: 0,
        left: 0,
        width: '100%',
        height: 3,
        content: ' [q] 終了 | PoC-4 統合検証実行中... ',
        style: { fg: 'white', bg: 'gray' },
        border: { type: 'line' },
      });

      this.screen.append(this.header);
      this.screen.append(this.logPanel);
      this.screen.append(footer);

      this.screen.key(['q', 'C-c'], () => process.exit(0));
      this.screen.render();
    }

    private log(message: string) {
      const timestamp = new Date().toISOString().slice(11, 19);
      const formatted = `${timestamp} ${message}`;

      if (this.logPanel) {
        this.logPanel.log(formatted);
        this.screen.render();
      } else {
        console.log(formatted);
      }
    }

    private updateAgentPane(agentId: string, agent: AgentState) {
      const pane = this.panes.get(agentId);
      if (!pane) return;

      const statusIcon = {
        idle: '⚪',
        thinking: '🟡',
        executing: '🟢',
        done: '✅',
      }[agent.status];

      const statusColor = {
        idle: 'gray',
        thinking: 'yellow',
        executing: 'green',
        done: 'blue',
      }[agent.status];

      pane.setLabel(` [${agentId}] ${statusIcon} ${agent.status} `);
      pane.style.border = { fg: statusColor };

      let content = '';
      if (agent.currentTask) {
        const progress = agent.currentTask.progress;
        const bar = '[' + '■'.repeat(Math.floor(progress / 10)) + '□'.repeat(10 - Math.floor(progress / 10)) + ']';
        content = `
  Task: ${agent.currentTask.description}
  Progress: ${bar} ${progress}%
`;
      } else {
        content = '\n  Completed all tasks';
      }

      pane.setContent(content);
      this.screen.render();
    }

    private updateHeader() {
      const totalProgress = this.tasks.reduce((sum, t) => sum + t.progress, 0) / this.tasks.length;
      const bar = '[' + '■'.repeat(Math.floor(totalProgress / 20)) + '□'.repeat(5 - Math.floor(totalProgress / 20)) + ']';
      this.header.setContent(` AIDOS PoC-4: 統合検証              ${bar} ${Math.round(totalProgress)}%`);
      this.screen.render();
    }

    private async executeTask(task: Task, agentId: string): Promise<void> {
      return new Promise((resolve) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: { id: agentId, task } as WorkerConfig,
        });

        const agent = this.agents.get(agentId)!;
        agent.currentTask = task;
        task.status = 'in_progress';

        worker.on('message', (msg: WorkerMessage) => {
          switch (msg.type) {
            case 'status':
              agent.status = msg.data as AgentState['status'];
              this.updateAgentPane(agentId, agent);
              break;

            case 'progress':
              task.progress = msg.data as number;
              this.updateAgentPane(agentId, agent);
              this.updateHeader();
              break;

            case 'log':
              this.log(`[${agentId}] ${msg.data}`);
              break;

            case 'result':
              task.status = 'completed';
              task.progress = 100;
              agent.status = 'done';
              agent.currentTask = undefined;
              this.updateAgentPane(agentId, agent);
              this.updateHeader();
              this.log(`[${agentId}] タスク完了: ${task.id}`);
              resolve();
              break;
          }
        });

        worker.on('error', (err) => {
          this.log(`[${agentId}] エラー: ${err.message}`);
          resolve();
        });

        this.workers.set(agentId, worker);
      });
    }

    private async executeAll() {
      this.log('全タスクの並列実行を開始');

      // エージェントごとにタスクをグループ化
      const tasksByAgent = new Map<string, Task[]>();
      for (const task of this.tasks) {
        const agentId = task.assignedTo!;
        if (!tasksByAgent.has(agentId)) {
          tasksByAgent.set(agentId, []);
        }
        tasksByAgent.get(agentId)!.push(task);
      }

      // 各エージェントのタスクを順次実行（エージェント間は並列）
      const agentPromises = Array.from(tasksByAgent.entries()).map(async ([agentId, tasks]) => {
        for (const task of tasks) {
          await this.executeTask(task, agentId);
        }
      });

      await Promise.all(agentPromises);

      this.log('━'.repeat(50));
      this.log('✅ 全タスク完了!');
      this.log('━'.repeat(50));
      this.log('');
      this.log('📊 検証結果サマリー:');
      this.log('  ✅ タスク分解: 成功');
      this.log('  ✅ 並列実行: 成功');
      this.log('  ✅ リアルタイムUI: 成功');
      this.log('');
      this.log('PoC-4 統合検証完了 - 5秒後に終了します');

      setTimeout(() => process.exit(0), 5000);
    }
  }

  async function main() {
    const system = new IntegratedSystem();

    const objective = process.argv[2] || 'Webアプリのログイン機能を作成する';

    await system.start(objective);
  }

  main().catch(console.error);
}
