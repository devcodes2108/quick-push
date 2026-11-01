export type Language =
  | 'Python' | 'JavaScript' | 'TypeScript' | 'Java' | 'C' | 'C++' | 'C#'
  | 'Go' | 'Rust' | 'PHP' | 'Ruby' | 'Kotlin' | 'Swift' | 'HTML' | 'CSS' | 'SQL' | 'Plain text';

export interface Repository {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
}

export interface Preferences {
  keepPanelOpen: boolean;
  rememberKeepPanelOpen: boolean;
  preferredLanguage: Language;
  selectedRepository?: Repository;
  selectedBranch?: string;
}

export type PanelMessage =
  | { type: 'TOGGLE_PANEL' }
  | { type: 'SHOW_PANEL' }
  | { type: 'HIDE_PANEL' }
  | { type: 'CONTENT_READY' }
  | { type: 'GET_STATE' }
  | { type: 'GET_PREFERENCES' }
  | { type: 'SAVE_PREFERENCES'; preferences: Partial<Preferences> }
  | { type: 'GET_AUTH_STATUS' }
  | { type: 'CONNECT_GITHUB_APP' }
  | { type: 'DISCONNECT' }
  | { type: 'LIST_REPOSITORIES' }
  | { type: 'LIST_BRANCHES'; repository: string }
  | { type: 'SUGGEST_FILENAME'; repository: string; branch: string; extension: string }
  | { type: 'PUSH_FILE'; repository: string; branch: string; filename: string; code: string };

export interface PushResult {
  fileUrl: string;
  commitUrl?: string;
}
