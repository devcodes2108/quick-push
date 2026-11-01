# CodeTrail Authorization Worker

A minimal, secure Cloudflare Worker that performs OAuth authorization code exchange for the CodeTrail Chrome extension.

## Why this Worker exists

GitHub requires a `client_secret` when exchanging an OAuth authorization code for a user access token, even when PKCE (Proof Key for Code Exchange) is used. Because Chrome extensions run on user devices, storing a client secret in extension code or manifests would expose the secret to anyone who downloads the extension.

This Worker:
- Securely stores the GitHub App `client_secret` in a Cloudflare Worker secret.
- Validates that requests come from the legitimate CodeTrail Chrome extension origin.
- Validates the PKCE code verifier and callback URI.
- Forwards the exchange request to GitHub's official token endpoint.
- Returns only the user access token and expiry to the extension.
- Never stores or logs student code, credentials, tokens, or authorization codes.

## Endpoints

### `POST /oauth/exchange`

Exchanges an authorization code and PKCE verifier for a GitHub user access token.

- **Headers**:
  - `Origin`: `chrome-extension://<EXTENSION_ID>`
  - `Content-Type`: `application/json`
- **Request Body**:
  ```json
  {
    "code": "0123456789abcdef",
    "codeVerifier": "random_pkce_verifier_string_at_least_43_characters",
    "redirectUri": "https://<EXTENSION_ID>.chromiumapp.org/github/callback"
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "accessToken": "ghu_...",
    "expiresIn": 28800
  }
  ```

## Local Development & Testing

1. Install dependencies (from project root):
   ```bash
   npm install
   ```

2. Run Worker tests:
   ```bash
   npm run test:worker
   ```

3. Run locally using Wrangler:
   ```bash
   cd worker
   npx wrangler dev
   ```

## Deployment Instructions

1. Log in to Cloudflare:
   ```bash
   npx wrangler login
   ```

2. Update `wrangler.toml` with your GitHub App Client ID and Chrome Extension ID:
   ```toml
   [vars]
   GITHUB_CLIENT_ID = "Iv23..."
   ALLOWED_EXTENSION_ID = "your_chrome_extension_id"
   ALLOWED_REDIRECT_URI = "https://your_chrome_extension_id.chromiumapp.org/github/callback"
   ```

3. Set the GitHub App client secret securely:
   ```bash
   cd worker
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```
   When prompted, paste your GitHub App client secret.

4. Deploy the Worker:
   ```bash
   npx wrangler deploy
   ```

5. Copy the deployed Worker URL (e.g., `https://codetrail-auth-worker.<subdomain>.workers.dev`) and set `VITE_AUTH_EXCHANGE_URL` in the extension's `.env`.

