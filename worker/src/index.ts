export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  ALLOWED_EXTENSION_ID?: string;
  ALLOWED_REDIRECT_URI?: string;
  ALLOWED_ORIGIN?: string;
}

export function isOriginAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  if (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) return true;
  if (env.ALLOWED_EXTENSION_ID && !env.ALLOWED_EXTENSION_ID.includes('REPLACE_WITH')) {
    return origin === `chrome-extension://${env.ALLOWED_EXTENSION_ID}`;
  }
  // During local development or placeholder configuration, accept chrome-extension origins
  return origin.startsWith('chrome-extension://');
}

export function corsHeaders(origin: string | null, env: Env): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin && isOriginAllowed(origin, env) ? origin : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export function validateRedirectUri(uri: string, env: Env): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:') return false;
    if (!url.hostname.endsWith('.chromiumapp.org')) return false;

    if (env.ALLOWED_REDIRECT_URI && !env.ALLOWED_REDIRECT_URI.includes('REPLACE_WITH')) {
      return uri === env.ALLOWED_REDIRECT_URI;
    }

    if (env.ALLOWED_EXTENSION_ID && !env.ALLOWED_EXTENSION_ID.includes('REPLACE_WITH')) {
      return url.hostname === `${env.ALLOWED_EXTENSION_ID}.chromiumapp.org`;
    }

    return true;
  } catch {
    return false;
  }
}

export function validateCodeVerifier(verifier: string): boolean {
  return typeof verifier === 'string' && verifier.length >= 43 && verifier.length <= 128 && /^[A-Za-z0-9\-._~]+$/.test(verifier);
}

export function validateAuthCode(code: string): boolean {
  return typeof code === 'string' && code.length >= 1 && code.length <= 256 && /^[A-Za-z0-9_.-]+$/.test(code);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      if (!isOriginAllowed(origin, env)) {
        return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env)
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/oauth/exchange') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' }
      });
    }

    if (!isOriginAllowed(origin, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contentType = request.headers.get('Content-Type') ?? '';
    if (!contentType.includes('application/json')) {
      return new Response(JSON.stringify({ error: 'Unsupported media type. Expected application/json' }), {
        status: 415,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    const contentLength = Number(request.headers.get('Content-Length'));
    if (contentLength > 4096) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    let body: { code?: unknown; codeVerifier?: unknown; redirectUri?: unknown };
    try {
      body = (await request.json()) as { code?: unknown; codeVerifier?: unknown; redirectUri?: unknown };
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    if (typeof body.code !== 'string' || !validateAuthCode(body.code)) {
      return new Response(JSON.stringify({ error: 'Invalid or missing authorization code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    if (typeof body.codeVerifier !== 'string' || !validateCodeVerifier(body.codeVerifier)) {
      return new Response(JSON.stringify({ error: 'Invalid or missing PKCE code verifier' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    if (typeof body.redirectUri !== 'string' || !validateRedirectUri(body.redirectUri, env)) {
      return new Response(JSON.stringify({ error: 'Invalid or unauthorized redirect URI' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    if (
      !env.GITHUB_CLIENT_ID ||
      !env.GITHUB_CLIENT_SECRET ||
      env.GITHUB_CLIENT_SECRET.includes('REPLACE_WITH') ||
      env.GITHUB_CLIENT_ID.includes('REPLACE_WITH')
    ) {
      return new Response(JSON.stringify({ error: 'Authentication exchange service is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    let githubResponse: Response;
    try {
      githubResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Quick-Push-Auth-Worker'
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: body.code,
          redirect_uri: body.redirectUri,
          code_verifier: body.codeVerifier
        })
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to communicate with GitHub authorization endpoint' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    const githubData = (await githubResponse.json().catch(() => ({}))) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!githubResponse.ok || githubData.error || !githubData.access_token) {
      const errorMessage = githubData.error_description || 'GitHub authorization code is invalid or has expired.';
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      });
    }

    return new Response(
      JSON.stringify({
        accessToken: githubData.access_token,
        expiresIn: githubData.expires_in
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) }
      }
    );
  }
};

