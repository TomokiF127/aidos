/**
 * 依存関係グラフ管理
 *
 * タスクのDAG（有向非巡回グラフ）構造を管理し、
 * トポロジカルソート、クリティカルパス計算、並列実行可能グループの特定を行う。
 */

import { EventEmitter } from 'events';
import { DecomposedTask, TaskCategory } from '../types.js';

// ========================================
// Types
// ========================================

/**
 * グラフノード
 */
export interface GraphNode {
  id: string;
  task: DecomposedTask;
  inDegree: number;        // 入次数（このノードに入ってくるエッジの数）
  outDegree: number;       // 出次数（このノードから出ていくエッジの数）
  dependencies: Set<string>;
  dependents: Set<string>; // このタスクに依存しているタスク
  earliestStart: number;   // 最早開始時間
  latestStart: number;     // 最遅開始時間
  slack: number;           // スラック（余裕時間）
  level: number;           // グラフ内の深さレベル
}

/**
 * グラフエッジ
 */
export interface GraphEdge {
  from: string;
  to: string;
  weight: number; // 所要時間（複雑度ベース）
}

/**
 * クリティカルパス情報
 */
export interface CriticalPathInfo {
  path: string[];              // クリティカルパス上のタスクID
  totalDuration: number;       // 総所要時間
  tasks: DecomposedTask[];     // タスク詳細
}

/**
 * 並列実行グループ
 */
export interface ParallelGroup {
  level: number;
  tasks: DecomposedTask[];
  maxConcurrency: number;      // このグループの最大並列度
  estimatedDuration: number;   // このグループの推定所要時間
}

/**
 * グラフ分析結果
 */
export interface GraphAnalysis {
  totalNodes: number;
  totalEdges: number;
  maxDepth: number;
  criticalPath: CriticalPathInfo;
  parallelGroups: ParallelGroup[];
  bottlenecks: string[];       // ボトルネックとなるタスクID
  isolatedTasks: string[];     // 孤立したタスク
}

/**
 * 依存関係グラフイベント
 */
export type DependencyGraphEvent =
  | 'graph:built'
  | 'graph:updated'
  | 'graph:cycle_detected'
  | 'graph:invalid_dependency'
  | 'analysis:completed';

/**
 * 複雑度から推定時間への変換
 */
const COMPLEXITY_DURATION: Record<DecomposedTask['estimatedComplexity'], number> = {
  low: 1,
  medium: 2,
  high: 4,
};

// ========================================
// DependencyGraph Class
// ========================================

/**
 * 依存関係グラフ管理クラス
 */
export class DependencyGraph extends EventEmitter {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private adjacencyList: Map<string, Set<string>> = new Map();
  private reverseAdjacencyList: Map<string, Set<string>> = new Map();

  constructor() {
    super();
  }

  // ========================================
  // Graph Building
  // ========================================

  /**
   * タスクリストからグラフを構築
   */
  buildFromTasks(tasks: DecomposedTask[]): void {
    this.clear();

    // ノードを作成
    for (const task of tasks) {
      this.addNode(task);
    }

    // エッジを作成（依存関係）
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (this.nodes.has(depId)) {
          this.addEdge(depId, task.id);
        } else {
          this.emit('graph:invalid_dependency', { taskId: task.id, dependencyId: depId });
        }
      }
    }

    // レベルと時間を計算
    this.calculateLevels();
    this.calculateEarliestStartTimes();
    this.calculateLatestStartTimes();
    this.calculateSlack();

    this.emit('graph:built', { nodeCount: this.nodes.size, edgeCount: this.edges.length });
  }

  /**
   * ノードを追加
   */
  private addNode(task: DecomposedTask): void {
    const node: GraphNode = {
      id: task.id,
      task,
      inDegree: 0,
      outDegree: 0,
      dependencies: new Set(task.dependencies),
      dependents: new Set(),
      earliestStart: 0,
      latestStart: 0,
      slack: 0,
      level: 0,
    };

    this.nodes.set(task.id, node);
    this.adjacencyList.set(task.id, new Set());
    this.reverseAdjacencyList.set(task.id, new Set());
  }

  /**
   * エッジを追加
   */
  private addEdge(from: string, to: string): void {
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);

    if (!fromNode || !toNode) return;

    // 循環チェック
    if (this.wouldCreateCycle(from, to)) {
      this.emit('graph:cycle_detected', { from, to });
      return;
    }

    const weight = COMPLEXITY_DURATION[fromNode.task.estimatedComplexity];

    this.edges.push({ from, to, weight });
    this.adjacencyList.get(from)?.add(to);
    this.reverseAdjacencyList.get(to)?.add(from);

    fromNode.outDegree++;
    fromNode.dependents.add(to);
    toNode.inDegree++;
  }

  /**
   * 循環が発生するかチェック
   */
  private wouldCreateCycle(from: string, to: string): boolean {
    // to から from に到達可能なら循環
    const visited = new Set<string>();
    const stack = [to];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === from) return true;
      if (visited.has(current)) continue;

      visited.add(current);
      const neighbors = this.adjacencyList.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          stack.push(neighbor);
        }
      }
    }

    return false;
  }

  /**
   * グラフをクリア
   */
  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.adjacencyList.clear();
    this.reverseAdjacencyList.clear();
  }

  // ========================================
  // Level Calculation
  // ========================================

  /**
   * 各ノードのレベル（深さ）を計算
   */
  private calculateLevels(): void {
    const inDegrees = new Map<string, number>();

    // 初期入次数をコピー
    for (const [id, node] of this.nodes) {
      inDegrees.set(id, node.inDegree);
    }

    // 入次数が0のノードから開始
    let currentLevel = 0;
    let remaining = new Set(this.nodes.keys());

    while (remaining.size > 0) {
      const currentLevelNodes: string[] = [];

      for (const id of remaining) {
        if (inDegrees.get(id) === 0) {
          currentLevelNodes.push(id);
        }
      }

      if (currentLevelNodes.length === 0) {
        // 循環があるか、すべて処理済み
        break;
      }

      for (const id of currentLevelNodes) {
        const node = this.nodes.get(id)!;
        node.level = currentLevel;
        remaining.delete(id);

        // 依存先の入次数を減らす
        const dependents = this.adjacencyList.get(id);
        if (dependents) {
          for (const dep of dependents) {
            inDegrees.set(dep, (inDegrees.get(dep) || 0) - 1);
          }
        }
      }

      currentLevel++;
    }
  }

  // ========================================
  // Critical Path Calculation
  // ========================================

  /**
   * 最早開始時間を計算
   */
  private calculateEarliestStartTimes(): void {
    const sorted = this.topologicalSort();

    for (const taskId of sorted) {
      const node = this.nodes.get(taskId)!;
      const dependencies = this.reverseAdjacencyList.get(taskId);

      if (dependencies && dependencies.size > 0) {
        let maxTime = 0;
        for (const depId of dependencies) {
          const depNode = this.nodes.get(depId)!;
          const duration = COMPLEXITY_DURATION[depNode.task.estimatedComplexity];
          maxTime = Math.max(maxTime, depNode.earliestStart + duration);
        }
        node.earliestStart = maxTime;
      } else {
        node.earliestStart = 0;
      }
    }
  }

  /**
   * 最遅開始時間を計算
   */
  private calculateLatestStartTimes(): void {
    const sorted = this.topologicalSort().reverse();

    // まず最大完了時間を計算
    let maxCompletionTime = 0;
    for (const node of this.nodes.values()) {
      const duration = COMPLEXITY_DURATION[node.task.estimatedComplexity];
      maxCompletionTime = Math.max(maxCompletionTime, node.earliestStart + duration);
    }

    // 逆順で最遅開始時間を計算
    for (const taskId of sorted) {
      const node = this.nodes.get(taskId)!;
      const dependents = this.adjacencyList.get(taskId);
      const duration = COMPLEXITY_DURATION[node.task.estimatedComplexity];

      if (dependents && dependents.size > 0) {
        let minTime = Infinity;
        for (const depId of dependents) {
          const depNode = this.nodes.get(depId)!;
          minTime = Math.min(minTime, depNode.latestStart);
        }
        node.latestStart = minTime - duration;
      } else {
        node.latestStart = maxCompletionTime - duration;
      }
    }
  }

  /**
   * スラック（余裕時間）を計算
   */
  private calculateSlack(): void {
    for (const node of this.nodes.values()) {
      node.slack = node.latestStart - node.earliestStart;
    }
  }

  /**
   * クリティカルパスを取得
   */
  getCriticalPath(): CriticalPathInfo {
    // スラックが0のタスクがクリティカルパス上にある
    const criticalTasks: GraphNode[] = [];

    for (const node of this.nodes.values()) {
      if (node.slack === 0) {
        criticalTasks.push(node);
      }
    }

    // 最早開始時間でソート
    criticalTasks.sort((a, b) => a.earliestStart - b.earliestStart);

    const path = criticalTasks.map((n) => n.id);
    const tasks = criticalTasks.map((n) => n.task);

    // 総所要時間を計算
    let totalDuration = 0;
    for (const node of criticalTasks) {
      totalDuration += COMPLEXITY_DURATION[node.task.estimatedComplexity];
    }

    return { path, totalDuration, tasks };
  }

  // ========================================
  // Topological Sort
  // ========================================

  /**
   * トポロジカルソートを実行
   */
  topologicalSort(): string[] {
    const result: string[] = [];
    const inDegrees = new Map<string, number>();
    const queue: string[] = [];

    // 入次数をコピー
    for (const [id, node] of this.nodes) {
      inDegrees.set(id, node.inDegree);
      if (node.inDegree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      // 優先度でソート（同じレベルならpriorityで）
      queue.sort((a, b) => {
        const nodeA = this.nodes.get(a)!;
        const nodeB = this.nodes.get(b)!;
        return nodeA.task.priority - nodeB.task.priority;
      });

      const current = queue.shift()!;
      result.push(current);

      const neighbors = this.adjacencyList.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          const newDegree = (inDegrees.get(neighbor) || 0) - 1;
          inDegrees.set(neighbor, newDegree);
          if (newDegree === 0) {
            queue.push(neighbor);
          }
        }
      }
    }

    return result;
  }

  /**
   * トポロジカルソートされたタスクを取得
   */
  getSortedTasks(): DecomposedTask[] {
    return this.topologicalSort().map((id) => this.nodes.get(id)!.task);
  }

  // ========================================
  // Parallel Groups
  // ========================================

  /**
   * 並列実行可能なグループを取得
   */
  getParallelGroups(): ParallelGroup[] {
    const groups: ParallelGroup[] = [];
    const maxLevel = Math.max(...Array.from(this.nodes.values()).map((n) => n.level));

    for (let level = 0; level <= maxLevel; level++) {
      const tasksAtLevel = Array.from(this.nodes.values())
        .filter((n) => n.level === level)
        .map((n) => n.task);

      if (tasksAtLevel.length > 0) {
        // このレベルの最大所要時間を計算
        const estimatedDuration = Math.max(
          ...tasksAtLevel.map((t) => COMPLEXITY_DURATION[t.estimatedComplexity])
        );

        groups.push({
          level,
          tasks: tasksAtLevel,
          maxConcurrency: tasksAtLevel.length,
          estimatedDuration,
        });
      }
    }

    return groups;
  }

  /**
   * 指定されたWorker数に最適化された実行グループを取得
   */
  getOptimizedGroups(maxWorkers: number): ParallelGroup[] {
    const baseGroups = this.getParallelGroups();
    const optimizedGroups: ParallelGroup[] = [];

    for (const group of baseGroups) {
      if (group.tasks.length <= maxWorkers) {
        // そのまま実行可能
        optimizedGroups.push({ ...group, maxConcurrency: Math.min(group.tasks.length, maxWorkers) });
      } else {
        // 分割が必要
        const batches = this.splitIntoBatches(group.tasks, maxWorkers);
        for (let i = 0; i < batches.length; i++) {
          optimizedGroups.push({
            level: group.level + i * 0.1, // サブレベルを割り当て
            tasks: batches[i],
            maxConcurrency: maxWorkers,
            estimatedDuration: Math.max(
              ...batches[i].map((t) => COMPLEXITY_DURATION[t.estimatedComplexity])
            ),
          });
        }
      }
    }

    return optimizedGroups;
  }

  /**
   * タスクをバッチに分割
   */
  private splitIntoBatches(tasks: DecomposedTask[], batchSize: number): DecomposedTask[][] {
    const batches: DecomposedTask[][] = [];

    // 優先度と複雑度でソート（負荷分散のため）
    const sorted = [...tasks].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return COMPLEXITY_DURATION[b.estimatedComplexity] - COMPLEXITY_DURATION[a.estimatedComplexity];
    });

    for (let i = 0; i < sorted.length; i += batchSize) {
      batches.push(sorted.slice(i, i + batchSize));
    }

    return batches;
  }

  // ========================================
  // Graph Analysis
  // ========================================

  /**
   * グラフの完全な分析を実行
   */
  analyze(): GraphAnalysis {
    const criticalPath = this.getCriticalPath();
    const parallelGroups = this.getParallelGroups();

    // ボトルネックの特定（入次数と出次数が高いノード）
    const bottlenecks = this.findBottlenecks();

    // 孤立したタスクの特定
    const isolatedTasks = this.findIsolatedTasks();

    const maxDepth = Math.max(...Array.from(this.nodes.values()).map((n) => n.level), 0);

    const analysis: GraphAnalysis = {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
      maxDepth,
      criticalPath,
      parallelGroups,
      bottlenecks,
      isolatedTasks,
    };

    this.emit('analysis:completed', analysis);

    return analysis;
  }

  /**
   * ボトルネックとなるタスクを特定
   */
  private findBottlenecks(): string[] {
    const bottlenecks: string[] = [];

    for (const [id, node] of this.nodes) {
      // 多くのタスクが依存している、または多くの依存先を持つタスク
      if (node.dependents.size >= 3 || node.dependencies.size >= 3) {
        bottlenecks.push(id);
      }
    }

    return bottlenecks;
  }

  /**
   * 孤立したタスクを特定
   */
  private findIsolatedTasks(): string[] {
    const isolated: string[] = [];

    for (const [id, node] of this.nodes) {
      if (node.inDegree === 0 && node.outDegree === 0 && this.nodes.size > 1) {
        isolated.push(id);
      }
    }

    return isolated;
  }

  // ========================================
  // Query Methods
  // ========================================

  /**
   * 特定のタスクの情報を取得
   */
  getNode(taskId: string): GraphNode | undefined {
    return this.nodes.get(taskId);
  }

  /**
   * 依存関係が満たされているか確認
   */
  areDependenciesSatisfied(taskId: string, completedTasks: Set<string>): boolean {
    const node = this.nodes.get(taskId);
    if (!node) return false;

    for (const dep of node.dependencies) {
      if (!completedTasks.has(dep)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 実行可能なタスクを取得
   */
  getReadyTasks(completedTasks: Set<string>): DecomposedTask[] {
    const ready: DecomposedTask[] = [];

    for (const [id, node] of this.nodes) {
      if (completedTasks.has(id)) continue;

      if (this.areDependenciesSatisfied(id, completedTasks)) {
        ready.push(node.task);
      }
    }

    // 優先度でソート
    return ready.sort((a, b) => a.priority - b.priority);
  }

  /**
   * タスクの子孫（依存しているタスク）を取得
   */
  getDescendants(taskId: string): string[] {
    const descendants: string[] = [];
    const visited = new Set<string>();
    const stack = [taskId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const dependents = this.adjacencyList.get(current);

      if (dependents) {
        for (const dep of dependents) {
          if (!visited.has(dep)) {
            visited.add(dep);
            descendants.push(dep);
            stack.push(dep);
          }
        }
      }
    }

    return descendants;
  }

  /**
   * タスクの祖先（依存元のタスク）を取得
   */
  getAncestors(taskId: string): string[] {
    const ancestors: string[] = [];
    const visited = new Set<string>();
    const stack = [taskId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const dependencies = this.reverseAdjacencyList.get(current);

      if (dependencies) {
        for (const dep of dependencies) {
          if (!visited.has(dep)) {
            visited.add(dep);
            ancestors.push(dep);
            stack.push(dep);
          }
        }
      }
    }

    return ancestors;
  }

  // ========================================
  // Visualization
  // ========================================

  /**
   * グラフを文字列として可視化
   */
  toString(): string {
    const lines: string[] = ['Dependency Graph:', ''];

    const sorted = this.topologicalSort();

    for (const id of sorted) {
      const node = this.nodes.get(id)!;
      const deps = Array.from(node.dependencies).join(', ') || 'none';
      const dependents = Array.from(node.dependents).join(', ') || 'none';

      lines.push(`[${id}] ${node.task.description}`);
      lines.push(`  Level: ${node.level}, Priority: ${node.task.priority}`);
      lines.push(`  Dependencies: ${deps}`);
      lines.push(`  Dependents: ${dependents}`);
      lines.push(`  ES: ${node.earliestStart}, LS: ${node.latestStart}, Slack: ${node.slack}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * DOT形式でエクスポート（Graphviz用）
   */
  toDot(): string {
    const lines: string[] = ['digraph G {', '  rankdir=TB;'];

    // ノード
    for (const [id, node] of this.nodes) {
      const color = node.slack === 0 ? 'red' : 'black';
      const label = `${id}\\n${node.task.description.substring(0, 20)}...`;
      lines.push(`  "${id}" [label="${label}" color="${color}"];`);
    }

    // エッジ
    for (const edge of this.edges) {
      lines.push(`  "${edge.from}" -> "${edge.to}";`);
    }

    lines.push('}');
    return lines.join('\n');
  }
}

// ========================================
// Factory Functions
// ========================================

/**
 * 依存関係グラフを作成
 */
export function createDependencyGraph(): DependencyGraph {
  return new DependencyGraph();
}

/**
 * タスクリストから依存関係グラフを構築
 */
export function buildDependencyGraph(tasks: DecomposedTask[]): DependencyGraph {
  const graph = new DependencyGraph();
  graph.buildFromTasks(tasks);
  return graph;
}
