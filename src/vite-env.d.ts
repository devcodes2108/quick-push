/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_APP_CLIENT_ID?: string;
  readonly VITE_GITHUB_APP_INSTALL_URL?: string;
  readonly VITE_AUTH_EXCHANGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css?inline' {
  const css: string;
  export default css;
}

