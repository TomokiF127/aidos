/**
 * 要件トレーサビリティマトリクス
 *
 * 要件から受け入れ条件への変換、実装箇所の紐付け、検証方法の管理
 * - 要件→受け入れ条件への変換
 * - 実装箇所の紐付け
 * - 検証方法の管理
 * - 要件マトリクスの出力（YAML/Markdown）
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';

// ========================================
// Types
// ========================================

/**
 * 要件検証ステータス
 */
export type VerificationStatus = 'verified' | 'failed' | 'pending';

/**
 * 要件優先度
 */
export type RequirementPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * 要件カテゴリ
 */
export type RequirementCategory =
  | 'functional'
  | 'non-functional'
  | 'performance'
  | 'security'
  | 'usability'
  | 'reliability'
  | 'maintainability';

/**
 * 実装情報
 */
export interface Implementation {
  /** 実装ファイルパス */
  files: string[];
  /** 実装関数/メソッド名 */
  functions: string[];
  /** 実装クラス名 */
  classes?: string[];
  /** 実装コメント */
  notes?: string;
}

/**
 * 検証情報
 */
export interface Verification {
  /** テストファイルパス */
  testFiles: string[];
  /** 検証コマンド */
  commands: string[];
  /** 検証方法の説明 */
  description?: string;
  /** 自動検証可能か */
  automated: boolean;
}

/**
 * 検証結果
 */
export interface VerificationResult {
  /** 検証ステータス */
  status: VerificationStatus;
  /** エビデンス（ログ、スクリーンショットパスなど） */
  evidence?: string;
  /** 検証日時 */
  verifiedAt?: Date;
  /** 検証者 */
  verifiedBy?: string;
  /** 検証コメント */
  comment?: string;
}

/**
 * 要件インターフェース
 */
export interface Requirement {
  /** 要件ID */
  id: string;
  /** 要件説明 */
  description: string;
  /** 受け入れ条件 */
  acceptanceCriteria: string[];
  /** 優先度 */
  priority: RequirementPriority;
  /** カテゴリ */
  category: RequirementCategory;
  /** 実装情報 */
  implementation: Implementation;
  /** 検証情報 */
  verification: Verification;
  /** 検証結果 */
  result: VerificationResult;
  /** 親要件ID（階層構造用） */
  parentId?: string;
  /** タグ */
  tags?: string[];
  /** 作成日時 */
  createdAt: Date;
  /** 更新日時 */
  updatedAt: Date;
}

/**
 * 要件マトリクスサマリー
 */
export interface RequirementsMatrixSummary {
  /** 総要件数 */
  total: number;
  /** 検証済み数 */
  verified: number;
  /** 失敗数 */
  failed: number;
  /** 保留中数 */
  pending: number;
  /** カテゴリ別集計 */
  byCategory: Record<RequirementCategory, number>;
  /** 優先度別集計 */
  byPriority: Record<RequirementPriority, number>;
  /** 検証カバレッジ（%） */
  coverage: number;
}

/**
 * 要件マトリクス
 */
export interface RequirementsMatrix {
  /** プロジェクト名 */
  projectName: string;
  /** バージョン */
  version: string;
  /** 要件一覧 */
  requirements: Requirement[];
  /** サマリー */
  summary: RequirementsMatrixSummary;
  /** 生成日時 */
  generatedAt: Date;
}

/**
 * 要件マネージャーオプション
 */
export interface RequirementsManagerOptions {
  /** 要件ファイルパス */
  requirementsFilePath?: string;
  /** 自動保存有効化 */
  autoSave?: boolean;
  /** 保存先ディレクトリ */
  outputDirectory?: string;
}

/**
 * 要件フィルター
 */
export interface RequirementFilter {
  status?: VerificationStatus;
  priority?: RequirementPriority;
  category?: RequirementCategory;
  tags?: string[];
  searchText?: string;
}

/**
 * 要件マネージャーイベント
 */
export type RequirementsManagerEvent =
  | 'requirement:added'
  | 'requirement:updated'
  | 'requirement:removed'
  | 'requirement:verified'
  | 'matrix:exported'
  | 'matrix:imported';

// ========================================
// RequirementsManager Class
// ========================================

/**
 * 要件トレーサビリティマネージャー
 * シングルトンパターン実装
 */
export class RequirementsManager extends EventEmitter {
  private requirements: Map<string, Requirement> = new Map();
  private options: Required<RequirementsManagerOptions>;
  private projectName: string = 'AIDOS';
  private version: string = '1.0.0';

  private constructor(options: RequirementsManagerOptions = {}) {
    super();
    this.options = {
      requirementsFilePath: options.requirementsFilePath ?? './requirements.yaml',
      autoSave: options.autoSave ?? false,
      outputDirectory: options.outputDirectory ?? './output/requirements',
    };
  }

  // ========================================
  // Singleton
  // ========================================

  private static instance: RequirementsManager | null = null;

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(options?: RequirementsManagerOptions): RequirementsManager {
    if (!RequirementsManager.instance) {
      RequirementsManager.instance = new RequirementsManager(options);
    }
    return RequirementsManager.instance;
  }

  /**
   * インスタンスをリセット（テスト用）
   */
  static resetInstance(): void {
    RequirementsManager.instance = null;
  }

  // ========================================
  // Configuration
  // ========================================

  /**
   * プロジェクト情報を設定
   */
  setProjectInfo(projectName: string, version: string): void {
    this.projectName = projectName;
    this.version = version;
  }

  /**
   * オプションを更新
   */
  updateOptions(options: Partial<RequirementsManagerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  // ========================================
  // Requirement CRUD
  // ========================================

  /**
   * 要件を追加
   */
  addRequirement(requirement: Omit<Requirement, 'createdAt' | 'updatedAt'>): Requirement {
    const now = new Date();
    const fullRequirement: Requirement = {
      ...requirement,
      createdAt: now,
      updatedAt: now,
    };

    if (this.requirements.has(requirement.id)) {
      throw new Error(`Requirement with id "${requirement.id}" already exists`);
    }

    this.requirements.set(requirement.id, fullRequirement);

    this.emit('requirement:added', { requirement: fullRequirement });

    if (this.options.autoSave) {
      void this.saveToFile();
    }

    return fullRequirement;
  }

  /**
   * 要件を更新
   */
  updateRequirement(
    id: string,
    updates: Partial<Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>>
  ): Requirement {
    const existing = this.requirements.get(id);
    if (!existing) {
      throw new Error(`Requirement with id "${id}" not found`);
    }

    const updated: Requirement = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    this.requirements.set(id, updated);

    this.emit('requirement:updated', { requirement: updated, changes: updates });

    if (this.options.autoSave) {
      void this.saveToFile();
    }

    return updated;
  }

  /**
   * 要件を削除
   */
  removeRequirement(id: string): boolean {
    const requirement = this.requirements.get(id);
    if (!requirement) {
      return false;
    }

    this.requirements.delete(id);

    this.emit('requirement:removed', { requirement });

    if (this.options.autoSave) {
      void this.saveToFile();
    }

    return true;
  }

  /**
   * 要件を取得
   */
  getRequirement(id: string): Requirement | undefined {
    return this.requirements.get(id);
  }

  /**
   * 全要件を取得
   */
  getAllRequirements(): Requirement[] {
    return Array.from(this.requirements.values());
  }

  /**
   * フィルタリングされた要件を取得
   */
  filterRequirements(filter: RequirementFilter): Requirement[] {
    let results = this.getAllRequirements();

    if (filter.status) {
      results = results.filter((r) => r.result.status === filter.status);
    }

    if (filter.priority) {
      results = results.filter((r) => r.priority === filter.priority);
    }

    if (filter.category) {
      results = results.filter((r) => r.category === filter.category);
    }

    if (filter.tags && filter.tags.length > 0) {
      results = results.filter((r) =>
        filter.tags!.some((tag) => r.tags?.includes(tag))
      );
    }

    if (filter.searchText) {
      const searchLower = filter.searchText.toLowerCase();
      results = results.filter(
        (r) =>
          r.id.toLowerCase().includes(searchLower) ||
          r.description.toLowerCase().includes(searchLower) ||
          r.acceptanceCriteria.some((ac) => ac.toLowerCase().includes(searchLower))
      );
    }

    return results;
  }

  // ========================================
  // Acceptance Criteria Management
  // ========================================

  /**
   * 要件から受け入れ条件を生成/変換
   */
  generateAcceptanceCriteria(
    requirementDescription: string,
    context?: string
  ): string[] {
    // 基本的な受け入れ条件テンプレート
    const criteria: string[] = [];

    // 要件の種類を判別して適切な条件を生成
    const desc = requirementDescription.toLowerCase();

    // 機能要件の場合
    if (desc.includes('機能') || desc.includes('できる') || desc.includes('可能')) {
      criteria.push(`Given: 前提条件が満たされている時`);
      criteria.push(`When: ユーザーが操作を実行した時`);
      criteria.push(`Then: 期待される結果が得られること`);
    }

    // パフォーマンス要件の場合
    if (desc.includes('性能') || desc.includes('速度') || desc.includes('レスポンス')) {
      criteria.push(`処理が指定時間内に完了すること`);
      criteria.push(`システムリソースが許容範囲内であること`);
    }

    // セキュリティ要件の場合
    if (desc.includes('セキュリティ') || desc.includes('認証') || desc.includes('権限')) {
      criteria.push(`認証されたユーザーのみがアクセスできること`);
      criteria.push(`機密情報が適切に保護されていること`);
      criteria.push(`監査ログが記録されること`);
    }

    // エラーハンドリング
    if (desc.includes('エラー') || desc.includes('例外') || desc.includes('異常')) {
      criteria.push(`エラー時に適切なメッセージが表示されること`);
      criteria.push(`システムが異常終了しないこと`);
      criteria.push(`データの整合性が保たれること`);
    }

    // デフォルト条件（何も該当しない場合）
    if (criteria.length === 0) {
      criteria.push(`要件の実装が完了していること`);
      criteria.push(`ユニットテストがパスすること`);
      criteria.push(`ドキュメントが更新されていること`);
    }

    return criteria;
  }

  /**
   * 受け入れ条件を追加
   */
  addAcceptanceCriteria(requirementId: string, criteria: string[]): Requirement {
    const requirement = this.requirements.get(requirementId);
    if (!requirement) {
      throw new Error(`Requirement with id "${requirementId}" not found`);
    }

    const updatedCriteria = [...requirement.acceptanceCriteria, ...criteria];

    return this.updateRequirement(requirementId, {
      acceptanceCriteria: updatedCriteria,
    });
  }

  // ========================================
  // Implementation Tracking
  // ========================================

  /**
   * 実装情報を紐付け
   */
  linkImplementation(
    requirementId: string,
    implementation: Partial<Implementation>
  ): Requirement {
    const requirement = this.requirements.get(requirementId);
    if (!requirement) {
      throw new Error(`Requirement with id "${requirementId}" not found`);
    }

    const updatedImplementation: Implementation = {
      files: [...(requirement.implementation.files || []), ...(implementation.files || [])],
      functions: [
        ...(requirement.implementation.functions || []),
        ...(implementation.functions || []),
      ],
      classes: [
        ...(requirement.implementation.classes || []),
        ...(implementation.classes || []),
      ],
      notes: implementation.notes ?? requirement.implementation.notes,
    };

    // 重複を除去
    updatedImplementation.files = [...new Set(updatedImplementation.files)];
    updatedImplementation.functions = [...new Set(updatedImplementation.functions)];
    updatedImplementation.classes = [...new Set(updatedImplementation.classes)];

    return this.updateRequirement(requirementId, {
      implementation: updatedImplementation,
    });
  }

  /**
   * 実装ファイルから関連要件を検索
   */
  findRequirementsByFile(filePath: string): Requirement[] {
    return this.getAllRequirements().filter((r) =>
      r.implementation.files.some((f) => f.includes(filePath) || filePath.includes(f))
    );
  }

  // ========================================
  // Verification Management
  // ========================================

  /**
   * 検証情報を設定
   */
  setVerification(
    requirementId: string,
    verification: Partial<Verification>
  ): Requirement {
    const requirement = this.requirements.get(requirementId);
    if (!requirement) {
      throw new Error(`Requirement with id "${requirementId}" not found`);
    }

    const updatedVerification: Verification = {
      testFiles: verification.testFiles ?? requirement.verification.testFiles,
      commands: verification.commands ?? requirement.verification.commands,
      description: verification.description ?? requirement.verification.description,
      automated: verification.automated ?? requirement.verification.automated,
    };

    return this.updateRequirement(requirementId, {
      verification: updatedVerification,
    });
  }

  /**
   * 検証結果を記録
   */
  recordVerificationResult(
    requirementId: string,
    result: VerificationResult
  ): Requirement {
    const requirement = this.requirements.get(requirementId);
    if (!requirement) {
      throw new Error(`Requirement with id "${requirementId}" not found`);
    }

    const updated = this.updateRequirement(requirementId, {
      result: {
        ...result,
        verifiedAt: result.verifiedAt ?? new Date(),
      },
    });

    this.emit('requirement:verified', { requirement: updated, result });

    return updated;
  }

  /**
   * 要件を検証済みにマーク
   */
  markAsVerified(
    requirementId: string,
    evidence?: string,
    verifiedBy?: string
  ): Requirement {
    return this.recordVerificationResult(requirementId, {
      status: 'verified',
      evidence,
      verifiedBy,
      verifiedAt: new Date(),
    });
  }

  /**
   * 要件を失敗にマーク
   */
  markAsFailed(
    requirementId: string,
    comment?: string,
    verifiedBy?: string
  ): Requirement {
    return this.recordVerificationResult(requirementId, {
      status: 'failed',
      comment,
      verifiedBy,
      verifiedAt: new Date(),
    });
  }

  // ========================================
  // Matrix Generation
  // ========================================

  /**
   * サマリーを計算
   */
  calculateSummary(): RequirementsMatrixSummary {
    const requirements = this.getAllRequirements();
    const total = requirements.length;

    const verified = requirements.filter((r) => r.result.status === 'verified').length;
    const failed = requirements.filter((r) => r.result.status === 'failed').length;
    const pending = requirements.filter((r) => r.result.status === 'pending').length;

    const byCategory: Record<RequirementCategory, number> = {
      functional: 0,
      'non-functional': 0,
      performance: 0,
      security: 0,
      usability: 0,
      reliability: 0,
      maintainability: 0,
    };

    const byPriority: Record<RequirementPriority, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const req of requirements) {
      byCategory[req.category]++;
      byPriority[req.priority]++;
    }

    const coverage = total > 0 ? Math.round((verified / total) * 100) : 0;

    return {
      total,
      verified,
      failed,
      pending,
      byCategory,
      byPriority,
      coverage,
    };
  }

  /**
   * 要件マトリクスを生成
   */
  generateMatrix(): RequirementsMatrix {
    return {
      projectName: this.projectName,
      version: this.version,
      requirements: this.getAllRequirements(),
      summary: this.calculateSummary(),
      generatedAt: new Date(),
    };
  }

  // ========================================
  // Export/Import
  // ========================================

  /**
   * YAMLとして出力
   */
  exportToYaml(): string {
    const matrix = this.generateMatrix();

    // Dateを文字列に変換
    const serializable = this.serializeForExport(matrix);

    return yamlStringify(serializable, {
      indent: 2,
      lineWidth: 120,
    });
  }

  /**
   * Markdownとして出力
   */
  exportToMarkdown(): string {
    const matrix = this.generateMatrix();
    const lines: string[] = [];

    // ヘッダー
    lines.push(`# 要件トレーサビリティマトリクス`);
    lines.push('');
    lines.push(`**プロジェクト:** ${matrix.projectName}`);
    lines.push(`**バージョン:** ${matrix.version}`);
    lines.push(`**生成日時:** ${matrix.generatedAt.toISOString()}`);
    lines.push('');

    // サマリー
    lines.push('## サマリー');
    lines.push('');
    lines.push('| 項目 | 数 |');
    lines.push('|------|-----|');
    lines.push(`| 総要件数 | ${matrix.summary.total} |`);
    lines.push(`| 検証済み | ${matrix.summary.verified} |`);
    lines.push(`| 失敗 | ${matrix.summary.failed} |`);
    lines.push(`| 保留中 | ${matrix.summary.pending} |`);
    lines.push(`| カバレッジ | ${matrix.summary.coverage}% |`);
    lines.push('');

    // 優先度別
    lines.push('### 優先度別');
    lines.push('');
    lines.push('| 優先度 | 数 |');
    lines.push('|--------|-----|');
    for (const [priority, count] of Object.entries(matrix.summary.byPriority)) {
      lines.push(`| ${priority} | ${count} |`);
    }
    lines.push('');

    // カテゴリ別
    lines.push('### カテゴリ別');
    lines.push('');
    lines.push('| カテゴリ | 数 |');
    lines.push('|----------|-----|');
    for (const [category, count] of Object.entries(matrix.summary.byCategory)) {
      if (count > 0) {
        lines.push(`| ${category} | ${count} |`);
      }
    }
    lines.push('');

    // 要件一覧
    lines.push('## 要件一覧');
    lines.push('');

    for (const req of matrix.requirements) {
      lines.push(`### ${req.id}: ${req.description}`);
      lines.push('');
      lines.push(`- **優先度:** ${req.priority}`);
      lines.push(`- **カテゴリ:** ${req.category}`);
      lines.push(`- **ステータス:** ${this.getStatusEmoji(req.result.status)} ${req.result.status}`);
      lines.push('');

      // 受け入れ条件
      lines.push('#### 受け入れ条件');
      lines.push('');
      for (const ac of req.acceptanceCriteria) {
        lines.push(`- ${ac}`);
      }
      lines.push('');

      // 実装
      if (req.implementation.files.length > 0 || req.implementation.functions.length > 0) {
        lines.push('#### 実装');
        lines.push('');
        if (req.implementation.files.length > 0) {
          lines.push('**ファイル:**');
          for (const file of req.implementation.files) {
            lines.push(`- \`${file}\``);
          }
        }
        if (req.implementation.functions.length > 0) {
          lines.push('');
          lines.push('**関数:**');
          for (const func of req.implementation.functions) {
            lines.push(`- \`${func}\``);
          }
        }
        lines.push('');
      }

      // 検証
      if (req.verification.testFiles.length > 0 || req.verification.commands.length > 0) {
        lines.push('#### 検証');
        lines.push('');
        if (req.verification.testFiles.length > 0) {
          lines.push('**テストファイル:**');
          for (const testFile of req.verification.testFiles) {
            lines.push(`- \`${testFile}\``);
          }
        }
        if (req.verification.commands.length > 0) {
          lines.push('');
          lines.push('**コマンド:**');
          for (const cmd of req.verification.commands) {
            lines.push(`\`\`\`bash`);
            lines.push(cmd);
            lines.push(`\`\`\``);
          }
        }
        lines.push('');
      }

      // 検証結果
      if (req.result.verifiedAt) {
        lines.push('#### 検証結果');
        lines.push('');
        lines.push(`- **検証日時:** ${req.result.verifiedAt.toISOString()}`);
        if (req.result.verifiedBy) {
          lines.push(`- **検証者:** ${req.result.verifiedBy}`);
        }
        if (req.result.evidence) {
          lines.push(`- **エビデンス:** ${req.result.evidence}`);
        }
        if (req.result.comment) {
          lines.push(`- **コメント:** ${req.result.comment}`);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * ファイルに保存
   */
  async saveToFile(filePath?: string): Promise<void> {
    const outputPath = filePath ?? this.options.requirementsFilePath;

    // ディレクトリを作成
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    const content = this.exportToYaml();
    await fs.writeFile(outputPath, content, 'utf-8');
  }

  /**
   * Markdownファイルに保存
   */
  async saveToMarkdown(filePath?: string): Promise<void> {
    const outputPath =
      filePath ?? path.join(this.options.outputDirectory, 'requirements-matrix.md');

    // ディレクトリを作成
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    const content = this.exportToMarkdown();
    await fs.writeFile(outputPath, content, 'utf-8');

    this.emit('matrix:exported', { format: 'markdown', path: outputPath });
  }

  /**
   * ファイルから読み込み
   */
  async loadFromFile(filePath?: string): Promise<void> {
    const inputPath = filePath ?? this.options.requirementsFilePath;

    const content = await fs.readFile(inputPath, 'utf-8');
    const data = yamlParse(content) as {
      projectName?: string;
      version?: string;
      requirements?: Array<Record<string, unknown>>;
    };

    this.requirements.clear();

    if (data.projectName) {
      this.projectName = data.projectName;
    }
    if (data.version) {
      this.version = data.version;
    }

    if (data.requirements && Array.isArray(data.requirements)) {
      for (const req of data.requirements) {
        const requirement = this.deserializeRequirement(req);
        this.requirements.set(requirement.id, requirement);
      }
    }

    this.emit('matrix:imported', { path: inputPath, count: this.requirements.size });
  }

  // ========================================
  // Private Helpers
  // ========================================

  private getStatusEmoji(status: VerificationStatus): string {
    switch (status) {
      case 'verified':
        return '[x]';
      case 'failed':
        return '[!]';
      case 'pending':
        return '[ ]';
    }
  }

  private serializeForExport(matrix: RequirementsMatrix): Record<string, unknown> {
    return {
      projectName: matrix.projectName,
      version: matrix.version,
      generatedAt: matrix.generatedAt.toISOString(),
      summary: matrix.summary,
      requirements: matrix.requirements.map((req) => ({
        ...req,
        createdAt: req.createdAt.toISOString(),
        updatedAt: req.updatedAt.toISOString(),
        result: {
          ...req.result,
          verifiedAt: req.result.verifiedAt?.toISOString(),
        },
      })),
    };
  }

  private deserializeRequirement(data: Record<string, unknown>): Requirement {
    const result = data.result as Record<string, unknown> | undefined;

    return {
      id: data.id as string,
      description: data.description as string,
      acceptanceCriteria: (data.acceptanceCriteria as string[]) ?? [],
      priority: (data.priority as RequirementPriority) ?? 'medium',
      category: (data.category as RequirementCategory) ?? 'functional',
      implementation: (data.implementation as Implementation) ?? {
        files: [],
        functions: [],
      },
      verification: (data.verification as Verification) ?? {
        testFiles: [],
        commands: [],
        automated: false,
      },
      result: {
        status: (result?.status as VerificationStatus) ?? 'pending',
        evidence: result?.evidence as string | undefined,
        verifiedAt: result?.verifiedAt
          ? new Date(result.verifiedAt as string)
          : undefined,
        verifiedBy: result?.verifiedBy as string | undefined,
        comment: result?.comment as string | undefined,
      },
      parentId: data.parentId as string | undefined,
      tags: data.tags as string[] | undefined,
      createdAt: data.createdAt ? new Date(data.createdAt as string) : new Date(),
      updatedAt: data.updatedAt ? new Date(data.updatedAt as string) : new Date(),
    };
  }

  /**
   * 要件の数を取得
   */
  get count(): number {
    return this.requirements.size;
  }

  /**
   * 全要件をクリア
   */
  clear(): void {
    this.requirements.clear();
  }
}

// ========================================
// Convenience Functions
// ========================================

/**
 * RequirementsManagerのシングルトンインスタンスを取得
 */
export function getRequirementsManager(
  options?: RequirementsManagerOptions
): RequirementsManager {
  return RequirementsManager.getInstance(options);
}

/**
 * RequirementsManagerインスタンスをリセット（テスト用）
 */
export function resetRequirementsManager(): void {
  RequirementsManager.resetInstance();
}

/**
 * 新しい要件を作成するヘルパー
 */
export function createRequirement(
  id: string,
  description: string,
  options: {
    acceptanceCriteria?: string[];
    priority?: RequirementPriority;
    category?: RequirementCategory;
    files?: string[];
    functions?: string[];
    testFiles?: string[];
    commands?: string[];
    tags?: string[];
  } = {}
): Omit<Requirement, 'createdAt' | 'updatedAt'> {
  return {
    id,
    description,
    acceptanceCriteria: options.acceptanceCriteria ?? [],
    priority: options.priority ?? 'medium',
    category: options.category ?? 'functional',
    implementation: {
      files: options.files ?? [],
      functions: options.functions ?? [],
    },
    verification: {
      testFiles: options.testFiles ?? [],
      commands: options.commands ?? [],
      automated: (options.testFiles?.length ?? 0) > 0 || (options.commands?.length ?? 0) > 0,
    },
    result: {
      status: 'pending',
    },
    tags: options.tags,
  };
}
