import type { AdvisorKey, ResourceName } from "@fiatlux/contracts";

export type ResourceAction = "read" | "create" | "update" | "delete";

export function permissionFor(resource: ResourceName | string, action: ResourceAction | string) {
  return `${resource}:${action}`;
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  if (granted.includes("*") || granted.includes(required)) {
    return true;
  }

  const separator = required.indexOf(":");
  if (separator === -1) {
    return false;
  }

  return granted.includes(`${required.slice(0, separator)}:*`);
}

export function assertPermission(granted: readonly string[], required: string): void {
  if (!hasPermission(granted, required)) {
    const error = new Error(`Missing permission: ${required}`);
    error.name = "PermissionDenied";
    throw error;
  }
}

export const ADVISOR_DATA_SCOPES: Record<AdvisorKey, readonly string[]> = {
  general_manager: [
    "objectives",
    "projects",
    "tasks",
    "decisions",
    "obligations",
    "risks",
    "contracts",
    "financial-entries",
    "cash-flow",
    "products",
    "opportunities",
  ],
  finance: ["financial-entries", "invoices", "cash-flow", "contracts", "objectives"],
  legal_compliance: [
    "compliance-items",
    "compliance-events",
    "obligations",
    "risks",
    "contracts",
    "decisions",
  ],
  product_rnd: ["products", "projects", "tasks", "decisions", "github-insights", "risks"],
  market_opportunity: [
    "opportunities",
    "products",
    "projects",
    "contracts",
    "objectives",
    "decisions",
  ],
  hr_admin: ["objectives", "projects", "tasks", "obligations", "risks"],
  information_security: [
    "risks",
    "compliance-items",
    "compliance-events",
    "github-insights",
    "audit-events",
  ],
};

export function canAdvisorRead(advisor: AdvisorKey, resourceType: string): boolean {
  return ADVISOR_DATA_SCOPES[advisor].includes(resourceType);
}
