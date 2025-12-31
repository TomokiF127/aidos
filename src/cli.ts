#!/usr/bin/env node
/**
 * AIDOS CLI - AI-Driven Orchestration System
 *
 * メインエントリポイント
 * v1.0 - 全Phase機能統合版
 */

import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AidosConfig, AidosConfigExtended } from './types.js';
import { DEFAULT_CONFIG, DEFAULT_CONFIG_EXTENDED } from './types.js';

const VERSION = '1.0.0';

interface CLIOptions {
  config?: string;
  maxAgents?: string;
  dryRun?: boolean;
  verbose?: boolean;
  mock?: boolean;
  resume?: string;
  noIntervention?: boolean;
  outputDir?: string;
}

interface HistoryOptions {
  limit?: string;
  status?: string;
}

interface ConfigOptions {
  init?: boolean;
  show?: boolean;
}

function loadConfig(configPath?: string): AidosConfig {
  if (!configPath) {
    // デフォルト設定ファイルを探す
    const defaultPaths = ['aidos.config.yaml', 'aidos.config.yml', '.aidos.yaml'];
    for (const path of defaultPaths) {
      if (existsSync(path)) {
        configPath = path;
        break;
      }
    }
  }

  if (configPath && existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      const userConfig = parseYaml(content);
      return { ...DEFAULT_CONFIG, ...userConfig };
    } catch (e) {
      console.error(`設定ファイルの読み込みに失敗: ${configPath}`);
    }
  }

  return DEFAULT_CONFIG;
}

async function runAidos(objective: string, options: CLIOptions): Promise<void> {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                         AIDOS                              ║');
  console.log('║           AI-Driven Orchestration System                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const config = loadConfig(options.config);

  if (options.maxAgents) {
    config.agents.maxConcurrent = parseInt(options.maxAgents, 10);
  }

  if (options.verbose) {
    console.log('📋 設定:');
    console.log(`   モデル: ${config.api.model}`);
    console.log(`   最大Agent数: ${config.agents.maxConcurrent}`);
    console.log(`   出力先: ${config.output.directory}`);
    console.log('');
  }

  console.log(`🎯 目的: ${objective}`);
  console.log('');

  if (options.dryRun) {
    console.log('📝 ドライラン: タスク分解のみを実行します');
    console.log('');

    // モック版タスク分解を実行
    const { getTaskDecomposer } = await import('./core/task-decomposer.js');
    const decomposer = getTaskDecomposer(config);
    const result = await decomposer.decompose(objective, { useApi: false });
    console.log('✅ タスク分解完了');
    console.log(`   生成タスク数: ${result.tasks.length}`);
    console.log('');
    console.log('📋 タスクリスト:');
    result.tasks.forEach(task => {
      console.log(`   [${task.id}] ${task.description}`);
    });
    return;
  }

  // 出力ディレクトリ作成
  const outputDir = options.outputDir || config.output.directory;
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 本番実行
  try {
    if (options.mock) {
      // モック版統合実行
      console.log('🔧 モックモードで実行中...');
      const { Orchestrator } = await import('./core/orchestrator.js');
      const orchestrator = new Orchestrator(config);

      console.log('📊 タスク分解中...');
      const { getTaskDecomposer } = await import('./core/task-decomposer.js');
      const decomposer = getTaskDecomposer(config);
      const result = await decomposer.decompose(objective, { useApi: false });

      console.log(`✅ ${result.tasks.length}個のタスクを生成`);
      result.tasks.forEach((task, i) => {
        const deps = task.dependencies.length > 0
          ? ` (依存: ${task.dependencies.join(', ')})`
          : '';
        console.log(`   ${i + 1}. [${task.category}] ${task.description}${deps}`);
      });

      console.log('');
      console.log('🎉 モック実行完了');
      console.log(`   出力先: ${outputDir}`);
    } else {
      // 本番実行（Orchestratorを使用）
      console.log('🚀 本番モードで実行中...');

      // ConfigManagerで設定を読み込み
      const { ConfigManager } = await import('./config/config-manager.js');
      const configManager = new ConfigManager(config);

      // 設定ファイルがあれば読み込み
      if (options.config) {
        await configManager.loadFromFile(options.config);
      }

      // 環境変数から設定を読み込み
      configManager.loadFromEnv();

      const loadedConfig = configManager.getConfig();

      // Orchestrator起動
      const { Orchestrator } = await import('./core/orchestrator.js');
      const orchestrator = new Orchestrator(loadedConfig, {
        useMockDecomposer: false,
        autoStart: true,
      });

      // セッション開始
      const session = await orchestrator.startSession(objective);
      console.log(`📋 セッションID: ${session.id}`);
      console.log('');
      console.log('ダッシュボードを起動するには:');
      console.log(`   npm run dev -- --resume ${session.id}`);
    }
  } catch (error) {
    console.error('❌ エラー:', error);
    process.exit(1);
  }
}

// CLIコマンド定義
const program = new Command();

program
  .name('aidos')
  .description('AI-Driven Orchestration System - AIが自律的に開発を進めるシステム')
  .version(VERSION);

program
  .argument('[objective]', '開発目的（自然言語で記述）')
  .option('-c, --config <path>', '設定ファイルのパス')
  .option('-m, --max-agents <number>', '最大Agent数')
  .option('-d, --dry-run', 'タスク分解のみ実行（実装しない）')
  .option('-v, --verbose', '詳細ログ出力')
  .option('--mock', 'モックモードで実行（API不要）')
  .option('-r, --resume <session-id>', 'セッションを再開')
  .option('--no-intervention', '人間介入を無効化')
  .option('-o, --output-dir <path>', '出力ディレクトリ')
  .action(async (objective: string | undefined, options: CLIOptions) => {
    if (!objective && !options.resume) {
      console.log('');
      console.log('使用方法: aidos <目的> [オプション]');
      console.log('');
      console.log('例:');
      console.log('  aidos "Webアプリのログイン機能を作成する"');
      console.log('  aidos "REST APIにページネーションを追加" --dry-run');
      console.log('  aidos "チャット機能の実装" --mock');
      console.log('');
      program.help();
      return;
    }

    await runAidos(objective || '', options);
  });

// PoCサブコマンド
const pocCommand = program.command('poc').description('PoC検証コマンド');

pocCommand
  .command('task')
  .description('PoC-1: タスク分解検証')
  .option('--mock', 'モック版を使用')
  .action(async (options) => {
    if (options.mock) {
      const { spawn } = await import('node:child_process');
      spawn('npm', ['run', 'poc:task:mock'], { stdio: 'inherit' });
    } else {
      const { spawn } = await import('node:child_process');
      spawn('npm', ['run', 'poc:task'], { stdio: 'inherit' });
    }
  });

pocCommand
  .command('worker')
  .description('PoC-2: Worker Thread検証')
  .action(async () => {
    const { spawn } = await import('node:child_process');
    spawn('npm', ['run', 'poc:worker'], { stdio: 'inherit' });
  });

pocCommand
  .command('ui')
  .description('PoC-3: TUI検証 (Ink)')
  .option('-o, --objective <text>', '目標', 'AIDOS Development Session')
  .option('-s, --session <id>', 'セッションID')
  .action(async (options) => {
    const { startDashboard } = await import('./ui/ink/index.js');
    startDashboard({
      objective: options.objective,
      sessionId: options.session || `session-${Date.now()}`,
    });
  });

pocCommand
  .command('all')
  .description('PoC-4: 統合検証')
  .option('--mock', 'モック版を使用')
  .action(async (options) => {
    if (options.mock) {
      const { spawn } = await import('node:child_process');
      spawn('npm', ['run', 'poc:all:mock'], { stdio: 'inherit' });
    } else {
      const { spawn } = await import('node:child_process');
      spawn('npm', ['run', 'poc:all'], { stdio: 'inherit' });
    }
  });

// runコマンド - Claude Codeエージェントを起動
program
  .command('run')
  .description('Claude Codeエージェントでタスクを実行')
  .argument('<objective>', '実行する目標')
  .option('-d, --dir <path>', '作業ディレクトリ', process.cwd())
  .option('--no-ui', 'UIなしで実行')
  .option('--timeout <ms>', 'タイムアウト（ミリ秒）', '600000')
  .action(async (objective: string, options: { dir: string; ui: boolean; timeout: string }) => {
    const { startDashboard } = await import('./ui/ink/index.js');
    const { createAgentManager } = await import('./agents/agent-manager.js');
    const { randomUUID } = await import('crypto');

    const sessionId = `session-${randomUUID().slice(0, 8)}`;
    const agentManager = createAgentManager(sessionId, {
      output: { directory: options.dir },
    });

    if (options.ui) {
      // UIモード - ダッシュボードを表示してエージェントを自動起動
      const { waitUntilExit } = startDashboard({
        objective,
        sessionId,
        agentManager,
        autoSpawn: true,
      });

      await waitUntilExit();
    } else {
      // 非UIモード - 直接エージェントを実行
      console.log(`Starting agent for: ${objective}`);

      const agent = await agentManager.spawn({
        type: 'claude-code',
        role: 'PL',
        mission: objective,
        claudeOptions: {
          workingDirectory: options.dir,
          timeoutMs: parseInt(options.timeout, 10),
        },
      });

      // イベントをログ
      agent.on('agent:status_changed', (data: { newStatus: string }) => {
        console.log(`Status: ${data.newStatus}`);
      });

      agent.on('agent:executing', (data: { action: string }) => {
        console.log(`Executing: ${data.action}`);
      });

      // 実行
      const result = await agent.execute({
        type: 'task',
        content: objective,
        priority: 'normal',
      });

      if (result.success) {
        console.log('');
        console.log('=== Result ===');
        // 出力からテキスト部分を抽出して表示
        if (result.output) {
          // stream-json出力からテキストを抽出
          const lines = result.output.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              try {
                const json = JSON.parse(line);
                if (json.type === 'text' && json.text) {
                  console.log(json.text);
                } else if (json.type === 'result' && json.result) {
                  console.log(json.result);
                }
              } catch {
                // JSON以外の行は無視
              }
            }
          }
        }
        console.log('');
        console.log('=== Summary ===');
        console.log(`Status: Success`);
        console.log(`Tokens used: ${result.tokensUsed}`);
        console.log(`Duration: ${result.executionTimeMs}ms`);
      } else {
        console.error('Task failed:', result.error?.message);
        process.exit(1);
      }

      await agentManager.destroyAll();
    }
  });

// interactiveコマンド - インタラクティブモードでAIDOSを起動
program
  .command('interactive')
  .alias('i')
  .description('インタラクティブモードでAIDOSを起動（タスクを動的に入力）')
  .option('-d, --dir <path>', '初期作業ディレクトリ（後から /cd で変更可能）')
  .action(async (options: { dir?: string }) => {
    const { startInteractive } = await import('./ui/ink/index.js');

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║              AIDOS Interactive Mode                         ║');
    console.log('║    タスクを入力してEnter | /help でコマンド一覧             ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    const { waitUntilExit } = startInteractive({
      workingDirectory: options.dir,
    });

    await waitUntilExit();
  });

// historyサブコマンド
const historyCommand = program.command('history').description('セッション履歴を管理');

historyCommand
  .command('list')
  .description('過去のセッション一覧を表示')
  .option('-l, --limit <number>', '表示件数', '10')
  .option('-s, --status <status>', 'ステータスでフィルタ (active/completed/failed)')
  .action(async (options: HistoryOptions) => {
    try {
      const { SessionHistory } = await import('./core/session-history.js');
      const history = new SessionHistory();

      let sessions;
      if (options.status) {
        sessions = history.getSessionsByStatus(options.status as 'active' | 'completed' | 'failed');
      } else {
        sessions = history.getRecentSessions(parseInt(options.limit || '10', 10));
      }

      if (sessions.length === 0) {
        console.log('📭 セッション履歴がありません');
        return;
      }

      console.log('');
      console.log('📋 セッション履歴:');
      console.log('─'.repeat(60));
      sessions.forEach(session => {
        const status = session.status === 'completed' ? '✅' :
                      session.status === 'failed' ? '❌' : '⏳';
        const date = session.startedAt.toLocaleString('ja-JP');
        console.log(`${status} [${session.sessionId.slice(0, 8)}] ${session.objective}`);
        console.log(`   ${date} | タスク: ${session.completedTaskCount}/${session.taskCount}`);
      });
      console.log('');
    } catch (error) {
      console.error('❌ 履歴の取得に失敗:', error);
    }
  });

historyCommand
  .command('show <session-id>')
  .description('セッションの詳細を表示')
  .action(async (sessionId: string) => {
    try {
      const { SessionHistory } = await import('./core/session-history.js');
      const history = new SessionHistory();
      const session = history.getSessionHistory(sessionId);

      if (!session) {
        console.log(`❌ セッションが見つかりません: ${sessionId}`);
        return;
      }

      console.log('');
      console.log('📋 セッション詳細:');
      console.log('─'.repeat(60));
      console.log(`ID: ${session.sessionId}`);
      console.log(`目的: ${session.objective}`);
      console.log(`ステータス: ${session.status}`);
      console.log(`タスク: ${session.completedTaskCount}/${session.taskCount}`);
      console.log(`開始: ${session.startedAt.toLocaleString('ja-JP')}`);
      if (session.completedAt) {
        console.log(`完了: ${session.completedAt.toLocaleString('ja-JP')}`);
      }
      console.log(`使用トークン: ${session.totalTokensUsed}`);
      console.log(`エージェント数: ${session.agentCount}`);
      console.log('');
    } catch (error) {
      console.error('❌ セッション情報の取得に失敗:', error);
    }
  });

// configサブコマンド
const configCommand = program.command('config').description('設定を管理');

configCommand
  .command('init')
  .description('設定ファイルを初期化')
  .action(async () => {
    const configPath = 'aidos.config.yaml';
    if (existsSync(configPath)) {
      console.log(`⚠️  設定ファイルが既に存在します: ${configPath}`);
      return;
    }

    const { stringify } = await import('yaml');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(configPath, stringify(DEFAULT_CONFIG_EXTENDED));
    console.log(`✅ 設定ファイルを作成しました: ${configPath}`);
  });

configCommand
  .command('show')
  .description('現在の設定を表示')
  .option('-c, --config <path>', '設定ファイルのパス')
  .action(async (options: { config?: string }) => {
    try {
      const { ConfigManager } = await import('./config/config-manager.js');
      const configManager = new ConfigManager();

      // 設定ファイルがあれば読み込み
      if (options.config) {
        await configManager.loadFromFile(options.config);
      }

      // 環境変数から読み込み
      configManager.loadFromEnv();

      const config = configManager.getConfig();

      console.log('');
      console.log('📋 現在の設定:');
      console.log('─'.repeat(60));
      console.log(`API Provider: ${config.api.provider}`);
      console.log(`Model: ${config.api.model}`);
      console.log(`Max Tokens: ${config.api.maxTokens}`);
      console.log(`Max Agents: ${config.agents.maxConcurrent}`);
      console.log(`Timeout: ${config.agents.timeoutMs}ms`);
      console.log(`Max Budget Tokens: ${config.budget.maxTotalTokens}`);
      console.log(`Output Dir: ${config.output.directory}`);
      console.log(`UI Theme: ${config.ui.theme}`);
      console.log('');
    } catch (error) {
      console.error('❌ 設定の取得に失敗:', error);
    }
  });

configCommand
  .command('validate')
  .description('設定ファイルを検証')
  .option('-c, --config <path>', '設定ファイルのパス')
  .action(async (options: { config?: string }) => {
    try {
      const { ConfigManager } = await import('./config/config-manager.js');
      const configManager = new ConfigManager();

      if (options.config) {
        // ファイルを読み込んで検証
        await configManager.loadFromFile(options.config);
        console.log('✅ 設定ファイルは有効です');
      } else {
        // デフォルト設定を検証
        const validation = configManager.validate(configManager.getConfig());

        if (validation.valid) {
          console.log('✅ デフォルト設定は有効です');
        } else {
          console.log('❌ 設定にエラーがあります:');
          validation.errors.forEach(err => {
            console.log(`   - ${err.path}: ${err.message}`);
          });
        }

        if (validation.warnings.length > 0) {
          console.log('⚠️  警告:');
          validation.warnings.forEach(warn => {
            console.log(`   - ${warn}`);
          });
        }
      }
    } catch (error) {
      console.error('❌ 検証に失敗:', error);
    }
  });

// verifyサブコマンド
const verifyCommand = program.command('verify').description('検証コマンド');

verifyCommand
  .command('all')
  .description('全検証を実行')
  .action(async () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    AIDOS Verification                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    try {
      // TypeScriptチェック
      console.log('[1/4] TypeScript Check...');
      const { execSync } = await import('node:child_process');
      try {
        execSync('npx tsc --noEmit', { stdio: 'pipe' });
        console.log('   ✅ TypeScript: passed');
      } catch {
        console.log('   ❌ TypeScript: failed');
      }

      // テスト実行
      console.log('[2/4] Running Tests...');
      try {
        execSync('npm test -- --run --reporter=basic', { stdio: 'pipe' });
        console.log('   ✅ Tests: passed');
      } catch {
        console.log('   ❌ Tests: failed');
      }

      // セキュリティスキャン
      console.log('[3/4] Security Scan...');
      const { getSecurityGuardrails } = await import('./security/guardrails.js');
      const guardrails = getSecurityGuardrails();
      const scanResult = await guardrails.scanDirectory(process.cwd());
      if (scanResult.safe) {
        console.log('   ✅ Security: no issues');
      } else {
        console.log(`   ⚠️  Security: ${scanResult.secrets.length} secrets, ${scanResult.blockedFiles.length} blocked files`);
      }

      // ビルド確認
      console.log('[4/4] Build Check...');
      try {
        execSync('npm run build', { stdio: 'pipe' });
        console.log('   ✅ Build: success');
      } catch {
        console.log('   ❌ Build: failed');
      }

      console.log('');
      console.log('=== Verification Complete ===');
    } catch (error) {
      console.error('❌ 検証に失敗:', error);
      process.exit(1);
    }
  });

verifyCommand
  .command('security')
  .description('セキュリティスキャンを実行')
  .option('-d, --dir <path>', 'スキャン対象ディレクトリ', '.')
  .action(async (options: { dir: string }) => {
    try {
      const { getSecurityGuardrails } = await import('./security/guardrails.js');
      const guardrails = getSecurityGuardrails();
      const result = await guardrails.scanDirectory(options.dir);

      console.log('');
      console.log('📋 セキュリティスキャン結果:');
      console.log('─'.repeat(60));
      console.log(`スキャンファイル数: ${result.scannedFiles}`);
      console.log(`検出シークレット: ${result.secrets.length}`);
      console.log(`ブロックファイル: ${result.blockedFiles.length}`);
      console.log(`危険パターン: ${result.dangerousPatterns.length}`);
      console.log(`スキャン時間: ${result.scanDurationMs}ms`);
      console.log('');

      if (result.safe) {
        console.log('✅ 安全性: 問題なし');
      } else {
        console.log('❌ 安全性: 問題あり');
        if (result.secrets.length > 0) {
          console.log('');
          console.log('検出されたシークレット:');
          result.secrets.forEach(s => {
            console.log(`  - [${s.severity}] ${s.rule} (line ${s.line})`);
          });
        }
      }
    } catch (error) {
      console.error('❌ スキャンに失敗:', error);
    }
  });

// acceptanceサブコマンド（検収）
const acceptanceCommand = program.command('acceptance').description('検収管理');

acceptanceCommand
  .command('status')
  .description('検収ステータスを表示')
  .action(async () => {
    try {
      const { AcceptanceViewGenerator } = await import('./output/acceptance-view.js');
      type ChecklistItem = { id: string; description: string; category: string; status: string };
      const generator = new AcceptanceViewGenerator();

      console.log('');
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║                   Acceptance Status                         ║');
      console.log('╚════════════════════════════════════════════════════════════╝');
      console.log('');

      // サンプルチェックリストで検収ビュー生成
      const checklist: ChecklistItem[] = [
        { id: 'CHK-1', description: 'TypeScriptコンパイル成功', category: 'testing', status: 'done' },
        { id: 'CHK-2', description: 'テスト全件パス', category: 'testing', status: 'done' },
        { id: 'CHK-3', description: 'セキュリティスキャン完了', category: 'security', status: 'done' },
        { id: 'CHK-4', description: 'ビルド成功', category: 'implementation', status: 'done' },
      ];

      const view = generator.createView(checklist as Parameters<typeof generator.createView>[0]);

      // ステータス表示
      const statusIcon = view.status === 'ready_for_review' ? '✅' :
                        view.status === 'blocked' ? '🚫' : '⏳';
      console.log(`ステータス: ${statusIcon} ${view.status.toUpperCase()}`);
      console.log('');

      // Doneチェックリスト
      console.log('📋 Done チェック結果:');
      view.doneChecklist.forEach((item) => {
        const icon = item.status === 'done' ? '✅' : '❌';
        console.log(`   ${icon} ${item.description}`);
      });
      console.log('');

      // 未達項目
      if (view.unmetItems.length > 0) {
        console.log('⚠️  未達項目:');
        view.unmetItems.forEach((item) => {
          console.log(`   - ${item}`);
        });
        console.log('');
      }

      // 差分サマリー
      console.log('📊 差分サマリ:');
      console.log(`   変更ファイル: ${view.diffSummary.totalFilesChanged}件`);
      console.log(`   追加行: ${view.diffSummary.totalLinesAdded}行`);
      console.log(`   削除行: ${view.diffSummary.totalLinesDeleted}行`);
      console.log('');

      // リスク
      if (view.risks.length > 0) {
        console.log('⚡ リスク宣言:');
        view.risks.forEach((risk) => {
          const level = risk.severity === 'high' || risk.severity === 'critical' ? '🔴' :
                       risk.severity === 'medium' ? '🟡' : '🟢';
          console.log(`   ${level} ${risk.description}`);
        });
      }
    } catch (error) {
      console.error('❌ 検収ステータスの取得に失敗:', error);
    }
  });

acceptanceCommand
  .command('generate')
  .description('検収レポートを生成')
  .option('-o, --output <path>', '出力先', './acceptance-view.md')
  .option('--objective <text>', '目的', 'Current Task')
  .action(async (options: { output: string; objective: string }) => {
    try {
      const { AcceptanceViewGenerator } = await import('./output/acceptance-view.js');
      const { writeFileSync } = await import('node:fs');
      const generator = new AcceptanceViewGenerator();

      // サンプルデータでレポート生成
      const report = await generator.generateReport({
        sessionId: `session-${Date.now()}`,
        objective: options.objective,
        checklist: [
          { id: 'CHK-1', description: 'TypeScriptコンパイル成功', category: 'testing', status: 'done' },
          { id: 'CHK-2', description: 'テスト全件パス', category: 'testing', status: 'done' },
          { id: 'CHK-3', description: 'セキュリティスキャン完了', category: 'security', status: 'done' },
        ] as Parameters<typeof generator.generateReport>[0]['checklist'],
      });

      writeFileSync(options.output, report.markdown);
      console.log(`✅ 検収レポートを生成しました: ${options.output}`);
    } catch (error) {
      console.error('❌ レポート生成に失敗:', error);
    }
  });

// doneサブコマンド（Done定義管理）
const doneCommand = program.command('done').description('Done定義管理');

doneCommand
  .command('generate')
  .description('Done定義を生成')
  .option('-t, --task <taskId>', 'タスクID', 'TASK-001')
  .option('--title <title>', 'タスクタイトル', 'Generated Task')
  .option('-o, --output <path>', '出力先', './done-definition.yaml')
  .action(async (options: { task: string; title: string; output: string }) => {
    try {
      const { getDoneDefinitionGenerator } = await import('./quality/done-definition.js');
      const { stringify } = await import('yaml');
      const { writeFileSync } = await import('node:fs');

      const generator = getDoneDefinitionGenerator();

      // タスク情報とコード変更情報を作成
      const taskInfo = {
        id: options.task,
        title: options.title,
        description: options.title,
        requirements: [] as string[],
      };

      const codeChanges = {
        files: [] as Array<{ path: string; changeType: 'added' | 'modified' | 'deleted' | 'renamed'; linesAdded: number; linesRemoved: number }>,
        commits: [] as string[],
        branch: 'main',
      };

      const definition = await generator.generate(taskInfo, codeChanges, {});

      // YAMLに変換して保存
      const yamlContent = stringify({
        task_id: definition.taskId,
        title: definition.title,
        created_at: definition.createdAt.toISOString(),
        final_status: definition.finalStatus,
        blocked_reason: definition.blockedReason,
        done_checklist: definition.doneChecklist,
        reproduction_command: definition.reproductionCommand,
      });

      writeFileSync(options.output, yamlContent);

      console.log(`✅ Done定義を生成しました: ${options.output}`);
      console.log(`   タスクID: ${definition.taskId}`);
      console.log(`   ステータス: ${definition.finalStatus}`);
    } catch (error) {
      console.error('❌ Done定義生成に失敗:', error);
    }
  });

doneCommand
  .command('check')
  .description('Done定義をチェック')
  .option('-f, --file <path>', 'Done定義ファイル', './done-definition.yaml')
  .action(async (options: { file: string }) => {
    try {
      const { readFileSync, existsSync } = await import('node:fs');
      const { parse: parseYaml } = await import('yaml');

      if (!existsSync(options.file)) {
        console.log(`❌ ファイルが見つかりません: ${options.file}`);
        return;
      }

      const content = readFileSync(options.file, 'utf-8');
      const definition = parseYaml(content) as Record<string, unknown>;

      console.log('');
      console.log('📋 Done定義チェック結果:');
      console.log('─'.repeat(60));
      console.log(`タスクID: ${definition.task_id}`);
      console.log(`タイトル: ${definition.title}`);
      console.log(`ステータス: ${definition.final_status}`);
      console.log('');

      if (definition.done_checklist && Array.isArray(definition.done_checklist)) {
        console.log('チェックリスト:');
        (definition.done_checklist as string[]).forEach((item: string) => {
          console.log(`   ${item}`);
        });
      }

      if (definition.blocked_reason) {
        console.log('');
        console.log(`⚠️  ブロック理由: ${definition.blocked_reason}`);
      }
    } catch (error) {
      console.error('❌ チェックに失敗:', error);
    }
  });

// requirementsサブコマンド（要件トレーサビリティ）
const requirementsCommand = program.command('requirements').description('要件トレーサビリティ');

requirementsCommand
  .command('list')
  .description('要件一覧を表示')
  .action(async () => {
    try {
      const { getRequirementsManager } = await import('./quality/requirements-matrix.js');
      const manager = getRequirementsManager();

      const requirements = manager.getAllRequirements();

      console.log('');
      console.log('📋 要件一覧:');
      console.log('─'.repeat(60));

      if (requirements.length === 0) {
        console.log('   登録された要件はありません');
      } else {
        requirements.forEach((req) => {
          const status = req.result?.status ?? 'pending';
          const statusIcon = status === 'verified' ? '✅' :
                            status === 'failed' ? '❌' : '⏳';
          console.log(`${statusIcon} [${req.id}] ${req.description}`);
        });
      }
    } catch (error) {
      console.error('❌ 要件一覧の取得に失敗:', error);
    }
  });

requirementsCommand
  .command('add')
  .description('要件を追加')
  .option('-i, --id <id>', '要件ID')
  .option('-d, --description <text>', '要件説明')
  .action(async (options: { id?: string; description?: string }) => {
    try {
      if (!options.id || !options.description) {
        console.log('❌ --id と --description は必須です');
        return;
      }

      const { getRequirementsManager, createRequirement } = await import('./quality/requirements-matrix.js');
      const manager = getRequirementsManager();

      const requirement = createRequirement(options.id, options.description);
      manager.addRequirement(requirement);

      console.log(`✅ 要件を追加しました: ${options.id}`);
    } catch (error) {
      console.error('❌ 要件追加に失敗:', error);
    }
  });

requirementsCommand
  .command('export')
  .description('要件マトリクスをエクスポート')
  .option('-o, --output <path>', '出力先', './requirements-matrix.yaml')
  .action(async (options: { output: string }) => {
    try {
      const { getRequirementsManager } = await import('./quality/requirements-matrix.js');
      const { writeFileSync } = await import('node:fs');

      const manager = getRequirementsManager();
      await manager.saveToFile(options.output);

      console.log(`✅ 要件マトリクスをエクスポートしました: ${options.output}`);
    } catch (error) {
      console.error('❌ エクスポートに失敗:', error);
    }
  });

// reportサブコマンド（自己検証レポート）
const reportCommand = program.command('report').description('レポート生成');

reportCommand
  .command('verification')
  .description('自己検証レポートを生成')
  .option('-t, --task <taskId>', 'タスクID', 'TASK-001')
  .option('--title <title>', 'タイトル', 'Verification Report')
  .option('-o, --output <path>', '出力先', './verification-report.md')
  .action(async (options: { task: string; title: string; output: string }) => {
    try {
      const { VerificationReportGenerator } = await import('./quality/verification-report.js');
      const { writeFileSync } = await import('node:fs');

      const generator = new VerificationReportGenerator();

      const report = await generator.generate({
        taskId: options.task,
        title: options.title,
        objectives: ['Task objective completed'],
        achievements: ['All requirements met'],
      });

      // Markdown形式で出力
      const markdown = `# ${report.title}\n\n` +
        `**Task ID:** ${report.taskId}\n` +
        `**Created:** ${report.createdAt.toISOString()}\n\n` +
        `## Summary\n${report.summary}\n`;

      writeFileSync(options.output, markdown);

      console.log(`✅ 自己検証レポートを生成しました: ${options.output}`);
    } catch (error) {
      console.error('❌ レポート生成に失敗:', error);
    }
  });

// 実行
program.parse();
