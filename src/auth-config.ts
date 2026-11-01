export interface GitHubAppConfig {
  clientId: string;
  installUrl: string;
  exchangeUrl: string;
}

export const githubAppConfig: GitHubAppConfig = {
  clientId: import.meta.env.VITE_GITHUB_APP_CLIENT_ID || 'REPLACE_WITH_GITHUB_APP_CLIENT_ID',
  installUrl: import.meta.env.VITE_GITHUB_APP_INSTALL_URL || 'https://github.com/apps/REPLACE_WITH_GITHUB_APP_SLUG/installations/new',
  exchangeUrl: import.meta.env.VITE_AUTH_EXCHANGE_URL || 'https://REPLACE_WITH_WORKER_HOST/oauth/exchange'
};

export function configurationError(config: GitHubAppConfig): string | undefined {
  if (Object.values(config).some((value) => !value || value.includes('REPLACE_WITH'))) {
    return 'GitHub connection is not configured for this build. Contact the Quick Push publisher.';
  }
  try {
    new URL(config.installUrl);
    const exchange = new URL(config.exchangeUrl);
    if (exchange.protocol !== 'https:' || exchange.pathname !== '/oauth/exchange') return 'GitHub connection is misconfigured. Contact the Quick Push publisher.';
  } catch {
    return 'GitHub connection is misconfigured. Contact the Quick Push publisher.';
  }
  return undefined;
}
