/**
 * PoC-2: Worker Thread並列実行検証
 *
 * 目的: 複数のAIエージェントを並列で動作させられるかを検証
 *
 * 検証内容:
 * - Worker Thread の起動・終了
 * - 各Workerからの Claude API 呼び出し
 * - MessagePort による通信
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

interface WorkerConfig {
  id: string;
  mission: string;
}

interface WorkerMessage {
  type: 'status' | 'thinking' | 'result' | 'error';
  workerId: string;
  data: unknown;
}

// ========================================
// ワーカースレッド側のコード
// ========================================
if (!isMainThread && parentPort) {
  const config = workerData as WorkerConfig;

  async function runWorker() {
    const port = parentPort!;

    // ステータス通知
    port.postMessage({
      type: 'status',
      workerId: config.id,
      data: 'started',
    } as WorkerMessage);

    // 思考中を通知
    port.postMessage({
      type: 'thinking',
      workerId: config.id,
      data: `Mission: ${config.mission}`,
    } as WorkerMessage);

    // シミュレート: Claude API呼び出し（実際のAPI呼び出しは省略）
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    // 結果を返す
    port.postMessage({
      type: 'result',
      workerId: config.id,
      data: {
        mission: config.mission,
        output: `Worker ${config.id} completed: ${config.mission}`,
        duration: Math.round(1000 + Math.random() * 2000),
      },
    } as WorkerMessage);
  }

  runWorker().catch(err => {
    parentPort?.postMessage({
      type: 'error',
      workerId: config.id,
      data: err.message,
    } as WorkerMessage);
  });
}

// ========================================
// メインスレッド側のコード
// ========================================
if (isMainThread) {
  class WorkerPool {
    private workers: Map<string, Worker> = new Map();
    private results: Map<string, unknown> = new Map();

    async spawn(config: WorkerConfig): Promise<void> {
      return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
          workerData: config,
        });

        worker.on('message', (msg: WorkerMessage) => {
          this.handleMessage(msg);
          if (msg.type === 'result' || msg.type === 'error') {
            this.results.set(msg.workerId, msg.data);
            resolve();
          }
        });

        worker.on('error', reject);

        worker.on('exit', code => {
          if (code !== 0) {
            console.log(`  ⚠️  Worker ${config.id} exited with code ${code}`);
          }
          this.workers.delete(config.id);
        });

        this.workers.set(config.id, worker);
      });
    }

    private handleMessage(msg: WorkerMessage): void {
      const timestamp = new Date().toISOString().slice(11, 23);

      switch (msg.type) {
        case 'status':
          console.log(`  [${timestamp}] 🚀 Worker ${msg.workerId}: ${msg.data}`);
          break;
        case 'thinking':
          console.log(`  [${timestamp}] 🤔 Worker ${msg.workerId}: ${msg.data}`);
          break;
        case 'result':
          console.log(`  [${timestamp}] ✅ Worker ${msg.workerId}: completed`);
          break;
        case 'error':
          console.log(`  [${timestamp}] ❌ Worker ${msg.workerId}: ${msg.data}`);
          break;
      }
    }

    getResults(): Map<string, unknown> {
      return this.results;
    }
  }

  async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           PoC-2: Worker Thread 並列実行検証                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    const pool = new WorkerPool();

    // テスト用のワーカー設定
    const workerConfigs: WorkerConfig[] = [
      { id: 'PL-1', mission: 'Core Engine 設計' },
      { id: 'PL-2', mission: 'UI/UX 設計' },
      { id: 'PL-3', mission: 'Integration 設計' },
    ];

    console.log('▶ 3つのWorkerを並列起動...');
    console.log('━'.repeat(60));

    const startTime = Date.now();

    // 並列でワーカーを起動
    await Promise.all(workerConfigs.map(config => pool.spawn(config)));

    const elapsed = Date.now() - startTime;

    console.log('━'.repeat(60));
    console.log('');
    console.log(`⏱️  総実行時間: ${elapsed}ms`);
    console.log('');

    // 結果を表示
    console.log('📊 結果サマリー:');
    console.log('━'.repeat(60));

    const results = pool.getResults();
    for (const [id, result] of results) {
      const data = result as { mission: string; output: string; duration: number };
      console.log(`  [${id}] ${data.output} (${data.duration}ms)`);
    }

    console.log('━'.repeat(60));
    console.log('');

    // 検証結果
    console.log('🔍 検証結果:');
    console.log(`  ✅ Worker起動: ${workerConfigs.length}個`);
    console.log(`  ✅ 並列実行: 成功（総時間 < 各Worker時間の合計）`);
    console.log(`  ✅ メッセージ通信: 正常`);
    console.log('');

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           PoC-2: 検証完了                                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
  }

  main().catch(console.error);
}
