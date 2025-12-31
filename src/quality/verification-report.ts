/**
 * 自己検証レポート生成器
 *
 * Markdown形式の検証レポートを生成
 * - 目的と達成内容の表
 * - 実行した検証内容
 * - 意図的な未実装項目
 * - 残リスク・不安点
 * - ロールバック方法
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { AidosConfig, DEFAULT_CONFIG } from '../types.js';
import {
  DoneDefinition,
  VerificationResult,
  ImpactAnalysis,
  BreakingChangeInfo,
  RequirementStatus,
} from './done-definition.js';

// ========================================
// Types
// ========================================

/**
 * 目的と達成内容の項目
 */
export interface ObjectiveAchievement {
  id: string;
  objective: string;
  achievement: string;
  status: 'achieved' | 'partial' | 'not_achieved';
  evidence?: string;
  notes?: string;
}

/**
 * 検証項目
 */
export interface VerificationItem {
  id: string;
  category: 'unit_test' | 'integration_test' | 'manual_test' | 'code_review' | 'lint' | 'build' | 'other';
  description: string;
  result: 'passed' | 'failed' | 'skipped' | 'not_applicable';
  details?: string;
  executedAt?: Date;
}

/**
 * 意図的な未実装項目
 */
export interface IntentionalOmission {
  id: string;
  description: string;
  reason: string;
  plannedFor?: string;
  priority: 'low' | 'medium' | 'high';
  ticketId?: string;
}

/**
 * 残リスク・不安点
 */
export interface RemainingRisk {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation?: string;
  owner?: string;
  dueDate?: Date;
}

/**
 * ロールバック手順
 */
export interface RollbackStep {
  order: number;
  description: string;
  command?: string;
  notes?: string;
  estimatedDuration?: string;
}

/**
 * ロールバック計画
 */
export interface RollbackPlan {
  canRollback: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
  steps: RollbackStep[];
  prerequisites: string[];
  estimatedTotalDuration: string;
  warnings: string[];
}

/**
 * 検証レポート
 */
export interface VerificationReport {
  id: string;
  title: string;
  taskId: string;
  createdAt: Date;
  author: string;
  summary: string;
  objectivesAndAchievements: ObjectiveAchievement[];
  verificationItems: VerificationItem[];
  intentionalOmissions: IntentionalOmission[];
  remainingRisks: RemainingRisk[];
  rollbackPlan: RollbackPlan;
  additionalNotes?: string;
  attachments?: string[];
}

/**
 * レポート生成オプション
 */
export interface VerificationReportOptions {
  author?: string;
  includeTestDetails?: boolean;
  includeRollbackPlan?: boolean;
  additionalNotes?: string;
  attachments?: string[];
}

/**
 * レポート生成入力
 */
export interface VerificationReportInput {
  taskId: string;
  title: string;
  objectives: string[];
  achievements: string[];
  omissions?: Array<{ description: string; reason: string; plannedFor?: string }>;
  risks?: Array<{ description: string; severity: 'low' | 'medium' | 'high' | 'critical'; mitigation?: string }>;
  customVerifications?: Array<{ category: string; description: string; result: string }>;
}

/**
 * 検証レポート生成器イベント
 */
export type VerificationReportEvent =
  | 'report:start'
  | 'report:progress'
  | 'report:complete'
  | 'report:error';

// ========================================
// Verification Report Generator Class
// ========================================

/**
 * 検証レポート生成器
 */
export class VerificationReportGenerator extends EventEmitter {
  private config: AidosConfig;

  constructor(config: Partial<AidosConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Done定義から検証レポートを生成
   */
  async generateFromDoneDefinition(
    doneDefinition: DoneDefinition,
    input: Partial<VerificationReportInput>,
    options: VerificationReportOptions = {}
  ): Promise<VerificationReport> {
    this.emit('report:start', { taskId: doneDefinition.taskId });

    try {
      // 目的と達成内容を生成
      this.emit('report:progress', { step: 'objectives', progress: 20 });
      const objectivesAndAchievements = this.generateObjectivesAndAchievements(
        doneDefinition.requirementsMapping,
        input.objectives ?? [],
        input.achievements ?? []
      );

      // 検証項目を生成
      this.emit('report:progress', { step: 'verification', progress: 40 });
      const verificationItems = this.generateVerificationItems(
        doneDefinition.verification,
        input.customVerifications
      );

      // 意図的な未実装項目を生成
      this.emit('report:progress', { step: 'omissions', progress: 60 });
      const intentionalOmissions = this.generateIntentionalOmissions(
        input.omissions
      );

      // 残リスクを生成
      this.emit('report:progress', { step: 'risks', progress: 75 });
      const remainingRisks = this.generateRemainingRisks(
        doneDefinition.impactAnalysis,
        doneDefinition.breakingChanges,
        input.risks
      );

      // ロールバック計画を生成
      this.emit('report:progress', { step: 'rollback', progress: 90 });
      const rollbackPlan = options.includeRollbackPlan !== false
        ? this.generateRollbackPlan(doneDefinition.impactAnalysis)
        : this.createEmptyRollbackPlan();

      const report: VerificationReport = {
        id: uuidv4(),
        title: input.title ?? doneDefinition.title,
        taskId: doneDefinition.taskId,
        createdAt: new Date(),
        author: options.author ?? 'AIDOS',
        summary: this.generateSummary(
          doneDefinition,
          objectivesAndAchievements,
          remainingRisks
        ),
        objectivesAndAchievements,
        verificationItems,
        intentionalOmissions,
        remainingRisks,
        rollbackPlan,
        additionalNotes: options.additionalNotes,
        attachments: options.attachments,
      };

      this.emit('report:progress', { step: 'complete', progress: 100 });
      this.emit('report:complete', { report });

      return report;
    } catch (error) {
      this.emit('report:error', { taskId: doneDefinition.taskId, error });
      throw error;
    }
  }

  /**
   * 入力情報から直接検証レポートを生成
   */
  async generate(
    input: VerificationReportInput,
    options: VerificationReportOptions = {}
  ): Promise<VerificationReport> {
    this.emit('report:start', { taskId: input.taskId });

    try {
      // 目的と達成内容を生成
      this.emit('report:progress', { step: 'objectives', progress: 20 });
      const objectivesAndAchievements = this.createObjectivesFromInput(
        input.objectives,
        input.achievements
      );

      // 検証項目を生成
      this.emit('report:progress', { step: 'verification', progress: 40 });
      const verificationItems = this.createVerificationItemsFromInput(
        input.customVerifications
      );

      // 意図的な未実装項目を生成
      this.emit('report:progress', { step: 'omissions', progress: 60 });
      const intentionalOmissions = this.generateIntentionalOmissions(
        input.omissions
      );

      // 残リスクを生成
      this.emit('report:progress', { step: 'risks', progress: 75 });
      const remainingRisks = this.createRisksFromInput(input.risks);

      // ロールバック計画を生成
      this.emit('report:progress', { step: 'rollback', progress: 90 });
      const rollbackPlan = options.includeRollbackPlan !== false
        ? this.createDefaultRollbackPlan()
        : this.createEmptyRollbackPlan();

      const report: VerificationReport = {
        id: uuidv4(),
        title: input.title,
        taskId: input.taskId,
        createdAt: new Date(),
        author: options.author ?? 'AIDOS',
        summary: this.generateSummaryFromInput(
          input,
          objectivesAndAchievements,
          remainingRisks
        ),
        objectivesAndAchievements,
        verificationItems,
        intentionalOmissions,
        remainingRisks,
        rollbackPlan,
        additionalNotes: options.additionalNotes,
        attachments: options.attachments,
      };

      this.emit('report:progress', { step: 'complete', progress: 100 });
      this.emit('report:complete', { report });

      return report;
    } catch (error) {
      this.emit('report:error', { taskId: input.taskId, error });
      throw error;
    }
  }

  /**
   * 目的と達成内容を生成
   */
  private generateObjectivesAndAchievements(
    requirements: RequirementStatus[],
    objectives: string[],
    achievements: string[]
  ): ObjectiveAchievement[] {
    const items: ObjectiveAchievement[] = [];

    // 要件マッピングから生成
    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i];
      const achievement = achievements[i] ?? this.inferAchievement(req);
      const status = this.mapRequirementStatusToAchievement(req.status);

      items.push({
        id: req.id,
        objective: req.description,
        achievement,
        status,
        evidence: req.evidence,
      });
    }

    // 追加の目的を追加
    for (let i = requirements.length; i < objectives.length; i++) {
      items.push({
        id: `obj-${i + 1}`,
        objective: objectives[i],
        achievement: achievements[i] ?? 'Not specified',
        status: achievements[i] ? 'achieved' : 'not_achieved',
      });
    }

    return items;
  }

  /**
   * 入力から目的と達成内容を作成
   */
  private createObjectivesFromInput(
    objectives: string[],
    achievements: string[]
  ): ObjectiveAchievement[] {
    return objectives.map((obj, i) => ({
      id: `obj-${i + 1}`,
      objective: obj,
      achievement: achievements[i] ?? 'Not specified',
      status: achievements[i] ? 'achieved' as const : 'not_achieved' as const,
    }));
  }

  /**
   * 要件ステータスから達成内容を推論
   */
  private inferAchievement(req: RequirementStatus): string {
    switch (req.status) {
      case 'satisfied':
        return `Implemented: ${req.description}`;
      case 'not_satisfied':
        return `Not implemented: ${req.description}`;
      case 'not_verified':
        return `Pending verification: ${req.description}`;
    }
  }

  /**
   * 要件ステータスを達成ステータスにマッピング
   */
  private mapRequirementStatusToAchievement(
    status: 'satisfied' | 'not_satisfied' | 'not_verified'
  ): 'achieved' | 'partial' | 'not_achieved' {
    switch (status) {
      case 'satisfied':
        return 'achieved';
      case 'not_satisfied':
        return 'not_achieved';
      case 'not_verified':
        return 'partial';
    }
  }

  /**
   * 検証項目を生成
   */
  private generateVerificationItems(
    verification: VerificationResult,
    customVerifications?: Array<{ category: string; description: string; result: string }>
  ): VerificationItem[] {
    const items: VerificationItem[] = [];

    // ビルド検証
    items.push({
      id: uuidv4(),
      category: 'build',
      description: 'Project build verification',
      result: verification.buildSucceeded ? 'passed' : 'failed',
      details: verification.buildErrors.length > 0
        ? `Errors: ${verification.buildErrors.join(', ')}`
        : undefined,
      executedAt: new Date(),
    });

    // Lint検証
    items.push({
      id: uuidv4(),
      category: 'lint',
      description: 'Code linting verification',
      result: verification.lintPassed ? 'passed' : 'failed',
      details: `${verification.lintErrors} lint errors`,
      executedAt: new Date(),
    });

    // ユニットテスト
    if (verification.testsRun > 0) {
      items.push({
        id: uuidv4(),
        category: 'unit_test',
        description: 'Unit test execution',
        result: verification.testsFailed === 0 ? 'passed' : 'failed',
        details: `${verification.testsPassed}/${verification.testsRun} tests passed`,
        executedAt: new Date(),
      });
    }

    // カバレッジ検証
    if (verification.coverage) {
      items.push({
        id: uuidv4(),
        category: 'unit_test',
        description: 'Code coverage verification',
        result: verification.coverage.lines >= 80 ? 'passed' : 'failed',
        details: `Line coverage: ${verification.coverage.lines}%, Branch coverage: ${verification.coverage.branches}%`,
        executedAt: new Date(),
      });
    }

    // カスタム検証
    if (customVerifications) {
      for (const cv of customVerifications) {
        items.push({
          id: uuidv4(),
          category: this.mapCategory(cv.category),
          description: cv.description,
          result: this.mapResult(cv.result),
          executedAt: new Date(),
        });
      }
    }

    return items;
  }

  /**
   * 入力から検証項目を作成
   */
  private createVerificationItemsFromInput(
    customVerifications?: Array<{ category: string; description: string; result: string }>
  ): VerificationItem[] {
    if (!customVerifications) {
      return [];
    }

    return customVerifications.map(cv => ({
      id: uuidv4(),
      category: this.mapCategory(cv.category),
      description: cv.description,
      result: this.mapResult(cv.result),
      executedAt: new Date(),
    }));
  }

  /**
   * カテゴリをマッピング
   */
  private mapCategory(category: string): VerificationItem['category'] {
    const categoryMap: Record<string, VerificationItem['category']> = {
      'unit_test': 'unit_test',
      'unit': 'unit_test',
      'integration_test': 'integration_test',
      'integration': 'integration_test',
      'manual_test': 'manual_test',
      'manual': 'manual_test',
      'code_review': 'code_review',
      'review': 'code_review',
      'lint': 'lint',
      'build': 'build',
    };

    return categoryMap[category.toLowerCase()] ?? 'other';
  }

  /**
   * 結果をマッピング
   */
  private mapResult(result: string): VerificationItem['result'] {
    const resultMap: Record<string, VerificationItem['result']> = {
      'passed': 'passed',
      'pass': 'passed',
      'success': 'passed',
      'ok': 'passed',
      'failed': 'failed',
      'fail': 'failed',
      'error': 'failed',
      'skipped': 'skipped',
      'skip': 'skipped',
      'not_applicable': 'not_applicable',
      'na': 'not_applicable',
    };

    return resultMap[result.toLowerCase()] ?? 'not_applicable';
  }

  /**
   * 意図的な未実装項目を生成
   */
  private generateIntentionalOmissions(
    omissions?: Array<{ description: string; reason: string; plannedFor?: string }>
  ): IntentionalOmission[] {
    if (!omissions) {
      return [];
    }

    return omissions.map((o, i) => ({
      id: `omission-${i + 1}`,
      description: o.description,
      reason: o.reason,
      plannedFor: o.plannedFor,
      priority: this.inferPriority(o.description),
    }));
  }

  /**
   * 優先度を推論
   */
  private inferPriority(description: string): 'low' | 'medium' | 'high' {
    const lowerDesc = description.toLowerCase();

    if (lowerDesc.includes('security') || lowerDesc.includes('critical')) {
      return 'high';
    }
    if (lowerDesc.includes('performance') || lowerDesc.includes('important')) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * 残リスクを生成
   */
  private generateRemainingRisks(
    impactAnalysis: ImpactAnalysis,
    breakingChanges: BreakingChangeInfo,
    inputRisks?: Array<{ description: string; severity: 'low' | 'medium' | 'high' | 'critical'; mitigation?: string }>
  ): RemainingRisk[] {
    const risks: RemainingRisk[] = [];

    // 影響分析からリスクを生成
    if (impactAnalysis.estimatedRiskLevel !== 'low') {
      risks.push({
        id: uuidv4(),
        description: `Impact analysis indicates ${impactAnalysis.estimatedRiskLevel} risk level`,
        severity: impactAnalysis.estimatedRiskLevel === 'critical' ? 'critical' : impactAnalysis.estimatedRiskLevel,
        mitigation: `Rollback complexity: ${impactAnalysis.rollbackComplexity}`,
      });
    }

    // 破壊的変更からリスクを生成
    if (breakingChanges.hasBreakingChanges) {
      for (const change of breakingChanges.changes) {
        risks.push({
          id: uuidv4(),
          description: `Breaking change: ${change.description}`,
          severity: this.mapBreakingChangeSeverity(change.severity),
          mitigation: change.migrationPath ?? breakingChanges.migrationGuide,
        });
      }
    }

    // 入力リスクを追加
    if (inputRisks) {
      for (const risk of inputRisks) {
        risks.push({
          id: uuidv4(),
          description: risk.description,
          severity: risk.severity,
          mitigation: risk.mitigation,
        });
      }
    }

    return risks;
  }

  /**
   * 入力からリスクを作成
   */
  private createRisksFromInput(
    risks?: Array<{ description: string; severity: 'low' | 'medium' | 'high' | 'critical'; mitigation?: string }>
  ): RemainingRisk[] {
    if (!risks) {
      return [];
    }

    return risks.map(risk => ({
      id: uuidv4(),
      description: risk.description,
      severity: risk.severity,
      mitigation: risk.mitigation,
    }));
  }

  /**
   * 破壊的変更の重要度をマッピング
   */
  private mapBreakingChangeSeverity(
    severity: 'minor' | 'major' | 'critical'
  ): 'low' | 'medium' | 'high' | 'critical' {
    switch (severity) {
      case 'minor':
        return 'low';
      case 'major':
        return 'high';
      case 'critical':
        return 'critical';
    }
  }

  /**
   * ロールバック計画を生成
   */
  private generateRollbackPlan(impactAnalysis: ImpactAnalysis): RollbackPlan {
    const steps: RollbackStep[] = [];
    const warnings: string[] = [];

    // 基本的なロールバック手順
    steps.push({
      order: 1,
      description: 'Stop the affected services',
      command: 'npm run stop',
      estimatedDuration: '1 minute',
    });

    steps.push({
      order: 2,
      description: 'Revert to the previous version',
      command: 'git revert HEAD',
      estimatedDuration: '2 minutes',
    });

    // スキーマ変更がある場合
    const hasSchemaChanges = impactAnalysis.affectedFiles.some(f =>
      f.path.includes('migration') || f.path.includes('schema')
    );

    if (hasSchemaChanges) {
      steps.push({
        order: 3,
        description: 'Run database rollback migration',
        command: 'npm run migration:rollback',
        estimatedDuration: '5 minutes',
        notes: 'Ensure database backup exists before proceeding',
      });
      warnings.push('Database schema changes detected. Ensure backup exists.');
    }

    // 依存関係変更がある場合
    const hasDependencyChanges = impactAnalysis.dependencyImpacts.some(
      d => d.name.includes('package.json')
    );

    if (hasDependencyChanges) {
      steps.push({
        order: steps.length + 1,
        description: 'Restore previous dependencies',
        command: 'npm ci',
        estimatedDuration: '3 minutes',
      });
      warnings.push('Dependency changes detected. May require cache clearing.');
    }

    steps.push({
      order: steps.length + 1,
      description: 'Rebuild and redeploy',
      command: 'npm run build && npm run deploy',
      estimatedDuration: '5 minutes',
    });

    steps.push({
      order: steps.length + 1,
      description: 'Verify service health',
      command: 'npm run health-check',
      estimatedDuration: '2 minutes',
    });

    // 総所要時間を計算
    const totalMinutes = steps.reduce((sum, step) => {
      const minutes = parseInt(step.estimatedDuration ?? '0');
      return sum + (isNaN(minutes) ? 0 : minutes);
    }, 0);

    return {
      canRollback: true,
      complexity: impactAnalysis.rollbackComplexity,
      steps,
      prerequisites: [
        'Git access to the repository',
        'Deployment permissions',
        hasSchemaChanges ? 'Database admin access' : '',
      ].filter(Boolean),
      estimatedTotalDuration: `${totalMinutes} minutes`,
      warnings,
    };
  }

  /**
   * デフォルトのロールバック計画を作成
   */
  private createDefaultRollbackPlan(): RollbackPlan {
    return {
      canRollback: true,
      complexity: 'simple',
      steps: [
        {
          order: 1,
          description: 'Revert to the previous version',
          command: 'git revert HEAD',
          estimatedDuration: '2 minutes',
        },
        {
          order: 2,
          description: 'Rebuild and redeploy',
          command: 'npm run build && npm run deploy',
          estimatedDuration: '5 minutes',
        },
      ],
      prerequisites: ['Git access to the repository', 'Deployment permissions'],
      estimatedTotalDuration: '7 minutes',
      warnings: [],
    };
  }

  /**
   * 空のロールバック計画を作成
   */
  private createEmptyRollbackPlan(): RollbackPlan {
    return {
      canRollback: false,
      complexity: 'simple',
      steps: [],
      prerequisites: [],
      estimatedTotalDuration: 'N/A',
      warnings: ['Rollback plan not included'],
    };
  }

  /**
   * サマリーを生成
   */
  private generateSummary(
    doneDefinition: DoneDefinition,
    objectives: ObjectiveAchievement[],
    risks: RemainingRisk[]
  ): string {
    const achievedCount = objectives.filter(o => o.status === 'achieved').length;
    const totalObjectives = objectives.length;
    const highRisks = risks.filter(r => r.severity === 'high' || r.severity === 'critical').length;

    const statusText = doneDefinition.finalStatus === 'done'
      ? 'completed successfully'
      : doneDefinition.finalStatus === 'blocked'
        ? 'blocked'
        : 'in progress';

    let summary = `Task ${doneDefinition.title} is ${statusText}. `;
    summary += `${achievedCount}/${totalObjectives} objectives achieved. `;

    if (highRisks > 0) {
      summary += `${highRisks} high/critical risks identified. `;
    }

    if (doneDefinition.blockedReason) {
      summary += `Blocked reason: ${doneDefinition.blockedReason}`;
    }

    return summary;
  }

  /**
   * 入力からサマリーを生成
   */
  private generateSummaryFromInput(
    input: VerificationReportInput,
    objectives: ObjectiveAchievement[],
    risks: RemainingRisk[]
  ): string {
    const achievedCount = objectives.filter(o => o.status === 'achieved').length;
    const totalObjectives = objectives.length;
    const highRisks = risks.filter(r => r.severity === 'high' || r.severity === 'critical').length;

    let summary = `Verification report for ${input.title}. `;
    summary += `${achievedCount}/${totalObjectives} objectives achieved. `;

    if (highRisks > 0) {
      summary += `${highRisks} high/critical risks identified.`;
    } else {
      summary += 'No critical risks identified.';
    }

    return summary;
  }

  /**
   * レポートをMarkdown形式で出力
   */
  toMarkdown(report: VerificationReport): string {
    const lines: string[] = [];

    // ヘッダー
    lines.push(`# Verification Report: ${report.title}`);
    lines.push('');
    lines.push(`**Task ID:** ${report.taskId}`);
    lines.push(`**Created:** ${report.createdAt.toISOString()}`);
    lines.push(`**Author:** ${report.author}`);
    lines.push('');

    // サマリー
    lines.push('## Summary');
    lines.push('');
    lines.push(report.summary);
    lines.push('');

    // 目的と達成内容
    lines.push('## Objectives and Achievements');
    lines.push('');
    lines.push('| Objective | Achievement | Status |');
    lines.push('|-----------|-------------|--------|');
    for (const item of report.objectivesAndAchievements) {
      const statusIcon = item.status === 'achieved' ? '[O]' :
                        item.status === 'partial' ? '[~]' : '[X]';
      lines.push(`| ${item.objective} | ${item.achievement} | ${statusIcon} ${item.status} |`);
    }
    lines.push('');

    // 検証項目
    lines.push('## Verification Items');
    lines.push('');
    lines.push('| Category | Description | Result |');
    lines.push('|----------|-------------|--------|');
    for (const item of report.verificationItems) {
      const resultIcon = item.result === 'passed' ? '[O]' :
                        item.result === 'failed' ? '[X]' :
                        item.result === 'skipped' ? '[-]' : '[?]';
      lines.push(`| ${item.category} | ${item.description} | ${resultIcon} ${item.result} |`);
    }
    lines.push('');

    // 意図的な未実装項目
    if (report.intentionalOmissions.length > 0) {
      lines.push('## Intentional Omissions');
      lines.push('');
      lines.push('| Description | Reason | Planned For | Priority |');
      lines.push('|-------------|--------|-------------|----------|');
      for (const item of report.intentionalOmissions) {
        lines.push(`| ${item.description} | ${item.reason} | ${item.plannedFor ?? 'TBD'} | ${item.priority} |`);
      }
      lines.push('');
    }

    // 残リスク
    if (report.remainingRisks.length > 0) {
      lines.push('## Remaining Risks');
      lines.push('');
      lines.push('| Description | Severity | Mitigation |');
      lines.push('|-------------|----------|------------|');
      for (const risk of report.remainingRisks) {
        const severityIcon = risk.severity === 'critical' ? '[!!]' :
                            risk.severity === 'high' ? '[!]' :
                            risk.severity === 'medium' ? '[~]' : '[-]';
        lines.push(`| ${risk.description} | ${severityIcon} ${risk.severity} | ${risk.mitigation ?? 'N/A'} |`);
      }
      lines.push('');
    }

    // ロールバック計画
    if (report.rollbackPlan.canRollback && report.rollbackPlan.steps.length > 0) {
      lines.push('## Rollback Plan');
      lines.push('');
      lines.push(`**Complexity:** ${report.rollbackPlan.complexity}`);
      lines.push(`**Estimated Duration:** ${report.rollbackPlan.estimatedTotalDuration}`);
      lines.push('');

      if (report.rollbackPlan.prerequisites.length > 0) {
        lines.push('### Prerequisites');
        lines.push('');
        for (const prereq of report.rollbackPlan.prerequisites) {
          lines.push(`- ${prereq}`);
        }
        lines.push('');
      }

      lines.push('### Steps');
      lines.push('');
      for (const step of report.rollbackPlan.steps) {
        lines.push(`${step.order}. ${step.description}`);
        if (step.command) {
          lines.push('   ```bash');
          lines.push(`   ${step.command}`);
          lines.push('   ```');
        }
        if (step.notes) {
          lines.push(`   > Note: ${step.notes}`);
        }
      }
      lines.push('');

      if (report.rollbackPlan.warnings.length > 0) {
        lines.push('### Warnings');
        lines.push('');
        for (const warning of report.rollbackPlan.warnings) {
          lines.push(`> [!WARNING] ${warning}`);
        }
        lines.push('');
      }
    }

    // 追加ノート
    if (report.additionalNotes) {
      lines.push('## Additional Notes');
      lines.push('');
      lines.push(report.additionalNotes);
      lines.push('');
    }

    // 添付ファイル
    if (report.attachments && report.attachments.length > 0) {
      lines.push('## Attachments');
      lines.push('');
      for (const attachment of report.attachments) {
        lines.push(`- ${attachment}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ========================================
// Singleton Instance
// ========================================

let verificationReportGeneratorInstance: VerificationReportGenerator | null = null;

/**
 * VerificationReportGeneratorのシングルトンインスタンスを取得
 */
export function getVerificationReportGenerator(
  config?: Partial<AidosConfig>
): VerificationReportGenerator {
  if (!verificationReportGeneratorInstance) {
    verificationReportGeneratorInstance = new VerificationReportGenerator(config);
  }
  return verificationReportGeneratorInstance;
}

/**
 * VerificationReportGeneratorインスタンスをリセット（テスト用）
 */
export function resetVerificationReportGenerator(): void {
  verificationReportGeneratorInstance = null;
}
