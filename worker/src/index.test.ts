import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, {
  isOriginAllowed,
  validateAuthCode,
  validateCodeVerifier,
  validateRedirectUri,
  type Env
} from './index';

const mockEnv: Env = {
  GITHUB_CLIENT_ID: 'test_client_id',
  GITHUB_CLIENT_SECRET: 'test_client_secret',
  ALLOWED_EXTENSION_ID: 'abcdefghijklmnopabcdefghijklmnop',
  ALLOWED_REDIRECT_URI: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/github/callback'
};

const validVerifier = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const validCode = 'github_code_12345';
const validRedirect = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/github/callback';
const validOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Worker helper validation functions', () => {
  it('validates RFC 7636 PKCE code verifier correctly', () => {
    expect(validateCodeVerifier(validVerifier)).toBe(true);
    expect(validateCodeVerifier('too_short')).toBe(false);
    expect(validateCodeVerifier('a'.repeat(42))).toBe(false);
    expect(validateCodeVerifier('a'.repeat(43))).toBe(true);
    expect(validateCodeVerifier('a'.repeat(128))).toBe(true);
    expect(validateCodeVerifier('a'.repeat(129))).toBe(false);
    expect(validateCodeVerifier('invalid_characters!@#$%^&*()_+')).toBe(false);
  });

  it('validates authorization code format', () => {
    expect(validateAuthCode(validCode)).toBe(true);
    expect(validateAuthCode('')).toBe(false);
    expect(validateAuthCode('bad code with spaces')).toBe(false);
  });

  it('validates allowed redirect URIs and blocks arbitrary destinations', () => {
    expect(validateRedirectUri(validRedirect, mockEnv)).toBe(true);
    expect(validateRedirectUri('https://evil.com/callback', mockEnv)).toBe(false);
    expect(validateRedirectUri('http://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/github/callback', mockEnv)).toBe(false);
    expect(validateRedirectUri('not-a-url', mockEnv)).toBe(false);
  });

  it('validates origin against allowed extension ID', () => {
    expect(isOriginAllowed(validOrigin, mockEnv)).toBe(true);
    expect(isOriginAllowed('https://evil.com', mockEnv)).toBe(false);
    expect(isOriginAllowed('chrome-extension://other_id', mockEnv)).toBe(false);
    expect(isOriginAllowed(null, mockEnv)).toBe(false);
  });
});

describe('Worker HTTP endpoints', () => {
  it('handles CORS preflight OPTIONS requests for allowed extension origin', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'OPTIONS',
      headers: { Origin: validOrigin }
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(validOrigin);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('rejects CORS preflight OPTIONS requests for unauthorized origin', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'OPTIONS',
      headers: { Origin: 'https://unauthorized.com' }
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(403);
  });

  it('returns 404 for unknown endpoints', async () => {
    const request = new Request('https://worker.local/other-route', {
      method: 'POST',
      headers: { Origin: validOrigin }
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(404);
  });

  it('returns 405 for non-POST methods on /oauth/exchange', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'GET',
      headers: { Origin: validOrigin }
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(405);
  });

  it('returns 403 when request origin does not match allowed extension', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.site',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code: validCode, codeVerifier: validVerifier, redirectUri: validRedirect })
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(403);
  });

  it('returns 415 when Content-Type is not application/json', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'text/plain'
      },
      body: 'plain text'
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(415);
  });

  it('returns 413 when payload exceeds limit', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'application/json',
        'Content-Length': '10000'
      },
      body: JSON.stringify({ code: 'a'.repeat(5000) })
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(413);
  });

  it('returns 400 for invalid body or missing parameters', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code: '' })
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(400);
    const data = await response.json() as { error: string };
    expect(data.error).toMatch(/Invalid or missing authorization code/i);
  });

  it('returns 400 for invalid PKCE code verifier', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: validCode,
        codeVerifier: 'short',
        redirectUri: validRedirect
      })
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(400);
    const data = await response.json() as { error: string };
    expect(data.error).toMatch(/PKCE code verifier/i);
  });

  it('returns 400 for unauthorized redirect URI', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: validCode,
        codeVerifier: validVerifier,
        redirectUri: 'https://malicious-site.com/callback'
      })
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(400);
    const data = await response.json() as { error: string };
    expect(data.error).toMatch(/unauthorized redirect URI/i);
  });

  it('returns 500 when Worker is misconfigured with placeholder secrets', async () => {
    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: validCode,
        codeVerifier: validVerifier,
        redirectUri: validRedirect
      })
    });

    const badEnv: Env = {
      ...mockEnv,
      GITHUB_CLIENT_SECRET: 'REPLACE_WITH_GITHUB_APP_CLIENT_SECRET'
    };

    const response = await worker.fetch(request, badEnv);
    expect(response.status).toBe(500);
    const data = await response.json() as { error: string };
    expect(data.error).toMatch(/not configured/i);
  });

  it('successfully exchanges code with GitHub and returns accessToken', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        access_token: 'ghu_16C7e42F292c6912E7710c838347Ae178B4a',
        token_type: 'bearer',
        expires_in: 28800
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: validCode,
        codeVerifier: validVerifier,
        redirectUri: validRedirect
      })
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(200);
    const data = await response.json() as { accessToken: string; expiresIn: number };
    expect(data.accessToken).toBe('ghu_16C7e42F292c6912E7710c838347Ae178B4a');
    expect(data.expiresIn).toBe(28800);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({
      client_id: mockEnv.GITHUB_CLIENT_ID,
      client_secret: mockEnv.GITHUB_CLIENT_SECRET,
      code: validCode,
      redirect_uri: validRedirect,
      code_verifier: validVerifier
    });
  });

  it('handles GitHub authorization failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    ));

    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: validCode,
        codeVerifier: validVerifier,
        redirectUri: validRedirect
      })
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(400);
    const data = await response.json() as { error: string };
    expect(data.error).toBe('The code passed is incorrect or expired.');
  });

  it('handles GitHub network failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const request = new Request('https://worker.local/oauth/exchange', {
      method: 'POST',
      headers: {
        Origin: validOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: validCode,
        codeVerifier: validVerifier,
        redirectUri: validRedirect
      })
    });

    const response = await worker.fetch(request, mockEnv);
    expect(response.status).toBe(502);
    const data = await response.json() as { error: string };
    expect(data.error).toMatch(/Failed to communicate with GitHub/i);
  });
});

