import { Buffer } from "node:buffer";

import type { V1ReleaseReadinessManifest } from "@fiatlux/contracts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface V1PlatformEvidenceOptions {
  repository: string;
  actor: string;
  token: string;
  fetchImpl?: FetchLike;
}

export interface VerifiedV1GitHubRun {
  id: number;
  workflow: "ci" | "security" | "release";
  headSha: string;
  reference: string;
}

export interface VerifiedV1RegistryArtifact {
  artifact: "api" | "postgres" | "minio" | "worker" | "web" | "gateway" | "backup";
  digest: string;
  reference: string;
}

export interface V1PlatformEvidenceVerification {
  repository: string;
  evidenceCommit: string;
  githubRuns: VerifiedV1GitHubRun[];
  registryArtifacts: VerifiedV1RegistryArtifact[];
}

export class V1PlatformEvidenceError extends Error {
  override readonly name = "V1PlatformEvidenceError";
}

const githubWorkflowNames = {
  ci: "CI",
  security: "Security",
  release: "Build release-candidate images and SBOM",
} as const;

const registryReferencePattern =
  /^ghcr\.io\/([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)\/fiatlux-choice-(api|postgres|minio|worker|web|gateway|backup)@(sha256:[0-9a-f]{64})$/;

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new V1PlatformEvidenceError(`${label} 缺失或格式无效`);
  }
  return value;
}

function parseRepository(repository: string): { owner: string; name: string } {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!match?.[1] || !match[2]) {
    throw new V1PlatformEvidenceError("repository 必须是 owner/name");
  }
  return { owner: match[1], name: match[2] };
}

function parseGitHubRunReference(
  reference: string,
  repository: { owner: string; name: string },
): number {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    throw new V1PlatformEvidenceError(`GitHub run 引用不是有效 URL：${reference}`);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    segments.length !== 5 ||
    segments[0]?.toLowerCase() !== repository.owner.toLowerCase() ||
    segments[1]?.toLowerCase() !== repository.name.toLowerCase() ||
    segments[2] !== "actions" ||
    segments[3] !== "runs" ||
    !/^\d+$/.test(segments[4] ?? "")
  ) {
    throw new V1PlatformEvidenceError(`GitHub run 引用不属于当前仓库：${reference}`);
  }
  const id = Number(segments[4]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new V1PlatformEvidenceError(`GitHub run ID 无效：${reference}`);
  }
  return id;
}

async function readJson(response: Response, label: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new V1PlatformEvidenceError(`${label} 未返回有效 JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new V1PlatformEvidenceError(`${label} 返回结构无效`);
  }
  return value as Record<string, unknown>;
}

async function verifyGitHubRun(
  evidence: V1ReleaseReadinessManifest["gates"][number]["evidence"][number],
  repository: { owner: string; name: string },
  token: string,
  fetchImpl: FetchLike,
): Promise<VerifiedV1GitHubRun> {
  const workflow = evidence.githubWorkflow;
  if (!workflow) throw new V1PlatformEvidenceError("GitHub run 证据缺少 workflow 标识");
  const id = parseGitHubRunReference(evidence.reference, repository);
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository.owner}/${repository.name}/actions/runs/${id}`,
    {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new V1PlatformEvidenceError(`GitHub run ${id} 查询失败：HTTP ${response.status}`);
  }
  const run = await readJson(response, `GitHub run ${id}`);
  const headSha = requireString(run.head_sha, `GitHub run ${id} head_sha`);
  const status = requireString(run.status, `GitHub run ${id} status`);
  const conclusion = requireString(run.conclusion, `GitHub run ${id} conclusion`);
  const name = requireString(run.name, `GitHub run ${id} name`);
  if (
    status !== "completed" ||
    conclusion !== "success" ||
    headSha !== evidence.subjectCommit ||
    name !== githubWorkflowNames[workflow]
  ) {
    throw new V1PlatformEvidenceError(
      `GitHub run ${id} 与声明不一致：workflow=${name} status=${status} conclusion=${conclusion} head=${headSha}`,
    );
  }
  return { id, workflow, headSha, reference: evidence.reference };
}

async function requestRegistryToken(
  owner: string,
  packageName: string,
  actor: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const url = new URL("https://ghcr.io/token");
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", `repository:${owner}/${packageName}:pull`);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${actor}:${token}`).toString("base64")}`,
    },
  });
  if (!response.ok) {
    throw new V1PlatformEvidenceError(
      `GHCR ${owner}/${packageName} 只读令牌请求失败：HTTP ${response.status}`,
    );
  }
  const body = await readJson(response, `GHCR ${owner}/${packageName} token`);
  return requireString(body.token ?? body.access_token, `GHCR ${owner}/${packageName} token`);
}

async function verifyRegistryArtifact(
  evidence: V1ReleaseReadinessManifest["gates"][number]["evidence"][number],
  repositoryOwner: string,
  actor: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<VerifiedV1RegistryArtifact> {
  const match = registryReferencePattern.exec(evidence.reference);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new V1PlatformEvidenceError(`GHCR 制品引用必须使用不可变 digest：${evidence.reference}`);
  }
  const [owner, artifact, digest] = [match[1], match[2], match[3]] as const;
  if (owner !== repositoryOwner.toLowerCase() || artifact !== evidence.releaseArtifact) {
    throw new V1PlatformEvidenceError(
      `GHCR 制品与仓库或 artifact 声明不一致：${evidence.reference}`,
    );
  }
  const packageName = `fiatlux-choice-${artifact}`;
  const registryToken = await requestRegistryToken(owner, packageName, actor, token, fetchImpl);
  const response = await fetchImpl(
    `https://ghcr.io/v2/${owner}/${packageName}/manifests/${digest}`,
    {
      method: "HEAD",
      headers: {
        Accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json",
        Authorization: `Bearer ${registryToken}`,
      },
    },
  );
  if (!response.ok) {
    throw new V1PlatformEvidenceError(
      `GHCR 制品不存在或不可读：${owner}/${packageName}@${digest}（HTTP ${response.status}）`,
    );
  }
  const resolvedDigest = response.headers.get("docker-content-digest");
  if (resolvedDigest !== digest) {
    throw new V1PlatformEvidenceError(
      `GHCR digest 不一致：${artifact} 期望 ${digest}，实际 ${resolvedDigest ?? "missing"}`,
    );
  }
  return { artifact, digest, reference: evidence.reference };
}

export async function verifyV1PlatformEvidence(
  manifest: V1ReleaseReadinessManifest,
  options: V1PlatformEvidenceOptions,
): Promise<V1PlatformEvidenceVerification> {
  if (
    manifest.overallStatus !== "ready" ||
    manifest.gates.some(({ status }) => status !== "passed")
  ) {
    throw new V1PlatformEvidenceError("清单尚未 ready，拒绝查询或证明外部平台证据");
  }
  if (!options.actor.trim() || !options.token) {
    throw new V1PlatformEvidenceError("缺少只读 GitHub/GHCR 验证身份");
  }
  const repository = parseRepository(options.repository);
  const expectedRepositoryUrl = `https://github.com/${options.repository}`;
  if (manifest.candidate.repository.toLowerCase() !== expectedRepositoryUrl.toLowerCase()) {
    throw new V1PlatformEvidenceError("清单 repository 与当前 GitHub 仓库不一致");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const successfulEvidence = manifest.gates.flatMap(({ evidence }) =>
    evidence.filter(({ result }) => result === "success"),
  );
  const githubEvidence = successfulEvidence.filter(({ kind }) => kind === "github_run");
  const registryEvidence = successfulEvidence.filter(({ kind }) => kind === "registry");

  const githubRuns: VerifiedV1GitHubRun[] = [];
  for (const item of githubEvidence) {
    githubRuns.push(await verifyGitHubRun(item, repository, options.token, fetchImpl));
  }
  const registryArtifacts: VerifiedV1RegistryArtifact[] = [];
  for (const item of registryEvidence) {
    registryArtifacts.push(
      await verifyRegistryArtifact(item, repository.owner, options.actor, options.token, fetchImpl),
    );
  }

  const workflowScopes = new Set(githubRuns.map(({ workflow }) => workflow));
  const artifactScopes = new Set(registryArtifacts.map(({ artifact }) => artifact));
  if (
    !workflowScopes.has("ci") ||
    !workflowScopes.has("security") ||
    !workflowScopes.has("release") ||
    artifactScopes.size !== 7
  ) {
    throw new V1PlatformEvidenceError("外部平台证据未覆盖 CI、Security、release 和七类制品");
  }

  return {
    repository: options.repository,
    evidenceCommit: manifest.candidate.evidenceCommit,
    githubRuns,
    registryArtifacts,
  };
}
