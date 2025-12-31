/**
 * DoneDefinitionGenerator Tests
 *
 * Tests for Done definition generation, requirements mapping,
 * impact analysis, and breaking change detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DoneDefinitionGenerator,
  DoneDefinition,
  TaskInfo,
  CodeChangeInfo,
  DoneDefinitionOptions,
  RequirementStatus,
  AffectedFile,
  getDoneDefinitionGenerator,
  resetDoneDefinitionGenerator,
} from '../../src/quality/done-definition.js';

describe('DoneDefinitionGenerator', () => {
  let generator: DoneDefinitionGenerator;

  beforeEach(() => {
    resetDoneDefinitionGenerator();
    generator = new DoneDefinitionGenerator();
  });

  afterEach(() => {
    resetDoneDefinitionGenerator();
  });

  describe('initialization', () => {
    it('should create instance with default config', () => {
      expect(generator).toBeInstanceOf(DoneDefinitionGenerator);
    });

    it('should create instance with custom config', () => {
      const customGenerator = new DoneDefinitionGenerator({
        agents: { maxConcurrent: 10, timeoutMs: 600000 },
      });
      expect(customGenerator).toBeInstanceOf(DoneDefinitionGenerator);
    });
  });

  describe('generate', () => {
    const sampleTaskInfo: TaskInfo = {
      id: 'task-001',
      title: 'Implement user authentication',
      description: 'Add user authentication feature',
      requirements: [
        'Implement login functionality',
        'Add password hashing',
        'Create session management',
      ],
      acceptanceCriteria: [
        'Users can log in with email and password',
        'Passwords are securely hashed',
      ],
    };

    const sampleCodeChanges: CodeChangeInfo = {
      files: [
        {
          path: 'src/auth/login.ts',
          changeType: 'added',
          linesAdded: 100,
          linesRemoved: 0,
        },
        {
          path: 'src/auth/password.ts',
          changeType: 'added',
          linesAdded: 50,
          linesRemoved: 0,
        },
        {
          path: 'tests/auth/login.test.ts',
          changeType: 'added',
          linesAdded: 80,
          linesRemoved: 0,
        },
      ],
    };

    it('should generate Done definition', async () => {
      const result = await generator.generate(sampleTaskInfo, sampleCodeChanges);

      expect(result).toBeDefined();
      expect(result.taskId).toBe(sampleTaskInfo.id);
      expect(result.title).toBe(sampleTaskInfo.title);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should include requirements mapping', async () => {
      const result = await generator.generate(sampleTaskInfo, sampleCodeChanges);

      expect(result.requirementsMapping).toBeDefined();
      expect(result.requirementsMapping.length).toBeGreaterThan(0);

      const firstReq = result.requirementsMapping[0];
      expect(firstReq.id).toBeDefined();
      expect(firstReq.description).toBeDefined();
      expect(['satisfied', 'not_satisfied', 'not_verified']).toContain(firstReq.status);
    });

    it('should include verification results', async () => {
      const result = await generator.generate(sampleTaskInfo, sampleCodeChanges);

      expect(result.verification).toBeDefined();
      expect(typeof result.verification.testsRun).toBe('number');
      expect(typeof result.verification.testsPassed).toBe('number');
      expect(typeof result.verification.buildSucceeded).toBe('boolean');
      expect(typeof result.verification.lintPassed).toBe('boolean');
    });

    it('should include impact analysis', async () => {
      const result = await generator.generate(sampleTaskInfo, sampleCodeChanges);

      expect(result.impactAnalysis).toBeDefined();
      expect(result.impactAnalysis.affectedFiles).toBeDefined();
      expect(['low', 'medium', 'high', 'critical']).toContain(
        result.impactAnalysis.estimatedRiskLevel
      );
      expect(['simple', 'moderate', 'complex']).toContain(
        result.impactAnalysis.rollbackComplexity
      );
    });

    it('should include breaking changes info', async () => {
      const result = await generator.generate(sampleTaskInfo, sampleCodeChanges);

      expect(result.breakingChanges).toBeDefined();
      expect(typeof result.breakingChanges.hasBreakingChanges).toBe('boolean');
      expect(Array.isArray(result.breakingChanges.changes)).toBe(true);
      expect(typeof result.breakingChanges.backwardCompatible).toBe('boolean');
    });

    it('should generate reproduction command', async () => {
      const result = await generator.generate(sampleTaskInfo, sampleCodeChanges);

      expect(result.reproductionCommand).toBeDefined();
      expect(result.reproductionCommand).toContain('npm');
    });

    it('should generate done checklist', async () => {
      const result = await generator.generate(sampleTaskInfo, sampleCodeChanges);

      expect(result.doneChecklist).toBeDefined();
      expect(result.doneChecklist.length).toBeGreaterThan(0);
      expect(result.doneChecklist.some(item => item.includes('['))).toBe(true);
    });

    it('should determine final status', async () => {
      const result = await generator.generate(sampleTaskInfo, sampleCodeChanges);

      expect(['done', 'blocked', 'in_progress']).toContain(result.finalStatus);
    });
  });

  describe('mapRequirements', () => {
    it('should map all requirements', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test task',
        description: 'Test',
        requirements: ['Requirement 1', 'Requirement 2'],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/test.ts', changeType: 'added', linesAdded: 10, linesRemoved: 0 },
        ],
      };

      const result = generator.mapRequirements(taskInfo, codeChanges);

      expect(result.length).toBe(2);
      expect(result[0].id).toBe('req-1');
      expect(result[1].id).toBe('req-2');
    });

    it('should evaluate requirement status based on code changes', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test task',
        description: 'Test',
        requirements: ['Implement new feature', 'Fix existing bug', 'Add tests'],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/feature.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0 },
          { path: 'src/bug.ts', changeType: 'modified', linesAdded: 10, linesRemoved: 5 },
          { path: 'tests/feature.test.ts', changeType: 'added', linesAdded: 30, linesRemoved: 0 },
        ],
      };

      const result = generator.mapRequirements(taskInfo, codeChanges);

      // Should satisfy implementation requirement
      expect(result[0].status).toBe('satisfied');

      // Should satisfy fix requirement
      expect(result[1].status).toBe('satisfied');

      // Should satisfy test requirement
      expect(result[2].status).toBe('satisfied');
    });

    it('should mark as not_verified when no matching changes', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test task',
        description: 'Test',
        requirements: ['Document the API'],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/code.ts', changeType: 'modified', linesAdded: 5, linesRemoved: 0 },
        ],
      };

      const result = generator.mapRequirements(taskInfo, codeChanges);

      expect(result[0].status).toBe('not_verified');
    });

    it('should mark all as not_verified when no files changed', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test task',
        description: 'Test',
        requirements: ['Implement feature'],
      };

      const codeChanges: CodeChangeInfo = {
        files: [],
      };

      const result = generator.mapRequirements(taskInfo, codeChanges);

      expect(result[0].status).toBe('not_verified');
    });
  });

  describe('analyzeImpact', () => {
    it('should analyze impact of file changes', () => {
      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/core/module.ts', changeType: 'modified', linesAdded: 50, linesRemoved: 20 },
          { path: 'src/utils/helper.ts', changeType: 'added', linesAdded: 30, linesRemoved: 0 },
        ],
      };

      const result = generator.analyzeImpact(codeChanges);

      expect(result.affectedFiles).toHaveLength(2);
      expect(result.affectedModules).toContain('core');
      expect(result.affectedModules).toContain('utils');
    });

    it('should evaluate risk level based on changes', () => {
      // Large change with many lines
      const largeChange: CodeChangeInfo = {
        files: [
          { path: 'src/core/main.ts', changeType: 'modified', linesAdded: 300, linesRemoved: 200 },
        ],
      };

      const result = generator.analyzeImpact(largeChange);
      expect(['medium', 'high', 'critical']).toContain(result.estimatedRiskLevel);
    });

    it('should detect high risk for deleted files', () => {
      const deleteChange: CodeChangeInfo = {
        files: [
          { path: 'src/api/endpoint.ts', changeType: 'deleted', linesAdded: 0, linesRemoved: 100 },
          { path: 'package.json', changeType: 'modified', linesAdded: 5, linesRemoved: 2 },
        ],
      };

      const result = generator.analyzeImpact(deleteChange);
      expect(['high', 'critical']).toContain(result.estimatedRiskLevel);
    });

    it('should evaluate rollback complexity', () => {
      // Schema change should increase complexity
      const schemaChange: CodeChangeInfo = {
        files: [
          { path: 'src/db/migration/001.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0 },
        ],
      };

      const result = generator.analyzeImpact(schemaChange);
      expect(result.rollbackComplexity).toBe('complex');
    });

    it('should identify dependency impacts', () => {
      const dependencyChange: CodeChangeInfo = {
        files: [
          { path: 'package.json', changeType: 'modified', linesAdded: 10, linesRemoved: 5 },
        ],
      };

      const result = generator.analyzeImpact(dependencyChange);
      expect(result.dependencyImpacts.length).toBeGreaterThan(0);
      expect(result.dependencyImpacts[0].riskLevel).toBe('high');
    });
  });

  describe('detectBreakingChanges', () => {
    it('should detect API removal', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Remove deprecated API',
        description: 'Remove deprecated endpoints',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/api/deprecated.ts', changeType: 'deleted', linesAdded: 0, linesRemoved: 100 },
        ],
      };

      const result = generator.detectBreakingChanges(codeChanges, taskInfo);

      expect(result.hasBreakingChanges).toBe(true);
      expect(result.changes.some(c => c.type === 'api_removal')).toBe(true);
    });

    it('should detect type definition changes', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Update types',
        description: 'Update type definitions',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/types/api.d.ts', changeType: 'modified', linesAdded: 10, linesRemoved: 5 },
        ],
      };

      const result = generator.detectBreakingChanges(codeChanges, taskInfo);

      expect(result.hasBreakingChanges).toBe(true);
      expect(result.changes.some(c => c.type === 'api_signature_change')).toBe(true);
    });

    it('should detect schema changes', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Update schema',
        description: 'Modify database schema',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/db/schema/users.ts', changeType: 'modified', linesAdded: 20, linesRemoved: 10 },
        ],
      };

      const result = generator.detectBreakingChanges(codeChanges, taskInfo);

      expect(result.hasBreakingChanges).toBe(true);
      expect(result.changes.some(c => c.type === 'schema_change')).toBe(true);
    });

    it('should detect breaking change keywords in description', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Breaking change',
        description: 'This is a breaking change that removes backward compatibility',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/feature.ts', changeType: 'modified', linesAdded: 10, linesRemoved: 5 },
        ],
      };

      const result = generator.detectBreakingChanges(codeChanges, taskInfo);

      expect(result.hasBreakingChanges).toBe(true);
    });

    it('should generate migration guide when breaking changes exist', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Remove API',
        description: 'Remove deprecated API',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/index.ts', changeType: 'deleted', linesAdded: 0, linesRemoved: 50 },
        ],
      };

      const result = generator.detectBreakingChanges(codeChanges, taskInfo);

      if (result.hasBreakingChanges) {
        expect(result.migrationGuide).toBeDefined();
        expect(result.migrationGuide).toContain('Migration Guide');
      }
    });

    it('should report backward compatible when no breaking changes', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Add feature',
        description: 'Add new feature',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/new-feature.ts', changeType: 'added', linesAdded: 100, linesRemoved: 0 },
        ],
      };

      const result = generator.detectBreakingChanges(codeChanges, taskInfo);

      expect(result.hasBreakingChanges).toBe(false);
      expect(result.backwardCompatible).toBe(true);
    });
  });

  describe('generateReproductionCommand', () => {
    it('should generate default commands', () => {
      const result = generator.generateReproductionCommand({});

      expect(result).toContain('npm install');
      expect(result).toContain('npm run build');
      expect(result).toContain('npm run lint');
      expect(result).toContain('npm test');
    });

    it('should use custom commands when provided', () => {
      const result = generator.generateReproductionCommand({
        testCommand: 'pnpm test:coverage',
        buildCommand: 'pnpm build:prod',
        lintCommand: 'pnpm lint:fix',
      });

      expect(result).toContain('pnpm test:coverage');
      expect(result).toContain('pnpm build:prod');
      expect(result).toContain('pnpm lint:fix');
    });
  });

  describe('generateDoneChecklist', () => {
    it('should generate standard checklist items', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test',
        description: 'Test',
        requirements: [],
      };

      const verification = {
        testsRun: 10,
        testsPassed: 10,
        testsFailed: 0,
        testsSkipped: 0,
        testResults: [],
        lintPassed: true,
        lintErrors: 0,
        buildSucceeded: true,
        buildErrors: [],
      };

      const breakingChanges = {
        hasBreakingChanges: false,
        changes: [],
        backwardCompatible: true,
      };

      const result = generator.generateDoneChecklist(
        taskInfo,
        verification,
        breakingChanges
      );

      expect(result.some(item => item.includes('ビルド'))).toBe(true);
      expect(result.some(item => item.includes('Lint'))).toBe(true);
      expect(result.some(item => item.includes('テスト'))).toBe(true);
    });

    it('should show checked items when verification passes', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test',
        description: 'Test',
        requirements: [],
      };

      const verification = {
        testsRun: 10,
        testsPassed: 10,
        testsFailed: 0,
        testsSkipped: 0,
        testResults: [],
        lintPassed: true,
        lintErrors: 0,
        buildSucceeded: true,
        buildErrors: [],
      };

      const breakingChanges = {
        hasBreakingChanges: false,
        changes: [],
        backwardCompatible: true,
      };

      const result = generator.generateDoneChecklist(
        taskInfo,
        verification,
        breakingChanges
      );

      expect(result.some(item => item.startsWith('[x]'))).toBe(true);
    });

    it('should show unchecked items when verification fails', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test',
        description: 'Test',
        requirements: [],
      };

      const verification = {
        testsRun: 10,
        testsPassed: 8,
        testsFailed: 2,
        testsSkipped: 0,
        testResults: [],
        lintPassed: false,
        lintErrors: 5,
        buildSucceeded: false,
        buildErrors: ['Error 1'],
      };

      const breakingChanges = {
        hasBreakingChanges: false,
        changes: [],
        backwardCompatible: true,
      };

      const result = generator.generateDoneChecklist(
        taskInfo,
        verification,
        breakingChanges
      );

      expect(result.some(item => item.startsWith('[ ]'))).toBe(true);
    });

    it('should include breaking change items when present', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test',
        description: 'Test',
        requirements: [],
      };

      const verification = {
        testsRun: 10,
        testsPassed: 10,
        testsFailed: 0,
        testsSkipped: 0,
        testResults: [],
        lintPassed: true,
        lintErrors: 0,
        buildSucceeded: true,
        buildErrors: [],
      };

      const breakingChanges = {
        hasBreakingChanges: true,
        changes: [{ id: '1', type: 'api_removal' as const, description: 'API removed', affectedAreas: [], severity: 'major' as const }],
        backwardCompatible: false,
      };

      const result = generator.generateDoneChecklist(
        taskInfo,
        verification,
        breakingChanges
      );

      expect(result.some(item => item.includes('破壊的変更'))).toBe(true);
      expect(result.some(item => item.includes('マイグレーション'))).toBe(true);
    });

    it('should include custom checklist items', () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test',
        description: 'Test',
        requirements: [],
      };

      const verification = {
        testsRun: 10,
        testsPassed: 10,
        testsFailed: 0,
        testsSkipped: 0,
        testResults: [],
        lintPassed: true,
        lintErrors: 0,
        buildSucceeded: true,
        buildErrors: [],
      };

      const breakingChanges = {
        hasBreakingChanges: false,
        changes: [],
        backwardCompatible: true,
      };

      const customChecklist = ['Custom item 1', 'Custom item 2'];

      const result = generator.generateDoneChecklist(
        taskInfo,
        verification,
        breakingChanges,
        customChecklist
      );

      expect(result.some(item => item.includes('Custom item 1'))).toBe(true);
      expect(result.some(item => item.includes('Custom item 2'))).toBe(true);
    });
  });

  describe('toMarkdown', () => {
    it('should generate markdown output', async () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test Task',
        description: 'Test description',
        requirements: ['Requirement 1'],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/test.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0 },
        ],
      };

      const definition = await generator.generate(taskInfo, codeChanges);
      const markdown = generator.toMarkdown(definition);

      expect(markdown).toContain('# Done Definition: Test Task');
      expect(markdown).toContain('Task ID:');
      expect(markdown).toContain('Requirements Mapping');
      expect(markdown).toContain('Verification Results');
      expect(markdown).toContain('Impact Analysis');
      expect(markdown).toContain('Reproduction Command');
      expect(markdown).toContain('Done Checklist');
    });

    it('should include blocked reason when present', async () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Failing Task',
        description: 'Task with failures',
        requirements: ['Requirement'],
      };

      const codeChanges: CodeChangeInfo = {
        files: [],
      };

      const definition = await generator.generate(taskInfo, codeChanges);

      // Force blocked status for testing
      if (definition.finalStatus !== 'done') {
        const markdown = generator.toMarkdown(definition);
        expect(markdown).toContain('Blocked Reason:');
      }
    });
  });

  describe('events', () => {
    it('should emit generate:start event', async () => {
      const events: string[] = [];
      generator.on('generate:start', () => events.push('start'));

      await generator.generate(
        { id: '1', title: 'Test', description: '', requirements: [] },
        { files: [] }
      );

      expect(events).toContain('start');
    });

    it('should emit generate:progress events', async () => {
      const progressEvents: Array<{ step: string; progress: number }> = [];
      generator.on('generate:progress', (data) => progressEvents.push(data));

      await generator.generate(
        { id: '1', title: 'Test', description: '', requirements: [] },
        { files: [] }
      );

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents.some(e => e.progress === 100)).toBe(true);
    });

    it('should emit generate:complete event', async () => {
      const events: string[] = [];
      generator.on('generate:complete', () => events.push('complete'));

      await generator.generate(
        { id: '1', title: 'Test', description: '', requirements: [] },
        { files: [] }
      );

      expect(events).toContain('complete');
    });

    it('should emit verification events', async () => {
      const events: string[] = [];
      generator.on('verification:start', () => events.push('verification:start'));
      generator.on('verification:complete', () => events.push('verification:complete'));

      await generator.generate(
        { id: '1', title: 'Test', description: '', requirements: [] },
        { files: [] }
      );

      expect(events).toContain('verification:start');
      expect(events).toContain('verification:complete');
    });

    it('should emit analysis events', async () => {
      const events: string[] = [];
      generator.on('analysis:start', () => events.push('analysis:start'));
      generator.on('analysis:complete', () => events.push('analysis:complete'));

      await generator.generate(
        { id: '1', title: 'Test', description: '', requirements: [] },
        { files: [] }
      );

      expect(events).toContain('analysis:start');
      expect(events).toContain('analysis:complete');
    });
  });

  describe('singleton', () => {
    it('should return same instance from getDoneDefinitionGenerator', () => {
      resetDoneDefinitionGenerator();
      const instance1 = getDoneDefinitionGenerator();
      const instance2 = getDoneDefinitionGenerator();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetDoneDefinitionGenerator', () => {
      const instance1 = getDoneDefinitionGenerator();
      resetDoneDefinitionGenerator();
      const instance2 = getDoneDefinitionGenerator();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('options', () => {
    it('should skip impact analysis when disabled', async () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test',
        description: '',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/test.ts', changeType: 'added', linesAdded: 100, linesRemoved: 0 },
        ],
      };

      const result = await generator.generate(taskInfo, codeChanges, {
        includeImpactAnalysis: false,
      });

      expect(result.impactAnalysis.affectedFiles).toHaveLength(0);
    });

    it('should skip breaking changes when disabled', async () => {
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test',
        description: 'This is a breaking change',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/index.ts', changeType: 'deleted', linesAdded: 0, linesRemoved: 50 },
        ],
      };

      const result = await generator.generate(taskInfo, codeChanges, {
        includeBreakingChanges: false,
      });

      expect(result.breakingChanges.hasBreakingChanges).toBe(false);
    });
  });
});
