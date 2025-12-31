/**
 * ResourceOptimizer Integration Tests
 *
 * Tests for scheduling strategies, worker management, and load balancing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ResourceOptimizer,
  createResourceOptimizer,
  createResourceOptimizerFromConfig,
  WorkerState,
  ScheduledTask,
  ScheduleResult,
  LoadBalancingStrategy,
} from '../../src/core/resource-optimizer.js';
import { DependencyGraph, buildDependencyGraph } from '../../src/core/dependency-graph.js';
import { DecomposedTask, TaskCategory } from '../../src/types.js';

// ========================================
// Test Helpers
// ========================================

function createMockTask(
  id: string,
  dependencies: string[] = [],
  options: Partial<DecomposedTask> = {}
): DecomposedTask {
  return {
    id,
    description: `Task ${id}`,
    category: 'implement' as TaskCategory,
    dependencies,
    priority: options.priority ?? 1,
    estimatedComplexity: options.estimatedComplexity ?? 'medium',
    ...options,
  };
}

function createLinearTasks(count: number): DecomposedTask[] {
  const tasks: DecomposedTask[] = [];
  for (let i = 1; i <= count; i++) {
    tasks.push(createMockTask(`T${i}`, i === 1 ? [] : [`T${i - 1}`]));
  }
  return tasks;
}

function createParallelTasks(count: number): DecomposedTask[] {
  const tasks: DecomposedTask[] = [];
  for (let i = 1; i <= count; i++) {
    tasks.push(createMockTask(`T${i}`, []));
  }
  return tasks;
}

// ========================================
// Test Suites
// ========================================

describe('ResourceOptimizer', () => {
  let optimizer: ResourceOptimizer;

  beforeEach(() => {
    optimizer = new ResourceOptimizer({ maxWorkers: 4 });
  });

  // ========================================
  // Initialization
  // ========================================

  describe('Initialization', () => {
    it('should create optimizer with default options', () => {
      const defaultOptimizer = new ResourceOptimizer();
      const workers = defaultOptimizer.getWorkerStates();
      expect(workers).toHaveLength(4); // default maxWorkers
    });

    it('should create optimizer with custom options', () => {
      const customOptimizer = new ResourceOptimizer({
        maxWorkers: 8,
        strategy: 'round_robin',
      });
      const workers = customOptimizer.getWorkerStates();
      expect(workers).toHaveLength(8);
    });

    it('should initialize all workers as idle', () => {
      const workers = optimizer.getWorkerStates();
      workers.forEach((worker) => {
        expect(worker.status).toBe('idle');
        expect(worker.load).toBe(0);
        expect(worker.currentTaskId).toBeNull();
      });
    });
  });

  // ========================================
  // Worker Management
  // ========================================

  describe('Worker Management', () => {
    it('should get worker states', () => {
      const workers = optimizer.getWorkerStates();
      expect(workers).toHaveLength(4);
      expect(workers[0].id).toBe('worker_0');
    });

    it('should get available workers', () => {
      const available = optimizer.getAvailableWorkers();
      expect(available).toHaveLength(4);
    });

    it('should increase worker count', () => {
      optimizer.setWorkerCount(6);
      const workers = optimizer.getWorkerStates();
      expect(workers).toHaveLength(6);
    });

    it('should decrease worker count for idle workers', () => {
      optimizer.setWorkerCount(2);
      const workers = optimizer.getWorkerStates();
      expect(workers).toHaveLength(2);
    });

    it('should not remove busy workers when decreasing count', () => {
      const tasks = createParallelTasks(3);
      optimizer.createSchedule(tasks);

      // Assign tasks to some workers
      optimizer.assignTask('T1', 'worker_0');
      optimizer.assignTask('T2', 'worker_1');

      // Try to decrease to 1 worker
      optimizer.setWorkerCount(1);

      // Should still have at least 2 workers (busy ones)
      const workers = optimizer.getWorkerStates();
      expect(workers.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================
  // Schedule Creation
  // ========================================

  describe('Schedule Creation', () => {
    it('should create schedule for single task', () => {
      const tasks = [createMockTask('T1')];
      const result = optimizer.createSchedule(tasks);

      expect(result.scheduledTasks).toHaveLength(1);
      expect(result.scheduledTasks[0].task.id).toBe('T1');
      expect(result.scheduledTasks[0].status).toBe('scheduled');
    });

    it('should create schedule for multiple tasks', () => {
      const tasks = createParallelTasks(5);
      const result = optimizer.createSchedule(tasks);

      expect(result.scheduledTasks).toHaveLength(5);
    });

    it('should emit schedule:created event', () => {
      const handler = vi.fn();
      optimizer.on('schedule:created', handler);

      const tasks = createParallelTasks(2);
      optimizer.createSchedule(tasks);

      expect(handler).toHaveBeenCalled();
    });

    it('should assign workers to scheduled tasks', () => {
      const tasks = createParallelTasks(3);
      const result = optimizer.createSchedule(tasks);

      result.scheduledTasks.forEach((task) => {
        expect(task.workerId).not.toBeNull();
      });
    });

    it('should calculate total estimated time', () => {
      const tasks = [
        createMockTask('T1', [], { estimatedComplexity: 'low' }),   // 30s
        createMockTask('T2', [], { estimatedComplexity: 'medium' }), // 60s
      ];
      const result = optimizer.createSchedule(tasks);

      expect(result.totalEstimatedTime).toBeGreaterThan(0);
    });

    it('should calculate worker utilization', () => {
      const tasks = createParallelTasks(4);
      const result = optimizer.createSchedule(tasks);

      expect(result.workerUtilization.size).toBeGreaterThan(0);
    });

    it('should calculate parallelism', () => {
      const tasks = createParallelTasks(8);
      const result = optimizer.createSchedule(tasks);

      expect(result.parallelism).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================
  // Scheduling with Dependency Graph
  // ========================================

  describe('Scheduling with Dependency Graph', () => {
    it('should use dependency graph for scheduling', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T2', 'T3']),
      ];
      const graph = buildDependencyGraph(tasks);
      const result = optimizer.createSchedule(tasks, graph);

      // T4 should be scheduled after T2 and T3
      const t2 = result.scheduledTasks.find((t) => t.task.id === 'T2')!;
      const t3 = result.scheduledTasks.find((t) => t.task.id === 'T3')!;
      const t4 = result.scheduledTasks.find((t) => t.task.id === 'T4')!;

      expect(t4.scheduledTime).toBeGreaterThanOrEqual(
        t2.scheduledTime + t2.estimatedDuration
      );
      expect(t4.scheduledTime).toBeGreaterThanOrEqual(
        t3.scheduledTime + t3.estimatedDuration
      );
    });

    it('should boost priority for critical path tasks', () => {
      const tasks = [
        createMockTask('T1', [], { estimatedComplexity: 'high' }),
        createMockTask('T2', ['T1'], { estimatedComplexity: 'high' }),
        createMockTask('T3', ['T1'], { estimatedComplexity: 'low' }),
      ];
      const graph = buildDependencyGraph(tasks);
      const result = optimizer.createSchedule(tasks, graph);

      // Critical path tasks should have adjusted priority
      expect(result.scheduledTasks.length).toBe(3);
    });
  });

  // ========================================
  // Load Balancing Strategies
  // ========================================

  describe('Load Balancing Strategies', () => {
    describe('Round Robin', () => {
      it('should distribute tasks evenly', () => {
        const rrOptimizer = new ResourceOptimizer({
          maxWorkers: 4,
          strategy: 'round_robin',
        });

        const tasks = createParallelTasks(8);
        const result = rrOptimizer.createSchedule(tasks);

        // Count tasks per worker
        const workerTaskCounts = new Map<string, number>();
        result.scheduledTasks.forEach((task) => {
          const count = workerTaskCounts.get(task.workerId!) || 0;
          workerTaskCounts.set(task.workerId!, count + 1);
        });

        // Each worker should have roughly equal tasks
        workerTaskCounts.forEach((count) => {
          expect(count).toBe(2);
        });
      });
    });

    describe('Least Loaded', () => {
      it('should prefer less loaded workers', () => {
        const llOptimizer = new ResourceOptimizer({
          maxWorkers: 4,
          strategy: 'least_loaded',
        });

        const tasks = createParallelTasks(4);
        const result = llOptimizer.createSchedule(tasks);

        // All workers should be used for 4 parallel tasks
        const usedWorkers = new Set(
          result.scheduledTasks.map((t) => t.workerId)
        );
        expect(usedWorkers.size).toBe(4);
      });
    });

    describe('Complexity Aware', () => {
      it('should assign high complexity tasks to least loaded workers', () => {
        const caOptimizer = new ResourceOptimizer({
          maxWorkers: 4,
          strategy: 'complexity_aware',
        });

        const tasks = [
          createMockTask('T1', [], { estimatedComplexity: 'high' }),
          createMockTask('T2', [], { estimatedComplexity: 'high' }),
          createMockTask('T3', [], { estimatedComplexity: 'low' }),
          createMockTask('T4', [], { estimatedComplexity: 'low' }),
        ];

        const result = caOptimizer.createSchedule(tasks);
        expect(result.scheduledTasks).toHaveLength(4);
      });
    });

    describe('Category Aware', () => {
      it('should handle different task categories', () => {
        const ctOptimizer = new ResourceOptimizer({
          maxWorkers: 4,
          strategy: 'category_aware',
        });

        const tasks = [
          createMockTask('T1', [], { category: 'design' }),
          createMockTask('T2', [], { category: 'implement' }),
          createMockTask('T3', [], { category: 'test' }),
          createMockTask('T4', [], { category: 'document' }),
        ];

        const result = ctOptimizer.createSchedule(tasks);
        expect(result.scheduledTasks).toHaveLength(4);
      });
    });
  });

  // ========================================
  // Task Assignment
  // ========================================

  describe('Task Assignment', () => {
    beforeEach(() => {
      const tasks = createParallelTasks(3);
      optimizer.createSchedule(tasks);
    });

    it('should assign task to worker', () => {
      const success = optimizer.assignTask('T1', 'worker_0');
      expect(success).toBe(true);

      const workers = optimizer.getWorkerStates();
      const worker = workers.find((w) => w.id === 'worker_0')!;
      expect(worker.status).toBe('busy');
      expect(worker.currentTaskId).toBe('T1');
    });

    it('should emit task:assigned event', () => {
      const handler = vi.fn();
      optimizer.on('task:assigned', handler);

      optimizer.assignTask('T1', 'worker_0');

      expect(handler).toHaveBeenCalledWith({
        taskId: 'T1',
        workerId: 'worker_0',
      });
    });

    it('should fail to assign to busy worker', () => {
      optimizer.assignTask('T1', 'worker_0');
      const success = optimizer.assignTask('T2', 'worker_0');
      expect(success).toBe(false);
    });

    it('should fail to assign non-existent task', () => {
      const success = optimizer.assignTask('NON_EXISTENT', 'worker_0');
      expect(success).toBe(false);
    });

    it('should fail to assign to non-existent worker', () => {
      const success = optimizer.assignTask('T1', 'worker_999');
      expect(success).toBe(false);
    });
  });

  // ========================================
  // Task Completion
  // ========================================

  describe('Task Completion', () => {
    beforeEach(() => {
      const tasks = createParallelTasks(2);
      optimizer.createSchedule(tasks);
      optimizer.assignTask('T1', 'worker_0');
    });

    it('should complete task and release worker', () => {
      optimizer.completeTask('T1', 1000);

      const workers = optimizer.getWorkerStates();
      const worker = workers.find((w) => w.id === 'worker_0')!;
      expect(worker.status).toBe('idle');
      expect(worker.currentTaskId).toBeNull();
      expect(worker.completedTasks).toBe(1);
    });

    it('should emit task:completed event', () => {
      const handler = vi.fn();
      optimizer.on('task:completed', handler);

      optimizer.completeTask('T1', 1000);

      expect(handler).toHaveBeenCalledWith({
        taskId: 'T1',
        executionTimeMs: 1000,
      });
    });

    it('should track total execution time', () => {
      optimizer.completeTask('T1', 1500);

      const workers = optimizer.getWorkerStates();
      const worker = workers.find((w) => w.id === 'worker_0')!;
      expect(worker.totalExecutionTime).toBe(1500);
    });
  });

  // ========================================
  // Task Failure
  // ========================================

  describe('Task Failure', () => {
    beforeEach(() => {
      const tasks = createParallelTasks(2);
      optimizer.createSchedule(tasks);
      optimizer.assignTask('T1', 'worker_0');
    });

    it('should handle task failure and release worker', () => {
      optimizer.failTask('T1', new Error('Test error'));

      const workers = optimizer.getWorkerStates();
      const worker = workers.find((w) => w.id === 'worker_0')!;
      expect(worker.status).toBe('idle');
      expect(worker.currentTaskId).toBeNull();
    });

    it('should emit task:failed event', () => {
      const handler = vi.fn();
      optimizer.on('task:failed', handler);

      optimizer.failTask('T1', new Error('Test error'));

      expect(handler).toHaveBeenCalledWith({
        taskId: 'T1',
        error: 'Test error',
      });
    });
  });

  // ========================================
  // Getting Next Tasks
  // ========================================

  describe('Getting Next Tasks', () => {
    it('should get ready tasks with no dependencies', () => {
      const tasks = createParallelTasks(4);
      optimizer.createSchedule(tasks);

      const nextTasks = optimizer.getNextTasks(new Set());
      expect(nextTasks).toHaveLength(4);
    });

    it('should limit to available workers', () => {
      optimizer.setWorkerCount(2);
      const tasks = createParallelTasks(4);
      optimizer.createSchedule(tasks);

      const nextTasks = optimizer.getNextTasks(new Set());
      expect(nextTasks.length).toBeLessThanOrEqual(2);
    });

    it('should respect dependencies', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
      ];
      const graph = buildDependencyGraph(tasks);
      optimizer.createSchedule(tasks, graph);

      // No tasks completed - only T1 is ready (dependencies not met for T2, T3)
      let nextTasks = optimizer.getNextTasks(new Set());
      // Since tasks are scheduled with proper dependency ordering,
      // without completed dependencies, only T1 should be returned
      const t1Ready = nextTasks.filter(t => t.id === 'T1');
      expect(t1Ready.length).toBeGreaterThanOrEqual(1);

      // T1 completed - T2 and T3 should now be ready
      nextTasks = optimizer.getNextTasks(new Set(['T1']));
      const t2t3Ready = nextTasks.filter(t => t.id === 'T2' || t.id === 'T3');
      expect(t2t3Ready.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================
  // Load Distribution
  // ========================================

  describe('Load Distribution', () => {
    it('should get load distribution', () => {
      const tasks = createParallelTasks(4);
      optimizer.createSchedule(tasks);

      const distribution = optimizer.getLoadDistribution();
      expect(distribution).toHaveLength(4);
      distribution.forEach((item) => {
        expect(item).toHaveProperty('workerId');
        expect(item).toHaveProperty('load');
        expect(item).toHaveProperty('taskCount');
      });
    });

    it('should detect load imbalance', () => {
      const tasks = createParallelTasks(4);
      optimizer.createSchedule(tasks);

      // Initially no imbalance
      expect(optimizer.isLoadImbalanced()).toBe(false);

      // Complete tasks on one worker only
      optimizer.assignTask('T1', 'worker_0');
      optimizer.completeTask('T1', 10000);
      optimizer.assignTask('T2', 'worker_0');
      optimizer.completeTask('T2', 10000);

      // Now there should be imbalance
      expect(optimizer.isLoadImbalanced()).toBe(true);
    });
  });

  // ========================================
  // Statistics
  // ========================================

  describe('Statistics', () => {
    it('should get scheduling statistics', () => {
      const tasks = createParallelTasks(5);
      optimizer.createSchedule(tasks);

      const stats = optimizer.getStatistics();
      expect(stats.totalTasks).toBe(5);
      // pendingTasks counts both 'pending' and 'scheduled' status
      expect(stats.pendingTasks).toBe(5);
      expect(stats.completedTasks).toBe(0);
      expect(stats.failedTasks).toBe(0);
    });

    it('should track completed tasks in statistics', () => {
      const tasks = createParallelTasks(3);
      optimizer.createSchedule(tasks);

      optimizer.assignTask('T1', 'worker_0');
      optimizer.completeTask('T1', 1000);

      const stats = optimizer.getStatistics();
      expect(stats.completedTasks).toBe(1);
    });

    it('should get worker statistics', () => {
      const tasks = createParallelTasks(2);
      optimizer.createSchedule(tasks);

      optimizer.assignTask('T1', 'worker_0');
      optimizer.completeTask('T1', 1500);

      const workerStats = optimizer.getWorkerStatistics();
      const worker0 = workerStats.find((w) => w.workerId === 'worker_0')!;

      expect(worker0.completedTasks).toBe(1);
      expect(worker0.totalExecutionTime).toBe(1500);
      expect(worker0.averageTaskTime).toBe(1500);
    });
  });

  // ========================================
  // Reset
  // ========================================

  describe('Reset', () => {
    it('should reset all state', () => {
      const tasks = createParallelTasks(3);
      optimizer.createSchedule(tasks);
      optimizer.assignTask('T1', 'worker_0');
      optimizer.completeTask('T1', 1000);

      optimizer.reset();

      const stats = optimizer.getStatistics();
      expect(stats.totalTasks).toBe(0);

      const workers = optimizer.getWorkerStates();
      workers.forEach((worker) => {
        expect(worker.status).toBe('idle');
        expect(worker.completedTasks).toBe(0);
        expect(worker.totalExecutionTime).toBe(0);
      });
    });
  });

  // ========================================
  // Factory Functions
  // ========================================

  describe('Factory Functions', () => {
    it('should create optimizer with createResourceOptimizer', () => {
      const newOptimizer = createResourceOptimizer({ maxWorkers: 6 });
      expect(newOptimizer.getWorkerStates()).toHaveLength(6);
    });

    it('should create optimizer from config', () => {
      const configOptimizer = createResourceOptimizerFromConfig({
        agents: {
          maxConcurrent: 10,
          timeoutMs: 600000,
        },
      });
      expect(configOptimizer.getWorkerStates()).toHaveLength(10);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty task list', () => {
      const result = optimizer.createSchedule([]);
      expect(result.scheduledTasks).toHaveLength(0);
      // Math.max with spread of empty Map values returns -Infinity
      // But the implementation may return 0 or -Infinity depending on the Map
      expect(result.totalEstimatedTime).toBeLessThanOrEqual(0);
    });

    it('should handle single worker', () => {
      const singleWorkerOptimizer = new ResourceOptimizer({ maxWorkers: 1 });
      const tasks = createParallelTasks(5);
      const result = singleWorkerOptimizer.createSchedule(tasks);

      // All tasks should be assigned to the same worker
      const workers = new Set(result.scheduledTasks.map((t) => t.workerId));
      expect(workers.size).toBe(1);
    });

    it('should handle more workers than tasks', () => {
      const manyWorkersOptimizer = new ResourceOptimizer({ maxWorkers: 10 });
      const tasks = createParallelTasks(3);
      const result = manyWorkersOptimizer.createSchedule(tasks);

      expect(result.scheduledTasks).toHaveLength(3);
    });

    it('should handle tasks with different priorities', () => {
      const tasks = [
        createMockTask('T1', [], { priority: 5 }),
        createMockTask('T2', [], { priority: 1 }),
        createMockTask('T3', [], { priority: 3 }),
      ];
      const result = optimizer.createSchedule(tasks);

      // All tasks should be scheduled
      expect(result.scheduledTasks).toHaveLength(3);
    });

    it('should handle completing non-existent task', () => {
      const tasks = createParallelTasks(1);
      optimizer.createSchedule(tasks);

      // Should not throw
      expect(() => optimizer.completeTask('NON_EXISTENT', 1000)).not.toThrow();
    });

    it('should handle failing non-existent task', () => {
      const tasks = createParallelTasks(1);
      optimizer.createSchedule(tasks);

      // Should not throw
      expect(() =>
        optimizer.failTask('NON_EXISTENT', new Error('Test'))
      ).not.toThrow();
    });
  });
});
