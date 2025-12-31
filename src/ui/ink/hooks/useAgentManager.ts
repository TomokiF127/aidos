/**
 * AgentManager React Hook
 *
 * AgentManagerのイベントをReact状態に変換
 */

import { useState, useEffect, useCallback } from 'react';
import { AgentManager, ExtendedAgentSpawnOptions } from '../../../agents/agent-manager.js';
import { AgentSummary } from '../../../agents/agent-types.js';
import { AgentStatus } from '../../../types.js';

// ========================================
// Types
// ========================================

export interface AgentUIState {
  id: string;
  name: string;
  status: AgentStatus;
  task: string;
  progress: number;
}

export interface UseAgentManagerResult {
  agents: AgentUIState[];
  isRunning: boolean;
  spawn: (options: ExtendedAgentSpawnOptions) => Promise<string>;
  destroy: (agentId: string) => Promise<void>;
  stopAll: () => Promise<void>;
}

// ========================================
// Hook
// ========================================

export function useAgentManager(manager: AgentManager | null): UseAgentManagerResult {
  const [agents, setAgents] = useState<AgentUIState[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // イベントリスナーをセットアップ
  useEffect(() => {
    if (!manager) return;

    const handleSpawned = (data: { agent: { id: string; role: string; mission: string } }) => {
      setAgents((prev) => [
        ...prev,
        {
          id: data.agent.id,
          name: `${data.agent.role}: ${data.agent.id.slice(-8)}`,
          status: 'idle' as AgentStatus,
          task: data.agent.mission,
          progress: 0,
        },
      ]);
      updateRunningState();
    };

    const handleDestroyed = (data: { agentId: string }) => {
      setAgents((prev) => prev.filter((a) => a.id !== data.agentId));
      updateRunningState();
    };

    const handleStatusChanged = (data: {
      agentId: string;
      previousStatus: AgentStatus;
      newStatus: AgentStatus;
    }) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === data.agentId ? { ...a, status: data.newStatus } : a
        )
      );
      updateRunningState();
    };

    const handleThinking = (data: { agentId: string; currentTask?: string }) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === data.agentId
            ? { ...a, task: data.currentTask || a.task }
            : a
        )
      );
    };

    const handleExecuting = (data: { agentId: string; action: string; details?: string }) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === data.agentId
            ? { ...a, task: `${data.action}: ${data.details?.slice(0, 50) || ''}` }
            : a
        )
      );
    };

    const handleProgress = (data: { agentId: string; progress: number }) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === data.agentId ? { ...a, progress: data.progress } : a
        )
      );
    };

    const updateRunningState = () => {
      const allAgents = manager.getAllAgents();
      const hasActive = allAgents.some(
        (a) => a.status === 'thinking' || a.status === 'executing'
      );
      setIsRunning(hasActive);
    };

    // イベント登録
    manager.on('agent:spawned', handleSpawned);
    manager.on('agent:destroyed', handleDestroyed);
    manager.on('agent:status_changed', handleStatusChanged);
    manager.on('agent:thinking', handleThinking);
    manager.on('agent:executing', handleExecuting);
    manager.on('agent:progress', handleProgress);

    // 既存のエージェントを読み込み
    const existingAgents = manager.getAllAgents();
    setAgents(
      existingAgents.map((a) => ({
        id: a.id,
        name: `${a.role}: ${a.id.slice(-8)}`,
        status: a.status,
        task: a.mission,
        progress: 0,
      }))
    );

    return () => {
      manager.off('agent:spawned', handleSpawned);
      manager.off('agent:destroyed', handleDestroyed);
      manager.off('agent:status_changed', handleStatusChanged);
      manager.off('agent:thinking', handleThinking);
      manager.off('agent:executing', handleExecuting);
      manager.off('agent:progress', handleProgress);
    };
  }, [manager]);

  // spawn関数
  const spawn = useCallback(
    async (options: ExtendedAgentSpawnOptions): Promise<string> => {
      if (!manager) throw new Error('AgentManager not initialized');
      const agent = await manager.spawn(options);
      return agent.id;
    },
    [manager]
  );

  // destroy関数
  const destroy = useCallback(
    async (agentId: string): Promise<void> => {
      if (!manager) throw new Error('AgentManager not initialized');
      await manager.destroy(agentId);
    },
    [manager]
  );

  // stopAll関数
  const stopAll = useCallback(async (): Promise<void> => {
    if (!manager) return;
    await manager.stopAll();
  }, [manager]);

  return {
    agents,
    isRunning,
    spawn,
    destroy,
    stopAll,
  };
}

export default useAgentManager;
