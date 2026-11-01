import { configurationError, githubAppConfig } from './auth-config';
import { connectGitHubApp, tokenExpired } from './github-auth';
import { github, GitHubApiError } from './github';
import { togglePanelInTab } from './panel-toggle';
import type { PanelMessage, Preferences } from './types';

interface StoredAuth { token: string; user: { login: string; avatar_url: string }; expiresAt?: number }

const defaults: Preferences = { keepPanelOpen: false, rememberKeepPanelOpen: true, preferredLanguage: 'Python' };
const isHackerRankUrl = (url?: string) => Boolean(url && /^https:\/\/[^/]*hackerrank\.com\//i.test(url));

chrome.action.onClicked.addListener((tab) => {
  void toggleTabPanel(tab.id, tab.url).catch((error: unknown) => console.error('Quick Push toolbar action failed:', error));
});
chrome.tabs.onRemoved.addListener((tabId) => { void chrome.storage.session.remove(`persistent:${tabId}`); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !isHackerRankUrl(changeInfo.url)) void chrome.storage.session.remove(`persistent:${tabId}`);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isPanelMessage(message)) return;
  const isConnectMessage = message.type === 'CONNECT_GITHUB_APP';
  if (isConnectMessage) console.info('Quick Push: Background received CONNECT_GITHUB_APP.');
  void handleMessage(message, sender.tab?.id).then(
    (result) => sendResponse({ ok: true, result }),
    async (error: unknown) => {
      if (error instanceof GitHubApiError && error.status === 401) await chrome.storage.session.remove('auth');
      if (isConnectMessage) console.error('Quick Push: Returning GitHub connection error to panel:', friendlyError(error));
      sendResponse({ ok: false, error: friendlyError(error) });
    }
  );
  return true;
});

async function toggleTabPanel(tabId: number | undefined, url: string | undefined): Promise<void> {
  if (!tabId || !isHackerRankUrl(url)) return;
  await togglePanelInTab(tabId, chrome);
}

async function handleMessage(message: PanelMessage, tabId?: number): Promise<unknown> {
  switch (message.type) {
    case 'TOGGLE_PANEL': case 'SHOW_PANEL': case 'HIDE_PANEL':
      return undefined;
    case 'CONTENT_READY':
      return { show: tabId ? Boolean((await chrome.storage.session.get(`persistent:${tabId}`))[`persistent:${tabId}`]) : false };
    case 'GET_STATE':
      return { persistentActive: tabId ? Boolean((await chrome.storage.session.get(`persistent:${tabId}`))[`persistent:${tabId}`]) : false };
    case 'GET_PREFERENCES':
      return loadPreferences();
    case 'SAVE_PREFERENCES': {
      const current = await loadPreferences();
      const next = { ...current, ...message.preferences };
      await chrome.storage.local.set(next);
      if (tabId && typeof message.preferences.keepPanelOpen === 'boolean') {
        if (next.keepPanelOpen) await chrome.storage.session.set({ [`persistent:${tabId}`]: true });
        else await chrome.storage.session.remove(`persistent:${tabId}`);
      }
      return next;
    }
    case 'GET_AUTH_STATUS': {
      const auth = await getAuth();
      return auth ? { connected: true, user: auth.user } : { connected: false };
    }
    case 'CONNECT_GITHUB_APP': return connectAccount();
    case 'DISCONNECT':
      await chrome.storage.session.remove(['auth', 'githubAuthorizationState']);
      return undefined;
    case 'LIST_REPOSITORIES': return github.repositories((await requireAuth()).token);
    case 'LIST_BRANCHES': return github.branches((await requireAuth()).token, message.repository);
    case 'SUGGEST_FILENAME': return github.suggestedFilename((await requireAuth()).token, message.repository, message.branch, message.extension);
    case 'PUSH_FILE': return github.createFile((await requireAuth()).token, message.repository, message.branch, message.filename, message.code);
  }
}

async function connectAccount(): Promise<{ user: StoredAuth['user'] }> {
  console.info('Quick Push: Starting GitHub connection.');
  const configurationIssue = configurationError(githubAppConfig);
  if (configurationIssue) throw new Error(configurationIssue);
  const redirectUri = chrome.identity.getRedirectURL('github/callback');
  console.info('Quick Push: Chrome identity redirect URI:', redirectUri);
  console.info('Quick Push: Redirect URI matches expected callback:', redirectUri === 'https://kkoffhinmcekbidknbedpphkpgibeoen.chromiumapp.org/github/callback');
  const result = await connectGitHubApp(githubAppConfig, {
    redirectUri,
    session: chrome.storage.session,
    fetch,
    diagnosticLog: (stage) => console.info(`Quick Push: ${stage}`),
    diagnosticError: (stage, error) => console.error(`Quick Push: ${stage}`, error),
    openAuthorizationUrlForDiagnostics: async (url) => {
      await chrome.tabs.create({ url, active: true });
      console.info('Quick Push: Temporary diagnostic opened authorization in a normal tab. Do not authorize; close the tab after observing the page.');
    },
    launchWebAuthFlow: (details) => new Promise<string | undefined>((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(details, (callbackUrl) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message || 'Chrome identity authorization failed.'));
          return;
        }
        resolve(callbackUrl);
      });
    })
  });
  const user = await github.user(result.accessToken);
  const auth: StoredAuth = { token: result.accessToken, user, expiresAt: result.expiresAt };
  await chrome.storage.session.set({ auth });
  return { user };
}

async function getAuth(): Promise<StoredAuth | undefined> {
  const auth = (await chrome.storage.session.get('auth')).auth as StoredAuth | undefined;
  if (auth && tokenExpired(auth.expiresAt)) { await chrome.storage.session.remove('auth'); return undefined; }
  return auth;
}

async function requireAuth(): Promise<StoredAuth> {
  const auth = await getAuth();
  if (!auth) throw new GitHubApiError(401, 'GitHub connection expired or was revoked. Reconnect your account.');
  return auth;
}

async function loadPreferences(): Promise<Preferences> {
  const stored = await chrome.storage.local.get(['keepPanelOpen', 'rememberKeepPanelOpen', 'preferredLanguage', 'selectedRepository', 'selectedBranch']);
  return { ...defaults, ...stored } as Preferences;
}

function isPanelMessage(value: unknown): value is PanelMessage { return typeof value === 'object' && value !== null && 'type' in value && typeof (value as { type?: unknown }).type === 'string'; }
function friendlyError(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
