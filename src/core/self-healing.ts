/**
 * 自己修復ループ
 *
 * 失敗時の自動修復機能を提供
 * - エラー分類（syntax, type, test, runtime）
 * - 修正案の生成
 * - 修正の適用
 * - 再検証
 * - 上限回数超過時のエスカレーション
 */

import { EventEmitter } from 'events';
import { AidosError } from '../types.js';

// ========================================
// Types
// ========================================

/**
 * エラータイプ
 */
export type ErrorType = 'syntax' | 'type' | 'test' | 'runtime' | 'unknown';

/**
 * 修復検証結果
 */
export type VerificationResult = 'success' | 'failed';

/**
 * 修復エラー
 */
export interface HealingError {
  type: ErrorType;
  message: string;
  stack?: string;
  location?: ErrorLocation;
  context?: Record<string, unknown>;
}

/**
 * エラー位置情報
 */
export interface ErrorLocation {
  file?: string;
  line?: number;
  column?: number;
}

/**
 * 修復試行
 */
export interface HealingAttempt {
  attempt: number;
  errorType: ErrorType;
  originalError: string;
  proposedFix: string;
  fixApplied: boolean;
  verificationResult: VerificationResult;
  timestamp: Date;
  durationMs: number;
}

/**
 * 修復結果
 */
export interface HealingResult {
  success: boolean;
  attempts: HealingAttempt[];
  finalError?: string;
  escalated: boolean;
  totalDurationMs: number;
}

/**
 * 自己修復設定
 */
export interface SelfHealingConfig {
  maxRetries: number;
  retryDelayMs: number;
  escalationCallback?: (error: HealingError) => void | Promise<void>;
  verificationTimeoutMs?: number;
  enableLogging?: boolean;
}

/**
 * 修復コンテキスト
 */
export interface HealingContext {
  content: string;
  filename?: string;
  language?: string;
  additionalContext?: Record<string, unknown>;
}

/**
 * 修正戦略
 */
export interface FixStrategy {
  id: string;
  name: string;
  description: string;
  applicableErrors: ErrorType[];
  generateFix: (error: HealingError, context: HealingContext) => Promise<string>;
  verify: (fixedContent: string, context: HealingContext) => Promise<boolean>;
}

/**
 * 自己修復イベント
 */
export type SelfHealingEvent =
  | 'healing:start'
  | 'healing:attempt'
  | 'healing:fix_generated'
  | 'healing:fix_applied'
  | 'healing:verification_start'
  | 'healing:verification_complete'
  | 'healing:success'
  | 'healing:failed'
  | 'healing:escalated'
  | 'healing:error';

// ========================================
// Default Configuration
// ========================================

export const DEFAULT_SELF_HEALING_CONFIG: SelfHealingConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  verificationTimeoutMs: 30000,
  enableLogging: false,
};

// ========================================
// Error Classifier
// ========================================

/**
 * エラー分類器
 */
export class ErrorClassifier {
  /**
   * エラーを分類
   */
  classify(error: Error | string): ErrorType {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorName = typeof error === 'string' ? '' : error.name;

    // Syntax errors (check first as they are most specific)
    if (this.isSyntaxError(errorMessage, errorName)) {
      return 'syntax';
    }

    // Runtime errors (check before type errors to handle ReferenceError etc)
    if (this.isRuntimeError(errorMessage, errorName)) {
      return 'runtime';
    }

    // Type errors
    if (this.isTypeError(errorMessage, errorName)) {
      return 'type';
    }

    // Test errors
    if (this.isTestError(errorMessage, errorName)) {
      return 'test';
    }

    return 'unknown';
  }

  /**
   * HealingErrorを生成
   */
  createHealingError(
    error: Error | string,
    context?: Record<string, unknown>
  ): HealingError {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorStack = typeof error === 'string' ? undefined : error.stack;

    return {
      type: this.classify(error),
      message: errorMessage,
      stack: errorStack,
      location: this.extractLocation(errorStack),
      context,
    };
  }

  private isSyntaxError(message: string, name: string): boolean {
    const syntaxPatterns = [
      /SyntaxError/i,
      /Unexpected token/i,
      /Unexpected identifier/i,
      /Unexpected end of/i,
      /Invalid or unexpected token/i,
      /Missing.*semicolon/i,
      /Unterminated string/i,
      /Invalid left-hand side/i,
      /Unexpected reserved word/i,
      /Invalid regular expression/i,
    ];

    return (
      name === 'SyntaxError' ||
      syntaxPatterns.some((pattern) => pattern.test(message))
    );
  }

  private isTypeError(message: string, name: string): boolean {
    const typePatterns = [
      /TypeError/i,
      /is not a function/i,
      /Cannot read propert/i,
      /Cannot set propert/i,
      /is not iterable/i,
      /is not assignable to/i,
      /Type .* is not assignable/i,
      /Property .* does not exist/i,
      /Argument of type .* is not assignable/i,
      /Cannot find name/i,
      /has no exported member/i,
    ];

    return (
      name === 'TypeError' ||
      typePatterns.some((pattern) => pattern.test(message))
    );
  }

  private isTestError(message: string, name: string): boolean {
    const testPatterns = [
      /AssertionError/i,
      /Expected.*to.*equal/i,
      /Expected.*to.*be/i,
      /Expected.*but.*received/i,
      /toBe|toEqual|toMatch|toContain|toThrow/i,
      /test.*failed/i,
      /assertion.*failed/i,
      /expect\(.*\)/i,
      /assert\./i,
    ];

    return (
      name === 'AssertionError' ||
      testPatterns.some((pattern) => pattern.test(message))
    );
  }

  private isRuntimeError(message: string, name: string): boolean {
    const runtimePatterns = [
      /ReferenceError/i,
      /RangeError/i,
      /EvalError/i,
      /URIError/i,
      /Maximum call stack/i,
      /Out of memory/i,
      /ENOENT/i,
      /EACCES/i,
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /heap out of memory/i,
      /\bis not defined\b/i,  // ReferenceError pattern
    ];

    const runtimeNames = ['ReferenceError', 'RangeError', 'EvalError', 'URIError'];

    return (
      runtimeNames.includes(name) ||
      runtimePatterns.some((pattern) => pattern.test(message))
    );
  }

  private extractLocation(stack?: string): ErrorLocation | undefined {
    if (!stack) return undefined;

    // Extract file:line:column from stack trace
    const match = stack.match(/at\s+(?:.*?\s+)?(?:\()?(.+?):(\d+):(\d+)\)?/);
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
      };
    }

    return undefined;
  }
}

// ========================================
// Built-in Fix Strategies
// ========================================

const BUILTIN_STRATEGIES: FixStrategy[] = [
  {
    id: 'syntax-semicolon',
    name: 'Missing Semicolon Fix',
    description: 'Adds missing semicolons at the end of statements',
    applicableErrors: ['syntax'],
    generateFix: async (error, context) => {
      const lines = context.content.split('\n');
      const errorLine = error.location?.line;

      // If we have a specific line number, fix that line
      if (errorLine && errorLine <= lines.length) {
        const line = lines[errorLine - 1];
        if (!line.trim().endsWith(';') && !line.trim().endsWith('{') && !line.trim().endsWith('}')) {
          lines[errorLine - 1] = line.trimEnd() + ';';
          return lines.join('\n');
        }
      }

      // Otherwise, scan all lines and add semicolons where potentially missing
      let modified = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Only add semicolons to lines that look like statements
        if (line &&
            !line.endsWith(';') &&
            !line.endsWith('{') &&
            !line.endsWith('}') &&
            !line.endsWith(',') &&
            !line.startsWith('//') &&
            !line.startsWith('/*') &&
            !line.startsWith('*') &&
            (line.includes('=') || line.includes('const ') || line.includes('let ') || line.includes('var ') || line.includes('return '))) {
          lines[i] = lines[i].trimEnd() + ';';
          modified = true;
        }
      }

      return modified ? lines.join('\n') : context.content;
    },
    verify: async (fixedContent) => {
      // Basic syntax check - try to parse
      try {
        // Simple check: balanced braces
        const braces = fixedContent.match(/[{}]/g) || [];
        let count = 0;
        for (const brace of braces) {
          count += brace === '{' ? 1 : -1;
          if (count < 0) return false;
        }
        return count === 0;
      } catch {
        return false;
      }
    },
  },
  {
    id: 'type-null-check',
    name: 'Null Check Fix',
    description: 'Adds null/undefined checks for property access',
    applicableErrors: ['type', 'runtime'],
    generateFix: async (error, context) => {
      const content = context.content;

      // Replace `obj.prop` with `obj?.prop` for potential null access
      if (error.message.includes('Cannot read propert')) {
        const propMatch = error.message.match(/property ['"]?(\w+)['"]?/);
        if (propMatch) {
          const prop = propMatch[1];
          // Simple replacement - add optional chaining
          return content.replace(
            new RegExp(`(\\w+)\\.${prop}`, 'g'),
            `$1?.${prop}`
          );
        }
      }

      return content;
    },
    verify: async () => true,
  },
  {
    id: 'test-assertion-fix',
    name: 'Test Assertion Fix',
    description: 'Adjusts test expectations based on actual values',
    applicableErrors: ['test'],
    generateFix: async (error, context) => {
      // This is a placeholder - real implementation would analyze the test failure
      // and suggest appropriate fixes based on the actual vs expected values
      return context.content;
    },
    verify: async () => true,
  },
];

// ========================================
// Self Healing Loop Class
// ========================================

/**
 * 自己修復ループ
 */
export class SelfHealingLoop extends EventEmitter {
  private config: SelfHealingConfig;
  private classifier: ErrorClassifier;
  private strategies: Map<string, FixStrategy> = new Map();
  private isHealing: boolean = false;

  constructor(config: Partial<SelfHealingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SELF_HEALING_CONFIG, ...config };
    this.classifier = new ErrorClassifier();
    this.loadBuiltinStrategies();
  }

  /**
   * 組み込み戦略をロード
   */
  private loadBuiltinStrategies(): void {
    BUILTIN_STRATEGIES.forEach((strategy) => {
      this.strategies.set(strategy.id, strategy);
    });
  }

  /**
   * カスタム修正戦略を追加
   */
  addStrategy(strategy: FixStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * 修正戦略を削除
   */
  removeStrategy(strategyId: string): boolean {
    return this.strategies.delete(strategyId);
  }

  /**
   * 利用可能な戦略を取得
   */
  getStrategies(): FixStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * エラーを分類
   */
  classifyError(error: Error | string): HealingError {
    return this.classifier.createHealingError(error);
  }

  /**
   * 修復ループを実行
   */
  async heal(
    error: Error | string,
    context: HealingContext,
    customVerify?: (content: string) => Promise<boolean>
  ): Promise<HealingResult> {
    if (this.isHealing) {
      throw new SelfHealingError(
        'Healing already in progress',
        'HEALING_IN_PROGRESS'
      );
    }

    this.isHealing = true;
    const startTime = Date.now();
    const attempts: HealingAttempt[] = [];
    let currentContent = context.content;
    let healingError = this.classifier.createHealingError(error);

    this.emit('healing:start', {
      error: healingError,
      maxRetries: this.config.maxRetries,
    });

    try {
      for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
        const attemptStartTime = Date.now();

        this.emit('healing:attempt', {
          attempt,
          maxAttempts: this.config.maxRetries,
          errorType: healingError.type,
        });

        // 適用可能な戦略を取得
        const applicableStrategies = this.getApplicableStrategies(healingError.type);

        if (applicableStrategies.length === 0) {
          this.log(`No applicable strategies for error type: ${healingError.type}`);

          attempts.push({
            attempt,
            errorType: healingError.type,
            originalError: healingError.message,
            proposedFix: '',
            fixApplied: false,
            verificationResult: 'failed',
            timestamp: new Date(),
            durationMs: Date.now() - attemptStartTime,
          });

          continue;
        }

        // 各戦略を試行
        let fixApplied = false;
        let fixedContent = currentContent;
        let proposedFix = '';

        for (const strategy of applicableStrategies) {
          try {
            this.log(`Trying strategy: ${strategy.name}`);

            // 修正案を生成
            proposedFix = await strategy.generateFix(
              healingError,
              { ...context, content: currentContent }
            );

            this.emit('healing:fix_generated', {
              attempt,
              strategyId: strategy.id,
              proposedFix,
            });

            if (proposedFix && proposedFix !== currentContent) {
              fixedContent = proposedFix;
              fixApplied = true;

              this.emit('healing:fix_applied', {
                attempt,
                strategyId: strategy.id,
              });

              break;
            }
          } catch (strategyError) {
            this.log(`Strategy ${strategy.id} failed: ${strategyError}`);
          }
        }

        // 検証を実行
        this.emit('healing:verification_start', { attempt });

        let verificationResult: VerificationResult = 'failed';

        if (fixApplied) {
          try {
            const verifyFn = customVerify || (async () => true);
            const verified = await this.withTimeout(
              verifyFn(fixedContent),
              this.config.verificationTimeoutMs || 30000
            );

            verificationResult = verified ? 'success' : 'failed';
          } catch (verifyError) {
            this.log(`Verification failed: ${verifyError}`);
            verificationResult = 'failed';

            // 新しいエラーで次の試行を行う
            if (verifyError instanceof Error) {
              healingError = this.classifier.createHealingError(verifyError);
            }
          }
        }

        this.emit('healing:verification_complete', {
          attempt,
          result: verificationResult,
        });

        attempts.push({
          attempt,
          errorType: healingError.type,
          originalError: healingError.message,
          proposedFix,
          fixApplied,
          verificationResult,
          timestamp: new Date(),
          durationMs: Date.now() - attemptStartTime,
        });

        // 成功した場合は終了
        if (verificationResult === 'success') {
          const result: HealingResult = {
            success: true,
            attempts,
            escalated: false,
            totalDurationMs: Date.now() - startTime,
          };

          this.emit('healing:success', { result });
          return result;
        }

        // 次の試行前に遅延
        if (attempt < this.config.maxRetries) {
          await this.delay(this.config.retryDelayMs);
        }

        // 修正が適用された場合は現在のコンテンツを更新
        if (fixApplied && verificationResult === 'failed') {
          // 検証失敗した修正は破棄して元に戻す
          fixedContent = currentContent;
        }
      }

      // 全試行が失敗した場合はエスカレーション
      this.log('All healing attempts failed, escalating...');

      const result: HealingResult = {
        success: false,
        attempts,
        finalError: healingError.message,
        escalated: true,
        totalDurationMs: Date.now() - startTime,
      };

      this.emit('healing:escalated', { error: healingError, attempts });

      // エスカレーションコールバックを実行
      if (this.config.escalationCallback) {
        await this.config.escalationCallback(healingError);
      }

      this.emit('healing:failed', { result });

      return result;
    } catch (unexpectedError) {
      this.emit('healing:error', { error: unexpectedError });
      throw unexpectedError;
    } finally {
      this.isHealing = false;
    }
  }

  /**
   * 修復が進行中かどうか
   */
  isHealingInProgress(): boolean {
    return this.isHealing;
  }

  /**
   * 設定を更新
   */
  updateConfig(config: Partial<SelfHealingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): SelfHealingConfig {
    return { ...this.config };
  }

  // ========================================
  // Private Methods
  // ========================================

  /**
   * 適用可能な戦略を取得
   */
  private getApplicableStrategies(errorType: ErrorType): FixStrategy[] {
    return Array.from(this.strategies.values()).filter((strategy) =>
      strategy.applicableErrors.includes(errorType)
    );
  }

  /**
   * タイムアウト付きPromise
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * 遅延
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * ログ出力
   */
  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[SelfHealingLoop] ${message}`);
    }
  }
}

// ========================================
// Error Types
// ========================================

/**
 * 自己修復関連エラー
 */
export class SelfHealingError extends AidosError {
  constructor(message: string, code: string) {
    super(message, code, true);
    this.name = 'SelfHealingError';
  }
}

// ========================================
// Singleton Instance
// ========================================

let selfHealingLoopInstance: SelfHealingLoop | null = null;

/**
 * SelfHealingLoopのシングルトンインスタンスを取得
 */
export function getSelfHealingLoop(
  config?: Partial<SelfHealingConfig>
): SelfHealingLoop {
  if (!selfHealingLoopInstance) {
    selfHealingLoopInstance = new SelfHealingLoop(config);
  }
  return selfHealingLoopInstance;
}

/**
 * SelfHealingLoopインスタンスをリセット（テスト用）
 */
export function resetSelfHealingLoop(): void {
  selfHealingLoopInstance = null;
}
