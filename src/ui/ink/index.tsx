/**
 * AIDOS Ink UI Entry Point
 */

import React from 'react';
import { render } from 'ink';
import { Dashboard, TaskHistoryItem } from './Dashboard.js';
import { AgentManager, createAgentManager } from '../../agents/agent-manager.js';
import { randomUUID } from 'crypto';

interface AppOptions {
  objective?: string;
  sessionId?: string;
  agentManager?: AgentManager;
  autoSpawn?: boolean;
}

interface InteractiveOptions {
  sessionId?: string;
  agentManager?: AgentManager;
  workingDirectory?: string;
}

export function startDashboard(options: AppOptions = {}): {
  agentManager: AgentManager;
  waitUntilExit: () => Promise<void>;
} {
  const sessionId = options.sessionId || `session-${randomUUID().slice(0, 8)}`;
  const agentManager = options.agentManager || createAgentManager(sessionId);

  // 状態管理用の参照
  let rerenderFn: (() => void) | null = null;
  let currentAgents: { id: string; name: string; status: string; task: string; progress: number }[] = [];

  // イベント購読（render前）
  agentManager.on('agent:spawned', (data: { agent: { id: string; role: string; mission: string; status: string } }) => {
    currentAgents = [
      ...currentAgents,
      {
        id: data.agent.id,
        name: `${data.agent.role}: ${data.agent.id.slice(-8)}`,
        status: data.agent.status,
        task: data.agent.mission,
        progress: 0,
      },
    ];
    rerenderFn?.();
  });

  agentManager.on('agent:status_changed', (data: { agentId: string; newStatus: string }) => {
    currentAgents = currentAgents.map((a) =>
      a.id === data.agentId ? { ...a, status: data.newStatus } : a
    );
    rerenderFn?.();
  });

  agentManager.on('agent:progress', (data: { agentId: string; progress: number }) => {
    currentAgents = currentAgents.map((a) =>
      a.id === data.agentId ? { ...a, progress: data.progress } : a
    );
    rerenderFn?.();
  });

  agentManager.on('agent:executing', (data: { agentId: string; action: string }) => {
    currentAgents = currentAgents.map((a) =>
      a.id === data.agentId ? { ...a, task: data.action } : a
    );
    rerenderFn?.();
  });

  // Wrapper component to enable rerender
  const App = () => {
    const [, forceUpdate] = React.useState({});
    React.useEffect(() => {
      rerenderFn = () => forceUpdate({});
      return () => { rerenderFn = null; };
    }, []);

    return (
      <Dashboard
        objective={options.objective}
        sessionId={sessionId}
        agentManager={agentManager}
        initialAgents={currentAgents as any}
      />
    );
  };

  // Auto-spawn an agent if requested (BEFORE render)
  if (options.autoSpawn && options.objective) {
    // 即座にspawnを開始（非同期で実行継続）
    agentManager.spawn({
      type: 'claude-code',
      role: 'PL',
      mission: options.objective,
    }).then((agent) => {
      return agent.execute({
        type: 'task',
        content: options.objective!,
        priority: 'normal',
      });
    }).catch((err) => {
      console.error('Failed to spawn agent:', err);
    });
  }

  const { waitUntilExit } = render(<App />);

  return {
    agentManager,
    waitUntilExit: async () => {
      await waitUntilExit();
      await agentManager.destroyAll();
    },
  };
}

/**
 * Start interactive mode - allows user to input tasks dynamically
 */
export function startInteractive(options: InteractiveOptions = {}): {
  agentManager: AgentManager;
  waitUntilExit: () => Promise<void>;
} {
  const sessionId = options.sessionId || `session-${randomUUID().slice(0, 8)}`;
  const agentManager = options.agentManager || createAgentManager(sessionId, {
    output: { directory: options.workingDirectory || process.cwd() },
  });

  // 状態管理
  let rerenderFn: (() => void) | null = null;
  let currentAgents: { id: string; name: string; status: string; task: string; progress: number }[] = [];
  let taskHistory: TaskHistoryItem[] = [];
  let currentResult: string | undefined;
  let currentTaskId: string | null = null;
  let workingDirectory = options.workingDirectory || process.cwd();
  let message: { type: 'info' | 'success' | 'error'; text: string } | null = null;

  // Clear message after a delay
  const showMessage = (type: 'info' | 'success' | 'error', text: string, duration = 3000) => {
    message = { type, text };
    rerenderFn?.();
    setTimeout(() => {
      message = null;
      rerenderFn?.();
    }, duration);
  };

  // Handle slash commands
  const handleCommand = (command: string, args: string) => {
    switch (command) {
      case 'cd':
        if (!args) {
          showMessage('error', '使用方法: /cd <path>');
          return;
        }
        // Resolve path (support ~ and relative paths)
        let newPath = args;
        if (args.startsWith('~')) {
          newPath = args.replace('~', process.env.HOME || '');
        } else if (!args.startsWith('/')) {
          newPath = `${workingDirectory}/${args}`;
        }
        // Check if directory exists (basic validation)
        try {
          const { statSync } = require('fs');
          const stats = statSync(newPath);
          if (stats.isDirectory()) {
            workingDirectory = newPath;
            showMessage('success', `作業ディレクトリを変更: ${newPath}`);
          } else {
            showMessage('error', `ディレクトリではありません: ${newPath}`);
          }
        } catch {
          showMessage('error', `ディレクトリが見つかりません: ${newPath}`);
        }
        break;

      case 'pwd':
        showMessage('info', `現在のディレクトリ: ${workingDirectory}`, 5000);
        break;

      case 'config':
        showMessage('info', `作業ディレクトリ: ${workingDirectory}\nセッション: ${sessionId}`, 5000);
        break;

      case 'clear':
        currentResult = undefined;
        taskHistory = [];
        showMessage('success', '履歴をクリアしました');
        break;

      case 'help':
        showMessage('info',
          'コマンド一覧:\n' +
          '/cd <path>  - 作業ディレクトリ変更\n' +
          '/pwd        - 現在のディレクトリ表示\n' +
          '/config     - 設定表示\n' +
          '/clear      - 履歴クリア\n' +
          '/help       - このヘルプ',
          10000
        );
        break;

      default:
        showMessage('error', `不明なコマンド: /${command} (/help で一覧表示)`);
    }
  };

  // Extract text result from stream-json output
  const extractResult = (output: string): string => {
    const lines = output.split('\n');
    const results: string[] = [];

    for (const line of lines) {
      if (line.trim()) {
        try {
          const json = JSON.parse(line);
          if (json.type === 'text' && json.text) {
            results.push(json.text);
          } else if (json.type === 'result' && json.result) {
            results.push(json.result);
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    }

    return results.join('\n');
  };

  // イベント購読
  agentManager.on('agent:spawned', (data: { agent: { id: string; role: string; mission: string; status: string } }) => {
    currentAgents = [
      ...currentAgents,
      {
        id: data.agent.id,
        name: `${data.agent.role}: ${data.agent.id.slice(-8)}`,
        status: data.agent.status,
        task: data.agent.mission,
        progress: 0,
      },
    ];
    rerenderFn?.();
  });

  agentManager.on('agent:status_changed', (data: { agentId: string; newStatus: string }) => {
    currentAgents = currentAgents.map((a) =>
      a.id === data.agentId ? { ...a, status: data.newStatus } : a
    );
    rerenderFn?.();
  });

  agentManager.on('agent:progress', (data: { agentId: string; progress: number }) => {
    currentAgents = currentAgents.map((a) =>
      a.id === data.agentId ? { ...a, progress: data.progress } : a
    );
    rerenderFn?.();
  });

  agentManager.on('agent:executing', (data: { agentId: string; action: string }) => {
    currentAgents = currentAgents.map((a) =>
      a.id === data.agentId ? { ...a, task: data.action } : a
    );
    rerenderFn?.();
  });

  // Handle task submission
  const handleTaskSubmit = async (task: string) => {
    // Clear previous result
    currentResult = undefined;

    // Add to history as running
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    currentTaskId = taskId;
    taskHistory = [
      ...taskHistory,
      {
        id: taskId,
        task,
        status: 'running',
        startedAt: new Date(),
      },
    ];
    rerenderFn?.();

    try {
      // Spawn agent and execute
      const agent = await agentManager.spawn({
        type: 'claude-code',
        role: 'PL',
        mission: task,
        claudeOptions: {
          workingDirectory: workingDirectory,
        },
      });

      const result = await agent.execute({
        type: 'task',
        content: task,
        priority: 'normal',
      });

      // Extract and set result
      if (result.success && result.output) {
        currentResult = extractResult(result.output);
      }

      // Update history
      taskHistory = taskHistory.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: result.success ? 'completed' : 'failed',
              result: currentResult,
              completedAt: new Date(),
            }
          : t
      ) as TaskHistoryItem[];

      // Remove agent from display after completion
      currentAgents = currentAgents.filter((a) => a.id !== agent.id);
      rerenderFn?.();

      // Destroy the agent
      await agentManager.destroy(agent.id);
    } catch (error) {
      // Update history as failed
      taskHistory = taskHistory.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: 'failed',
              result: error instanceof Error ? error.message : String(error),
              completedAt: new Date(),
            }
          : t
      ) as TaskHistoryItem[];
      rerenderFn?.();
    }

    currentTaskId = null;
  };

  // Interactive App component
  const InteractiveApp = () => {
    const [, forceUpdate] = React.useState({});
    React.useEffect(() => {
      rerenderFn = () => forceUpdate({});
      return () => { rerenderFn = null; };
    }, []);

    return (
      <Dashboard
        sessionId={sessionId}
        agentManager={agentManager}
        initialAgents={currentAgents as any}
        interactive={true}
        onTaskSubmit={handleTaskSubmit}
        onCommand={handleCommand}
        taskHistory={taskHistory}
        currentResult={currentResult}
        workingDirectory={workingDirectory}
        message={message}
      />
    );
  };

  const { waitUntilExit } = render(<InteractiveApp />);

  return {
    agentManager,
    waitUntilExit: async () => {
      await waitUntilExit();
      await agentManager.destroyAll();
    },
  };
}

// CLI direct execution
if (process.argv[1]?.includes('ui/ink')) {
  const objective = process.argv[2] || 'AIDOS Development Session';
  const autoSpawn = process.argv.includes('--auto');
  const interactive = process.argv.includes('--interactive') || process.argv.includes('-i');

  if (interactive) {
    const { waitUntilExit } = startInteractive();
    waitUntilExit().catch(console.error);
  } else {
    const { waitUntilExit } = startDashboard({
      objective,
      autoSpawn,
    });
    waitUntilExit().catch(console.error);
  }
}

export { Dashboard } from './Dashboard.js';
export { useAgentManager } from './hooks/useAgentManager.js';
