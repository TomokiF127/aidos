/**
 * TaskDecomposer Integration Tests
 *
 * Tests for mock task decomposition, validation, and topological sorting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskDecomposer,
  getTaskDecomposer,
  resetTaskDecomposer,
  DecomposeResult,
  ValidationResult,
} from '../../src/core/task-decomposer.js';
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

// ========================================
// Test Suites
// ========================================

describe('TaskDecomposer', () => {
  let decomposer: TaskDecomposer;

  beforeEach(() => {
    resetTaskDecomposer();
    decomposer = new TaskDecomposer();
  });

  afterEach(() => {
    resetTaskDecomposer();
  });

  // ========================================
  // Initialization
  // ========================================

  describe('Initialization', () => {
    it('should create decomposer with default config', () => {
      expect(decomposer).toBeDefined();
    });

    it('should create decomposer with custom config', () => {
      const customDecomposer = new TaskDecomposer({
        agents: {
          maxConcurrent: 10,
          timeoutMs: 60000,
        },
      });
      expect(customDecomposer).toBeDefined();
    });
  });

  // ========================================
  // Mock Decomposition
  // ========================================

  describe('Mock Decomposition', () => {
    it('should decompose login-related objective', async () => {
      const result = await decomposer.decompose('Webアプリのログイン機能を作成する');

      expect(result.objective).toContain('ログイン');
      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.reasoning).toBeDefined();
      expect(result.metadata.mode).toBe('mock');
    });

    it('should decompose pagination-related objective', async () => {
      const result = await decomposer.decompose('REST APIにページネーション機能を追加する');

      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.metadata.mode).toBe('mock');
    });

    it('should decompose profile-related objective', async () => {
      const result = await decomposer.decompose('ユーザープロフィール編集画面を実装する');

      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.metadata.mode).toBe('mock');
    });

    it('should generate generic decomposition for unknown objectives', async () => {
      const result = await decomposer.decompose('Something completely different');

      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.reasoning).toContain('汎用的');
    });

    it('should assign unique task IDs', async () => {
      const result = await decomposer.decompose('ログイン機能');

      const ids = result.tasks.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should update dependency references with new IDs', async () => {
      const result = await decomposer.decompose('ログイン機能');

      const taskIds = new Set(result.tasks.map((t) => t.id));

      // All dependencies should reference valid task IDs
      result.tasks.forEach((task) => {
        task.dependencies.forEach((dep) => {
          expect(taskIds.has(dep)).toBe(true);
        });
      });
    });

    it('should include processing time in metadata', async () => {
      const result = await decomposer.decompose('ログイン機能');

      expect(result.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================
  // Events
  // ========================================

  describe('Events', () => {
    it('should emit decompose:start event', async () => {
      const handler = vi.fn();
      decomposer.on('decompose:start', handler);

      await decomposer.decompose('ログイン機能');

      expect(handler).toHaveBeenCalledWith({
        objective: 'ログイン機能',
        useApi: false,
      });
    });

    it('should emit decompose:progress events', async () => {
      const handler = vi.fn();
      decomposer.on('decompose:progress', handler);

      await decomposer.decompose('ログイン機能');

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls.length).toBeGreaterThan(0);
    });

    it('should emit decompose:complete event', async () => {
      const handler = vi.fn();
      decomposer.on('decompose:complete', handler);

      await decomposer.decompose('ログイン機能');

      expect(handler).toHaveBeenCalled();
      const result = handler.mock.calls[0][0] as DecomposeResult;
      expect(result.tasks.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Dependency Validation
  // ========================================

  describe('Dependency Validation', () => {
    it('should validate valid task dependencies', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1', 'T2']),
      ];

      const result = decomposer.validateDependencies(tasks);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid dependency references', () => {
      const tasks = [
        createMockTask('T1', ['NON_EXISTENT']),
        createMockTask('T2'),
      ];

      const result = decomposer.validateDependencies(tasks);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('invalid dependency');
    });

    it('should detect circular dependencies', () => {
      const tasks = [
        createMockTask('T1', ['T3']),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T2']),
      ];

      const result = decomposer.validateDependencies(tasks);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Circular'))).toBe(true);
    });

    it('should warn about isolated tasks', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3'), // Isolated
      ];

      const result = decomposer.validateDependencies(tasks);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('isolated'))).toBe(true);
    });

    it('should not warn for single isolated task', () => {
      const tasks = [createMockTask('T1')];

      const result = decomposer.validateDependencies(tasks);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // ========================================
  // Topological Sort
  // ========================================

  describe('Topological Sort', () => {
    it('should sort single task', () => {
      const tasks = [createMockTask('T1')];

      const sorted = decomposer.topologicalSort(tasks);
      expect(sorted).toHaveLength(1);
      expect(sorted[0].id).toBe('T1');
    });

    it('should sort linear dependencies correctly', () => {
      const tasks = [
        createMockTask('T3', ['T2']),
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
      ];

      const sorted = decomposer.topologicalSort(tasks);
      expect(sorted[0].id).toBe('T1');
      expect(sorted[1].id).toBe('T2');
      expect(sorted[2].id).toBe('T3');
    });

    it('should sort diamond dependencies correctly', () => {
      const tasks = [
        createMockTask('T4', ['T2', 'T3']),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T1'),
      ];

      const sorted = decomposer.topologicalSort(tasks);
      expect(sorted[0].id).toBe('T1');
      expect(sorted[sorted.length - 1].id).toBe('T4');
    });

    it('should handle independent tasks', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2'),
        createMockTask('T3'),
      ];

      const sorted = decomposer.topologicalSort(tasks);
      expect(sorted).toHaveLength(3);
    });
  });

  // ========================================
  // Parallel Groups
  // ========================================

  describe('Parallel Groups', () => {
    it('should group independent tasks together', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2'),
        createMockTask('T3'),
      ];

      const groups = decomposer.getParallelGroups(tasks);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(3);
    });

    it('should create separate groups for dependent tasks', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T2']),
      ];

      const groups = decomposer.getParallelGroups(tasks);
      expect(groups).toHaveLength(3);
      expect(groups[0][0].id).toBe('T1');
      expect(groups[1][0].id).toBe('T2');
      expect(groups[2][0].id).toBe('T3');
    });

    it('should group parallel branches at same level', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T2', 'T3']),
      ];

      const groups = decomposer.getParallelGroups(tasks);
      expect(groups).toHaveLength(3);
      expect(groups[0]).toHaveLength(1); // T1
      expect(groups[1]).toHaveLength(2); // T2, T3
      expect(groups[2]).toHaveLength(1); // T4
    });

    it('should handle complex dependency graph', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2'),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T1', 'T2']),
        createMockTask('T5', ['T3', 'T4']),
      ];

      const groups = decomposer.getParallelGroups(tasks);
      expect(groups.length).toBeGreaterThan(1);

      // Verify all tasks are included
      const allTasks = groups.flat();
      expect(allTasks).toHaveLength(5);
    });
  });

  // ========================================
  // Singleton Pattern
  // ========================================

  describe('Singleton Pattern', () => {
    it('should return same instance with getTaskDecomposer', () => {
      const instance1 = getTaskDecomposer();
      const instance2 = getTaskDecomposer();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getTaskDecomposer();
      resetTaskDecomposer();
      const instance2 = getTaskDecomposer();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ========================================
  // Keyword Matching
  // ========================================

  describe('Keyword Matching', () => {
    it('should match Japanese login keyword', async () => {
      const result = await decomposer.decompose('ログイン画面を作る');
      expect(result.tasks.some((t) => t.description.includes('認証'))).toBe(true);
    });

    it('should match English login keyword', async () => {
      const result = await decomposer.decompose('Create login feature');
      expect(result.tasks.length).toBeGreaterThan(0);
    });

    it('should match authentication keyword', async () => {
      const result = await decomposer.decompose('認証システムを実装する');
      expect(result.tasks.length).toBeGreaterThan(0);
    });

    it('should match pagination keyword', async () => {
      const result = await decomposer.decompose('ページネーションを追加');
      expect(result.tasks.length).toBeGreaterThan(0);
    });

    it('should match profile keyword', async () => {
      const result = await decomposer.decompose('プロフィール機能');
      expect(result.tasks.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Task Categories
  // ========================================

  describe('Task Categories', () => {
    it('should include design tasks', async () => {
      const result = await decomposer.decompose('ログイン機能');
      const designTasks = result.tasks.filter((t) => t.category === 'design');
      expect(designTasks.length).toBeGreaterThan(0);
    });

    it('should include implement tasks', async () => {
      const result = await decomposer.decompose('ログイン機能');
      const implementTasks = result.tasks.filter((t) => t.category === 'implement');
      expect(implementTasks.length).toBeGreaterThan(0);
    });

    it('should include test tasks', async () => {
      const result = await decomposer.decompose('ログイン機能');
      const testTasks = result.tasks.filter((t) => t.category === 'test');
      expect(testTasks.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Task Complexity
  // ========================================

  describe('Task Complexity', () => {
    it('should have varying complexity levels', async () => {
      const result = await decomposer.decompose('プロフィール機能');

      const complexities = result.tasks.map((t) => t.estimatedComplexity);
      const uniqueComplexities = new Set(complexities);
      expect(uniqueComplexities.size).toBeGreaterThan(1);
    });

    it('should assign valid complexity values', async () => {
      const result = await decomposer.decompose('ログイン機能');

      result.tasks.forEach((task) => {
        expect(['low', 'medium', 'high']).toContain(task.estimatedComplexity);
      });
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty objective', async () => {
      const result = await decomposer.decompose('');
      expect(result.tasks.length).toBeGreaterThan(0); // Falls back to generic
    });

    it('should handle very long objective', async () => {
      const longObjective = 'A'.repeat(1000);
      const result = await decomposer.decompose(longObjective);
      expect(result.tasks.length).toBeGreaterThan(0);
    });

    it('should handle special characters in objective', async () => {
      const result = await decomposer.decompose('ログイン機能@#$%^&*()');
      expect(result.tasks.length).toBeGreaterThan(0);
    });

    it('should handle mixed language objective', async () => {
      const result = await decomposer.decompose('Create a ログイン feature with パスワード');
      expect(result.tasks.length).toBeGreaterThan(0);
    });

    it('should maintain task counter across decompositions', async () => {
      const result1 = await decomposer.decompose('ログイン');
      const result2 = await decomposer.decompose('プロフィール');

      const allIds = [...result1.tasks, ...result2.tasks].map((t) => t.id);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  // ========================================
  // API Mode (Fallback)
  // ========================================

  describe('API Mode', () => {
    it('should fall back to mock when API mode is requested', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await decomposer.decompose('ログイン機能', {
        useApi: true,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        'API mode not implemented, falling back to mock'
      );
      expect(result.tasks.length).toBeGreaterThan(0);

      warnSpy.mockRestore();
    });
  });
});
