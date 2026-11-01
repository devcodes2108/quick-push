import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  codeChallenge,
  connectGitHubApp,
  exchangeCode,
  tokenExpired,
  validateCallback,
  type AuthDependencies
} from './github-auth';
import type { GitHubAppConfig } from './auth-config';
import { configurationError } from './auth-config';

const validConfig: GitHubAppConfig = {
  clientId: 'Iv23test123',
  installUrl: 'https://github.com/apps/codetrail-test/installations/new',
  exchangeUrl: 'https://codetrail-auth.workers.dev/oauth/exchange'
};

const redirectUri = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/github/callback';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('github-auth PKCE and token helpers', () => {
  it('generates correct SHA-256 base64url PKCE code challenge', async () => {
    // RFC 7636 Appendix B test vector:
    // verifier: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    // expected challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await codeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('detects expired tokens and tokens near expiry within 30s threshold', () => {
    const now = 100_000;
    expect(tokenExpired(now + 60_000, now)).toBe(false);
    expect(tokenExpired(now + 29_000, now)).toBe(true);
    expect(tokenExpired(now - 1_000, now)).toBe(true);
    expect(tokenExpired(undefined, now)).toBe(false);
  });

  it('validates configuration and catches placeholder or missing values', () => {
    expect(configurationError(validConfig)).toBeUndefined();
    expect(configurationError({
      ...validConfig,
      clientId: 'REPLACE_WITH_GITHUB_APP_CLIENT_ID'
    })).toBeDefined();
    expect(configurationError({
      ...validConfig,
      exchangeUrl: 'http://insecure-http.com/oauth/exchange'
    })).toBeDefined();
    expect(configurationError({
      ...validConfig,
      exchangeUrl: 'https://valid.com/wrong-path'
    })).toBeDefined();
  });
});

describe('validateCallback', () => {
  it('extracts code when callback matches origin, pathname, and state', () => {
    const callbackUrl = `${redirectUri}?code=valid_code_123&state=expected_state_abc`;
    const code = validateCallback(callbackUrl, redirectUri, 'expected_state_abc');
    expect(code).toBe('valid_code_123');
  });

  it('throws when state does not match', () => {
    const callbackUrl = `${redirectUri}?code=valid_code_123&state=wrong_state`;
    expect(() => validateCallback(callbackUrl, redirectUri, 'expected_state_abc')).toThrow(
      'GitHub authorization could not be verified. Please try again.'
    );
  });

  it('throws friendly cancellation when user denies access', () => {
    const callbackUrl = `${redirectUri}?error=access_denied&error_description=The+user+has+denied+access&state=any`;
    expect(() => validateCallback(callbackUrl, redirectUri, 'any')).toThrow(
      'GitHub connection was canceled.'
    );
  });

  it('throws when callback domain or pathname does not match redirectUri', () => {
    const callbackUrl = `https://attacker.site/github/callback?code=123&state=s`;
    expect(() => validateCallback(callbackUrl, redirectUri, 's')).toThrow(
      'GitHub returned an unexpected authorization callback.'
    );
  });

  it('throws when code is missing from callback', () => {
    const callbackUrl = `${redirectUri}?state=expected_state`;
    expect(() => validateCallback(callbackUrl, redirectUri, 'expected_state')).toThrow(
      'GitHub did not return an authorization code. Please try again.'
    );
  });
});

describe('connectGitHubApp full flow', () => {
  it('opens a temporary normal-tab diagnostic without capturing or exchanging the callback', async () => {
    const openAuthorizationUrlForDiagnostics = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('location', { search: '?quickPushOAuthDiagnostic=open-tab' });
    const dependencies: AuthDependencies = {
      redirectUri,
      openAuthorizationUrlForDiagnostics,
      session: { set: vi.fn(), remove: vi.fn() },
      launchWebAuthFlow: vi.fn(),
      fetch: fetchMock
    };

    await expect(connectGitHubApp(validConfig, dependencies)).rejects.toThrow(
      'Temporary OAuth diagnostic: authorization page opened separately; no callback or code will be captured or exchanged.'
    );
    expect(openAuthorizationUrlForDiagnostics).toHaveBeenCalledTimes(1);
    expect(openAuthorizationUrlForDiagnostics.mock.calls[0][0]).toContain('response_type=code');
    expect(openAuthorizationUrlForDiagnostics.mock.calls[0][0]).not.toContain('code=');
    expect(dependencies.launchWebAuthFlow).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('completes authorization code flow with PKCE and exchanges token', async () => {
    let capturedAuthUrl = '';
    const sessionMap = new Map<string, unknown>();

    const diagnosticLog = vi.fn();
    const dependencies: AuthDependencies = {
      redirectUri,
      diagnosticLog,
      session: {
        set: async (items) => {
          for (const [k, v] of Object.entries(items)) sessionMap.set(k, v);
        },
        remove: async (keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) sessionMap.delete(k);
        }
      },
      launchWebAuthFlow: async (details) => {
        capturedAuthUrl = details.url;
        const parsed = new URL(details.url);
        const state = parsed.searchParams.get('state');
        return `${redirectUri}?code=test_auth_code_999&state=${state}`;
      },
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessToken: 'ghu_user_token_123', expiresIn: 28800 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    };

    const result = await connectGitHubApp(validConfig, dependencies);
    expect(result.accessToken).toBe('ghu_user_token_123');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(diagnosticLog.mock.calls.map(([stage]) => stage)).toEqual([
      'Authentication function entered.',
      expect.stringContaining('hostname=github.com'),
      'Calling launchWebAuthFlow.',
      'launchWebAuthFlow succeeded.',
      'Worker exchange succeeded (HTTP 200); access token omitted.'
    ]);
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('pathname=/login/oauth/authorize');
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('client_id present=true');
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('Chrome redirect URI matches expected callback=false');
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('redirect_uri parameter matches Chrome redirect=true');
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('redirect_uri decoded once matches Chrome redirect=true');
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('response_type=code');
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('state present=true');
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('PKCE code_challenge present=true');
    expect(diagnosticLog.mock.calls[1]?.[0]).toContain('PKCE code_challenge_method=S256');

    // Verify auth URL parameters
    const parsed = new URL(capturedAuthUrl);
    expect(parsed.origin).toBe('https://github.com');
    expect(parsed.pathname).toBe('/login/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe(validConfig.clientId);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(parsed.searchParams.getAll('redirect_uri')).toHaveLength(1);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();

    // Verify session state was cleaned up in finally block
    expect(sessionMap.has('githubAuthorizationState')).toBe(false);

    // Verify exchange call payload
    expect(dependencies.fetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchInit] = (dependencies.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchUrl).toBe(validConfig.exchangeUrl);
    const body = JSON.parse(fetchInit.body as string);
    expect(body.code).toBe('test_auth_code_999');
    expect(body.redirectUri).toBe(redirectUri);
    expect(body.codeVerifier).toBeTruthy();
  });

  it('handles user cancellation of the web auth flow gracefully', async () => {
    const diagnosticError = vi.fn();
    const dependencies: AuthDependencies = {
      redirectUri,
      diagnosticError,
      session: { set: vi.fn(), remove: vi.fn() },
      launchWebAuthFlow: vi.fn().mockRejectedValue(new Error('The user canceled the operation')),
      fetch: vi.fn()
    };

    await expect(connectGitHubApp(validConfig, dependencies)).rejects.toThrow(
      'GitHub connection was canceled.'
    );
    expect(diagnosticError).toHaveBeenCalledWith(
      'launchWebAuthFlow failed.',
      'Error: The user canceled the operation'
    );
  });

  it('invokes the injected fetch with the global execution context', async () => {
    const dependencies: AuthDependencies = {
      redirectUri,
      session: { set: vi.fn(), remove: vi.fn() },
      launchWebAuthFlow: vi.fn(),
      fetch: function (this: typeof globalThis) {
        if (this !== globalThis) {
          throw new TypeError('Illegal invocation');
        }
        return Promise.resolve(new Response(JSON.stringify({ accessToken: 'test-token', expiresIn: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
    };

    await expect(exchangeCode(validConfig, dependencies, 'test-code', 'test-verifier')).resolves.toMatchObject({
      accessToken: 'test-token'
    });
  });

  it('handles worker network exchange failure', async () => {
    const dependencies: AuthDependencies = {
      redirectUri,
      session: { set: vi.fn(), remove: vi.fn() },
      launchWebAuthFlow: async (details) => {
        const parsed = new URL(details.url);
        return `${redirectUri}?code=abc&state=${parsed.searchParams.get('state')}`;
      },
      fetch: vi.fn().mockRejectedValue(new Error('Network error'))
    };

    await expect(connectGitHubApp(validConfig, dependencies)).rejects.toThrow(
      'Could not reach the secure GitHub connection service. Please try again.'
    );
  });
});
