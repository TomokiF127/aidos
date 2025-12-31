/**
 * プロンプトテンプレート
 *
 * 各種タスク用のプロンプトテンプレートを管理
 * - タスク分解用プロンプト
 * - コード生成用プロンプト
 * - レビュー用プロンプト
 * - テンプレート変数の置換
 */

// ========================================
// Types
// ========================================

/**
 * テンプレートカテゴリ
 */
export type TemplateCategory =
  | 'task-decomposition'
  | 'code-generation'
  | 'code-review'
  | 'test-generation'
  | 'documentation'
  | 'debugging'
  | 'refactoring'
  | 'system';

/**
 * テンプレート変数の型
 */
export type TemplateVariable = string | number | boolean | string[] | object;

/**
 * テンプレート変数マップ
 */
export interface TemplateVariables {
  [key: string]: TemplateVariable;
}

/**
 * プロンプトテンプレート
 */
export interface PromptTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  template: string;
  requiredVariables: string[];
  optionalVariables: string[];
  examples?: TemplateExample[];
  version: string;
}

/**
 * テンプレート使用例
 */
export interface TemplateExample {
  variables: TemplateVariables;
  result: string;
}

/**
 * レンダリング結果
 */
export interface RenderResult {
  prompt: string;
  usedVariables: string[];
  missingVariables: string[];
  warnings: string[];
}

/**
 * テンプレートオプション
 */
export interface TemplateOptions {
  strict?: boolean; // 必須変数がない場合にエラー
  preserveUnknown?: boolean; // 未知の変数を保持
  trimWhitespace?: boolean; // 前後の空白を削除
}

// ========================================
// Built-in Templates
// ========================================

/**
 * タスク分解プロンプトテンプレート
 */
const TASK_DECOMPOSITION_TEMPLATE: PromptTemplate = {
  id: 'task-decomposition-v1',
  name: 'Task Decomposition',
  category: 'task-decomposition',
  description: '目的をサブタスクに分解するためのプロンプト',
  version: '1.0.0',
  requiredVariables: ['objective'],
  optionalVariables: ['context', 'constraints', 'preferences', 'maxTasks'],
  template: `あなたは経験豊富なプロジェクトマネージャーです。以下の目的を達成するために必要なタスクを分解してください。

## 目的
{{objective}}

{{#if context}}
## コンテキスト
{{context}}
{{/if}}

{{#if constraints}}
## 制約条件
{{constraints}}
{{/if}}

{{#if preferences}}
## 優先事項
{{preferences}}
{{/if}}

## 要件
1. 各タスクは明確で実行可能であること
2. タスク間の依存関係を明示すること
3. 優先度を設定すること（1が最高）
4. 複雑さを推定すること（low/medium/high）
5. カテゴリを分類すること（design/implement/test/document/other）

{{#if maxTasks}}
最大{{maxTasks}}個のタスクに分解してください。
{{/if}}

## 出力形式
以下のJSON形式で出力してください：
\`\`\`json
{
  "reasoning": "分解の理由と考え方",
  "tasks": [
    {
      "id": "T1",
      "description": "タスクの説明",
      "category": "design|implement|test|document|other",
      "dependencies": [],
      "priority": 1,
      "estimatedComplexity": "low|medium|high"
    }
  ]
}
\`\`\``,
};

/**
 * コード生成プロンプトテンプレート
 */
const CODE_GENERATION_TEMPLATE: PromptTemplate = {
  id: 'code-generation-v1',
  name: 'Code Generation',
  category: 'code-generation',
  description: 'コードを生成するためのプロンプト',
  version: '1.0.0',
  requiredVariables: ['task', 'language'],
  optionalVariables: [
    'framework',
    'existingCode',
    'dependencies',
    'style',
    'examples',
    'testRequirements',
  ],
  template: `あなたは熟練したソフトウェアエンジニアです。以下の要件に基づいてコードを生成してください。

## タスク
{{task}}

## 言語・技術スタック
- 言語: {{language}}
{{#if framework}}
- フレームワーク: {{framework}}
{{/if}}
{{#if dependencies}}
- 依存関係: {{dependencies}}
{{/if}}

{{#if existingCode}}
## 既存コード
\`\`\`{{language}}
{{existingCode}}
\`\`\`
{{/if}}

{{#if style}}
## コーディングスタイル
{{style}}
{{/if}}

{{#if examples}}
## 参考例
{{examples}}
{{/if}}

## 要件
1. クリーンで読みやすいコードを書くこと
2. 適切なエラーハンドリングを含めること
3. 必要に応じてコメントを追加すること
4. 型安全性を確保すること（TypeScriptの場合）
5. ベストプラクティスに従うこと

{{#if testRequirements}}
## テスト要件
{{testRequirements}}
{{/if}}

## 出力形式
\`\`\`{{language}}
// ここにコードを出力
\`\`\``,
};

/**
 * コードレビュープロンプトテンプレート
 */
const CODE_REVIEW_TEMPLATE: PromptTemplate = {
  id: 'code-review-v1',
  name: 'Code Review',
  category: 'code-review',
  description: 'コードをレビューするためのプロンプト',
  version: '1.0.0',
  requiredVariables: ['code', 'language'],
  optionalVariables: ['context', 'focusAreas', 'severity', 'projectGuidelines'],
  template: `あなたは経験豊富なコードレビュアーです。以下のコードをレビューしてください。

## レビュー対象コード
\`\`\`{{language}}
{{code}}
\`\`\`

{{#if context}}
## コンテキスト
{{context}}
{{/if}}

{{#if focusAreas}}
## 重点確認項目
{{focusAreas}}
{{/if}}

{{#if projectGuidelines}}
## プロジェクトガイドライン
{{projectGuidelines}}
{{/if}}

## レビュー観点
1. コードの正確性と論理エラー
2. セキュリティ脆弱性
3. パフォーマンス問題
4. 保守性と可読性
5. ベストプラクティスへの準拠
6. エラーハンドリング
7. ドキュメンテーション

## 出力形式
以下のJSON形式で出力してください：
\`\`\`json
{
  "summary": "レビューの概要",
  "score": 0-100,
  "issues": [
    {
      "severity": "info|warning|error|critical",
      "category": "security|performance|style|bug|maintainability",
      "line": 行番号（オプション）,
      "message": "問題の説明",
      "suggestion": "改善提案"
    }
  ],
  "improvements": ["改善点1", "改善点2"],
  "strengths": ["良い点1", "良い点2"]
}
\`\`\``,
};

/**
 * テスト生成プロンプトテンプレート
 */
const TEST_GENERATION_TEMPLATE: PromptTemplate = {
  id: 'test-generation-v1',
  name: 'Test Generation',
  category: 'test-generation',
  description: 'テストコードを生成するためのプロンプト',
  version: '1.0.0',
  requiredVariables: ['code', 'language'],
  optionalVariables: ['framework', 'testTypes', 'coverage', 'mocking'],
  template: `あなたはテストエンジニアです。以下のコードに対するテストを生成してください。

## 対象コード
\`\`\`{{language}}
{{code}}
\`\`\`

## テスト設定
- 言語: {{language}}
{{#if framework}}
- テストフレームワーク: {{framework}}
{{/if}}
{{#if testTypes}}
- テストタイプ: {{testTypes}}
{{/if}}

{{#if mocking}}
## モッキング要件
{{mocking}}
{{/if}}

## 要件
1. 正常系テストを含めること
2. 異常系・エッジケーステストを含めること
3. テストは独立して実行可能であること
4. 明確なテスト名をつけること
5. アサーションは具体的に書くこと

{{#if coverage}}
## カバレッジ目標
{{coverage}}
{{/if}}

## 出力形式
\`\`\`{{language}}
// ここにテストコードを出力
\`\`\``,
};

/**
 * ドキュメント生成プロンプトテンプレート
 */
const DOCUMENTATION_TEMPLATE: PromptTemplate = {
  id: 'documentation-v1',
  name: 'Documentation',
  category: 'documentation',
  description: 'ドキュメントを生成するためのプロンプト',
  version: '1.0.0',
  requiredVariables: ['subject'],
  optionalVariables: ['code', 'type', 'audience', 'format', 'language'],
  template: `あなたはテクニカルライターです。以下の内容に基づいてドキュメントを作成してください。

## 対象
{{subject}}

{{#if code}}
## 関連コード
\`\`\`{{#if language}}{{language}}{{else}}typescript{{/if}}
{{code}}
\`\`\`
{{/if}}

{{#if type}}
## ドキュメントタイプ
{{type}}
{{/if}}

{{#if audience}}
## 想定読者
{{audience}}
{{/if}}

## 要件
1. 明確で簡潔な説明
2. 具体的な使用例
3. パラメータと戻り値の説明
4. エラーケースの説明
5. 関連情報へのリファレンス

{{#if format}}
## フォーマット
{{format}}
{{/if}}

ドキュメントをMarkdown形式で出力してください。`,
};

/**
 * デバッグプロンプトテンプレート
 */
const DEBUGGING_TEMPLATE: PromptTemplate = {
  id: 'debugging-v1',
  name: 'Debugging',
  category: 'debugging',
  description: 'バグを調査・修正するためのプロンプト',
  version: '1.0.0',
  requiredVariables: ['code', 'error'],
  optionalVariables: ['expectedBehavior', 'actualBehavior', 'stackTrace', 'environment'],
  template: `あなたはデバッグの専門家です。以下の問題を分析し、解決策を提案してください。

## 問題のコード
\`\`\`
{{code}}
\`\`\`

## エラー内容
{{error}}

{{#if stackTrace}}
## スタックトレース
\`\`\`
{{stackTrace}}
\`\`\`
{{/if}}

{{#if expectedBehavior}}
## 期待される動作
{{expectedBehavior}}
{{/if}}

{{#if actualBehavior}}
## 実際の動作
{{actualBehavior}}
{{/if}}

{{#if environment}}
## 環境情報
{{environment}}
{{/if}}

## 分析と解決策を以下の形式で出力してください：

### 1. 問題の原因分析
（原因の説明）

### 2. 修正方法
（具体的な修正手順）

### 3. 修正後のコード
\`\`\`
// 修正後のコード
\`\`\`

### 4. 再発防止策
（今後同様の問題を防ぐための提案）`,
};

/**
 * リファクタリングプロンプトテンプレート
 */
const REFACTORING_TEMPLATE: PromptTemplate = {
  id: 'refactoring-v1',
  name: 'Refactoring',
  category: 'refactoring',
  description: 'コードをリファクタリングするためのプロンプト',
  version: '1.0.0',
  requiredVariables: ['code', 'language'],
  optionalVariables: ['goals', 'constraints', 'patterns', 'preserveBehavior'],
  template: `あなたはリファクタリングの専門家です。以下のコードを改善してください。

## 対象コード
\`\`\`{{language}}
{{code}}
\`\`\`

{{#if goals}}
## リファクタリング目標
{{goals}}
{{/if}}

{{#if constraints}}
## 制約条件
{{constraints}}
{{/if}}

{{#if patterns}}
## 適用を検討するパターン
{{patterns}}
{{/if}}

## 要件
1. コードの動作を維持すること
2. 可読性を向上させること
3. 保守性を向上させること
4. DRY原則に従うこと
5. SOLID原則を適用すること

## 出力形式

### 変更の説明
（どのような変更を行ったかの説明）

### リファクタリング後のコード
\`\`\`{{language}}
// リファクタリング後のコード
\`\`\`

### 改善点
- 改善点1
- 改善点2`,
};

/**
 * システムプロンプトテンプレート
 */
const SYSTEM_PROMPT_TEMPLATE: PromptTemplate = {
  id: 'system-prompt-v1',
  name: 'System Prompt',
  category: 'system',
  description: 'エージェントのシステムプロンプト',
  version: '1.0.0',
  requiredVariables: ['role', 'mission'],
  optionalVariables: ['capabilities', 'constraints', 'personality', 'outputFormat'],
  template: `あなたは{{role}}として動作するAIアシスタントです。

## ミッション
{{mission}}

{{#if capabilities}}
## 能力
{{capabilities}}
{{/if}}

{{#if constraints}}
## 制約
{{constraints}}
{{/if}}

{{#if personality}}
## 振る舞い
{{personality}}
{{/if}}

## 基本原則
1. 正確で信頼性の高い情報を提供すること
2. 不明な点は推測せず、確認すること
3. エラーが発生した場合は明確に報告すること
4. ユーザーの意図を正確に理解するよう努めること
5. セキュリティとプライバシーを尊重すること

{{#if outputFormat}}
## 出力形式
{{outputFormat}}
{{/if}}`,
};

// ========================================
// Built-in Templates Collection
// ========================================

const BUILTIN_TEMPLATES: PromptTemplate[] = [
  TASK_DECOMPOSITION_TEMPLATE,
  CODE_GENERATION_TEMPLATE,
  CODE_REVIEW_TEMPLATE,
  TEST_GENERATION_TEMPLATE,
  DOCUMENTATION_TEMPLATE,
  DEBUGGING_TEMPLATE,
  REFACTORING_TEMPLATE,
  SYSTEM_PROMPT_TEMPLATE,
];

// ========================================
// Prompt Template Manager
// ========================================

/**
 * プロンプトテンプレートマネージャー
 */
export class PromptTemplateManager {
  private templates: Map<string, PromptTemplate> = new Map();
  private customTemplates: Map<string, PromptTemplate> = new Map();

  constructor() {
    this.loadBuiltinTemplates();
  }

  /**
   * 組み込みテンプレートをロード
   */
  private loadBuiltinTemplates(): void {
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * テンプレートを取得
   */
  get(id: string): PromptTemplate | undefined {
    return this.customTemplates.get(id) || this.templates.get(id);
  }

  /**
   * カテゴリでテンプレートを取得
   */
  getByCategory(category: TemplateCategory): PromptTemplate[] {
    const all = [
      ...Array.from(this.templates.values()),
      ...Array.from(this.customTemplates.values()),
    ];
    return all.filter((t) => t.category === category);
  }

  /**
   * 全テンプレートを取得
   */
  getAll(): PromptTemplate[] {
    const all = new Map([...this.templates, ...this.customTemplates]);
    return Array.from(all.values());
  }

  /**
   * カスタムテンプレートを追加
   */
  add(template: PromptTemplate): void {
    this.customTemplates.set(template.id, template);
  }

  /**
   * カスタムテンプレートを削除
   */
  remove(id: string): boolean {
    return this.customTemplates.delete(id);
  }

  /**
   * テンプレートをレンダリング
   */
  render(
    templateId: string,
    variables: TemplateVariables,
    options: TemplateOptions = {}
  ): RenderResult {
    const template = this.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return this.renderTemplate(template.template, variables, template, options);
  }

  /**
   * テンプレート文字列を直接レンダリング
   */
  renderString(
    templateString: string,
    variables: TemplateVariables,
    options: TemplateOptions = {}
  ): RenderResult {
    return this.renderTemplate(templateString, variables, undefined, options);
  }

  /**
   * テンプレートをレンダリング（内部実装）
   */
  private renderTemplate(
    templateString: string,
    variables: TemplateVariables,
    templateInfo?: PromptTemplate,
    options: TemplateOptions = {}
  ): RenderResult {
    const usedVariables: string[] = [];
    const missingVariables: string[] = [];
    const warnings: string[] = [];

    // 必須変数のチェック
    if (templateInfo && options.strict !== false) {
      for (const required of templateInfo.requiredVariables) {
        if (!(required in variables) || variables[required] === undefined) {
          missingVariables.push(required);
        }
      }

      if (missingVariables.length > 0 && options.strict) {
        throw new Error(
          `Missing required variables: ${missingVariables.join(', ')}`
        );
      }
    }

    let result = templateString;

    // 条件ブロックを処理 {{#if variable}}...{{/if}}
    result = this.processConditionals(result, variables);

    // 変数を置換 {{variable}}
    result = result.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      if (varName in variables) {
        usedVariables.push(varName);
        const value = variables[varName];
        return this.stringifyValue(value);
      }

      if (!options.preserveUnknown) {
        warnings.push(`Variable not provided: ${varName}`);
        return '';
      }

      return match;
    });

    // 空白の整理
    if (options.trimWhitespace !== false) {
      result = result.trim();
      // 3行以上の連続した空行を2行に
      result = result.replace(/\n{3,}/g, '\n\n');
    }

    return {
      prompt: result,
      usedVariables: [...new Set(usedVariables)],
      missingVariables,
      warnings,
    };
  }

  /**
   * 条件ブロックを処理
   */
  private processConditionals(
    template: string,
    variables: TemplateVariables
  ): string {
    // {{#if variable}}content{{/if}} パターン
    const ifPattern = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

    return template.replace(ifPattern, (match, varName, content) => {
      const value = variables[varName];
      if (this.isTruthy(value)) {
        return content;
      }
      return '';
    });
  }

  /**
   * 値がtruthyかチェック
   */
  private isTruthy(value: unknown): boolean {
    if (value === undefined || value === null || value === false) {
      return false;
    }
    if (typeof value === 'string' && value.trim() === '') {
      return false;
    }
    if (Array.isArray(value) && value.length === 0) {
      return false;
    }
    return true;
  }

  /**
   * 値を文字列に変換
   */
  private stringifyValue(value: TemplateVariable): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return value.join('\n');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  /**
   * テンプレートを検証
   */
  validate(template: PromptTemplate): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!template.id || template.id.trim() === '') {
      errors.push('Template ID is required');
    }

    if (!template.name || template.name.trim() === '') {
      errors.push('Template name is required');
    }

    if (!template.template || template.template.trim() === '') {
      errors.push('Template content is required');
    }

    // 必須変数がテンプレート内に存在するか確認
    for (const varName of template.requiredVariables) {
      const pattern = new RegExp(`\\{\\{#?\\/?(?:if\\s+)?${varName}\\}\\}`);
      if (!pattern.test(template.template)) {
        errors.push(`Required variable "${varName}" not found in template`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * テンプレートを複製
   */
  clone(id: string, newId: string): PromptTemplate | undefined {
    const original = this.get(id);
    if (!original) {
      return undefined;
    }

    const cloned: PromptTemplate = {
      ...structuredClone(original),
      id: newId,
      name: `${original.name} (Copy)`,
    };

    this.add(cloned);
    return cloned;
  }
}

// ========================================
// Singleton Instance
// ========================================

let promptTemplateManagerInstance: PromptTemplateManager | null = null;

/**
 * PromptTemplateManagerのシングルトンインスタンスを取得
 */
export function getPromptTemplateManager(): PromptTemplateManager {
  if (!promptTemplateManagerInstance) {
    promptTemplateManagerInstance = new PromptTemplateManager();
  }
  return promptTemplateManagerInstance;
}

/**
 * PromptTemplateManagerインスタンスをリセット（テスト用）
 */
export function resetPromptTemplateManager(): void {
  promptTemplateManagerInstance = null;
}

// ========================================
// Convenience Functions
// ========================================

/**
 * タスク分解プロンプトを生成
 */
export function createTaskDecompositionPrompt(
  objective: string,
  options: {
    context?: string;
    constraints?: string;
    preferences?: string;
    maxTasks?: number;
  } = {}
): string {
  const manager = getPromptTemplateManager();
  const result = manager.render('task-decomposition-v1', {
    objective,
    ...options,
  });
  return result.prompt;
}

/**
 * コード生成プロンプトを生成
 */
export function createCodeGenerationPrompt(
  task: string,
  language: string,
  options: {
    framework?: string;
    existingCode?: string;
    dependencies?: string;
    style?: string;
    examples?: string;
    testRequirements?: string;
  } = {}
): string {
  const manager = getPromptTemplateManager();
  const result = manager.render('code-generation-v1', {
    task,
    language,
    ...options,
  });
  return result.prompt;
}

/**
 * コードレビュープロンプトを生成
 */
export function createCodeReviewPrompt(
  code: string,
  language: string,
  options: {
    context?: string;
    focusAreas?: string;
    severity?: string;
    projectGuidelines?: string;
  } = {}
): string {
  const manager = getPromptTemplateManager();
  const result = manager.render('code-review-v1', {
    code,
    language,
    ...options,
  });
  return result.prompt;
}

/**
 * テスト生成プロンプトを生成
 */
export function createTestGenerationPrompt(
  code: string,
  language: string,
  options: {
    framework?: string;
    testTypes?: string;
    coverage?: string;
    mocking?: string;
  } = {}
): string {
  const manager = getPromptTemplateManager();
  const result = manager.render('test-generation-v1', {
    code,
    language,
    ...options,
  });
  return result.prompt;
}

/**
 * システムプロンプトを生成
 */
export function createSystemPrompt(
  role: string,
  mission: string,
  options: {
    capabilities?: string;
    constraints?: string;
    personality?: string;
    outputFormat?: string;
  } = {}
): string {
  const manager = getPromptTemplateManager();
  const result = manager.render('system-prompt-v1', {
    role,
    mission,
    ...options,
  });
  return result.prompt;
}
