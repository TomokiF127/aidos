/**
 * PromptTemplateManager Integration Tests
 *
 * Tests for template management, rendering, and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PromptTemplateManager,
  PromptTemplate,
  TemplateCategory,
  TemplateVariables,
  TemplateOptions,
  RenderResult,
  getPromptTemplateManager,
  resetPromptTemplateManager,
  createTaskDecompositionPrompt,
  createCodeGenerationPrompt,
  createCodeReviewPrompt,
  createTestGenerationPrompt,
  createSystemPrompt,
} from '../../src/config/prompt-templates.js';

describe('PromptTemplateManager', () => {
  let manager: PromptTemplateManager;

  beforeEach(() => {
    resetPromptTemplateManager();
    manager = new PromptTemplateManager();
  });

  afterEach(() => {
    resetPromptTemplateManager();
  });

  describe('initialization', () => {
    it('should load builtin templates on initialization', () => {
      const templates = manager.getAll();
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should include task decomposition template', () => {
      const template = manager.get('task-decomposition-v1');
      expect(template).toBeDefined();
      expect(template?.category).toBe('task-decomposition');
    });

    it('should include code generation template', () => {
      const template = manager.get('code-generation-v1');
      expect(template).toBeDefined();
      expect(template?.category).toBe('code-generation');
    });

    it('should include code review template', () => {
      const template = manager.get('code-review-v1');
      expect(template).toBeDefined();
      expect(template?.category).toBe('code-review');
    });

    it('should include test generation template', () => {
      const template = manager.get('test-generation-v1');
      expect(template).toBeDefined();
      expect(template?.category).toBe('test-generation');
    });

    it('should include documentation template', () => {
      const template = manager.get('documentation-v1');
      expect(template).toBeDefined();
      expect(template?.category).toBe('documentation');
    });

    it('should include debugging template', () => {
      const template = manager.get('debugging-v1');
      expect(template).toBeDefined();
      expect(template?.category).toBe('debugging');
    });

    it('should include refactoring template', () => {
      const template = manager.get('refactoring-v1');
      expect(template).toBeDefined();
      expect(template?.category).toBe('refactoring');
    });

    it('should include system prompt template', () => {
      const template = manager.get('system-prompt-v1');
      expect(template).toBeDefined();
      expect(template?.category).toBe('system');
    });
  });

  describe('template retrieval', () => {
    it('should get template by id', () => {
      const template = manager.get('task-decomposition-v1');
      expect(template?.id).toBe('task-decomposition-v1');
    });

    it('should return undefined for non-existent template', () => {
      const template = manager.get('non-existent');
      expect(template).toBeUndefined();
    });

    it('should get templates by category', () => {
      const templates = manager.getByCategory('code-generation');
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((t) => t.category === 'code-generation')).toBe(true);
    });

    it('should return empty array for non-existent category', () => {
      const templates = manager.getByCategory('non-existent' as TemplateCategory);
      expect(templates.length).toBe(0);
    });

    it('should get all templates', () => {
      const templates = manager.getAll();
      expect(templates.length).toBeGreaterThan(0);
    });
  });

  describe('custom template management', () => {
    it('should add custom template', () => {
      const customTemplate: PromptTemplate = {
        id: 'custom-template',
        name: 'Custom Template',
        category: 'other' as TemplateCategory,
        description: 'A custom template for testing',
        template: 'Hello {{name}}!',
        requiredVariables: ['name'],
        optionalVariables: [],
        version: '1.0.0',
      };

      manager.add(customTemplate);
      const retrieved = manager.get('custom-template');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Custom Template');
    });

    it('should override builtin template with custom', () => {
      const customTemplate: PromptTemplate = {
        id: 'task-decomposition-v1',
        name: 'Custom Task Decomposition',
        category: 'task-decomposition',
        description: 'Custom version',
        template: 'Custom: {{objective}}',
        requiredVariables: ['objective'],
        optionalVariables: [],
        version: '2.0.0',
      };

      manager.add(customTemplate);
      const retrieved = manager.get('task-decomposition-v1');

      expect(retrieved?.name).toBe('Custom Task Decomposition');
      expect(retrieved?.version).toBe('2.0.0');
    });

    it('should remove custom template', () => {
      const customTemplate: PromptTemplate = {
        id: 'removable-template',
        name: 'Removable',
        category: 'other' as TemplateCategory,
        description: 'To be removed',
        template: 'Test',
        requiredVariables: [],
        optionalVariables: [],
        version: '1.0.0',
      };

      manager.add(customTemplate);
      const removed = manager.remove('removable-template');

      expect(removed).toBe(true);
      expect(manager.get('removable-template')).toBeUndefined();
    });

    it('should return false when removing non-existent template', () => {
      const removed = manager.remove('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('basic rendering', () => {
    it('should render template with variables', () => {
      const result = manager.render('task-decomposition-v1', {
        objective: 'Build a REST API',
      });

      expect(result.prompt).toContain('Build a REST API');
      expect(result.usedVariables).toContain('objective');
    });

    it('should throw error for non-existent template', () => {
      expect(() =>
        manager.render('non-existent', { objective: 'test' })
      ).toThrow('Template not found');
    });

    it('should track used variables', () => {
      const result = manager.render('code-generation-v1', {
        task: 'Create function',
        language: 'typescript',
        framework: 'vitest',
      });

      expect(result.usedVariables).toContain('task');
      expect(result.usedVariables).toContain('language');
      expect(result.usedVariables).toContain('framework');
    });

    it('should track missing variables', () => {
      const result = manager.render(
        'code-generation-v1',
        { task: 'Create function' }, // missing 'language'
        { strict: false }
      );

      // The implementation may handle missing required variables differently
      // Either as missingVariables or as warnings
      expect(
        result.missingVariables.includes('language') ||
        result.warnings.some(w => w.includes('language'))
      ).toBe(true);
    });

    it('should add warnings for unknown variables', () => {
      manager.add({
        id: 'simple-template',
        name: 'Simple',
        category: 'other' as TemplateCategory,
        description: 'Simple template',
        template: 'Hello {{name}} and {{other}}!',
        requiredVariables: ['name'],
        optionalVariables: [],
        version: '1.0.0',
      });

      const result = manager.render('simple-template', { name: 'World' });

      expect(result.warnings.some((w) => w.includes('other'))).toBe(true);
    });
  });

  describe('renderString', () => {
    it('should render template string directly', () => {
      const result = manager.renderString('Hello {{name}}!', { name: 'World' });

      expect(result.prompt).toBe('Hello World!');
    });

    it('should handle multiple variables', () => {
      const result = manager.renderString(
        '{{greeting}} {{name}}, welcome to {{place}}!',
        { greeting: 'Hello', name: 'User', place: 'AIDOS' }
      );

      expect(result.prompt).toBe('Hello User, welcome to AIDOS!');
    });
  });

  describe('conditional rendering', () => {
    it('should include content when condition is truthy', () => {
      const result = manager.renderString(
        'Hello{{#if name}} {{name}}{{/if}}!',
        { name: 'World' }
      );

      expect(result.prompt).toBe('Hello World!');
    });

    it('should exclude content when condition is falsy', () => {
      const result = manager.renderString(
        'Hello{{#if name}} {{name}}{{/if}}!',
        {}
      );

      expect(result.prompt).toBe('Hello!');
    });

    it('should treat empty string as falsy', () => {
      const result = manager.renderString(
        'Hello{{#if name}} {{name}}{{/if}}!',
        { name: '' }
      );

      expect(result.prompt).toBe('Hello!');
    });

    it('should treat null as falsy', () => {
      const result = manager.renderString(
        'Hello{{#if name}} {{name}}{{/if}}!',
        { name: null as any }
      );

      expect(result.prompt).toBe('Hello!');
    });

    it('should treat undefined as falsy', () => {
      const result = manager.renderString(
        'Hello{{#if name}} {{name}}{{/if}}!',
        { name: undefined as any }
      );

      expect(result.prompt).toBe('Hello!');
    });

    it('should treat empty array as falsy', () => {
      const result = manager.renderString(
        'Items{{#if items}}: {{items}}{{/if}}',
        { items: [] }
      );

      expect(result.prompt).toBe('Items');
    });

    it('should treat non-empty array as truthy', () => {
      const result = manager.renderString(
        'Items{{#if items}}: {{items}}{{/if}}',
        { items: ['a', 'b', 'c'] }
      );

      expect(result.prompt).toContain('a');
    });

    it('should handle nested conditionals', () => {
      const template = `
Start
{{#if a}}
A is present
{{#if b}}
B is also present
{{/if}}
{{/if}}
End`;

      const result = manager.renderString(template, { a: true, b: true });

      expect(result.prompt).toContain('A is present');
      expect(result.prompt).toContain('B is also present');
    });
  });

  describe('variable type handling', () => {
    it('should stringify numbers', () => {
      const result = manager.renderString('Count: {{count}}', { count: 42 });
      expect(result.prompt).toBe('Count: 42');
    });

    it('should stringify booleans', () => {
      const result = manager.renderString('Active: {{active}}', { active: true });
      expect(result.prompt).toBe('Active: true');
    });

    it('should join arrays with newlines', () => {
      const result = manager.renderString('Items: {{items}}', {
        items: ['one', 'two', 'three'],
      });
      expect(result.prompt).toBe('Items: one\ntwo\nthree');
    });

    it('should stringify objects as JSON', () => {
      const result = manager.renderString('Data: {{data}}', {
        data: { key: 'value' },
      });
      expect(result.prompt).toContain('"key"');
      expect(result.prompt).toContain('"value"');
    });
  });

  describe('template options', () => {
    it('should throw error in strict mode for missing required variables', () => {
      expect(() =>
        manager.render('code-generation-v1', {}, { strict: true })
      ).toThrow('Missing required variables');
    });

    it('should preserve unknown variables when preserveUnknown is true', () => {
      const result = manager.renderString(
        'Hello {{name}} and {{unknown}}!',
        { name: 'World' },
        { preserveUnknown: true }
      );

      expect(result.prompt).toContain('{{unknown}}');
    });

    it('should remove unknown variables by default', () => {
      const result = manager.renderString('Hello {{name}} and {{unknown}}!', {
        name: 'World',
      });

      expect(result.prompt).not.toContain('{{unknown}}');
      expect(result.prompt).toBe('Hello World and !');
    });

    it('should trim whitespace by default', () => {
      const result = manager.renderString('  Hello {{name}}!  ', {
        name: 'World',
      });

      expect(result.prompt).toBe('Hello World!');
    });

    it('should collapse multiple blank lines', () => {
      const result = manager.renderString('Line 1\n\n\n\n\nLine 2', {});

      expect(result.prompt).toBe('Line 1\n\nLine 2');
    });
  });

  describe('template validation', () => {
    it('should validate correct template', () => {
      const template: PromptTemplate = {
        id: 'valid-template',
        name: 'Valid Template',
        category: 'other' as TemplateCategory,
        description: 'A valid template',
        template: 'Hello {{name}}!',
        requiredVariables: ['name'],
        optionalVariables: [],
        version: '1.0.0',
      };

      const result = manager.validate(template);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect missing id', () => {
      const template: PromptTemplate = {
        id: '',
        name: 'No ID',
        category: 'other' as TemplateCategory,
        description: 'Missing ID',
        template: 'Test',
        requiredVariables: [],
        optionalVariables: [],
        version: '1.0.0',
      };

      const result = manager.validate(template);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('ID'))).toBe(true);
    });

    it('should detect missing name', () => {
      const template: PromptTemplate = {
        id: 'no-name',
        name: '',
        category: 'other' as TemplateCategory,
        description: 'Missing name',
        template: 'Test',
        requiredVariables: [],
        optionalVariables: [],
        version: '1.0.0',
      };

      const result = manager.validate(template);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('should detect missing template content', () => {
      const template: PromptTemplate = {
        id: 'no-content',
        name: 'No Content',
        category: 'other' as TemplateCategory,
        description: 'Missing content',
        template: '',
        requiredVariables: [],
        optionalVariables: [],
        version: '1.0.0',
      };

      const result = manager.validate(template);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('content'))).toBe(true);
    });

    it('should detect required variable not in template', () => {
      const template: PromptTemplate = {
        id: 'missing-var',
        name: 'Missing Variable',
        category: 'other' as TemplateCategory,
        description: 'Required var not in template',
        template: 'Hello World!',
        requiredVariables: ['name'],
        optionalVariables: [],
        version: '1.0.0',
      };

      const result = manager.validate(template);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('should accept required variable in conditional', () => {
      const template: PromptTemplate = {
        id: 'conditional-var',
        name: 'Conditional Variable',
        category: 'other' as TemplateCategory,
        description: 'Var in conditional',
        template: '{{#if name}}Hello {{name}}!{{/if}}',
        requiredVariables: ['name'],
        optionalVariables: [],
        version: '1.0.0',
      };

      const result = manager.validate(template);

      expect(result.valid).toBe(true);
    });
  });

  describe('template cloning', () => {
    it('should clone existing template', () => {
      const cloned = manager.clone('task-decomposition-v1', 'my-task-template');

      expect(cloned).toBeDefined();
      expect(cloned?.id).toBe('my-task-template');
      expect(cloned?.name).toContain('Copy');
    });

    it('should add cloned template to manager', () => {
      manager.clone('task-decomposition-v1', 'my-task-template');

      const retrieved = manager.get('my-task-template');
      expect(retrieved).toBeDefined();
    });

    it('should return undefined for non-existent source', () => {
      const cloned = manager.clone('non-existent', 'new-template');
      expect(cloned).toBeUndefined();
    });
  });

  describe('convenience functions', () => {
    describe('createTaskDecompositionPrompt', () => {
      it('should create task decomposition prompt', () => {
        const prompt = createTaskDecompositionPrompt('Build a REST API');

        expect(prompt).toContain('Build a REST API');
        expect(prompt).toContain('プロジェクトマネージャー');
      });

      it('should include optional context', () => {
        const prompt = createTaskDecompositionPrompt('Build a REST API', {
          context: 'Using Express.js',
        });

        expect(prompt).toContain('Using Express.js');
      });

      it('should include optional constraints', () => {
        const prompt = createTaskDecompositionPrompt('Build a REST API', {
          constraints: 'Must be TypeScript',
        });

        expect(prompt).toContain('Must be TypeScript');
      });

      it('should include maxTasks option', () => {
        const prompt = createTaskDecompositionPrompt('Build a REST API', {
          maxTasks: 5,
        });

        expect(prompt).toContain('5');
      });
    });

    describe('createCodeGenerationPrompt', () => {
      it('should create code generation prompt', () => {
        const prompt = createCodeGenerationPrompt(
          'Create a user authentication function',
          'typescript'
        );

        expect(prompt).toContain('user authentication');
        expect(prompt).toContain('typescript');
      });

      it('should include framework option', () => {
        const prompt = createCodeGenerationPrompt(
          'Create an API endpoint',
          'typescript',
          { framework: 'Express.js' }
        );

        expect(prompt).toContain('Express.js');
      });

      it('should include existing code', () => {
        const prompt = createCodeGenerationPrompt('Add error handling', 'typescript', {
          existingCode: 'function existing() {}',
        });

        expect(prompt).toContain('function existing()');
      });
    });

    describe('createCodeReviewPrompt', () => {
      it('should create code review prompt', () => {
        const code = 'function test() { return 42; }';
        const prompt = createCodeReviewPrompt(code, 'typescript');

        expect(prompt).toContain(code);
        expect(prompt).toContain('レビュー');
      });

      it('should include focus areas', () => {
        const prompt = createCodeReviewPrompt('const x = 1;', 'typescript', {
          focusAreas: 'Security and performance',
        });

        expect(prompt).toContain('Security and performance');
      });
    });

    describe('createTestGenerationPrompt', () => {
      it('should create test generation prompt', () => {
        const code = 'function add(a, b) { return a + b; }';
        const prompt = createTestGenerationPrompt(code, 'typescript');

        expect(prompt).toContain(code);
        expect(prompt).toContain('テスト');
      });

      it('should include framework option', () => {
        const prompt = createTestGenerationPrompt('function test() {}', 'typescript', {
          framework: 'vitest',
        });

        expect(prompt).toContain('vitest');
      });
    });

    describe('createSystemPrompt', () => {
      it('should create system prompt', () => {
        const prompt = createSystemPrompt(
          'Code Reviewer',
          'Review code for quality'
        );

        expect(prompt).toContain('Code Reviewer');
        expect(prompt).toContain('Review code for quality');
      });

      it('should include capabilities', () => {
        const prompt = createSystemPrompt('Developer', 'Write code', {
          capabilities: 'TypeScript, React, Node.js',
        });

        expect(prompt).toContain('TypeScript, React, Node.js');
      });

      it('should include constraints', () => {
        const prompt = createSystemPrompt('Developer', 'Write code', {
          constraints: 'No external APIs',
        });

        expect(prompt).toContain('No external APIs');
      });
    });
  });

  describe('builtin template content', () => {
    it('should have proper JSON output format in task decomposition', () => {
      const prompt = createTaskDecompositionPrompt('Test objective');

      expect(prompt).toContain('```json');
      expect(prompt).toContain('"tasks"');
      expect(prompt).toContain('"dependencies"');
    });

    it('should have proper code blocks in code generation', () => {
      const prompt = createCodeGenerationPrompt('Test task', 'typescript');

      expect(prompt).toContain('```typescript');
    });

    it('should have severity levels in code review', () => {
      const prompt = createCodeReviewPrompt('const x = 1;', 'typescript');

      expect(prompt).toContain('info');
      expect(prompt).toContain('warning');
      expect(prompt).toContain('error');
      expect(prompt).toContain('critical');
    });
  });

  describe('singleton', () => {
    it('should return same instance from getPromptTemplateManager', () => {
      resetPromptTemplateManager();
      const instance1 = getPromptTemplateManager();
      const instance2 = getPromptTemplateManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetPromptTemplateManager', () => {
      const instance1 = getPromptTemplateManager();
      resetPromptTemplateManager();
      const instance2 = getPromptTemplateManager();

      expect(instance1).not.toBe(instance2);
    });

    it('should preserve custom templates until reset', () => {
      const manager = getPromptTemplateManager();
      manager.add({
        id: 'persistent-template',
        name: 'Persistent',
        category: 'other' as TemplateCategory,
        description: 'Should persist',
        template: 'Test',
        requiredVariables: [],
        optionalVariables: [],
        version: '1.0.0',
      });

      const sameManager = getPromptTemplateManager();
      expect(sameManager.get('persistent-template')).toBeDefined();

      resetPromptTemplateManager();
      const newManager = getPromptTemplateManager();
      expect(newManager.get('persistent-template')).toBeUndefined();
    });
  });
});
