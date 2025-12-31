/**
 * GitHub Actions Template Generator
 *
 * AIDOSをCI/CDパイプラインに統合するためのワークフローテンプレート生成
 */

import { AidosConfig } from '../types.js';

/**
 * ワークフロートリガー設定
 */
export interface WorkflowTrigger {
  push?: {
    branches?: string[];
    paths?: string[];
  };
  pull_request?: {
    branches?: string[];
    types?: ('opened' | 'synchronize' | 'reopened' | 'closed')[];
  };
  workflow_dispatch?: {
    inputs?: Record<string, {
      description: string;
      required?: boolean;
      default?: string;
      type?: 'string' | 'boolean' | 'choice';
      options?: string[];
    }>;
  };
  schedule?: Array<{
    cron: string;
  }>;
}

/**
 * ワークフローオプション
 */
export interface WorkflowOptions {
  name: string;
  description?: string;
  triggers: WorkflowTrigger;
  environment?: Record<string, string>;
  secrets?: string[];
  nodeVersion?: string;
  runsOn?: string;
  timeout?: number;
  concurrency?: {
    group: string;
    cancelInProgress?: boolean;
  };
}

/**
 * AIDOS専用ワークフローオプション
 */
export interface AidosWorkflowOptions extends WorkflowOptions {
  aidosConfig?: Partial<AidosConfig>;
  dryRun?: boolean;
  maxAgents?: number;
  autoApprove?: boolean;
  outputArtifacts?: boolean;
  enableReview?: boolean;
}

/**
 * GitHub Actions テンプレートジェネレーター
 */
export class GitHubActionsGenerator {
  private defaultNodeVersion = '20';
  private defaultRunsOn = 'ubuntu-latest';
  private defaultTimeout = 60;

  /**
   * 基本的なCI/CDワークフローを生成
   */
  generateBasicWorkflow(options: WorkflowOptions): string {
    const yaml = this.buildYamlHeader(options);
    const jobs = this.buildBasicJobs(options);
    return yaml + jobs;
  }

  /**
   * AIDOS統合ワークフローを生成
   */
  generateAidosWorkflow(options: AidosWorkflowOptions): string {
    const yaml = this.buildYamlHeader(options);
    const jobs = this.buildAidosJobs(options);
    return yaml + jobs;
  }

  /**
   * PRレビューワークフローを生成
   */
  generatePRReviewWorkflow(options: Partial<WorkflowOptions> = {}): string {
    const defaultOptions: WorkflowOptions = {
      name: 'AIDOS PR Review',
      description: 'Automated code review using AIDOS',
      triggers: {
        pull_request: {
          types: ['opened', 'synchronize'],
        },
      },
      secrets: ['ANTHROPIC_API_KEY'],
      ...options,
    };

    return this.generateAidosWorkflow({
      ...defaultOptions,
      enableReview: true,
      dryRun: true,
    });
  }

  /**
   * 自動開発ワークフローを生成
   */
  generateAutoDevelopWorkflow(options: Partial<AidosWorkflowOptions> = {}): string {
    const defaultOptions: AidosWorkflowOptions = {
      name: 'AIDOS Auto Development',
      description: 'Automated development workflow triggered by issues',
      triggers: {
        workflow_dispatch: {
          inputs: {
            objective: {
              description: 'Development objective',
              required: true,
              type: 'string',
            },
            dry_run: {
              description: 'Run in dry-run mode',
              required: false,
              default: 'false',
              type: 'boolean',
            },
            max_agents: {
              description: 'Maximum concurrent agents',
              required: false,
              default: '5',
              type: 'string',
            },
          },
        },
      },
      secrets: ['ANTHROPIC_API_KEY'],
      autoApprove: false,
      outputArtifacts: true,
      ...options,
    };

    return this.generateAidosWorkflow(defaultOptions);
  }

  /**
   * テスト実行ワークフローを生成
   */
  generateTestWorkflow(options: Partial<WorkflowOptions> = {}): string {
    const defaultOptions: WorkflowOptions = {
      name: 'AIDOS Test Suite',
      description: 'Run tests and quality checks',
      triggers: {
        push: {
          branches: ['main', 'develop'],
        },
        pull_request: {
          branches: ['main'],
        },
      },
      ...options,
    };

    const yaml = this.buildYamlHeader(defaultOptions);
    const jobs = this.buildTestJobs(defaultOptions);
    return yaml + jobs;
  }

  /**
   * スケジュール実行ワークフローを生成
   */
  generateScheduledWorkflow(
    cron: string,
    objective: string,
    options: Partial<AidosWorkflowOptions> = {}
  ): string {
    const defaultOptions: AidosWorkflowOptions = {
      name: 'AIDOS Scheduled Task',
      description: `Scheduled execution: ${objective}`,
      triggers: {
        schedule: [{ cron }],
        workflow_dispatch: {},
      },
      secrets: ['ANTHROPIC_API_KEY'],
      autoApprove: true,
      ...options,
    };

    return this.generateAidosWorkflow(defaultOptions);
  }

  private buildYamlHeader(options: WorkflowOptions): string {
    const lines: string[] = [];

    lines.push(`name: ${options.name}`);
    if (options.description) {
      lines.push(`# ${options.description}`);
    }
    lines.push('');

    // Triggers
    lines.push('on:');
    if (options.triggers.push) {
      lines.push('  push:');
      if (options.triggers.push.branches) {
        lines.push('    branches:');
        options.triggers.push.branches.forEach(b => {
          lines.push(`      - ${b}`);
        });
      }
      if (options.triggers.push.paths) {
        lines.push('    paths:');
        options.triggers.push.paths.forEach(p => {
          lines.push(`      - '${p}'`);
        });
      }
    }

    if (options.triggers.pull_request) {
      lines.push('  pull_request:');
      if (options.triggers.pull_request.branches) {
        lines.push('    branches:');
        options.triggers.pull_request.branches.forEach(b => {
          lines.push(`      - ${b}`);
        });
      }
      if (options.triggers.pull_request.types) {
        lines.push('    types:');
        options.triggers.pull_request.types.forEach(t => {
          lines.push(`      - ${t}`);
        });
      }
    }

    if (options.triggers.workflow_dispatch) {
      lines.push('  workflow_dispatch:');
      if (options.triggers.workflow_dispatch.inputs) {
        lines.push('    inputs:');
        for (const [key, input] of Object.entries(options.triggers.workflow_dispatch.inputs)) {
          lines.push(`      ${key}:`);
          lines.push(`        description: '${input.description}'`);
          if (input.required !== undefined) {
            lines.push(`        required: ${input.required}`);
          }
          if (input.default !== undefined) {
            lines.push(`        default: '${input.default}'`);
          }
          if (input.type) {
            lines.push(`        type: ${input.type}`);
          }
          if (input.options) {
            lines.push('        options:');
            input.options.forEach(o => {
              lines.push(`          - '${o}'`);
            });
          }
        }
      }
    }

    if (options.triggers.schedule) {
      lines.push('  schedule:');
      options.triggers.schedule.forEach(s => {
        lines.push(`    - cron: '${s.cron}'`);
      });
    }

    lines.push('');

    // Environment
    if (options.environment && Object.keys(options.environment).length > 0) {
      lines.push('env:');
      for (const [key, value] of Object.entries(options.environment)) {
        lines.push(`  ${key}: ${value}`);
      }
      lines.push('');
    }

    // Concurrency
    if (options.concurrency) {
      lines.push('concurrency:');
      lines.push(`  group: ${options.concurrency.group}`);
      if (options.concurrency.cancelInProgress) {
        lines.push('  cancel-in-progress: true');
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private buildBasicJobs(options: WorkflowOptions): string {
    const lines: string[] = [];
    const runsOn = options.runsOn || this.defaultRunsOn;
    const nodeVersion = options.nodeVersion || this.defaultNodeVersion;
    const timeout = options.timeout || this.defaultTimeout;

    lines.push('jobs:');
    lines.push('  build:');
    lines.push(`    runs-on: ${runsOn}`);
    lines.push(`    timeout-minutes: ${timeout}`);
    lines.push('');
    lines.push('    steps:');
    lines.push('      - name: Checkout');
    lines.push('        uses: actions/checkout@v4');
    lines.push('');
    lines.push('      - name: Setup Node.js');
    lines.push('        uses: actions/setup-node@v4');
    lines.push('        with:');
    lines.push(`          node-version: '${nodeVersion}'`);
    lines.push('          cache: npm');
    lines.push('');
    lines.push('      - name: Install dependencies');
    lines.push('        run: npm ci');
    lines.push('');
    lines.push('      - name: Build');
    lines.push('        run: npm run build');
    lines.push('');
    lines.push('      - name: Test');
    lines.push('        run: npm test');
    lines.push('');

    return lines.join('\n');
  }

  private buildAidosJobs(options: AidosWorkflowOptions): string {
    const lines: string[] = [];
    const runsOn = options.runsOn || this.defaultRunsOn;
    const nodeVersion = options.nodeVersion || this.defaultNodeVersion;
    const timeout = options.timeout || this.defaultTimeout;
    const maxAgents = options.maxAgents || 5;

    lines.push('jobs:');
    lines.push('  aidos:');
    lines.push(`    runs-on: ${runsOn}`);
    lines.push(`    timeout-minutes: ${timeout}`);
    lines.push('');

    // Permissions for PR comments
    if (options.enableReview) {
      lines.push('    permissions:');
      lines.push('      contents: read');
      lines.push('      pull-requests: write');
      lines.push('');
    }

    lines.push('    steps:');
    lines.push('      - name: Checkout');
    lines.push('        uses: actions/checkout@v4');
    lines.push('        with:');
    lines.push('          fetch-depth: 0');
    lines.push('');
    lines.push('      - name: Setup Node.js');
    lines.push('        uses: actions/setup-node@v4');
    lines.push('        with:');
    lines.push(`          node-version: '${nodeVersion}'`);
    lines.push('          cache: npm');
    lines.push('');
    lines.push('      - name: Install dependencies');
    lines.push('        run: npm ci');
    lines.push('');
    lines.push('      - name: Install AIDOS');
    lines.push('        run: npm install -g aidos-cli');
    lines.push('');

    // Main AIDOS execution
    lines.push('      - name: Run AIDOS');
    lines.push('        env:');
    lines.push('          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}');
    lines.push(`          AIDOS_MAX_AGENTS: '${maxAgents}'`);
    if (options.autoApprove) {
      lines.push("          AIDOS_AUTO_APPROVE: 'true'");
    }
    lines.push('        run: |');

    if (options.dryRun) {
      lines.push('          aidos --dry-run "${{ github.event.inputs.objective || \'Review code changes\' }}"');
    } else {
      lines.push('          aidos "${{ github.event.inputs.objective || \'Execute automated tasks\' }}" \\');
      lines.push(`            --max-agents ${maxAgents} \\`);
      if (options.autoApprove) {
        lines.push('            --no-intervention \\');
      }
      lines.push('            --output-dir ./aidos-output');
    }
    lines.push('');

    // Upload artifacts
    if (options.outputArtifacts) {
      lines.push('      - name: Upload AIDOS Output');
      lines.push('        uses: actions/upload-artifact@v4');
      lines.push('        if: always()');
      lines.push('        with:');
      lines.push('          name: aidos-output');
      lines.push('          path: ./aidos-output');
      lines.push('          retention-days: 30');
      lines.push('');
    }

    // PR Review comment
    if (options.enableReview) {
      lines.push('      - name: Post Review Comment');
      lines.push('        if: github.event_name == \'pull_request\'');
      lines.push('        uses: actions/github-script@v7');
      lines.push('        with:');
      lines.push('          script: |');
      lines.push('            const fs = require(\'fs\');');
      lines.push('            const reviewPath = \'./aidos-output/review.md\';');
      lines.push('            if (fs.existsSync(reviewPath)) {');
      lines.push('              const review = fs.readFileSync(reviewPath, \'utf8\');');
      lines.push('              await github.rest.issues.createComment({');
      lines.push('                owner: context.repo.owner,');
      lines.push('                repo: context.repo.repo,');
      lines.push('                issue_number: context.issue.number,');
      lines.push('                body: `## AIDOS Code Review\\n\\n${review}`');
      lines.push('              });');
      lines.push('            }');
      lines.push('');
    }

    return lines.join('\n');
  }

  private buildTestJobs(options: WorkflowOptions): string {
    const lines: string[] = [];
    const runsOn = options.runsOn || this.defaultRunsOn;
    const nodeVersion = options.nodeVersion || this.defaultNodeVersion;
    const timeout = options.timeout || this.defaultTimeout;

    lines.push('jobs:');
    lines.push('  test:');
    lines.push(`    runs-on: ${runsOn}`);
    lines.push(`    timeout-minutes: ${timeout}`);
    lines.push('');
    lines.push('    steps:');
    lines.push('      - name: Checkout');
    lines.push('        uses: actions/checkout@v4');
    lines.push('');
    lines.push('      - name: Setup Node.js');
    lines.push('        uses: actions/setup-node@v4');
    lines.push('        with:');
    lines.push(`          node-version: '${nodeVersion}'`);
    lines.push('          cache: npm');
    lines.push('');
    lines.push('      - name: Install dependencies');
    lines.push('        run: npm ci');
    lines.push('');
    lines.push('      - name: Type check');
    lines.push('        run: npx tsc --noEmit');
    lines.push('');
    lines.push('      - name: Lint');
    lines.push('        run: npm run lint --if-present');
    lines.push('');
    lines.push('      - name: Test');
    lines.push('        run: npm test -- --coverage');
    lines.push('');
    lines.push('      - name: Upload coverage');
    lines.push('        uses: codecov/codecov-action@v4');
    lines.push('        if: success()');
    lines.push('        with:');
    lines.push('          fail_ci_if_error: false');
    lines.push('');

    return lines.join('\n');
  }
}

/**
 * シングルトンインスタンス
 */
let instance: GitHubActionsGenerator | null = null;

export function getGitHubActionsGenerator(): GitHubActionsGenerator {
  if (!instance) {
    instance = new GitHubActionsGenerator();
  }
  return instance;
}

export function resetGitHubActionsGenerator(): void {
  instance = null;
}
