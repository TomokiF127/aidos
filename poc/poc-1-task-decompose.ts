/**
 * PoC-1: Claude APIでタスク分解ができるか検証
 *
 * 目的: 自然言語からタスクリストへの変換が実用的かを検証
 *
 * 検証内容:
 * - 単一プロンプトでの分解精度
 * - 出力フォーマットの安定性
 * - 依存関係の自動検出可否
 */

import Anthropic from '@anthropic-ai/sdk';

interface DecomposedTask {
  id: string;
  description: string;
  category: 'design' | 'implement' | 'test' | 'document';
  dependencies: string[];
  priority: number;
}

interface DecomposeResult {
  tasks: DecomposedTask[];
  reasoning: string;
}

const DECOMPOSE_PROMPT = `あなたはソフトウェア開発のタスク分解エキスパートです。
与えられた開発目的を、実行可能な具体的タスクに分解してください。

## ルール
1. 各タスクは1人のエンジニアが独立して実行できる粒度にする
2. タスク間の依存関係を明確にする
3. 優先度は1(最高)〜5(最低)で設定
4. カテゴリは design/implement/test/document から選択

## 出力形式 (JSON)
{
  "reasoning": "分解の考え方を簡潔に説明",
  "tasks": [
    {
      "id": "T1",
      "description": "タスクの説明",
      "category": "implement",
      "dependencies": [],
      "priority": 1
    }
  ]
}

## 開発目的
`;

async function decomposeObjective(objective: string): Promise<DecomposeResult> {
  const client = new Anthropic();

  console.log('📋 タスク分解を開始...');
  console.log(`   目的: "${objective}"`);
  console.log('');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: DECOMPOSE_PROMPT + objective,
      },
    ],
  });

  // レスポンスからテキストを抽出
  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  // JSONをパース
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to extract JSON from response');
  }

  const result: DecomposeResult = JSON.parse(jsonMatch[0]);

  console.log('✅ タスク分解完了');
  console.log(`   生成タスク数: ${result.tasks.length}`);
  console.log(`   トークン使用: input=${message.usage.input_tokens}, output=${message.usage.output_tokens}`);
  console.log('');

  return result;
}

function displayTasks(result: DecomposeResult): void {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 分解理由:');
  console.log(`   ${result.reasoning}`);
  console.log('');
  console.log('📋 タスクリスト:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const task of result.tasks) {
    const deps = task.dependencies.length > 0
      ? `[依存: ${task.dependencies.join(', ')}]`
      : '[依存: なし]';

    console.log(`
  [${task.id}] ${task.description}
      カテゴリ: ${task.category}
      優先度: ${task.priority}
      ${deps}
`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

function buildDependencyGraph(tasks: DecomposedTask[]): void {
  console.log('');
  console.log('🔗 依存関係グラフ:');
  console.log('');

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  for (const task of tasks) {
    if (task.dependencies.length === 0) {
      console.log(`  ${task.id} (root)`);
    } else {
      for (const dep of task.dependencies) {
        console.log(`  ${dep} → ${task.id}`);
      }
    }
  }
}

// メイン実行
async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           PoC-1: タスク分解検証                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // テストケース
  const testCases = [
    'Webアプリのログイン機能を作成する',
    'REST APIにページネーション機能を追加する',
    'ユーザープロフィール編集画面を実装する',
  ];

  for (let i = 0; i < testCases.length; i++) {
    console.log(`\n▶ テストケース ${i + 1}/${testCases.length}`);
    console.log('─'.repeat(50));

    try {
      const result = await decomposeObjective(testCases[i]);
      displayTasks(result);
      buildDependencyGraph(result.tasks);
    } catch (error) {
      console.error('❌ エラー:', error);
    }

    console.log('');
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           PoC-1: 検証完了                                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
}

main().catch(console.error);
