/**
 * コードレビューア
 *
 * エージェントが生成したコードの品質チェック
 * - 基本的なコード品質チェック
 * - レビューコメント生成
 * - 改善提案
 */

import { EventEmitter } from 'events';
import { AidosConfig, DEFAULT_CONFIG } from '../types.js';
import { Artifact, ArtifactType } from '../output/artifact-manager.js';

// ========================================
// Types
// ========================================

/**
 * レビュー重要度
 */
export type ReviewSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * レビューカテゴリ
 */
export type ReviewCategory =
  | 'style'
  | 'performance'
  | 'security'
  | 'maintainability'
  | 'bug'
  | 'documentation'
  | 'best-practice'
  | 'other';

/**
 * レビューコメント
 */
export interface ReviewComment {
  id: string;
  line?: number;
  endLine?: number;
  column?: number;
  endColumn?: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
  suggestion?: string;
  rule?: string;
  autoFixable: boolean;
}

/**
 * レビュー結果
 */
export interface ReviewResult {
  artifactId: string;
  artifactName: string;
  language?: string;
  passed: boolean;
  score: number; // 0-100
  comments: ReviewComment[];
  summary: ReviewSummary;
  metadata: ReviewMetadata;
}

/**
 * レビューサマリー
 */
export interface ReviewSummary {
  totalIssues: number;
  bySeverity: Record<ReviewSeverity, number>;
  byCategory: Record<ReviewCategory, number>;
  improvements: string[];
  strengths: string[];
}

/**
 * レビューメタデータ
 */
export interface ReviewMetadata {
  reviewedAt: Date;
  reviewDurationMs: number;
  rulesApplied: string[];
  linesReviewed: number;
}

/**
 * レビュールール
 */
export interface ReviewRule {
  id: string;
  name: string;
  description: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  languages: string[];
  pattern?: RegExp;
  check: (context: RuleContext) => ReviewComment[];
  autoFix?: (code: string, comment: ReviewComment) => string;
}

/**
 * ルールコンテキスト
 */
export interface RuleContext {
  content: string;
  lines: string[];
  language?: string;
  artifact: Partial<Artifact>;
}

/**
 * レビューオプション
 */
export interface ReviewOptions {
  rules?: string[];
  excludeRules?: string[];
  severityThreshold?: ReviewSeverity;
  maxIssues?: number;
  categories?: ReviewCategory[];
  autoFix?: boolean;
}

/**
 * レビューイベント
 */
export type CodeReviewerEvent =
  | 'review:start'
  | 'review:progress'
  | 'review:complete'
  | 'review:error';

// ========================================
// Built-in Review Rules
// ========================================

const BUILTIN_RULES: ReviewRule[] = [
  // === Style Rules ===
  {
    id: 'no-trailing-whitespace',
    name: 'No Trailing Whitespace',
    description: '行末の不要な空白を検出',
    category: 'style',
    severity: 'info',
    languages: ['*'],
    pattern: /\s+$/,
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      ctx.lines.forEach((line, index) => {
        if (/\s+$/.test(line)) {
          comments.push({
            id: `trailing-ws-${index}`,
            line: index + 1,
            severity: 'info',
            category: 'style',
            message: '行末に不要な空白があります',
            suggestion: line.trimEnd(),
            rule: 'no-trailing-whitespace',
            autoFixable: true,
          });
        }
      });
      return comments;
    },
  },
  {
    id: 'max-line-length',
    name: 'Maximum Line Length',
    description: '行の長さが120文字を超えていないかチェック',
    category: 'style',
    severity: 'warning',
    languages: ['*'],
    check: (ctx) => {
      const maxLength = 120;
      const comments: ReviewComment[] = [];
      ctx.lines.forEach((line, index) => {
        if (line.length > maxLength) {
          comments.push({
            id: `line-length-${index}`,
            line: index + 1,
            severity: 'warning',
            category: 'style',
            message: `行が${maxLength}文字を超えています（${line.length}文字）`,
            rule: 'max-line-length',
            autoFixable: false,
          });
        }
      });
      return comments;
    },
  },
  {
    id: 'consistent-indentation',
    name: 'Consistent Indentation',
    description: 'インデントの一貫性をチェック',
    category: 'style',
    severity: 'info',
    languages: ['typescript', 'javascript'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      let usesSpaces = false;
      let usesTabs = false;

      ctx.lines.forEach((line) => {
        if (/^  /.test(line)) usesSpaces = true;
        if (/^\t/.test(line)) usesTabs = true;
      });

      if (usesSpaces && usesTabs) {
        comments.push({
          id: 'mixed-indentation',
          severity: 'warning',
          category: 'style',
          message: 'スペースとタブが混在しています。一貫したインデントを使用してください',
          rule: 'consistent-indentation',
          autoFixable: false,
        });
      }

      return comments;
    },
  },

  // === Security Rules ===
  {
    id: 'no-hardcoded-secrets',
    name: 'No Hardcoded Secrets',
    description: 'ハードコードされた秘密情報を検出',
    category: 'security',
    severity: 'critical',
    languages: ['*'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      const secretPatterns = [
        { pattern: /password\s*[:=]\s*['"][^'"]+['"]/gi, name: 'パスワード' },
        { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi, name: 'APIキー' },
        { pattern: /secret\s*[:=]\s*['"][^'"]+['"]/gi, name: 'シークレット' },
        { pattern: /token\s*[:=]\s*['"][^'"]+['"]/gi, name: 'トークン' },
        { pattern: /private[_-]?key\s*[:=]/gi, name: '秘密鍵' },
      ];

      ctx.lines.forEach((line, index) => {
        secretPatterns.forEach(({ pattern, name }) => {
          if (pattern.test(line)) {
            comments.push({
              id: `hardcoded-secret-${index}`,
              line: index + 1,
              severity: 'critical',
              category: 'security',
              message: `${name}がハードコードされている可能性があります`,
              suggestion: '環境変数または設定ファイルを使用してください',
              rule: 'no-hardcoded-secrets',
              autoFixable: false,
            });
          }
        });
      });

      return comments;
    },
  },
  {
    id: 'no-eval',
    name: 'No Eval',
    description: 'eval()の使用を検出',
    category: 'security',
    severity: 'error',
    languages: ['typescript', 'javascript'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      ctx.lines.forEach((line, index) => {
        if (/\beval\s*\(/.test(line)) {
          comments.push({
            id: `no-eval-${index}`,
            line: index + 1,
            severity: 'error',
            category: 'security',
            message: 'eval()の使用はセキュリティリスクがあります',
            suggestion: 'JSON.parse()や他の安全な代替手段を使用してください',
            rule: 'no-eval',
            autoFixable: false,
          });
        }
      });
      return comments;
    },
  },

  // === Performance Rules ===
  {
    id: 'no-nested-loops',
    name: 'No Deeply Nested Loops',
    description: '深くネストされたループを検出',
    category: 'performance',
    severity: 'warning',
    languages: ['typescript', 'javascript', 'python'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      const loopPatterns = [/\bfor\s*\(/, /\bwhile\s*\(/, /\.forEach\s*\(/];
      let nestLevel = 0;
      let loopStartLine = -1;

      ctx.lines.forEach((line, index) => {
        const hasLoop = loopPatterns.some((p) => p.test(line));
        if (hasLoop) {
          nestLevel++;
          if (nestLevel === 1) loopStartLine = index;
          if (nestLevel >= 3) {
            comments.push({
              id: `nested-loop-${index}`,
              line: index + 1,
              severity: 'warning',
              category: 'performance',
              message: `ループのネストが深すぎます（レベル${nestLevel}）`,
              suggestion:
                '関数に分割するか、アルゴリズムを見直してください',
              rule: 'no-nested-loops',
              autoFixable: false,
            });
          }
        }
        // Simple brace counting for tracking (not perfect but works for basic cases)
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        if (closeBraces > openBraces && nestLevel > 0) {
          nestLevel = Math.max(0, nestLevel - (closeBraces - openBraces));
        }
      });

      return comments;
    },
  },

  // === Maintainability Rules ===
  {
    id: 'function-length',
    name: 'Function Length',
    description: '関数の長さをチェック',
    category: 'maintainability',
    severity: 'warning',
    languages: ['typescript', 'javascript'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      const maxLines = 50;
      let inFunction = false;
      let functionStart = 0;
      let braceCount = 0;
      let functionName = '';

      ctx.lines.forEach((line, index) => {
        const funcMatch = line.match(
          /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-z_]\w*)\s*=>)/i
        );
        if (funcMatch && !inFunction) {
          inFunction = true;
          functionStart = index;
          functionName = funcMatch[1] || funcMatch[2] || 'anonymous';
          braceCount = 0;
        }

        if (inFunction) {
          braceCount += (line.match(/{/g) || []).length;
          braceCount -= (line.match(/}/g) || []).length;

          if (braceCount === 0 && line.includes('}')) {
            const funcLength = index - functionStart + 1;
            if (funcLength > maxLines) {
              comments.push({
                id: `func-length-${functionStart}`,
                line: functionStart + 1,
                endLine: index + 1,
                severity: 'warning',
                category: 'maintainability',
                message: `関数 "${functionName}" が長すぎます（${funcLength}行）`,
                suggestion: `${maxLines}行以下に分割することを検討してください`,
                rule: 'function-length',
                autoFixable: false,
              });
            }
            inFunction = false;
          }
        }
      });

      return comments;
    },
  },
  {
    id: 'no-magic-numbers',
    name: 'No Magic Numbers',
    description: 'マジックナンバーを検出',
    category: 'maintainability',
    severity: 'info',
    languages: ['typescript', 'javascript'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      const allowedNumbers = [0, 1, -1, 2, 10, 100, 1000];

      ctx.lines.forEach((line, index) => {
        // Skip comments and const declarations
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
        if (/const\s+\w+\s*[:=]/.test(line)) return;

        const numbers = line.match(/(?<![a-zA-Z_$])\d+\.?\d*(?![a-zA-Z_$])/g);
        if (numbers) {
          numbers.forEach((num) => {
            const value = parseFloat(num);
            if (!allowedNumbers.includes(value) && !isNaN(value)) {
              comments.push({
                id: `magic-number-${index}-${num}`,
                line: index + 1,
                severity: 'info',
                category: 'maintainability',
                message: `マジックナンバー "${num}" を定数に抽出することを検討してください`,
                rule: 'no-magic-numbers',
                autoFixable: false,
              });
            }
          });
        }
      });

      return comments;
    },
  },

  // === Documentation Rules ===
  {
    id: 'require-function-docs',
    name: 'Require Function Documentation',
    description: '関数にJSDocコメントがあるかチェック',
    category: 'documentation',
    severity: 'info',
    languages: ['typescript', 'javascript'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      const funcPattern =
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-z_]\w*)\s*=>/i;

      ctx.lines.forEach((line, index) => {
        const match = line.match(funcPattern);
        if (match) {
          const funcName = match[1] || match[2];
          // Check if previous lines have JSDoc
          let hasDoc = false;
          for (let i = index - 1; i >= 0 && i >= index - 5; i--) {
            if (/\*\/\s*$/.test(ctx.lines[i])) {
              hasDoc = true;
              break;
            }
            if (ctx.lines[i].trim() && !/^\s*(\/\*|\*|\/\/)/.test(ctx.lines[i])) {
              break;
            }
          }

          if (!hasDoc && !funcName.startsWith('_')) {
            comments.push({
              id: `no-doc-${index}`,
              line: index + 1,
              severity: 'info',
              category: 'documentation',
              message: `関数 "${funcName}" にドキュメントコメントがありません`,
              suggestion: 'JSDoc形式でドキュメントを追加してください',
              rule: 'require-function-docs',
              autoFixable: false,
            });
          }
        }
      });

      return comments;
    },
  },

  // === Best Practice Rules ===
  {
    id: 'prefer-const',
    name: 'Prefer Const',
    description: '再代入されない変数にconstを推奨',
    category: 'best-practice',
    severity: 'info',
    languages: ['typescript', 'javascript'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      const letDeclarations: Map<string, number> = new Map();

      // First pass: find let declarations
      ctx.lines.forEach((line, index) => {
        const match = line.match(/\blet\s+(\w+)\s*[=:]/);
        if (match) {
          letDeclarations.set(match[1], index);
        }
      });

      // Second pass: check for reassignments
      const reassigned = new Set<string>();
      ctx.lines.forEach((line) => {
        letDeclarations.forEach((_, varName) => {
          const reassignPattern = new RegExp(
            `\\b${varName}\\s*(?:[+\\-*/%]?=|\\+\\+|--)`
          );
          // Skip the declaration line
          if (reassignPattern.test(line) && !line.includes('let ')) {
            reassigned.add(varName);
          }
        });
      });

      // Report variables that could be const
      letDeclarations.forEach((lineNum, varName) => {
        if (!reassigned.has(varName)) {
          comments.push({
            id: `prefer-const-${lineNum}`,
            line: lineNum + 1,
            severity: 'info',
            category: 'best-practice',
            message: `変数 "${varName}" は再代入されていません。constの使用を検討してください`,
            rule: 'prefer-const',
            autoFixable: true,
          });
        }
      });

      return comments;
    },
  },
  {
    id: 'no-console',
    name: 'No Console',
    description: '本番コードでのconsole使用を警告',
    category: 'best-practice',
    severity: 'warning',
    languages: ['typescript', 'javascript'],
    check: (ctx) => {
      const comments: ReviewComment[] = [];
      ctx.lines.forEach((line, index) => {
        if (/\bconsole\.(log|warn|error|info|debug)\s*\(/.test(line)) {
          // Skip if it looks like it's in a comment
          if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;

          comments.push({
            id: `no-console-${index}`,
            line: index + 1,
            severity: 'warning',
            category: 'best-practice',
            message: 'console出力は本番環境で削除するか、適切なロガーを使用してください',
            rule: 'no-console',
            autoFixable: false,
          });
        }
      });
      return comments;
    },
  },
];

// ========================================
// Code Reviewer Class
// ========================================

/**
 * コードレビューア
 */
export class CodeReviewer extends EventEmitter {
  private config: AidosConfig;
  private rules: Map<string, ReviewRule> = new Map();

  constructor(config: Partial<AidosConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadBuiltinRules();
  }

  /**
   * 組み込みルールをロード
   */
  private loadBuiltinRules(): void {
    BUILTIN_RULES.forEach((rule) => {
      this.rules.set(rule.id, rule);
    });
  }

  /**
   * カスタムルールを追加
   */
  addRule(rule: ReviewRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * ルールを削除
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * 利用可能なルールを取得
   */
  getRules(): ReviewRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * コードをレビュー
   */
  async review(
    artifact: Partial<Artifact> & { content: string; id: string; name: string },
    options: ReviewOptions = {}
  ): Promise<ReviewResult> {
    const startTime = Date.now();

    this.emit('review:start', { artifactId: artifact.id });

    try {
      const lines = artifact.content.split('\n');
      const context: RuleContext = {
        content: artifact.content,
        lines,
        language: artifact.language,
        artifact,
      };

      // 適用するルールをフィルタリング
      const applicableRules = this.getApplicableRules(
        artifact.language,
        options
      );

      // 各ルールを適用
      const allComments: ReviewComment[] = [];
      const appliedRules: string[] = [];

      for (const rule of applicableRules) {
        this.emit('review:progress', {
          artifactId: artifact.id,
          rule: rule.id,
          progress: (appliedRules.length / applicableRules.length) * 100,
        });

        try {
          const comments = rule.check(context);
          allComments.push(...comments);
          appliedRules.push(rule.id);
        } catch (error) {
          console.warn(`Rule ${rule.id} failed:`, error);
        }
      }

      // 重要度でフィルタリング
      const filteredComments = this.filterBySeverity(
        allComments,
        options.severityThreshold
      );

      // 最大件数で制限
      const limitedComments = options.maxIssues
        ? filteredComments.slice(0, options.maxIssues)
        : filteredComments;

      // サマリーを生成
      const summary = this.generateSummary(limitedComments, artifact.content);

      // スコアを計算
      const score = this.calculateScore(limitedComments, lines.length);

      const result: ReviewResult = {
        artifactId: artifact.id,
        artifactName: artifact.name,
        language: artifact.language,
        passed: score >= 70,
        score,
        comments: limitedComments,
        summary,
        metadata: {
          reviewedAt: new Date(),
          reviewDurationMs: Date.now() - startTime,
          rulesApplied: appliedRules,
          linesReviewed: lines.length,
        },
      };

      this.emit('review:complete', { result });

      return result;
    } catch (error) {
      this.emit('review:error', { artifactId: artifact.id, error });
      throw error;
    }
  }

  /**
   * 複数の成果物をレビュー
   */
  async reviewBatch(
    artifacts: Array<
      Partial<Artifact> & { content: string; id: string; name: string }
    >,
    options: ReviewOptions = {}
  ): Promise<ReviewResult[]> {
    const results: ReviewResult[] = [];

    for (const artifact of artifacts) {
      const result = await this.review(artifact, options);
      results.push(result);
    }

    return results;
  }

  /**
   * 文字列コンテンツを直接レビュー
   */
  async reviewContent(
    content: string,
    options: ReviewOptions & { language?: string; name?: string } = {}
  ): Promise<ReviewResult> {
    const artifact = {
      id: `temp-${Date.now()}`,
      name: options.name ?? 'temp-file',
      content,
      language: options.language,
    };

    return this.review(artifact, options);
  }

  /**
   * 自動修正を適用
   */
  applyAutoFixes(content: string, comments: ReviewComment[]): string {
    const fixableComments = comments.filter((c) => c.autoFixable && c.suggestion);

    // 行番号でソート（降順）- 後ろから修正して行番号がずれないようにする
    const sorted = [...fixableComments].sort(
      (a, b) => (b.line ?? 0) - (a.line ?? 0)
    );

    const lines = content.split('\n');

    for (const comment of sorted) {
      if (comment.line && comment.suggestion) {
        // 行全体を置換する場合
        lines[comment.line - 1] = comment.suggestion;
      }
    }

    return lines.join('\n');
  }

  // ========================================
  // Private Methods
  // ========================================

  /**
   * 適用可能なルールを取得
   */
  private getApplicableRules(
    language: string | undefined,
    options: ReviewOptions
  ): ReviewRule[] {
    let rules = Array.from(this.rules.values());

    // 言語でフィルタリング
    rules = rules.filter(
      (rule) =>
        rule.languages.includes('*') ||
        (language && rule.languages.includes(language))
    );

    // 指定ルールのみに制限
    if (options.rules && options.rules.length > 0) {
      rules = rules.filter((rule) => options.rules!.includes(rule.id));
    }

    // 除外ルールを削除
    if (options.excludeRules && options.excludeRules.length > 0) {
      rules = rules.filter((rule) => !options.excludeRules!.includes(rule.id));
    }

    // カテゴリでフィルタリング
    if (options.categories && options.categories.length > 0) {
      rules = rules.filter((rule) => options.categories!.includes(rule.category));
    }

    return rules;
  }

  /**
   * 重要度でフィルタリング
   */
  private filterBySeverity(
    comments: ReviewComment[],
    threshold?: ReviewSeverity
  ): ReviewComment[] {
    if (!threshold) return comments;

    const severityOrder: ReviewSeverity[] = ['info', 'warning', 'error', 'critical'];
    const thresholdIndex = severityOrder.indexOf(threshold);

    return comments.filter(
      (comment) => severityOrder.indexOf(comment.severity) >= thresholdIndex
    );
  }

  /**
   * サマリーを生成
   */
  private generateSummary(
    comments: ReviewComment[],
    content: string
  ): ReviewSummary {
    const bySeverity: Record<ReviewSeverity, number> = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0,
    };

    const byCategory: Record<ReviewCategory, number> = {
      style: 0,
      performance: 0,
      security: 0,
      maintainability: 0,
      bug: 0,
      documentation: 0,
      'best-practice': 0,
      other: 0,
    };

    comments.forEach((comment) => {
      bySeverity[comment.severity]++;
      byCategory[comment.category]++;
    });

    const improvements: string[] = [];
    const strengths: string[] = [];

    // 改善点を生成
    if (bySeverity.critical > 0) {
      improvements.push(
        `${bySeverity.critical}件のクリティカルな問題があります。早急に対応してください。`
      );
    }
    if (bySeverity.error > 0) {
      improvements.push(`${bySeverity.error}件のエラーを修正してください。`);
    }
    if (byCategory.security > 0) {
      improvements.push('セキュリティに関する問題があります。確認してください。');
    }
    if (byCategory.performance > 0) {
      improvements.push('パフォーマンスの改善余地があります。');
    }

    // 良い点を生成
    if (bySeverity.critical === 0 && bySeverity.error === 0) {
      strengths.push('重大な問題は検出されませんでした。');
    }
    if (byCategory.security === 0) {
      strengths.push('セキュリティ上の問題は検出されませんでした。');
    }
    if (comments.length < 5) {
      strengths.push('コード品質は良好です。');
    }

    return {
      totalIssues: comments.length,
      bySeverity,
      byCategory,
      improvements,
      strengths,
    };
  }

  /**
   * スコアを計算
   */
  private calculateScore(comments: ReviewComment[], totalLines: number): number {
    if (totalLines === 0) return 100;

    const weights: Record<ReviewSeverity, number> = {
      info: 1,
      warning: 3,
      error: 10,
      critical: 25,
    };

    let penalty = 0;
    comments.forEach((comment) => {
      penalty += weights[comment.severity];
    });

    // ペナルティを行数で正規化
    const normalizedPenalty = (penalty / totalLines) * 10;

    return Math.max(0, Math.min(100, 100 - normalizedPenalty));
  }
}

// ========================================
// Singleton Instance
// ========================================

let codeReviewerInstance: CodeReviewer | null = null;

/**
 * CodeReviewerのシングルトンインスタンスを取得
 */
export function getCodeReviewer(config?: Partial<AidosConfig>): CodeReviewer {
  if (!codeReviewerInstance) {
    codeReviewerInstance = new CodeReviewer(config);
  }
  return codeReviewerInstance;
}

/**
 * CodeReviewerインスタンスをリセット（テスト用）
 */
export function resetCodeReviewer(): void {
  codeReviewerInstance = null;
}
