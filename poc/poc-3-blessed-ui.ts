/**
 * PoC-3: blessed TUI検証
 *
 * 目的: tmux風UIがblessedで実現可能かを検証
 *
 * 検証内容:
 * - 4分割グリッドレイアウト
 * - リアルタイムログ更新
 * - キーボード入力処理
 */

import blessed from 'blessed';

interface AgentState {
  id: string;
  name: string;
  status: 'idle' | 'thinking' | 'executing' | 'done';
  mission: string;
  progress: number;
  logs: string[];
}

function getStatusIcon(status: AgentState['status']): string {
  switch (status) {
    case 'idle': return '⚪';
    case 'thinking': return '🟡';
    case 'executing': return '🟢';
    case 'done': return '✅';
  }
}

function getStatusColor(status: AgentState['status']): string {
  switch (status) {
    case 'idle': return 'gray';
    case 'thinking': return 'yellow';
    case 'executing': return 'green';
    case 'done': return 'blue';
  }
}

function createProgressBar(progress: number, width: number = 20): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return '[' + '■'.repeat(filled) + '□'.repeat(empty) + ']';
}

function main() {
  // スクリーン作成
  const screen = blessed.screen({
    smartCSR: true,
    title: 'AIDOS v0.1.0 - PoC-3: TUI検証',
  });

  // ヘッダー
  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: ' AIDOS v0.1.0                    [■■■□□] 60% | PLs: 3 | Tasks: 7',
    style: {
      fg: 'white',
      bg: 'blue',
    },
    border: {
      type: 'line',
    },
  });

  // 4分割グリッド用のコンテナ
  const gridContainer = blessed.box({
    top: 3,
    left: 0,
    width: '100%',
    height: '100%-6',
  });

  // Agent状態
  const agents: AgentState[] = [
    { id: 'PM', name: 'Project Manager', status: 'executing', mission: '全体管理', progress: 60, logs: [] },
    { id: 'PL-1', name: 'Core Engine', status: 'thinking', mission: 'タスク分解', progress: 40, logs: [] },
    { id: 'PL-2', name: 'UI/UX', status: 'executing', mission: 'ダッシュボード', progress: 70, logs: [] },
    { id: 'PL-3', name: 'Integration', status: 'idle', mission: '待機中', progress: 0, logs: [] },
  ];

  // 4つのペインを作成
  const panes: blessed.Widgets.BoxElement[] = [];
  const positions = [
    { top: 0, left: 0 },
    { top: 0, left: '50%' },
    { top: '50%', left: 0 },
    { top: '50%', left: '50%' },
  ];

  for (let i = 0; i < 4; i++) {
    const agent = agents[i];
    const pane = blessed.box({
      parent: gridContainer,
      top: positions[i].top,
      left: positions[i].left,
      width: '50%',
      height: '50%',
      label: ` [${agent.id}] ${getStatusIcon(agent.status)} ${agent.name} `,
      content: '',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: getStatusColor(agent.status),
        },
      },
    });

    panes.push(pane);
    updatePaneContent(pane, agent);
  }

  // ログパネル
  const logPanel = blessed.log({
    bottom: 3,
    left: 0,
    width: '100%',
    height: 6,
    label: ' [Logs] ',
    border: {
      type: 'line',
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '█',
      style: { fg: 'blue' },
    },
    style: {
      border: { fg: 'gray' },
    },
  });

  // フッター
  const footer = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: ' [h]elp [q]uit [p]ause [r]esume [i]ntervene | Focus: PM ',
    style: {
      fg: 'white',
      bg: 'gray',
    },
    border: {
      type: 'line',
    },
  });

  // 要素をスクリーンに追加
  screen.append(header);
  screen.append(gridContainer);
  screen.append(logPanel);
  screen.append(footer);

  // ペイン内容を更新する関数
  function updatePaneContent(pane: blessed.Widgets.BoxElement, agent: AgentState): void {
    const content = `
  Mission: ${agent.mission}
  Status: ${agent.status}
  Progress: ${createProgressBar(agent.progress)} ${agent.progress}%
`;
    pane.setContent(content);
  }

  // ログを追加する関数
  function addLog(message: string): void {
    const timestamp = new Date().toISOString().slice(11, 19);
    logPanel.log(`${timestamp} ${message}`);
    screen.render();
  }

  // キーボード操作
  screen.key(['escape', 'q', 'C-c'], () => {
    return process.exit(0);
  });

  screen.key(['h'], () => {
    addLog('[System] ヘルプ: h=ヘルプ, q=終了, p=一時停止, r=再開, i=介入');
  });

  screen.key(['p'], () => {
    addLog('[System] 一時停止しました');
  });

  screen.key(['r'], () => {
    addLog('[System] 再開しました');
  });

  screen.key(['i'], () => {
    addLog('[System] 介入モードに入りました');
  });

  // 初期ログ
  addLog('[System] AIDOS PoC-3 TUI検証を開始しました');
  addLog('[PM] 全体管理を開始');
  addLog('[PL-1] タスク分解を開始');
  addLog('[PL-2] ダッシュボード設計中');

  // シミュレーション: 定期的に状態を更新
  let tick = 0;
  const interval = setInterval(() => {
    tick++;

    // ランダムにエージェントの状態を更新
    const randomAgent = agents[Math.floor(Math.random() * agents.length)];

    if (randomAgent.progress < 100 && randomAgent.status !== 'done') {
      randomAgent.progress = Math.min(100, randomAgent.progress + Math.floor(Math.random() * 10));

      if (randomAgent.progress >= 100) {
        randomAgent.status = 'done';
        addLog(`[${randomAgent.id}] タスク完了!`);
      } else if (randomAgent.status === 'idle') {
        randomAgent.status = 'thinking';
        addLog(`[${randomAgent.id}] 思考中...`);
      } else if (Math.random() > 0.5) {
        randomAgent.status = randomAgent.status === 'thinking' ? 'executing' : 'thinking';
      }
    }

    // ペインを更新
    for (let i = 0; i < 4; i++) {
      const agent = agents[i];
      const pane = panes[i];

      pane.style.border = { fg: getStatusColor(agent.status) };
      pane.setLabel(` [${agent.id}] ${getStatusIcon(agent.status)} ${agent.name} `);
      updatePaneContent(pane, agent);
    }

    // ヘッダーの進捗を更新
    const totalProgress = Math.round(agents.reduce((sum, a) => sum + a.progress, 0) / agents.length);
    const progressBar = createProgressBar(totalProgress, 5);
    header.setContent(` AIDOS v0.1.0                    ${progressBar} ${totalProgress}% | PLs: 3 | Tasks: 7`);

    screen.render();

    // 10秒後に終了
    if (tick >= 20) {
      clearInterval(interval);
      addLog('[System] PoC-3 検証完了 - 10秒後に終了します');
      addLog('[System] 結果: ✅ 4分割レイアウト、✅ リアルタイム更新、✅ キー操作');

      setTimeout(() => {
        process.exit(0);
      }, 10000);
    }
  }, 500);

  // 初回レンダリング
  screen.render();
}

main();
