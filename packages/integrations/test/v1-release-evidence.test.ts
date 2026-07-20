import type { V1ReleaseReadinessManifest } from "@fiatlux/contracts";
import { describe, expect, it } from "vitest";

import { verifyV1PlatformEvidence } from "../src/index.js";

const evidenceCommit = "b".repeat(40);
const verifiedAt = "2026-07-20T12:00:00+08:00";
const releaseArtifacts = [
  "api",
  "postgres",
  "minio",
  "worker",
  "web",
  "gateway",
  "backup",
] as const;

function makeManifest(): V1ReleaseReadinessManifest {
  const githubEvidence = [
    [101, "ci"],
    [102, "security"],
    [103, "release"],
  ] as const;
  const registryEvidence = releaseArtifacts.map((releaseArtifact, index) => ({
    kind: "registry" as const,
    result: "success" as const,
    reference: `ghcr.io/example/fiatlux-choice-${releaseArtifact}@sha256:${String(index + 1).repeat(64)}`,
    verifiedAt,
    subjectCommit: evidenceCommit,
    releaseArtifact,
  }));
  return {
    schemaVersion: 1,
    versionLabel: "V1 ready candidate",
    overallStatus: "ready",
    evaluatedAt: verifiedAt,
    candidate: {
      repository: "https://github.com/example/fiatlux-choice",
      branch: "main",
      implementationCommit: "a".repeat(40),
      evidenceCommit,
    },
    gates: [
      {
        id: "github_ci_security",
        status: "passed",
        ownerRole: "仓库管理员",
        summary: "GitHub CI 和 Security 已取得绿色运行证据。",
        evidence: githubEvidence.slice(0, 2).map(([id, githubWorkflow]) => ({
          kind: "github_run" as const,
          result: "success" as const,
          reference: `https://github.com/example/fiatlux-choice/actions/runs/${id}`,
          verifiedAt,
          subjectCommit: evidenceCommit,
          githubWorkflow,
        })),
        blockers: [],
        reviewedAt: verifiedAt,
      },
      {
        id: "ghcr_release_artifacts",
        status: "passed",
        ownerRole: "供应链负责人",
        summary: "release workflow 和七类 GHCR 制品均已取得成功证据。",
        evidence: [
          ...registryEvidence,
          {
            kind: "github_run",
            result: "success",
            reference: `https://github.com/example/fiatlux-choice/actions/runs/${githubEvidence[2][0]}`,
            verifiedAt,
            subjectCommit: evidenceCommit,
            githubWorkflow: githubEvidence[2][1],
          },
        ],
        blockers: [],
        reviewedAt: verifiedAt,
      },
    ],
  };
}

function makeFetch(options?: {
  failedRunId?: number;
  wrongRegistryDigest?: boolean;
  calls?: string[];
}): typeof fetch {
  const workflowNames: Record<number, string> = {
    101: "CI",
    102: "Security",
    103: "Build release-candidate images and SBOM",
  };
  return async (input, init) => {
    const url = String(input);
    options?.calls?.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("https://api.github.com/")) {
      const id = Number(url.split("/").at(-1));
      return new Response(
        JSON.stringify({
          head_sha: evidenceCommit,
          status: "completed",
          conclusion: id === options?.failedRunId ? "failure" : "success",
          name: workflowNames[id],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("https://ghcr.io/token?")) {
      return new Response(JSON.stringify({ token: "scoped-read-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith("https://ghcr.io/v2/")) {
      const digest = decodeURIComponent(url.split("/manifests/")[1] ?? "");
      return new Response(null, {
        status: 200,
        headers: {
          "docker-content-digest": options?.wrongRegistryDigest
            ? `sha256:${"f".repeat(64)}`
            : digest,
        },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

describe("V1 platform evidence verification", () => {
  it("verifies live GitHub run identity and all seven immutable GHCR digests", async () => {
    const calls: string[] = [];
    const result = await verifyV1PlatformEvidence(makeManifest(), {
      repository: "example/fiatlux-choice",
      actor: "release-operator",
      token: "test-token",
      fetchImpl: makeFetch({ calls }),
    });

    expect(result.githubRuns).toHaveLength(3);
    expect(result.registryArtifacts.map(({ artifact }) => artifact)).toEqual(releaseArtifacts);
    expect(calls.filter((call) => call.startsWith("GET https://api.github.com/"))).toHaveLength(3);
    expect(calls.filter((call) => call.startsWith("HEAD https://ghcr.io/v2/"))).toHaveLength(7);
  });

  it("rejects a GitHub run that is not actually green", async () => {
    await expect(
      verifyV1PlatformEvidence(makeManifest(), {
        repository: "example/fiatlux-choice",
        actor: "release-operator",
        token: "test-token",
        fetchImpl: makeFetch({ failedRunId: 102 }),
      }),
    ).rejects.toThrow(/conclusion=failure/);
  });

  it("rejects a registry response that resolves to a different digest", async () => {
    await expect(
      verifyV1PlatformEvidence(makeManifest(), {
        repository: "example/fiatlux-choice",
        actor: "release-operator",
        token: "test-token",
        fetchImpl: makeFetch({ wrongRegistryDigest: true }),
      }),
    ).rejects.toThrow(/digest 不一致/);
  });

  it("does not make external calls for a blocked manifest", async () => {
    const manifest = makeManifest();
    manifest.overallStatus = "blocked";
    const githubGate = manifest.gates[0];
    if (!githubGate) throw new Error("Missing GitHub test gate");
    githubGate.status = "blocked";
    githubGate.blockers = ["GitHub CI 仍未通过，不能执行平台证明。"];
    const calls: string[] = [];
    await expect(
      verifyV1PlatformEvidence(manifest, {
        repository: "example/fiatlux-choice",
        actor: "release-operator",
        token: "test-token",
        fetchImpl: makeFetch({ calls }),
      }),
    ).rejects.toThrow(/尚未 ready/);
    expect(calls).toEqual([]);
  });
});
