import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Panel } from './panel';
import panelStyles from './panel.css?inline';

declare global { interface Window { __codeTrailMounted?: boolean } }

if (!window.__codeTrailMounted) {
  window.__codeTrailMounted = true;
  const host = document.createElement('div');
  host.id = 'codetrail-extension-host';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.append(host);
  const mount = document.createElement('div');
  shadow.append(mount);
  let setVisible: (value: boolean | ((current: boolean) => boolean)) => void = () => undefined;

  function Root() {
    const [visible, updateVisible] = useState(false);
    setVisible = updateVisible;
    return <><style>{panelStyles}</style><Panel visible={visible} onClose={() => updateVisible(false)} /></>;
  }
  createRoot(mount).render(<Root />);
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type === 'TOGGLE_PANEL') setVisible((current) => !current);
    if (message.type === 'SHOW_PANEL') setVisible(true);
    if (message.type === 'HIDE_PANEL') setVisible(false);
  });
  void chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).then((response: { ok: boolean; result?: { show: boolean } }) => { if (response.ok && response.result?.show) setVisible(true); }).catch(() => undefined);
}
