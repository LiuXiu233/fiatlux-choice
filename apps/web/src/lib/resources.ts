import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Banknote,
  Boxes,
  CalendarCheck,
  ClipboardCheck,
  CodeXml,
  FileCheck2,
  FileClock,
  FolderKanban,
  Goal,
  Lightbulb,
  ListChecks,
  Megaphone,
  ReceiptText,
  Scale,
  ShieldAlert,
  Target,
  Users,
  Workflow,
} from "lucide-react";
import { formatDate, formatDateTime, formatMoneyCents } from "./format";

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime-local"
  | "select"
  | "url"
  | "email"
  | "password"
  | "boolean"
  | "json"
  | "reference";

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldConfig {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: FieldOption[];
  placeholder?: string;
  width?: "full" | "half";
  defaultValue?: string;
  referenceEndpoint?: string;
  referenceLabelKey?: string;
}

export interface ColumnConfig {
  key: string;
  label: string;
  format?: (value: unknown) => string;
}

export interface ResourceConfig {
  key: string;
  endpoint: string;
  title: string;
  singular: string;
  description: string;
  icon: LucideIcon;
  permission: string;
  readOnly?: boolean;
  archivable?: boolean;
  statuses: FieldOption[];
  columns: ColumnConfig[];
  fields: FieldConfig[];
  updateFields?: FieldConfig[];
}

const statusOptions = (...entries: Array<[string, string]>): FieldOption[] =>
  entries.map(([value, label]) => ({ value, label }));

const objectiveStatuses = statusOptions(
  ["draft", "草稿"],
  ["active", "进行中"],
  ["at_risk", "有风险"],
  ["completed", "已完成"],
  ["cancelled", "已取消"],
);
const projectStatuses = statusOptions(
  ["planned", "计划中"],
  ["active", "进行中"],
  ["blocked", "已阻塞"],
  ["completed", "已完成"],
  ["cancelled", "已取消"],
);
const taskStatuses = statusOptions(
  ["todo", "待办"],
  ["in_progress", "进行中"],
  ["blocked", "已阻塞"],
  ["done", "已完成"],
  ["cancelled", "已取消"],
);
const decisionStatuses = statusOptions(
  ["proposed", "待决策"],
  ["approved", "已通过"],
  ["rejected", "已否决"],
  ["superseded", "已替代"],
);
const obligationStatuses = statusOptions(
  ["open", "待处理"],
  ["in_progress", "处理中"],
  ["satisfied", "已履行"],
  ["overdue", "已逾期"],
  ["waived", "已豁免"],
);
const complianceStatuses = statusOptions(
  ["draft", "草稿"],
  ["active", "现行"],
  ["superseded", "已替代"],
  ["repealed", "已废止"],
  ["uncertain", "待确认"],
);
const calendarStatuses = statusOptions(
  ["draft", "草稿"],
  ["active", "进行中"],
  ["pending", "等待"],
  ["completed", "已完成"],
  ["blocked", "已阻塞"],
  ["overdue", "已逾期"],
  ["cancelled", "已取消"],
  ["archived", "已归档"],
);
const riskStatuses = statusOptions(
  ["open", "开放"],
  ["mitigating", "缓解中"],
  ["accepted", "已接受"],
  ["closed", "已关闭"],
);
const contractStatuses = statusOptions(
  ["draft", "草稿"],
  ["review", "审核中"],
  ["pending_signature", "待签署"],
  ["active", "履行中"],
  ["expired", "已到期"],
  ["terminated", "已终止"],
);
const financeStatuses = statusOptions(["draft", "草稿"], ["posted", "已入账"], ["void", "已作废"]);
const invoiceStatuses = statusOptions(
  ["draft", "草稿"],
  ["issued", "已开具"],
  ["received", "已收到"],
  ["paid", "已结清"],
  ["void", "已作废"],
  ["red_pending", "红冲待批准"],
  ["red_confirmed", "红冲已确认"],
);
const cashStatuses = statusOptions(
  ["forecast", "预测"],
  ["actual", "实际"],
  ["cancelled", "已取消"],
);
const productStatuses = statusOptions(
  ["on_track", "正常"],
  ["at_risk", "有风险"],
  ["paused", "已暂停"],
  ["closed", "已关闭"],
);
const opportunityStatuses = statusOptions(
  ["new", "新线索"],
  ["qualified", "已验证"],
  ["proposal", "方案中"],
  ["won", "已赢单"],
  ["lost", "已失单"],
  ["on_hold", "暂缓"],
);
const notificationStatuses = statusOptions(
  ["queued", "排队中"],
  ["sent", "已发送"],
  ["failed", "失败"],
  ["read", "已读"],
);

const titleField = (label = "名称"): FieldConfig => ({
  key: "title",
  label,
  kind: "text",
  required: true,
  width: "full",
});
const statusField = (options: FieldOption[], defaultValue = options[0]?.value): FieldConfig => ({
  key: "status",
  label: "状态",
  kind: "select",
  required: true,
  options,
  ...(defaultValue ? { defaultValue } : {}),
});
const descriptionField: FieldConfig = {
  key: "description",
  label: "说明",
  kind: "textarea",
  width: "full",
};
const currencyField: FieldConfig = {
  key: "currency",
  label: "币种",
  kind: "select",
  required: true,
  defaultValue: "CNY",
  options: [{ label: "人民币 CNY", value: "CNY" }],
};
const userField = (key: string, label: string): FieldConfig => ({
  key,
  label,
  kind: "reference",
  referenceEndpoint: "/users",
  referenceLabelKey: "displayName",
});

export const resources: Record<string, ResourceConfig> = {
  goals: {
    key: "goals",
    endpoint: "/objectives",
    title: "目标",
    singular: "目标",
    description: "公司级与项目级目标及量化进度",
    icon: Goal,
    permission: "objectives",
    statuses: objectiveStatuses,
    columns: [
      { key: "title", label: "目标" },
      { key: "status", label: "状态" },
      { key: "progress", label: "进度", format: (value) => `${Number(value ?? 0)}%` },
      { key: "dueAt", label: "截止", format: formatDate },
      { key: "updatedAt", label: "更新", format: formatDateTime },
    ],
    fields: [
      titleField("目标"),
      statusField(objectiveStatuses),
      { key: "progress", label: "进度（%）", kind: "number", defaultValue: "0" },
      userField("ownerId", "负责人"),
      { key: "startsAt", label: "开始时间", kind: "datetime-local" },
      { key: "dueAt", label: "截止时间", kind: "datetime-local" },
      descriptionField,
    ],
  },
  projects: {
    key: "projects",
    endpoint: "/projects",
    title: "项目",
    singular: "项目",
    description: "业务、赛事、教育与内部建设项目",
    icon: FolderKanban,
    permission: "projects",
    statuses: projectStatuses,
    columns: [
      { key: "name", label: "项目" },
      { key: "status", label: "状态" },
      { key: "startsAt", label: "开始", format: formatDate },
      { key: "dueAt", label: "截止", format: formatDate },
      { key: "updatedAt", label: "更新", format: formatDateTime },
    ],
    fields: [
      { key: "name", label: "项目名称", kind: "text", required: true, width: "full" },
      statusField(projectStatuses),
      {
        key: "objectiveId",
        label: "关联目标",
        kind: "reference",
        referenceEndpoint: "/objectives",
        referenceLabelKey: "title",
      },
      userField("ownerId", "负责人"),
      { key: "startsAt", label: "开始时间", kind: "datetime-local" },
      { key: "dueAt", label: "截止时间", kind: "datetime-local" },
      descriptionField,
    ],
  },
  tasks: {
    key: "tasks",
    endpoint: "/tasks",
    title: "任务",
    singular: "任务",
    description: "跨项目的可执行工作与到期提醒",
    icon: ListChecks,
    permission: "tasks",
    statuses: taskStatuses,
    columns: [
      { key: "title", label: "任务" },
      { key: "status", label: "状态" },
      { key: "priority", label: "优先级" },
      { key: "dueAt", label: "到期", format: formatDate },
      { key: "updatedAt", label: "更新", format: formatDateTime },
    ],
    fields: [
      titleField("任务"),
      statusField(taskStatuses),
      {
        key: "priority",
        label: "优先级",
        kind: "select",
        required: true,
        defaultValue: "normal",
        options: statusOptions(
          ["low", "低"],
          ["normal", "普通"],
          ["high", "高"],
          ["urgent", "紧急"],
        ),
      },
      {
        key: "projectId",
        label: "关联项目",
        kind: "reference",
        referenceEndpoint: "/projects",
        referenceLabelKey: "name",
      },
      userField("assigneeId", "执行人"),
      { key: "dueAt", label: "到期时间", kind: "datetime-local" },
      descriptionField,
    ],
  },
  decisions: {
    key: "decisions",
    endpoint: "/decisions",
    title: "决策",
    singular: "决策",
    description: "记录决策背景、结论与后续证据",
    icon: Lightbulb,
    permission: "decisions",
    statuses: decisionStatuses,
    columns: [
      { key: "title", label: "议题" },
      { key: "status", label: "状态" },
      { key: "decision", label: "结论" },
      { key: "decidedAt", label: "决策时间", format: formatDate },
    ],
    fields: [
      titleField("议题"),
      statusField(decisionStatuses),
      {
        key: "objectiveId",
        label: "关联目标",
        kind: "reference",
        referenceEndpoint: "/objectives",
        referenceLabelKey: "title",
      },
      {
        key: "projectId",
        label: "关联项目",
        kind: "reference",
        referenceEndpoint: "/projects",
        referenceLabelKey: "name",
      },
      {
        key: "taskId",
        label: "关联任务",
        kind: "reference",
        referenceEndpoint: "/tasks",
        referenceLabelKey: "title",
      },
      { key: "context", label: "背景与选项", kind: "textarea", required: true, width: "full" },
      { key: "decision", label: "决策结论", kind: "textarea", width: "full" },
      { key: "decidedAt", label: "决策时间", kind: "datetime-local" },
    ],
  },
  obligations: {
    key: "obligations",
    endpoint: "/obligations",
    title: "公司义务",
    singular: "义务",
    description: "工商、税务、劳动、合同、数据与档案义务",
    icon: ClipboardCheck,
    permission: "obligations",
    statuses: obligationStatuses,
    columns: [
      { key: "title", label: "义务" },
      { key: "category", label: "领域" },
      { key: "status", label: "状态" },
      { key: "dueAt", label: "到期", format: formatDate },
    ],
    fields: [
      titleField("义务"),
      statusField(obligationStatuses),
      {
        key: "category",
        label: "领域",
        kind: "select",
        required: true,
        options: statusOptions(
          ["corporate", "公司治理"],
          ["tax", "财税"],
          ["labor", "劳动"],
          ["contract", "合同"],
          ["data", "数据"],
          ["ip", "知识产权"],
          ["archive", "档案"],
          ["other", "其他"],
        ),
      },
      userField("ownerId", "负责人"),
      { key: "dueAt", label: "到期时间", kind: "datetime-local" },
      {
        key: "sourceId",
        label: "关联合规来源",
        kind: "reference",
        referenceEndpoint: "/compliance-items",
        referenceLabelKey: "title",
      },
      {
        key: "evidenceFileId",
        label: "履行证据文件",
        kind: "reference",
        referenceEndpoint: "/files?status=uploaded",
        referenceLabelKey: "filename",
      },
      {
        key: "recurrenceRule",
        label: "重复规则（仅元数据）",
        kind: "text",
        placeholder: "仅记录规则，例如 FREQ=MONTHLY；V1 不自动生成下一期",
      },
      descriptionField,
    ],
  },
  "compliance-events": {
    key: "compliance-events",
    endpoint: "/compliance-events",
    title: "合规日历",
    singular: "合规事项",
    description: "按适用条件生成并人工复核的合规时间表",
    icon: CalendarCheck,
    permission: "compliance-events",
    statuses: calendarStatuses,
    columns: [
      { key: "title", label: "事项" },
      { key: "category", label: "领域" },
      { key: "status", label: "状态" },
      { key: "dueDate", label: "到期", format: formatDate },
      { key: "reviewStatus", label: "复核" },
    ],
    fields: [
      titleField("事项"),
      statusField(calendarStatuses),
      { key: "category", label: "领域", kind: "text", required: true },
      {
        key: "eventType",
        label: "事项类型",
        kind: "select",
        required: true,
        defaultValue: "deadline",
        options: statusOptions(
          ["deadline", "期限"],
          ["review", "复核"],
          ["filing", "申报"],
          ["renewal", "续期"],
          ["training", "培训"],
          ["monitoring", "监测"],
        ),
      },
      { key: "dueDate", label: "到期日期", kind: "date", required: true },
      {
        key: "reviewStatus",
        label: "复核状态",
        kind: "select",
        required: true,
        defaultValue: "pending",
        options: statusOptions(["pending", "待复核"], ["reviewed", "已复核"], ["stale", "需更新"]),
      },
      userField("ownerId", "负责人"),
      {
        key: "sourceId",
        label: "关联合规来源",
        kind: "reference",
        referenceEndpoint: "/compliance-items",
        referenceLabelKey: "title",
      },
      {
        key: "evidenceFileId",
        label: "完成证据文件",
        kind: "reference",
        referenceEndpoint: "/files?status=uploaded",
        referenceLabelKey: "filename",
      },
      { key: "description", label: "说明", kind: "textarea", width: "full" },
    ],
  },
  "compliance-items": {
    key: "compliance-items",
    endpoint: "/compliance-items",
    title: "合规知识库",
    singular: "合规条目",
    description: "官方来源、适用条件、时效与人工复核记录",
    icon: Scale,
    permission: "compliance-items",
    statuses: complianceStatuses,
    columns: [
      { key: "title", label: "主题" },
      { key: "category", label: "领域" },
      { key: "issuingAuthority", label: "发布机关" },
      { key: "reviewStatus", label: "复核" },
      { key: "nextReviewAt", label: "人工复核截止", format: formatDate },
      { key: "contentHashStatus", label: "来源检查" },
      { key: "nextMonitorAt", label: "下次检查", format: formatDate },
    ],
    fields: [
      titleField("主题"),
      statusField(complianceStatuses),
      { key: "category", label: "领域", kind: "text", required: true },
      { key: "issuingAuthority", label: "发布机关", kind: "text", required: true },
      { key: "sourceUrl", label: "官方来源", kind: "url", required: true, width: "full" },
      { key: "effectiveDate", label: "生效日期", kind: "date" },
      { key: "lastVerifiedAt", label: "核验日期", kind: "date" },
      { key: "nextReviewAt", label: "最迟人工复核日", kind: "date" },
      {
        key: "monitoringCadenceDays",
        label: "自动检查周期（天）",
        kind: "number",
        required: true,
        defaultValue: "30",
      },
      {
        key: "reviewStatus",
        label: "人工复核",
        kind: "select",
        required: true,
        defaultValue: "pending",
        options: statusOptions(["pending", "待复核"], ["reviewed", "已复核"], ["stale", "需更新"]),
      },
      { key: "applicability", label: "适用条件", kind: "textarea", width: "full" },
      { key: "summary", label: "工作摘要", kind: "textarea", width: "full" },
    ],
  },
  risks: {
    key: "risks",
    endpoint: "/risks",
    title: "风险",
    singular: "风险",
    description: "经营、合规、财务、技术与安全风险登记册",
    icon: ShieldAlert,
    permission: "risks",
    statuses: riskStatuses,
    columns: [
      { key: "title", label: "风险" },
      { key: "status", label: "状态" },
      { key: "likelihood", label: "可能性" },
      { key: "impact", label: "影响" },
      { key: "updatedAt", label: "更新", format: formatDateTime },
    ],
    fields: [
      titleField("风险"),
      statusField(riskStatuses),
      {
        key: "likelihood",
        label: "可能性（1–5）",
        kind: "number",
        required: true,
        defaultValue: "3",
      },
      { key: "impact", label: "影响（1–5）", kind: "number", required: true, defaultValue: "3" },
      userField("ownerId", "责任人"),
      { key: "description", label: "风险描述", kind: "textarea", required: true, width: "full" },
      { key: "treatment", label: "缓解措施", kind: "textarea", width: "full" },
    ],
  },
  contracts: {
    key: "contracts",
    endpoint: "/contracts",
    title: "合同",
    singular: "合同",
    description: "合同台账、履约节点和签署审批",
    icon: FileCheck2,
    permission: "contracts",
    statuses: contractStatuses,
    columns: [
      { key: "name", label: "合同" },
      { key: "counterparty", label: "相对方" },
      { key: "status", label: "状态" },
      { key: "valueCents", label: "金额", format: formatMoneyCents },
      { key: "endsAt", label: "到期", format: formatDate },
    ],
    fields: [
      { key: "name", label: "合同名称", kind: "text", required: true, width: "full" },
      statusField(contractStatuses),
      { key: "counterparty", label: "相对方", kind: "text", required: true },
      { key: "contractNumber", label: "合同编号", kind: "text" },
      { key: "valueCents", label: "合同金额（元）", kind: "number" },
      currencyField,
      { key: "startsAt", label: "开始时间", kind: "datetime-local" },
      { key: "endsAt", label: "结束时间", kind: "datetime-local" },
      {
        key: "fileId",
        label: "合同原件",
        kind: "reference",
        referenceEndpoint: "/files?status=uploaded",
        referenceLabelKey: "filename",
      },
      userField("ownerId", "经办人"),
    ],
  },
  transactions: {
    key: "transactions",
    endpoint: "/financial-entries",
    title: "收支",
    singular: "收支记录",
    description: "现金收支台账与付款审批证据",
    icon: Banknote,
    permission: "financial-entries",
    statuses: financeStatuses,
    columns: [
      { key: "description", label: "摘要" },
      { key: "type", label: "类型" },
      { key: "amountCents", label: "金额", format: formatMoneyCents },
      { key: "status", label: "状态" },
      { key: "externalActionId", label: "付款动作" },
      { key: "occurredAt", label: "日期", format: formatDate },
    ],
    fields: [
      { key: "description", label: "摘要", kind: "text", required: true, width: "full" },
      {
        key: "type",
        label: "类型",
        kind: "select",
        required: true,
        defaultValue: "expense",
        options: statusOptions(
          ["income", "收入"],
          ["expense", "支出"],
          ["transfer", "转账"],
          ["adjustment", "调整"],
        ),
      },
      { key: "amountCents", label: "金额（元）", kind: "number", required: true },
      currencyField,
      statusField(financeStatuses),
      { key: "occurredAt", label: "业务时间", kind: "datetime-local", required: true },
      { key: "category", label: "科目", kind: "text", required: true },
    ],
  },
  invoices: {
    key: "invoices",
    endpoint: "/invoices",
    title: "发票",
    singular: "发票",
    description: "进销项发票、状态与红冲审批",
    icon: ReceiptText,
    permission: "invoices",
    statuses: invoiceStatuses,
    columns: [
      { key: "invoiceNumber", label: "发票号码" },
      { key: "counterparty", label: "往来方" },
      { key: "direction", label: "类型" },
      { key: "amountCents", label: "价税合计", format: formatMoneyCents },
      { key: "status", label: "状态" },
    ],
    fields: [
      { key: "invoiceNumber", label: "发票号码", kind: "text" },
      { key: "counterparty", label: "往来方", kind: "text", required: true },
      {
        key: "direction",
        label: "类型",
        kind: "select",
        required: true,
        defaultValue: "incoming",
        options: statusOptions(["incoming", "进项"], ["outgoing", "销项"]),
      },
      { key: "amountCents", label: "价税合计（元）", kind: "number", required: true },
      { key: "taxAmountCents", label: "税额（元）", kind: "number", defaultValue: "0" },
      currencyField,
      statusField(invoiceStatuses),
      { key: "issuedAt", label: "开票时间", kind: "datetime-local" },
      { key: "dueAt", label: "到期时间", kind: "datetime-local" },
      {
        key: "fileId",
        label: "发票原件",
        kind: "reference",
        referenceEndpoint: "/files?status=uploaded",
        referenceLabelKey: "filename",
      },
    ],
  },
  "cashflow-forecasts": {
    key: "cashflow-forecasts",
    endpoint: "/cash-flow",
    title: "现金流",
    singular: "现金流记录",
    description: "滚动现金预测、实际收付与资金缺口预警",
    icon: Banknote,
    permission: "cash-flow",
    statuses: cashStatuses,
    columns: [
      { key: "occurredAt", label: "日期", format: formatDate },
      { key: "direction", label: "方向" },
      { key: "category", label: "科目" },
      { key: "amountCents", label: "金额", format: formatMoneyCents },
      { key: "status", label: "状态" },
    ],
    fields: [
      { key: "occurredAt", label: "预计/实际时间", kind: "datetime-local", required: true },
      {
        key: "direction",
        label: "方向",
        kind: "select",
        required: true,
        defaultValue: "out",
        options: statusOptions(["in", "流入"], ["out", "流出"]),
      },
      { key: "category", label: "科目", kind: "text", required: true },
      { key: "amountCents", label: "金额（元）", kind: "number", required: true },
      currencyField,
      statusField(cashStatuses),
      descriptionField,
    ],
  },
  products: {
    key: "products",
    endpoint: "/products",
    title: "产品组合",
    singular: "产品",
    description: "赛事、训练、内容与在线电竞教育产品组合",
    icon: Boxes,
    permission: "products",
    statuses: productStatuses,
    columns: [
      { key: "name", label: "产品" },
      { key: "category", label: "类别" },
      { key: "stage", label: "阶段" },
      { key: "status", label: "状态" },
      { key: "updatedAt", label: "更新", format: formatDateTime },
    ],
    fields: [
      { key: "name", label: "产品名称", kind: "text", required: true, width: "full" },
      statusField(productStatuses),
      {
        key: "projectId",
        label: "关联项目",
        kind: "reference",
        referenceEndpoint: "/projects",
        referenceLabelKey: "name",
      },
      {
        key: "category",
        label: "类别",
        kind: "select",
        required: true,
        defaultValue: "other",
        options: statusOptions(
          ["online_education", "在线教育"],
          ["esports_service", "电竞服务"],
          ["software", "软件"],
          ["content", "内容"],
          ["other", "其他"],
        ),
      },
      {
        key: "stage",
        label: "阶段",
        kind: "select",
        required: true,
        defaultValue: "idea",
        options: statusOptions(
          ["idea", "构想"],
          ["validation", "验证"],
          ["development", "开发"],
          ["launched", "已上线"],
          ["retired", "已退役"],
        ),
      },
      userField("ownerId", "负责人"),
      descriptionField,
    ],
  },
  opportunities: {
    key: "opportunities",
    endpoint: "/opportunities",
    title: "市场机会",
    singular: "机会",
    description: "赞助、赛事、教育客户与合作机会管道",
    icon: Target,
    permission: "opportunities",
    statuses: opportunityStatuses,
    columns: [
      { key: "title", label: "机会" },
      { key: "organization", label: "机构" },
      { key: "status", label: "阶段" },
      { key: "valueCents", label: "金额", format: formatMoneyCents },
      { key: "nextActionAt", label: "下一动作", format: formatDate },
    ],
    fields: [
      titleField("机会名称"),
      statusField(opportunityStatuses),
      {
        key: "productId",
        label: "关联产品",
        kind: "reference",
        referenceEndpoint: "/products",
        referenceLabelKey: "name",
      },
      {
        key: "projectId",
        label: "关联项目",
        kind: "reference",
        referenceEndpoint: "/projects",
        referenceLabelKey: "name",
      },
      { key: "organization", label: "机构", kind: "text" },
      { key: "contact", label: "联系人", kind: "text" },
      { key: "source", label: "线索来源", kind: "text" },
      { key: "valueCents", label: "预计金额（元）", kind: "number" },
      currencyField,
      { key: "nextActionAt", label: "下一动作时间", kind: "datetime-local" },
      userField("ownerId", "负责人"),
    ],
  },
  "github-intel": {
    key: "github-intel",
    endpoint: "/github-insights",
    title: "GitHub 技术情报",
    singular: "技术情报",
    description: "仓库、发布、问题与安全信号的只读情报记录",
    icon: CodeXml,
    permission: "github-insights",
    statuses: [],
    columns: [
      { key: "repository", label: "仓库" },
      { key: "kind", label: "类型" },
      { key: "summary", label: "摘要" },
      { key: "capturedAt", label: "采集时间", format: formatDateTime },
    ],
    fields: [
      { key: "repository", label: "owner/repo", kind: "text", required: true },
      {
        key: "kind",
        label: "类型",
        kind: "select",
        required: true,
        defaultValue: "repository",
        options: statusOptions(
          ["repository", "仓库"],
          ["release", "发布"],
          ["issue", "Issue"],
          ["pull_request", "PR"],
          ["security", "安全"],
          ["trend", "趋势"],
        ),
      },
      { key: "url", label: "来源地址", kind: "url", required: true, width: "full" },
      { key: "capturedAt", label: "采集时间", kind: "datetime-local", required: true },
      { key: "summary", label: "摘要", kind: "textarea", required: true, width: "full" },
      { key: "payload", label: "原始结构数据", kind: "json", defaultValue: "{}", width: "full" },
    ],
  },
  files: {
    key: "files",
    endpoint: "/files",
    title: "文件",
    singular: "文件",
    description: "受权限控制、校验完整性的公司文件",
    icon: Archive,
    permission: "files",
    statuses: [],
    columns: [
      { key: "filename", label: "文件" },
      { key: "classification", label: "分类" },
      {
        key: "sizeBytes",
        label: "大小",
        format: (value) => `${(Number(value ?? 0) / 1024).toFixed(1)} KB`,
      },
      { key: "uploadStatus", label: "上传状态" },
      { key: "updatedAt", label: "更新时间", format: formatDateTime },
    ],
    fields: [
      { key: "filename", label: "文件名称", kind: "text", required: true },
      {
        key: "classification",
        label: "信息分类",
        kind: "select",
        required: true,
        defaultValue: "internal",
        options: statusOptions(
          ["internal", "内部"],
          ["confidential", "机密"],
          ["personal", "个人信息"],
          ["public", "公开"],
        ),
      },
    ],
    updateFields: [
      { key: "filename", label: "文件名称", kind: "text", required: true },
      {
        key: "classification",
        label: "信息分类",
        kind: "select",
        required: true,
        options: statusOptions(
          ["internal", "内部"],
          ["confidential", "机密"],
          ["personal", "个人信息"],
          ["public", "公开"],
        ),
      },
    ],
  },
  notifications: {
    key: "notifications",
    endpoint: "/notifications",
    title: "通知",
    singular: "通知",
    description: "站内通知和适配器投递状态",
    icon: Megaphone,
    permission: "notifications",
    archivable: false,
    statuses: notificationStatuses,
    columns: [
      { key: "title", label: "主题" },
      { key: "channel", label: "渠道" },
      { key: "status", label: "状态" },
      { key: "createdAt", label: "创建时间", format: formatDateTime },
    ],
    fields: [
      titleField("主题"),
      {
        key: "recipientId",
        label: "接收人",
        kind: "reference",
        required: true,
        referenceEndpoint: "/users",
        referenceLabelKey: "displayName",
      },
      {
        key: "channel",
        label: "渠道",
        kind: "select",
        required: true,
        defaultValue: "in_app",
        options: statusOptions(
          ["in_app", "站内"],
          ["email", "邮件适配器"],
          ["webhook", "Webhook 适配器"],
        ),
      },
      statusField(notificationStatuses),
      { key: "body", label: "内容", kind: "textarea", required: true, width: "full" },
    ],
  },
  workflows: {
    key: "workflows",
    endpoint: "/workflow-definitions",
    title: "工作流",
    singular: "工作流",
    description: "轻量自动化规则、执行记录与人工暂停点",
    icon: Workflow,
    permission: "workflow-definitions",
    statuses: [],
    columns: [
      { key: "name", label: "工作流" },
      { key: "trigger", label: "触发" },
      { key: "enabled", label: "启用", format: (value) => (value ? "是" : "否") },
      { key: "updatedAt", label: "更新时间", format: formatDateTime },
    ],
    fields: [
      { key: "name", label: "工作流名称", kind: "text", required: true, width: "full" },
      {
        key: "trigger",
        label: "触发方式",
        kind: "select",
        required: true,
        defaultValue: "manual",
        options: [{ label: "仅人工运行", value: "manual" }],
      },
      { key: "enabled", label: "启用", kind: "boolean", defaultValue: "true" },
      {
        key: "steps",
        label: "动作步骤",
        kind: "json",
        required: true,
        width: "full",
        placeholder: "请使用可视化通知步骤表单，或通过受控 API 提交完整步骤",
      },
    ],
  },
  users: {
    key: "users",
    endpoint: "/users",
    title: "成员与权限",
    singular: "成员",
    description: "最小权限、组织成员与关键权限变更审批",
    icon: Users,
    permission: "users",
    archivable: false,
    statuses: statusOptions(
      ["pending", "待入职审批"],
      ["active", "在职/有效"],
      ["inactive", "已停用"],
      ["offboarded", "已离职"],
    ),
    columns: [
      { key: "displayName", label: "姓名" },
      { key: "email", label: "邮箱" },
      { key: "userStatus", label: "用户状态" },
      { key: "membershipStatus", label: "成员状态" },
      {
        key: "roles",
        label: "当前角色",
        format: (value) =>
          Array.isArray(value) && value.length
            ? value
                .map((role) =>
                  typeof role === "object" && role !== null && "name" in role
                    ? String(role.name)
                    : "未知角色",
                )
                .join("、")
            : "无角色",
      },
      {
        key: "pendingLifecycleAction",
        label: "生命周期申请",
        format: (value) =>
          value === "deactivate"
            ? "待审批：停用"
            : value === "offboard"
              ? "待审批：离职"
              : value === "reactivate"
                ? "待审批：重新启用"
                : "—",
      },
      { key: "createdAt", label: "加入时间", format: formatDateTime },
    ],
    fields: [
      { key: "displayName", label: "姓名", kind: "text", required: true },
      { key: "email", label: "邮箱", kind: "email", required: true },
      { key: "password", label: "初始密码", kind: "password", required: true },
      {
        key: "roleId",
        label: "初始角色",
        kind: "reference",
        required: true,
        referenceEndpoint: "/roles",
        referenceLabelKey: "name",
      },
    ],
    updateFields: [{ key: "displayName", label: "姓名", kind: "text", required: true }],
  },
  "audit-events": {
    key: "audit-events",
    endpoint: "/audit-events",
    title: "审计日志",
    singular: "审计事件",
    description: "不可修改的操作、模型与工具调用证据",
    icon: FileClock,
    permission: "audit-events",
    readOnly: true,
    archivable: false,
    statuses: [],
    columns: [
      { key: "createdAt", label: "时间", format: formatDateTime },
      { key: "actorUserId", label: "操作者" },
      { key: "action", label: "动作" },
      { key: "resourceType", label: "对象" },
      { key: "requestId", label: "请求 ID" },
    ],
    fields: [],
  },
};

export function getResourceConfig(key: string | undefined): ResourceConfig | undefined {
  return key ? resources[key] : undefined;
}

export const statusLabels: Record<string, string> = Object.fromEntries(
  [
    ...objectiveStatuses,
    ...projectStatuses,
    ...taskStatuses,
    ...decisionStatuses,
    ...obligationStatuses,
    ...complianceStatuses,
    ...calendarStatuses,
    ...riskStatuses,
    ...contractStatuses,
    ...financeStatuses,
    ...invoiceStatuses,
    ...cashStatuses,
    ...productStatuses,
    ...opportunityStatuses,
    ...notificationStatuses,
    ...statusOptions(
      ["pending_approval", "待审批"],
      ["pending", "等待"],
      ["approved", "已批准"],
      ["rejected", "已驳回"],
      ["submitted", "已提交"],
      ["confirmed", "已确认"],
      ["failed", "失败"],
      ["archived", "已归档"],
      ["queued", "排队中"],
      ["running", "运行中"],
      ["connected", "已连接"],
      ["disconnected", "未连接"],
      ["not_started", "未执行"],
      ["reviewed", "已复核"],
      ["stale", "需更新"],
      ["inactive", "已停用"],
      ["offboarded", "已离职"],
    ),
  ].map((option) => [option.value, option.label]),
);
