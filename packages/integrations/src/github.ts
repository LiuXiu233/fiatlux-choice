export interface GitHubRepositorySnapshot {
  repository: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  defaultBranch: string;
  pushedAt: string | null;
  archived: boolean;
  license: string | null;
}

export interface GitHubReader {
  getRepository(repository: string): Promise<GitHubRepositorySnapshot>;
}

type GitHubApiRepository = {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  pushed_at: string | null;
  archived: boolean;
  license: { spdx_id?: string } | null;
};

export class GitHubApiReader implements GitHubReader {
  readonly #token: string | undefined;

  constructor(token?: string) {
    this.#token = token;
  }

  async getRepository(repository: string): Promise<GitHubRepositorySnapshot> {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error("Invalid GitHub repository name");
    const response = await fetch(`https://api.github.com/repos/${encodeURI(repository)}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const data = (await response.json()) as GitHubApiRepository;
    return {
      repository: data.full_name,
      url: data.html_url,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      defaultBranch: data.default_branch,
      pushedAt: data.pushed_at,
      archived: data.archived,
      license: data.license?.spdx_id ?? null,
    };
  }
}

export class ManualGitHubReader implements GitHubReader {
  async getRepository(_repository: string): Promise<GitHubRepositorySnapshot> {
    throw new Error(
      "GitHub integration is in manual mode; import a snapshot instead of calling the network",
    );
  }
}
