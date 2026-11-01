export interface PanelTabApi {
  tabs: { sendMessage(tabId: number, message: { type: 'TOGGLE_PANEL' | 'SHOW_PANEL' }): Promise<unknown> };
  scripting: { executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown> };
}

export async function togglePanelInTab(tabId: number, api: PanelTabApi): Promise<'sent' | 'injected'> {
  try {
    await api.tabs.sendMessage(tabId, { type: 'TOGGLE_PANEL' });
    return 'sent';
  } catch (initialError) {
    try {
      await api.scripting.executeScript({ target: { tabId }, files: ['assets/content.js'] });
      await api.tabs.sendMessage(tabId, { type: 'SHOW_PANEL' });
      return 'injected';
    } catch (injectionError) {
      const initialMessage = initialError instanceof Error ? initialError.message : 'no content-script receiver';
      const injectionMessage = injectionError instanceof Error ? injectionError.message : 'script injection failed';
      throw new Error(`Quick Push could not initialize on this page (${initialMessage}; ${injectionMessage}).`, { cause: injectionError });
    }
  }
}
