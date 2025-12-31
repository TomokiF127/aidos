/**
 * SelfHealingLoop Tests
 *
 * Tests for error classification, healing strategies, and the healing loop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SelfHealingLoop,
  getSelfHealingLoop,
  resetSelfHealingLoop,
  ErrorClassifier,
  SelfHealingConfig,
  HealingContext,
  HealingError,
  HealingResult,
  FixStrategy,
  ErrorType,
  DEFAULT_SELF_HEALING_CONFIG,
} from '../../src/core/self-healing.js';

// ========================================
// Test Helpers
// ========================================

function createMockContext(content: string = 'const x = 1'): HealingContext {
  return {
    content,
    filename: 'test.ts',
    language: 'typescript',
  };
}

function createMockError(type: ErrorType, message: string): Error {
  const error = new Error(message);
  if (type === 'syntax') {
    error.name = 'SyntaxError';
  } else if (type === 'type') {
    error.name = 'TypeError';
  } else if (type === 'runtime') {
    error.name = 'ReferenceError';
  } else if (type === 'test') {
    error.name = 'AssertionError';
  }
  return error;
}

// ========================================
// Test Suites
// ========================================

describe('SelfHealingLoop', () => {
  let healingLoop: SelfHealingLoop;

  beforeEach(() => {
    resetSelfHealingLoop();
    healingLoop = new SelfHealingLoop();
  });

  afterEach(() => {
    resetSelfHealingLoop();
  });

  // ========================================
  // Initialization
  // ========================================

  describe('Initialization', () => {
    it('should create loop with default config', () => {
      expect(healingLoop).toBeDefined();
      expect(healingLoop.getConfig()).toEqual(DEFAULT_SELF_HEALING_CONFIG);
    });

    it('should create loop with custom config', () => {
      const customConfig: Partial<SelfHealingConfig> = {
        maxRetries: 5,
        retryDelayMs: 2000,
      };
      const customLoop = new SelfHealingLoop(customConfig);

      const config = customLoop.getConfig();
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelayMs).toBe(2000);
    });

    it('should load built-in strategies', () => {
      const strategies = healingLoop.getStrategies();
      expect(strategies.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Error Classification
  // ========================================

  describe('Error Classification', () => {
    it('should classify syntax errors', () => {
      const error = healingLoop.classifyError(
        new SyntaxError('Unexpected token')
      );
      expect(error.type).toBe('syntax');
    });

    it('should classify type errors', () => {
      const error = healingLoop.classifyError(
        new TypeError('Cannot read property of undefined')
      );
      expect(error.type).toBe('type');
    });

    it('should classify runtime errors', () => {
      const error = healingLoop.classifyError(
        new ReferenceError('x is not defined')
      );
      expect(error.type).toBe('runtime');
    });

    it('should classify test errors', () => {
      const error = new Error('Expected value to equal 5');
      error.name = 'AssertionError';
      const healingError = healingLoop.classifyError(error);
      expect(healingError.type).toBe('test');
    });

    it('should classify unknown errors', () => {
      const error = healingLoop.classifyError(new Error('Some unknown error'));
      expect(error.type).toBe('unknown');
    });

    it('should classify string errors', () => {
      const error = healingLoop.classifyError('SyntaxError: Unexpected end');
      expect(error.type).toBe('syntax');
    });

    it('should extract error location from stack', () => {
      const error = new Error('Test error');
      error.stack = `Error: Test error
    at Object.<anonymous> (/path/to/file.ts:10:5)
    at Module._compile (node:internal/modules/cjs/loader:1256:14)`;

      const healingError = healingLoop.classifyError(error);
      expect(healingError.location).toBeDefined();
      expect(healingError.location?.file).toBe('/path/to/file.ts');
      expect(healingError.location?.line).toBe(10);
      expect(healingError.location?.column).toBe(5);
    });
  });

  // ========================================
  // Strategy Management
  // ========================================

  describe('Strategy Management', () => {
    it('should add custom strategy', () => {
      const customStrategy: FixStrategy = {
        id: 'custom-fix',
        name: 'Custom Fix',
        description: 'A custom fix strategy',
        applicableErrors: ['syntax'],
        generateFix: async (error, context) => context.content + ';',
        verify: async () => true,
      };

      healingLoop.addStrategy(customStrategy);
      const strategies = healingLoop.getStrategies();

      expect(strategies.find((s) => s.id === 'custom-fix')).toBeDefined();
    });

    it('should remove strategy', () => {
      const initialCount = healingLoop.getStrategies().length;
      healingLoop.removeStrategy('syntax-semicolon');

      expect(healingLoop.getStrategies().length).toBe(initialCount - 1);
    });

    it('should return false when removing non-existent strategy', () => {
      const result = healingLoop.removeStrategy('non-existent');
      expect(result).toBe(false);
    });
  });

  // ========================================
  // Healing Process
  // ========================================

  describe('Healing Process', () => {
    it('should execute healing loop', async () => {
      const context = createMockContext('const x = 1');
      const error = new SyntaxError('Missing semicolon');

      const result = await healingLoop.heal(error, context, async () => true);

      expect(result.attempts.length).toBeGreaterThan(0);
    });

    it('should succeed when verification passes', async () => {
      // Use a short retry delay for faster tests
      const loop = new SelfHealingLoop({
        maxRetries: 3,
        retryDelayMs: 10,
      });
      const context = createMockContext('const x = 1');
      const error = new SyntaxError('Missing semicolon');

      const result = await loop.heal(error, context, async () => true);

      expect(result.success).toBe(true);
      expect(result.escalated).toBe(false);
    });

    it('should escalate after max retries', async () => {
      const loop = new SelfHealingLoop({
        maxRetries: 2,
        retryDelayMs: 10,
      });

      const context = createMockContext('const x = 1');
      const error = new SyntaxError('Cannot fix');

      const result = await loop.heal(error, context, async () => false);

      expect(result.success).toBe(false);
      expect(result.escalated).toBe(true);
      expect(result.attempts.length).toBe(2);
    });

    it('should call escalation callback on failure', async () => {
      const escalationCallback = vi.fn();
      const loop = new SelfHealingLoop({
        maxRetries: 1,
        retryDelayMs: 10,
        escalationCallback,
      });

      const context = createMockContext('const x = 1');
      const error = new SyntaxError('Cannot fix');

      await loop.heal(error, context, async () => false);

      expect(escalationCallback).toHaveBeenCalled();
    });

    it('should include attempt details', async () => {
      const context = createMockContext('const x = 1');
      const error = new SyntaxError('Missing semicolon');

      const result = await healingLoop.heal(error, context, async () => true);

      expect(result.attempts[0]).toMatchObject({
        attempt: expect.any(Number),
        errorType: expect.any(String),
        originalError: expect.any(String),
        fixApplied: expect.any(Boolean),
        verificationResult: expect.any(String),
        timestamp: expect.any(Date),
        durationMs: expect.any(Number),
      });
    });

    it('should track total duration', async () => {
      const context = createMockContext('const x = 1');
      const error = new SyntaxError('Test error');

      const result = await healingLoop.heal(error, context, async () => true);

      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================
  // Events
  // ========================================

  describe('Events', () => {
    it('should emit healing:start event', async () => {
      const handler = vi.fn();
      healingLoop.on('healing:start', handler);

      const context = createMockContext('const x = 1');
      await healingLoop.heal(new SyntaxError('Test'), context, async () => true);

      expect(handler).toHaveBeenCalled();
    });

    it('should emit healing:attempt event', async () => {
      const handler = vi.fn();
      healingLoop.on('healing:attempt', handler);

      const context = createMockContext('const x = 1');
      await healingLoop.heal(new SyntaxError('Test'), context, async () => true);

      expect(handler).toHaveBeenCalled();
    });

    it('should emit healing:success on success', async () => {
      const loop = new SelfHealingLoop({
        maxRetries: 3,
        retryDelayMs: 10,
      });
      const handler = vi.fn();
      loop.on('healing:success', handler);

      const context = createMockContext('const x = 1');
      await loop.heal(new SyntaxError('Test'), context, async () => true);

      expect(handler).toHaveBeenCalled();
    });

    it('should emit healing:escalated on failure', async () => {
      const handler = vi.fn();
      const loop = new SelfHealingLoop({
        maxRetries: 1,
        retryDelayMs: 10,
      });
      loop.on('healing:escalated', handler);

      const context = createMockContext('const x = 1');
      await loop.heal(new SyntaxError('Test'), context, async () => false);

      expect(handler).toHaveBeenCalled();
    });

    it('should emit healing:verification_start and healing:verification_complete', async () => {
      const startHandler = vi.fn();
      const completeHandler = vi.fn();
      healingLoop.on('healing:verification_start', startHandler);
      healingLoop.on('healing:verification_complete', completeHandler);

      const context = createMockContext('const x = 1');
      await healingLoop.heal(new SyntaxError('Test'), context, async () => true);

      expect(startHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });
  });

  // ========================================
  // Concurrency Control
  // ========================================

  describe('Concurrency Control', () => {
    it('should track healing in progress', async () => {
      expect(healingLoop.isHealingInProgress()).toBe(false);

      const healingPromise = healingLoop.heal(
        new SyntaxError('Test'),
        createMockContext(''),
        async () => {
          expect(healingLoop.isHealingInProgress()).toBe(true);
          return true;
        }
      );

      await healingPromise;
      expect(healingLoop.isHealingInProgress()).toBe(false);
    });

    it('should reject concurrent healing', async () => {
      const context = createMockContext('');
      let resolveFirst: (() => void) | undefined;

      const firstHealing = healingLoop.heal(
        new SyntaxError('Test'),
        context,
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = () => resolve(true);
          })
      );

      // Wait a bit for the first healing to start
      await new Promise((r) => setTimeout(r, 50));

      await expect(
        healingLoop.heal(new SyntaxError('Second'), context, async () => true)
      ).rejects.toThrow('Healing already in progress');

      if (resolveFirst) {
        resolveFirst();
      }
      await firstHealing;
    });
  });

  // ========================================
  // Configuration
  // ========================================

  describe('Configuration', () => {
    it('should update config', () => {
      healingLoop.updateConfig({ maxRetries: 10 });
      expect(healingLoop.getConfig().maxRetries).toBe(10);
    });

    it('should preserve unmodified config', () => {
      const originalDelay = healingLoop.getConfig().retryDelayMs;
      healingLoop.updateConfig({ maxRetries: 10 });
      expect(healingLoop.getConfig().retryDelayMs).toBe(originalDelay);
    });
  });

  // ========================================
  // Singleton Pattern
  // ========================================

  describe('Singleton Pattern', () => {
    it('should return same instance with getSelfHealingLoop', () => {
      const instance1 = getSelfHealingLoop();
      const instance2 = getSelfHealingLoop();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getSelfHealingLoop();
      resetSelfHealingLoop();
      const instance2 = getSelfHealingLoop();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ========================================
  // Error Classifier Unit Tests
  // ========================================

  describe('ErrorClassifier', () => {
    let classifier: ErrorClassifier;

    beforeEach(() => {
      classifier = new ErrorClassifier();
    });

    it('should classify by error name', () => {
      expect(classifier.classify(new SyntaxError('test'))).toBe('syntax');
      expect(classifier.classify(new TypeError('test'))).toBe('type');
      expect(classifier.classify(new ReferenceError('test'))).toBe('runtime');
      expect(classifier.classify(new RangeError('test'))).toBe('runtime');
    });

    it('should classify by error message patterns', () => {
      expect(classifier.classify('Unexpected token ;')).toBe('syntax');
      expect(classifier.classify('foo is not a function')).toBe('type');
      expect(classifier.classify('Property foo does not exist on type bar')).toBe('type');
      expect(classifier.classify('Maximum call stack size exceeded')).toBe('runtime');
      expect(classifier.classify('x is not defined')).toBe('runtime');
      expect(classifier.classify('Expected 5 to equal 10')).toBe('test');
    });

    it('should create HealingError with context', () => {
      const error = new SyntaxError('Test error');
      const healingError = classifier.createHealingError(error, { file: 'test.ts' });

      expect(healingError.type).toBe('syntax');
      expect(healingError.message).toBe('Test error');
      expect(healingError.context).toEqual({ file: 'test.ts' });
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty content', async () => {
      const context = createMockContext('');
      const error = new SyntaxError('Empty file');

      const result = await healingLoop.heal(error, context, async () => true);
      expect(result).toBeDefined();
    });

    it('should handle verification timeout', async () => {
      const loop = new SelfHealingLoop({
        maxRetries: 1,
        retryDelayMs: 10,
        verificationTimeoutMs: 10,
      });

      const context = createMockContext('const x = 1');
      const error = new SyntaxError('Test');

      const result = await loop.heal(
        error,
        context,
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(true), 1000);
          })
      );

      expect(result.success).toBe(false);
    });

    it('should handle strategy that throws', async () => {
      const throwingStrategy: FixStrategy = {
        id: 'throwing-strategy',
        name: 'Throwing Strategy',
        description: 'Throws an error',
        applicableErrors: ['syntax'],
        generateFix: async () => {
          throw new Error('Strategy failed');
        },
        verify: async () => true,
      };

      healingLoop.addStrategy(throwingStrategy);
      const context = createMockContext('const x = 1');

      // Should not throw, just continue to next strategy
      const result = await healingLoop.heal(
        new SyntaxError('Test'),
        context,
        async () => true
      );

      expect(result).toBeDefined();
    });

    it('should include final error message on failure', async () => {
      const loop = new SelfHealingLoop({
        maxRetries: 1,
        retryDelayMs: 10,
      });

      const context = createMockContext('const x = 1');
      const error = new SyntaxError('Specific error message');

      const result = await loop.heal(error, context, async () => false);

      expect(result.finalError).toBe('Specific error message');
    });
  });
});
