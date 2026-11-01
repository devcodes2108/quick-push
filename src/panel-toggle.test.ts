import { describe, expect, it, vi } from 'vitest';
import { togglePanelInTab } from './panel-toggle';

describe('toolbar panel messaging', () => {
  it('toggles an initialized content script without injecting again', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const executeScript = vi.fn();
    await expect(togglePanelInTab(3, { tabs: { sendMessage }, scripting: { executeScript } })).resolves.toBe('sent');
    expect(sendMessage).toHaveBeenCalledWith(3, { type: 'TOGGLE_PANEL' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('injects then shows the panel when no receiver exists', async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('Receiving end does not exist')).mockResolvedValueOnce(undefined);
    const executeScript = vi.fn().mockResolvedValue(undefined);
    await expect(togglePanelInTab(3, { tabs: { sendMessage }, scripting: { executeScript } })).resolves.toBe('injected');
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 3 }, files: ['assets/content.js'] });
    expect(sendMessage).toHaveBeenLastCalledWith(3, { type: 'SHOW_PANEL' });
  });

  it('surfaces an initialization failure with both causes', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('no receiver'));
    const executeScript = vi.fn().mockRejectedValue(new Error('blocked'));
    await expect(togglePanelInTab(3, { tabs: { sendMessage }, scripting: { executeScript } })).rejects.toThrow('no receiver; blocked');
  });
});
