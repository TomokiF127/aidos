/**
 * Claude Code stream-json出力パーサー
 *
 * Claude Codeの--output-format stream-json出力を解析し、
 * エージェントイベントに変換する
 */

import { EventEmitter } from 'events';

// ========================================
// Types
// ========================================

/**
 * Claude Codeのstream-jsonメッセージタイプ
 */
export type ClaudeMessageType =
  | 'system'
  | 'assistant'
  | 'user'
  | 'result';

/**
 * stream-jsonの基本メッセージ構造
 */
export interface ClaudeStreamMessage {
  type: ClaudeMessageType;
  subtype?: string;
  message?: {
    role: string;
    content: ContentBlock[];
  };
  result?: {
    success: boolean;
    message?: string;
  };
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
}

/**
 * コンテンツブロック
 */
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

// ========================================
// Parser Events
// ========================================

export interface ParserEvents {
  'thinking': { content: string };
  'text': { content: string };
  'tool_use': { id: string; name: string; input: Record<string, unknown> };
  'tool_result': { toolUseId: string; content: string; isError: boolean };
  'result': { success: boolean; message?: string; costUsd?: number; durationMs?: number };
  'error': { message: string };
  'progress': { toolName: string; stage: 'start' | 'end' };
}

// ========================================
// Claude Output Parser
// ========================================

export class ClaudeOutputParser extends EventEmitter {
  private buffer: string = '';
  private toolCount: number = 0;
  private completedToolCount: number = 0;

  /**
   * データチャンクを処理
   */
  processChunk(chunk: string): void {
    this.buffer += chunk;

    // 改行で分割して各行を処理
    const lines = this.buffer.split('\n');

    // 最後の不完全な行はバッファに残す
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        this.parseLine(line);
      }
    }
  }

  /**
   * 1行をパース
   */
  private parseLine(line: string): void {
    try {
      const message = JSON.parse(line) as ClaudeStreamMessage;
      this.processMessage(message);
    } catch {
      // JSONパースエラーは無視（テキスト出力の可能性）
      this.emit('text', { content: line });
    }
  }

  /**
   * メッセージを処理
   */
  private processMessage(message: ClaudeStreamMessage): void {
    switch (message.type) {
      case 'assistant':
        this.processAssistantMessage(message);
        break;
      case 'result':
        this.processResultMessage(message);
        break;
      case 'system':
        // システムメッセージは通常無視
        break;
      case 'user':
        // ユーザーメッセージは通常無視
        break;
    }
  }

  /**
   * assistantメッセージを処理
   */
  private processAssistantMessage(message: ClaudeStreamMessage): void {
    const content = message.message?.content;
    if (!content) return;

    for (const block of content) {
      switch (block.type) {
        case 'thinking':
          this.emit('thinking', { content: (block as ThinkingBlock).thinking });
          break;
        case 'text':
          this.emit('text', { content: (block as TextBlock).text });
          break;
        case 'tool_use': {
          const toolBlock = block as ToolUseBlock;
          this.toolCount++;
          this.emit('tool_use', {
            id: toolBlock.id,
            name: toolBlock.name,
            input: toolBlock.input,
          });
          this.emit('progress', { toolName: toolBlock.name, stage: 'start' });
          break;
        }
        case 'tool_result': {
          const resultBlock = block as ToolResultBlock;
          this.completedToolCount++;
          this.emit('tool_result', {
            toolUseId: resultBlock.tool_use_id,
            content: resultBlock.content,
            isError: resultBlock.is_error || false,
          });
          this.emit('progress', { toolName: 'tool', stage: 'end' });
          break;
        }
      }
    }
  }

  /**
   * resultメッセージを処理
   */
  private processResultMessage(message: ClaudeStreamMessage): void {
    this.emit('result', {
      success: message.result?.success ?? false,
      message: message.result?.message,
      costUsd: message.cost_usd,
      durationMs: message.duration_ms,
    });
  }

  /**
   * 残りのバッファをフラッシュ
   */
  flush(): void {
    if (this.buffer.trim()) {
      this.parseLine(this.buffer);
      this.buffer = '';
    }
  }

  /**
   * 進捗率を取得（ツール実行ベース）
   */
  getProgress(): number {
    if (this.toolCount === 0) return 0;
    return Math.round((this.completedToolCount / this.toolCount) * 100);
  }

  /**
   * リセット
   */
  reset(): void {
    this.buffer = '';
    this.toolCount = 0;
    this.completedToolCount = 0;
  }
}

export default ClaudeOutputParser;
