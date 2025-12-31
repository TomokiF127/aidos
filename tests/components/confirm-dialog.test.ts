/**
 * AIDOS Confirm Dialog Component Tests
 *
 * Tests for the dialog creation and interaction
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock blessed before importing the module
const mockBoxFocus = vi.fn();
const mockBoxDestroy = vi.fn();

const mockBox = {
  focus: mockBoxFocus,
  destroy: mockBoxDestroy,
};

const mockButtonOn = vi.fn();
const mockButtonFocus = vi.fn();

const mockButton = {
  on: mockButtonOn,
  focus: mockButtonFocus,
};

const mockTextSetContent = vi.fn();

const mockText = {
  setContent: mockTextSetContent,
};

const mockScreenRender = vi.fn();
const mockScreenKey = vi.fn();
const mockScreenUnkey = vi.fn();

const mockScreen = {
  render: mockScreenRender,
  key: mockScreenKey,
  unkey: mockScreenUnkey,
};

vi.mock('blessed', () => ({
  default: {
    screen: vi.fn(() => mockScreen),
    box: vi.fn(() => ({ ...mockBox })),
    text: vi.fn(() => ({ ...mockText })),
    button: vi.fn(() => ({ ...mockButton })),
  },
}));

// Import after mocking
import {
  ConfirmDialog,
  ConfirmDialogBuilder,
  DEFAULT_BUTTONS,
  confirm,
  alert,
  promptApproval,
  promptThreeWay,
  promptRetry,
  dialog,
} from '../../src/components/confirm-dialog.js';
import type {
  DialogResult,
  DialogButton,
  ConfirmDialogConfig,
  ConfirmDialogResult,
} from '../../src/components/confirm-dialog.js';
import type blessed from 'blessed';

describe('ConfirmDialog', () => {
  let confirmDialog: ConfirmDialog;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    confirmDialog = new ConfirmDialog(mockScreen as unknown as blessed.Widgets.Screen);
  });

  afterEach(() => {
    confirmDialog.destroy();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a ConfirmDialog', () => {
      expect(confirmDialog).toBeDefined();
      expect(confirmDialog.isOpen()).toBe(false);
    });
  });

  describe('show', () => {
    it('should show a dialog with default buttons', async () => {
      // Setup: capture the first button press handler to simulate click
      const pressHandlers: Array<() => void> = [];
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandlers.push(handler);
        }
      });

      const showPromise = confirmDialog.show({
        title: 'Test Dialog',
        message: 'Are you sure?',
      });

      // Simulate pressing the first button (Yes) - first handler in array
      pressHandlers[0]!();

      const result = await showPromise;

      expect(result.button).toBe('yes');
      expect(result.timedOut).toBe(false);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should show dialog with custom buttons', async () => {
      const customButtons: DialogButton[] = [
        { label: 'Accept', value: 'accept', shortcut: 'a', style: { fg: 'black', bg: 'blue' } },
        { label: 'Decline', value: 'decline', shortcut: 'd', style: { fg: 'black', bg: 'gray' } },
      ];

      const pressHandlers: Array<() => void> = [];
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandlers.push(handler);
        }
      });

      const showPromise = confirmDialog.show({
        title: 'Custom Dialog',
        message: 'Choose wisely',
        buttons: customButtons,
      });

      // First button is Accept
      pressHandlers[0]!();

      const result = await showPromise;
      expect(result.button).toBe('accept');
    });

    it('should handle timeout and auto-select default', async () => {
      const showPromise = confirmDialog.show({
        title: 'Timeout Dialog',
        message: 'This will timeout',
        timeoutMs: 5000,
        defaultOnTimeout: 'yes',
        showCountdown: true,
      });

      // Advance time past timeout
      vi.advanceTimersByTime(6000);

      const result = await showPromise;

      expect(result.button).toBe('yes');
      expect(result.timedOut).toBe(true);
    });

    it('should update countdown display', async () => {
      const showPromise = confirmDialog.show({
        title: 'Countdown Dialog',
        message: 'Watch the countdown',
        timeoutMs: 5000,
        showCountdown: true,
      });

      // Advance time by 1 second
      vi.advanceTimersByTime(1000);

      expect(mockTextSetContent).toHaveBeenCalled();

      // Complete the timeout
      vi.advanceTimersByTime(5000);
      await showPromise;
    });

    it('should support different dialog types', async () => {
      const types: Array<'info' | 'warning' | 'error' | 'question'> = [
        'info',
        'warning',
        'error',
        'question',
      ];

      for (const type of types) {
        vi.clearAllMocks();

        let pressHandler: () => void;
        mockButtonOn.mockImplementation((event: string, handler: () => void) => {
          if (event === 'press') {
            pressHandler = handler;
          }
        });

        const dialog = new ConfirmDialog(mockScreen as unknown as blessed.Widgets.Screen);
        const showPromise = dialog.show({
          title: `${type} Dialog`,
          message: `This is a ${type} dialog`,
          type,
          buttons: DEFAULT_BUTTONS.OK,
        });

        pressHandler!();

        const result = await showPromise;
        expect(result.button).toBe('ok');
        dialog.destroy();
      }
    });

    it('should handle shortcut keys', async () => {
      // Store key handlers
      const keyHandlers: Map<string[], () => void> = new Map();
      mockScreenKey.mockImplementation((keys: string[], handler: () => void) => {
        keyHandlers.set(keys, handler);
      });

      const showPromise = confirmDialog.show({
        title: 'Shortcut Dialog',
        message: 'Press Y or N',
        buttons: DEFAULT_BUTTONS.YES_NO,
      });

      // Find and call the 'y' key handler
      for (const [keys, handler] of keyHandlers) {
        if (keys.includes('y') || keys.includes('Y')) {
          handler();
          break;
        }
      }

      const result = await showPromise;
      expect(result.button).toBe('yes');
    });

    it('should handle escape key as cancel', async () => {
      const keyHandlers: Map<string[], () => void> = new Map();
      mockScreenKey.mockImplementation((keys: string[], handler: () => void) => {
        keyHandlers.set(keys, handler);
      });

      const showPromise = confirmDialog.show({
        title: 'Escape Dialog',
        message: 'Press escape to cancel',
        buttons: DEFAULT_BUTTONS.YES_NO_CANCEL,
      });

      // Find and call the escape key handler
      for (const [keys, handler] of keyHandlers) {
        if (keys.includes('escape')) {
          handler();
          break;
        }
      }

      const result = await showPromise;
      // Escape triggers last button (cancel) or 'no' if no cancel button
      expect(['cancel', 'no']).toContain(result.button);
    });

    it('should handle enter key for default button', async () => {
      const keyHandlers: Map<string[], () => void> = new Map();
      mockScreenKey.mockImplementation((keys: string[], handler: () => void) => {
        keyHandlers.set(keys, handler);
      });

      const showPromise = confirmDialog.show({
        title: 'Enter Dialog',
        message: 'Press enter',
        buttons: DEFAULT_BUTTONS.OK_CANCEL,
      });

      // Find and call the enter key handler
      for (const [keys, handler] of keyHandlers) {
        if (keys.includes('enter')) {
          handler();
          break;
        }
      }

      const result = await showPromise;
      expect(result.button).toBe('ok'); // OK is the default
    });

    it('should handle tab navigation between buttons', async () => {
      const keyHandlers: Map<string[], () => void> = new Map();
      mockScreenKey.mockImplementation((keys: string[], handler: () => void) => {
        keyHandlers.set(keys, handler);
      });

      let pressHandler: () => void;
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandler = handler;
        }
      });

      const showPromise = confirmDialog.show({
        title: 'Tab Dialog',
        message: 'Use tab to navigate',
        buttons: DEFAULT_BUTTONS.YES_NO,
      });

      // Tab through buttons
      for (const [keys, handler] of keyHandlers) {
        if (keys.includes('tab')) {
          handler();
          break;
        }
      }

      expect(mockButtonFocus).toHaveBeenCalled();

      // Complete the dialog
      pressHandler!();
      await showPromise;
    });
  });

  describe('isOpen', () => {
    it('should return false when dialog is not open', () => {
      expect(confirmDialog.isOpen()).toBe(false);
    });

    it('should return true when dialog is open', () => {
      let pressHandler: () => void;
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandler = handler;
        }
      });

      confirmDialog.show({
        title: 'Test',
        message: 'Test',
      });

      expect(confirmDialog.isOpen()).toBe(true);

      // Clean up
      pressHandler!();
    });
  });

  describe('close', () => {
    it('should force close the dialog', () => {
      confirmDialog.show({
        title: 'Test',
        message: 'Test',
      });

      confirmDialog.close();

      expect(confirmDialog.isOpen()).toBe(false);
      expect(mockBoxDestroy).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should clean up all resources', () => {
      confirmDialog.show({
        title: 'Test',
        message: 'Test',
      });

      confirmDialog.destroy();

      expect(mockBoxDestroy).toHaveBeenCalled();
    });
  });
});

describe('DEFAULT_BUTTONS', () => {
  it('should have YES_NO buttons', () => {
    expect(DEFAULT_BUTTONS.YES_NO).toHaveLength(2);
    expect(DEFAULT_BUTTONS.YES_NO[0].value).toBe('yes');
    expect(DEFAULT_BUTTONS.YES_NO[1].value).toBe('no');
  });

  it('should have YES_NO_CANCEL buttons', () => {
    expect(DEFAULT_BUTTONS.YES_NO_CANCEL).toHaveLength(3);
    expect(DEFAULT_BUTTONS.YES_NO_CANCEL[0].value).toBe('yes');
    expect(DEFAULT_BUTTONS.YES_NO_CANCEL[1].value).toBe('no');
    expect(DEFAULT_BUTTONS.YES_NO_CANCEL[2].value).toBe('cancel');
  });

  it('should have OK_CANCEL buttons', () => {
    expect(DEFAULT_BUTTONS.OK_CANCEL).toHaveLength(2);
    expect(DEFAULT_BUTTONS.OK_CANCEL[0].value).toBe('ok');
    expect(DEFAULT_BUTTONS.OK_CANCEL[0].isDefault).toBe(true);
    expect(DEFAULT_BUTTONS.OK_CANCEL[1].value).toBe('cancel');
  });

  it('should have OK button', () => {
    expect(DEFAULT_BUTTONS.OK).toHaveLength(1);
    expect(DEFAULT_BUTTONS.OK[0].value).toBe('ok');
    expect(DEFAULT_BUTTONS.OK[0].isDefault).toBe(true);
  });

  it('should have APPROVE_REJECT buttons', () => {
    expect(DEFAULT_BUTTONS.APPROVE_REJECT).toHaveLength(2);
    expect(DEFAULT_BUTTONS.APPROVE_REJECT[0].value).toBe('approve');
    expect(DEFAULT_BUTTONS.APPROVE_REJECT[1].value).toBe('reject');
  });

  it('should have RETRY_SKIP_ABORT buttons', () => {
    expect(DEFAULT_BUTTONS.RETRY_SKIP_ABORT).toHaveLength(3);
    expect(DEFAULT_BUTTONS.RETRY_SKIP_ABORT[0].value).toBe('retry');
    expect(DEFAULT_BUTTONS.RETRY_SKIP_ABORT[1].value).toBe('skip');
    expect(DEFAULT_BUTTONS.RETRY_SKIP_ABORT[2].value).toBe('abort');
  });

  it('should have shortcuts for all buttons', () => {
    const allButtons = [
      ...DEFAULT_BUTTONS.YES_NO,
      ...DEFAULT_BUTTONS.YES_NO_CANCEL,
      ...DEFAULT_BUTTONS.OK_CANCEL,
      ...DEFAULT_BUTTONS.OK,
      ...DEFAULT_BUTTONS.APPROVE_REJECT,
      ...DEFAULT_BUTTONS.RETRY_SKIP_ABORT,
    ];

    allButtons.forEach((button) => {
      expect(button.shortcut).toBeDefined();
      expect(button.shortcut!.length).toBe(1);
    });
  });
});

describe('ConfirmDialogBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('chaining methods', () => {
    it('should support method chaining', () => {
      const builder = new ConfirmDialogBuilder('Test Title');

      const result = builder
        .message('Test message')
        .yesNo()
        .type('warning')
        .size('60%', 10)
        .borderColor('yellow');

      expect(result).toBe(builder);
    });

    it('should set message', () => {
      const builder = new ConfirmDialogBuilder('Title');
      builder.message('Custom message');

      // Builder stores config internally
      expect(builder).toBeDefined();
    });

    it('should set yesNo buttons', () => {
      const builder = new ConfirmDialogBuilder('Title');
      builder.yesNo();

      expect(builder).toBeDefined();
    });

    it('should set yesNoCancel buttons', () => {
      const builder = new ConfirmDialogBuilder('Title');
      builder.yesNoCancel();

      expect(builder).toBeDefined();
    });

    it('should set okCancel buttons', () => {
      const builder = new ConfirmDialogBuilder('Title');
      builder.okCancel();

      expect(builder).toBeDefined();
    });

    it('should set custom buttons', () => {
      const builder = new ConfirmDialogBuilder('Title');
      const customButtons: DialogButton[] = [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ];
      builder.buttons(customButtons);

      expect(builder).toBeDefined();
    });

    it('should set timeout', () => {
      const builder = new ConfirmDialogBuilder('Title');
      builder.timeout(5000, 'yes');

      expect(builder).toBeDefined();
    });

    it('should set type', () => {
      const builder = new ConfirmDialogBuilder('Title');
      builder.type('error');

      expect(builder).toBeDefined();
    });

    it('should set size', () => {
      const builder = new ConfirmDialogBuilder('Title');
      builder.size('50%', 'shrink');

      expect(builder).toBeDefined();
    });

    it('should set borderColor', () => {
      const builder = new ConfirmDialogBuilder('Title');
      builder.borderColor('red');

      expect(builder).toBeDefined();
    });
  });

  describe('show', () => {
    it('should show dialog with configured options', async () => {
      let pressHandler: () => void;
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandler = handler;
        }
      });

      const showPromise = new ConfirmDialogBuilder('Builder Test')
        .message('Built with builder')
        .yesNo()
        .type('question')
        .show(mockScreen as unknown as blessed.Widgets.Screen);

      pressHandler!();

      const result = await showPromise;
      expect(result.button).toBeDefined();
    });
  });
});

describe('dialog helper function', () => {
  it('should create a ConfirmDialogBuilder', () => {
    const builder = dialog('Helper Title');

    expect(builder).toBeInstanceOf(ConfirmDialogBuilder);
  });
});

describe('Helper functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('confirm', () => {
    it('should return true when yes is selected', async () => {
      const pressHandlers: Array<() => void> = [];
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandlers.push(handler);
        }
      });

      const confirmPromise = confirm(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Are you sure?'
      );

      // First button is Yes
      pressHandlers[0]!();

      const result = await confirmPromise;
      expect(result).toBe(true);
    });

    it('should return false when no is selected', async () => {
      // Track button creation to simulate pressing "No" button
      let buttonIndex = 0;
      let noButtonPressHandler: () => void;

      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          if (buttonIndex === 1) {
            // Second button is "No"
            noButtonPressHandler = handler;
          }
          buttonIndex++;
        }
      });

      const confirmPromise = confirm(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Are you sure?'
      );

      noButtonPressHandler!();

      const result = await confirmPromise;
      expect(result).toBe(false);
    });

    it('should accept custom title', async () => {
      let pressHandler: () => void;
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandler = handler;
        }
      });

      const confirmPromise = confirm(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Delete file?',
        'Delete Confirmation'
      );

      pressHandler!();
      await confirmPromise;
    });
  });

  describe('alert', () => {
    it('should show alert and resolve when OK is pressed', async () => {
      let pressHandler: () => void;
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandler = handler;
        }
      });

      const alertPromise = alert(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Operation completed!'
      );

      pressHandler!();

      await expect(alertPromise).resolves.toBeUndefined();
    });

    it('should support different alert types', async () => {
      const types: Array<'info' | 'warning' | 'error'> = ['info', 'warning', 'error'];

      for (const type of types) {
        let pressHandler: () => void;
        mockButtonOn.mockImplementation((event: string, handler: () => void) => {
          if (event === 'press') {
            pressHandler = handler;
          }
        });

        const alertPromise = alert(
          mockScreen as unknown as blessed.Widgets.Screen,
          `${type} message`,
          `${type} Title`,
          type
        );

        pressHandler!();
        await alertPromise;
      }
    });
  });

  describe('promptApproval', () => {
    it('should return approved true when approve is selected', async () => {
      const pressHandlers: Array<() => void> = [];
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandlers.push(handler);
        }
      });

      const approvalPromise = promptApproval(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Approve this action?'
      );

      // First button is Approve
      pressHandlers[0]!();

      const result = await approvalPromise;
      expect(result.approved).toBe(true);
      expect(result.timedOut).toBe(false);
    });

    it('should return approved false when rejected', async () => {
      let buttonIndex = 0;
      let rejectHandler: () => void;

      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          if (buttonIndex === 1) {
            rejectHandler = handler;
          }
          buttonIndex++;
        }
      });

      const approvalPromise = promptApproval(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Approve this action?'
      );

      rejectHandler!();

      const result = await approvalPromise;
      expect(result.approved).toBe(false);
    });

    it('should support timeout', async () => {
      const approvalPromise = promptApproval(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Approve this action?',
        {
          timeoutMs: 3000,
          defaultOnTimeout: 'reject',
        }
      );

      vi.advanceTimersByTime(4000);

      const result = await approvalPromise;
      expect(result.timedOut).toBe(true);
      expect(result.approved).toBe(false);
    });
  });

  describe('promptThreeWay', () => {
    it('should return yes when yes is selected', async () => {
      const pressHandlers: Array<() => void> = [];
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandlers.push(handler);
        }
      });

      const threeWayPromise = promptThreeWay(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Choose an option'
      );

      // First button is Yes
      pressHandlers[0]!();

      const result = await threeWayPromise;
      expect(result).toBe('yes');
    });

    it('should support custom button labels', async () => {
      let pressHandler: () => void;
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandler = handler;
        }
      });

      const threeWayPromise = promptThreeWay(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Choose an option',
        {
          title: 'Custom Title',
          yesLabel: 'Confirm',
          noLabel: 'Deny',
          cancelLabel: 'Skip',
        }
      );

      pressHandler!();
      await threeWayPromise;
    });
  });

  describe('promptRetry', () => {
    it('should return retry when retry is selected', async () => {
      const pressHandlers: Array<() => void> = [];
      mockButtonOn.mockImplementation((event: string, handler: () => void) => {
        if (event === 'press') {
          pressHandlers.push(handler);
        }
      });

      const retryPromise = promptRetry(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Operation failed. What do you want to do?'
      );

      // First button is Retry
      pressHandlers[0]!();

      const result = await retryPromise;
      expect(result).toBe('retry');
    });

    it('should support timeout with default', async () => {
      const retryPromise = promptRetry(
        mockScreen as unknown as blessed.Widgets.Screen,
        'Operation failed',
        {
          timeoutMs: 5000,
          defaultOnTimeout: 'skip',
        }
      );

      vi.advanceTimersByTime(6000);

      const result = await retryPromise;
      expect(result).toBe('skip');
    });
  });
});

describe('DialogButton interface', () => {
  it('should support all properties', () => {
    const button: DialogButton = {
      label: 'Test Button',
      value: 'test',
      shortcut: 't',
      style: {
        fg: 'white',
        bg: 'blue',
      },
      isDefault: true,
    };

    expect(button.label).toBe('Test Button');
    expect(button.value).toBe('test');
    expect(button.shortcut).toBe('t');
    expect(button.style?.fg).toBe('white');
    expect(button.style?.bg).toBe('blue');
    expect(button.isDefault).toBe(true);
  });

  it('should work with minimal properties', () => {
    const button: DialogButton = {
      label: 'Minimal',
      value: 'min',
    };

    expect(button.label).toBe('Minimal');
    expect(button.value).toBe('min');
    expect(button.shortcut).toBeUndefined();
    expect(button.style).toBeUndefined();
    expect(button.isDefault).toBeUndefined();
  });
});

describe('ConfirmDialogConfig interface', () => {
  it('should support all properties', () => {
    const config: ConfirmDialogConfig = {
      title: 'Config Test',
      message: 'Test message',
      buttons: DEFAULT_BUTTONS.YES_NO,
      width: '50%',
      height: 10,
      timeoutMs: 5000,
      defaultOnTimeout: 'yes',
      showCountdown: true,
      borderColor: 'cyan',
      type: 'warning',
    };

    expect(config.title).toBe('Config Test');
    expect(config.message).toBe('Test message');
    expect(config.buttons).toEqual(DEFAULT_BUTTONS.YES_NO);
    expect(config.width).toBe('50%');
    expect(config.height).toBe(10);
    expect(config.timeoutMs).toBe(5000);
    expect(config.defaultOnTimeout).toBe('yes');
    expect(config.showCountdown).toBe(true);
    expect(config.borderColor).toBe('cyan');
    expect(config.type).toBe('warning');
  });
});

describe('ConfirmDialogResult interface', () => {
  it('should contain all result properties', () => {
    const result: ConfirmDialogResult = {
      button: 'yes',
      timedOut: false,
      elapsedMs: 1500,
    };

    expect(result.button).toBe('yes');
    expect(result.timedOut).toBe(false);
    expect(result.elapsedMs).toBe(1500);
  });
});
