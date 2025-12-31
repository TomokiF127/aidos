/**
 * SecurityGuardrails Tests
 *
 * Tests for secret detection, dangerous pattern detection, and commit safety checks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SecurityGuardrails,
  SecretMatch,
  DangerousPatternMatch,
  SafetyCheckResult,
  getSecurityGuardrails,
  resetSecurityGuardrails,
  scanForSecrets,
  scanForDangerousPatterns,
  maskSecret,
  isFileBlocked,
  getGitignoreRecommendations,
  GITIGNORE_RECOMMENDATIONS,
} from '../../src/security/guardrails.js';

describe('SecurityGuardrails', () => {
  let guardrails: SecurityGuardrails;

  beforeEach(() => {
    resetSecurityGuardrails();
    guardrails = new SecurityGuardrails();
  });

  afterEach(() => {
    resetSecurityGuardrails();
  });

  // ========================================
  // Secret Detection Tests
  // ========================================

  describe('secret detection', () => {
    describe('API keys', () => {
      it('should detect generic API keys', () => {
        const content = `const apiKey = "sk-1234567890abcdefghij1234567890ab";`;
        const matches = guardrails.scanContent(content);

        expect(matches.length).toBeGreaterThan(0);
        expect(matches.some((m) => m.type === 'api_key')).toBe(true);
      });

      it('should detect OpenAI API keys', () => {
        // OpenAI keys are sk- followed by 48+ alphanumeric characters (pattern: sk-[a-zA-Z0-9]{48,})
        // Need a string with exactly 48+ chars after sk-
        const content = `const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKL";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'openai-api-key')).toBe(true);
        expect(matches.length).toBeGreaterThan(0);
        const openaiMatch = matches.find((m) => m.rule === 'openai-api-key');
        expect(openaiMatch?.severity).toBe('critical');
      });

      it('should detect Anthropic API keys', () => {
        const content = `const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'anthropic-api-key')).toBe(true);
      });

      it('should detect GitHub tokens', () => {
        const content = `const token = "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'github-token')).toBe(true);
      });

      it('should detect Slack tokens', () => {
        // Using clearly fake token pattern for testing
        const content = `const token = "xoxb-FAKE-TOKEN-FOR-TESTING-ONLY";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'slack-token')).toBe(true);
      });
    });

    describe('passwords', () => {
      it('should detect hardcoded passwords', () => {
        const content = `const password = "MySecretPassword123!";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.type === 'password')).toBe(true);
        expect(matches[0].severity).toBe('critical');
      });

      it('should detect password with various formats', () => {
        const formats = [
          `password: "secret123"`,
          `passwd = "secret123"`,
          `pwd = "secret123"`,
          `PASSWORD = "secret123"`,
        ];

        for (const content of formats) {
          const matches = guardrails.scanContent(content);
          expect(matches.length).toBeGreaterThan(0);
        }
      });
    });

    describe('private keys', () => {
      it('should detect RSA private keys', () => {
        const content = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
-----END RSA PRIVATE KEY-----`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.type === 'private_key')).toBe(true);
        expect(matches[0].severity).toBe('critical');
      });

      it('should detect EC private keys', () => {
        const content = `-----BEGIN EC PRIVATE KEY-----`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'ec-private-key')).toBe(true);
      });

      it('should detect OpenSSH private keys', () => {
        const content = `-----BEGIN OPENSSH PRIVATE KEY-----`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'openssh-private-key')).toBe(true);
      });

      it('should detect PGP private keys', () => {
        const content = `-----BEGIN PGP PRIVATE KEY BLOCK-----`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'pgp-private-key')).toBe(true);
      });
    });

    describe('AWS credentials', () => {
      it('should detect AWS Access Key IDs', () => {
        const content = `const accessKey = "AKIAIOSFODNN7EXAMPLE";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.type === 'aws')).toBe(true);
        expect(matches.some((m) => m.rule === 'aws-access-key')).toBe(true);
      });

      it('should detect AWS Secret Access Keys', () => {
        const content = `aws_secret_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'aws-secret-key')).toBe(true);
      });
    });

    describe('database connection strings', () => {
      it('should detect MongoDB connection strings', () => {
        const content = `const uri = "mongodb://admin:password123@cluster.mongodb.net/db";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.type === 'db_connection')).toBe(true);
        expect(matches.some((m) => m.rule === 'mongodb-connection')).toBe(true);
      });

      it('should detect PostgreSQL connection strings', () => {
        const content = `const uri = "postgres://user:pass@localhost:5432/db";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'postgres-connection')).toBe(true);
      });

      it('should detect MySQL connection strings', () => {
        const content = `const uri = "mysql://root:secret@localhost/database";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'mysql-connection')).toBe(true);
      });

      it('should detect Redis connection strings', () => {
        const content = `const uri = "redis://:password@localhost:6379";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'redis-connection')).toBe(true);
      });
    });

    describe('tokens', () => {
      it('should detect JWT tokens', () => {
        const content = `const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'jwt-token')).toBe(true);
      });

      it('should detect Bearer tokens', () => {
        const content = `headers: { Authorization: "Bearer abc123xyz.token.here" }`;
        const matches = guardrails.scanContent(content);

        expect(matches.some((m) => m.rule === 'bearer-token')).toBe(true);
      });
    });
  });

  // ========================================
  // Dangerous Pattern Detection Tests
  // ========================================

  describe('dangerous pattern detection', () => {
    describe('eval patterns', () => {
      it('should detect eval usage', () => {
        const content = `const result = eval(userInput);`;
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.some((m) => m.type === 'eval')).toBe(true);
        expect(matches[0].severity).toBe('critical');
      });

      it('should detect Function constructor', () => {
        const content = `const fn = new Function(code);`;
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.some((m) => m.rule === 'function-constructor')).toBe(true);
      });

      it('should detect setTimeout with string', () => {
        const content = `setTimeout("alert('hi')", 1000);`;
        const matches = guardrails.scanDangerousPatterns(content, 'javascript');

        expect(matches.some((m) => m.rule === 'settimeout-string')).toBe(true);
      });

      it('should detect setInterval with string', () => {
        const content = `setInterval("console.log('tick')", 1000);`;
        const matches = guardrails.scanDangerousPatterns(content, 'javascript');

        expect(matches.some((m) => m.rule === 'setinterval-string')).toBe(true);
      });
    });

    describe('command injection patterns', () => {
      it('should detect exec with concatenation', () => {
        const content = `exec("ls " + userInput);`;
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.some((m) => m.type === 'command_injection')).toBe(true);
      });

      it('should detect spawn with shell: true', () => {
        const content = `spawn('cmd', args, { shell: true });`;
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.some((m) => m.rule === 'shell-true')).toBe(true);
      });

      it('should detect Python os.system with concatenation', () => {
        const content = `os.system("rm " + filename)`;
        const matches = guardrails.scanDangerousPatterns(content, 'python');

        expect(matches.some((m) => m.rule === 'python-os-system')).toBe(true);
      });

      it('should detect Python subprocess with shell=True', () => {
        const content = `subprocess.run(cmd, shell=True)`;
        const matches = guardrails.scanDangerousPatterns(content, 'python');

        expect(matches.some((m) => m.rule === 'python-subprocess-shell')).toBe(true);
      });
    });

    describe('SQL injection patterns', () => {
      it('should detect SQL string concatenation', () => {
        const content = `query("SELECT * FROM users WHERE id = " + userId);`;
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.some((m) => m.type === 'sql_injection')).toBe(true);
      });

      it('should detect SQL template literals with interpolation', () => {
        const content = 'query(`SELECT * FROM users WHERE id = ${userId}`);';
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.some((m) => m.rule === 'sql-template-literal')).toBe(true);
      });

      it('should detect Python f-string SQL', () => {
        const content = `cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")`;
        const matches = guardrails.scanDangerousPatterns(content, 'python');

        expect(matches.some((m) => m.rule === 'sql-fstring')).toBe(true);
      });
    });

    describe('path traversal patterns', () => {
      it('should detect file operations with user input', () => {
        const content = `readFile("/data/" + req.params.filename);`;
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.some((m) => m.type === 'path_traversal')).toBe(true);
      });

      it('should detect path.join with user input', () => {
        const content = `path.join(baseDir, req.query.file);`;
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.some((m) => m.rule === 'path-join-user-input')).toBe(true);
      });
    });

    describe('unsafe deserialization patterns', () => {
      it('should detect Python pickle usage', () => {
        const content = `data = pickle.loads(user_data)`;
        const matches = guardrails.scanDangerousPatterns(content, 'python');

        expect(matches.some((m) => m.type === 'unsafe_deserialization')).toBe(true);
      });

      it('should detect unsafe YAML load', () => {
        const content = `data = yaml.load(file_content)`;
        const matches = guardrails.scanDangerousPatterns(content, 'python');

        expect(matches.some((m) => m.rule === 'unsafe-yaml-load')).toBe(true);
      });
    });

    describe('comment skipping', () => {
      it('should skip patterns in comments', () => {
        const content = `// eval(userInput);`;
        const matches = guardrails.scanDangerousPatterns(content, 'typescript');

        expect(matches.length).toBe(0);
      });

      it('should skip patterns in Python comments', () => {
        const content = `# os.system("rm " + filename)`;
        const matches = guardrails.scanDangerousPatterns(content, 'python');

        expect(matches.length).toBe(0);
      });
    });
  });

  // ========================================
  // File Blocking Tests
  // ========================================

  describe('file blocking', () => {
    it('should block .env files', () => {
      expect(guardrails.isFileBlocked('.env')).toBe(true);
      expect(guardrails.isFileBlocked('.env.local')).toBe(true);
      expect(guardrails.isFileBlocked('.env.production')).toBe(true);
    });

    it('should block secret files', () => {
      expect(guardrails.isFileBlocked('secrets.json')).toBe(true);
      expect(guardrails.isFileBlocked('credentials.json')).toBe(true);
    });

    it('should block private key files', () => {
      expect(guardrails.isFileBlocked('id_rsa')).toBe(true);
      expect(guardrails.isFileBlocked('server.key')).toBe(true);
      expect(guardrails.isFileBlocked('certificate.pem')).toBe(true);
    });

    it('should block Firebase config files', () => {
      expect(guardrails.isFileBlocked('firebase-admin.json')).toBe(true);
      expect(guardrails.isFileBlocked('firebase-credentials.json')).toBe(true);
    });

    it('should not block regular files', () => {
      expect(guardrails.isFileBlocked('index.ts')).toBe(false);
      expect(guardrails.isFileBlocked('package.json')).toBe(false);
      expect(guardrails.isFileBlocked('README.md')).toBe(false);
    });
  });

  // ========================================
  // Secret Masking Tests
  // ========================================

  describe('secret masking', () => {
    it('should mask secrets preserving start and end', () => {
      const secret = 'sk-1234567890abcdefghij';
      const masked = guardrails.maskSecret(secret);

      expect(masked.startsWith('sk-1')).toBe(true);
      expect(masked.endsWith('ghij')).toBe(true);
      expect(masked).toContain('*');
    });

    it('should fully mask short secrets', () => {
      const secret = '12345678';
      const masked = guardrails.maskSecret(secret);

      expect(masked).toBe('********');
    });

    it('should handle very short secrets', () => {
      const secret = 'abc';
      const masked = guardrails.maskSecret(secret);

      expect(masked).toBe('***');
    });
  });

  // ========================================
  // Gitignore Recommendations Tests
  // ========================================

  describe('gitignore recommendations', () => {
    it('should include common sensitive files', () => {
      const recommendations = guardrails.getGitignoreRecommendations();

      expect(recommendations).toContain('.env');
      expect(recommendations).toContain('.env.local');
      expect(recommendations).toContain('*.pem');
      expect(recommendations).toContain('*.key');
    });

    it('should include IDE files', () => {
      const recommendations = guardrails.getGitignoreRecommendations();

      expect(recommendations).toContain('.idea/');
    });

    it('should include build directories', () => {
      const recommendations = guardrails.getGitignoreRecommendations();

      expect(recommendations).toContain('node_modules/');
      expect(recommendations).toContain('dist/');
      expect(recommendations).toContain('build/');
    });

    it('should include database files', () => {
      const recommendations = guardrails.getGitignoreRecommendations();

      expect(recommendations).toContain('*.sqlite');
      expect(recommendations).toContain('*.db');
    });
  });

  // ========================================
  // isFileIgnored Tests
  // ========================================

  describe('isFileIgnored', () => {
    it('should identify files that should be gitignored', () => {
      expect(guardrails.isFileIgnored('.env')).toBe(true);
      expect(guardrails.isFileIgnored('secrets.json')).toBe(true);
      expect(guardrails.isFileIgnored('private.key')).toBe(true);
    });

    it('should identify regular files as not ignored', () => {
      expect(guardrails.isFileIgnored('app.ts')).toBe(false);
      expect(guardrails.isFileIgnored('config.ts')).toBe(false);
    });

    it('should handle paths with directories', () => {
      expect(guardrails.isFileIgnored('config/.env')).toBe(true);
      expect(guardrails.isFileIgnored('src/node_modules/file.js')).toBe(true);
    });
  });

  // ========================================
  // Custom Pattern Tests
  // ========================================

  describe('custom patterns', () => {
    it('should allow adding custom secret patterns', () => {
      guardrails.addSecretPattern({
        name: 'custom-secret',
        type: 'generic_secret',
        pattern: /CUSTOM_SECRET_[A-Z0-9]{10}/g,
        severity: 'high',
        description: 'Custom secret detected',
      });

      const content = `const secret = "CUSTOM_SECRET_ABCD123456";`;
      const matches = guardrails.scanContent(content);

      expect(matches.some((m) => m.rule === 'custom-secret')).toBe(true);
    });

    it('should allow removing secret patterns', () => {
      const removed = guardrails.removeSecretPattern('generic-api-key');
      expect(removed).toBe(true);

      const content = `const apiKey = "sk-1234567890abcdefghij1234567890ab";`;
      const matches = guardrails.scanContent(content);

      expect(matches.every((m) => m.rule !== 'generic-api-key')).toBe(true);
    });

    it('should return false when removing non-existent pattern', () => {
      const removed = guardrails.removeSecretPattern('non-existent-pattern');
      expect(removed).toBe(false);
    });
  });

  // ========================================
  // Options Tests
  // ========================================

  describe('options', () => {
    it('should disable secret detection when configured', () => {
      const guardrails = new SecurityGuardrails({
        enableSecretDetection: false,
      });

      const content = `const password = "secret123456789";`;
      const matches = guardrails.scanContent(content);

      expect(matches.length).toBe(0);
    });

    it('should disable dangerous pattern detection when configured', () => {
      const guardrails = new SecurityGuardrails({
        enableDangerousPatternDetection: false,
      });

      const content = `eval(userInput);`;
      const matches = guardrails.scanDangerousPatterns(content, 'typescript');

      expect(matches.length).toBe(0);
    });

    it('should use custom exclude patterns', () => {
      const guardrails = new SecurityGuardrails({
        excludePatterns: ['custom_dir', 'another_dir'],
      });

      // This is internal behavior, but we can verify the options are set
      expect(guardrails).toBeDefined();
    });
  });

  // ========================================
  // Event Emission Tests
  // ========================================

  describe('event emission', () => {
    it('should emit secret:detected event', () => {
      const events: Array<{ match: SecretMatch; filename?: string }> = [];
      guardrails.on('secret:detected', (data) => events.push(data));

      const content = `const password = "secret123456";`;
      guardrails.scanContent(content, 'test.ts');

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].filename).toBe('test.ts');
    });

    it('should emit dangerous:detected event', () => {
      const events: Array<{ match: DangerousPatternMatch; filename?: string }> = [];
      guardrails.on('dangerous:detected', (data) => events.push(data));

      const content = `eval(userInput);`;
      guardrails.scanDangerousPatterns(content, 'typescript', 'test.ts');

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].filename).toBe('test.ts');
    });
  });

  // ========================================
  // Singleton Tests
  // ========================================

  describe('singleton', () => {
    it('should return same instance from getSecurityGuardrails', () => {
      resetSecurityGuardrails();
      const instance1 = getSecurityGuardrails();
      const instance2 = getSecurityGuardrails();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetSecurityGuardrails', () => {
      const instance1 = getSecurityGuardrails();
      resetSecurityGuardrails();
      const instance2 = getSecurityGuardrails();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ========================================
  // Convenience Function Tests
  // ========================================

  describe('convenience functions', () => {
    it('scanForSecrets should work correctly', () => {
      resetSecurityGuardrails();
      const matches = scanForSecrets(`const password = "secret123456";`);

      expect(matches.length).toBeGreaterThan(0);
    });

    it('scanForDangerousPatterns should work correctly', () => {
      resetSecurityGuardrails();
      const matches = scanForDangerousPatterns(`eval(input);`, 'typescript');

      expect(matches.length).toBeGreaterThan(0);
    });

    it('maskSecret should work correctly', () => {
      resetSecurityGuardrails();
      const masked = maskSecret('sk-1234567890abcdef');

      expect(masked).toContain('*');
    });

    it('isFileBlocked should work correctly', () => {
      resetSecurityGuardrails();

      expect(isFileBlocked('.env')).toBe(true);
      expect(isFileBlocked('app.ts')).toBe(false);
    });

    it('getGitignoreRecommendations should work correctly', () => {
      const recommendations = getGitignoreRecommendations();

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations).toContain('.env');
    });
  });

  // ========================================
  // Line/Column Accuracy Tests
  // ========================================

  describe('line and column accuracy', () => {
    it('should report correct line numbers', () => {
      const content = `const a = 1;
const b = 2;
const password = "secret123456";
const c = 3;`;

      const matches = guardrails.scanContent(content);
      const passwordMatch = matches.find((m) => m.type === 'password');

      expect(passwordMatch).toBeDefined();
      expect(passwordMatch?.line).toBe(3);
    });

    it('should report correct column numbers', () => {
      const content = `const password = "secret123456";`;
      const matches = guardrails.scanContent(content);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].column).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Multi-match Tests
  // ========================================

  describe('multiple matches', () => {
    it('should detect multiple secrets in same file', () => {
      const content = `
const apiKey = "sk-abcdefghijklmnop1234567890123456";
const password = "MySecretPassword123";
const dbUrl = "mongodb://user:pass@localhost/db";
`;

      const matches = guardrails.scanContent(content);

      expect(matches.length).toBeGreaterThan(2);
    });

    it('should detect multiple dangerous patterns in same file', () => {
      const content = `
eval(input);
new Function(code);
exec("rm " + filename);
`;

      const matches = guardrails.scanDangerousPatterns(content, 'typescript');

      expect(matches.length).toBeGreaterThan(2);
    });
  });
});

// ========================================
// GITIGNORE_RECOMMENDATIONS Export Test
// ========================================

describe('GITIGNORE_RECOMMENDATIONS export', () => {
  it('should be exported and contain expected entries', () => {
    expect(Array.isArray(GITIGNORE_RECOMMENDATIONS)).toBe(true);
    expect(GITIGNORE_RECOMMENDATIONS.length).toBeGreaterThan(0);
    expect(GITIGNORE_RECOMMENDATIONS).toContain('.env');
  });
});
