/**
 * セッション履歴管理
 *
 * 過去のセッション情報を保存・取得し、類似タスクパターンの検索や成功/失敗パターンの分析を行う。
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import {
  Session,
  SessionStatus,
  Task,
  TaskStatus,
  TaskCategory,
  DecomposedTask,
  Agent,
  AgentRole,
} from '../types.js';

// ========================================
// Types
// ========================================

/**
 * セッション履歴エントリ
 */
export interface SessionHistoryEntry {
  id: string;
  sessionId: string;
  objective: string;
  status: SessionStatus;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number;
  taskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  totalTokensUsed: number;
  agentCount: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

/**
 * タスク履歴エントリ
 */
export interface TaskHistoryEntry {
  id: string;
  sessionHistoryId: string;
  taskId: string;
  description: string;
  category: TaskCategory;
  status: TaskStatus;
  priority: number;
  complexity: DecomposedTask['estimatedComplexity'];
  durationMs: number;
  tokensUsed: number;
  retryCount: number;
  error: string | null;
}

/**
 * パターン情報
 */
export interface TaskPattern {
  id: string;
  pattern: string;           // 正規化されたパターン
  category: TaskCategory;
  successRate: number;       // 成功率
  averageDuration: number;   // 平均所要時間
  averageTokens: number;     // 平均トークン使用量
  occurrences: number;       // 出現回数
  lastSeenAt: Date;
}

/**
 * 類似セッション検索結果
 */
export interface SimilarSession {
  entry: SessionHistoryEntry;
  similarity: number;        // 0-1
  matchedKeywords: string[];
}

/**
 * 分析結果
 */
export interface HistoryAnalysis {
  totalSessions: number;
  successfulSessions: number;
  failedSessions: number;
  averageSessionDuration: number;
  averageTaskCount: number;
  categoryDistribution: Map<TaskCategory, number>;
  commonPatterns: TaskPattern[];
  recentTrends: {
    successRateTrend: 'improving' | 'declining' | 'stable';
    averageDurationTrend: 'improving' | 'declining' | 'stable';
  };
}

/**
 * セッション履歴イベント
 */
export type SessionHistoryEvent =
  | 'session:recorded'
  | 'task:recorded'
  | 'pattern:detected'
  | 'analysis:completed'
  | 'similar:found';

/**
 * データベース行の型定義
 */
interface SessionHistoryRow {
  id: string;
  session_id: string;
  objective: string;
  status: SessionStatus;
  started_at: string;
  completed_at: string | null;
  duration_ms: number;
  task_count: number;
  completed_task_count: number;
  failed_task_count: number;
  total_tokens_used: number;
  agent_count: number;
  tags: string;
  metadata: string;
}

interface TaskHistoryRow {
  id: string;
  session_history_id: string;
  task_id: string;
  description: string;
  category: TaskCategory;
  status: TaskStatus;
  priority: number;
  complexity: string;
  duration_ms: number;
  tokens_used: number;
  retry_count: number;
  error: string | null;
}

interface TaskPatternRow {
  id: string;
  pattern: string;
  category: TaskCategory;
  success_rate: number;
  average_duration: number;
  average_tokens: number;
  occurrences: number;
  last_seen_at: string;
}

// ========================================
// SessionHistory Class
// ========================================

/**
 * セッション履歴管理クラス
 */
export class SessionHistory extends EventEmitter {
  private db: Database.Database;
  private initialized: boolean = false;

  constructor(dbPath: string = './aidos-history.db') {
    super();
    this.db = new Database(dbPath);
    this.initialize();
  }

  /**
   * データベースを初期化
   */
  private initialize(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        task_count INTEGER NOT NULL DEFAULT 0,
        completed_task_count INTEGER NOT NULL DEFAULT 0,
        failed_task_count INTEGER NOT NULL DEFAULT 0,
        total_tokens_used INTEGER NOT NULL DEFAULT 0,
        agent_count INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS task_history (
        id TEXT PRIMARY KEY,
        session_history_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        complexity TEXT NOT NULL DEFAULT 'medium',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        FOREIGN KEY (session_history_id) REFERENCES session_history(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_patterns (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        success_rate REAL NOT NULL DEFAULT 0,
        average_duration REAL NOT NULL DEFAULT 0,
        average_tokens REAL NOT NULL DEFAULT 0,
        occurrences INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_history_objective ON session_history(objective);
      CREATE INDEX IF NOT EXISTS idx_session_history_status ON session_history(status);
      CREATE INDEX IF NOT EXISTS idx_session_history_started_at ON session_history(started_at);
      CREATE INDEX IF NOT EXISTS idx_task_history_category ON task_history(category);
      CREATE INDEX IF NOT EXISTS idx_task_history_status ON task_history(status);
      CREATE INDEX IF NOT EXISTS idx_task_patterns_pattern ON task_patterns(pattern);
      CREATE INDEX IF NOT EXISTS idx_task_patterns_category ON task_patterns(category);
    `);

    this.initialized = true;
  }

  // ========================================
  // Session Recording
  // ========================================

  /**
   * セッション履歴を記録
   */
  recordSession(
    session: Session,
    stats: {
      taskCount: number;
      completedTaskCount: number;
      failedTaskCount: number;
      totalTokensUsed: number;
      agentCount: number;
    },
    tags: string[] = [],
    metadata: Record<string, unknown> = {}
  ): SessionHistoryEntry {
    const id = `hist_${randomUUID().substring(0, 8)}`;
    const durationMs = session.updatedAt.getTime() - session.createdAt.getTime();

    const entry: SessionHistoryEntry = {
      id,
      sessionId: session.id,
      objective: session.objective,
      status: session.status,
      startedAt: session.createdAt,
      completedAt: session.status === 'completed' || session.status === 'failed'
        ? session.updatedAt
        : null,
      durationMs,
      taskCount: stats.taskCount,
      completedTaskCount: stats.completedTaskCount,
      failedTaskCount: stats.failedTaskCount,
      totalTokensUsed: stats.totalTokensUsed,
      agentCount: stats.agentCount,
      tags,
      metadata,
    };

    const stmt = this.db.prepare(`
      INSERT INTO session_history (
        id, session_id, objective, status, started_at, completed_at,
        duration_ms, task_count, completed_task_count, failed_task_count,
        total_tokens_used, agent_count, tags, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.sessionId,
      entry.objective,
      entry.status,
      entry.startedAt.toISOString(),
      entry.completedAt?.toISOString() ?? null,
      entry.durationMs,
      entry.taskCount,
      entry.completedTaskCount,
      entry.failedTaskCount,
      entry.totalTokensUsed,
      entry.agentCount,
      JSON.stringify(entry.tags),
      JSON.stringify(entry.metadata)
    );

    this.emit('session:recorded', entry);

    return entry;
  }

  /**
   * タスク履歴を記録
   */
  recordTask(
    sessionHistoryId: string,
    task: Task | DecomposedTask,
    stats: {
      durationMs: number;
      tokensUsed: number;
      retryCount: number;
      error?: string;
    }
  ): TaskHistoryEntry {
    const id = `task_hist_${randomUUID().substring(0, 8)}`;
    const status = 'status' in task ? task.status : 'pending';
    const complexity = 'estimatedComplexity' in task ? task.estimatedComplexity : 'medium';
    const priority = 'priority' in task ? task.priority : 0;

    const entry: TaskHistoryEntry = {
      id,
      sessionHistoryId,
      taskId: task.id,
      description: task.description,
      category: task.category,
      status,
      priority,
      complexity,
      durationMs: stats.durationMs,
      tokensUsed: stats.tokensUsed,
      retryCount: stats.retryCount,
      error: stats.error ?? null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO task_history (
        id, session_history_id, task_id, description, category, status,
        priority, complexity, duration_ms, tokens_used, retry_count, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.sessionHistoryId,
      entry.taskId,
      entry.description,
      entry.category,
      entry.status,
      entry.priority,
      entry.complexity,
      entry.durationMs,
      entry.tokensUsed,
      entry.retryCount,
      entry.error
    );

    // パターンを更新
    this.updatePattern(entry);

    this.emit('task:recorded', entry);

    return entry;
  }

  /**
   * タスクパターンを更新
   */
  private updatePattern(taskEntry: TaskHistoryEntry): void {
    const pattern = this.normalizeDescription(taskEntry.description);
    const success = taskEntry.status === 'completed' ? 1 : 0;

    const existing = this.db.prepare<[string], TaskPatternRow>(
      'SELECT * FROM task_patterns WHERE pattern = ?'
    ).get(pattern);

    if (existing) {
      // 既存パターンを更新
      const newOccurrences = existing.occurrences + 1;
      const newSuccessRate = (existing.success_rate * existing.occurrences + success) / newOccurrences;
      const newAvgDuration = (existing.average_duration * existing.occurrences + taskEntry.durationMs) / newOccurrences;
      const newAvgTokens = (existing.average_tokens * existing.occurrences + taskEntry.tokensUsed) / newOccurrences;

      this.db.prepare(`
        UPDATE task_patterns
        SET success_rate = ?, average_duration = ?, average_tokens = ?,
            occurrences = ?, last_seen_at = ?
        WHERE id = ?
      `).run(
        newSuccessRate,
        newAvgDuration,
        newAvgTokens,
        newOccurrences,
        new Date().toISOString(),
        existing.id
      );
    } else {
      // 新規パターンを作成
      const id = `pattern_${randomUUID().substring(0, 8)}`;

      this.db.prepare(`
        INSERT INTO task_patterns (
          id, pattern, category, success_rate, average_duration,
          average_tokens, occurrences, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        pattern,
        taskEntry.category,
        success,
        taskEntry.durationMs,
        taskEntry.tokensUsed,
        1,
        new Date().toISOString()
      );

      this.emit('pattern:detected', { pattern, category: taskEntry.category });
    }
  }

  /**
   * 説明文を正規化してパターンを抽出
   */
  private normalizeDescription(description: string): string {
    return description
      .toLowerCase()
      .replace(/[0-9]+/g, '#')     // 数字を#に置換
      .replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAFa-z\s#]/g, '') // 記号を除去（日本語は残す）
      .trim()
      .substring(0, 100);          // 最初の100文字
  }

  // ========================================
  // Query Methods
  // ========================================

  /**
   * セッション履歴を取得
   */
  getSessionHistory(sessionId: string): SessionHistoryEntry | null {
    const row = this.db.prepare<[string], SessionHistoryRow>(
      'SELECT * FROM session_history WHERE session_id = ?'
    ).get(sessionId);

    return row ? this.mapSessionHistoryRow(row) : null;
  }

  /**
   * 最近のセッション履歴を取得
   */
  getRecentSessions(limit: number = 10): SessionHistoryEntry[] {
    const rows = this.db.prepare<[number], SessionHistoryRow>(
      'SELECT * FROM session_history ORDER BY started_at DESC LIMIT ?'
    ).all(limit);

    return rows.map(row => this.mapSessionHistoryRow(row));
  }

  /**
   * ステータスでセッションを取得
   */
  getSessionsByStatus(status: SessionStatus): SessionHistoryEntry[] {
    const rows = this.db.prepare<[string], SessionHistoryRow>(
      'SELECT * FROM session_history WHERE status = ? ORDER BY started_at DESC'
    ).all(status);

    return rows.map(row => this.mapSessionHistoryRow(row));
  }

  /**
   * タスク履歴を取得
   */
  getTaskHistory(sessionHistoryId: string): TaskHistoryEntry[] {
    const rows = this.db.prepare<[string], TaskHistoryRow>(
      'SELECT * FROM task_history WHERE session_history_id = ? ORDER BY priority'
    ).all(sessionHistoryId);

    return rows.map(row => this.mapTaskHistoryRow(row));
  }

  /**
   * 行をSessionHistoryEntryにマップ
   */
  private mapSessionHistoryRow(row: SessionHistoryRow): SessionHistoryEntry {
    return {
      id: row.id,
      sessionId: row.session_id,
      objective: row.objective,
      status: row.status,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      durationMs: row.duration_ms,
      taskCount: row.task_count,
      completedTaskCount: row.completed_task_count,
      failedTaskCount: row.failed_task_count,
      totalTokensUsed: row.total_tokens_used,
      agentCount: row.agent_count,
      tags: JSON.parse(row.tags),
      metadata: JSON.parse(row.metadata),
    };
  }

  /**
   * 行をTaskHistoryEntryにマップ
   */
  private mapTaskHistoryRow(row: TaskHistoryRow): TaskHistoryEntry {
    return {
      id: row.id,
      sessionHistoryId: row.session_history_id,
      taskId: row.task_id,
      description: row.description,
      category: row.category,
      status: row.status,
      priority: row.priority,
      complexity: row.complexity as DecomposedTask['estimatedComplexity'],
      durationMs: row.duration_ms,
      tokensUsed: row.tokens_used,
      retryCount: row.retry_count,
      error: row.error,
    };
  }

  // ========================================
  // Similar Session Search
  // ========================================

  /**
   * 類似セッションを検索
   */
  findSimilarSessions(objective: string, limit: number = 5): SimilarSession[] {
    const keywords = this.extractKeywords(objective);
    const sessions = this.getRecentSessions(100); // 最近の100件から検索

    const scored: SimilarSession[] = sessions.map(entry => {
      const entryKeywords = this.extractKeywords(entry.objective);
      const matchedKeywords = keywords.filter(k => entryKeywords.includes(k));
      const similarity = keywords.length > 0
        ? matchedKeywords.length / keywords.length
        : 0;

      return { entry, similarity, matchedKeywords };
    });

    // 類似度でソートして上位を返す
    const results = scored
      .filter(s => s.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    if (results.length > 0) {
      this.emit('similar:found', { count: results.length, objective });
    }

    return results;
  }

  /**
   * キーワードを抽出
   */
  private extractKeywords(text: string): string[] {
    // 日本語と英語のキーワードを抽出
    const words = text
      .toLowerCase()
      .replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAFa-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);

    return [...new Set(words)];
  }

  // ========================================
  // Pattern Analysis
  // ========================================

  /**
   * タスクパターンを取得
   */
  getPatterns(options: {
    category?: TaskCategory;
    minOccurrences?: number;
    limit?: number;
  } = {}): TaskPattern[] {
    const { category, minOccurrences = 1, limit = 50 } = options;

    let sql = 'SELECT * FROM task_patterns WHERE occurrences >= ?';
    const params: (string | number)[] = [minOccurrences];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY occurrences DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare<(string | number)[], TaskPatternRow>(sql).all(...params);

    return rows.map(row => ({
      id: row.id,
      pattern: row.pattern,
      category: row.category,
      successRate: row.success_rate,
      averageDuration: row.average_duration,
      averageTokens: row.average_tokens,
      occurrences: row.occurrences,
      lastSeenAt: new Date(row.last_seen_at),
    }));
  }

  /**
   * 説明文に最も近いパターンを検索
   */
  findMatchingPattern(description: string): TaskPattern | null {
    const normalized = this.normalizeDescription(description);

    const row = this.db.prepare<[string], TaskPatternRow>(
      'SELECT * FROM task_patterns WHERE pattern = ?'
    ).get(normalized);

    if (!row) return null;

    return {
      id: row.id,
      pattern: row.pattern,
      category: row.category,
      successRate: row.success_rate,
      averageDuration: row.average_duration,
      averageTokens: row.average_tokens,
      occurrences: row.occurrences,
      lastSeenAt: new Date(row.last_seen_at),
    };
  }

  // ========================================
  // Analysis
  // ========================================

  /**
   * 履歴の完全な分析を実行
   */
  analyze(): HistoryAnalysis {
    // セッション統計
    const sessionStats = this.db.prepare<[], {
      total: number;
      successful: number;
      failed: number;
      avg_duration: number;
      avg_tasks: number;
    }>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(duration_ms) as avg_duration,
        AVG(task_count) as avg_tasks
      FROM session_history
    `).get();

    // カテゴリ分布
    const categoryRows = this.db.prepare<[], { category: TaskCategory; count: number }>(`
      SELECT category, COUNT(*) as count
      FROM task_history
      GROUP BY category
    `).all();

    const categoryDistribution = new Map<TaskCategory, number>();
    for (const row of categoryRows) {
      categoryDistribution.set(row.category, row.count);
    }

    // 共通パターン
    const commonPatterns = this.getPatterns({ minOccurrences: 2, limit: 10 });

    // トレンド分析
    const recentTrends = this.analyzeTrends();

    const analysis: HistoryAnalysis = {
      totalSessions: sessionStats?.total ?? 0,
      successfulSessions: sessionStats?.successful ?? 0,
      failedSessions: sessionStats?.failed ?? 0,
      averageSessionDuration: sessionStats?.avg_duration ?? 0,
      averageTaskCount: sessionStats?.avg_tasks ?? 0,
      categoryDistribution,
      commonPatterns,
      recentTrends,
    };

    this.emit('analysis:completed', analysis);

    return analysis;
  }

  /**
   * トレンドを分析
   */
  private analyzeTrends(): {
    successRateTrend: 'improving' | 'declining' | 'stable';
    averageDurationTrend: 'improving' | 'declining' | 'stable';
  } {
    // 最近30件と古い30件を比較
    const recentRows = this.db.prepare<[number], { success_rate: number; avg_duration: number }>(`
      SELECT
        AVG(CAST(completed_task_count AS REAL) / NULLIF(task_count, 0)) as success_rate,
        AVG(duration_ms) as avg_duration
      FROM (
        SELECT * FROM session_history
        WHERE task_count > 0
        ORDER BY started_at DESC
        LIMIT ?
      )
    `).get(30);

    const olderRows = this.db.prepare<[number, number], { success_rate: number; avg_duration: number }>(`
      SELECT
        AVG(CAST(completed_task_count AS REAL) / NULLIF(task_count, 0)) as success_rate,
        AVG(duration_ms) as avg_duration
      FROM (
        SELECT * FROM session_history
        WHERE task_count > 0
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?
      )
    `).get(30, 30);

    let successRateTrend: 'improving' | 'declining' | 'stable' = 'stable';
    let averageDurationTrend: 'improving' | 'declining' | 'stable' = 'stable';

    if (recentRows && olderRows) {
      const successDiff = (recentRows.success_rate ?? 0) - (olderRows.success_rate ?? 0);
      if (successDiff > 0.05) successRateTrend = 'improving';
      else if (successDiff < -0.05) successRateTrend = 'declining';

      const durationDiff = (recentRows.avg_duration ?? 0) - (olderRows.avg_duration ?? 0);
      const relativeDiff = olderRows.avg_duration ? durationDiff / olderRows.avg_duration : 0;
      if (relativeDiff < -0.1) averageDurationTrend = 'improving'; // 短くなった
      else if (relativeDiff > 0.1) averageDurationTrend = 'declining'; // 長くなった
    }

    return { successRateTrend, averageDurationTrend };
  }

  /**
   * タスクの推定所要時間を予測
   */
  predictTaskDuration(description: string, category: TaskCategory): number {
    const pattern = this.findMatchingPattern(description);

    if (pattern && pattern.occurrences >= 3) {
      return pattern.averageDuration;
    }

    // パターンがない場合はカテゴリ平均を使用
    const categoryAvg = this.db.prepare<[string], { avg_duration: number }>(`
      SELECT AVG(duration_ms) as avg_duration
      FROM task_history
      WHERE category = ? AND status = 'completed'
    `).get(category);

    return categoryAvg?.avg_duration ?? 60000; // デフォルト1分
  }

  /**
   * タスクの成功確率を予測
   */
  predictTaskSuccessRate(description: string, category: TaskCategory): number {
    const pattern = this.findMatchingPattern(description);

    if (pattern && pattern.occurrences >= 3) {
      return pattern.successRate;
    }

    // パターンがない場合はカテゴリ平均を使用
    const categoryAvg = this.db.prepare<[string], { success_rate: number }>(`
      SELECT AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END) as success_rate
      FROM task_history
      WHERE category = ?
    `).get(category);

    return categoryAvg?.success_rate ?? 0.8; // デフォルト80%
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * 古い履歴を削除
   */
  pruneOldHistory(olderThanDays: number = 90): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = this.db.prepare(`
      DELETE FROM session_history WHERE started_at < ?
    `).run(cutoffDate.toISOString());

    return result.changes;
  }

  /**
   * データベースを閉じる
   */
  close(): void {
    this.db.close();
  }

  /**
   * 統計情報を取得
   */
  getStats(): {
    sessionCount: number;
    taskCount: number;
    patternCount: number;
    oldestSession: Date | null;
    newestSession: Date | null;
  } {
    const sessions = this.db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM session_history').get();
    const tasks = this.db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM task_history').get();
    const patterns = this.db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM task_patterns').get();

    const oldest = this.db.prepare<[], { started_at: string }>('SELECT started_at FROM session_history ORDER BY started_at ASC LIMIT 1').get();
    const newest = this.db.prepare<[], { started_at: string }>('SELECT started_at FROM session_history ORDER BY started_at DESC LIMIT 1').get();

    return {
      sessionCount: sessions?.count ?? 0,
      taskCount: tasks?.count ?? 0,
      patternCount: patterns?.count ?? 0,
      oldestSession: oldest ? new Date(oldest.started_at) : null,
      newestSession: newest ? new Date(newest.started_at) : null,
    };
  }
}

// ========================================
// Factory Functions
// ========================================

let sessionHistoryInstance: SessionHistory | null = null;

/**
 * セッション履歴マネージャーを取得
 */
export function getSessionHistory(dbPath?: string): SessionHistory {
  if (!sessionHistoryInstance) {
    sessionHistoryInstance = new SessionHistory(dbPath);
  }
  return sessionHistoryInstance;
}

/**
 * セッション履歴マネージャーをリセット
 */
export function resetSessionHistory(): void {
  if (sessionHistoryInstance) {
    sessionHistoryInstance.close();
    sessionHistoryInstance = null;
  }
}

/**
 * 新しいセッション履歴マネージャーを作成
 */
export function createSessionHistory(dbPath?: string): SessionHistory {
  return new SessionHistory(dbPath);
}
