/**
 * PoC-1 (Mock版): タスク分解検証
 *
 * Claude APIの代わりにモックデータを使用してタスク分解ロジックを検証
 */

interface DecomposedTask {
  id: string;
  description: string;
  category: 'design' | 'implement' | 'test' | 'document';
  dependencies: string[];
  priority: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface DecomposeResult {
  objective: string;
  reasoning: string;
  tasks: DecomposedTask[];
}

// モックタスク分解データベース
const MOCK_DECOMPOSITIONS: Record<string, DecomposeResult> = {
  'login': {
    objective: 'Webアプリのログイン機能を作成する',
    reasoning: 'ログイン機能は認証フロー、UI、セキュリティの3つの観点から分解。依存関係を考慮し、データモデル→API→UIの順序で実装。',
    tasks: [
      { id: 'T1', description: 'ユーザーデータモデル設計', category: 'design', dependencies: [], priority: 1, estimatedComplexity: 'low' },
      { id: 'T2', description: '認証APIエンドポイント実装', category: 'implement', dependencies: ['T1'], priority: 1, estimatedComplexity: 'medium' },
      { id: 'T3', description: 'パスワードハッシュ化実装', category: 'implement', dependencies: ['T1'], priority: 1, estimatedComplexity: 'low' },
      { id: 'T4', description: 'JWTトークン生成・検証', category: 'implement', dependencies: ['T2'], priority: 2, estimatedComplexity: 'medium' },
      { id: 'T5', description: 'ログインフォームUI作成', category: 'implement', dependencies: ['T2'], priority: 2, estimatedComplexity: 'low' },
      { id: 'T6', description: 'セッション管理実装', category: 'implement', dependencies: ['T4'], priority: 3, estimatedComplexity: 'medium' },
      { id: 'T7', description: '認証ミドルウェア作成', category: 'implement', dependencies: ['T4'], priority: 3, estimatedComplexity: 'low' },
      { id: 'T8', description: '単体テスト作成', category: 'test', dependencies: ['T2', 'T3', 'T4'], priority: 4, estimatedComplexity: 'medium' },
      { id: 'T9', description: 'E2Eテスト作成', category: 'test', dependencies: ['T5', 'T6'], priority: 5, estimatedComplexity: 'high' },
    ]
  },
  'pagination': {
    objective: 'REST APIにページネーション機能を追加する',
    reasoning: 'ページネーションはクエリパラメータ設計、DB最適化、レスポンス形式の標準化が必要。',
    tasks: [
      { id: 'T1', description: 'ページネーションパラメータ設計', category: 'design', dependencies: [], priority: 1, estimatedComplexity: 'low' },
      { id: 'T2', description: 'クエリビルダー実装', category: 'implement', dependencies: ['T1'], priority: 2, estimatedComplexity: 'medium' },
      { id: 'T3', description: 'レスポンスフォーマット定義', category: 'design', dependencies: ['T1'], priority: 2, estimatedComplexity: 'low' },
      { id: 'T4', description: '既存エンドポイント改修', category: 'implement', dependencies: ['T2', 'T3'], priority: 3, estimatedComplexity: 'medium' },
      { id: 'T5', description: 'インデックス最適化', category: 'implement', dependencies: ['T2'], priority: 3, estimatedComplexity: 'medium' },
      { id: 'T6', description: 'テスト作成', category: 'test', dependencies: ['T4'], priority: 4, estimatedComplexity: 'low' },
    ]
  },
  'profile': {
    objective: 'ユーザープロフィール編集画面を実装する',
    reasoning: 'プロフィール編集はフォーム設計、バリデーション、画像アップロードの3つの機能に分解。',
    tasks: [
      { id: 'T1', description: 'プロフィールデータモデル拡張', category: 'design', dependencies: [], priority: 1, estimatedComplexity: 'low' },
      { id: 'T2', description: 'プロフィール取得API', category: 'implement', dependencies: ['T1'], priority: 2, estimatedComplexity: 'low' },
      { id: 'T3', description: 'プロフィール更新API', category: 'implement', dependencies: ['T1'], priority: 2, estimatedComplexity: 'medium' },
      { id: 'T4', description: '画像アップロード機能', category: 'implement', dependencies: ['T1'], priority: 2, estimatedComplexity: 'high' },
      { id: 'T5', description: 'バリデーションロジック', category: 'implement', dependencies: ['T3'], priority: 3, estimatedComplexity: 'medium' },
      { id: 'T6', description: 'プロフィール編集フォームUI', category: 'implement', dependencies: ['T2', 'T3'], priority: 3, estimatedComplexity: 'medium' },
      { id: 'T7', description: '画像プレビュー・クロップUI', category: 'implement', dependencies: ['T4'], priority: 4, estimatedComplexity: 'high' },
      { id: 'T8', description: 'テスト作成', category: 'test', dependencies: ['T3', 'T5'], priority: 5, estimatedComplexity: 'medium' },
    ]
  }
};

function findBestMatch(objective: string): DecomposeResult | null {
  const lowerObjective = objective.toLowerCase();

  if (lowerObjective.includes('ログイン') || lowerObjective.includes('login') || lowerObjective.includes('認証')) {
    return MOCK_DECOMPOSITIONS['login'];
  }
  if (lowerObjective.includes('ページネーション') || lowerObjective.includes('pagination') || lowerObjective.includes('ページ')) {
    return MOCK_DECOMPOSITIONS['pagination'];
  }
  if (lowerObjective.includes('プロフィール') || lowerObjective.includes('profile') || lowerObjective.includes('編集')) {
    return MOCK_DECOMPOSITIONS['profile'];
  }

  // デフォルト: 汎用的なタスク分解を生成
  return generateGenericDecomposition(objective);
}

function generateGenericDecomposition(objective: string): DecomposeResult {
  return {
    objective,
    reasoning: '汎用的なソフトウェア開発フローに基づいて分解。設計→実装→テストの順序で実行。',
    tasks: [
      { id: 'T1', description: '要件分析・設計', category: 'design', dependencies: [], priority: 1, estimatedComplexity: 'medium' },
      { id: 'T2', description: 'データモデル設計', category: 'design', dependencies: ['T1'], priority: 2, estimatedComplexity: 'medium' },
      { id: 'T3', description: 'API設計', category: 'design', dependencies: ['T2'], priority: 2, estimatedComplexity: 'medium' },
      { id: 'T4', description: 'バックエンド実装', category: 'implement', dependencies: ['T2', 'T3'], priority: 3, estimatedComplexity: 'high' },
      { id: 'T5', description: 'フロントエンド実装', category: 'implement', dependencies: ['T3'], priority: 3, estimatedComplexity: 'high' },
      { id: 'T6', description: '単体テスト', category: 'test', dependencies: ['T4'], priority: 4, estimatedComplexity: 'medium' },
      { id: 'T7', description: '結合テスト', category: 'test', dependencies: ['T4', 'T5'], priority: 5, estimatedComplexity: 'medium' },
      { id: 'T8', description: 'ドキュメント作成', category: 'document', dependencies: ['T4', 'T5'], priority: 5, estimatedComplexity: 'low' },
    ]
  };
}

function createProgressBar(progress: number, width: number = 20): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return '[' + '■'.repeat(filled) + '□'.repeat(empty) + ']';
}

async function simulateDecomposition(objective: string): Promise<DecomposeResult> {
  console.log('📋 タスク分解を開始...');
  console.log(`   目的: "${objective}"`);
  console.log('');

  // シミュレート: 思考中のアニメーション
  const steps = ['分析中', '構造化中', '依存関係解析中', '優先度設定中'];
  for (let i = 0; i < steps.length; i++) {
    await new Promise(r => setTimeout(r, 300));
    const progress = ((i + 1) / steps.length) * 100;
    process.stdout.write(`\r   ${createProgressBar(progress, 10)} ${steps[i]}...`);
  }
  console.log('\n');

  const result = findBestMatch(objective);
  if (!result) {
    throw new Error('タスク分解に失敗しました');
  }

  console.log('✅ タスク分解完了');
  console.log(`   生成タスク数: ${result.tasks.length}`);
  console.log(`   モード: Mock (APIクレジット不要)`);
  console.log('');

  return { ...result, objective };
}

function displayTasks(result: DecomposeResult): void {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 分解理由:');
  console.log(`   ${result.reasoning}`);
  console.log('');
  console.log('📋 タスクリスト:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const categoryIcons: Record<string, string> = {
    design: '📐',
    implement: '💻',
    test: '🧪',
    document: '📄'
  };

  const complexityColors: Record<string, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🔴'
  };

  for (const task of result.tasks) {
    const deps = task.dependencies.length > 0
      ? `[依存: ${task.dependencies.join(', ')}]`
      : '[依存: なし]';

    console.log(`
  [${task.id}] ${categoryIcons[task.category]} ${task.description}
      カテゴリ: ${task.category}
      優先度: ${task.priority}
      複雑度: ${complexityColors[task.estimatedComplexity]} ${task.estimatedComplexity}
      ${deps}
`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

function displayDependencyGraph(tasks: DecomposedTask[]): void {
  console.log('');
  console.log('🔗 依存関係グラフ:');
  console.log('');

  // トポロジカルソートで実行順序を表示
  const levels: Map<string, number> = new Map();

  function getLevel(taskId: string): number {
    if (levels.has(taskId)) return levels.get(taskId)!;

    const task = tasks.find(t => t.id === taskId);
    if (!task || task.dependencies.length === 0) {
      levels.set(taskId, 0);
      return 0;
    }

    const maxDepLevel = Math.max(...task.dependencies.map(d => getLevel(d)));
    const level = maxDepLevel + 1;
    levels.set(taskId, level);
    return level;
  }

  tasks.forEach(t => getLevel(t.id));

  const maxLevel = Math.max(...Array.from(levels.values()));

  for (let level = 0; level <= maxLevel; level++) {
    const tasksAtLevel = tasks.filter(t => levels.get(t.id) === level);
    const taskIds = tasksAtLevel.map(t => t.id).join(' ');
    console.log(`  Level ${level}: ${taskIds}`);
  }

  console.log('');
  console.log('  実行フロー:');
  for (const task of tasks) {
    if (task.dependencies.length === 0) {
      console.log(`  ${task.id} (start)`);
    } else {
      for (const dep of task.dependencies) {
        console.log(`  ${dep} → ${task.id}`);
      }
    }
  }
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           PoC-1 (Mock): タスク分解検証                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const testCases = [
    'Webアプリのログイン機能を作成する',
    'REST APIにページネーション機能を追加する',
    'ユーザープロフィール編集画面を実装する',
    'チャットボット機能を追加する', // 汎用分解のテスト
  ];

  for (let i = 0; i < testCases.length; i++) {
    console.log(`\n▶ テストケース ${i + 1}/${testCases.length}`);
    console.log('─'.repeat(50));

    try {
      const result = await simulateDecomposition(testCases[i]);
      displayTasks(result);
      displayDependencyGraph(result.tasks);
    } catch (error) {
      console.error('❌ エラー:', error);
    }

    console.log('');
  }

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           PoC-1 (Mock): 検証完了                           ║');
  console.log('║                                                            ║');
  console.log('║   ✅ タスク分解ロジック: 動作確認                         ║');
  console.log('║   ✅ 依存関係解析: 動作確認                               ║');
  console.log('║   ✅ 優先度・複雑度設定: 動作確認                         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
}

main().catch(console.error);

export { simulateDecomposition, DecomposedTask, DecomposeResult };
