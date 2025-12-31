/**
 * ConfigManager Integration Tests
 *
 * Tests for config loading, validation, and management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ConfigManager,
  ConfigError,
  ConfigValidationResult,
  ConfigSource,
  getConfigManager,
  resetConfigManager,
  findConfigFile,
  initializeConfig,
} from '../../src/config/config-manager.js';
import { AidosConfig, DEFAULT_CONFIG } from '../../src/types.js';

describe('ConfigManager', () => {
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(() => {
    tempDir = join(tmpdir(), `aidos-config-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    resetConfigManager();
    configManager = new ConfigManager();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    resetConfigManager();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const config = configManager.getConfig();

      expect(config.api.provider).toBe('anthropic');
      expect(config.api.model).toBeDefined();
      expect(config.agents.maxConcurrent).toBeGreaterThan(0);
    });

    it('should accept initial config overrides', () => {
      const manager = new ConfigManager({
        api: { provider: 'anthropic', model: 'custom-model', maxTokens: 8192 },
      });
      const config = manager.getConfig();

      expect(config.api.model).toBe('custom-model');
      expect(config.api.maxTokens).toBe(8192);
    });

    it('should return deep clone of config', () => {
      const config1 = configManager.getConfig();
      const config2 = configManager.getConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('get and set', () => {
    it('should get nested config value by path', () => {
      const model = configManager.get<string>('api.model');
      expect(model).toBe(DEFAULT_CONFIG.api.model);
    });

    it('should return undefined for non-existent path', () => {
      const value = configManager.get('non.existent.path');
      expect(value).toBeUndefined();
    });

    it('should set nested config value by path', () => {
      configManager.set('api.model', 'new-model');
      const model = configManager.get<string>('api.model');
      expect(model).toBe('new-model');
    });

    it('should emit config:changed event on set', () => {
      const events: string[] = [];
      configManager.on('config:changed', () => events.push('changed'));

      configManager.set('api.model', 'new-model');

      expect(events).toContain('changed');
    });

    it('should track origin as runtime for set values', () => {
      configManager.set('api.model', 'new-model');
      const origin = configManager.getOrigin('api.model');

      expect(origin?.source).toBe('runtime');
      expect(origin?.value).toBe('new-model');
    });
  });

  describe('loadFromFile - YAML', () => {
    it('should load config from YAML file', async () => {
      const configPath = join(tempDir, 'config.yaml');
      const yamlContent = `
api:
  model: yaml-model
  maxTokens: 2048
agents:
  maxConcurrent: 10
`;
      writeFileSync(configPath, yamlContent);

      await configManager.loadFromFile(configPath);
      const config = configManager.getConfig();

      expect(config.api.model).toBe('yaml-model');
      expect(config.api.maxTokens).toBe(2048);
      expect(config.agents.maxConcurrent).toBe(10);
    });

    it('should load config from .yml file', async () => {
      const configPath = join(tempDir, 'config.yml');
      const yamlContent = `
api:
  model: yml-model
`;
      writeFileSync(configPath, yamlContent);

      await configManager.loadFromFile(configPath);
      const config = configManager.getConfig();

      expect(config.api.model).toBe('yml-model');
    });

    it('should emit config:loaded event', async () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(configPath, 'api:\n  model: test\n');

      const events: string[] = [];
      configManager.on('config:loaded', () => events.push('loaded'));

      await configManager.loadFromFile(configPath);

      expect(events).toContain('loaded');
    });

    it('should track origin as file for loaded values', async () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(configPath, 'api:\n  model: file-model\n');

      await configManager.loadFromFile(configPath);
      const origin = configManager.getOrigin('api.model');

      expect(origin?.source).toBe('file');
    });
  });

  describe('loadFromFile - JSON', () => {
    it('should load config from JSON file', async () => {
      const configPath = join(tempDir, 'config.json');
      const jsonContent = JSON.stringify({
        api: { model: 'json-model', maxTokens: 4096 },
      });
      writeFileSync(configPath, jsonContent);

      await configManager.loadFromFile(configPath);
      const config = configManager.getConfig();

      expect(config.api.model).toBe('json-model');
      expect(config.api.maxTokens).toBe(4096);
    });
  });

  describe('loadFromFile - errors', () => {
    it('should throw error for unsupported file format', async () => {
      const configPath = join(tempDir, 'config.txt');
      writeFileSync(configPath, 'invalid');

      await expect(configManager.loadFromFile(configPath)).rejects.toThrow(
        ConfigError
      );
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        configManager.loadFromFile(join(tempDir, 'non-existent.yaml'))
      ).rejects.toThrow(ConfigError);
    });

    it('should throw error for invalid config', async () => {
      const configPath = join(tempDir, 'invalid.yaml');
      writeFileSync(configPath, 'api:\n  maxTokens: "not-a-number"\n');

      await expect(configManager.loadFromFile(configPath)).rejects.toThrow(
        ConfigError
      );
    });
  });

  describe('loadFromEnv', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      // Restore original env
      Object.keys(process.env).forEach((key) => {
        if (key.startsWith('AIDOS_')) {
          delete process.env[key];
        }
      });
      Object.assign(process.env, originalEnv);
    });

    it('should load config from environment variables', () => {
      process.env.AIDOS_API_MODEL = 'env-model';

      configManager.loadFromEnv();
      const config = configManager.getConfig();

      expect(config.api.model).toBe('env-model');
    });

    it('should transform numeric env values', () => {
      process.env.AIDOS_API_MAX_TOKENS = '8192';

      configManager.loadFromEnv();
      const config = configManager.getConfig();

      expect(config.api.maxTokens).toBe(8192);
    });

    it('should load multiple env values', () => {
      process.env.AIDOS_AGENTS_MAX_CONCURRENT = '20';
      process.env.AIDOS_AGENTS_TIMEOUT_MS = '600000';

      configManager.loadFromEnv();
      const config = configManager.getConfig();

      expect(config.agents.maxConcurrent).toBe(20);
      expect(config.agents.timeoutMs).toBe(600000);
    });

    it('should track origin as env for environment values', () => {
      process.env.AIDOS_API_MODEL = 'env-model';

      configManager.loadFromEnv();
      const origin = configManager.getOrigin('api.model');

      expect(origin?.source).toBe('env');
      expect(origin?.originalValue).toBe('env-model');
    });
  });

  describe('saveToFile', () => {
    it('should save config to YAML file', async () => {
      const configPath = join(tempDir, 'output.yaml');

      await configManager.saveToFile(configPath);

      const { readFileSync } = await import('fs');
      const content = readFileSync(configPath, 'utf-8');

      expect(content).toContain('api:');
      expect(content).toContain('model:');
    });

    it('should save config to JSON file', async () => {
      const configPath = join(tempDir, 'output.json');

      await configManager.saveToFile(configPath);

      const { readFileSync } = await import('fs');
      const content = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.api).toBeDefined();
      expect(parsed.api.model).toBeDefined();
    });

    it('should emit config:saved event', async () => {
      const configPath = join(tempDir, 'output.yaml');
      const events: string[] = [];
      configManager.on('config:saved', () => events.push('saved'));

      await configManager.saveToFile(configPath);

      expect(events).toContain('saved');
    });

    it('should throw error when no path specified', async () => {
      await expect(configManager.saveToFile()).rejects.toThrow(ConfigError);
    });

    it('should use previously loaded file path', async () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(configPath, 'api:\n  model: original\n');

      await configManager.loadFromFile(configPath);
      configManager.set('api.model', 'updated');
      await configManager.saveToFile();

      const { readFileSync } = await import('fs');
      const content = readFileSync(configPath, 'utf-8');

      expect(content).toContain('updated');
    });
  });

  describe('validate', () => {
    it('should validate correct config', () => {
      const result = configManager.validate({
        api: { model: 'test', maxTokens: 4096 },
      });

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect invalid type errors', () => {
      const result = configManager.validate({
        api: { maxTokens: 'not-a-number' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect out of range values', () => {
      const result = configManager.validate({
        api: { maxTokens: -100 },
      });

      expect(result.valid).toBe(false);
    });

    it('should include warnings for high values', () => {
      const result = configManager.validate({
        agents: { maxConcurrent: 50 },
      });

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should include warnings for low timeout', () => {
      const result = configManager.validate({
        agents: { timeoutMs: 10000 },
      });

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should emit config:validated event', () => {
      const events: string[] = [];
      configManager.on('config:validated', () => events.push('validated'));

      configManager.validate({ api: { model: 'test' } });

      expect(events).toContain('validated');
    });
  });

  describe('validateFull', () => {
    it('should validate complete config', () => {
      const result = configManager.validateFull();

      expect(result.valid).toBe(true);
    });
  });

  describe('merge', () => {
    it('should merge partial config', () => {
      const config = configManager.merge({
        api: { model: 'merged-model' },
      });

      expect(config.api.model).toBe('merged-model');
      expect(config.api.provider).toBe('anthropic'); // preserved
    });

    it('should throw error for invalid config', () => {
      expect(() =>
        configManager.merge({
          api: { maxTokens: -1 } as any,
        })
      ).toThrow(ConfigError);
    });

    it('should track merged values as runtime', () => {
      configManager.merge({ api: { model: 'merged-model' } });
      const origin = configManager.getOrigin('api.model');

      expect(origin?.source).toBe('runtime');
    });
  });

  describe('reset', () => {
    it('should reset config to defaults', () => {
      configManager.set('api.model', 'custom-model');
      configManager.reset();

      const config = configManager.getConfig();
      expect(config.api.model).toBe(DEFAULT_CONFIG.api.model);
    });

    it('should clear origins', () => {
      configManager.set('api.model', 'custom-model');
      configManager.reset();

      const origin = configManager.getOrigin('api.model');
      expect(origin?.source).toBe('default');
    });

    it('should emit config:changed event', () => {
      const events: any[] = [];
      configManager.on('config:changed', (event) => events.push(event));

      configManager.reset();

      expect(events.some((e) => e.key === '*')).toBe(true);
    });
  });

  describe('watch', () => {
    it('should notify watchers on config change', () => {
      const changes: any[] = [];
      configManager.watch((event) => changes.push(event));

      configManager.set('api.model', 'watched-model');

      expect(changes.length).toBe(1);
      expect(changes[0].key).toBe('api.model');
      expect(changes[0].newValue).toBe('watched-model');
    });

    it('should return unsubscribe function', () => {
      const changes: any[] = [];
      const unsubscribe = configManager.watch((event) => changes.push(event));

      configManager.set('api.model', 'first-change');
      unsubscribe();
      configManager.set('api.model', 'second-change');

      expect(changes.length).toBe(1);
    });
  });

  describe('origins', () => {
    it('should track all origins', async () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(configPath, 'api:\n  model: file-model\n');

      process.env.AIDOS_AGENTS_MAX_CONCURRENT = '15';

      await configManager.loadFromFile(configPath);
      configManager.loadFromEnv();
      configManager.set('ui.theme', 'light');

      const origins = configManager.getAllOrigins();

      const fileOrigin = origins.find((o) => o.key === 'api.model');
      const envOrigin = origins.find((o) => o.key === 'agents.maxConcurrent');
      const runtimeOrigin = origins.find((o) => o.key === 'ui.theme');

      expect(fileOrigin?.source).toBe('file');
      expect(envOrigin?.source).toBe('env');
      expect(runtimeOrigin?.source).toBe('runtime');

      delete process.env.AIDOS_AGENTS_MAX_CONCURRENT;
    });
  });

  describe('serialization', () => {
    it('should convert config to YAML string', () => {
      const yaml = configManager.toYaml();

      expect(yaml).toContain('api:');
      expect(yaml).toContain('model:');
    });

    it('should convert config to JSON string', () => {
      const json = configManager.toJson();
      const parsed = JSON.parse(json);

      expect(parsed.api).toBeDefined();
      expect(parsed.api.model).toBeDefined();
    });

    it('should support non-pretty JSON', () => {
      const json = configManager.toJson(false);

      expect(json).not.toContain('\n');
    });
  });

  describe('generateEnvTemplate', () => {
    it('should generate environment variable template', () => {
      const template = configManager.generateEnvTemplate();

      expect(template).toContain('AIDOS_API_MODEL');
      expect(template).toContain('AIDOS_AGENTS_MAX_CONCURRENT');
      expect(template).toContain('AIDOS_OUTPUT_DIR');
    });
  });

  describe('singleton', () => {
    it('should return same instance from getConfigManager', () => {
      resetConfigManager();
      const instance1 = getConfigManager();
      const instance2 = getConfigManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetConfigManager', () => {
      const instance1 = getConfigManager();
      resetConfigManager();
      const instance2 = getConfigManager();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('findConfigFile', () => {
    it('should find config file in directory', async () => {
      const configPath = join(tempDir, 'aidos.config.yaml');
      writeFileSync(configPath, 'api:\n  model: test\n');

      const found = await findConfigFile(tempDir);

      expect(found).toBe(configPath);
    });

    it('should find yml extension', async () => {
      const configPath = join(tempDir, 'aidos.config.yml');
      writeFileSync(configPath, 'api:\n  model: test\n');

      const found = await findConfigFile(tempDir);

      expect(found).toBe(configPath);
    });

    it('should find json config', async () => {
      const configPath = join(tempDir, 'aidos.config.json');
      writeFileSync(configPath, '{"api": {"model": "test"}}');

      const found = await findConfigFile(tempDir);

      expect(found).toBe(configPath);
    });

    it('should find hidden config files', async () => {
      const configPath = join(tempDir, '.aidos.yaml');
      writeFileSync(configPath, 'api:\n  model: test\n');

      const found = await findConfigFile(tempDir);

      expect(found).toBe(configPath);
    });

    it('should return null when no config found', async () => {
      const found = await findConfigFile(tempDir);

      expect(found).toBeNull();
    });
  });

  describe('initializeConfig', () => {
    it('should initialize with specified config path', async () => {
      const configPath = join(tempDir, 'config.yaml');
      writeFileSync(configPath, 'api:\n  model: init-test\n');

      resetConfigManager();
      const manager = await initializeConfig({ configPath });
      const config = manager.getConfig();

      expect(config.api.model).toBe('init-test');
    });

    it('should apply overrides', async () => {
      resetConfigManager();
      const manager = await initializeConfig({
        overrides: { api: { model: 'override-model' } as any },
      });
      const config = manager.getConfig();

      expect(config.api.model).toBe('override-model');
    });

    it('should load env by default', async () => {
      process.env.AIDOS_API_MODEL = 'env-init-model';

      resetConfigManager();
      const manager = await initializeConfig();
      const config = manager.getConfig();

      expect(config.api.model).toBe('env-init-model');

      delete process.env.AIDOS_API_MODEL;
    });

    it('should skip env when useEnv is false', async () => {
      process.env.AIDOS_API_MODEL = 'env-skip-model';

      resetConfigManager();
      const manager = await initializeConfig({ useEnv: false });
      const config = manager.getConfig();

      expect(config.api.model).not.toBe('env-skip-model');

      delete process.env.AIDOS_API_MODEL;
    });
  });
});
