import { useEffect, useMemo, useState } from 'react';
import type { Language, PanelMessage, Preferences, Repository } from './types';
import { extensionFor, languageExtensions, validateFilename, withLanguageExtension } from './filename-ui';

type Notice = { kind: 'error' | 'success'; text: string; fileUrl?: string; commitUrl?: string };
const languages = Object.keys(languageExtensions) as Language[];

async function rpc<T>(message: PanelMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as { ok: boolean; result: T; error?: string };
  if (!response.ok) throw new Error(response.error || 'Request failed.');
  return response.result;
}

export function Panel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [preferences, setPreferences] = useState<Preferences>({ keepPanelOpen: false, rememberKeepPanelOpen: true, preferredLanguage: 'Python' });
  const [connected, setConnected] = useState<{ login: string; avatar_url: string }>();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repository, setRepository] = useState<Repository>();
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [language, setLanguage] = useState<Language>('Python');
  const [filename, setFilename] = useState('solution-001.py');
  const [filenameTouched, setFilenameTouched] = useState(false);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { void initialise(); }, []);

  const fileError = validateFilename(filename);
  const canPush = Boolean(connected && repository && branch && filename && code && !fileError && !busy);
  const repositoryLabel = useMemo(() => repository ? `${repository.full_name} · ${branch || 'choose branch'}` : 'No repository selected', [repository, branch]);

  async function initialise(): Promise<void> {
    try {
      const saved = await rpc<Preferences>({ type: 'GET_PREFERENCES' });
      setPreferences(saved); setLanguage(saved.preferredLanguage); setFilename(withLanguageExtension('solution-001', extensionFor(saved.preferredLanguage)));
      if (saved.selectedRepository) { setRepository(saved.selectedRepository); setBranch(saved.selectedBranch || saved.selectedRepository.default_branch); }
      const status = await rpc<{ connected: boolean; user?: { login: string; avatar_url: string } }>({ type: 'GET_AUTH_STATUS' });
      if (status.connected && status.user) { setConnected(status.user); await loadRepositories(saved.selectedRepository?.id, saved.selectedBranch); }
    } catch (error) { setNotice({ kind: 'error', text: (error as Error).message }); }
  }

  async function loadRepositories(selectedId?: number, selectedBranch?: string): Promise<void> {
    try {
      const items = await rpc<Repository[]>({ type: 'LIST_REPOSITORIES' });
      setRepositories(items);
      const selected = items.find((item) => item.id === selectedId) || repository;
      if (selected) await chooseRepository(selected, selectedBranch);
      if (!items.length) setNotice({ kind: 'error', text: 'No accessible repositories found. Grant repository access on GitHub, then refresh.' });
    } catch (error) { setNotice({ kind: 'error', text: (error as Error).message }); }
  }

  async function chooseRepository(next: Repository, rememberedBranch?: string): Promise<void> {
    setRepository(next); setBranches([]); setBranch(''); setNotice(undefined);
    try {
      const result = await rpc<Array<{ name: string }>>({ type: 'LIST_BRANCHES', repository: next.full_name });
      const names = result.map((item) => item.name);
      setBranches(names);
      const selectedBranch = names.includes(rememberedBranch || preferences.selectedBranch || '') ? (rememberedBranch || preferences.selectedBranch)! : next.default_branch;
      if (!names.includes(selectedBranch)) { setNotice({ kind: 'error', text: 'This repository has no usable default branch. Create an initial commit on GitHub first.' }); return; }
      setBranch(selectedBranch);
      await savePreferences({ selectedRepository: next, selectedBranch });
      await suggest(next.full_name, selectedBranch, language);
    } catch (error) { setNotice({ kind: 'error', text: (error as Error).message }); }
  }

  async function chooseBranch(nextBranch: string): Promise<void> {
    setBranch(nextBranch); await savePreferences({ selectedBranch: nextBranch });
    if (repository) await suggest(repository.full_name, nextBranch, language);
  }

  async function suggest(repo: string, targetBranch: string, targetLanguage: Language): Promise<void> {
    if (filenameTouched) return;
    try { setFilename(await rpc<string>({ type: 'SUGGEST_FILENAME', repository: repo, branch: targetBranch, extension: extensionFor(targetLanguage) })); }
    catch (error) { setNotice({ kind: 'error', text: `${(error as Error).message} Using a fallback filename.` }); setFilename(withLanguageExtension('solution-001', extensionFor(targetLanguage))); }
  }

  async function savePreferences(changes: Partial<Preferences>): Promise<void> {
    const next = await rpc<Preferences>({ type: 'SAVE_PREFERENCES', preferences: changes });
    setPreferences(next);
  }

  async function changeLanguage(next: Language): Promise<void> {
    setLanguage(next); await savePreferences({ preferredLanguage: next });
    if (!filenameTouched) { if (repository && branch) await suggest(repository.full_name, branch, next); else setFilename(withLanguageExtension(filename, extensionFor(next))); }
  }

  async function connect(): Promise<void> {
    console.info('Quick Push: Connect button clicked.');
    setBusy(true); setNotice(undefined);
    try {
      console.info('Quick Push: Sending CONNECT_GITHUB_APP message.');
      const result = await rpc<{ user: { login: string; avatar_url: string } }>({ type: 'CONNECT_GITHUB_APP' });
      setConnected(result.user);
      await loadRepositories();
      setNotice({ kind: 'success', text: `Connected as ${result.user.login}.` });
    } catch (error) {
      console.error('Quick Push: GitHub connection request failed:', error instanceof Error ? error.message : String(error));
      setNotice({ kind: 'error', text: (error as Error).message });
    } finally { setBusy(false); }
  }

  async function push(): Promise<void> {
    if (!repository || !branch || fileError || !code.trim()) return;
    setBusy(true); setNotice(undefined);
    try {
      const result = await rpc<{ fileUrl: string; commitUrl?: string }>({ type: 'PUSH_FILE', repository: repository.full_name, branch, filename: filename.trim(), code });
      setNotice({ kind: 'success', text: `Saved ${filename.trim()} to ${repository.full_name}/${branch}.`, ...result });
    } catch (error) { setNotice({ kind: 'error', text: (error as Error).message }); }
    finally { setBusy(false); }
  }

  return <section className={`trail-panel ${visible ? 'open' : ''}`} aria-label="Quick Push panel" aria-hidden={!visible}>
    <div className="shell">
      <header className="header"><div className="brand"><span className="mark" aria-hidden="true">↗</span>Quick Push</div><button className="icon-button" onClick={onClose} aria-label="Close Quick Push">×</button></header>
      <main className="body">
        <div className="connection"><span><i className={`status-dot ${connected ? 'connected' : ''}`} />{connected ? <><strong>{connected.login}</strong> connected</> : 'GitHub not connected'}</span>{connected && <button className="text-button" onClick={() => { void rpc<void>({ type: 'DISCONNECT' }).then(() => { setConnected(undefined); setRepositories([]); }); }}>Disconnect</button>}</div>
        {!connected && <details className="settings" open><summary>Connect GitHub</summary><div className="settings-inner">
          <span className="hint">GitHub will ask you to install Quick Push for the repositories you choose, then authorize this connection. Quick Push never asks for your password.</span>
          <button onClick={() => void connect()} disabled={busy}>{busy ? 'Connecting…' : 'Connect with GitHub'}</button>
        </div></details>}
        <div className="layout-columns">
          <div className="col-config">
            <label>Repository<select value={repository?.id || ''} disabled={!connected || !repositories.length || busy} onChange={(event) => { const next = repositories.find((item) => item.id === Number(event.target.value)); if (next) void chooseRepository(next); }}><option value="">{connected ? (repositories.length ? 'Select a repository' : 'No repositories available') : 'Connect GitHub first'}</option>{repositories.map((item) => <option key={item.id} value={item.id}>{item.full_name}{item.private ? ' (private)' : ''}</option>)}</select></label>
            {connected && !repositories.length && !busy && <span className="hint">No repositories found? <button type="button" className="text-button" onClick={() => window.open('https://github.com/settings/installations', '_blank', 'noopener,noreferrer')}>Configure on GitHub</button>, then <button type="button" className="text-button" onClick={() => void loadRepositories()}>refresh</button>.</span>}
            <label>Branch<select value={branch} disabled={!repository || !branches.length || busy} onChange={(event) => void chooseBranch(event.target.value)}><option value="">Select a branch</option>{branches.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <div className="grid"><label>Language<select value={language} onChange={(event) => void changeLanguage(event.target.value as Language)} disabled={busy}>{languages.map((item) => <option key={item}>{item}</option>)}</select></label><label>Filename<input value={filename} onChange={(event) => { setFilename(event.target.value); setFilenameTouched(true); }} disabled={busy} aria-invalid={Boolean(fileError)} /></label></div>
            {fileError && <span className="hint">{fileError}</span>}
            <div className="toggles-wrapper">
              <label className="toggle"><input type="checkbox" checked={preferences.keepPanelOpen} disabled={!preferences.rememberKeepPanelOpen} onChange={(event) => void savePreferences({ keepPanelOpen: event.target.checked })} />Keep panel open</label>
              <label className="toggle"><input type="checkbox" checked={preferences.rememberKeepPanelOpen} onChange={(event) => void savePreferences(event.target.checked ? { rememberKeepPanelOpen: true } : { rememberKeepPanelOpen: false, keepPanelOpen: false })} />Remember preference</label>
            </div>
            {preferences.keepPanelOpen && <span className="hint">Close hides this view; returns on next challenge.</span>}
            <span className="hint target-preview">Target: {repositoryLabel}{filename ? ` · /${filename.trim()}` : ''}</span>
          </div>
          <div className="col-editor">
            <label className="code-field">Solution code<textarea value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste your solution here…" spellCheck={false} disabled={busy} /></label>
            {notice && <div className={`notice ${notice.kind}`}>{notice.text} {notice.fileUrl && <a href={notice.fileUrl} target="_blank" rel="noreferrer">View file</a>} {notice.commitUrl && <a href={notice.commitUrl} target="_blank" rel="noreferrer">View commit</a>}</div>}
            <div className="button-row"><button className="primary" disabled={!canPush} onClick={() => void push()}>{busy ? 'Pushing…' : 'Push to GitHub'}</button></div>
          </div>
        </div>
        {connected && <details className="settings"><summary>Connection & security</summary><div className="settings-inner"><span className="hint">The access token is kept in Chrome session storage and is cleared when the browser session ends or when you disconnect. Manage repository access from GitHub App installations.</span><button onClick={() => window.open('https://github.com/settings/installations', '_blank', 'noopener,noreferrer')}>Manage on GitHub</button></div></details>}
      </main>
    </div>
  </section>;
}
