import { describe, expect, it } from "vitest";

import {
  evaluateV1ReleaseReadiness,
  type V1ReleaseGateId,
  type V1ReleaseReadinessManifest,
  v1ReleaseReadinessManifestSchema,
} from "../src/index.js";

const implementationCommit = "a".repeat(40);
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

type ReleaseGate = V1ReleaseReadinessManifest["gates"][number];
type ReleaseEvidence = ReleaseGate["evidence"][number];
type ReleaseEvidenceKind = ReleaseEvidence["kind"];

function evidence(
  kind: ReleaseEvidenceKind,
  reference: string,
  subjectCommit?: string,
): ReleaseEvidence {
  return {
    kind,
    result: "success",
    reference,
    verifiedAt,
    ...(subjectCommit ? { subjectCommit } : {}),
  };
}

function approvalReference(id: V1ReleaseGateId): string {
  return `approval:v1:${id}:approved-20260720`;
}

function approvalEvidence(id: V1ReleaseGateId): ReleaseEvidence {
  return evidence("approval", approvalReference(id));
}

function passedGate(
  id: V1ReleaseGateId,
  gateEvidence: ReleaseEvidence[],
  approvalRequired = false,
): ReleaseGate {
  return {
    id,
    status: "passed",
    ownerRole: "V1 发布负责人",
    summary: `${id} 已取得可追溯成功证据并通过发布复核。`,
    evidence: gateEvidence,
    blockers: [],
    ...(approvalRequired
      ? {
          approval: {
            approverIdentity: "release-owner@example.invalid",
            approverRole: "公司负责人",
            approvalReference: approvalReference(id),
            approvedAt: verifiedAt,
          },
        }
      : {}),
    reviewedAt: verifiedAt,
  };
}

function makeReadyManifest(): V1ReleaseReadinessManifest {
  const registryEvidence = releaseArtifacts.map((releaseArtifact, index) => ({
    ...evidence(
      "registry",
      `ghcr.io/example/fiatlux-${releaseArtifact}@sha256:${String(index + 1).repeat(64)}`,
      evidenceCommit,
    ),
    releaseArtifact,
  }));

  return {
    schemaVersion: 1,
    versionLabel: "V1 release candidate",
    overallStatus: "ready",
    evaluatedAt: verifiedAt,
    candidate: {
      repository: "https://github.com/example/fiatlux-choice",
      branch: "codex/release-candidate",
      implementationCommit,
      evidenceCommit,
    },
    gates: [
      passedGate("local_core_acceptance", [
        evidence(
          "machine_evidence",
          "docs/delivery/evidence/core-acceptance.json",
          implementationCommit,
        ),
      ]),
      passedGate("local_security_and_sensitive_data", [
        evidence(
          "machine_evidence",
          "docs/delivery/evidence/security-acceptance.json",
          implementationCommit,
        ),
      ]),
      passedGate("github_ci_security", [
        {
          ...evidence(
            "github_run",
            "https://github.com/example/fiatlux-choice/actions/runs/1001",
            evidenceCommit,
          ),
          githubWorkflow: "ci",
        },
        {
          ...evidence(
            "github_run",
            "https://github.com/example/fiatlux-choice/actions/runs/1002",
            evidenceCommit,
          ),
          githubWorkflow: "security",
        },
      ]),
      passedGate("ghcr_release_artifacts", [
        ...registryEvidence,
        {
          ...evidence(
            "github_run",
            "https://github.com/example/fiatlux-choice/actions/runs/1003",
            evidenceCommit,
          ),
          githubWorkflow: "release",
        },
      ]),
      passedGate(
        "target_intranet_deployment",
        [
          evidence(
            "target_environment",
            "target-environment:guangzhou-intranet:deployment-001",
            evidenceCommit,
          ),
          approvalEvidence("target_intranet_deployment"),
        ],
        true,
      ),
      passedGate(
        "managed_device_pwa",
        [
          evidence(
            "target_environment",
            "target-device:managed-phone:pwa-install-001",
            evidenceCommit,
          ),
          approvalEvidence("managed_device_pwa"),
        ],
        true,
      ),
      passedGate(
        "production_backup_restore",
        [
          evidence(
            "machine_evidence",
            "target-environment:restore-drill:production-001",
            evidenceCommit,
          ),
          approvalEvidence("production_backup_restore"),
        ],
        true,
      ),
      passedGate(
        "real_llm_github_adapters",
        [
          evidence(
            "machine_evidence",
            "target-environment:real-adapters:acceptance-001",
            evidenceCommit,
          ),
          approvalEvidence("real_llm_github_adapters"),
        ],
        true,
      ),
      passedGate(
        "compliance_professional_review",
        [
          evidence("professional_review", "professional-review:compliance-catalog:batch-001"),
          approvalEvidence("compliance_professional_review"),
        ],
        true,
      ),
      passedGate(
        "education_content_clearance",
        [
          evidence(
            "machine_evidence",
            "machine-evidence:education-content-clearance:session-001",
            implementationCommit,
          ),
          evidence("professional_review", "professional-review:education-library:batch-001"),
          evidence("external_publication", "https://fiatlux.gg/education/publication-register/001"),
          approvalEvidence("education_content_clearance"),
        ],
        true,
      ),
      passedGate(
        "operational_responsibility_drills",
        [
          evidence(
            "target_environment",
            "target-environment:operator-drills:acceptance-001",
            evidenceCommit,
          ),
          approvalEvidence("operational_responsibility_drills"),
        ],
        true,
      ),
      passedGate(
        "residual_risk_decisions",
        [
          evidence("risk_decision", "risk-register:v1-residual-risks:accepted-001"),
          approvalEvidence("residual_risk_decisions"),
        ],
        true,
      ),
      passedGate(
        "known_blocking_defects_closed",
        [
          evidence("risk_decision", "defect-register:v1-blockers:closed-001"),
          approvalEvidence("known_blocking_defects_closed"),
        ],
        true,
      ),
      passedGate(
        "business_release_approval",
        [approvalEvidence("business_release_approval")],
        true,
      ),
    ],
  };
}

function gateById(manifest: V1ReleaseReadinessManifest, id: V1ReleaseGateId): ReleaseGate {
  const gate = manifest.gates.find((candidate) => candidate.id === id);
  if (!gate) throw new Error(`Missing test gate: ${id}`);
  return gate;
}

function evidenceAt(gate: ReleaseGate, index: number): ReleaseEvidence {
  const item = gate.evidence[index];
  if (!item) throw new Error(`Missing test evidence ${index} for gate ${gate.id}`);
  return item;
}

function makeBlockedManifest(): V1ReleaseReadinessManifest {
  const manifest = structuredClone(makeReadyManifest());
  const gate = gateById(manifest, "business_release_approval");
  gate.status = "blocked";
  gate.evidence = [
    {
      ...approvalEvidence("business_release_approval"),
      result: "not_run",
    },
  ];
  gate.blockers = ["尚未取得可识别公司负责人的最终发布批准。"];
  delete gate.approval;
  manifest.overallStatus = "blocked";
  return manifest;
}

describe("V1 release readiness manifest", () => {
  it("accepts a complete ready manifest and evaluates every gate", () => {
    const parsed = v1ReleaseReadinessManifestSchema.parse(makeReadyManifest());
    expect(evaluateV1ReleaseReadiness(parsed)).toMatchObject({
      ready: true,
      overallStatus: "ready",
      totalGateCount: 14,
      passedGateCount: 14,
      blockedGateCount: 0,
    });
  });

  it("accepts an explicit blocker and reports it without overstating readiness", () => {
    const parsed = v1ReleaseReadinessManifestSchema.parse(makeBlockedManifest());
    expect(evaluateV1ReleaseReadiness(parsed)).toMatchObject({
      ready: false,
      overallStatus: "blocked",
      passedGateCount: 13,
      blockedGateCount: 1,
      blockedGates: [
        {
          id: "business_release_approval",
          ownerRole: "V1 发布负责人",
          blockers: ["尚未取得可识别公司负责人的最终发布批准。"],
        },
      ],
    });
  });

  it("rejects duplicate and therefore missing gate identifiers", () => {
    const manifest = structuredClone(makeReadyManifest());
    gateById(manifest, "business_release_approval").id = "known_blocking_defects_closed";
    const result = v1ReleaseReadinessManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(({ message }) => message);
      expect(messages.some((message) => message.includes("门禁重复"))).toBe(true);
      expect(messages.some((message) => message.includes("缺少 V1 门禁"))).toBe(true);
    }
  });

  it("rejects a passed gate containing non-success evidence", () => {
    const manifest = structuredClone(makeReadyManifest());
    evidenceAt(gateById(manifest, "local_core_acceptance"), 0).result = "blocked";
    expect(v1ReleaseReadinessManifestSchema.safeParse(manifest).success).toBe(false);

    const wrongCommit = structuredClone(makeReadyManifest());
    evidenceAt(gateById(wrongCommit, "local_security_and_sensitive_data"), 0).subjectCommit =
      evidenceCommit;
    expect(v1ReleaseReadinessManifestSchema.safeParse(wrongCommit).success).toBe(false);
  });

  it("binds education clearance machine evidence to the implementation commit", () => {
    const missingMachineEvidence = structuredClone(makeReadyManifest());
    gateById(missingMachineEvidence, "education_content_clearance").evidence = gateById(
      missingMachineEvidence,
      "education_content_clearance",
    ).evidence.filter(({ kind }) => kind !== "machine_evidence");
    expect(v1ReleaseReadinessManifestSchema.safeParse(missingMachineEvidence).success).toBe(false);

    const wrongCommit = structuredClone(makeReadyManifest());
    const machineEvidence = gateById(wrongCommit, "education_content_clearance").evidence.find(
      ({ kind }) => kind === "machine_evidence",
    );
    if (!machineEvidence) throw new Error("Missing education machine evidence");
    machineEvidence.subjectCommit = evidenceCommit;
    expect(v1ReleaseReadinessManifestSchema.safeParse(wrongCommit).success).toBe(false);
  });

  it("requires two distinct GitHub runs bound to the evidence commit", () => {
    const oneRun = structuredClone(makeReadyManifest());
    gateById(oneRun, "github_ci_security").evidence.pop();
    expect(v1ReleaseReadinessManifestSchema.safeParse(oneRun).success).toBe(false);

    const wrongCommit = structuredClone(makeReadyManifest());
    evidenceAt(gateById(wrongCommit, "github_ci_security"), 1).subjectCommit = implementationCommit;
    expect(v1ReleaseReadinessManifestSchema.safeParse(wrongCommit).success).toBe(false);

    const duplicateWorkflow = structuredClone(makeReadyManifest());
    evidenceAt(gateById(duplicateWorkflow, "github_ci_security"), 1).githubWorkflow = "ci";
    expect(v1ReleaseReadinessManifestSchema.safeParse(duplicateWorkflow).success).toBe(false);
  });

  it("requires seven distinct GHCR artifacts bound to the evidence commit", () => {
    const tooFew = structuredClone(makeReadyManifest());
    gateById(tooFew, "ghcr_release_artifacts").evidence.pop();
    expect(v1ReleaseReadinessManifestSchema.safeParse(tooFew).success).toBe(false);

    const wrongCommit = structuredClone(makeReadyManifest());
    evidenceAt(gateById(wrongCommit, "ghcr_release_artifacts"), 0).subjectCommit =
      implementationCommit;
    expect(v1ReleaseReadinessManifestSchema.safeParse(wrongCommit).success).toBe(false);

    const duplicateArtifact = structuredClone(makeReadyManifest());
    evidenceAt(gateById(duplicateArtifact, "ghcr_release_artifacts"), 0).releaseArtifact = "web";
    expect(v1ReleaseReadinessManifestSchema.safeParse(duplicateArtifact).success).toBe(false);

    const missingReleaseRun = structuredClone(makeReadyManifest());
    gateById(missingReleaseRun, "ghcr_release_artifacts").evidence = gateById(
      missingReleaseRun,
      "ghcr_release_artifacts",
    ).evidence.filter(({ githubWorkflow }) => githubWorkflow !== "release");
    expect(v1ReleaseReadinessManifestSchema.safeParse(missingReleaseRun).success).toBe(false);
  });

  it("requires identifiable approval metadata and matching approval evidence", () => {
    const missingApproval = structuredClone(makeReadyManifest());
    delete gateById(missingApproval, "target_intranet_deployment").approval;
    expect(v1ReleaseReadinessManifestSchema.safeParse(missingApproval).success).toBe(false);

    const missingApprovalEvidence = structuredClone(makeReadyManifest());
    gateById(missingApprovalEvidence, "managed_device_pwa").evidence = [
      evidence("target_environment", "target-device:managed-phone:pwa-install-001", evidenceCommit),
    ];
    expect(v1ReleaseReadinessManifestSchema.safeParse(missingApprovalEvidence).success).toBe(false);

    const mismatchedApprovalEvidence = structuredClone(makeReadyManifest());
    const approval = gateById(mismatchedApprovalEvidence, "business_release_approval").approval;
    if (!approval) throw new Error("Missing test approval");
    approval.approvalReference = "approval:v1:business-release:another-record";
    expect(v1ReleaseReadinessManifestSchema.safeParse(mismatchedApprovalEvidence).success).toBe(
      false,
    );
  });

  it("rejects an overall status that disagrees with individual gates", () => {
    const manifest = makeBlockedManifest();
    manifest.overallStatus = "ready";
    expect(v1ReleaseReadinessManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
