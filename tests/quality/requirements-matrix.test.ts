/**
 * RequirementsMatrix Integration Tests
 *
 * Tests for requirements traceability, verification management, and export
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  RequirementsManager,
  Requirement,
  VerificationStatus,
  RequirementPriority,
  RequirementCategory,
  RequirementsMatrix,
  getRequirementsManager,
  resetRequirementsManager,
  createRequirement,
} from '../../src/quality/requirements-matrix.js';

describe('RequirementsManager', () => {
  let manager: RequirementsManager;

  beforeEach(() => {
    resetRequirementsManager();
    manager = RequirementsManager.getInstance();
    manager.clear();
  });

  afterEach(() => {
    resetRequirementsManager();
  });

  // ========================================
  // Singleton Tests
  // ========================================

  describe('singleton pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = RequirementsManager.getInstance();
      const instance2 = RequirementsManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should reset the instance correctly', () => {
      const instance1 = RequirementsManager.getInstance();
      RequirementsManager.resetInstance();
      const instance2 = RequirementsManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });

    it('should provide instance via convenience function', () => {
      const instance1 = getRequirementsManager();
      const instance2 = RequirementsManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  // ========================================
  // Requirement CRUD Tests
  // ========================================

  describe('requirement CRUD operations', () => {
    it('should add a new requirement', () => {
      const req = createRequirement('REQ-001', 'User authentication');

      const added = manager.addRequirement(req);

      expect(added.id).toBe('REQ-001');
      expect(added.description).toBe('User authentication');
      expect(added.createdAt).toBeInstanceOf(Date);
      expect(added.updatedAt).toBeInstanceOf(Date);
      expect(manager.count).toBe(1);
    });

    it('should throw when adding duplicate requirement id', () => {
      const req = createRequirement('REQ-001', 'User authentication');
      manager.addRequirement(req);

      expect(() => manager.addRequirement(req)).toThrow(
        'Requirement with id "REQ-001" already exists'
      );
    });

    it('should get a requirement by id', () => {
      const req = createRequirement('REQ-001', 'User authentication');
      manager.addRequirement(req);

      const retrieved = manager.getRequirement('REQ-001');

      expect(retrieved).toBeDefined();
      expect(retrieved?.description).toBe('User authentication');
    });

    it('should return undefined for non-existent requirement', () => {
      const retrieved = manager.getRequirement('NON-EXISTENT');

      expect(retrieved).toBeUndefined();
    });

    it('should update a requirement', () => {
      const req = createRequirement('REQ-001', 'User authentication');
      manager.addRequirement(req);

      const updated = manager.updateRequirement('REQ-001', {
        description: 'Updated authentication',
        priority: 'high',
      });

      expect(updated.description).toBe('Updated authentication');
      expect(updated.priority).toBe('high');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        updated.createdAt.getTime()
      );
    });

    it('should throw when updating non-existent requirement', () => {
      expect(() =>
        manager.updateRequirement('NON-EXISTENT', { description: 'Test' })
      ).toThrow('Requirement with id "NON-EXISTENT" not found');
    });

    it('should remove a requirement', () => {
      const req = createRequirement('REQ-001', 'User authentication');
      manager.addRequirement(req);

      const removed = manager.removeRequirement('REQ-001');

      expect(removed).toBe(true);
      expect(manager.count).toBe(0);
      expect(manager.getRequirement('REQ-001')).toBeUndefined();
    });

    it('should return false when removing non-existent requirement', () => {
      const removed = manager.removeRequirement('NON-EXISTENT');

      expect(removed).toBe(false);
    });

    it('should get all requirements', () => {
      manager.addRequirement(createRequirement('REQ-001', 'Requirement 1'));
      manager.addRequirement(createRequirement('REQ-002', 'Requirement 2'));
      manager.addRequirement(createRequirement('REQ-003', 'Requirement 3'));

      const all = manager.getAllRequirements();

      expect(all).toHaveLength(3);
    });

    it('should clear all requirements', () => {
      manager.addRequirement(createRequirement('REQ-001', 'Requirement 1'));
      manager.addRequirement(createRequirement('REQ-002', 'Requirement 2'));

      manager.clear();

      expect(manager.count).toBe(0);
    });
  });

  // ========================================
  // Filtering Tests
  // ========================================

  describe('requirement filtering', () => {
    beforeEach(() => {
      manager.addRequirement(
        createRequirement('REQ-001', 'Authentication', {
          priority: 'high',
          category: 'security',
          tags: ['auth', 'login'],
        })
      );
      manager.addRequirement(
        createRequirement('REQ-002', 'Performance optimization', {
          priority: 'medium',
          category: 'performance',
          tags: ['speed', 'cache'],
        })
      );
      manager.addRequirement(
        createRequirement('REQ-003', 'User interface', {
          priority: 'low',
          category: 'usability',
          tags: ['ui', 'design'],
        })
      );

      // Mark one as verified
      manager.markAsVerified('REQ-001', 'Test passed');
    });

    it('should filter by status', () => {
      const verified = manager.filterRequirements({ status: 'verified' });
      const pending = manager.filterRequirements({ status: 'pending' });

      expect(verified).toHaveLength(1);
      expect(verified[0].id).toBe('REQ-001');
      expect(pending).toHaveLength(2);
    });

    it('should filter by priority', () => {
      const highPriority = manager.filterRequirements({ priority: 'high' });
      const mediumPriority = manager.filterRequirements({ priority: 'medium' });

      expect(highPriority).toHaveLength(1);
      expect(highPriority[0].id).toBe('REQ-001');
      expect(mediumPriority).toHaveLength(1);
      expect(mediumPriority[0].id).toBe('REQ-002');
    });

    it('should filter by category', () => {
      const security = manager.filterRequirements({ category: 'security' });
      const performance = manager.filterRequirements({ category: 'performance' });

      expect(security).toHaveLength(1);
      expect(security[0].id).toBe('REQ-001');
      expect(performance).toHaveLength(1);
      expect(performance[0].id).toBe('REQ-002');
    });

    it('should filter by tags', () => {
      const authTag = manager.filterRequirements({ tags: ['auth'] });
      const uiTag = manager.filterRequirements({ tags: ['ui'] });
      const multiTag = manager.filterRequirements({ tags: ['auth', 'speed'] });

      expect(authTag).toHaveLength(1);
      expect(authTag[0].id).toBe('REQ-001');
      expect(uiTag).toHaveLength(1);
      expect(uiTag[0].id).toBe('REQ-003');
      expect(multiTag).toHaveLength(2); // OR logic for tags
    });

    it('should filter by search text', () => {
      const authSearch = manager.filterRequirements({ searchText: 'auth' });
      const perfSearch = manager.filterRequirements({ searchText: 'performance' });

      expect(authSearch).toHaveLength(1);
      expect(authSearch[0].id).toBe('REQ-001');
      expect(perfSearch).toHaveLength(1);
      expect(perfSearch[0].id).toBe('REQ-002');
    });

    it('should combine multiple filters', () => {
      const combined = manager.filterRequirements({
        priority: 'high',
        category: 'security',
      });

      expect(combined).toHaveLength(1);
      expect(combined[0].id).toBe('REQ-001');
    });
  });

  // ========================================
  // Acceptance Criteria Tests
  // ========================================

  describe('acceptance criteria management', () => {
    it('should generate acceptance criteria for functional requirements', () => {
      const criteria = manager.generateAcceptanceCriteria(
        'ユーザーがログイン機能を使用できる'
      );

      expect(criteria.length).toBeGreaterThan(0);
      expect(criteria.some((c) => c.includes('Given'))).toBe(true);
    });

    it('should generate acceptance criteria for performance requirements', () => {
      const criteria = manager.generateAcceptanceCriteria(
        'システムは高速な性能を維持する必要がある'
      );

      expect(criteria.length).toBeGreaterThan(0);
      expect(criteria.some((c) => c.includes('処理') || c.includes('時間'))).toBe(true);
    });

    it('should generate acceptance criteria for security requirements', () => {
      const criteria = manager.generateAcceptanceCriteria(
        'セキュリティ認証が必要です'
      );

      expect(criteria.length).toBeGreaterThan(0);
      expect(criteria.some((c) => c.includes('認証') || c.includes('機密'))).toBe(true);
    });

    it('should add acceptance criteria to existing requirement', () => {
      const req = createRequirement('REQ-001', 'Test requirement', {
        acceptanceCriteria: ['Initial criterion'],
      });
      manager.addRequirement(req);

      const updated = manager.addAcceptanceCriteria('REQ-001', [
        'New criterion 1',
        'New criterion 2',
      ]);

      expect(updated.acceptanceCriteria).toHaveLength(3);
      expect(updated.acceptanceCriteria).toContain('Initial criterion');
      expect(updated.acceptanceCriteria).toContain('New criterion 1');
    });
  });

  // ========================================
  // Implementation Linking Tests
  // ========================================

  describe('implementation linking', () => {
    it('should link implementation files to requirement', () => {
      manager.addRequirement(createRequirement('REQ-001', 'Test requirement'));

      const updated = manager.linkImplementation('REQ-001', {
        files: ['src/auth/login.ts', 'src/auth/session.ts'],
        functions: ['authenticate', 'createSession'],
      });

      expect(updated.implementation.files).toHaveLength(2);
      expect(updated.implementation.functions).toHaveLength(2);
      expect(updated.implementation.files).toContain('src/auth/login.ts');
    });

    it('should merge implementation info without duplicates', () => {
      manager.addRequirement(
        createRequirement('REQ-001', 'Test requirement', {
          files: ['src/auth/login.ts'],
          functions: ['authenticate'],
        })
      );

      const updated = manager.linkImplementation('REQ-001', {
        files: ['src/auth/login.ts', 'src/auth/session.ts'], // login.ts is duplicate
        functions: ['createSession'],
      });

      expect(updated.implementation.files).toHaveLength(2); // No duplicate
      expect(updated.implementation.functions).toHaveLength(2);
    });

    it('should find requirements by file path', () => {
      manager.addRequirement(
        createRequirement('REQ-001', 'Auth requirement', {
          files: ['src/auth/login.ts'],
        })
      );
      manager.addRequirement(
        createRequirement('REQ-002', 'Other requirement', {
          files: ['src/other/module.ts'],
        })
      );

      const found = manager.findRequirementsByFile('login.ts');

      expect(found).toHaveLength(1);
      expect(found[0].id).toBe('REQ-001');
    });
  });

  // ========================================
  // Verification Tests
  // ========================================

  describe('verification management', () => {
    beforeEach(() => {
      manager.addRequirement(createRequirement('REQ-001', 'Test requirement'));
    });

    it('should set verification info', () => {
      const updated = manager.setVerification('REQ-001', {
        testFiles: ['tests/auth/login.test.ts'],
        commands: ['npm test -- --grep "login"'],
        automated: true,
      });

      expect(updated.verification.testFiles).toHaveLength(1);
      expect(updated.verification.commands).toHaveLength(1);
      expect(updated.verification.automated).toBe(true);
    });

    it('should record verification result', () => {
      const updated = manager.recordVerificationResult('REQ-001', {
        status: 'verified',
        evidence: 'All tests passed',
        verifiedBy: 'CI Pipeline',
      });

      expect(updated.result.status).toBe('verified');
      expect(updated.result.evidence).toBe('All tests passed');
      expect(updated.result.verifiedAt).toBeInstanceOf(Date);
    });

    it('should mark requirement as verified', () => {
      const updated = manager.markAsVerified('REQ-001', 'Test log', 'tester');

      expect(updated.result.status).toBe('verified');
      expect(updated.result.evidence).toBe('Test log');
      expect(updated.result.verifiedBy).toBe('tester');
    });

    it('should mark requirement as failed', () => {
      const updated = manager.markAsFailed('REQ-001', 'Test failed due to timeout');

      expect(updated.result.status).toBe('failed');
      expect(updated.result.comment).toBe('Test failed due to timeout');
    });

    it('should emit event on verification', () => {
      const listener = vi.fn();
      manager.on('requirement:verified', listener);

      manager.markAsVerified('REQ-001');

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].requirement.id).toBe('REQ-001');
    });
  });

  // ========================================
  // Matrix Generation Tests
  // ========================================

  describe('matrix generation', () => {
    beforeEach(() => {
      manager.setProjectInfo('Test Project', '1.0.0');
      manager.addRequirement(
        createRequirement('REQ-001', 'High priority requirement', {
          priority: 'high',
          category: 'security',
        })
      );
      manager.addRequirement(
        createRequirement('REQ-002', 'Medium priority requirement', {
          priority: 'medium',
          category: 'functional',
        })
      );
      manager.addRequirement(
        createRequirement('REQ-003', 'Low priority requirement', {
          priority: 'low',
          category: 'performance',
        })
      );

      manager.markAsVerified('REQ-001');
      manager.markAsFailed('REQ-002');
    });

    it('should calculate summary correctly', () => {
      const summary = manager.calculateSummary();

      expect(summary.total).toBe(3);
      expect(summary.verified).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.pending).toBe(1);
      expect(summary.coverage).toBe(33); // 1/3 * 100 rounded
    });

    it('should calculate summary by category', () => {
      const summary = manager.calculateSummary();

      expect(summary.byCategory.security).toBe(1);
      expect(summary.byCategory.functional).toBe(1);
      expect(summary.byCategory.performance).toBe(1);
    });

    it('should calculate summary by priority', () => {
      const summary = manager.calculateSummary();

      expect(summary.byPriority.high).toBe(1);
      expect(summary.byPriority.medium).toBe(1);
      expect(summary.byPriority.low).toBe(1);
    });

    it('should generate complete matrix', () => {
      const matrix = manager.generateMatrix();

      expect(matrix.projectName).toBe('Test Project');
      expect(matrix.version).toBe('1.0.0');
      expect(matrix.requirements).toHaveLength(3);
      expect(matrix.summary.total).toBe(3);
      expect(matrix.generatedAt).toBeInstanceOf(Date);
    });
  });

  // ========================================
  // Export Tests
  // ========================================

  describe('export functionality', () => {
    beforeEach(() => {
      manager.setProjectInfo('Test Project', '1.0.0');
      manager.addRequirement(
        createRequirement('REQ-001', 'Test requirement', {
          priority: 'high',
          category: 'functional',
          acceptanceCriteria: ['AC1', 'AC2'],
          files: ['src/test.ts'],
          functions: ['testFunc'],
          testFiles: ['tests/test.test.ts'],
        })
      );
      manager.markAsVerified('REQ-001', 'Evidence', 'Tester');
    });

    it('should export to YAML format', () => {
      const yaml = manager.exportToYaml();

      expect(yaml).toContain('projectName: Test Project');
      // Version may or may not have quotes depending on YAML serializer
      expect(yaml).toMatch(/version:\s*["']?1\.0\.0["']?/);
      expect(yaml).toContain('REQ-001');
      expect(yaml).toContain('Test requirement');
    });

    it('should export to Markdown format', () => {
      const markdown = manager.exportToMarkdown();

      expect(markdown).toContain('# 要件トレーサビリティマトリクス');
      expect(markdown).toContain('**プロジェクト:** Test Project');
      expect(markdown).toContain('REQ-001: Test requirement');
      expect(markdown).toContain('[x] verified'); // Status emoji
    });

    it('should include summary in Markdown export', () => {
      const markdown = manager.exportToMarkdown();

      expect(markdown).toContain('## サマリー');
      expect(markdown).toContain('| 総要件数 | 1 |');
      expect(markdown).toContain('| 検証済み | 1 |');
    });

    it('should include implementation details in Markdown', () => {
      const markdown = manager.exportToMarkdown();

      expect(markdown).toContain('#### 実装');
      expect(markdown).toContain('`src/test.ts`');
      expect(markdown).toContain('`testFunc`');
    });
  });

  // ========================================
  // File I/O Tests
  // ========================================

  describe('file I/O operations', () => {
    const testOutputDir = '/tmp/aidos-test-requirements';
    const testFilePath = path.join(testOutputDir, 'test-requirements.yaml');

    beforeEach(async () => {
      manager.setProjectInfo('Test Project', '1.0.0');
      manager.updateOptions({
        requirementsFilePath: testFilePath,
        outputDirectory: testOutputDir,
      });
      manager.addRequirement(
        createRequirement('REQ-001', 'Test requirement', {
          priority: 'high',
        })
      );
    });

    afterEach(async () => {
      // Cleanup test files
      try {
        await fs.rm(testOutputDir, { recursive: true, force: true });
      } catch {
        // Ignore errors
      }
    });

    it('should save to YAML file', async () => {
      await manager.saveToFile();

      const content = await fs.readFile(testFilePath, 'utf-8');
      expect(content).toContain('projectName: Test Project');
      expect(content).toContain('REQ-001');
    });

    it('should load from YAML file', async () => {
      await manager.saveToFile();

      // Reset and reload
      manager.clear();
      expect(manager.count).toBe(0);

      await manager.loadFromFile();

      expect(manager.count).toBe(1);
      const req = manager.getRequirement('REQ-001');
      expect(req?.description).toBe('Test requirement');
    });

    it('should save Markdown file', async () => {
      const mdPath = path.join(testOutputDir, 'requirements-matrix.md');
      await manager.saveToMarkdown(mdPath);

      const content = await fs.readFile(mdPath, 'utf-8');
      expect(content).toContain('# 要件トレーサビリティマトリクス');
    });

    it('should emit event on export', async () => {
      const listener = vi.fn();
      manager.on('matrix:exported', listener);

      const mdPath = path.join(testOutputDir, 'requirements-matrix.md');
      await manager.saveToMarkdown(mdPath);

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].format).toBe('markdown');
    });

    it('should emit event on import', async () => {
      await manager.saveToFile();

      const listener = vi.fn();
      manager.on('matrix:imported', listener);

      manager.clear();
      await manager.loadFromFile();

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].count).toBe(1);
    });
  });

  // ========================================
  // Event Tests
  // ========================================

  describe('event emission', () => {
    it('should emit event on requirement added', () => {
      const listener = vi.fn();
      manager.on('requirement:added', listener);

      manager.addRequirement(createRequirement('REQ-001', 'Test'));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].requirement.id).toBe('REQ-001');
    });

    it('should emit event on requirement updated', () => {
      manager.addRequirement(createRequirement('REQ-001', 'Test'));

      const listener = vi.fn();
      manager.on('requirement:updated', listener);

      manager.updateRequirement('REQ-001', { description: 'Updated' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].changes.description).toBe('Updated');
    });

    it('should emit event on requirement removed', () => {
      manager.addRequirement(createRequirement('REQ-001', 'Test'));

      const listener = vi.fn();
      manager.on('requirement:removed', listener);

      manager.removeRequirement('REQ-001');

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // Helper Function Tests
  // ========================================

  describe('createRequirement helper', () => {
    it('should create requirement with default values', () => {
      const req = createRequirement('REQ-001', 'Test requirement');

      expect(req.id).toBe('REQ-001');
      expect(req.description).toBe('Test requirement');
      expect(req.priority).toBe('medium');
      expect(req.category).toBe('functional');
      expect(req.acceptanceCriteria).toEqual([]);
      expect(req.result.status).toBe('pending');
    });

    it('should create requirement with custom values', () => {
      const req = createRequirement('REQ-001', 'Security requirement', {
        priority: 'critical',
        category: 'security',
        acceptanceCriteria: ['AC1', 'AC2'],
        files: ['src/auth.ts'],
        functions: ['authenticate'],
        testFiles: ['tests/auth.test.ts'],
        commands: ['npm test'],
        tags: ['security', 'auth'],
      });

      expect(req.priority).toBe('critical');
      expect(req.category).toBe('security');
      expect(req.acceptanceCriteria).toHaveLength(2);
      expect(req.implementation.files).toContain('src/auth.ts');
      expect(req.verification.testFiles).toContain('tests/auth.test.ts');
      expect(req.verification.automated).toBe(true);
      expect(req.tags).toContain('security');
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('edge cases', () => {
    it('should handle empty requirements list', () => {
      const summary = manager.calculateSummary();

      expect(summary.total).toBe(0);
      expect(summary.coverage).toBe(0);
    });

    it('should handle requirements with no implementation', () => {
      manager.addRequirement(createRequirement('REQ-001', 'Empty implementation'));

      const markdown = manager.exportToMarkdown();

      expect(markdown).not.toContain('#### 実装');
    });

    it('should handle requirements with no verification', () => {
      manager.addRequirement(createRequirement('REQ-001', 'No verification'));

      const markdown = manager.exportToMarkdown();

      expect(markdown).not.toContain('#### 検証');
    });

    it('should preserve dates during serialization/deserialization', async () => {
      const testOutputDir = '/tmp/aidos-test-dates';
      const testFilePath = path.join(testOutputDir, 'dates-test.yaml');

      manager.updateOptions({ requirementsFilePath: testFilePath });
      manager.addRequirement(createRequirement('REQ-001', 'Date test'));
      manager.markAsVerified('REQ-001');

      const originalReq = manager.getRequirement('REQ-001');
      await manager.saveToFile();

      manager.clear();
      await manager.loadFromFile();

      const loadedReq = manager.getRequirement('REQ-001');

      expect(loadedReq?.createdAt).toBeInstanceOf(Date);
      expect(loadedReq?.result.verifiedAt).toBeInstanceOf(Date);

      // Cleanup
      await fs.rm(testOutputDir, { recursive: true, force: true });
    });
  });
});
