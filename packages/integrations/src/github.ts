import { isRequestTimeout, readResponseTextWithinLimit } from "./http-response.js";

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

export interface GitHubApiReaderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
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
  readonly #baseUrl: string;
  readonly #options: GitHubApiReaderOptions;

  constructor(token?: string, options: GitHubApiReaderOptions = {}) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl ?? "https://api.github.com");
    } catch {
      throw new Error("GitHub API base URL is invalid");
    }
    if (baseUrl.protocol !== "https:") {
      throw new Error("GitHub API base URL must use HTTPS");
    }
    if (baseUrl.username || baseUrl.password) {
      throw new Error("GitHub API base URL cannot contain credentials");
    }
    if (
      baseUrl.search ||
      baseUrl.hash ||
      baseUrl.href.includes("?") ||
      baseUrl.href.includes("#")
    ) {
      throw new Error("GitHub API base URL cannot contain a query or fragment");
    }
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/`;
    this.#token = token;
    this.#baseUrl = baseUrl.toString();
    this.#options = options;
  }

  async getRepository(repository: string): Promise<GitHubRepositorySnapshot> {
    const match = repository.match(
      /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]{1,100})$/,
    );
    if (!match || match[2] === "." || match[2] === "..") {
      throw new Error("Invalid GitHub repository name");
    }
    const endpoint = new URL(
      `repos/${encodeURIComponent(match[1] ?? "")}/${encodeURIComponent(match[2] ?? "")}`,
      this.#baseUrl,
    ).toString();
    let response: Response;
    try {
      response = await (this.#options.fetchImpl ?? fetch)(endpoint, {
        method: "GET",
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "fiatlux-choice/0.1",
          "x-github-api-version": "2022-11-28",
          ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 20_000),
      });
    } catch (error) {
      if (isRequestTimeout(error)) {
        throw new Error("GitHub read-only request timed out");
      }
      throw new Error("GitHub read-only request failed");
    }
    if (!response.ok) {
      const requestId = response.headers.get("x-github-request-id");
      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = response.headers.get("x-ratelimit-reset");
      const retryAfter = response.headers.get("retry-after");
      const details = [
        `HTTP ${response.status}`,
        ...(requestId ? [`request ${requestId.slice(0, 200)}`] : []),
        ...(remaining ? [`rate-remaining ${remaining.slice(0, 30)}`] : []),
        ...(reset ? [`rate-reset ${reset.slice(0, 30)}`] : []),
        ...(retryAfter ? [`retry-after ${retryAfter.slice(0, 30)}`] : []),
      ];
      throw new Error(`GitHub returned ${details.join(", ")}`);
    }
    const responseText = await readResponseTextWithinLimit(
      response,
      1_000_000,
      "GitHub response exceeded the 1 MB safety limit",
    );
    let data: GitHubApiRepository;
    try {
      data = parseGitHubRepository(JSON.parse(responseText), repository);
    } catch {
      throw new Error("GitHub returned an invalid repository response");
    }
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

function parseGitHubRepository(value: unknown, expectedRepository: string): GitHubApiRepository {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Repository response must be an object");
  }
  const record = value as Record<string, unknown>;
  const requiredString = (key: string) => {
    const candidate = record[key];
    if (typeof candidate !== "string" || !candidate) throw new Error(`Invalid ${key}`);
    return candidate;
  };
  const nullableString = (key: string) => {
    const candidate = record[key];
    if (candidate !== null && typeof candidate !== "string") throw new Error(`Invalid ${key}`);
    return candidate as string | null;
  };
  const nonNegativeInteger = (key: string) => {
    const candidate = record[key];
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 0) {
      throw new Error(`Invalid ${key}`);
    }
    return candidate;
  };
  const fullName = requiredString("full_name");
  if (fullName.toLowerCase() !== expectedRepository.toLowerCase()) {
    throw new Error("Repository response does not match the requested repository");
  }
  const htmlUrl = requiredString("html_url");
  const parsedUrl = new URL(htmlUrl);
  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "").toLowerCase();
  const expectedPath = `/${expectedRepository}`.toLowerCase();
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.port ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.href.includes("?") ||
    parsedUrl.href.includes("#") ||
    normalizedPath !== expectedPath
  ) {
    throw new Error("Invalid html_url");
  }
  const licenseValue = record.license;
  if (licenseValue !== null && (typeof licenseValue !== "object" || Array.isArray(licenseValue))) {
    throw new Error("Invalid license");
  }
  const spdxId =
    licenseValue && typeof (licenseValue as Record<string, unknown>).spdx_id === "string"
      ? ((licenseValue as Record<string, unknown>).spdx_id as string)
      : undefined;
  if (typeof record.archived !== "boolean") throw new Error("Invalid archived");
  return {
    full_name: fullName,
    html_url: htmlUrl,
    description: nullableString("description"),
    stargazers_count: nonNegativeInteger("stargazers_count"),
    forks_count: nonNegativeInteger("forks_count"),
    open_issues_count: nonNegativeInteger("open_issues_count"),
    default_branch: requiredString("default_branch"),
    pushed_at: nullableString("pushed_at"),
    archived: record.archived,
    license: licenseValue === null ? null : { ...(spdxId ? { spdx_id: spdxId } : {}) },
  };
}

export class ManualGitHubReader implements GitHubReader {
  async getRepository(_repository: string): Promise<GitHubRepositorySnapshot> {
    throw new Error(
      "GitHub integration is in manual mode; import a snapshot instead of calling the network",
    );
  }
}
