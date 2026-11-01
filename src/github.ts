import type { PushResult, Repository } from './types';
import { suggestFilename } from './filename';

const API = 'https://api.github.com';
const repositoryPath = (repository: string) => repository.split('/').map(encodeURIComponent).join('/');
const headers = (token: string): HeadersInit => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28'
});

export class GitHubApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...init?.headers } });
  } catch {
    throw new GitHubApiError(0, 'Network error. Check your connection and try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: '' })) as { message?: string };
    const message = body.message || `GitHub request failed (${response.status}).`;
    if (response.status === 401) throw new GitHubApiError(401, 'GitHub authorization expired or was revoked. Reconnect your account.');
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new GitHubApiError(403, 'GitHub rate limit reached. Try again later.');
    throw new GitHubApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const github = {
  user: (token: string) => request<{ login: string; avatar_url: string }>(token, '/user'),
  async repositories(token: string): Promise<Repository[]> {
    const repositories: Repository[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await request<Repository[]>(token, `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=full_name`);
      repositories.push(...batch);
      if (batch.length < 100) break;
    }
    if (repositories.length === 0) {
      try {
        const installData = await request<{ installations?: Array<{ id: number }> }>(token, '/user/installations');
        for (const inst of installData.installations ?? []) {
          const repoData = await request<{ repositories?: Repository[] }>(token, `/user/installations/${inst.id}/repositories?per_page=100`);
          for (const repo of repoData.repositories ?? []) {
            if (!repositories.some((existing) => existing.id === repo.id)) {
              repositories.push(repo);
            }
          }
        }
      } catch {
        // Fallback is best-effort
      }
    }
    return repositories;
  },
  branches: (token: string, repository: string) => request<Array<{ name: string }>>(token, `/repos/${repositoryPath(repository)}/branches?per_page=100`),
  async suggestedFilename(token: string, repository: string, branch: string, extension: string): Promise<string> {
    try {
      const tree = await request<{ tree: Array<{ path: string; type: string }> }>(token, `/repos/${repositoryPath(repository)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      return suggestFilename(tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path), extension);
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 409) throw new GitHubApiError(409, 'This repository is empty. Create an initial commit on GitHub, then select its branch.');
      if (error instanceof GitHubApiError && (error.status === 401 || error.status === 403)) throw error;
      return suggestFilename([], extension);
    }
  },
  async createFile(token: string, repository: string, branch: string, filename: string, code: string): Promise<PushResult> {
    const encodedRepo = repositoryPath(repository);
    const encodedPath = encodeURIComponent(filename);
    try {
      await request<unknown>(token, `/repos/${encodedRepo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`);
      throw new GitHubApiError(422, 'That filename already exists on this branch. Choose another name.');
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404) throw error;
    }
    const content = bytesToBase64(new TextEncoder().encode(code));
    try {
      const result = await request<{ content: { html_url: string }; commit: { html_url?: string } }>(token, `/repos/${encodedRepo}/contents/${encodedPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Add ${filename}`, content, branch })
      });
      return { fileUrl: result.content.html_url, commitUrl: result.commit.html_url };
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 422) throw new GitHubApiError(422, 'GitHub reported a filename conflict. Choose another filename and retry.');
      throw error;
    }
  }
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(binary);
}
