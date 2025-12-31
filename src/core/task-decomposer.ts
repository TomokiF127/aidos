/**
 * タスク分解エンジン
 *
 * 目的（objective）を受け取り、実行可能なタスクリストに分解する。
 * モック版とAPI版の両方をサポート。
 */

import { EventEmitter } from 'events';
import {
  DecomposedTask,
  TaskCategory,
  AidosConfig,
  DEFAULT_CONFIG,
} from '../types.js';

// ========================================
// Types
// ========================================

/**
 * タスク分解の結果
 */
export interface DecomposeResult {
  objective: string;
  reasoning: string;
  tasks: DecomposedTask[];
  metadata: DecomposeMetadata;
}

/**
 * 分解メタデータ
 */
export interface DecomposeMetadata {
  mode: 'mock' | 'api';
  tokensUsed: number;
  processingTimeMs: number;
  modelUsed?: string;
}

/**
 * タスク分解イベント
 */
export type DecomposerEvent =
  | 'decompose:start'
  | 'decompose:progress'
  | 'decompose:complete'
  | 'decompose:error';

/**
 * タスク分解オプション
 */
export interface DecomposeOptions {
  useApi?: boolean;
  maxTasks?: number;
  preferredCategories?: TaskCategory[];
  context?: string;
}

// ========================================
// Mock Data
// ========================================

/**
 * モックタスク分解データベース
 * pocのデータを拡張して使用
 */
const MOCK_DECOMPOSITIONS: Record<string, DecomposeResult> = {
  login: {
    objective: 'Webアプリのログイン機能を作成する',
    reasoning:
      'ログイン機能は認証フロー、UI、セキュリティの3つの観点から分解。依存関係を考慮し、データモデル→API→UIの順序で実装。',
    tasks: [
      {
        id: 'T1',
        description: 'ユーザーデータモデル設計',
        category: 'design',
        dependencies: [],
        priority: 1,
        estimatedComplexity: 'low',
      },
      {
        id: 'T2',
        description: '認証APIエンドポイント実装',
        category: 'implement',
        dependencies: ['T1'],
        priority: 1,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T3',
        description: 'パスワードハッシュ化実装',
        category: 'implement',
        dependencies: ['T1'],
        priority: 1,
        estimatedComplexity: 'low',
      },
      {
        id: 'T4',
        description: 'JWTトークン生成・検証',
        category: 'implement',
        dependencies: ['T2'],
        priority: 2,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T5',
        description: 'ログインフォームUI作成',
        category: 'implement',
        dependencies: ['T2'],
        priority: 2,
        estimatedComplexity: 'low',
      },
      {
        id: 'T6',
        description: 'セッション管理実装',
        category: 'implement',
        dependencies: ['T4'],
        priority: 3,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T7',
        description: '認証ミドルウェア作成',
        category: 'implement',
        dependencies: ['T4'],
        priority: 3,
        estimatedComplexity: 'low',
      },
      {
        id: 'T8',
        description: '単体テスト作成',
        category: 'test',
        dependencies: ['T2', 'T3', 'T4'],
        priority: 4,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T9',
        description: 'E2Eテスト作成',
        category: 'test',
        dependencies: ['T5', 'T6'],
        priority: 5,
        estimatedComplexity: 'high',
      },
    ],
    metadata: { mode: 'mock', tokensUsed: 0, processingTimeMs: 0 },
  },
  pagination: {
    objective: 'REST APIにページネーション機能を追加する',
    reasoning:
      'ページネーションはクエリパラメータ設計、DB最適化、レスポンス形式の標準化が必要。',
    tasks: [
      {
        id: 'T1',
        description: 'ページネーションパラメータ設計',
        category: 'design',
        dependencies: [],
        priority: 1,
        estimatedComplexity: 'low',
      },
      {
        id: 'T2',
        description: 'クエリビルダー実装',
        category: 'implement',
        dependencies: ['T1'],
        priority: 2,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T3',
        description: 'レスポンスフォーマット定義',
        category: 'design',
        dependencies: ['T1'],
        priority: 2,
        estimatedComplexity: 'low',
      },
      {
        id: 'T4',
        description: '既存エンドポイント改修',
        category: 'implement',
        dependencies: ['T2', 'T3'],
        priority: 3,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T5',
        description: 'インデックス最適化',
        category: 'implement',
        dependencies: ['T2'],
        priority: 3,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T6',
        description: 'テスト作成',
        category: 'test',
        dependencies: ['T4'],
        priority: 4,
        estimatedComplexity: 'low',
      },
    ],
    metadata: { mode: 'mock', tokensUsed: 0, processingTimeMs: 0 },
  },
  profile: {
    objective: 'ユーザープロフィール編集画面を実装する',
    reasoning:
      'プロフィール編集はフォーム設計、バリデーション、画像アップロードの3つの機能に分解。',
    tasks: [
      {
        id: 'T1',
        description: 'プロフィールデータモデル拡張',
        category: 'design',
        dependencies: [],
        priority: 1,
        estimatedComplexity: 'low',
      },
      {
        id: 'T2',
        description: 'プロフィール取得API',
        category: 'implement',
        dependencies: ['T1'],
        priority: 2,
        estimatedComplexity: 'low',
      },
      {
        id: 'T3',
        description: 'プロフィール更新API',
        category: 'implement',
        dependencies: ['T1'],
        priority: 2,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T4',
        description: '画像アップロード機能',
        category: 'implement',
        dependencies: ['T1'],
        priority: 2,
        estimatedComplexity: 'high',
      },
      {
        id: 'T5',
        description: 'バリデーションロジック',
        category: 'implement',
        dependencies: ['T3'],
        priority: 3,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T6',
        description: 'プロフィール編集フォームUI',
        category: 'implement',
        dependencies: ['T2', 'T3'],
        priority: 3,
        estimatedComplexity: 'medium',
      },
      {
        id: 'T7',
        description: '画像プレビュー・クロップUI',
        category: 'implement',
        dependencies: ['T4'],
        priority: 4,
        estimatedComplexity: 'high',
      },
      {
        id: 'T8',
        description: 'テスト作成',
        category: 'test',
        dependencies: ['T3', 'T5'],
        priority: 5,
        estimatedComplexity: 'medium',
      },
    ],
    metadata: { mode: 'mock', tokensUsed: 0, processingTimeMs: 0 },
  },
};

// ========================================
// Task Decomposer Class
// ========================================

/**
 * タスク分解エンジン
 */
export class TaskDecomposer extends EventEmitter {
  private config: AidosConfig;
  private taskCounter: number = 0;

  constructor(config: Partial<AidosConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 目的をタスクリストに分解
   */
  async decompose(
    objective: string,
    options: DecomposeOptions = {}
  ): Promise<DecomposeResult> {
    const startTime = Date.now();
    const useApi = options.useApi ?? false;

    this.emit('decompose:start', { objective, useApi });

    try {
      let result: DecomposeResult;

      if (useApi) {
        result = await this.decomposeWithApi(objective, options);
      } else {
        result = await this.decomposeWithMock(objective, options);
      }

      // タスクIDを一意にする
      result.tasks = this.assignUniqueIds(result.tasks);

      // メタデータを更新
      result.metadata.processingTimeMs = Date.now() - startTime;

      this.emit('decompose:complete', result);

      return result;
    } catch (error) {
      this.emit('decompose:error', { objective, error });
      throw error;
    }
  }

  /**
   * モック版のタスク分解
   */
  private async decomposeWithMock(
    objective: string,
    options: DecomposeOptions
  ): Promise<DecomposeResult> {
    // 進捗をシミュレート
    const steps = ['分析中', '構造化中', '依存関係解析中', '優先度設定中'];
    for (let i = 0; i < steps.length; i++) {
      await this.delay(100); // 実際のUIでは見やすくするため
      this.emit('decompose:progress', {
        step: steps[i],
        progress: ((i + 1) / steps.length) * 100,
      });
    }

    // マッチするモックデータを探す
    const result = this.findBestMatch(objective);

    return {
      ...result,
      objective,
      metadata: {
        mode: 'mock',
        tokensUsed: 0,
        processingTimeMs: 0,
      },
    };
  }

  /**
   * API版のタスク分解（将来の実装用プレースホルダー）
   */
  private async decomposeWithApi(
    objective: string,
    options: DecomposeOptions
  ): Promise<DecomposeResult> {
    // TODO: 実際のClaude API呼び出しを実装
    // 現時点ではモック版にフォールバック
    console.warn('API mode not implemented, falling back to mock');
    return this.decomposeWithMock(objective, options);
  }

  /**
   * 目的に最もマッチするモックデータを探す
   */
  private findBestMatch(objective: string): Omit<DecomposeResult, 'metadata'> {
    const lowerObjective = objective.toLowerCase();

    if (
      lowerObjective.includes('ログイン') ||
      lowerObjective.includes('login') ||
      lowerObjective.includes('認証')
    ) {
      return MOCK_DECOMPOSITIONS['login'];
    }

    if (
      lowerObjective.includes('ページネーション') ||
      lowerObjective.includes('pagination') ||
      lowerObjective.includes('ページ')
    ) {
      return MOCK_DECOMPOSITIONS['pagination'];
    }

    if (
      lowerObjective.includes('プロフィール') ||
      lowerObjective.includes('profile') ||
      lowerObjective.includes('編集')
    ) {
      return MOCK_DECOMPOSITIONS['profile'];
    }

    // デフォルト: 汎用的なタスク分解を生成
    return this.generateGenericDecomposition(objective);
  }

  /**
   * 汎用的なタスク分解を生成
   */
  private generateGenericDecomposition(
    objective: string
  ): Omit<DecomposeResult, 'metadata'> {
    return {
      objective,
      reasoning:
        '汎用的なソフトウェア開発フローに基づいて分解。設計→実装→テストの順序で実行。',
      tasks: [
        {
          id: 'T1',
          description: '要件分析・設計',
          category: 'design',
          dependencies: [],
          priority: 1,
          estimatedComplexity: 'medium',
        },
        {
          id: 'T2',
          description: 'データモデル設計',
          category: 'design',
          dependencies: ['T1'],
          priority: 2,
          estimatedComplexity: 'medium',
        },
        {
          id: 'T3',
          description: 'API設計',
          category: 'design',
          dependencies: ['T2'],
          priority: 2,
          estimatedComplexity: 'medium',
        },
        {
          id: 'T4',
          description: 'バックエンド実装',
          category: 'implement',
          dependencies: ['T2', 'T3'],
          priority: 3,
          estimatedComplexity: 'high',
        },
        {
          id: 'T5',
          description: 'フロントエンド実装',
          category: 'implement',
          dependencies: ['T3'],
          priority: 3,
          estimatedComplexity: 'high',
        },
        {
          id: 'T6',
          description: '単体テスト',
          category: 'test',
          dependencies: ['T4'],
          priority: 4,
          estimatedComplexity: 'medium',
        },
        {
          id: 'T7',
          description: '結合テスト',
          category: 'test',
          dependencies: ['T4', 'T5'],
          priority: 5,
          estimatedComplexity: 'medium',
        },
        {
          id: 'T8',
          description: 'ドキュメント作成',
          category: 'document',
          dependencies: ['T4', 'T5'],
          priority: 5,
          estimatedComplexity: 'low',
        },
      ],
    };
  }

  /**
   * タスクに一意のIDを割り当て
   */
  private assignUniqueIds(tasks: DecomposedTask[]): DecomposedTask[] {
    const idMap = new Map<string, string>();

    // まず新しいIDを生成
    tasks.forEach((task) => {
      const newId = `task_${++this.taskCounter}`;
      idMap.set(task.id, newId);
    });

    // IDと依存関係を更新
    return tasks.map((task) => ({
      ...task,
      id: idMap.get(task.id) || task.id,
      dependencies: task.dependencies.map((dep) => idMap.get(dep) || dep),
    }));
  }

  /**
   * タスクの依存関係グラフを検証
   */
  validateDependencies(tasks: DecomposedTask[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const taskIds = new Set(tasks.map((t) => t.id));

    // 存在しない依存関係をチェック
    tasks.forEach((task) => {
      task.dependencies.forEach((dep) => {
        if (!taskIds.has(dep)) {
          errors.push(
            `Task ${task.id} has invalid dependency: ${dep}`
          );
        }
      });
    });

    // 循環依存をチェック
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (taskId: string): boolean => {
      if (recursionStack.has(taskId)) return true;
      if (visited.has(taskId)) return false;

      visited.add(taskId);
      recursionStack.add(taskId);

      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        for (const dep of task.dependencies) {
          if (hasCycle(dep)) return true;
        }
      }

      recursionStack.delete(taskId);
      return false;
    };

    tasks.forEach((task) => {
      if (hasCycle(task.id)) {
        errors.push(`Circular dependency detected involving task ${task.id}`);
      }
    });

    // 孤立したタスクを警告
    const referencedTasks = new Set<string>();
    tasks.forEach((task) => {
      task.dependencies.forEach((dep) => referencedTasks.add(dep));
    });

    tasks.forEach((task) => {
      if (
        task.dependencies.length === 0 &&
        !referencedTasks.has(task.id) &&
        tasks.length > 1
      ) {
        warnings.push(`Task ${task.id} is isolated (no dependencies)`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * タスクをトポロジカルソートで実行順に並べる
   */
  topologicalSort(tasks: DecomposedTask[]): DecomposedTask[] {
    const result: DecomposedTask[] = [];
    const visited = new Set<string>();
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const task = taskMap.get(taskId);
      if (task) {
        task.dependencies.forEach((dep) => visit(dep));
        result.push(task);
      }
    };

    tasks.forEach((task) => visit(task.id));

    return result;
  }

  /**
   * 並列実行可能なタスクグループを取得
   */
  getParallelGroups(tasks: DecomposedTask[]): DecomposedTask[][] {
    const groups: DecomposedTask[][] = [];
    const completed = new Set<string>();
    const remaining = [...tasks];

    while (remaining.length > 0) {
      // 依存関係が全て完了しているタスクを取得
      const ready = remaining.filter((task) =>
        task.dependencies.every((dep) => completed.has(dep))
      );

      if (ready.length === 0) {
        // 循環依存の可能性
        break;
      }

      groups.push(ready);

      // 完了としてマーク
      ready.forEach((task) => {
        completed.add(task.id);
        const index = remaining.indexOf(task);
        if (index > -1) remaining.splice(index, 1);
      });
    }

    return groups;
  }

  /**
   * 遅延ユーティリティ
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 検証結果
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ========================================
// Singleton Instance
// ========================================

let decomposerInstance: TaskDecomposer | null = null;

/**
 * TaskDecomposerのシングルトンインスタンスを取得
 */
export function getTaskDecomposer(
  config?: Partial<AidosConfig>
): TaskDecomposer {
  if (!decomposerInstance) {
    decomposerInstance = new TaskDecomposer(config);
  }
  return decomposerInstance;
}

/**
 * TaskDecomposerインスタンスをリセット（テスト用）
 */
export function resetTaskDecomposer(): void {
  decomposerInstance = null;
}
