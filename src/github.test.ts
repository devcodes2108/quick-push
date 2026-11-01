import { afterEach, describe, expect, it, vi } from 'vitest';
import { github, GitHubApiError } from './github';

const response = (status: number, body: object, headersObj?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headersObj }
  });

afterEach(() => vi.unstubAllGlobals());

describe('GitHub file creation', () => {
  it('creates only after the path check reports missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(
        response(201, {
          content: { html_url: 'https://github.com/o/r/blob/main/a.py' },
          commit: { html_url: 'https://github.com/o/r/commit/1' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(github.createFile('token', 'o/r', 'main', 'a.py', 'print("✓")')).resolves.toMatchObject({
      fileUrl: expect.stringContaining('a.py')
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
  });

  it('never overwrites an existing path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { name: 'a.py' })));
    await expect(github.createFile('token', 'o/r', 'main', 'a.py', 'x')).rejects.toMatchObject<
      Partial<GitHubApiError>
    >({ status: 422 });
  });
});

describe('GitHub repository and branch operations', () => {
  it('lists repositories from /user/repos with pagination', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `repo-${i + 1}`,
      full_name: `owner/repo-${i + 1}`,
      default_branch: 'main',
      private: false
    }));
    const page2 = [
      {
        id: 101,
        name: 'repo-101',
        full_name: 'owner/repo-101',
        default_branch: 'main',
        private: false
      }
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, page1))
      .mockResolvedValueOnce(response(200, page2));
    vi.stubGlobal('fetch', fetchMock);

    const repos = await github.repositories('test_token');
    expect(repos).toHaveLength(101);
    expect(repos[0].id).toBe(1);
    expect(repos[100].id).toBe(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to /user/installations if /user/repos returns empty', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, [])) // /user/repos empty
      .mockResolvedValueOnce(response(200, { installations: [{ id: 12345 }] })) // /user/installations
      .mockResolvedValueOnce(
        response(200, {
          repositories: [
            { id: 99, name: 'installed-repo', full_name: 'owner/installed-repo', default_branch: 'main', private: false }
          ]
        })
      ); // /user/installations/12345/repositories
    vi.stubGlobal('fetch', fetchMock);

    const repos = await github.repositories('test_token');
    expect(repos).toHaveLength(1);
    expect(repos[0].full_name).toBe('owner/installed-repo');
  });

  it('lists branches for a repository', async () => {
    const branches = [{ name: 'main' }, { name: 'dev' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, branches)));

    const result = await github.branches('token', 'owner/repo');
    expect(result).toEqual(branches);
  });

  it('fetches authenticated user login and avatar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { login: 'student1', avatar_url: 'https://avatar' })));
    const user = await github.user('token');
    expect(user.login).toBe('student1');
  });
});

describe('GitHub error handling', () => {
  it('throws friendly error on 401 Unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { message: 'Bad credentials' })));
    await expect(github.user('invalid_token')).rejects.toThrow(
      'GitHub authorization expired or was revoked. Reconnect your account.'
    );
  });

  it('throws rate limit error on 403 when rate limit is 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' })
      )
    );
    await expect(github.user('token')).rejects.toThrow('GitHub rate limit reached. Try again later.');
  });

  it('throws network error when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection failed')));
    await expect(github.user('token')).rejects.toThrow('Network error. Check your connection and try again.');
  });
});
