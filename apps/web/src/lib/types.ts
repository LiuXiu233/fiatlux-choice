export type RecordStatus =
  | "draft"
  | "active"
  | "pending"
  | "pending_approval"
  | "approved"
  | "submitted"
  | "confirmed"
  | "completed"
  | "blocked"
  | "overdue"
  | "rejected"
  | "failed"
  | "archived"
  | string;

export interface UserSession {
  id: string;
  orgId: string;
  email: string;
  displayName: string;
  role: string;
  permissions: string[];
  mustChangePassword: boolean;
}

export interface BusinessRecord {
  id: string;
  orgId?: string;
  title?: string;
  name?: string;
  summary?: string;
  description?: string;
  status: RecordStatus;
  ownerName?: string;
  assigneeName?: string;
  category?: string;
  priority?: string;
  amount?: number | string;
  value?: number | string;
  dueDate?: string;
  deadline?: string;
  updatedAt?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
  pageCount?: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PageMeta;
}

export interface DashboardData {
  greeting?: string;
  metrics: Array<{
    key: string;
    label: string;
    value: number | string;
    delta?: string;
    tone?: "neutral" | "positive" | "warning" | "danger";
  }>;
  priorities: BusinessRecord[];
  deadlines: BusinessRecord[];
  cashflow: Array<{ label: string; inflow: number; outflow: number }>;
  riskSummary: Array<{ label: string; value: number; tone: string }>;
  advisorBriefs: Array<{
    advisor: string;
    title: string;
    confidence: number;
    createdAt: string;
    status: string;
  }>;
}

export interface AdvisorDefinition {
  id?: string;
  code?: string;
  key?: string;
  name: string;
  remit?: string;
  purpose?: string;
  dataScopes?: string[];
  icon?: string;
  requiredPermission?: string;
  lastRunAt?: string;
  status?: string;
  promptVersion?: {
    advisorKey: string;
    versionNumber: number;
    dataScopes: string[];
    updatedAt: string;
  } | null;
}

export interface AdvisorRun extends BusinessRecord {
  advisorCode?: string;
  advisorKey?: string;
  question?: string;
  promptVersion?: string;
  promptVersionId?: string;
  model?: string;
  facts?: Array<{ statement: string; source: string }>;
  inferences?: Array<{ statement: string; basis: string }>;
  recommendations?: Array<{ action: string; rationale: string; priority: string }>;
  risks?: Array<{ description: string; severity: string }>;
  missingInformation?: string[];
  confidence: number;
  output?: {
    facts: Array<{
      claim: string;
      evidence: Array<{ sourceType: string; sourceId: string; excerpt?: string }>;
    }>;
    inferences: Array<{ claim: string; basis: string[]; confidence: number }>;
    recommendations: Array<{ action: string; rationale: string; risk: string; priority: string }>;
    risks: Array<{ description: string; severity: string; mitigation: string }>;
    missingInformation: string[];
    confidence: number;
    disclaimer: string;
  };
  citations?: Array<{
    title?: string;
    url?: string;
    recordId?: string;
    sourceType?: string;
    sourceId?: string;
  }>;
  toolCalls?: Array<{ id?: string; tool?: string; toolName?: string; status: string }>;
  modelCalls?: Array<{ model?: string; status?: string }>;
  version?: number;
}

export interface ApprovalRequest extends BusinessRecord {
  actionType?: string;
  operation?: string;
  riskLevel: string;
  requestedByName?: string;
  requestedBy?: string;
  requestedAt?: string;
  reason: string;
  externalState?: string;
  evidenceRequired?: boolean;
}
