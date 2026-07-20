const releaseVersionPattern =
  /^(?:development|local|ci|v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)$/;
const gitShaPattern = /^(?:development|[0-9a-f]{40})$/;

export interface BuildInfo {
  version: string;
  gitSha: string;
}

export function normalizeBuildInfo(
  version: string | undefined,
  gitSha: string | undefined,
): BuildInfo {
  const normalizedVersion = version?.trim() ?? "";
  const normalizedGitSha = gitSha?.trim() ?? "";
  const validVersion = releaseVersionPattern.test(normalizedVersion);
  const validGitSha = gitShaPattern.test(normalizedGitSha);
  const localIdentity =
    (normalizedVersion === "development" || normalizedVersion === "local") &&
    normalizedGitSha === "development";
  const immutableIdentity =
    (normalizedVersion === "ci" || normalizedVersion.startsWith("v")) &&
    normalizedGitSha !== "development";

  if (validVersion && validGitSha && (localIdentity || immutableIdentity)) {
    return { version: normalizedVersion, gitSha: normalizedGitSha };
  }
  return { version: "development", gitSha: "development" };
}

export function formatBuildIdentity(info: BuildInfo): string {
  const shortSha = info.gitSha === "development" ? "dev" : info.gitSha.slice(0, 7);
  return `构建 ${info.version} · ${shortSha}`;
}

export const buildInfo = Object.freeze(
  normalizeBuildInfo(import.meta.env.VITE_RELEASE_VERSION, import.meta.env.VITE_RELEASE_GIT_SHA),
);
