/**
 * InputPanel - Multi-line text input for AIDOS
 *
 * Supports:
 * - Single line input with Enter to submit
 * - Multi-line paste (auto-detected)
 * - Ctrl+D or Cmd+Enter to submit multi-line
 * - Slash commands for configuration
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InputPanelProps {
  onSubmit: (text: string) => void;
  onCommand?: (command: string, args: string) => void;
  placeholder?: string;
  disabled?: boolean;
  isProcessing?: boolean;
  workingDirectory?: string;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  onSubmit,
  onCommand,
  placeholder = 'タスクを入力してください...',
  disabled = false,
  isProcessing = false,
  workingDirectory,
}) => {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [isMultiLine, setIsMultiLine] = useState(false);

  // Handle paste detection - if input contains newlines, switch to multi-line mode
  useEffect(() => {
    if (input.includes('\n')) {
      const newLines = input.split('\n');
      setLines((prev) => [...prev, ...newLines.slice(0, -1)]);
      setInput(newLines[newLines.length - 1]);
      setIsMultiLine(true);
    }
  }, [input]);

  // Handle keyboard shortcuts
  useInput((inputChar, key) => {
    if (disabled || isProcessing) return;

    // Ctrl+D in multi-line mode: submit
    if (isMultiLine && (key.ctrl && inputChar === 'd')) {
      const fullText = [...lines, input].join('\n').trim();
      if (fullText) {
        onSubmit(fullText);
        setInput('');
        setLines([]);
        setIsMultiLine(false);
      }
    }

    // Escape: clear input
    if (key.escape) {
      setInput('');
      setLines([]);
      setIsMultiLine(false);
    }
  });

  const handleSubmit = (value: string) => {
    if (disabled || isProcessing) return;

    if (isMultiLine) {
      // In multi-line mode, Enter adds a new line
      setLines((prev) => [...prev, value]);
      setInput('');
    } else {
      const trimmed = value.trim();
      if (!trimmed) return;

      // Check for slash commands
      if (trimmed.startsWith('/')) {
        const parts = trimmed.slice(1).split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        if (onCommand) {
          onCommand(command, args);
        }
        setInput('');
        return;
      }

      // Regular task submission
      onSubmit(trimmed);
      setInput('');
    }
  };

  if (isProcessing) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="yellow"
        paddingX={1}
        paddingY={0}
      >
        <Text color="yellow">実行中... (完了までお待ちください)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Box>
          <Text color="cyan" bold>
            {isMultiLine ? '📝 Multi-line Input' : '> Task Input'}
          </Text>
          {isMultiLine && (
            <Text color="gray"> (Ctrl+D で送信, Esc でキャンセル)</Text>
          )}
        </Box>
        {workingDirectory && (
          <Text color="gray" dimColor>
            📁 {workingDirectory.length > 30
              ? '...' + workingDirectory.slice(-27)
              : workingDirectory}
          </Text>
        )}
      </Box>

      {/* Show previous lines in multi-line mode */}
      {isMultiLine && lines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {lines.map((line, idx) => (
            <Text key={idx} color="white">
              {line}
            </Text>
          ))}
        </Box>
      )}

      {/* Current input line */}
      <Box marginTop={isMultiLine && lines.length > 0 ? 0 : 1}>
        <Text color="green">{isMultiLine ? '│ ' : '> '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={disabled ? '' : placeholder}
        />
      </Box>

      {!isMultiLine && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Enter: 実行 | /help: コマンド一覧 | 複数行貼付: マルチライン
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default InputPanel;
