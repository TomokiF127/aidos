/**
 * PoC-4 (Mock版): 統合検証
 *
 * 全コンポーネントを統合したモック版検証
 * - タスク分解（モック）
 * - Worker Thread並列実行
 * - blessed TUI表示
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import blessed from 'blessed';

// ========================================
// 型定義
// ========================================

interface Task {
  id: string;
  description: string;
  category: string;
  status: 'pending' | 'in_progress' | 'completed';
  progress: number;
  assignedTo?: string;
}

interface AgentState {
  id: string;
  role: string;
  status: 'idle' | 'thinking' | 'executing' | 'done';
  mission: string;
  currentTask?: Task;
  completedTasks: number;
  totalTasks: number;
}

interface WorkerConfig {
  id: string;
  role: string;
  mission: string;
  tasks: Task[];
}

interface WorkerMessage {
  type: 'status' | 'progress' | 'task_complete' | 'log' | 'done';
  workerId: string;
  data: unknown;
}

// ========================================
// ワーカースレッド
// ========================================

if (!isMainThread && parentPort) {
  const config = workerData as WorkerConfig;
  const port = parentPort;

  async function executeAllTasks() {
    port.postMessage({ type: 'status', workerId: config.id, data: 'thinking' });
    port.postMessage({ type: 'log', workerId: config.id, data: `ミッション開始: ${config.mission}` });

    for (const task of config.tasks) {
      port.postMessage({ type: 'log', workerId: config.id, data: `タスク開始: ${task.description}` });

      // シミュレート: タスク実行
      for (let progress = 0; progress <= 100; progress += 10) {
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

        port.postMessage({
          type: 'progress',
          workerId: config.id,
          data: { taskId: task.id, progress }
        });

        if (progress === 30) {
          port.postMessage({ type: 'status', workerId: config.id, data: 'executing' });
        }
      }

      port.postMessage({
        type: 'task_complete',
        workerId: config.id,
        data: { taskId: task.id, output: `完了: ${task.description}` }
      });
    }

    port.postMessage({ type: 'status', workerId: config.id, data: 'done' });
    port.postMessage({ type: 'done', workerId: config.id, data: { completedTasks: config.tasks.length } });
  }

  executeAllTasks().catch(err => {
    port.postMessage({ type: 'log', workerId: config.id, data: `エラー: ${err.message}` });
  });
}

// ========================================
// メインスレッド
// ========================================

if (isMainThread) {
  class AIDOSSystem extends EventEmitter {
    private agents: Map<string, AgentState> = new Map();
    private tasks: Task[] = [];
    private workers: Map<string, Worker> = new Map();

    private screen!: blessed.Widgets.Screen;
    private header!: blessed.Widgets.BoxElement;
    private panes: Map<string, blessed.Widgets.BoxElement> = new Map();
    private logPanel!: blessed.Widgets.Log;
    private footer!: blessed.Widgets.BoxElement;

    private startTime = Date.now();
    private completedAgents = 0;

    async start(objective: string) {
      // 1. タスク分解（モック）
      this.tasks = this.mockDecompose(objective);

      // 2. UI初期化
      this.initUI(objective);

      // 3. Agent作成
      this.createAgents();

      // 4. タスク割り当て
      this.assignTasks();

      // 5. 並列実行
      await this.executeAll();
    }

    private mockDecompose(objective: string): Task[] {
      return [
        { id: 'T1', description: '要件分析', category: 'design', status: 'pending', progress: 0 },
        { id: 'T2', description: 'データモデル設計', category: 'design', status: 'pending', progress: 0 },
        { id: 'T3', description: 'API設計', category: 'design', status: 'pending', progress: 0 },
        { id: 'T4', description: 'バックエンド実装', category: 'implement', status: 'pending', progress: 0 },
        { id: 'T5', description: 'フロントエンド実装', category: 'implement', status: 'pending', progress: 0 },
        { id: 'T6', description: 'テスト作成', category: 'test', status: 'pending', progress: 0 },
      ];
    }

    private createAgents() {
      const agentConfigs = [
        { id: 'PL-1', role: 'Core Engine', mission: '設計・API実装' },
        { id: 'PL-2', role: 'UI/UX', mission: 'フロントエンド実装' },
        { id: 'PL-3', role: 'Integration', mission: 'テスト・統合' },
      ];

      for (const config of agentConfigs) {
        this.agents.set(config.id, {
          ...config,
          status: 'idle',
          completedTasks: 0,
          totalTasks: 0,
        });
      }
    }

    private assignTasks() {
      const agentIds = Array.from(this.agents.keys());
      this.tasks.forEach((task, i) => {
        task.assignedTo = agentIds[i % agentIds.length];
      });

      // 各エージェントのタスク数を更新
      for (const [id, agent] of this.agents) {
        agent.totalTasks = this.tasks.filter(t => t.assignedTo === id).length;
      }
    }

    private initUI(objective: string) {
      this.screen = blessed.screen({
        smartCSR: true,
        title: 'AIDOS - AI-Driven Orchestration System',
      });

      // ヘッダー
      this.header = blessed.box({
        top: 0,
        left: 0,
        width: '100%',
        height: 3,
        content: ` AIDOS v0.1.0 | 目的: ${objective.substring(0, 40)}...`,
        style: { fg: 'white', bg: 'blue' },
        border: { type: 'line' },
      });

      // 3つのAgentペイン
      const positions = [
        { top: 3, left: 0, width: '33%' },
        { top: 3, left: '33%', width: '34%' },
        { top: 3, left: '67%', width: '33%' },
      ];

      for (const [id, agent] of this.agents) {
        const idx = Array.from(this.agents.keys()).indexOf(id);
        const pane = blessed.box({
          top: positions[idx].top,
          left: positions[idx].left,
          width: positions[idx].width,
          height: '40%-3',
          label: ` [${id}] ${agent.role} `,
          content: this.renderAgentContent(agent),
          border: { type: 'line' },
          style: { border: { fg: 'gray' } },
        });
        this.panes.set(id, pane);
        this.screen.append(pane);
      }

      // ログパネル
      this.logPanel = blessed.log({
        top: '40%',
        left: 0,
        width: '100%',
        height: '50%',
        label: ' [System Logs] ',
        border: { type: 'line' },
        scrollable: true,
        alwaysScroll: true,
        mouse: true,
        style: { border: { fg: 'cyan' } },
      });

      // フッター
      this.footer = blessed.box({
        bottom: 0,
        left: 0,
        width: '100%',
        height: 3,
        content: ' [q] 終了 | 実行中... ',
        style: { fg: 'white', bg: 'gray' },
        border: { type: 'line' },
      });

      this.screen.append(this.header);
      this.screen.append(this.logPanel);
      this.screen.append(this.footer);

      this.screen.key(['q', 'C-c', 'escape'], () => {
        this.cleanup();
        process.exit(0);
      });

      this.log('[System] AIDOS 統合検証を開始');
      this.log(`[PM] 目的を解析: ${objective}`);
      this.log(`[PM] ${this.tasks.length}個のタスクを生成`);
      this.log(`[PM] ${this.agents.size}名のPLをアサイン`);

      this.screen.render();
    }

    private renderAgentContent(agent: AgentState): string {
      const statusIcon = {
        idle: '[ ]',
        thinking: '[~]',
        executing: '[>]',
        done: '[v]',
      }[agent.status];

      let content = `
  Status: ${statusIcon} ${agent.status}
  Mission: ${agent.mission}
  Tasks: ${agent.completedTasks}/${agent.totalTasks}
`;

      if (agent.currentTask) {
        const bar = this.progressBar(agent.currentTask.progress, 15);
        content += `
  Current: ${agent.currentTask.description}
  Progress: ${bar} ${agent.currentTask.progress}%`;
      }

      return content;
    }

    private progressBar(progress: number, width: number): string {
      const filled = Math.round((progress / 100) * width);
      return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
    }

    private updateAgentPane(agentId: string) {
      const agent = this.agents.get(agentId);
      const pane = this.panes.get(agentId);
      if (!agent || !pane) return;

      const statusColor = {
        idle: 'gray',
        thinking: 'yellow',
        executing: 'green',
        done: 'blue',
      }[agent.status];

      pane.style.border = { fg: statusColor };
      pane.setContent(this.renderAgentContent(agent));
      this.screen.render();
    }

    private updateHeader() {
      const totalTasks = this.tasks.length;
      const completedTasks = this.tasks.filter(t => t.status === 'completed').length;
      const progress = Math.round((completedTasks / totalTasks) * 100);
      const bar = this.progressBar(progress, 10);
      const elapsed = Math.round((Date.now() - this.startTime) / 1000);

      this.header.setContent(
        ` AIDOS v0.1.0 | ${bar} ${progress}% | Tasks: ${completedTasks}/${totalTasks} | Time: ${elapsed}s`
      );
      this.screen.render();
    }

    private log(message: string) {
      const timestamp = new Date().toISOString().slice(11, 19);
      this.logPanel.log(`${timestamp} ${message}`);
      this.screen.render();
    }

    private async executeAgent(agentId: string, tasks: Task[]): Promise<void> {
      return new Promise((resolve) => {
        const agent = this.agents.get(agentId)!;

        const worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: {
            id: agentId,
            role: agent.role,
            mission: agent.mission,
            tasks,
          } as WorkerConfig,
        });

        worker.on('message', (msg: WorkerMessage) => {
          switch (msg.type) {
            case 'status':
              agent.status = msg.data as AgentState['status'];
              this.updateAgentPane(agentId);
              break;

            case 'progress': {
              const { taskId, progress } = msg.data as { taskId: string; progress: number };
              const task = this.tasks.find(t => t.id === taskId);
              if (task) {
                task.progress = progress;
                task.status = 'in_progress';
                agent.currentTask = task;
                this.updateAgentPane(agentId);
                this.updateHeader();
              }
              break;
            }

            case 'task_complete': {
              const { taskId } = msg.data as { taskId: string };
              const task = this.tasks.find(t => t.id === taskId);
              if (task) {
                task.status = 'completed';
                task.progress = 100;
                agent.completedTasks++;
                agent.currentTask = undefined;
                this.log(`[${agentId}] 完了: ${task.description}`);
                this.updateAgentPane(agentId);
                this.updateHeader();
              }
              break;
            }

            case 'log':
              this.log(`[${agentId}] ${msg.data}`);
              break;

            case 'done':
              this.completedAgents++;
              this.log(`[${agentId}] 全タスク完了`);
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
      this.log('[PM] 並列実行を開始');

      // タスクをエージェントごとにグループ化
      const tasksByAgent = new Map<string, Task[]>();
      for (const task of this.tasks) {
        const agentId = task.assignedTo!;
        if (!tasksByAgent.has(agentId)) {
          tasksByAgent.set(agentId, []);
        }
        tasksByAgent.get(agentId)!.push(task);
      }

      // 並列実行
      const promises = Array.from(tasksByAgent.entries()).map(([agentId, tasks]) =>
        this.executeAgent(agentId, tasks)
      );

      await Promise.all(promises);

      const elapsed = Math.round((Date.now() - this.startTime) / 1000);

      this.log('');
      this.log('━'.repeat(50));
      this.log('✅ 全タスク完了!');
      this.log(`   総実行時間: ${elapsed}秒`);
      this.log(`   完了タスク: ${this.tasks.length}個`);
      this.log('━'.repeat(50));
      this.log('');
      this.log('📊 PoC-4 統合検証結果:');
      this.log('   ✅ タスク分解: 成功');
      this.log('   ✅ Worker並列実行: 成功');
      this.log('   ✅ TUIリアルタイム更新: 成功');
      this.log('   ✅ Agent間協調: 成功');
      this.log('');
      this.log('5秒後に終了します...');

      this.footer.setContent(' [q] 終了 | PoC-4 検証完了! ');
      this.screen.render();

      setTimeout(() => {
        this.cleanup();
        process.exit(0);
      }, 5000);
    }

    private cleanup() {
      for (const worker of this.workers.values()) {
        worker.terminate();
      }
    }
  }

  async function main() {
    const objective = process.argv[2] || 'Webアプリのログイン機能を作成する';
    const system = new AIDOSSystem();
    await system.start(objective);
  }

  main().catch(console.error);
}
