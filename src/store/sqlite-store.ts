/**
 * AIDOS SQLite Store
 *
 * better-sqlite3を使用した状態永続化レイヤー
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  Session,
  SessionStatus,
  Agent,
  AgentRole,
  AgentStatus,
  Task,
  TaskStatus,
  TaskCategory,
  BusMessage,
  MessageType,
} from '../types.js';

// ========================================
// Types
// ========================================

interface StoreOptions {
  dbPath?: string;
  inMemory?: boolean;
}

interface SessionRow {
  id: string;
  objective: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  id: string;
  session_id: string;
  role: AgentRole;
  mission: string;
  status: AgentStatus;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  agent_id: string;
  description: string;
  category: TaskCategory;
  status: TaskStatus;
  progress: number;
  output: string | null;
  created_at: string;
  completed_at: string | null;
}

interface EventLogRow {
  id: number;
  event_type: MessageType;
  sender_id: string;
  payload: string;
  timestamp: string;
}

// ========================================
// SQLite Store Class
// ========================================

export class SQLiteStore {
  private db: Database.Database;

  constructor(options: StoreOptions = {}) {
    const dbPath = options.inMemory ? ':memory:' : (options.dbPath ?? './aidos.db');
    this.db = new Database(dbPath);

    // Performance optimizations
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    // Run migrations
    this.runMigrations();
  }

  // ========================================
  // Migration Management
  // ========================================

  private runMigrations(): void {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const migrationPath = join(currentDir, 'migrations', '001_initial.sql');

    try {
      const migration = readFileSync(migrationPath, 'utf-8');
      this.db.exec(migration);
    } catch (error) {
      // If file not found, run inline migration
      this.runInlineMigration();
    }
  }

  private runInlineMigration(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        mission TEXT NOT NULL,
        status TEXT NOT NULL,
        parent_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        output TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL,
        depends_on_id TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on_id)
      );

      CREATE TABLE IF NOT EXISTS agent_children (
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        PRIMARY KEY (parent_id, child_id)
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        description TEXT
      );
    `);
  }

  // ========================================
  // Session Operations
  // ========================================

  createSession(session: Session): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, objective, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.objective,
      session.status,
      session.createdAt.toISOString(),
      session.updatedAt.toISOString()
    );
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare<[string], SessionRow>(`
      SELECT * FROM sessions WHERE id = ?
    `);

    const row = stmt.get(id);
    return row ? this.mapSessionRow(row) : null;
  }

  updateSessionStatus(id: string, status: SessionStatus): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(status, id);
  }

  getActiveSessions(): Session[] {
    const stmt = this.db.prepare<[], SessionRow>(`
      SELECT * FROM sessions WHERE status = 'active'
      ORDER BY created_at DESC
    `);

    return stmt.all().map(row => this.mapSessionRow(row));
  }

  getAllSessions(): Session[] {
    const stmt = this.db.prepare<[], SessionRow>(`
      SELECT * FROM sessions ORDER BY created_at DESC
    `);

    return stmt.all().map(row => this.mapSessionRow(row));
  }

  private mapSessionRow(row: SessionRow): Session {
    return {
      id: row.id,
      objective: row.objective,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ========================================
  // Agent Operations
  // ========================================

  createAgent(agent: Agent): void {
    const insertAgent = this.db.prepare(`
      INSERT INTO agents (id, session_id, role, mission, status, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertChild = this.db.prepare(`
      INSERT INTO agent_children (parent_id, child_id)
      VALUES (?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertAgent.run(
        agent.id,
        agent.sessionId,
        agent.role,
        agent.mission,
        agent.status,
        agent.parentId,
        agent.createdAt.toISOString(),
        agent.updatedAt.toISOString()
      );

      // Insert child relationships
      for (const childId of agent.childIds) {
        insertChild.run(agent.id, childId);
      }
    });

    transaction();
  }

  getAgent(id: string): Agent | null {
    const stmt = this.db.prepare<[string], AgentRow>(`
      SELECT * FROM agents WHERE id = ?
    `);

    const row = stmt.get(id);
    if (!row) return null;

    const childIds = this.getAgentChildIds(id);
    return this.mapAgentRow(row, childIds);
  }

  getAgentsBySession(sessionId: string): Agent[] {
    const stmt = this.db.prepare<[string], AgentRow>(`
      SELECT * FROM agents WHERE session_id = ? ORDER BY created_at
    `);

    return stmt.all(sessionId).map(row => {
      const childIds = this.getAgentChildIds(row.id);
      return this.mapAgentRow(row, childIds);
    });
  }

  updateAgentStatus(id: string, status: AgentStatus): void {
    const stmt = this.db.prepare(`
      UPDATE agents
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(status, id);
  }

  addAgentChild(parentId: string, childId: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO agent_children (parent_id, child_id)
      VALUES (?, ?)
    `);

    stmt.run(parentId, childId);
  }

  private getAgentChildIds(agentId: string): string[] {
    const stmt = this.db.prepare<[string], { child_id: string }>(`
      SELECT child_id FROM agent_children WHERE parent_id = ?
    `);

    return stmt.all(agentId).map(row => row.child_id);
  }

  private mapAgentRow(row: AgentRow, childIds: string[]): Agent {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      mission: row.mission,
      status: row.status,
      parentId: row.parent_id,
      childIds,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ========================================
  // Task Operations
  // ========================================

  createTask(task: Task): void {
    const insertTask = this.db.prepare(`
      INSERT INTO tasks (id, agent_id, description, category, status, progress, output, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertDependency = this.db.prepare(`
      INSERT INTO task_dependencies (task_id, depends_on_id)
      VALUES (?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertTask.run(
        task.id,
        task.agentId,
        task.description,
        task.category,
        task.status,
        task.progress,
        task.output,
        task.createdAt.toISOString(),
        task.completedAt?.toISOString() ?? null
      );

      // Insert dependencies
      for (const depId of task.dependencies) {
        insertDependency.run(task.id, depId);
      }
    });

    transaction();
  }

  getTask(id: string): Task | null {
    const stmt = this.db.prepare<[string], TaskRow>(`
      SELECT * FROM tasks WHERE id = ?
    `);

    const row = stmt.get(id);
    if (!row) return null;

    const dependencies = this.getTaskDependencies(id);
    return this.mapTaskRow(row, dependencies);
  }

  getTasksByAgent(agentId: string): Task[] {
    const stmt = this.db.prepare<[string], TaskRow>(`
      SELECT * FROM tasks WHERE agent_id = ? ORDER BY created_at
    `);

    return stmt.all(agentId).map(row => {
      const dependencies = this.getTaskDependencies(row.id);
      return this.mapTaskRow(row, dependencies);
    });
  }

  updateTaskStatus(id: string, status: TaskStatus): void {
    const completedAt = status === 'completed' ? "datetime('now')" : 'NULL';
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?, completed_at = ${status === 'completed' ? "datetime('now')" : 'NULL'}
      WHERE id = ?
    `);

    stmt.run(status, id);
  }

  updateTaskProgress(id: string, progress: number): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET progress = ? WHERE id = ?
    `);

    stmt.run(Math.min(100, Math.max(0, progress)), id);
  }

  updateTaskOutput(id: string, output: string): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET output = ? WHERE id = ?
    `);

    stmt.run(output, id);
  }

  private getTaskDependencies(taskId: string): string[] {
    const stmt = this.db.prepare<[string], { depends_on_id: string }>(`
      SELECT depends_on_id FROM task_dependencies WHERE task_id = ?
    `);

    return stmt.all(taskId).map(row => row.depends_on_id);
  }

  private mapTaskRow(row: TaskRow, dependencies: string[]): Task {
    return {
      id: row.id,
      agentId: row.agent_id,
      description: row.description,
      category: row.category,
      status: row.status,
      progress: row.progress,
      dependencies,
      output: row.output,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    };
  }

  // ========================================
  // Event Log Operations
  // ========================================

  logEvent<T>(message: BusMessage<T>): void {
    const stmt = this.db.prepare(`
      INSERT INTO event_log (event_type, sender_id, payload, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      message.type,
      message.senderId,
      JSON.stringify(message.payload),
      message.timestamp.toISOString()
    );
  }

  getEventLog(options: {
    limit?: number;
    offset?: number;
    eventType?: MessageType;
    senderId?: string;
  } = {}): BusMessage[] {
    const { limit = 100, offset = 0, eventType, senderId } = options;

    let sql = 'SELECT * FROM event_log WHERE 1=1';
    const params: (string | number)[] = [];

    if (eventType) {
      sql += ' AND event_type = ?';
      params.push(eventType);
    }

    if (senderId) {
      sql += ' AND sender_id = ?';
      params.push(senderId);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare<(string | number)[], EventLogRow>(sql);

    return stmt.all(...params).map(row => ({
      type: row.event_type,
      senderId: row.sender_id,
      payload: JSON.parse(row.payload),
      timestamp: new Date(row.timestamp),
    }));
  }

  // ========================================
  // Utility Operations
  // ========================================

  /**
   * セッションの完全な状態を取得（エージェントとタスクを含む）
   */
  getSessionWithDetails(sessionId: string): {
    session: Session;
    agents: Agent[];
    tasks: Task[];
  } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const agents = this.getAgentsBySession(sessionId);
    const tasks = agents.flatMap(agent => this.getTasksByAgent(agent.id));

    return { session, agents, tasks };
  }

  /**
   * トランザクション内で複数操作を実行
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * データベースを閉じる
   */
  close(): void {
    this.db.close();
  }

  /**
   * すべてのデータを削除（テスト用）
   */
  clearAll(): void {
    this.db.exec(`
      DELETE FROM event_log;
      DELETE FROM task_dependencies;
      DELETE FROM tasks;
      DELETE FROM agent_children;
      DELETE FROM agents;
      DELETE FROM sessions;
    `);
  }

  /**
   * データベースの統計情報を取得
   */
  getStats(): {
    sessions: number;
    agents: number;
    tasks: number;
    events: number;
  } {
    const sessions = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const agents = this.db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number };
    const tasks = this.db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
    const events = this.db.prepare('SELECT COUNT(*) as count FROM event_log').get() as { count: number };

    return {
      sessions: sessions.count,
      agents: agents.count,
      tasks: tasks.count,
      events: events.count,
    };
  }
}

// ========================================
// Singleton Instance
// ========================================

let storeInstance: SQLiteStore | null = null;

export function getStore(options?: StoreOptions): SQLiteStore {
  if (!storeInstance) {
    storeInstance = new SQLiteStore(options);
  }
  return storeInstance;
}

export function resetStore(): void {
  if (storeInstance) {
    storeInstance.close();
    storeInstance = null;
  }
}
