/**
 * AIDOS Key Handler Tests
 *
 * Tests for key binding registration and mode handling
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock blessed before importing the module
const mockScreenKey = vi.fn();
const mockScreenUnkey = vi.fn();
const mockScreenRender = vi.fn();
const mockScreenDestroy = vi.fn();

const mockScreen = {
  key: mockScreenKey,
  unkey: mockScreenUnkey,
  render: mockScreenRender,
  destroy: mockScreenDestroy,
};

const mockTextboxSetValue = vi.fn();
const mockTextboxOn = vi.fn();
const mockTextboxFocus = vi.fn();
const mockTextboxDestroy = vi.fn();

const mockTextbox = {
  setValue: mockTextboxSetValue,
  on: mockTextboxOn,
  focus: mockTextboxFocus,
  destroy: mockTextboxDestroy,
};

const mockQuestionAsk = vi.fn();
const mockQuestionDestroy = vi.fn();

const mockQuestion = {
  ask: mockQuestionAsk,
  destroy: mockQuestionDestroy,
};

vi.mock('blessed', () => ({
  default: {
    screen: vi.fn(() => mockScreen),
    textbox: vi.fn(() => mockTextbox),
    question: vi.fn(() => mockQuestion),
  },
}));

// Import after mocking
import { KeyHandler, InputHandler, STANDARD_KEYS, KeyMapPresets } from '../../src/ui/key-handler.js';
import type { KeyBinding, KeyHandlerConfig } from '../../src/ui/key-handler.js';
import type blessed from 'blessed';

describe('KeyHandler', () => {
  let keyHandler: KeyHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    keyHandler = new KeyHandler(mockScreen as unknown as blessed.Widgets.Screen);
  });

  afterEach(() => {
    keyHandler.destroy();
  });

  describe('constructor', () => {
    it('should create a KeyHandler with default config', () => {
      expect(keyHandler).toBeDefined();
      expect(keyHandler.getMode()).toBe('normal');
    });

    it('should create a KeyHandler with custom config', () => {
      const config: KeyHandlerConfig = {
        enableVimMode: false,
        enableNumberKeys: false,
      };
      const handler = new KeyHandler(mockScreen as unknown as blessed.Widgets.Screen, config);
      expect(handler).toBeDefined();
      handler.destroy();
    });
  });

  describe('bind', () => {
    it('should register a key binding with a single key', () => {
      const callback = vi.fn();
      keyHandler.bind('q', callback, 'Quit');

      expect(mockScreenKey).toHaveBeenCalledWith(['q'], expect.any(Function));
    });

    it('should register a key binding with multiple keys', () => {
      const callback = vi.fn();
      keyHandler.bind(['q', 'C-c'], callback, 'Quit');

      // The implementation passes the keys to screen.key - order preserved
      expect(mockScreenKey).toHaveBeenCalledWith(
        expect.arrayContaining(['q', 'C-c']),
        expect.any(Function)
      );
    });

    it('should register a mode-specific binding', () => {
      const callback = vi.fn();
      keyHandler.bind('j', callback, 'Move down', 'insert');

      const bindings = keyHandler.getBindings();
      expect(bindings.size).toBe(1);
    });

    it('should not execute callback when disabled', () => {
      const callback = vi.fn();
      keyHandler.bind('q', callback);

      // Get the registered callback
      const registeredCallback = mockScreenKey.mock.calls[0][1];

      keyHandler.disable();
      registeredCallback();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not execute mode-specific callback when in wrong mode', () => {
      const callback = vi.fn();
      keyHandler.bind('j', callback, 'Move down', 'insert');

      // Get the registered callback
      const registeredCallback = mockScreenKey.mock.calls[0][1];

      // Default mode is 'normal', so insert mode binding should not execute
      registeredCallback();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should execute mode-specific callback when in correct mode', () => {
      const callback = vi.fn();
      keyHandler.bind('j', callback, 'Move down', 'insert');

      // Get the registered callback
      const registeredCallback = mockScreenKey.mock.calls[0][1];

      // Switch to insert mode
      keyHandler.setMode('insert');
      registeredCallback();

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('unbind', () => {
    it('should remove a key binding', () => {
      const callback = vi.fn();
      keyHandler.bind('q', callback);

      keyHandler.unbind('q');

      expect(mockScreenUnkey).toHaveBeenCalled();
    });
  });

  describe('mode management', () => {
    it('should set and get mode', () => {
      keyHandler.setMode('insert');
      expect(keyHandler.getMode()).toBe('insert');

      keyHandler.setMode('visual');
      expect(keyHandler.getMode()).toBe('visual');
    });
  });

  describe('enable/disable', () => {
    it('should enable the handler', () => {
      keyHandler.disable();
      keyHandler.enable();

      const callback = vi.fn();
      keyHandler.bind('q', callback);
      const registeredCallback = mockScreenKey.mock.calls[0][1];
      registeredCallback();

      expect(callback).toHaveBeenCalled();
    });

    it('should disable the handler', () => {
      const callback = vi.fn();
      keyHandler.bind('q', callback);
      keyHandler.disable();

      const registeredCallback = mockScreenKey.mock.calls[0][1];
      registeredCallback();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should toggle the handler', () => {
      expect(keyHandler.toggle()).toBe(false); // Was enabled, now disabled
      expect(keyHandler.toggle()).toBe(true);  // Was disabled, now enabled
    });
  });

  describe('key sequence', () => {
    it('should start a sequence', () => {
      keyHandler.startSequence('g');
      expect(keyHandler.getSequence()).toEqual(['g']);
    });

    it('should add to sequence', () => {
      keyHandler.startSequence('g');
      keyHandler.startSequence('g');
      expect(keyHandler.getSequence()).toEqual(['g', 'g']);
    });

    it('should clear sequence', () => {
      keyHandler.startSequence('g');
      keyHandler.startSequence('g');
      keyHandler.clearSequence();
      expect(keyHandler.getSequence()).toEqual([]);
    });

    it('should match sequence pattern', () => {
      keyHandler.startSequence('g');
      keyHandler.startSequence('g');
      expect(keyHandler.matchSequence(['g', 'g'])).toBe(true);
      expect(keyHandler.matchSequence(['g'])).toBe(false);
      expect(keyHandler.matchSequence(['g', 'g', 'g'])).toBe(false);
    });

    it('should auto-clear sequence after timeout', async () => {
      vi.useFakeTimers();
      keyHandler.startSequence('g');

      vi.advanceTimersByTime(1100); // Wait more than 1000ms timeout

      expect(keyHandler.getSequence()).toEqual([]);
      vi.useRealTimers();
    });
  });

  describe('setupStandardBindings', () => {
    it('should setup standard bindings', () => {
      const handlers = {
        QUIT: vi.fn(),
        ENTER: vi.fn(),
      };

      keyHandler.setupStandardBindings(handlers);

      // QUIT bindings: ['q', 'C-c']
      expect(mockScreenKey).toHaveBeenCalled();
    });
  });

  describe('setupNumberKeys', () => {
    it('should setup number key bindings', () => {
      const callback = vi.fn();
      keyHandler.setupNumberKeys(callback);

      // Should have registered 9 number keys (1-9)
      expect(mockScreenKey).toHaveBeenCalledTimes(9);
    });

    it('should not setup number keys when disabled', () => {
      const handler = new KeyHandler(mockScreen as unknown as blessed.Widgets.Screen, {
        enableNumberKeys: false,
      });
      const callback = vi.fn();

      vi.clearAllMocks();
      handler.setupNumberKeys(callback);

      expect(mockScreenKey).not.toHaveBeenCalled();
      handler.destroy();
    });
  });

  describe('setupVimNavigation', () => {
    it('should setup vim navigation bindings', () => {
      const handlers = {
        up: vi.fn(),
        down: vi.fn(),
        left: vi.fn(),
        right: vi.fn(),
      };

      keyHandler.setupVimNavigation(handlers);

      expect(mockScreenKey).toHaveBeenCalledTimes(4);
    });

    it('should not setup vim navigation when disabled', () => {
      const handler = new KeyHandler(mockScreen as unknown as blessed.Widgets.Screen, {
        enableVimMode: false,
      });

      vi.clearAllMocks();
      handler.setupVimNavigation({
        up: vi.fn(),
      });

      expect(mockScreenKey).not.toHaveBeenCalled();
      handler.destroy();
    });
  });

  describe('setupModeBindings', () => {
    it('should setup mode-specific bindings', () => {
      const bindings = {
        moveUp: { keys: ['k'], handler: vi.fn(), description: 'Move up' },
        moveDown: { keys: ['j'], handler: vi.fn(), description: 'Move down' },
      };

      keyHandler.setupModeBindings('insert', bindings);

      expect(mockScreenKey).toHaveBeenCalledTimes(2);
    });
  });

  describe('getBindings', () => {
    it('should return all bindings', () => {
      keyHandler.bind('q', vi.fn(), 'Quit');
      keyHandler.bind('j', vi.fn(), 'Down');

      const bindings = keyHandler.getBindings();
      expect(bindings.size).toBe(2);
    });
  });

  describe('getBindingsForMode', () => {
    it('should return bindings for specific mode', () => {
      keyHandler.bind('q', vi.fn(), 'Quit');
      keyHandler.bind('j', vi.fn(), 'Down', 'insert');
      keyHandler.bind('k', vi.fn(), 'Up', 'insert');

      const insertBindings = keyHandler.getBindingsForMode('insert');
      // Should include global (no mode) and insert mode bindings
      expect(insertBindings.length).toBe(3);
    });

    it('should return all bindings when no mode specified', () => {
      keyHandler.bind('q', vi.fn(), 'Quit');
      keyHandler.bind('j', vi.fn(), 'Down', 'insert');

      const allBindings = keyHandler.getBindingsForMode();
      expect(allBindings.length).toBe(2);
    });
  });

  describe('generateHelpText', () => {
    it('should generate help text', () => {
      keyHandler.bind('q', vi.fn(), 'Quit');
      keyHandler.bind('j', vi.fn(), 'Move down', 'normal');

      const helpText = keyHandler.generateHelpText();

      expect(helpText).toContain('[global]');
      expect(helpText).toContain('[normal]');
      expect(helpText).toContain('q');
      expect(helpText).toContain('j');
    });
  });

  describe('clearAll', () => {
    it('should clear all bindings', () => {
      keyHandler.bind('q', vi.fn());
      keyHandler.bind('j', vi.fn());
      keyHandler.startSequence('g');

      keyHandler.clearAll();

      expect(keyHandler.getBindings().size).toBe(0);
      expect(keyHandler.getSequence()).toEqual([]);
    });
  });

  describe('destroy', () => {
    it('should destroy the handler', () => {
      keyHandler.bind('q', vi.fn());
      keyHandler.destroy();

      expect(keyHandler.getBindings().size).toBe(0);
    });
  });
});

describe('InputHandler', () => {
  let inputHandler: InputHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    inputHandler = new InputHandler(mockScreen as unknown as blessed.Widgets.Screen);
  });

  afterEach(() => {
    inputHandler.destroy();
  });

  describe('prompt', () => {
    it('should create a textbox and return submitted value', async () => {
      // Setup mock to capture the submit handler
      let submitHandler: (value: string) => void;
      mockTextboxOn.mockImplementation((event: string, handler: (value: string) => void) => {
        if (event === 'submit') {
          submitHandler = handler;
        }
      });

      const promptPromise = inputHandler.prompt('Enter name');

      // Simulate user submitting 'test'
      submitHandler!('test');

      const result = await promptPromise;
      expect(result).toBe('test');
    });

    it('should return null when cancelled', async () => {
      let cancelHandler: () => void;
      mockTextboxOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'cancel') {
          cancelHandler = handler;
        }
      });

      const promptPromise = inputHandler.prompt('Enter name');

      cancelHandler!();

      const result = await promptPromise;
      expect(result).toBeNull();
    });

    it('should set default value if provided', async () => {
      let submitHandler: (value: string) => void;
      mockTextboxOn.mockImplementation((event: string, handler: (value: string) => void) => {
        if (event === 'submit') {
          submitHandler = handler;
        }
      });

      const promptPromise = inputHandler.prompt('Enter name', 'default');

      expect(mockTextboxSetValue).toHaveBeenCalledWith('default');

      submitHandler!('default');
      await promptPromise;
    });
  });

  describe('confirm', () => {
    it('should return true for yes/y/true responses', async () => {
      mockQuestionAsk.mockImplementation(
        (_msg: string, callback: (err: unknown, value: string) => void) => {
          callback(null, 'yes');
        }
      );

      const result = await inputHandler.confirm('Are you sure?');
      expect(result).toBe(true);
    });

    it('should return false for other responses', async () => {
      mockQuestionAsk.mockImplementation(
        (_msg: string, callback: (err: unknown, value: string) => void) => {
          callback(null, 'no');
        }
      );

      const result = await inputHandler.confirm('Are you sure?');
      expect(result).toBe(false);
    });
  });
});

describe('STANDARD_KEYS', () => {
  it('should have quit keys', () => {
    expect(STANDARD_KEYS.QUIT).toEqual(['q', 'C-c']);
  });

  it('should have navigation keys', () => {
    expect(STANDARD_KEYS.NEXT).toContain('tab');
    expect(STANDARD_KEYS.UP).toContain('k');
    expect(STANDARD_KEYS.DOWN).toContain('j');
  });

  it('should have control keys', () => {
    expect(STANDARD_KEYS.PAUSE).toEqual(['p']);
    expect(STANDARD_KEYS.RESUME).toEqual(['r']);
    expect(STANDARD_KEYS.INTERVENE).toEqual(['i']);
  });
});

describe('KeyMapPresets', () => {
  it('should have vim preset', () => {
    expect(KeyMapPresets.vim).toBeDefined();
    expect(KeyMapPresets.vim.navigation.up).toContain('k');
    expect(KeyMapPresets.vim.navigation.down).toContain('j');
  });

  it('should have emacs preset', () => {
    expect(KeyMapPresets.emacs).toBeDefined();
    expect(KeyMapPresets.emacs.navigation.up).toContain('C-p');
  });

  it('should have tmux preset', () => {
    expect(KeyMapPresets.tmux).toBeDefined();
    expect(KeyMapPresets.tmux.panes).toBeDefined();
  });
});
