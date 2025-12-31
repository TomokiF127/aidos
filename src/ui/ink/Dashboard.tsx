/**
 * AIDOS Dashboard - Ink UI
 *
 * React-based terminal UI using Ink
 * Supports interactive mode for task input
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { AgentManager } from '../../agents/agent-manager.js';
import { AgentStatus } from '../../types.js';
import { InputPanel } from './components/InputPanel.js';

// UI用のエージェント状態
export interface AgentUIState {
  id: string;
  name: string;
  status: AgentStatus;
  task: string;
  progress: number;
}

// タスク履歴
export interface TaskHistoryItem {
  id: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  startedAt: Date;
  completedAt?: Date;
}

// ========================================
// Types
// ========================================

interface VerifyResult {
  typescript: 'pending' | 'passed' | 'failed';
  tests: 'pending' | 'passed' | 'failed';
  security: 'pending' | 'passed' | 'failed' | 'warning';
  build: 'pending' | 'passed' | 'failed';
}

interface DashboardProps {
  objective?: string;
  sessionId?: string;
  agentManager?: AgentManager | null;
  initialAgents?: AgentUIState[];
  onQuit?: () => void;
  interactive?: boolean;
  onTaskSubmit?: (task: string) => void;
  onCommand?: (command: string, args: string) => void;
  taskHistory?: TaskHistoryItem[];
  currentResult?: string;
  workingDirectory?: string;
  message?: { type: 'info' | 'success' | 'error'; text: string } | null;
}

// ========================================
// Status Icons
// ========================================

const StatusIcon: React.FC<{ status: AgentStatus }> = ({ status }) => {
  switch (status) {
    case 'idle':
      return <Text color="gray">○</Text>;
    case 'thinking':
      return <Text color="yellow"><Spinner type="dots" /></Text>;
    case 'executing':
      return <Text color="green"><Spinner type="dots" /></Text>;
    case 'done':
      return <Text color="green">✓</Text>;
    case 'error':
      return <Text color="red">✗</Text>;
    case 'blocked':
      return <Text color="yellow">!</Text>;
    default:
      return <Text color="gray">-</Text>;
  }
};

const VerifyIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'passed':
      return <Text color="green">✓</Text>;
    case 'failed':
      return <Text color="red">✗</Text>;
    case 'warning':
      return <Text color="yellow">!</Text>;
    default:
      return <Text color="gray">-</Text>;
  }
};

// ========================================
// Components
// ========================================

const Header: React.FC<{ objective: string; sessionId: string; isRunning: boolean; interactive: boolean }> = ({
  objective,
  sessionId,
  isRunning,
  interactive,
}) => (
  <Box flexDirection="column" borderStyle="double" borderColor="cyan" paddingX={1}>
    <Box justifyContent="space-between">
      <Box>
        <Text bold color="cyan">AIDOS Dashboard</Text>
        {interactive && <Text color="magenta"> [Interactive]</Text>}
        {isRunning && (
          <Text color="green"> <Spinner type="dots" /> Running</Text>
        )}
      </Box>
      <Text color="gray">Session: {sessionId.slice(0, 8)}</Text>
    </Box>
    {!interactive && <Text color="white">{objective}</Text>}
  </Box>
);

const AgentPanel: React.FC<{ agent: AgentUIState }> = ({ agent }) => (
  <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={agent.status === 'error' ? 'red' : agent.status === 'done' ? 'green' : 'gray'}
    paddingX={1}
    width="50%"
  >
    <Box>
      <StatusIcon status={agent.status} />
      <Text bold> {agent.name}</Text>
    </Box>
    <Text color="gray" wrap="truncate">{agent.task}</Text>
    <Box marginTop={1}>
      <ProgressBar progress={agent.progress} />
    </Box>
  </Box>
);

const ProgressBar: React.FC<{ progress: number }> = ({ progress }) => {
  const width = 20;
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;

  return (
    <Box>
      <Text color="green">{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(empty)}</Text>
      <Text color="white"> {progress}%</Text>
    </Box>
  );
};

const VerifyPanel: React.FC<{ result: VerifyResult }> = ({ result }) => (
  <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
    <Text bold color="blue">Verification</Text>
    <Box marginTop={1} flexDirection="column">
      <Box>
        <VerifyIcon status={result.typescript} />
        <Text> TypeScript</Text>
      </Box>
      <Box>
        <VerifyIcon status={result.tests} />
        <Text> Tests</Text>
      </Box>
      <Box>
        <VerifyIcon status={result.security} />
        <Text> Security</Text>
      </Box>
      <Box>
        <VerifyIcon status={result.build} />
        <Text> Build</Text>
      </Box>
    </Box>
  </Box>
);

const ResultPanel: React.FC<{ result: string }> = ({ result }) => (
  <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginTop={1}>
    <Text bold color="green">Result</Text>
    <Box marginTop={1}>
      <Text wrap="wrap">{result}</Text>
    </Box>
  </Box>
);

const TaskHistoryPanel: React.FC<{ history: TaskHistoryItem[] }> = ({ history }) => {
  if (history.length === 0) return null;

  // Show last 3 tasks
  const recentTasks = history.slice(-3);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text bold color="gray">Recent Tasks</Text>
      <Box marginTop={1} flexDirection="column">
        {recentTasks.map((item) => (
          <Box key={item.id}>
            <Text color={item.status === 'completed' ? 'green' : item.status === 'failed' ? 'red' : 'yellow'}>
              {item.status === 'completed' ? '✓' : item.status === 'failed' ? '✗' : '○'}
            </Text>
            <Text color="gray"> {item.task.slice(0, 50)}{item.task.length > 50 ? '...' : ''}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

const HelpBar: React.FC<{ interactive: boolean }> = ({ interactive }) => (
  <Box borderStyle="single" borderColor="gray" paddingX={1}>
    <Text color="gray">
      {interactive
        ? '[q] Quit  [Ctrl+C] Cancel'
        : '[q] Quit  [p] Pause  [r] Resume  [s] Spawn Agent'}
    </Text>
  </Box>
);

const MessagePanel: React.FC<{ message: { type: 'info' | 'success' | 'error'; text: string } }> = ({ message }) => {
  const color = message.type === 'success' ? 'green' : message.type === 'error' ? 'red' : 'cyan';
  const icon = message.type === 'success' ? '✓' : message.type === 'error' ? '✗' : 'ℹ';

  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
      <Text color={color}>{icon} {message.text}</Text>
    </Box>
  );
};

const EmptyState: React.FC<{ interactive: boolean }> = ({ interactive }) => (
  <Box
    flexDirection="column"
    alignItems="center"
    justifyContent="center"
    borderStyle="round"
    borderColor="gray"
    paddingY={2}
    paddingX={4}
  >
    <Text color="gray">No agents running</Text>
    <Text color="gray" dimColor>
      {interactive
        ? 'Enter a task below to start'
        : 'Press [s] to spawn a Claude Code agent'}
    </Text>
  </Box>
);

// ========================================
// Main Dashboard
// ========================================

export const Dashboard: React.FC<DashboardProps> = ({
  objective = 'AIDOS Development Session',
  sessionId = 'demo-session',
  agentManager = null,
  initialAgents = [],
  onQuit,
  interactive = false,
  onTaskSubmit,
  onCommand,
  taskHistory = [],
  currentResult,
  workingDirectory,
  message,
}) => {
  const { exit } = useApp();

  // initialAgentsから直接表示（外部で状態管理）
  const agents = initialAgents;
  const isRunning = agents.some((a) => a.status === 'thinking' || a.status === 'executing');

  const [verifyResult] = useState<VerifyResult>({
    typescript: 'pending',
    tests: 'pending',
    security: 'pending',
    build: 'pending',
  });

  const [paused, setPaused] = useState(false);

  // Handle task submission in interactive mode
  const handleTaskSubmit = useCallback((task: string) => {
    if (onTaskSubmit) {
      onTaskSubmit(task);
    } else if (agentManager) {
      // Default behavior: spawn agent and execute
      agentManager.spawn({
        type: 'claude-code',
        role: 'PL',
        mission: task,
      }).then((agent) => {
        return agent.execute({
          type: 'task',
          content: task,
          priority: 'normal',
        });
      }).catch((err) => {
        console.error('Failed to spawn agent:', err);
      });
    }
  }, [onTaskSubmit, agentManager]);

  // Handle keyboard input
  useInput((input, key) => {
    if (input === 'q') {
      if (onQuit) {
        onQuit();
      } else {
        agentManager?.stopAll().then(() => exit());
      }
    }
    if (!interactive) {
      if (input === 'p') {
        setPaused(true);
      }
      if (input === 'r') {
        setPaused(false);
      }
      if (input === 's' && agentManager) {
        // Spawn a new Claude Code agent
        agentManager.spawn({
          type: 'claude-code',
          role: 'PL',
          mission: objective,
        }).then((agent) => {
          return agent.execute({
            type: 'task',
            content: objective,
            priority: 'normal',
          });
        }).catch((err) => {
          console.error('Failed to spawn agent:', err);
        });
      }
    }
  }, { isActive: !interactive || !isRunning });

  // Build agent grid (2 columns)
  const agentRows: AgentUIState[][] = [];
  for (let i = 0; i < agents.length; i += 2) {
    agentRows.push(agents.slice(i, i + 2));
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        objective={objective}
        sessionId={sessionId}
        isRunning={isRunning}
        interactive={interactive}
      />

      {/* Interactive mode: Input panel */}
      {interactive && (
        <Box marginTop={1}>
          <InputPanel
            onSubmit={handleTaskSubmit}
            onCommand={onCommand}
            disabled={false}
            isProcessing={isRunning}
            placeholder="タスクや仕様を入力... (/help でコマンド一覧)"
            workingDirectory={workingDirectory}
          />
        </Box>
      )}

      {/* Show message */}
      {message && <MessagePanel message={message} />}

      <Box marginY={1}>
        {paused && (
          <Box borderStyle="round" borderColor="yellow" paddingX={2}>
            <Text color="yellow" bold>PAUSED</Text>
          </Box>
        )}
      </Box>

      {agents.length === 0 ? (
        <EmptyState interactive={interactive} />
      ) : (
        agentRows.map((row, idx) => (
          <Box key={idx} flexDirection="row" flexWrap="wrap">
            {row.map((agent) => (
              <AgentPanel key={agent.id} agent={agent} />
            ))}
          </Box>
        ))
      )}

      {/* Show current result */}
      {currentResult && (
        <ResultPanel result={currentResult} />
      )}

      {/* Task history in interactive mode */}
      {interactive && taskHistory.length > 0 && (
        <TaskHistoryPanel history={taskHistory} />
      )}

      {!interactive && (
        <Box marginTop={1}>
          <VerifyPanel result={verifyResult} />
        </Box>
      )}

      <Box marginTop={1}>
        <HelpBar interactive={interactive} />
      </Box>
    </Box>
  );
};

export default Dashboard;
