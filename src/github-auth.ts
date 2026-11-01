import type { GitHubAppConfig } from './auth-config';

export interface AuthSessionStore {
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface AuthDependencies {
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
  session: AuthSessionStore;
  diagnosticLog?: (stage: string) => void;
  diagnosticError?: (stage: string, error: unknown) => void;
  openAuthorizationUrlForDiagnostics?: (url: string) => Promise<void>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  redirectUri: string;
}

export interface GitHubAuthResult {
  accessToken: string;
  expiresAt?: number;
}

const stateKey = 'githubAuthorizationState';

export async function connectGitHubApp(config: GitHubAppConfig, dependencies: AuthDependencies): Promise<GitHubAuthResult> {
  dependencies.diagnosticLog?.('Authentication function entered.');
  validateConfiguration(config, dependencies.redirectUri);

  const state = randomUrlSafe(32);
  const verifier = randomUrlSafe(64);
  await dependencies.session.set({ [stateKey]: { state, verifier, createdAt: Date.now() } });

  try {
    const authorizationUrl = new URL('https://github.com/login/oauth/authorize');
    authorizationUrl.searchParams.set('client_id', config.clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', dependencies.redirectUri);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', await codeChallenge(verifier));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    dependencies.diagnosticLog?.(authorizationUrlDiagnostics(authorizationUrl, dependencies.redirectUri));
    if (new URLSearchParams(globalThis.location?.search ?? '').get('quickPushOAuthDiagnostic') === 'open-tab') {
      await dependencies.openAuthorizationUrlForDiagnostics?.(authorizationUrl.toString());
      throw new Error('Temporary OAuth diagnostic: authorization page opened separately; no callback or code will be captured or exchanged.');
    }

    const authorizationCallback = await launch(dependencies, authorizationUrl);
    const code = validateCallback(authorizationCallback, dependencies.redirectUri, state);
    return await exchangeCode(config, dependencies, code, verifier);
  } finally {
    await dependencies.session.remove(stateKey);
  }
}

export function tokenExpired(expiresAt?: number, now = Date.now()): boolean {
  return Boolean(expiresAt && now >= expiresAt - 30_000);
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return bytesToUrlSafe(new Uint8Array(digest));
}

function validateConfiguration(config: GitHubAppConfig, redirectUri: string): void {
  if (!config.clientId || !config.installUrl || !config.exchangeUrl) throw new Error('GitHub connection is not configured.');
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'https:' || !redirect.hostname.endsWith('.chromiumapp.org')) throw new Error('Chrome authorization redirect is invalid.');
}

function authorizationUrlDiagnostics(url: URL, redirectUri: string): string {
  const expectedRedirectUri = 'https://kkoffhinmcekbidknbedpphkpgibeoen.chromiumapp.org/github/callback';
  const redirectParameter = url.searchParams.get('redirect_uri');
  return [
    'Authorization URL diagnostics:',
    `hostname=${url.hostname}`,
    `pathname=${url.pathname}`,
    `client_id present=${url.searchParams.has('client_id')}`,
    `Chrome redirect URI matches expected callback=${redirectUri === expectedRedirectUri}`,
    `redirect_uri parameter matches Chrome redirect=${redirectParameter === redirectUri}`,
    `redirect_uri decoded once matches Chrome redirect=${decodeURIComponent(url.search.slice(1).split('&').find((part) => part.startsWith('redirect_uri='))?.slice('redirect_uri='.length) ?? '') === redirectUri}`,
    `response_type=${url.searchParams.get('response_type') ?? '(missing)'}`,
    `state present=${url.searchParams.has('state')}`,
    `PKCE code_challenge present=${url.searchParams.has('code_challenge')}`,
    `PKCE code_challenge_method=${url.searchParams.get('code_challenge_method') ?? '(missing)'}`
  ].join('; ');
}

async function launch(dependencies: AuthDependencies, url: URL): Promise<string> {
  dependencies.diagnosticLog?.('Calling launchWebAuthFlow.');
  try {
    const callback = await dependencies.launchWebAuthFlow({ url: url.toString(), interactive: true });
    if (!callback) throw new Error('GitHub connection was canceled.');
    dependencies.diagnosticLog?.('launchWebAuthFlow succeeded.');
    return callback;
  } catch (error) {
    const errorDetails = error instanceof Error
      ? `${error.name}: ${error.message}`
      : `${typeof error}: ${String(error)}`;
    dependencies.diagnosticError?.('launchWebAuthFlow failed.', errorDetails);
    if (error instanceof Error && /canceled|cancelled|closed/i.test(error.message)) {
      throw new Error('GitHub connection was canceled.', { cause: error });
    }
    throw error;
  }
}

export function validateCallback(callback: string, redirectUri: string, expectedState: string): string {
  const callbackUrl = new URL(callback);
  const expectedUrl = new URL(redirectUri);
  if (callbackUrl.origin !== expectedUrl.origin || callbackUrl.pathname !== expectedUrl.pathname) {
    throw new Error('GitHub returned an unexpected authorization callback.');
  }
  const providerError = callbackUrl.searchParams.get('error');
  if (providerError) {
    throw new Error(providerError === 'access_denied' ? 'GitHub connection was canceled.' : 'GitHub authorization failed. Please try again.');
  }
  if (callbackUrl.searchParams.get('state') !== expectedState) {
    throw new Error('GitHub authorization could not be verified. Please try again.');
  }
  const code = callbackUrl.searchParams.get('code');
  if (!code) {
    throw new Error('GitHub did not return an authorization code. Please try again.');
  }
  return code;
}

export async function exchangeCode(config: GitHubAppConfig, dependencies: AuthDependencies, code: string, codeVerifier: string): Promise<GitHubAuthResult> {
  let response: Response;
  try {
    response = await Reflect.apply(dependencies.fetch, globalThis, [config.exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier, redirectUri: dependencies.redirectUri })
    }]);
  } catch (error) {
    const details = error instanceof Error ? `${error.name}: ${error.message}` : `${typeof error}: ${String(error)}`;
    dependencies.diagnosticError?.('Worker exchange fetch failed (network/CORS/browser transport).', details);
    throw new Error('Could not reach the secure GitHub connection service. Please try again.', { cause: error });
  }
  let payload: { accessToken?: string; expiresIn?: number; error?: string };
  try {
    payload = await response.json() as { accessToken?: string; expiresIn?: number; error?: string };
  } catch (error) {
    const details = error instanceof Error ? `${error.name}: ${error.message}` : `${typeof error}: ${String(error)}`;
    dependencies.diagnosticError?.(`Worker exchange response was not valid JSON (HTTP ${response.status}).`, details);
    throw new Error('GitHub connection service returned an invalid response. Please try again.', { cause: error });
  }
  if (!response.ok || !payload.accessToken) {
    const safeError = payload.error || 'GitHub connection could not be completed. Please try again.';
    dependencies.diagnosticError?.(`Worker exchange returned HTTP ${response.status}: ${safeError}`, undefined);
    throw new Error(safeError);
  }
  dependencies.diagnosticLog?.(`Worker exchange succeeded (HTTP ${response.status}); access token omitted.`);
  return { accessToken: payload.accessToken, expiresAt: payload.expiresIn ? Date.now() + payload.expiresIn * 1000 : undefined };
}

function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToUrlSafe(bytes);
}

function bytesToUrlSafe(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
