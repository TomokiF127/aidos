/**
 * CodeReviewer Integration Tests
 *
 * Tests for code review rules, scoring, and comment generation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CodeReviewer,
  ReviewRule,
  ReviewResult,
  ReviewOptions,
  ReviewSeverity,
  ReviewCategory,
  getCodeReviewer,
  resetCodeReviewer,
} from '../../src/quality/code-reviewer.js';

describe('CodeReviewer', () => {
  let reviewer: CodeReviewer;

  beforeEach(() => {
    resetCodeReviewer();
    reviewer = new CodeReviewer();
  });

  afterEach(() => {
    resetCodeReviewer();
  });

  describe('initialization', () => {
    it('should load builtin rules on initialization', () => {
      const rules = reviewer.getRules();
      expect(rules.length).toBeGreaterThan(0);
    });

    it('should include standard rule categories', () => {
      const rules = reviewer.getRules();
      const categories = new Set(rules.map((r) => r.category));

      expect(categories.has('style')).toBe(true);
      expect(categories.has('security')).toBe(true);
      expect(categories.has('performance')).toBe(true);
      expect(categories.has('maintainability')).toBe(true);
    });

    it('should include rules for multiple languages', () => {
      const rules = reviewer.getRules();
      const hasWildcard = rules.some((r) => r.languages.includes('*'));
      const hasTypescript = rules.some((r) => r.languages.includes('typescript'));

      expect(hasWildcard).toBe(true);
      expect(hasTypescript).toBe(true);
    });
  });

  describe('rule management', () => {
    it('should allow adding custom rules', () => {
      const customRule: ReviewRule = {
        id: 'custom-test-rule',
        name: 'Custom Test Rule',
        description: 'A custom rule for testing',
        category: 'other',
        severity: 'info',
        languages: ['typescript'],
        check: () => [],
      };

      reviewer.addRule(customRule);
      const rules = reviewer.getRules();
      const found = rules.find((r) => r.id === 'custom-test-rule');

      expect(found).toBeDefined();
      expect(found?.name).toBe('Custom Test Rule');
    });

    it('should allow removing rules', () => {
      const initialRules = reviewer.getRules();
      const ruleToRemove = initialRules[0];

      const removed = reviewer.removeRule(ruleToRemove.id);
      const afterRemoval = reviewer.getRules();

      expect(removed).toBe(true);
      expect(afterRemoval.find((r) => r.id === ruleToRemove.id)).toBeUndefined();
    });

    it('should return false when removing non-existent rule', () => {
      const removed = reviewer.removeRule('non-existent-rule');
      expect(removed).toBe(false);
    });
  });

  describe('code review - style rules', () => {
    it('should detect trailing whitespace', async () => {
      const code = 'const x = 1;   \nconst y = 2;\n';
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const trailingWsComments = result.comments.filter(
        (c) => c.rule === 'no-trailing-whitespace'
      );
      expect(trailingWsComments.length).toBeGreaterThan(0);
      expect(trailingWsComments[0].line).toBe(1);
    });

    it('should detect lines exceeding max length', async () => {
      const longLine = 'const x = ' + 'a'.repeat(150) + ';';
      const result = await reviewer.reviewContent(longLine, { language: 'typescript' });

      const lineLengthComments = result.comments.filter(
        (c) => c.rule === 'max-line-length'
      );
      expect(lineLengthComments.length).toBeGreaterThan(0);
      expect(lineLengthComments[0].severity).toBe('warning');
    });

    it('should detect mixed indentation', async () => {
      const code = '  const x = 1;\n\tconst y = 2;\n';
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const indentComments = result.comments.filter(
        (c) => c.rule === 'consistent-indentation'
      );
      expect(indentComments.length).toBeGreaterThan(0);
    });
  });

  describe('code review - security rules', () => {
    it('should detect hardcoded passwords', async () => {
      const code = `const password = "secret123";`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const secretComments = result.comments.filter(
        (c) => c.rule === 'no-hardcoded-secrets'
      );
      expect(secretComments.length).toBeGreaterThan(0);
      expect(secretComments[0].severity).toBe('critical');
    });

    it('should detect hardcoded API keys', async () => {
      const code = `const apiKey = "sk-1234567890abcdef";`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const secretComments = result.comments.filter(
        (c) => c.rule === 'no-hardcoded-secrets'
      );
      expect(secretComments.length).toBeGreaterThan(0);
    });

    it('should detect eval usage', async () => {
      const code = `const result = eval("1 + 2");`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const evalComments = result.comments.filter((c) => c.rule === 'no-eval');
      expect(evalComments.length).toBeGreaterThan(0);
      expect(evalComments[0].severity).toBe('error');
    });
  });

  describe('code review - performance rules', () => {
    it('should detect deeply nested loops', async () => {
      const code = `
for (let i = 0; i < 10; i++) {
  for (let j = 0; j < 10; j++) {
    for (let k = 0; k < 10; k++) {
      console.log(i, j, k);
    }
  }
}
`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const nestedComments = result.comments.filter(
        (c) => c.rule === 'no-nested-loops'
      );
      expect(nestedComments.length).toBeGreaterThan(0);
      expect(nestedComments[0].category).toBe('performance');
    });
  });

  describe('code review - maintainability rules', () => {
    it('should detect magic numbers', async () => {
      // Don't use const declaration - the rule skips const lines
      const code = `let result = value * 3.14159;`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const magicComments = result.comments.filter(
        (c) => c.rule === 'no-magic-numbers'
      );
      expect(magicComments.length).toBeGreaterThan(0);
      expect(magicComments[0].category).toBe('maintainability');
    });

    it('should not flag allowed magic numbers', async () => {
      const code = `const result = items.length - 1;`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const magicComments = result.comments.filter(
        (c) => c.rule === 'no-magic-numbers' && c.message.includes('-1')
      );
      // -1 is in the allowed list
      expect(magicComments.length).toBe(0);
    });
  });

  describe('code review - best practice rules', () => {
    it('should detect console usage', async () => {
      const code = `console.log("debug message");`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const consoleComments = result.comments.filter((c) => c.rule === 'no-console');
      expect(consoleComments.length).toBeGreaterThan(0);
      expect(consoleComments[0].severity).toBe('warning');
    });

    it('should not flag console in comments', async () => {
      const code = `// console.log("debug message");`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const consoleComments = result.comments.filter((c) => c.rule === 'no-console');
      expect(consoleComments.length).toBe(0);
    });
  });

  describe('scoring', () => {
    it('should return score of 100 for clean code', async () => {
      const code = `const x = 1;`;
      const result = await reviewer.reviewContent(code, {
        language: 'typescript',
        rules: [], // No rules to apply
      });

      expect(result.score).toBe(100);
    });

    it('should reduce score for critical issues', async () => {
      const code = `const password = "secret123";`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      expect(result.score).toBeLessThan(100);
    });

    it('should pass when score is above threshold', async () => {
      const code = `const x = 1;`;
      const result = await reviewer.reviewContent(code, {
        language: 'typescript',
        rules: [],
      });

      expect(result.passed).toBe(true);
    });

    it('should fail when score is below threshold', async () => {
      // Code with multiple critical issues
      const code = `
const password = "secret123";
const apiKey = "sk-abcdef";
const token = "xyz-token-123";
eval("malicious code");
`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      expect(result.passed).toBe(false);
      expect(result.score).toBeLessThan(70);
    });
  });

  describe('filtering options', () => {
    it('should filter by specific rules', async () => {
      const code = `const password = "secret";   \n`;
      const result = await reviewer.reviewContent(code, {
        language: 'typescript',
        rules: ['no-trailing-whitespace'],
      });

      expect(result.comments.every((c) => c.rule === 'no-trailing-whitespace')).toBe(
        true
      );
    });

    it('should exclude specific rules', async () => {
      const code = `const password = "secret";   \n`;
      const result = await reviewer.reviewContent(code, {
        language: 'typescript',
        excludeRules: ['no-hardcoded-secrets'],
      });

      const secretComments = result.comments.filter(
        (c) => c.rule === 'no-hardcoded-secrets'
      );
      expect(secretComments.length).toBe(0);
    });

    it('should filter by severity threshold', async () => {
      const code = `const password = "secret";   \n`;
      const result = await reviewer.reviewContent(code, {
        language: 'typescript',
        severityThreshold: 'error',
      });

      // Should only include error and critical severity
      const lowSeverity = result.comments.filter(
        (c) => c.severity === 'info' || c.severity === 'warning'
      );
      expect(lowSeverity.length).toBe(0);
    });

    it('should limit max issues', async () => {
      const code = `
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
`;
      const result = await reviewer.reviewContent(code, {
        language: 'typescript',
        maxIssues: 2,
      });

      expect(result.comments.length).toBeLessThanOrEqual(2);
    });

    it('should filter by categories', async () => {
      const code = `
const password = "secret";
const x = 1;
`;
      const result = await reviewer.reviewContent(code, {
        language: 'typescript',
        categories: ['security'],
      });

      expect(result.comments.every((c) => c.category === 'security')).toBe(true);
    });
  });

  describe('review summary', () => {
    it('should generate summary with severity counts', async () => {
      const code = `const password = "secret";`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      expect(result.summary.bySeverity).toBeDefined();
      expect(result.summary.bySeverity.critical).toBeGreaterThan(0);
    });

    it('should generate summary with category counts', async () => {
      const code = `const password = "secret";`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      expect(result.summary.byCategory).toBeDefined();
      expect(result.summary.byCategory.security).toBeGreaterThan(0);
    });

    it('should include improvements for critical issues', async () => {
      const code = `const password = "secret";`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      expect(result.summary.improvements.length).toBeGreaterThan(0);
    });

    it('should include strengths for clean code', async () => {
      const code = `const x = 1;`;
      const result = await reviewer.reviewContent(code, {
        language: 'typescript',
        rules: [],
      });

      expect(result.summary.strengths.length).toBeGreaterThan(0);
    });
  });

  describe('auto-fix', () => {
    it('should apply auto-fixes for trailing whitespace', async () => {
      const code = 'const x = 1;   \nconst y = 2;\n';
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const fixed = reviewer.applyAutoFixes(code, result.comments);
      expect(fixed).not.toContain('   \n');
      expect(fixed).toContain('const x = 1;');
    });

    it('should not modify non-autofixable issues', async () => {
      const code = `const result = eval("code");`;
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      const fixed = reviewer.applyAutoFixes(code, result.comments);
      expect(fixed).toContain('eval');
    });
  });

  describe('batch review', () => {
    it('should review multiple artifacts', async () => {
      const artifacts = [
        { id: '1', name: 'file1.ts', content: 'const x = 1;   \n' },
        { id: '2', name: 'file2.ts', content: `const password = "secret";` },
      ];

      const results = await reviewer.reviewBatch(artifacts);

      expect(results.length).toBe(2);
      expect(results[0].artifactId).toBe('1');
      expect(results[1].artifactId).toBe('2');
    });
  });

  describe('event emission', () => {
    it('should emit review:start event', async () => {
      const events: string[] = [];
      reviewer.on('review:start', () => events.push('start'));

      await reviewer.reviewContent('const x = 1;', { language: 'typescript' });

      expect(events).toContain('start');
    });

    it('should emit review:complete event', async () => {
      const events: string[] = [];
      reviewer.on('review:complete', () => events.push('complete'));

      await reviewer.reviewContent('const x = 1;', { language: 'typescript' });

      expect(events).toContain('complete');
    });

    it('should emit review:progress events', async () => {
      const progressEvents: number[] = [];
      reviewer.on('review:progress', (data: { progress: number }) => {
        progressEvents.push(data.progress);
      });

      await reviewer.reviewContent('const x = 1;', { language: 'typescript' });

      expect(progressEvents.length).toBeGreaterThan(0);
    });
  });

  describe('metadata', () => {
    it('should include review duration in metadata', async () => {
      const result = await reviewer.reviewContent('const x = 1;', {
        language: 'typescript',
      });

      expect(result.metadata.reviewDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include applied rules in metadata', async () => {
      const result = await reviewer.reviewContent('const x = 1;', {
        language: 'typescript',
      });

      expect(result.metadata.rulesApplied.length).toBeGreaterThan(0);
    });

    it('should include lines reviewed in metadata', async () => {
      const code = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
      const result = await reviewer.reviewContent(code, { language: 'typescript' });

      expect(result.metadata.linesReviewed).toBe(4);
    });
  });

  describe('singleton', () => {
    it('should return same instance from getCodeReviewer', () => {
      resetCodeReviewer();
      const instance1 = getCodeReviewer();
      const instance2 = getCodeReviewer();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetCodeReviewer', () => {
      const instance1 = getCodeReviewer();
      resetCodeReviewer();
      const instance2 = getCodeReviewer();

      expect(instance1).not.toBe(instance2);
    });
  });
});
