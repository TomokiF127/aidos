/**
 * Security Guardrails
 *
 * シークレット検出とセーフティチェック
 * - APIキー、パスワード、秘密鍵などの検出
 * - 危険なコードパターンの検出
 * - コミット前のセキュリティチェック
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ========================================
// Types
// ========================================

/**
 * シークレットの種類
 */
export type SecretType =
  | 'api_key'
  | 'password'
  | 'private_key'
  | 'aws'
  | 'db_connection'
  | 'token'
  | 'generic_secret';

/**
 * 危険なコードパターンの種類
 */
export type DangerousPatternType =
  | 'eval'
  | 'exec'
  | 'sql_injection'
  | 'command_injection'
  | 'path_traversal'
  | 'xxe'
  | 'unsafe_deserialization';

/**
 * シークレット検出結果
 */
export interface SecretMatch {
  type: SecretType;
  line: number;
  column: number;
  content: string; // マスク済みバージョン
  severity: 'critical' | 'high' | 'medium';
  rule: string;
  description: string;
}

/**
 * 危険なパターン検出結果
 */
export interface DangerousPatternMatch {
  type: DangerousPatternType;
  line: number;
  column: number;
  content: string;
  severity: 'critical' | 'high' | 'medium';
  rule: string;
  description: string;
  suggestion: string;
}

/**
 * セーフティチェック結果
 */
export interface SafetyCheckResult {
  safe: boolean;
  secrets: SecretMatch[];
  dangerousPatterns: DangerousPatternMatch[];
  warnings: string[];
  blockedFiles: string[];
  scannedFiles: number;
  scanDurationMs: number;
}

/**
 * ファイルスキャン結果
 */
export interface FileScanResult {
  filePath: string;
  secrets: SecretMatch[];
  dangerousPatterns: DangerousPatternMatch[];
  isBlocked: boolean;
  warnings: string[];
}

/**
 * ガードレールオプション
 */
export interface GuardrailsOptions {
  enableSecretDetection?: boolean;
  enableDangerousPatternDetection?: boolean;
  enableFileBlocking?: boolean;
  customSecretPatterns?: SecretPattern[];
  excludePatterns?: string[];
  maxFileSize?: number; // bytes
}

/**
 * シークレットパターン定義
 */
export interface SecretPattern {
  name: string;
  type: SecretType;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
  description: string;
}

/**
 * ガードレールイベント
 */
export type GuardrailsEvent =
  | 'secret:detected'
  | 'dangerous:detected'
  | 'warning:issued'
  | 'commit:blocked'
  | 'file:blocked'
  | 'scan:start'
  | 'scan:complete';

// ========================================
// Secret Patterns
// ========================================

/**
 * シークレット検出パターン
 */
const SECRET_PATTERNS: SecretPattern[] = [
  // API Keys
  {
    name: 'generic-api-key',
    type: 'api_key',
    pattern: /(?:api[_-]?key|apikey)['\"]?\s*[:=]\s*['\"]?[\w-]{20,}/gi,
    severity: 'critical',
    description: 'APIキーがハードコードされています',
  },
  {
    name: 'openai-api-key',
    type: 'api_key',
    pattern: /sk-[a-zA-Z0-9]{48,}/g,
    severity: 'critical',
    description: 'OpenAI APIキーが検出されました',
  },
  {
    name: 'anthropic-api-key',
    type: 'api_key',
    pattern: /sk-ant-[a-zA-Z0-9-]{32,}/g,
    severity: 'critical',
    description: 'Anthropic APIキーが検出されました',
  },
  {
    name: 'github-token',
    type: 'token',
    pattern: /ghp_[a-zA-Z0-9]{36,}/g,
    severity: 'critical',
    description: 'GitHub Personal Access Tokenが検出されました',
  },
  {
    name: 'github-oauth',
    type: 'token',
    pattern: /gho_[a-zA-Z0-9]{36,}/g,
    severity: 'critical',
    description: 'GitHub OAuth Tokenが検出されました',
  },
  {
    name: 'slack-token',
    type: 'token',
    pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
    severity: 'critical',
    description: 'Slack Tokenが検出されました',
  },

  // Passwords
  {
    name: 'password-assignment',
    type: 'password',
    pattern: /(?:password|passwd|pwd)['\"]?\s*[:=]\s*['\"][^'"]{8,}['\"]/gi,
    severity: 'critical',
    description: 'パスワードがハードコードされています',
  },

  // Secrets & Tokens
  {
    name: 'generic-secret',
    type: 'generic_secret',
    pattern: /(?:secret|token)['\"]?\s*[:=]\s*['\"][\w-]{20,}['\"]/gi,
    severity: 'high',
    description: 'シークレットまたはトークンがハードコードされています',
  },
  {
    name: 'jwt-token',
    type: 'token',
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    severity: 'high',
    description: 'JWT Tokenが検出されました',
  },
  {
    name: 'bearer-token',
    type: 'token',
    pattern: /Bearer\s+[a-zA-Z0-9_\-.]+/gi,
    severity: 'medium',
    description: 'Bearer Tokenが検出されました',
  },

  // Private Keys
  {
    name: 'rsa-private-key',
    type: 'private_key',
    pattern: /-----BEGIN\s*(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    severity: 'critical',
    description: 'RSA秘密鍵が検出されました',
  },
  {
    name: 'ec-private-key',
    type: 'private_key',
    pattern: /-----BEGIN\s*EC\s+PRIVATE\s+KEY-----/gi,
    severity: 'critical',
    description: 'EC秘密鍵が検出されました',
  },
  {
    name: 'dsa-private-key',
    type: 'private_key',
    pattern: /-----BEGIN\s*DSA\s+PRIVATE\s+KEY-----/gi,
    severity: 'critical',
    description: 'DSA秘密鍵が検出されました',
  },
  {
    name: 'openssh-private-key',
    type: 'private_key',
    pattern: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/gi,
    severity: 'critical',
    description: 'OpenSSH秘密鍵が検出されました',
  },
  {
    name: 'pgp-private-key',
    type: 'private_key',
    pattern: /-----BEGIN\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----/gi,
    severity: 'critical',
    description: 'PGP秘密鍵が検出されました',
  },

  // AWS Credentials
  {
    name: 'aws-access-key',
    type: 'aws',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'critical',
    description: 'AWS Access Key IDが検出されました',
  },
  {
    name: 'aws-secret-key',
    type: 'aws',
    pattern: /(?:aws[_-]?secret[_-]?(?:access[_-]?)?key)['\"]?\s*[:=]\s*['\"][A-Za-z0-9/+=]{40}['\"]/gi,
    severity: 'critical',
    description: 'AWS Secret Access Keyが検出されました',
  },

  // Database Connection Strings
  {
    name: 'mongodb-connection',
    type: 'db_connection',
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^\/\s]+/gi,
    severity: 'critical',
    description: 'MongoDB接続文字列（認証情報付き）が検出されました',
  },
  {
    name: 'postgres-connection',
    type: 'db_connection',
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^\/\s]+/gi,
    severity: 'critical',
    description: 'PostgreSQL接続文字列（認証情報付き）が検出されました',
  },
  {
    name: 'mysql-connection',
    type: 'db_connection',
    pattern: /mysql:\/\/[^:]+:[^@]+@[^\/\s]+/gi,
    severity: 'critical',
    description: 'MySQL接続文字列（認証情報付き）が検出されました',
  },
  {
    name: 'redis-connection',
    type: 'db_connection',
    pattern: /redis(?:s)?:\/\/[^:]*:[^@]+@[^\/\s]+/gi,
    severity: 'critical',
    description: 'Redis接続文字列（認証情報付き）が検出されました',
  },
];

// ========================================
// Dangerous Code Patterns
// ========================================

/**
 * 危険なコードパターン定義
 */
interface DangerousPattern {
  name: string;
  type: DangerousPatternType;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  suggestion: string;
  languages: string[];
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // Eval patterns
  {
    name: 'eval-usage',
    type: 'eval',
    pattern: /\beval\s*\(/g,
    severity: 'critical',
    description: 'eval()の使用はコード実行脆弱性のリスクがあります',
    suggestion: 'JSON.parse()や安全な代替手段を使用してください',
    languages: ['javascript', 'typescript', 'python'],
  },
  {
    name: 'function-constructor',
    type: 'eval',
    pattern: /new\s+Function\s*\(/g,
    severity: 'high',
    description: 'Function constructorはeval()と同様のリスクがあります',
    suggestion: '静的な関数定義を使用してください',
    languages: ['javascript', 'typescript'],
  },
  {
    name: 'settimeout-string',
    type: 'eval',
    pattern: /setTimeout\s*\(\s*['"]/g,
    severity: 'high',
    description: 'setTimeoutに文字列を渡すとeval()と同様に動作します',
    suggestion: '関数参照を渡してください',
    languages: ['javascript', 'typescript'],
  },
  {
    name: 'setinterval-string',
    type: 'eval',
    pattern: /setInterval\s*\(\s*['"]/g,
    severity: 'high',
    description: 'setIntervalに文字列を渡すとeval()と同様に動作します',
    suggestion: '関数参照を渡してください',
    languages: ['javascript', 'typescript'],
  },

  // Command injection
  {
    name: 'exec-usage',
    type: 'command_injection',
    pattern: /(?:child_process|exec|execSync|spawn|spawnSync)\s*\([^)]*\+/g,
    severity: 'critical',
    description: 'シェルコマンドに変数を連結するとコマンドインジェクションのリスクがあります',
    suggestion: 'execFileやspawnの配列引数形式を使用してください',
    languages: ['javascript', 'typescript'],
  },
  {
    name: 'shell-true',
    type: 'command_injection',
    pattern: /spawn\s*\([^)]*,\s*\{[^}]*shell\s*:\s*true/g,
    severity: 'high',
    description: 'shell: trueはコマンドインジェクションのリスクを高めます',
    suggestion: 'shell: falseを使用し、引数を配列で渡してください',
    languages: ['javascript', 'typescript'],
  },
  {
    name: 'python-os-system',
    type: 'command_injection',
    pattern: /os\.system\s*\([^)]*\+/g,
    severity: 'critical',
    description: 'os.system()に変数を連結するとコマンドインジェクションのリスクがあります',
    suggestion: 'subprocessモジュールを使用してください',
    languages: ['python'],
  },
  {
    name: 'python-subprocess-shell',
    type: 'command_injection',
    pattern: /subprocess\.[^(]+\([^)]*shell\s*=\s*True/g,
    severity: 'high',
    description: 'shell=Trueはコマンドインジェクションのリスクを高めます',
    suggestion: 'shell=Falseを使用し、引数をリストで渡してください',
    languages: ['python'],
  },

  // SQL injection
  {
    name: 'sql-string-concat',
    type: 'sql_injection',
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)[^;]*\+\s*(?:\w+|\$\{)/gi,
    severity: 'critical',
    description: 'SQL文に変数を連結するとSQLインジェクションのリスクがあります',
    suggestion: 'パラメータ化クエリ（プリペアドステートメント）を使用してください',
    languages: ['javascript', 'typescript', 'python'],
  },
  {
    name: 'sql-template-literal',
    type: 'sql_injection',
    pattern: /(?:query|execute|raw)\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`/gi,
    severity: 'critical',
    description: 'テンプレートリテラルでSQL文を構築するとSQLインジェクションのリスクがあります',
    suggestion: 'パラメータ化クエリを使用してください',
    languages: ['javascript', 'typescript'],
  },
  {
    name: 'sql-fstring',
    type: 'sql_injection',
    pattern: /(?:cursor\.execute|connection\.execute)\s*\(\s*f['"]/gi,
    severity: 'critical',
    description: 'f-stringでSQL文を構築するとSQLインジェクションのリスクがあります',
    suggestion: 'パラメータプレースホルダー（%s, ?）を使用してください',
    languages: ['python'],
  },

  // Path traversal
  {
    name: 'path-traversal-concat',
    type: 'path_traversal',
    pattern: /(?:readFile|writeFile|unlink|rmdir|mkdir|open)\s*\([^)]*\+\s*(?:req\.|request\.|params\.|query\.)/gi,
    severity: 'critical',
    description: 'ユーザー入力をファイルパスに連結するとパストラバーサルのリスクがあります',
    suggestion: 'path.resolve()とpath.normalize()でパスを検証してください',
    languages: ['javascript', 'typescript'],
  },
  {
    name: 'path-join-user-input',
    type: 'path_traversal',
    pattern: /path\.join\s*\([^)]*(?:req\.|request\.|params\.|query\.)/gi,
    severity: 'high',
    description: 'path.joinにユーザー入力を渡すとパストラバーサルのリスクがあります',
    suggestion: '入力を検証し、ベースディレクトリ外へのアクセスを防いでください',
    languages: ['javascript', 'typescript'],
  },

  // Unsafe deserialization
  {
    name: 'unsafe-pickle',
    type: 'unsafe_deserialization',
    pattern: /pickle\.loads?\s*\(/g,
    severity: 'critical',
    description: 'pickleのデシリアライズは任意コード実行のリスクがあります',
    suggestion: '信頼できないデータにはJSONを使用してください',
    languages: ['python'],
  },
  {
    name: 'unsafe-yaml-load',
    type: 'unsafe_deserialization',
    pattern: /yaml\.load\s*\([^)]*(?!Loader\s*=\s*yaml\.SafeLoader)/g,
    severity: 'critical',
    description: 'yaml.load()は任意コード実行のリスクがあります',
    suggestion: 'yaml.safe_load()を使用してください',
    languages: ['python'],
  },
  {
    name: 'unsafe-json-parse',
    type: 'unsafe_deserialization',
    pattern: /JSON\.parse\s*\(\s*(?:req\.|request\.|body)/g,
    severity: 'medium',
    description: '信頼できない入力のJSONパースには注意が必要です',
    suggestion: 'try-catchでエラーを処理し、スキーマ検証を行ってください',
    languages: ['javascript', 'typescript'],
  },

  // XXE
  {
    name: 'xxe-vulnerability',
    type: 'xxe',
    pattern: /(?:parseString|parseXml|DOMParser|XMLReader)/gi,
    severity: 'medium',
    description: 'XML解析はXXE（XML External Entity）攻撃のリスクがあります',
    suggestion: '外部エンティティの解決を無効にしてください',
    languages: ['javascript', 'typescript', 'python'],
  },
];

// ========================================
// Files to Block / Always Gitignore
// ========================================

/**
 * 常に.gitignoreに含めるべきファイルパターン
 */
export const GITIGNORE_RECOMMENDATIONS: string[] = [
  // Environment files
  '.env',
  '.env.local',
  '.env.*.local',
  '.env.development',
  '.env.test',
  '.env.production',
  '*.env',

  // Secret/credential files
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'credentials.json',
  'service-account.json',
  '.credentials',
  'google-credentials.json',
  'firebase-credentials.json',
  'firebase-admin*.json',
  'GoogleService-Info.plist',
  'google-services.json',

  // Key files
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa*',
  'id_dsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '*.ppk',

  // AWS
  '.aws/credentials',
  '.aws/config',
  'aws-exports.js',

  // SSH
  '.ssh/*',
  'known_hosts',

  // IDE/Editor
  '.idea/',
  '.vscode/settings.json',
  '*.swp',
  '*.swo',
  '*~',

  // OS
  '.DS_Store',
  'Thumbs.db',

  // Build/Dependencies
  'node_modules/',
  'dist/',
  'build/',
  '__pycache__/',
  '*.pyc',
  'venv/',
  '.venv/',

  // Logs
  '*.log',
  'logs/',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',

  // Database
  '*.sqlite',
  '*.sqlite3',
  '*.db',
  'dump.sql',

  // Config with potential secrets
  'config.local.json',
  'config.local.yaml',
  'local.settings.json',
  '.netrc',
  '.npmrc',
  '.yarnrc',

  // History files
  '.bash_history',
  '.zsh_history',
  '.python_history',
  '.node_repl_history',

  // Terraform
  '*.tfvars',
  '*.tfstate',
  '*.tfstate.*',
  '.terraform/',
];

/**
 * コミット時にブロックすべきファイルパターン
 */
const BLOCKED_FILE_PATTERNS: RegExp[] = [
  /\.env(?:\..+)?$/i,
  /(?:secrets?|credentials?)\.(?:json|ya?ml|toml)$/i,
  /(?:private[_-]?key|id_rsa|id_dsa|id_ecdsa|id_ed25519).*$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /firebase.*\.json$/i,
  /google.*(?:credentials?|service.?account).*\.json$/i,
  /aws-exports\.js$/i,
  /\.tfvars$/i,
];

/**
 * 警告を出すが、ブロックはしないファイルパターン
 */
const WARNING_FILE_PATTERNS: RegExp[] = [
  /config\.local\./i,
  /local\.settings\.json$/i,
  /\.npmrc$/i,
  /\.netrc$/i,
];

// ========================================
// SecurityGuardrails Class
// ========================================

/**
 * セキュリティガードレール
 */
export class SecurityGuardrails extends EventEmitter {
  private options: Required<GuardrailsOptions>;
  private secretPatterns: SecretPattern[];

  constructor(options: GuardrailsOptions = {}) {
    super();
    this.options = {
      enableSecretDetection: options.enableSecretDetection ?? true,
      enableDangerousPatternDetection: options.enableDangerousPatternDetection ?? true,
      enableFileBlocking: options.enableFileBlocking ?? true,
      customSecretPatterns: options.customSecretPatterns ?? [],
      excludePatterns: options.excludePatterns ?? ['node_modules', '.git', 'dist', 'build'],
      maxFileSize: options.maxFileSize ?? 1024 * 1024, // 1MB
    };

    // シークレットパターンをマージ
    this.secretPatterns = [...SECRET_PATTERNS, ...this.options.customSecretPatterns];
  }

  // ========================================
  // Content Scanning
  // ========================================

  /**
   * コンテンツをスキャンしてシークレットを検出
   */
  scanContent(content: string, filename?: string): SecretMatch[] {
    if (!this.options.enableSecretDetection) {
      return [];
    }

    const matches: SecretMatch[] = [];
    const lines = content.split('\n');

    for (const pattern of this.secretPatterns) {
      // 各行でパターンをチェック
      lines.forEach((line, lineIndex) => {
        // パターンをリセット（グローバルフラグ対応）
        pattern.pattern.lastIndex = 0;

        let match;
        while ((match = pattern.pattern.exec(line)) !== null) {
          const secretMatch: SecretMatch = {
            type: pattern.type,
            line: lineIndex + 1,
            column: match.index + 1,
            content: this.maskSecret(match[0]),
            severity: pattern.severity,
            rule: pattern.name,
            description: pattern.description,
          };

          matches.push(secretMatch);

          this.emit('secret:detected', {
            match: secretMatch,
            filename,
          });

          // グローバルフラグがない場合は無限ループを防ぐ
          if (!pattern.pattern.global) break;
        }
      });
    }

    return matches;
  }

  /**
   * コンテンツをスキャンして危険なパターンを検出
   */
  scanDangerousPatterns(
    content: string,
    language?: string,
    filename?: string
  ): DangerousPatternMatch[] {
    if (!this.options.enableDangerousPatternDetection) {
      return [];
    }

    const matches: DangerousPatternMatch[] = [];
    const lines = content.split('\n');

    for (const pattern of DANGEROUS_PATTERNS) {
      // 言語フィルタリング
      if (language && !pattern.languages.includes(language) && !pattern.languages.includes('*')) {
        continue;
      }

      lines.forEach((line, lineIndex) => {
        // コメント行をスキップ
        const trimmedLine = line.trim();
        if (
          trimmedLine.startsWith('//') ||
          trimmedLine.startsWith('#') ||
          trimmedLine.startsWith('*') ||
          trimmedLine.startsWith('/*')
        ) {
          return;
        }

        pattern.pattern.lastIndex = 0;

        let match;
        while ((match = pattern.pattern.exec(line)) !== null) {
          const dangerousMatch: DangerousPatternMatch = {
            type: pattern.type,
            line: lineIndex + 1,
            column: match.index + 1,
            content: match[0],
            severity: pattern.severity,
            rule: pattern.name,
            description: pattern.description,
            suggestion: pattern.suggestion,
          };

          matches.push(dangerousMatch);

          this.emit('dangerous:detected', {
            match: dangerousMatch,
            filename,
          });

          if (!pattern.pattern.global) break;
        }
      });
    }

    return matches;
  }

  // ========================================
  // File Scanning
  // ========================================

  /**
   * ファイルをスキャン
   */
  async scanFile(filePath: string): Promise<FileScanResult> {
    const result: FileScanResult = {
      filePath,
      secrets: [],
      dangerousPatterns: [],
      isBlocked: false,
      warnings: [],
    };

    // ファイル名チェック
    const filename = path.basename(filePath);

    if (this.options.enableFileBlocking && this.isFileBlocked(filePath)) {
      result.isBlocked = true;
      result.warnings.push(`ファイル "${filename}" は機密情報を含む可能性があるためブロックされています`);

      this.emit('file:blocked', { filePath, filename });
      return result;
    }

    // 警告ファイルチェック
    if (this.isFileWarning(filePath)) {
      result.warnings.push(`ファイル "${filename}" は機密情報を含む可能性があります。確認してください`);

      this.emit('warning:issued', {
        type: 'sensitive_file',
        filePath,
        message: result.warnings[result.warnings.length - 1],
      });
    }

    try {
      // ファイルサイズチェック
      const stats = await fs.stat(filePath);
      if (stats.size > this.options.maxFileSize) {
        result.warnings.push(`ファイルサイズが大きすぎます（${stats.size} bytes）。スキップしました`);
        return result;
      }

      // ファイル内容を読み込み
      const content = await fs.readFile(filePath, 'utf-8');
      const language = this.detectLanguage(filePath);

      // シークレットスキャン
      result.secrets = this.scanContent(content, filename);

      // 危険なパターンスキャン
      result.dangerousPatterns = this.scanDangerousPatterns(content, language, filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        result.warnings.push(`ファイルが見つかりません: ${filePath}`);
      } else if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
        result.warnings.push(`ディレクトリです: ${filePath}`);
      } else {
        result.warnings.push(`ファイル読み込みエラー: ${(error as Error).message}`);
      }
    }

    return result;
  }

  /**
   * ディレクトリをスキャン
   */
  async scanDirectory(dirPath: string): Promise<SafetyCheckResult> {
    const startTime = Date.now();

    this.emit('scan:start', { directory: dirPath });

    const result: SafetyCheckResult = {
      safe: true,
      secrets: [],
      dangerousPatterns: [],
      warnings: [],
      blockedFiles: [],
      scannedFiles: 0,
      scanDurationMs: 0,
    };

    try {
      await this.scanDirectoryRecursive(dirPath, result);
    } catch (error) {
      result.warnings.push(`ディレクトリスキャンエラー: ${(error as Error).message}`);
    }

    // 安全性判定
    result.safe =
      result.secrets.filter((s) => s.severity === 'critical').length === 0 &&
      result.dangerousPatterns.filter((d) => d.severity === 'critical').length === 0 &&
      result.blockedFiles.length === 0;

    result.scanDurationMs = Date.now() - startTime;

    this.emit('scan:complete', {
      directory: dirPath,
      result,
    });

    return result;
  }

  private async scanDirectoryRecursive(
    dirPath: string,
    result: SafetyCheckResult
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // 除外パターンチェック
      if (this.shouldExclude(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.scanDirectoryRecursive(fullPath, result);
      } else if (entry.isFile()) {
        const fileResult = await this.scanFile(fullPath);
        result.scannedFiles++;

        if (fileResult.isBlocked) {
          result.blockedFiles.push(fullPath);
        }

        result.secrets.push(...fileResult.secrets);
        result.dangerousPatterns.push(...fileResult.dangerousPatterns);
        result.warnings.push(...fileResult.warnings);
      }
    }
  }

  // ========================================
  // Commit Safety Check
  // ========================================

  /**
   * コミット前のセーフティチェック
   */
  async checkBeforeCommit(files: string[]): Promise<SafetyCheckResult> {
    const startTime = Date.now();

    const result: SafetyCheckResult = {
      safe: true,
      secrets: [],
      dangerousPatterns: [],
      warnings: [],
      blockedFiles: [],
      scannedFiles: 0,
      scanDurationMs: 0,
    };

    for (const filePath of files) {
      // 除外パターンチェック
      if (this.shouldExcludePath(filePath)) {
        continue;
      }

      const fileResult = await this.scanFile(filePath);
      result.scannedFiles++;

      if (fileResult.isBlocked) {
        result.blockedFiles.push(filePath);
      }

      result.secrets.push(...fileResult.secrets);
      result.dangerousPatterns.push(...fileResult.dangerousPatterns);
      result.warnings.push(...fileResult.warnings);
    }

    // 安全性判定
    const hasCriticalSecrets = result.secrets.some((s) => s.severity === 'critical');
    const hasCriticalPatterns = result.dangerousPatterns.some((d) => d.severity === 'critical');

    result.safe = !hasCriticalSecrets && result.blockedFiles.length === 0;

    if (!result.safe) {
      this.emit('commit:blocked', {
        reason: hasCriticalSecrets
          ? 'シークレットが検出されました'
          : 'ブロック対象ファイルが含まれています',
        result,
      });
    }

    result.scanDurationMs = Date.now() - startTime;

    return result;
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * シークレットをマスク
   */
  maskSecret(secret: string): string {
    if (secret.length <= 8) {
      return '*'.repeat(secret.length);
    }

    const visibleStart = 4;
    const visibleEnd = 4;
    const maskedLength = secret.length - visibleStart - visibleEnd;

    return secret.slice(0, visibleStart) + '*'.repeat(maskedLength) + secret.slice(-visibleEnd);
  }

  /**
   * ファイルがブロック対象かチェック
   */
  isFileBlocked(filePath: string): boolean {
    const filename = path.basename(filePath);
    return BLOCKED_FILE_PATTERNS.some((pattern) => pattern.test(filename) || pattern.test(filePath));
  }

  /**
   * ファイルが警告対象かチェック
   */
  isFileWarning(filePath: string): boolean {
    const filename = path.basename(filePath);
    return WARNING_FILE_PATTERNS.some((pattern) => pattern.test(filename) || pattern.test(filePath));
  }

  /**
   * ファイルが.gitignoreに含まれるべきかチェック
   */
  isFileIgnored(filePath: string): boolean {
    const filename = path.basename(filePath);
    const normalizedPath = filePath.replace(/\\/g, '/');

    return GITIGNORE_RECOMMENDATIONS.some((pattern) => {
      if (pattern.endsWith('/')) {
        // ディレクトリパターン
        return normalizedPath.includes(pattern.slice(0, -1));
      } else if (pattern.startsWith('*.')) {
        // 拡張子パターン
        return filename.endsWith(pattern.slice(1));
      } else if (pattern.includes('*')) {
        // ワイルドカードパターン
        const regex = new RegExp(
          '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
        );
        return regex.test(filename);
      } else {
        // 完全一致
        return filename === pattern || normalizedPath.endsWith('/' + pattern);
      }
    });
  }

  /**
   * 拡張子から言語を検出
   */
  private detectLanguage(filePath: string): string | undefined {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.kt': 'kotlin',
      '.swift': 'swift',
      '.php': 'php',
      '.cs': 'csharp',
      '.sql': 'sql',
      '.sh': 'bash',
      '.bash': 'bash',
      '.zsh': 'bash',
    };

    return languageMap[ext];
  }

  /**
   * 除外パターンにマッチするかチェック
   */
  private shouldExclude(name: string): boolean {
    return this.options.excludePatterns.some(
      (pattern) => name === pattern || name.startsWith(pattern)
    );
  }

  /**
   * パス全体で除外パターンにマッチするかチェック
   */
  private shouldExcludePath(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return this.options.excludePatterns.some(
      (pattern) =>
        normalizedPath.includes('/' + pattern + '/') || normalizedPath.includes('/' + pattern)
    );
  }

  /**
   * .gitignore推奨リストを取得
   */
  getGitignoreRecommendations(): string[] {
    return [...GITIGNORE_RECOMMENDATIONS];
  }

  /**
   * カスタムシークレットパターンを追加
   */
  addSecretPattern(pattern: SecretPattern): void {
    this.secretPatterns.push(pattern);
  }

  /**
   * シークレットパターンを削除
   */
  removeSecretPattern(patternName: string): boolean {
    const index = this.secretPatterns.findIndex((p) => p.name === patternName);
    if (index !== -1) {
      this.secretPatterns.splice(index, 1);
      return true;
    }
    return false;
  }
}

// ========================================
// Singleton Instance
// ========================================

let guardrailsInstance: SecurityGuardrails | null = null;

/**
 * SecurityGuardrailsのシングルトンインスタンスを取得
 */
export function getSecurityGuardrails(options?: GuardrailsOptions): SecurityGuardrails {
  if (!guardrailsInstance) {
    guardrailsInstance = new SecurityGuardrails(options);
  }
  return guardrailsInstance;
}

/**
 * SecurityGuardrailsインスタンスをリセット（テスト用）
 */
export function resetSecurityGuardrails(): void {
  guardrailsInstance = null;
}

// ========================================
// Convenience Functions
// ========================================

/**
 * コンテンツからシークレットをスキャン
 */
export function scanForSecrets(content: string, filename?: string): SecretMatch[] {
  const guardrails = getSecurityGuardrails();
  return guardrails.scanContent(content, filename);
}

/**
 * コンテンツから危険なパターンをスキャン
 */
export function scanForDangerousPatterns(
  content: string,
  language?: string,
  filename?: string
): DangerousPatternMatch[] {
  const guardrails = getSecurityGuardrails();
  return guardrails.scanDangerousPatterns(content, language, filename);
}

/**
 * コミット前のセーフティチェック
 */
export async function checkCommitSafety(stagedFiles: string[]): Promise<SafetyCheckResult> {
  const guardrails = getSecurityGuardrails();
  return guardrails.checkBeforeCommit(stagedFiles);
}

/**
 * ファイルがブロック対象かチェック
 */
export function isFileBlocked(filePath: string): boolean {
  const guardrails = getSecurityGuardrails();
  return guardrails.isFileBlocked(filePath);
}

/**
 * シークレットをマスク
 */
export function maskSecret(secret: string): string {
  const guardrails = getSecurityGuardrails();
  return guardrails.maskSecret(secret);
}

/**
 * .gitignore推奨リストを取得
 */
export function getGitignoreRecommendations(): string[] {
  return [...GITIGNORE_RECOMMENDATIONS];
}
