/**
 * 設定マネージャー
 *
 * YAML設定ファイルの読み込み・検証
 * - デフォルト値のマージ
 * - 環境変数のオーバーライド
 * - 設定のバリデーション
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { AidosConfig, DEFAULT_CONFIG, AidosError } from '../types.js';

// ========================================
// Zod Schemas for Validation
// ========================================

/**
 * API設定スキーマ
 */
const ApiConfigSchema = z.object({
  provider: z.literal('anthropic'),
  model: z.string().min(1),
  maxTokens: z.number().int().positive().max(100000),
});

/**
 * エージェント設定スキーマ
 */
const AgentConfigSchema = z.object({
  maxConcurrent: z.number().int().positive().max(50),
  timeoutMs: z.number().int().positive().max(3600000), // 最大1時間
});

/**
 * 予算設定スキーマ
 */
const BudgetConfigSchema = z.object({
  maxTotalTokens: z.number().int().positive(),
  maxSessionDurationMs: z.number().int().positive(),
});

/**
 * 出力設定スキーマ
 */
const OutputConfigSchema = z.object({
  directory: z.string().min(1),
});

/**
 * UI設定スキーマ
 */
const UiConfigSchema = z.object({
  theme: z.enum(['dark', 'light']),
  logLines: z.number().int().positive().max(10000),
});

/**
 * 完全な設定スキーマ
 */
const AidosConfigSchema = z.object({
  api: ApiConfigSchema,
  agents: AgentConfigSchema,
  budget: BudgetConfigSchema,
  output: OutputConfigSchema,
  ui: UiConfigSchema,
});

/**
 * 部分的な設定スキーマ（オプショナル）
 */
const PartialAidosConfigSchema = z.object({
  api: ApiConfigSchema.partial().optional(),
  agents: AgentConfigSchema.partial().optional(),
  budget: BudgetConfigSchema.partial().optional(),
  output: OutputConfigSchema.partial().optional(),
  ui: UiConfigSchema.partial().optional(),
});

// ========================================
// Types
// ========================================

/**
 * 設定ソースの種類
 */
export type ConfigSource = 'default' | 'file' | 'env' | 'runtime';

/**
 * 設定値の出所を追跡
 */
export interface ConfigOrigin {
  key: string;
  source: ConfigSource;
  value: unknown;
  originalValue?: unknown;
}

/**
 * 設定バリデーション結果
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: string[];
}

/**
 * 設定バリデーションエラー
 */
export interface ConfigValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

/**
 * 設定変更イベント
 */
export interface ConfigChangeEvent {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  source: ConfigSource;
}

/**
 * 設定マネージャーイベント
 */
export type ConfigManagerEvent =
  | 'config:loaded'
  | 'config:saved'
  | 'config:changed'
  | 'config:validated'
  | 'config:error';

/**
 * 環境変数マッピング
 */
interface EnvMapping {
  envKey: string;
  configPath: string[];
  transform?: (value: string) => unknown;
}

// ========================================
// Environment Variable Mappings
// ========================================

const ENV_MAPPINGS: EnvMapping[] = [
  {
    envKey: 'AIDOS_API_MODEL',
    configPath: ['api', 'model'],
  },
  {
    envKey: 'AIDOS_API_MAX_TOKENS',
    configPath: ['api', 'maxTokens'],
    transform: (v) => parseInt(v, 10),
  },
  {
    envKey: 'AIDOS_AGENTS_MAX_CONCURRENT',
    configPath: ['agents', 'maxConcurrent'],
    transform: (v) => parseInt(v, 10),
  },
  {
    envKey: 'AIDOS_AGENTS_TIMEOUT_MS',
    configPath: ['agents', 'timeoutMs'],
    transform: (v) => parseInt(v, 10),
  },
  {
    envKey: 'AIDOS_BUDGET_MAX_TOKENS',
    configPath: ['budget', 'maxTotalTokens'],
    transform: (v) => parseInt(v, 10),
  },
  {
    envKey: 'AIDOS_BUDGET_MAX_DURATION_MS',
    configPath: ['budget', 'maxSessionDurationMs'],
    transform: (v) => parseInt(v, 10),
  },
  {
    envKey: 'AIDOS_OUTPUT_DIR',
    configPath: ['output', 'directory'],
  },
  {
    envKey: 'AIDOS_UI_THEME',
    configPath: ['ui', 'theme'],
  },
  {
    envKey: 'AIDOS_UI_LOG_LINES',
    configPath: ['ui', 'logLines'],
    transform: (v) => parseInt(v, 10),
  },
];

// ========================================
// Config Manager Class
// ========================================

/**
 * 設定マネージャー
 */
export class ConfigManager extends EventEmitter {
  private config: AidosConfig;
  private origins: Map<string, ConfigOrigin> = new Map();
  private configFilePath: string | null = null;
  private watchers: Array<(event: ConfigChangeEvent) => void> = [];

  constructor(initialConfig?: Partial<AidosConfig>) {
    super();
    this.config = this.mergeConfig(DEFAULT_CONFIG, initialConfig || {});
    this.trackOrigins(DEFAULT_CONFIG, 'default');
  }

  /**
   * 設定ファイルを読み込み
   */
  async loadFromFile(filePath: string): Promise<AidosConfig> {
    try {
      const absolutePath = path.resolve(filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');

      let parsed: unknown;
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        parsed = parseYaml(content);
      } else if (filePath.endsWith('.json')) {
        parsed = JSON.parse(content);
      } else {
        throw new ConfigError(`Unsupported config file format: ${filePath}`);
      }

      // バリデーション
      const validation = this.validate(parsed);
      if (!validation.valid) {
        const errorMessages = validation.errors
          .map((e) => `${e.path}: ${e.message}`)
          .join(', ');
        throw new ConfigError(`Invalid configuration: ${errorMessages}`);
      }

      // マージ
      const fileConfig = parsed as Partial<AidosConfig>;
      this.config = this.mergeConfig(this.config, fileConfig);
      this.trackOrigins(fileConfig, 'file');
      this.configFilePath = absolutePath;

      this.emit('config:loaded', { filePath: absolutePath, config: this.config });

      return this.config;
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error;
      }
      throw new ConfigError(
        `Failed to load config from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 環境変数から設定を読み込み
   */
  loadFromEnv(): AidosConfig {
    for (const mapping of ENV_MAPPINGS) {
      const envValue = process.env[mapping.envKey];
      if (envValue !== undefined) {
        const value = mapping.transform ? mapping.transform(envValue) : envValue;
        this.setNestedValue(this.config as unknown as { [key: string]: unknown }, mapping.configPath, value);
        this.origins.set(mapping.configPath.join('.'), {
          key: mapping.configPath.join('.'),
          source: 'env',
          value,
          originalValue: envValue,
        });
      }
    }

    return this.config;
  }

  /**
   * 設定をファイルに保存
   */
  async saveToFile(filePath?: string): Promise<void> {
    const targetPath = filePath || this.configFilePath;
    if (!targetPath) {
      throw new ConfigError('No file path specified for saving config');
    }

    const absolutePath = path.resolve(targetPath);
    let content: string;

    if (targetPath.endsWith('.yaml') || targetPath.endsWith('.yml')) {
      content = stringifyYaml(this.config);
    } else if (targetPath.endsWith('.json')) {
      content = JSON.stringify(this.config, null, 2);
    } else {
      throw new ConfigError(`Unsupported config file format: ${targetPath}`);
    }

    await fs.writeFile(absolutePath, content, 'utf-8');
    this.configFilePath = absolutePath;

    this.emit('config:saved', { filePath: absolutePath });
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): AidosConfig {
    return structuredClone(this.config);
  }

  /**
   * 特定のキーの設定値を取得
   */
  get<T = unknown>(keyPath: string): T | undefined {
    const keys = keyPath.split('.');
    let value: unknown = this.config;

    for (const key of keys) {
      if (value === null || typeof value !== 'object') {
        return undefined;
      }
      value = (value as Record<string, unknown>)[key];
    }

    return value as T;
  }

  /**
   * 設定値を設定
   */
  set(keyPath: string, value: unknown): void {
    const keys = keyPath.split('.');
    const oldValue = this.get(keyPath);

    this.setNestedValue(this.config as unknown as { [key: string]: unknown }, keys, value);
    this.origins.set(keyPath, {
      key: keyPath,
      source: 'runtime',
      value,
      originalValue: oldValue,
    });

    const event: ConfigChangeEvent = {
      key: keyPath,
      oldValue,
      newValue: value,
      source: 'runtime',
    };

    this.emit('config:changed', event);
    this.notifyWatchers(event);
  }

  /**
   * 設定をマージ
   */
  merge(partialConfig: Partial<AidosConfig>): AidosConfig {
    const validation = this.validate(partialConfig);
    if (!validation.valid) {
      const errorMessages = validation.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join(', ');
      throw new ConfigError(`Invalid configuration: ${errorMessages}`);
    }

    this.config = this.mergeConfig(this.config, partialConfig);
    this.trackOrigins(partialConfig, 'runtime');

    return this.config;
  }

  /**
   * 設定をバリデーション
   */
  validate(config: unknown): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];
    const warnings: string[] = [];

    try {
      // 部分的な設定として検証
      PartialAidosConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        for (const issue of error.issues) {
          errors.push({
            path: issue.path.join('.'),
            message: issue.message,
            expected: 'expected' in issue ? String(issue.expected) : undefined,
            received: 'received' in issue ? String(issue.received) : undefined,
          });
        }
      }
    }

    // 追加のバリデーション
    const cfg = config as Partial<AidosConfig>;

    // 警告チェック
    if (cfg.agents?.maxConcurrent && cfg.agents.maxConcurrent > 10) {
      warnings.push(
        `High maxConcurrent value (${cfg.agents.maxConcurrent}) may cause performance issues`
      );
    }

    if (cfg.budget?.maxTotalTokens && cfg.budget.maxTotalTokens > 10000000) {
      warnings.push(
        `Very high maxTotalTokens (${cfg.budget.maxTotalTokens}) - ensure this is intentional`
      );
    }

    if (cfg.agents?.timeoutMs && cfg.agents.timeoutMs < 30000) {
      warnings.push(
        `Low timeout (${cfg.agents.timeoutMs}ms) may cause premature task termination`
      );
    }

    const result: ConfigValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };

    this.emit('config:validated', result);

    return result;
  }

  /**
   * 完全なバリデーション（完全な設定オブジェクトが必要）
   */
  validateFull(): ConfigValidationResult {
    const errors: ConfigValidationError[] = [];
    const warnings: string[] = [];

    try {
      AidosConfigSchema.parse(this.config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        for (const issue of error.issues) {
          errors.push({
            path: issue.path.join('.'),
            message: issue.message,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 設定値の出所を取得
   */
  getOrigin(keyPath: string): ConfigOrigin | undefined {
    return this.origins.get(keyPath);
  }

  /**
   * 全ての設定値の出所を取得
   */
  getAllOrigins(): ConfigOrigin[] {
    return Array.from(this.origins.values());
  }

  /**
   * 設定をデフォルトにリセット
   */
  reset(): AidosConfig {
    this.config = structuredClone(DEFAULT_CONFIG);
    this.origins.clear();
    this.trackOrigins(DEFAULT_CONFIG, 'default');

    this.emit('config:changed', {
      key: '*',
      oldValue: null,
      newValue: this.config,
      source: 'default',
    });

    return this.config;
  }

  /**
   * 設定変更の監視を登録
   */
  watch(callback: (event: ConfigChangeEvent) => void): () => void {
    this.watchers.push(callback);
    return () => {
      const index = this.watchers.indexOf(callback);
      if (index > -1) {
        this.watchers.splice(index, 1);
      }
    };
  }

  /**
   * 設定をYAML文字列として出力
   */
  toYaml(): string {
    return stringifyYaml(this.config);
  }

  /**
   * 設定をJSON文字列として出力
   */
  toJson(pretty: boolean = true): string {
    return pretty
      ? JSON.stringify(this.config, null, 2)
      : JSON.stringify(this.config);
  }

  /**
   * 環境変数テンプレートを生成
   */
  generateEnvTemplate(): string {
    const lines: string[] = [
      '# AIDOS Configuration Environment Variables',
      '# Copy this file to .env and customize as needed',
      '',
    ];

    for (const mapping of ENV_MAPPINGS) {
      const currentValue = this.get(mapping.configPath.join('.'));
      lines.push(`# ${mapping.configPath.join('.')}`);
      lines.push(`${mapping.envKey}=${currentValue ?? ''}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ========================================
  // Private Methods
  // ========================================

  /**
   * 設定をディープマージ
   */
  private mergeConfig(
    base: AidosConfig,
    override: Partial<AidosConfig>
  ): AidosConfig {
    const result = structuredClone(base);

    if (override.api) {
      result.api = { ...result.api, ...override.api };
    }
    if (override.agents) {
      result.agents = { ...result.agents, ...override.agents };
    }
    if (override.budget) {
      result.budget = { ...result.budget, ...override.budget };
    }
    if (override.output) {
      result.output = { ...result.output, ...override.output };
    }
    if (override.ui) {
      result.ui = { ...result.ui, ...override.ui };
    }

    return result;
  }

  /**
   * ネストされた値を設定
   */
  private setNestedValue(
    obj: { [key: string]: unknown },
    keys: string[],
    value: unknown
  ): void {
    let current: { [key: string]: unknown } = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key] as { [key: string]: unknown };
    }
    current[keys[keys.length - 1]] = value;
  }

  /**
   * 設定値の出所を追跡
   */
  private trackOrigins(config: Partial<AidosConfig>, source: ConfigSource): void {
    const flatten = (obj: unknown, prefix: string[] = []): void => {
      if (obj === null || typeof obj !== 'object') {
        return;
      }

      const objRecord = obj as { [key: string]: unknown };
      for (const key of Object.keys(objRecord)) {
        const value = objRecord[key];
        const pathArr = [...prefix, key];
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          flatten(value, pathArr);
        } else {
          this.origins.set(pathArr.join('.'), {
            key: pathArr.join('.'),
            source,
            value,
          });
        }
      }
    };

    flatten(config);
  }

  /**
   * ウォッチャーに通知
   */
  private notifyWatchers(event: ConfigChangeEvent): void {
    for (const watcher of this.watchers) {
      try {
        watcher(event);
      } catch (error) {
        console.error('Config watcher error:', error);
      }
    }
  }
}

// ========================================
// Error Types
// ========================================

/**
 * 設定関連エラー
 */
export class ConfigError extends AidosError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', true);
  }
}

// ========================================
// Singleton Instance
// ========================================

let configManagerInstance: ConfigManager | null = null;

/**
 * ConfigManagerのシングルトンインスタンスを取得
 */
export function getConfigManager(
  initialConfig?: Partial<AidosConfig>
): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager(initialConfig);
  }
  return configManagerInstance;
}

/**
 * ConfigManagerインスタンスをリセット（テスト用）
 */
export function resetConfigManager(): void {
  configManagerInstance = null;
}

// ========================================
// Utility Functions
// ========================================

/**
 * 設定ファイルを検索
 */
export async function findConfigFile(
  startDir: string = process.cwd()
): Promise<string | null> {
  const configFileNames = [
    'aidos.config.yaml',
    'aidos.config.yml',
    'aidos.config.json',
    '.aidos.yaml',
    '.aidos.yml',
    '.aidos.json',
  ];

  let currentDir = path.resolve(startDir);
  const rootDir = path.parse(currentDir).root;

  while (currentDir !== rootDir) {
    for (const fileName of configFileNames) {
      const filePath = path.join(currentDir, fileName);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // File doesn't exist, continue
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * 設定を初期化（ファイルと環境変数を読み込み）
 */
export async function initializeConfig(
  options: {
    configPath?: string;
    useEnv?: boolean;
    overrides?: Partial<AidosConfig>;
  } = {}
): Promise<ConfigManager> {
  const manager = getConfigManager();

  // 設定ファイルを読み込み
  if (options.configPath) {
    await manager.loadFromFile(options.configPath);
  } else {
    const foundConfig = await findConfigFile();
    if (foundConfig) {
      await manager.loadFromFile(foundConfig);
    }
  }

  // 環境変数を読み込み
  if (options.useEnv !== false) {
    manager.loadFromEnv();
  }

  // オーバーライドを適用
  if (options.overrides) {
    manager.merge(options.overrides);
  }

  return manager;
}
