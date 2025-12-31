/**
 * テストジェネレーター
 *
 * コードからテストケースを自動生成
 * - テストケースの自動生成（モック）
 * - テストファイルの出力
 * - 複数のテストフレームワークサポート
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { AidosConfig, DEFAULT_CONFIG } from '../types.js';
import { Artifact } from '../output/artifact-manager.js';

// ========================================
// Types
// ========================================

/**
 * テストフレームワーク
 */
export type TestFramework = 'vitest' | 'jest' | 'mocha' | 'pytest' | 'swift-testing';

/**
 * テストの種類
 */
export type TestType = 'unit' | 'integration' | 'e2e' | 'snapshot';

/**
 * テストケース
 */
export interface TestCase {
  id: string;
  name: string;
  description: string;
  type: TestType;
  targetFunction?: string;
  targetClass?: string;
  inputs: TestInput[];
  expectedOutput: TestExpectation;
  setup?: string;
  teardown?: string;
  tags: string[];
  priority: 'low' | 'medium' | 'high';
  generated: boolean;
}

/**
 * テスト入力
 */
export interface TestInput {
  name: string;
  type: string;
  value: unknown;
  description?: string;
}

/**
 * テスト期待値
 */
export interface TestExpectation {
  type: 'value' | 'throws' | 'resolves' | 'rejects' | 'matches' | 'snapshot';
  value?: unknown;
  errorType?: string;
  errorMessage?: string;
  matcher?: string;
}

/**
 * 生成されたテストスイート
 */
export interface TestSuite {
  id: string;
  name: string;
  description: string;
  framework: TestFramework;
  language: string;
  sourceArtifactId?: string;
  testCases: TestCase[];
  imports: string[];
  setupCode?: string;
  teardownCode?: string;
  metadata: TestSuiteMetadata;
}

/**
 * テストスイートメタデータ
 */
export interface TestSuiteMetadata {
  generatedAt: Date;
  generationDurationMs: number;
  sourceFile?: string;
  targetFunctions: string[];
  targetClasses: string[];
  coverage: CoverageEstimate;
}

/**
 * カバレッジ推定
 */
export interface CoverageEstimate {
  functions: number;
  branches: number;
  lines: number;
}

/**
 * テスト生成オプション
 */
export interface TestGenerationOptions {
  framework?: TestFramework;
  types?: TestType[];
  includeEdgeCases?: boolean;
  includeErrorCases?: boolean;
  maxTestsPerFunction?: number;
  targetFunctions?: string[];
  targetClasses?: string[];
  mockDependencies?: boolean;
  generateSnapshots?: boolean;
}

/**
 * 生成されたテストコード
 */
export interface GeneratedTestCode {
  suite: TestSuite;
  code: string;
  fileName: string;
  imports: string[];
}

/**
 * テストジェネレーターイベント
 */
export type TestGeneratorEvent =
  | 'generate:start'
  | 'generate:progress'
  | 'generate:complete'
  | 'generate:error';

// ========================================
// Code Analysis Types (for test generation)
// ========================================

/**
 * 解析された関数情報
 */
interface ParsedFunction {
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
  isAsync: boolean;
  isExported: boolean;
  body?: string;
}

/**
 * 解析されたクラス情報
 */
interface ParsedClass {
  name: string;
  methods: ParsedFunction[];
  isExported: boolean;
}

// ========================================
// Test Generator Class
// ========================================

/**
 * テストジェネレーター
 */
export class TestGenerator extends EventEmitter {
  private config: AidosConfig;

  constructor(config: Partial<AidosConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * コードからテストスイートを生成
   */
  async generate(
    artifact: Partial<Artifact> & { content: string; id?: string; name: string },
    options: TestGenerationOptions = {}
  ): Promise<GeneratedTestCode> {
    const startTime = Date.now();
    const framework = options.framework ?? this.detectFramework(artifact.language);

    this.emit('generate:start', {
      artifactName: artifact.name,
      framework,
    });

    try {
      // コードを解析
      const { functions, classes } = this.parseCode(artifact.content, artifact.language);

      this.emit('generate:progress', {
        step: 'parsing',
        progress: 25,
      });

      // テストケースを生成
      const testCases = this.generateTestCases(
        functions,
        classes,
        options
      );

      this.emit('generate:progress', {
        step: 'generating',
        progress: 50,
      });

      // テストスイートを作成
      const suite: TestSuite = {
        id: uuidv4(),
        name: `${artifact.name} Tests`,
        description: `Auto-generated tests for ${artifact.name}`,
        framework,
        language: artifact.language ?? 'typescript',
        sourceArtifactId: artifact.id,
        testCases,
        imports: this.generateImports(framework, artifact.name),
        setupCode: this.generateSetupCode(framework, options),
        teardownCode: this.generateTeardownCode(framework, options),
        metadata: {
          generatedAt: new Date(),
          generationDurationMs: 0,
          sourceFile: artifact.name,
          targetFunctions: functions.map((f) => f.name),
          targetClasses: classes.map((c) => c.name),
          coverage: this.estimateCoverage(testCases, functions, classes),
        },
      };

      this.emit('generate:progress', {
        step: 'formatting',
        progress: 75,
      });

      // テストコードを生成
      const code = this.generateTestCode(suite, framework);
      const fileName = this.generateTestFileName(artifact.name, framework);

      suite.metadata.generationDurationMs = Date.now() - startTime;

      const result: GeneratedTestCode = {
        suite,
        code,
        fileName,
        imports: suite.imports,
      };

      this.emit('generate:complete', { result });

      return result;
    } catch (error) {
      this.emit('generate:error', { artifactName: artifact.name, error });
      throw error;
    }
  }

  /**
   * 複数のアーティファクトからテストを生成
   */
  async generateBatch(
    artifacts: Array<Partial<Artifact> & { content: string; id?: string; name: string }>,
    options: TestGenerationOptions = {}
  ): Promise<GeneratedTestCode[]> {
    const results: GeneratedTestCode[] = [];

    for (const artifact of artifacts) {
      try {
        const result = await this.generate(artifact, options);
        results.push(result);
      } catch (error) {
        console.warn(`Failed to generate tests for ${artifact.name}:`, error);
      }
    }

    return results;
  }

  /**
   * テストケースをマニュアルで作成
   */
  createTestCase(options: Partial<TestCase> & { name: string }): TestCase {
    return {
      id: uuidv4(),
      name: options.name,
      description: options.description ?? '',
      type: options.type ?? 'unit',
      targetFunction: options.targetFunction,
      targetClass: options.targetClass,
      inputs: options.inputs ?? [],
      expectedOutput: options.expectedOutput ?? { type: 'value', value: undefined },
      setup: options.setup,
      teardown: options.teardown,
      tags: options.tags ?? [],
      priority: options.priority ?? 'medium',
      generated: false,
    };
  }

  // ========================================
  // Code Parsing
  // ========================================

  /**
   * コードを解析して関数とクラスを抽出
   */
  private parseCode(
    content: string,
    language?: string
  ): { functions: ParsedFunction[]; classes: ParsedClass[] } {
    // 簡易的なパーサー（本番では ts-morph や babel を使用）
    const functions: ParsedFunction[] = [];
    const classes: ParsedClass[] = [];

    if (language === 'typescript' || language === 'javascript' || !language) {
      // 関数を抽出
      const funcPatterns = [
        // function declaration
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g,
        // arrow function assigned to const/let
        /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([^=]+))?\s*=>/g,
      ];

      for (const pattern of funcPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const [, name, paramsStr, returnType] = match;
          const params = this.parseParams(paramsStr);
          const isAsync = match[0].includes('async');
          const isExported = match[0].includes('export');

          functions.push({
            name,
            params,
            returnType: returnType?.trim() || 'unknown',
            isAsync,
            isExported,
          });
        }
      }

      // クラスを抽出
      const classPattern =
        /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
      let classMatch;
      while ((classMatch = classPattern.exec(content)) !== null) {
        const [fullMatch, className, classBody] = classMatch;
        const isExported = fullMatch.includes('export');

        // クラス内のメソッドを抽出
        const methods: ParsedFunction[] = [];
        const methodPattern =
          /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g;
        let methodMatch;
        while ((methodMatch = methodPattern.exec(classBody)) !== null) {
          const [, name, paramsStr, returnType] = methodMatch;
          if (name !== 'constructor') {
            methods.push({
              name,
              params: this.parseParams(paramsStr),
              returnType: returnType?.trim() || 'unknown',
              isAsync: methodMatch[0].includes('async'),
              isExported: false,
            });
          }
        }

        classes.push({
          name: className,
          methods,
          isExported,
        });
      }
    }

    return { functions, classes };
  }

  /**
   * パラメータ文字列をパース
   */
  private parseParams(paramsStr: string): Array<{ name: string; type: string }> {
    if (!paramsStr.trim()) return [];

    return paramsStr.split(',').map((param) => {
      const parts = param.trim().split(':');
      const name = parts[0]?.replace(/[?=].*/, '').trim() || 'arg';
      const type = parts[1]?.trim() || 'unknown';
      return { name, type };
    });
  }

  // ========================================
  // Test Case Generation
  // ========================================

  /**
   * テストケースを生成
   */
  private generateTestCases(
    functions: ParsedFunction[],
    classes: ParsedClass[],
    options: TestGenerationOptions
  ): TestCase[] {
    const testCases: TestCase[] = [];
    const maxTests = options.maxTestsPerFunction ?? 5;

    // 関数のテストを生成
    for (const func of functions) {
      if (
        options.targetFunctions &&
        !options.targetFunctions.includes(func.name)
      ) {
        continue;
      }

      // 基本テスト
      testCases.push(this.createBasicFunctionTest(func));

      // エッジケース
      if (options.includeEdgeCases) {
        testCases.push(...this.createEdgeCaseTests(func).slice(0, maxTests - 1));
      }

      // エラーケース
      if (options.includeErrorCases) {
        testCases.push(...this.createErrorCaseTests(func).slice(0, 2));
      }
    }

    // クラスのテストを生成
    for (const cls of classes) {
      if (options.targetClasses && !options.targetClasses.includes(cls.name)) {
        continue;
      }

      for (const method of cls.methods) {
        testCases.push(this.createBasicMethodTest(cls, method));

        if (options.includeEdgeCases) {
          testCases.push(
            ...this.createEdgeCaseTests(method, cls.name).slice(0, maxTests - 1)
          );
        }
      }
    }

    return testCases;
  }

  /**
   * 基本的な関数テストを作成
   */
  private createBasicFunctionTest(func: ParsedFunction): TestCase {
    const inputs = func.params.map((param) => ({
      name: param.name,
      type: param.type,
      value: this.generateMockValue(param.type),
      description: `${param.name} parameter`,
    }));

    return {
      id: uuidv4(),
      name: `should execute ${func.name} successfully`,
      description: `Tests basic execution of ${func.name}`,
      type: 'unit',
      targetFunction: func.name,
      inputs,
      expectedOutput: {
        type: func.isAsync ? 'resolves' : 'value',
        value: this.generateExpectedValue(func.returnType),
      },
      tags: ['auto-generated', 'basic'],
      priority: 'high',
      generated: true,
    };
  }

  /**
   * 基本的なメソッドテストを作成
   */
  private createBasicMethodTest(cls: ParsedClass, method: ParsedFunction): TestCase {
    const inputs = method.params.map((param) => ({
      name: param.name,
      type: param.type,
      value: this.generateMockValue(param.type),
    }));

    return {
      id: uuidv4(),
      name: `should execute ${cls.name}.${method.name} successfully`,
      description: `Tests basic execution of ${cls.name}.${method.name}`,
      type: 'unit',
      targetClass: cls.name,
      targetFunction: method.name,
      inputs,
      expectedOutput: {
        type: method.isAsync ? 'resolves' : 'value',
        value: this.generateExpectedValue(method.returnType),
      },
      setup: `const instance = new ${cls.name}();`,
      tags: ['auto-generated', 'basic', 'class-method'],
      priority: 'high',
      generated: true,
    };
  }

  /**
   * エッジケーステストを作成
   */
  private createEdgeCaseTests(
    func: ParsedFunction,
    className?: string
  ): TestCase[] {
    const tests: TestCase[] = [];
    const prefix = className ? `${className}.` : '';

    // 空の入力テスト
    if (func.params.some((p) => p.type.includes('string'))) {
      tests.push({
        id: uuidv4(),
        name: `should handle empty string input for ${prefix}${func.name}`,
        description: 'Tests behavior with empty string input',
        type: 'unit',
        targetClass: className,
        targetFunction: func.name,
        inputs: func.params.map((p) => ({
          name: p.name,
          type: p.type,
          value: p.type.includes('string') ? '' : this.generateMockValue(p.type),
        })),
        expectedOutput: { type: 'value' },
        tags: ['auto-generated', 'edge-case', 'empty-input'],
        priority: 'medium',
        generated: true,
      });
    }

    // null/undefined入力テスト
    tests.push({
      id: uuidv4(),
      name: `should handle null/undefined input for ${prefix}${func.name}`,
      description: 'Tests behavior with null or undefined input',
      type: 'unit',
      targetClass: className,
      targetFunction: func.name,
      inputs: func.params.map((p) => ({
        name: p.name,
        type: p.type,
        value: null,
      })),
      expectedOutput: { type: 'throws', errorType: 'Error' },
      tags: ['auto-generated', 'edge-case', 'null-input'],
      priority: 'medium',
      generated: true,
    });

    // 配列の境界テスト
    if (func.params.some((p) => p.type.includes('[]') || p.type.includes('Array'))) {
      tests.push({
        id: uuidv4(),
        name: `should handle empty array for ${prefix}${func.name}`,
        description: 'Tests behavior with empty array',
        type: 'unit',
        targetClass: className,
        targetFunction: func.name,
        inputs: func.params.map((p) => ({
          name: p.name,
          type: p.type,
          value: p.type.includes('[]') || p.type.includes('Array')
            ? []
            : this.generateMockValue(p.type),
        })),
        expectedOutput: { type: 'value' },
        tags: ['auto-generated', 'edge-case', 'empty-array'],
        priority: 'medium',
        generated: true,
      });
    }

    return tests;
  }

  /**
   * エラーケーステストを作成
   */
  private createErrorCaseTests(func: ParsedFunction): TestCase[] {
    const tests: TestCase[] = [];

    // 不正な型入力テスト
    tests.push({
      id: uuidv4(),
      name: `should throw error for invalid input type in ${func.name}`,
      description: 'Tests error handling for invalid input types',
      type: 'unit',
      targetFunction: func.name,
      inputs: func.params.map((p) => ({
        name: p.name,
        type: 'invalid',
        value: p.type.includes('number') ? 'invalid' : 999,
      })),
      expectedOutput: { type: 'throws', errorType: 'TypeError' },
      tags: ['auto-generated', 'error-case', 'type-error'],
      priority: 'low',
      generated: true,
    });

    return tests;
  }

  // ========================================
  // Code Generation
  // ========================================

  /**
   * テストコードを生成
   */
  private generateTestCode(suite: TestSuite, framework: TestFramework): string {
    switch (framework) {
      case 'vitest':
      case 'jest':
        return this.generateJestLikeCode(suite, framework);
      case 'mocha':
        return this.generateMochaCode(suite);
      case 'pytest':
        return this.generatePytestCode(suite);
      case 'swift-testing':
        return this.generateSwiftTestCode(suite);
      default:
        return this.generateJestLikeCode(suite, 'vitest');
    }
  }

  /**
   * Jest/Vitest形式のテストコードを生成
   */
  private generateJestLikeCode(suite: TestSuite, framework: 'jest' | 'vitest'): string {
    const lines: string[] = [];

    // インポート
    lines.push(...suite.imports);
    lines.push('');

    // describe ブロック
    lines.push(`describe('${suite.name}', () => {`);

    // セットアップ
    if (suite.setupCode) {
      lines.push('  beforeEach(() => {');
      lines.push(`    ${suite.setupCode}`);
      lines.push('  });');
      lines.push('');
    }

    // テストケース
    for (const testCase of suite.testCases) {
      lines.push(...this.generateJestTestCase(testCase));
      lines.push('');
    }

    // ティアダウン
    if (suite.teardownCode) {
      lines.push('  afterEach(() => {');
      lines.push(`    ${suite.teardownCode}`);
      lines.push('  });');
    }

    lines.push('});');

    return lines.join('\n');
  }

  /**
   * Jestテストケースを生成
   */
  private generateJestTestCase(testCase: TestCase): string[] {
    const lines: string[] = [];
    const itFn = testCase.expectedOutput.type === 'resolves' ||
                 testCase.expectedOutput.type === 'rejects' ? 'it' : 'it';

    lines.push(`  ${itFn}('${testCase.name}', async () => {`);

    // セットアップ
    if (testCase.setup) {
      lines.push(`    ${testCase.setup}`);
    }

    // 入力準備
    const args = testCase.inputs.map((i) => JSON.stringify(i.value)).join(', ');
    const target = testCase.targetClass
      ? `instance.${testCase.targetFunction}`
      : testCase.targetFunction;

    // アサーション
    switch (testCase.expectedOutput.type) {
      case 'throws':
        lines.push(`    expect(() => ${target}(${args})).toThrow();`);
        break;
      case 'resolves':
        lines.push(`    await expect(${target}(${args})).resolves.toBeDefined();`);
        break;
      case 'rejects':
        lines.push(
          `    await expect(${target}(${args})).rejects.toThrow();`
        );
        break;
      case 'matches':
        lines.push(
          `    expect(${target}(${args})).toMatch(${testCase.expectedOutput.matcher});`
        );
        break;
      default:
        if (testCase.expectedOutput.value !== undefined) {
          lines.push(
            `    const result = ${testCase.targetClass ? 'await ' : ''}${target}(${args});`
          );
          lines.push(
            `    expect(result).toEqual(${JSON.stringify(testCase.expectedOutput.value)});`
          );
        } else {
          lines.push(`    const result = ${target}(${args});`);
          lines.push('    expect(result).toBeDefined();');
        }
    }

    // ティアダウン
    if (testCase.teardown) {
      lines.push(`    ${testCase.teardown}`);
    }

    lines.push('  });');

    return lines;
  }

  /**
   * Mocha形式のテストコードを生成
   */
  private generateMochaCode(suite: TestSuite): string {
    const lines: string[] = [];

    lines.push("import { expect } from 'chai';");
    lines.push(...suite.imports.filter((i) => !i.includes('expect')));
    lines.push('');

    lines.push(`describe('${suite.name}', function() {`);

    for (const testCase of suite.testCases) {
      lines.push(`  it('${testCase.name}', function() {`);
      lines.push('    // TODO: Implement test');
      lines.push('  });');
      lines.push('');
    }

    lines.push('});');

    return lines.join('\n');
  }

  /**
   * pytest形式のテストコードを生成
   */
  private generatePytestCode(suite: TestSuite): string {
    const lines: string[] = [];

    lines.push('import pytest');
    lines.push('');

    for (const testCase of suite.testCases) {
      const funcName = testCase.name
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
      lines.push(`def test_${funcName}():`);
      lines.push('    # TODO: Implement test');
      lines.push('    pass');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Swift Testing形式のテストコードを生成
   */
  private generateSwiftTestCode(suite: TestSuite): string {
    const lines: string[] = [];

    lines.push('import Testing');
    lines.push('');

    lines.push(`@Suite("${suite.name}")`);
    lines.push('struct GeneratedTests {');

    for (const testCase of suite.testCases) {
      const funcName = testCase.name
        .replace(/\s+/g, '')
        .replace(/[^a-zA-Z0-9]/g, '');
      lines.push(`  @Test("${testCase.name}")`);
      lines.push(`  func ${funcName}() {`);
      lines.push('    // TODO: Implement test');
      lines.push('  }');
      lines.push('');
    }

    lines.push('}');

    return lines.join('\n');
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * フレームワークを検出
   */
  private detectFramework(language?: string): TestFramework {
    switch (language) {
      case 'python':
        return 'pytest';
      case 'swift':
        return 'swift-testing';
      case 'typescript':
      case 'javascript':
      default:
        return 'vitest';
    }
  }

  /**
   * モック値を生成
   */
  private generateMockValue(type: string): unknown {
    const t = type.toLowerCase();

    if (t.includes('string')) return 'test-string';
    if (t.includes('number') || t.includes('int') || t.includes('float')) return 42;
    if (t.includes('boolean') || t.includes('bool')) return true;
    if (t.includes('[]') || t.includes('array')) return [];
    if (t.includes('object') || t.includes('record')) return {};
    if (t.includes('date')) return new Date().toISOString();
    if (t.includes('null')) return null;
    if (t.includes('undefined')) return undefined;

    return 'mock-value';
  }

  /**
   * 期待値を生成
   */
  private generateExpectedValue(returnType: string): unknown {
    if (returnType.includes('void') || returnType === 'unknown') {
      return undefined;
    }
    return this.generateMockValue(returnType);
  }

  /**
   * インポート文を生成
   */
  private generateImports(framework: TestFramework, sourceFile: string): string[] {
    const imports: string[] = [];
    const moduleName = sourceFile.replace(/\.(ts|js|tsx|jsx)$/, '');

    switch (framework) {
      case 'vitest':
        imports.push("import { describe, it, expect, beforeEach, afterEach } from 'vitest';");
        break;
      case 'jest':
        // Jest provides globals
        break;
      case 'mocha':
        imports.push("import { expect } from 'chai';");
        break;
    }

    imports.push(`import { /* exported functions */ } from './${moduleName}.js';`);

    return imports;
  }

  /**
   * セットアップコードを生成
   */
  private generateSetupCode(
    framework: TestFramework,
    options: TestGenerationOptions
  ): string | undefined {
    if (options.mockDependencies) {
      return '// Setup mocks here';
    }
    return undefined;
  }

  /**
   * ティアダウンコードを生成
   */
  private generateTeardownCode(
    framework: TestFramework,
    options: TestGenerationOptions
  ): string | undefined {
    if (options.mockDependencies) {
      return '// Cleanup mocks here';
    }
    return undefined;
  }

  /**
   * テストファイル名を生成
   */
  private generateTestFileName(sourceFile: string, framework: TestFramework): string {
    const baseName = sourceFile.replace(/\.(ts|js|tsx|jsx|py|swift)$/, '');

    switch (framework) {
      case 'pytest':
        return `test_${baseName}.py`;
      case 'swift-testing':
        return `${baseName}Tests.swift`;
      default:
        return `${baseName}.test.ts`;
    }
  }

  /**
   * カバレッジを推定
   */
  private estimateCoverage(
    testCases: TestCase[],
    functions: ParsedFunction[],
    classes: ParsedClass[]
  ): CoverageEstimate {
    const totalFunctions =
      functions.length + classes.reduce((acc, c) => acc + c.methods.length, 0);
    const testedFunctions = new Set(
      testCases.map((t) => `${t.targetClass || ''}.${t.targetFunction}`)
    ).size;

    const functionCoverage =
      totalFunctions > 0 ? (testedFunctions / totalFunctions) * 100 : 0;

    return {
      functions: Math.round(functionCoverage),
      branches: Math.round(functionCoverage * 0.6), // 推定
      lines: Math.round(functionCoverage * 0.8), // 推定
    };
  }
}

// ========================================
// Singleton Instance
// ========================================

let testGeneratorInstance: TestGenerator | null = null;

/**
 * TestGeneratorのシングルトンインスタンスを取得
 */
export function getTestGenerator(config?: Partial<AidosConfig>): TestGenerator {
  if (!testGeneratorInstance) {
    testGeneratorInstance = new TestGenerator(config);
  }
  return testGeneratorInstance;
}

/**
 * TestGeneratorインスタンスをリセット（テスト用）
 */
export function resetTestGenerator(): void {
  testGeneratorInstance = null;
}
