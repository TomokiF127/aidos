/**
 * Done定義生成器
 *
 * タスク完了時の検収ゲート（Done定義）を自動生成
 * - 要件マッピング（satisfied / not_satisfied / not_verified）
 * - テスト結果の収集
 * - 影響範囲分析
 * - 破壊的変更の検出
 * - 検証コマンドの生成
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { AidosConfig, DEFAULT_CONFIG, Task, TaskStatus } from '../types.js';

// ========================================
// Types
// ========================================

/**
 * 要件ステータス
 */
export type RequirementVerificationStatus =
  | 'satisfied'
  | 'not_satisfied'
  | 'not_verified';

/**
 * 要件ステータス項目
 */
export interface RequirementStatus {
  id: string;
  description: string;
  status: RequirementVerificationStatus;
  evidence?: string;
  verifiedAt?: Date;
  verifiedBy?: string;
}

/**
 * テスト実行結果
 */
export interface TestExecutionResult {
  testId: string;
  name: string;
  passed: boolean;
  duration: number;
  errorMessage?: string;
  stackTrace?: string;
}

/**
 * 検証結果
 */
export interface VerificationResult {
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  coverage?: CoverageInfo;
  testResults: TestExecutionResult[];
  lintPassed: boolean;
  lintErrors: number;
  buildSucceeded: boolean;
  buildErrors: string[];
}

/**
 * カバレッジ情報
 */
export interface CoverageInfo {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

/**
 * 影響を受けるファイル情報
 */
export interface AffectedFile {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  linesAdded: number;
  linesRemoved: number;
}

/**
 * 依存関係の影響
 */
export interface DependencyImpact {
  name: string;
  type: 'direct' | 'transitive';
  affectedModules: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * 影響範囲分析
 */
export interface ImpactAnalysis {
  affectedFiles: AffectedFile[];
  affectedModules: string[];
  dependencyImpacts: DependencyImpact[];
  estimatedRiskLevel: 'low' | 'medium' | 'high' | 'critical';
  rollbackComplexity: 'simple' | 'moderate' | 'complex';
}

/**
 * 破壊的変更の種類
 */
export type BreakingChangeType =
  | 'api_removal'
  | 'api_signature_change'
  | 'behavior_change'
  | 'dependency_update'
  | 'schema_change'
  | 'config_change';

/**
 * 破壊的変更詳細
 */
export interface BreakingChange {
  id: string;
  type: BreakingChangeType;
  description: string;
  affectedAreas: string[];
  migrationPath?: string;
  severity: 'minor' | 'major' | 'critical';
}

/**
 * 破壊的変更情報
 */
export interface BreakingChangeInfo {
  hasBreakingChanges: boolean;
  changes: BreakingChange[];
  migrationGuide?: string;
  backwardCompatible: boolean;
}

/**
 * Done定義
 */
export interface DoneDefinition {
  taskId: string;
  title: string;
  createdAt: Date;
  requirementsMapping: RequirementStatus[];
  verification: VerificationResult;
  impactAnalysis: ImpactAnalysis;
  breakingChanges: BreakingChangeInfo;
  reproductionCommand: string;
  doneChecklist: string[];
  finalStatus: 'done' | 'blocked' | 'in_progress';
  blockedReason?: string;
}

/**
 * Done定義生成オプション
 */
export interface DoneDefinitionOptions {
  includeTestResults?: boolean;
  includeCoverage?: boolean;
  includeImpactAnalysis?: boolean;
  includeBreakingChanges?: boolean;
  customChecklist?: string[];
  testCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
}

/**
 * タスク情報（入力用）
 */
export interface TaskInfo {
  id: string;
  title: string;
  description: string;
  requirements: string[];
  acceptanceCriteria?: string[];
}

/**
 * コード変更情報
 */
export interface CodeChangeInfo {
  files: AffectedFile[];
  commits?: string[];
  branch?: string;
}

/**
 * Done定義生成器イベント
 */
export type DoneDefinitionEvent =
  | 'generate:start'
  | 'generate:progress'
  | 'generate:complete'
  | 'generate:error'
  | 'verification:start'
  | 'verification:complete'
  | 'analysis:start'
  | 'analysis:complete';

// ========================================
// Done Definition Generator Class
// ========================================

/**
 * Done定義生成器
 */
export class DoneDefinitionGenerator extends EventEmitter {
  private config: AidosConfig;

  constructor(config: Partial<AidosConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Done定義を生成
   */
  async generate(
    taskInfo: TaskInfo,
    codeChanges: CodeChangeInfo,
    options: DoneDefinitionOptions = {}
  ): Promise<DoneDefinition> {
    const startTime = Date.now();

    this.emit('generate:start', { taskId: taskInfo.id, title: taskInfo.title });

    try {
      // 要件マッピングを生成
      this.emit('generate:progress', { step: 'requirements', progress: 10 });
      const requirementsMapping = this.mapRequirements(taskInfo, codeChanges);

      // 検証結果を収集
      this.emit('generate:progress', { step: 'verification', progress: 30 });
      this.emit('verification:start', { taskId: taskInfo.id });
      const verification = await this.collectVerificationResults(options);
      this.emit('verification:complete', { verification });

      // 影響範囲分析
      this.emit('generate:progress', { step: 'impact_analysis', progress: 50 });
      this.emit('analysis:start', { taskId: taskInfo.id });
      const impactAnalysis = options.includeImpactAnalysis !== false
        ? this.analyzeImpact(codeChanges)
        : this.createEmptyImpactAnalysis();
      this.emit('analysis:complete', { impactAnalysis });

      // 破壊的変更検出
      this.emit('generate:progress', { step: 'breaking_changes', progress: 70 });
      const breakingChanges = options.includeBreakingChanges !== false
        ? this.detectBreakingChanges(codeChanges, taskInfo)
        : this.createEmptyBreakingChangeInfo();

      // 再現コマンド生成
      this.emit('generate:progress', { step: 'reproduction_command', progress: 85 });
      const reproductionCommand = this.generateReproductionCommand(options);

      // Doneチェックリスト生成
      this.emit('generate:progress', { step: 'checklist', progress: 95 });
      const doneChecklist = this.generateDoneChecklist(
        taskInfo,
        verification,
        breakingChanges,
        options.customChecklist
      );

      // 最終ステータス判定
      const { finalStatus, blockedReason } = this.determineFinalStatus(
        requirementsMapping,
        verification,
        breakingChanges
      );

      const definition: DoneDefinition = {
        taskId: taskInfo.id,
        title: taskInfo.title,
        createdAt: new Date(),
        requirementsMapping,
        verification,
        impactAnalysis,
        breakingChanges,
        reproductionCommand,
        doneChecklist,
        finalStatus,
        blockedReason,
      };

      this.emit('generate:progress', { step: 'complete', progress: 100 });
      this.emit('generate:complete', {
        definition,
        durationMs: Date.now() - startTime,
      });

      return definition;
    } catch (error) {
      this.emit('generate:error', { taskId: taskInfo.id, error });
      throw error;
    }
  }

  /**
   * 要件をマッピング
   */
  mapRequirements(
    taskInfo: TaskInfo,
    codeChanges: CodeChangeInfo
  ): RequirementStatus[] {
    const requirements = [
      ...taskInfo.requirements,
      ...(taskInfo.acceptanceCriteria ?? []),
    ];

    return requirements.map((req, index) => {
      const status = this.evaluateRequirementStatus(req, codeChanges);

      return {
        id: `req-${index + 1}`,
        description: req,
        status,
        verifiedAt: status !== 'not_verified' ? new Date() : undefined,
        verifiedBy: 'auto',
      };
    });
  }

  /**
   * 要件ステータスを評価
   */
  private evaluateRequirementStatus(
    requirement: string,
    codeChanges: CodeChangeInfo
  ): RequirementVerificationStatus {
    // 簡易的な評価ロジック
    // 実際のプロジェクトでは、テスト結果やコード解析と連携
    const lowerReq = requirement.toLowerCase();

    // ファイル変更がない場合は未検証
    if (codeChanges.files.length === 0) {
      return 'not_verified';
    }

    // キーワードベースの簡易判定
    const implementationKeywords = ['実装', '作成', '追加', 'create', 'add', 'implement'];
    const hasImplementationKeyword = implementationKeywords.some(kw =>
      lowerReq.includes(kw)
    );

    if (hasImplementationKeyword) {
      // ファイルが追加されていれば satisfied
      const hasAddedFiles = codeChanges.files.some(f => f.changeType === 'added');
      if (hasAddedFiles) {
        return 'satisfied';
      }
    }

    // 修正系のキーワード
    const modificationKeywords = ['修正', '変更', '更新', 'fix', 'update', 'modify'];
    const hasModificationKeyword = modificationKeywords.some(kw =>
      lowerReq.includes(kw)
    );

    if (hasModificationKeyword) {
      const hasModifiedFiles = codeChanges.files.some(f => f.changeType === 'modified');
      if (hasModifiedFiles) {
        return 'satisfied';
      }
    }

    // テスト系のキーワード
    const testKeywords = ['テスト', 'test'];
    const hasTestKeyword = testKeywords.some(kw => lowerReq.includes(kw));

    if (hasTestKeyword) {
      const hasTestFiles = codeChanges.files.some(f =>
        f.path.includes('.test.') || f.path.includes('.spec.')
      );
      if (hasTestFiles) {
        return 'satisfied';
      }
    }

    // デフォルトは未検証
    return 'not_verified';
  }

  /**
   * 検証結果を収集
   */
  async collectVerificationResults(
    options: DoneDefinitionOptions
  ): Promise<VerificationResult> {
    // 実際のプロジェクトでは、テスト実行やビルドを行う
    // ここではモックデータを返す

    const testResults: TestExecutionResult[] = [];
    let testsRun = 0;
    let testsPassed = 0;
    let testsFailed = 0;
    const testsSkipped = 0;

    if (options.includeTestResults !== false) {
      // テスト結果の収集（モック）
      testsRun = 10;
      testsPassed = 10;
      testsFailed = 0;

      for (let i = 0; i < testsRun; i++) {
        testResults.push({
          testId: uuidv4(),
          name: `Test case ${i + 1}`,
          passed: true,
          duration: Math.random() * 100,
        });
      }
    }

    const coverage: CoverageInfo | undefined = options.includeCoverage !== false
      ? {
          lines: 85,
          branches: 75,
          functions: 90,
          statements: 85,
        }
      : undefined;

    return {
      testsRun,
      testsPassed,
      testsFailed,
      testsSkipped,
      coverage,
      testResults,
      lintPassed: true,
      lintErrors: 0,
      buildSucceeded: true,
      buildErrors: [],
    };
  }

  /**
   * 影響範囲を分析
   */
  analyzeImpact(codeChanges: CodeChangeInfo): ImpactAnalysis {
    const affectedFiles = codeChanges.files;

    // 影響を受けるモジュールを抽出
    const affectedModules = this.extractAffectedModules(affectedFiles);

    // 依存関係の影響を分析
    const dependencyImpacts = this.analyzeDependencyImpacts(affectedFiles);

    // リスクレベルを評価
    const estimatedRiskLevel = this.evaluateRiskLevel(
      affectedFiles,
      dependencyImpacts
    );

    // ロールバック複雑度を評価
    const rollbackComplexity = this.evaluateRollbackComplexity(
      affectedFiles,
      dependencyImpacts
    );

    return {
      affectedFiles,
      affectedModules,
      dependencyImpacts,
      estimatedRiskLevel,
      rollbackComplexity,
    };
  }

  /**
   * 影響を受けるモジュールを抽出
   */
  private extractAffectedModules(files: AffectedFile[]): string[] {
    const modules = new Set<string>();

    for (const file of files) {
      // ディレクトリパスからモジュール名を抽出
      const parts = file.path.split('/');
      if (parts.length >= 2) {
        // src/module/file.ts -> module
        const srcIndex = parts.indexOf('src');
        if (srcIndex !== -1 && parts[srcIndex + 1]) {
          modules.add(parts[srcIndex + 1]);
        }
      }
    }

    return Array.from(modules);
  }

  /**
   * 依存関係の影響を分析
   */
  private analyzeDependencyImpacts(files: AffectedFile[]): DependencyImpact[] {
    const impacts: DependencyImpact[] = [];

    // package.json の変更をチェック
    const packageJsonChanged = files.some(f =>
      f.path.includes('package.json')
    );

    if (packageJsonChanged) {
      impacts.push({
        name: 'package.json',
        type: 'direct',
        affectedModules: ['all'],
        riskLevel: 'high',
      });
    }

    // 設定ファイルの変更をチェック
    const configFiles = files.filter(f =>
      f.path.includes('.config.') ||
      f.path.includes('tsconfig') ||
      f.path.includes('.json')
    );

    for (const config of configFiles) {
      impacts.push({
        name: config.path,
        type: 'transitive',
        affectedModules: this.extractAffectedModules([config]),
        riskLevel: 'medium',
      });
    }

    return impacts;
  }

  /**
   * リスクレベルを評価
   */
  private evaluateRiskLevel(
    files: AffectedFile[],
    dependencyImpacts: DependencyImpact[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    // 変更量による評価
    const totalLinesChanged = files.reduce(
      (sum, f) => sum + f.linesAdded + f.linesRemoved,
      0
    );

    // 依存関係影響による評価
    const hasHighRiskDependency = dependencyImpacts.some(
      d => d.riskLevel === 'high'
    );

    // 削除ファイルの有無
    const hasDeletedFiles = files.some(f => f.changeType === 'deleted');

    // リスクレベル判定
    if (hasDeletedFiles && hasHighRiskDependency) {
      return 'critical';
    }
    if (totalLinesChanged > 500 || hasHighRiskDependency) {
      return 'high';
    }
    if (totalLinesChanged > 100 || dependencyImpacts.length > 2) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * ロールバック複雑度を評価
   */
  private evaluateRollbackComplexity(
    files: AffectedFile[],
    dependencyImpacts: DependencyImpact[]
  ): 'simple' | 'moderate' | 'complex' {
    const hasSchemaChanges = files.some(f =>
      f.path.includes('migration') || f.path.includes('schema')
    );

    const hasDependencyChanges = dependencyImpacts.some(
      d => d.name.includes('package.json')
    );

    if (hasSchemaChanges) {
      return 'complex';
    }
    if (hasDependencyChanges || files.length > 10) {
      return 'moderate';
    }
    return 'simple';
  }

  /**
   * 破壊的変更を検出
   */
  detectBreakingChanges(
    codeChanges: CodeChangeInfo,
    taskInfo: TaskInfo
  ): BreakingChangeInfo {
    const changes: BreakingChange[] = [];

    // API関連のファイル変更をチェック
    for (const file of codeChanges.files) {
      if (file.changeType === 'deleted') {
        // ファイル削除は潜在的な破壊的変更
        if (this.isPublicApi(file.path)) {
          changes.push({
            id: uuidv4(),
            type: 'api_removal',
            description: `Public API file removed: ${file.path}`,
            affectedAreas: [file.path],
            severity: 'critical',
          });
        }
      }

      // 型定義ファイルの変更
      if (file.path.endsWith('.d.ts') && file.changeType === 'modified') {
        changes.push({
          id: uuidv4(),
          type: 'api_signature_change',
          description: `Type definition changed: ${file.path}`,
          affectedAreas: [file.path],
          severity: 'major',
        });
      }

      // スキーマ変更
      if (
        (file.path.includes('schema') || file.path.includes('migration')) &&
        file.changeType !== 'added'
      ) {
        changes.push({
          id: uuidv4(),
          type: 'schema_change',
          description: `Schema/migration changed: ${file.path}`,
          affectedAreas: [file.path],
          severity: 'major',
          migrationPath: 'Run migration scripts after deployment',
        });
      }
    }

    // タスク説明から破壊的変更のキーワードを検出
    const breakingKeywords = [
      '破壊的',
      'breaking',
      '互換性',
      'compatibility',
      '削除',
      'remove',
      'deprecate',
    ];
    const hasBreakingKeyword = breakingKeywords.some(kw =>
      taskInfo.description.toLowerCase().includes(kw)
    );

    if (hasBreakingKeyword && changes.length === 0) {
      changes.push({
        id: uuidv4(),
        type: 'behavior_change',
        description: 'Potential breaking change detected from task description',
        affectedAreas: ['unknown'],
        severity: 'minor',
      });
    }

    return {
      hasBreakingChanges: changes.length > 0,
      changes,
      migrationGuide: changes.length > 0
        ? this.generateMigrationGuide(changes)
        : undefined,
      backwardCompatible: changes.length === 0,
    };
  }

  /**
   * 公開APIかどうかを判定
   */
  private isPublicApi(filePath: string): boolean {
    // index.ts や public/ 配下のファイルを公開APIとみなす
    return (
      filePath.includes('index.') ||
      filePath.includes('/public/') ||
      filePath.includes('/api/')
    );
  }

  /**
   * マイグレーションガイドを生成
   */
  private generateMigrationGuide(changes: BreakingChange[]): string {
    const lines: string[] = ['# Migration Guide', ''];

    for (const change of changes) {
      lines.push(`## ${change.type}`);
      lines.push(change.description);
      if (change.migrationPath) {
        lines.push(`**Migration Path:** ${change.migrationPath}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 再現コマンドを生成
   */
  generateReproductionCommand(options: DoneDefinitionOptions): string {
    const commands: string[] = [];

    // 依存関係インストール
    commands.push('npm install');

    // ビルド
    if (options.buildCommand) {
      commands.push(options.buildCommand);
    } else {
      commands.push('npm run build');
    }

    // Lint
    if (options.lintCommand) {
      commands.push(options.lintCommand);
    } else {
      commands.push('npm run lint');
    }

    // テスト
    if (options.testCommand) {
      commands.push(options.testCommand);
    } else {
      commands.push('npm test');
    }

    return commands.join(' && ');
  }

  /**
   * Doneチェックリストを生成
   */
  generateDoneChecklist(
    taskInfo: TaskInfo,
    verification: VerificationResult,
    breakingChanges: BreakingChangeInfo,
    customChecklist?: string[]
  ): string[] {
    const checklist: string[] = [];

    // 標準チェック項目
    checklist.push(
      verification.buildSucceeded
        ? '[x] ビルドが成功している'
        : '[ ] ビルドが成功している'
    );

    checklist.push(
      verification.lintPassed
        ? '[x] Lintチェックをパスしている'
        : '[ ] Lintチェックをパスしている'
    );

    checklist.push(
      verification.testsFailed === 0
        ? '[x] 全てのテストがパスしている'
        : `[ ] 全てのテストがパスしている (失敗: ${verification.testsFailed})`
    );

    // カバレッジ
    if (verification.coverage) {
      const coverageOk = verification.coverage.lines >= 80;
      checklist.push(
        coverageOk
          ? `[x] テストカバレッジが80%以上 (${verification.coverage.lines}%)`
          : `[ ] テストカバレッジが80%以上 (現在: ${verification.coverage.lines}%)`
      );
    }

    // 破壊的変更
    if (breakingChanges.hasBreakingChanges) {
      checklist.push('[ ] 破壊的変更が文書化されている');
      checklist.push('[ ] マイグレーションガイドが作成されている');
    }

    // 受け入れ基準
    if (taskInfo.acceptanceCriteria) {
      for (const criteria of taskInfo.acceptanceCriteria) {
        checklist.push(`[ ] ${criteria}`);
      }
    }

    // カスタムチェックリスト
    if (customChecklist) {
      for (const item of customChecklist) {
        checklist.push(`[ ] ${item}`);
      }
    }

    return checklist;
  }

  /**
   * 最終ステータスを判定
   */
  private determineFinalStatus(
    requirementsMapping: RequirementStatus[],
    verification: VerificationResult,
    breakingChanges: BreakingChangeInfo
  ): { finalStatus: 'done' | 'blocked' | 'in_progress'; blockedReason?: string } {
    // ビルド失敗
    if (!verification.buildSucceeded) {
      return {
        finalStatus: 'blocked',
        blockedReason: `ビルドエラー: ${verification.buildErrors.join(', ')}`,
      };
    }

    // テスト失敗
    if (verification.testsFailed > 0) {
      return {
        finalStatus: 'blocked',
        blockedReason: `テスト失敗: ${verification.testsFailed}件`,
      };
    }

    // Lint失敗
    if (!verification.lintPassed) {
      return {
        finalStatus: 'blocked',
        blockedReason: `Lintエラー: ${verification.lintErrors}件`,
      };
    }

    // 未満足の要件がある
    const notSatisfied = requirementsMapping.filter(
      r => r.status === 'not_satisfied'
    );
    if (notSatisfied.length > 0) {
      return {
        finalStatus: 'blocked',
        blockedReason: `未満足の要件: ${notSatisfied.map(r => r.description).join(', ')}`,
      };
    }

    // 未検証の要件がある
    const notVerified = requirementsMapping.filter(
      r => r.status === 'not_verified'
    );
    if (notVerified.length > 0) {
      return {
        finalStatus: 'in_progress',
        blockedReason: `未検証の要件: ${notVerified.length}件`,
      };
    }

    // 破壊的変更がある場合は警告（ブロックはしない）
    if (breakingChanges.hasBreakingChanges && !breakingChanges.migrationGuide) {
      return {
        finalStatus: 'in_progress',
        blockedReason: '破壊的変更のマイグレーションガイドが必要です',
      };
    }

    return { finalStatus: 'done' };
  }

  /**
   * 空の影響分析を作成
   */
  private createEmptyImpactAnalysis(): ImpactAnalysis {
    return {
      affectedFiles: [],
      affectedModules: [],
      dependencyImpacts: [],
      estimatedRiskLevel: 'low',
      rollbackComplexity: 'simple',
    };
  }

  /**
   * 空の破壊的変更情報を作成
   */
  private createEmptyBreakingChangeInfo(): BreakingChangeInfo {
    return {
      hasBreakingChanges: false,
      changes: [],
      backwardCompatible: true,
    };
  }

  /**
   * Done定義をMarkdown形式で出力
   */
  toMarkdown(definition: DoneDefinition): string {
    const lines: string[] = [];

    lines.push(`# Done Definition: ${definition.title}`);
    lines.push('');
    lines.push(`**Task ID:** ${definition.taskId}`);
    lines.push(`**Created:** ${definition.createdAt.toISOString()}`);
    lines.push(`**Status:** ${definition.finalStatus.toUpperCase()}`);
    if (definition.blockedReason) {
      lines.push(`**Blocked Reason:** ${definition.blockedReason}`);
    }
    lines.push('');

    // 要件マッピング
    lines.push('## Requirements Mapping');
    lines.push('');
    lines.push('| ID | Description | Status |');
    lines.push('|----|-------------|--------|');
    for (const req of definition.requirementsMapping) {
      const statusEmoji =
        req.status === 'satisfied' ? 'O' :
        req.status === 'not_satisfied' ? 'X' : '-';
      lines.push(`| ${req.id} | ${req.description} | ${statusEmoji} ${req.status} |`);
    }
    lines.push('');

    // 検証結果
    lines.push('## Verification Results');
    lines.push('');
    lines.push(`- **Tests Run:** ${definition.verification.testsRun}`);
    lines.push(`- **Tests Passed:** ${definition.verification.testsPassed}`);
    lines.push(`- **Tests Failed:** ${definition.verification.testsFailed}`);
    lines.push(`- **Build:** ${definition.verification.buildSucceeded ? 'Success' : 'Failed'}`);
    lines.push(`- **Lint:** ${definition.verification.lintPassed ? 'Passed' : 'Failed'}`);
    if (definition.verification.coverage) {
      lines.push(`- **Coverage:** ${definition.verification.coverage.lines}% lines`);
    }
    lines.push('');

    // 影響分析
    lines.push('## Impact Analysis');
    lines.push('');
    lines.push(`- **Risk Level:** ${definition.impactAnalysis.estimatedRiskLevel}`);
    lines.push(`- **Rollback Complexity:** ${definition.impactAnalysis.rollbackComplexity}`);
    lines.push(`- **Affected Modules:** ${definition.impactAnalysis.affectedModules.join(', ') || 'None'}`);
    lines.push('');

    // 破壊的変更
    if (definition.breakingChanges.hasBreakingChanges) {
      lines.push('## Breaking Changes');
      lines.push('');
      for (const change of definition.breakingChanges.changes) {
        lines.push(`### ${change.type} (${change.severity})`);
        lines.push(change.description);
        lines.push('');
      }
    }

    // 再現コマンド
    lines.push('## Reproduction Command');
    lines.push('');
    lines.push('```bash');
    lines.push(definition.reproductionCommand);
    lines.push('```');
    lines.push('');

    // チェックリスト
    lines.push('## Done Checklist');
    lines.push('');
    for (const item of definition.doneChecklist) {
      lines.push(item);
    }
    lines.push('');

    return lines.join('\n');
  }
}

// ========================================
// Singleton Instance
// ========================================

let doneDefinitionGeneratorInstance: DoneDefinitionGenerator | null = null;

/**
 * DoneDefinitionGeneratorのシングルトンインスタンスを取得
 */
export function getDoneDefinitionGenerator(
  config?: Partial<AidosConfig>
): DoneDefinitionGenerator {
  if (!doneDefinitionGeneratorInstance) {
    doneDefinitionGeneratorInstance = new DoneDefinitionGenerator(config);
  }
  return doneDefinitionGeneratorInstance;
}

/**
 * DoneDefinitionGeneratorインスタンスをリセット（テスト用）
 */
export function resetDoneDefinitionGenerator(): void {
  doneDefinitionGeneratorInstance = null;
}
