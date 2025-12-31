/**
 * VerificationReportGenerator Tests
 *
 * Tests for verification report generation, objectives mapping,
 * risk assessment, and rollback plan generation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  VerificationReportGenerator,
  VerificationReport,
  VerificationReportInput,
  VerificationReportOptions,
  ObjectiveAchievement,
  VerificationItem,
  IntentionalOmission,
  RemainingRisk,
  RollbackPlan,
  getVerificationReportGenerator,
  resetVerificationReportGenerator,
} from '../../src/quality/verification-report.js';
import {
  DoneDefinition,
  DoneDefinitionGenerator,
  TaskInfo,
  CodeChangeInfo,
} from '../../src/quality/done-definition.js';

describe('VerificationReportGenerator', () => {
  let generator: VerificationReportGenerator;

  beforeEach(() => {
    resetVerificationReportGenerator();
    generator = new VerificationReportGenerator();
  });

  afterEach(() => {
    resetVerificationReportGenerator();
  });

  describe('initialization', () => {
    it('should create instance with default config', () => {
      expect(generator).toBeInstanceOf(VerificationReportGenerator);
    });

    it('should create instance with custom config', () => {
      const customGenerator = new VerificationReportGenerator({
        agents: { maxConcurrent: 10, timeoutMs: 600000 },
      });
      expect(customGenerator).toBeInstanceOf(VerificationReportGenerator);
    });
  });

  describe('generate', () => {
    const sampleInput: VerificationReportInput = {
      taskId: 'task-001',
      title: 'Implement user authentication',
      objectives: [
        'Implement login functionality',
        'Add password hashing',
        'Create session management',
      ],
      achievements: [
        'Login implemented with JWT tokens',
        'bcrypt password hashing added',
        'Redis-based session management created',
      ],
    };

    it('should generate verification report', async () => {
      const result = await generator.generate(sampleInput);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.taskId).toBe(sampleInput.taskId);
      expect(result.title).toBe(sampleInput.title);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should include objectives and achievements', async () => {
      const result = await generator.generate(sampleInput);

      expect(result.objectivesAndAchievements).toBeDefined();
      expect(result.objectivesAndAchievements.length).toBe(3);

      const first = result.objectivesAndAchievements[0];
      expect(first.objective).toBe(sampleInput.objectives[0]);
      expect(first.achievement).toBe(sampleInput.achievements[0]);
      expect(first.status).toBe('achieved');
    });

    it('should mark objectives without achievements as not_achieved', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: ['Objective 1', 'Objective 2'],
        achievements: ['Achievement 1'], // Only one achievement
      };

      const result = await generator.generate(input);

      expect(result.objectivesAndAchievements[0].status).toBe('achieved');
      expect(result.objectivesAndAchievements[1].status).toBe('not_achieved');
    });

    it('should include intentional omissions', async () => {
      const input: VerificationReportInput = {
        ...sampleInput,
        omissions: [
          { description: 'OAuth integration', reason: 'Deferred to Phase 2', plannedFor: 'v2.0' },
          { description: 'MFA support', reason: 'Not in scope' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.intentionalOmissions).toBeDefined();
      expect(result.intentionalOmissions.length).toBe(2);
      expect(result.intentionalOmissions[0].description).toBe('OAuth integration');
      expect(result.intentionalOmissions[0].reason).toBe('Deferred to Phase 2');
      expect(result.intentionalOmissions[0].plannedFor).toBe('v2.0');
    });

    it('should include remaining risks', async () => {
      const input: VerificationReportInput = {
        ...sampleInput,
        risks: [
          { description: 'Session timeout handling', severity: 'medium', mitigation: 'Add timeout warning' },
          { description: 'Rate limiting not implemented', severity: 'high' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.remainingRisks).toBeDefined();
      expect(result.remainingRisks.length).toBe(2);
      expect(result.remainingRisks[0].description).toBe('Session timeout handling');
      expect(result.remainingRisks[0].severity).toBe('medium');
      expect(result.remainingRisks[1].severity).toBe('high');
    });

    it('should include custom verifications', async () => {
      const input: VerificationReportInput = {
        ...sampleInput,
        customVerifications: [
          { category: 'manual', description: 'Manual login test', result: 'passed' },
          { category: 'integration', description: 'API integration test', result: 'passed' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.verificationItems).toBeDefined();
      expect(result.verificationItems.some(v => v.description === 'Manual login test')).toBe(true);
    });

    it('should generate rollback plan by default', async () => {
      const result = await generator.generate(sampleInput);

      expect(result.rollbackPlan).toBeDefined();
      expect(result.rollbackPlan.canRollback).toBe(true);
      expect(result.rollbackPlan.steps.length).toBeGreaterThan(0);
    });

    it('should skip rollback plan when disabled', async () => {
      const result = await generator.generate(sampleInput, {
        includeRollbackPlan: false,
      });

      expect(result.rollbackPlan.canRollback).toBe(false);
      expect(result.rollbackPlan.steps.length).toBe(0);
    });

    it('should use provided author', async () => {
      const result = await generator.generate(sampleInput, {
        author: 'Test Author',
      });

      expect(result.author).toBe('Test Author');
    });

    it('should include additional notes', async () => {
      const result = await generator.generate(sampleInput, {
        additionalNotes: 'This is a test note',
      });

      expect(result.additionalNotes).toBe('This is a test note');
    });

    it('should include attachments', async () => {
      const result = await generator.generate(sampleInput, {
        attachments: ['screenshot.png', 'log.txt'],
      });

      expect(result.attachments).toEqual(['screenshot.png', 'log.txt']);
    });

    it('should generate summary', async () => {
      const result = await generator.generate(sampleInput);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });

  describe('generateFromDoneDefinition', () => {
    it('should generate report from DoneDefinition', async () => {
      const doneGenerator = new DoneDefinitionGenerator();
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test Task',
        description: 'Test description',
        requirements: ['Requirement 1', 'Requirement 2'],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/test.ts', changeType: 'added', linesAdded: 50, linesRemoved: 0 },
        ],
      };

      const doneDefinition = await doneGenerator.generate(taskInfo, codeChanges);
      const result = await generator.generateFromDoneDefinition(doneDefinition, {
        objectives: taskInfo.requirements,
        achievements: ['Implemented requirement 1', 'Implemented requirement 2'],
      });

      expect(result).toBeDefined();
      expect(result.taskId).toBe(doneDefinition.taskId);
      expect(result.objectivesAndAchievements.length).toBeGreaterThan(0);
    });

    it('should map requirements to objectives', async () => {
      const doneGenerator = new DoneDefinitionGenerator();
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test Task',
        description: 'Test description',
        requirements: ['Create new feature'],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'src/feature.ts', changeType: 'added', linesAdded: 100, linesRemoved: 0 },
        ],
      };

      const doneDefinition = await doneGenerator.generate(taskInfo, codeChanges);
      const result = await generator.generateFromDoneDefinition(doneDefinition, {});

      expect(result.objectivesAndAchievements[0].objective).toBe('Create new feature');
    });

    it('should include verification items from DoneDefinition', async () => {
      const doneGenerator = new DoneDefinitionGenerator();
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test Task',
        description: 'Test',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [],
      };

      const doneDefinition = await doneGenerator.generate(taskInfo, codeChanges);
      const result = await generator.generateFromDoneDefinition(doneDefinition, {});

      expect(result.verificationItems.some(v => v.category === 'build')).toBe(true);
      expect(result.verificationItems.some(v => v.category === 'lint')).toBe(true);
    });

    it('should include risks from impact analysis', async () => {
      const doneGenerator = new DoneDefinitionGenerator();
      const taskInfo: TaskInfo = {
        id: 'task-001',
        title: 'Test Task',
        description: 'Test',
        requirements: [],
      };

      const codeChanges: CodeChangeInfo = {
        files: [
          { path: 'package.json', changeType: 'modified', linesAdded: 10, linesRemoved: 5 },
          { path: 'src/api/endpoint.ts', changeType: 'deleted', linesAdded: 0, linesRemoved: 100 },
        ],
      };

      const doneDefinition = await doneGenerator.generate(taskInfo, codeChanges);
      const result = await generator.generateFromDoneDefinition(doneDefinition, {});

      // Should have risks from impact analysis and breaking changes
      expect(result.remainingRisks.length).toBeGreaterThan(0);
    });
  });

  describe('toMarkdown', () => {
    it('should generate markdown output', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test Report',
        objectives: ['Objective 1'],
        achievements: ['Achievement 1'],
      };

      const report = await generator.generate(input);
      const markdown = generator.toMarkdown(report);

      expect(markdown).toContain('# Verification Report: Test Report');
      expect(markdown).toContain('Task ID:');
      expect(markdown).toContain('Summary');
      expect(markdown).toContain('Objectives and Achievements');
      expect(markdown).toContain('Verification Items');
    });

    it('should include objectives table', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test Report',
        objectives: ['Objective 1', 'Objective 2'],
        achievements: ['Achievement 1', 'Achievement 2'],
      };

      const report = await generator.generate(input);
      const markdown = generator.toMarkdown(report);

      expect(markdown).toContain('| Objective | Achievement | Status |');
      expect(markdown).toContain('Objective 1');
      expect(markdown).toContain('Achievement 1');
    });

    it('should include verification items table', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test Report',
        objectives: [],
        achievements: [],
        customVerifications: [
          { category: 'unit_test', description: 'Unit tests', result: 'passed' },
        ],
      };

      const report = await generator.generate(input);
      const markdown = generator.toMarkdown(report);

      expect(markdown).toContain('| Category | Description | Result |');
      expect(markdown).toContain('unit_test');
      expect(markdown).toContain('Unit tests');
    });

    it('should include intentional omissions section when present', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test Report',
        objectives: [],
        achievements: [],
        omissions: [
          { description: 'Feature X', reason: 'Out of scope' },
        ],
      };

      const report = await generator.generate(input);
      const markdown = generator.toMarkdown(report);

      expect(markdown).toContain('## Intentional Omissions');
      expect(markdown).toContain('Feature X');
      expect(markdown).toContain('Out of scope');
    });

    it('should include remaining risks section when present', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test Report',
        objectives: [],
        achievements: [],
        risks: [
          { description: 'Risk 1', severity: 'high', mitigation: 'Mitigation 1' },
        ],
      };

      const report = await generator.generate(input);
      const markdown = generator.toMarkdown(report);

      expect(markdown).toContain('## Remaining Risks');
      expect(markdown).toContain('Risk 1');
      expect(markdown).toContain('high');
      expect(markdown).toContain('Mitigation 1');
    });

    it('should include rollback plan section', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test Report',
        objectives: [],
        achievements: [],
      };

      const report = await generator.generate(input, { includeRollbackPlan: true });
      const markdown = generator.toMarkdown(report);

      expect(markdown).toContain('## Rollback Plan');
      expect(markdown).toContain('Complexity:');
      expect(markdown).toContain('Steps');
    });

    it('should include additional notes when present', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test Report',
        objectives: [],
        achievements: [],
      };

      const report = await generator.generate(input, {
        additionalNotes: 'These are additional notes',
      });
      const markdown = generator.toMarkdown(report);

      expect(markdown).toContain('## Additional Notes');
      expect(markdown).toContain('These are additional notes');
    });

    it('should include attachments when present', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test Report',
        objectives: [],
        achievements: [],
      };

      const report = await generator.generate(input, {
        attachments: ['file1.png', 'file2.pdf'],
      });
      const markdown = generator.toMarkdown(report);

      expect(markdown).toContain('## Attachments');
      expect(markdown).toContain('file1.png');
      expect(markdown).toContain('file2.pdf');
    });
  });

  describe('verification item mapping', () => {
    it('should map category strings correctly', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
        customVerifications: [
          { category: 'unit', description: 'Test 1', result: 'passed' },
          { category: 'integration', description: 'Test 2', result: 'passed' },
          { category: 'manual', description: 'Test 3', result: 'passed' },
          { category: 'review', description: 'Test 4', result: 'passed' },
          { category: 'unknown', description: 'Test 5', result: 'passed' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.verificationItems.find(v => v.description === 'Test 1')?.category).toBe('unit_test');
      expect(result.verificationItems.find(v => v.description === 'Test 2')?.category).toBe('integration_test');
      expect(result.verificationItems.find(v => v.description === 'Test 3')?.category).toBe('manual_test');
      expect(result.verificationItems.find(v => v.description === 'Test 4')?.category).toBe('code_review');
      expect(result.verificationItems.find(v => v.description === 'Test 5')?.category).toBe('other');
    });

    it('should map result strings correctly', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
        customVerifications: [
          { category: 'unit', description: 'Test 1', result: 'pass' },
          { category: 'unit', description: 'Test 2', result: 'fail' },
          { category: 'unit', description: 'Test 3', result: 'skip' },
          { category: 'unit', description: 'Test 4', result: 'na' },
          { category: 'unit', description: 'Test 5', result: 'unknown' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.verificationItems.find(v => v.description === 'Test 1')?.result).toBe('passed');
      expect(result.verificationItems.find(v => v.description === 'Test 2')?.result).toBe('failed');
      expect(result.verificationItems.find(v => v.description === 'Test 3')?.result).toBe('skipped');
      expect(result.verificationItems.find(v => v.description === 'Test 4')?.result).toBe('not_applicable');
      expect(result.verificationItems.find(v => v.description === 'Test 5')?.result).toBe('not_applicable');
    });
  });

  describe('priority inference', () => {
    it('should infer high priority for security-related omissions', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
        omissions: [
          { description: 'Security hardening', reason: 'Deferred' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.intentionalOmissions[0].priority).toBe('high');
    });

    it('should infer medium priority for performance-related omissions', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
        omissions: [
          { description: 'Performance optimization', reason: 'Deferred' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.intentionalOmissions[0].priority).toBe('medium');
    });

    it('should infer low priority for general omissions', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
        omissions: [
          { description: 'Additional logging', reason: 'Nice to have' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.intentionalOmissions[0].priority).toBe('low');
    });
  });

  describe('events', () => {
    it('should emit report:start event', async () => {
      const events: string[] = [];
      generator.on('report:start', () => events.push('start'));

      await generator.generate({
        taskId: '1',
        title: 'Test',
        objectives: [],
        achievements: [],
      });

      expect(events).toContain('start');
    });

    it('should emit report:progress events', async () => {
      const progressEvents: Array<{ step: string; progress: number }> = [];
      generator.on('report:progress', (data) => progressEvents.push(data));

      await generator.generate({
        taskId: '1',
        title: 'Test',
        objectives: [],
        achievements: [],
      });

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents.some(e => e.progress === 100)).toBe(true);
    });

    it('should emit report:complete event', async () => {
      const events: string[] = [];
      generator.on('report:complete', () => events.push('complete'));

      await generator.generate({
        taskId: '1',
        title: 'Test',
        objectives: [],
        achievements: [],
      });

      expect(events).toContain('complete');
    });
  });

  describe('singleton', () => {
    it('should return same instance from getVerificationReportGenerator', () => {
      resetVerificationReportGenerator();
      const instance1 = getVerificationReportGenerator();
      const instance2 = getVerificationReportGenerator();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetVerificationReportGenerator', () => {
      const instance1 = getVerificationReportGenerator();
      resetVerificationReportGenerator();
      const instance2 = getVerificationReportGenerator();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('rollback plan generation', () => {
    it('should generate basic rollback steps', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
      };

      const result = await generator.generate(input);

      expect(result.rollbackPlan.steps.length).toBeGreaterThan(0);
      expect(result.rollbackPlan.steps[0].order).toBe(1);
      expect(result.rollbackPlan.steps[0].description).toBeDefined();
    });

    it('should include prerequisites', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
      };

      const result = await generator.generate(input);

      expect(result.rollbackPlan.prerequisites.length).toBeGreaterThan(0);
    });

    it('should estimate total duration', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
      };

      const result = await generator.generate(input);

      expect(result.rollbackPlan.estimatedTotalDuration).toBeDefined();
      expect(result.rollbackPlan.estimatedTotalDuration).toContain('minute');
    });
  });

  describe('summary generation', () => {
    it('should include objective count in summary', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: ['Obj 1', 'Obj 2', 'Obj 3'],
        achievements: ['Ach 1', 'Ach 2'],
      };

      const result = await generator.generate(input);

      expect(result.summary).toContain('2/3');
    });

    it('should mention high risks in summary', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: [],
        achievements: [],
        risks: [
          { description: 'Critical risk', severity: 'critical' },
          { description: 'High risk', severity: 'high' },
        ],
      };

      const result = await generator.generate(input);

      expect(result.summary).toContain('2');
      expect(result.summary.toLowerCase()).toContain('risk');
    });

    it('should indicate no critical risks when none exist', async () => {
      const input: VerificationReportInput = {
        taskId: 'task-001',
        title: 'Test',
        objectives: ['Obj'],
        achievements: ['Ach'],
      };

      const result = await generator.generate(input);

      expect(result.summary.toLowerCase()).toContain('no critical risk');
    });
  });
});
