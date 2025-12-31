/**
 * DependencyGraph Integration Tests
 *
 * Tests for DAG operations, topological sort, and critical path calculation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DependencyGraph,
  createDependencyGraph,
  buildDependencyGraph,
  GraphNode,
  CriticalPathInfo,
  ParallelGroup,
  GraphAnalysis,
} from '../../src/core/dependency-graph.js';
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
    tasks.push(
      createMockTask(`T${i}`, i === 1 ? [] : [`T${i - 1}`])
    );
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

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  // ========================================
  // Basic Operations
  // ========================================

  describe('Graph Creation', () => {
    it('should create an empty graph', () => {
      expect(graph).toBeDefined();
      expect(graph.topologicalSort()).toHaveLength(0);
    });

    it('should build graph from single task', () => {
      const tasks = [createMockTask('T1')];
      graph.buildFromTasks(tasks);

      const node = graph.getNode('T1');
      expect(node).toBeDefined();
      expect(node?.task.id).toBe('T1');
    });

    it('should build graph from multiple independent tasks', () => {
      const tasks = createParallelTasks(3);
      graph.buildFromTasks(tasks);

      const sorted = graph.topologicalSort();
      expect(sorted).toHaveLength(3);
    });

    it('should build graph from tasks with dependencies', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T2', 'T3']),
      ];
      graph.buildFromTasks(tasks);

      const sorted = graph.topologicalSort();
      expect(sorted).toHaveLength(4);
      expect(sorted.indexOf('T1')).toBeLessThan(sorted.indexOf('T2'));
      expect(sorted.indexOf('T1')).toBeLessThan(sorted.indexOf('T3'));
      expect(sorted.indexOf('T2')).toBeLessThan(sorted.indexOf('T4'));
      expect(sorted.indexOf('T3')).toBeLessThan(sorted.indexOf('T4'));
    });
  });

  describe('Graph Clear', () => {
    it('should clear all nodes and edges', () => {
      const tasks = createLinearTasks(3);
      graph.buildFromTasks(tasks);
      graph.clear();

      expect(graph.topologicalSort()).toHaveLength(0);
      expect(graph.getNode('T1')).toBeUndefined();
    });
  });

  // ========================================
  // Topological Sort
  // ========================================

  describe('Topological Sort', () => {
    it('should return empty array for empty graph', () => {
      expect(graph.topologicalSort()).toEqual([]);
    });

    it('should sort single task', () => {
      const tasks = [createMockTask('T1')];
      graph.buildFromTasks(tasks);

      expect(graph.topologicalSort()).toEqual(['T1']);
    });

    it('should sort linear chain correctly', () => {
      const tasks = createLinearTasks(5);
      graph.buildFromTasks(tasks);

      const sorted = graph.topologicalSort();
      for (let i = 0; i < sorted.length - 1; i++) {
        expect(sorted[i]).toBe(`T${i + 1}`);
      }
    });

    it('should sort diamond dependency correctly', () => {
      // Diamond: T1 -> T2, T3 -> T4
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T2', 'T3']),
      ];
      graph.buildFromTasks(tasks);

      const sorted = graph.topologicalSort();
      expect(sorted[0]).toBe('T1');
      expect(sorted[sorted.length - 1]).toBe('T4');
    });

    it('should respect priority when multiple tasks are available', () => {
      const tasks = [
        createMockTask('T1', [], { priority: 3 }),
        createMockTask('T2', [], { priority: 1 }),
        createMockTask('T3', [], { priority: 2 }),
      ];
      graph.buildFromTasks(tasks);

      const sorted = graph.topologicalSort();
      // T2 has highest priority (1), then T3 (2), then T1 (3)
      expect(sorted[0]).toBe('T2');
      expect(sorted[1]).toBe('T3');
      expect(sorted[2]).toBe('T1');
    });

    it('should return sorted tasks', () => {
      const tasks = createLinearTasks(3);
      graph.buildFromTasks(tasks);

      const sortedTasks = graph.getSortedTasks();
      expect(sortedTasks).toHaveLength(3);
      expect(sortedTasks[0].id).toBe('T1');
      expect(sortedTasks[2].id).toBe('T3');
    });
  });

  // ========================================
  // Critical Path Calculation
  // ========================================

  describe('Critical Path', () => {
    it('should identify single task as critical path', () => {
      const tasks = [createMockTask('T1', [], { estimatedComplexity: 'medium' })];
      graph.buildFromTasks(tasks);

      const criticalPath = graph.getCriticalPath();
      expect(criticalPath.path).toContain('T1');
      expect(criticalPath.totalDuration).toBeGreaterThan(0);
    });

    it('should identify critical path in linear chain', () => {
      const tasks = createLinearTasks(3);
      graph.buildFromTasks(tasks);

      const criticalPath = graph.getCriticalPath();
      expect(criticalPath.path).toHaveLength(3);
      expect(criticalPath.path).toEqual(['T1', 'T2', 'T3']);
    });

    it('should calculate correct duration based on complexity', () => {
      const tasks = [
        createMockTask('T1', [], { estimatedComplexity: 'low' }),   // 1 unit
        createMockTask('T2', ['T1'], { estimatedComplexity: 'high' }), // 4 units
      ];
      graph.buildFromTasks(tasks);

      const criticalPath = graph.getCriticalPath();
      expect(criticalPath.totalDuration).toBe(5); // 1 + 4
    });

    it('should identify critical path in diamond with different complexities', () => {
      // T1 (low=1) -> T2 (high=4) -> T4 (medium=2)
      // T1 (low=1) -> T3 (low=1) -> T4 (medium=2)
      // Critical: T1 -> T2 -> T4 (total = 7)
      const tasks = [
        createMockTask('T1', [], { estimatedComplexity: 'low' }),
        createMockTask('T2', ['T1'], { estimatedComplexity: 'high' }),
        createMockTask('T3', ['T1'], { estimatedComplexity: 'low' }),
        createMockTask('T4', ['T2', 'T3'], { estimatedComplexity: 'medium' }),
      ];
      graph.buildFromTasks(tasks);

      const criticalPath = graph.getCriticalPath();
      // Critical path should include T1, T2, T4 (the longer path)
      expect(criticalPath.path).toContain('T1');
      expect(criticalPath.path).toContain('T4');
    });
  });

  // ========================================
  // Parallel Groups
  // ========================================

  describe('Parallel Groups', () => {
    it('should identify all tasks as parallel when no dependencies', () => {
      const tasks = createParallelTasks(4);
      graph.buildFromTasks(tasks);

      const groups = graph.getParallelGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].tasks).toHaveLength(4);
      expect(groups[0].level).toBe(0);
    });

    it('should create separate levels for dependent tasks', () => {
      const tasks = createLinearTasks(3);
      graph.buildFromTasks(tasks);

      const groups = graph.getParallelGroups();
      expect(groups).toHaveLength(3);
      expect(groups[0].tasks[0].id).toBe('T1');
      expect(groups[1].tasks[0].id).toBe('T2');
      expect(groups[2].tasks[0].id).toBe('T3');
    });

    it('should group parallel branches at same level', () => {
      // T1 -> T2, T3 (parallel) -> T4
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T2', 'T3']),
      ];
      graph.buildFromTasks(tasks);

      const groups = graph.getParallelGroups();
      expect(groups).toHaveLength(3);
      expect(groups[0].tasks).toHaveLength(1); // T1
      expect(groups[1].tasks).toHaveLength(2); // T2, T3
      expect(groups[2].tasks).toHaveLength(1); // T4
    });

    it('should calculate max concurrency correctly', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T1']),
      ];
      graph.buildFromTasks(tasks);

      const groups = graph.getParallelGroups();
      expect(groups[1].maxConcurrency).toBe(3);
    });
  });

  describe('Optimized Groups', () => {
    it('should limit concurrency to max workers', () => {
      const tasks = createParallelTasks(10);
      graph.buildFromTasks(tasks);

      const groups = graph.getOptimizedGroups(4);
      groups.forEach((group) => {
        expect(group.tasks.length).toBeLessThanOrEqual(4);
      });
    });

    it('should not split groups smaller than max workers', () => {
      const tasks = createParallelTasks(3);
      graph.buildFromTasks(tasks);

      const groups = graph.getOptimizedGroups(5);
      expect(groups).toHaveLength(1);
      expect(groups[0].tasks).toHaveLength(3);
    });
  });

  // ========================================
  // Cycle Detection
  // ========================================

  describe('Cycle Detection', () => {
    it('should emit event when cycle is detected', () => {
      const cycleHandler = vi.fn();
      graph.on('graph:cycle_detected', cycleHandler);

      // This creates a cycle: T1 -> T2 -> T1
      // We need to build the graph in a way that creates this
      const tasks = [
        createMockTask('T1', ['T2']),
        createMockTask('T2', ['T1']),
      ];
      graph.buildFromTasks(tasks);

      // The graph should have detected and prevented the cycle
      expect(cycleHandler).toHaveBeenCalled();
    });

    it('should not create cycle edges', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T2']),
      ];
      // If T1 depends on T3, it would create a cycle
      tasks[0].dependencies = ['T3'];

      graph.buildFromTasks(tasks);

      // The graph should still be valid (cycle edge was rejected)
      const sorted = graph.topologicalSort();
      expect(sorted.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Invalid Dependency Handling
  // ========================================

  describe('Invalid Dependencies', () => {
    it('should emit event for non-existent dependency', () => {
      const invalidHandler = vi.fn();
      graph.on('graph:invalid_dependency', invalidHandler);

      const tasks = [
        createMockTask('T1', ['NON_EXISTENT']),
      ];
      graph.buildFromTasks(tasks);

      expect(invalidHandler).toHaveBeenCalledWith({
        taskId: 'T1',
        dependencyId: 'NON_EXISTENT',
      });
    });
  });

  // ========================================
  // Graph Analysis
  // ========================================

  describe('Graph Analysis', () => {
    it('should analyze empty graph', () => {
      const analysis = graph.analyze();
      expect(analysis.totalNodes).toBe(0);
      expect(analysis.totalEdges).toBe(0);
    });

    it('should count nodes and edges correctly', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
      ];
      graph.buildFromTasks(tasks);

      const analysis = graph.analyze();
      expect(analysis.totalNodes).toBe(3);
      expect(analysis.totalEdges).toBe(2);
    });

    it('should identify bottlenecks', () => {
      // T1 is a bottleneck (3 dependents)
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T1']),
      ];
      graph.buildFromTasks(tasks);

      const analysis = graph.analyze();
      expect(analysis.bottlenecks).toContain('T1');
    });

    it('should identify isolated tasks', () => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3'), // Isolated - no deps and not depended on
      ];
      graph.buildFromTasks(tasks);

      const analysis = graph.analyze();
      expect(analysis.isolatedTasks).toContain('T3');
    });

    it('should emit analysis:completed event', () => {
      const analysisHandler = vi.fn();
      graph.on('analysis:completed', analysisHandler);

      const tasks = createLinearTasks(3);
      graph.buildFromTasks(tasks);
      graph.analyze();

      expect(analysisHandler).toHaveBeenCalled();
    });
  });

  // ========================================
  // Query Methods
  // ========================================

  describe('Query Methods', () => {
    beforeEach(() => {
      const tasks = [
        createMockTask('T1'),
        createMockTask('T2', ['T1']),
        createMockTask('T3', ['T1']),
        createMockTask('T4', ['T2', 'T3']),
      ];
      graph.buildFromTasks(tasks);
    });

    it('should get node by id', () => {
      const node = graph.getNode('T2');
      expect(node).toBeDefined();
      expect(node?.task.id).toBe('T2');
      expect(node?.dependencies.has('T1')).toBe(true);
    });

    it('should return undefined for non-existent node', () => {
      const node = graph.getNode('NON_EXISTENT');
      expect(node).toBeUndefined();
    });

    it('should check if dependencies are satisfied', () => {
      const completed = new Set(['T1']);
      expect(graph.areDependenciesSatisfied('T2', completed)).toBe(true);
      expect(graph.areDependenciesSatisfied('T4', completed)).toBe(false);
    });

    it('should get ready tasks', () => {
      const completed = new Set(['T1']);
      const ready = graph.getReadyTasks(completed);

      expect(ready).toHaveLength(2);
      expect(ready.map((t) => t.id)).toContain('T2');
      expect(ready.map((t) => t.id)).toContain('T3');
    });

    it('should get descendants of a task', () => {
      const descendants = graph.getDescendants('T1');
      expect(descendants).toContain('T2');
      expect(descendants).toContain('T3');
      expect(descendants).toContain('T4');
    });

    it('should get ancestors of a task', () => {
      const ancestors = graph.getAncestors('T4');
      expect(ancestors).toContain('T2');
      expect(ancestors).toContain('T3');
      expect(ancestors).toContain('T1');
    });
  });

  // ========================================
  // Visualization
  // ========================================

  describe('Visualization', () => {
    it('should generate string representation', () => {
      const tasks = createLinearTasks(2);
      graph.buildFromTasks(tasks);

      const str = graph.toString();
      expect(str).toContain('Dependency Graph');
      expect(str).toContain('T1');
      expect(str).toContain('T2');
    });

    it('should generate DOT format', () => {
      const tasks = createLinearTasks(2);
      graph.buildFromTasks(tasks);

      const dot = graph.toDot();
      expect(dot).toContain('digraph G');
      expect(dot).toContain('"T1"');
      expect(dot).toContain('"T2"');
      expect(dot).toContain('->');
    });
  });

  // ========================================
  // Factory Functions
  // ========================================

  describe('Factory Functions', () => {
    it('should create graph with createDependencyGraph', () => {
      const newGraph = createDependencyGraph();
      expect(newGraph).toBeInstanceOf(DependencyGraph);
    });

    it('should build graph with buildDependencyGraph', () => {
      const tasks = createLinearTasks(3);
      const builtGraph = buildDependencyGraph(tasks);

      expect(builtGraph.topologicalSort()).toHaveLength(3);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle task with self-dependency', () => {
      const cycleHandler = vi.fn();
      graph.on('graph:cycle_detected', cycleHandler);

      const tasks = [createMockTask('T1', ['T1'])];
      graph.buildFromTasks(tasks);

      // Self-dependency should be detected as cycle
      expect(cycleHandler).toHaveBeenCalled();
    });

    it('should handle large number of tasks', () => {
      const tasks: DecomposedTask[] = [];
      for (let i = 1; i <= 100; i++) {
        tasks.push(createMockTask(`T${i}`, i > 1 ? [`T${i - 1}`] : []));
      }
      graph.buildFromTasks(tasks);

      const sorted = graph.topologicalSort();
      expect(sorted).toHaveLength(100);
    });

    it('should handle wide parallel graph', () => {
      // 1 root, 50 parallel children, 1 final
      const tasks: DecomposedTask[] = [createMockTask('ROOT')];
      for (let i = 1; i <= 50; i++) {
        tasks.push(createMockTask(`P${i}`, ['ROOT']));
      }
      tasks.push(
        createMockTask(
          'FINAL',
          Array.from({ length: 50 }, (_, i) => `P${i + 1}`)
        )
      );
      graph.buildFromTasks(tasks);

      const groups = graph.getParallelGroups();
      expect(groups[1].tasks).toHaveLength(50);
    });
  });
});
