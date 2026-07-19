import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Banknote,
  Bot,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  ChartNoAxesCombined,
  CheckCheck,
  CircleGauge,
  ClipboardCheck,
  CodeXml,
  FileCheck2,
  FileClock,
  FolderKanban,
  Goal,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Megaphone,
  ReceiptText,
  Scale,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
} from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  permission?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "总览",
    items: [{ label: "经营工作台", path: "/", icon: LayoutDashboard }],
  },
  {
    label: "执行",
    items: [
      { label: "目标", path: "/resources/goals", icon: Goal, permission: "objectives:read" },
      {
        label: "项目",
        path: "/resources/projects",
        icon: FolderKanban,
        permission: "projects:read",
      },
      { label: "任务", path: "/resources/tasks", icon: ListChecks, permission: "tasks:read" },
      {
        label: "决策",
        path: "/resources/decisions",
        icon: Lightbulb,
        permission: "decisions:read",
      },
    ],
  },
  {
    label: "治理与合规",
    items: [
      {
        label: "公司义务",
        path: "/resources/obligations",
        icon: ClipboardCheck,
        permission: "obligations:read",
      },
      {
        label: "合规日历",
        path: "/resources/compliance-events",
        icon: CalendarCheck,
        permission: "compliance:read",
      },
      {
        label: "合规知识库",
        path: "/resources/compliance-items",
        icon: Scale,
        permission: "compliance:read",
      },
      { label: "风险", path: "/resources/risks", icon: ShieldAlert, permission: "risks:read" },
      {
        label: "合同",
        path: "/resources/contracts",
        icon: FileCheck2,
        permission: "contracts:read",
      },
    ],
  },
  {
    label: "财务",
    items: [
      {
        label: "收支",
        path: "/resources/transactions",
        icon: Banknote,
        permission: "financial-entries:read",
      },
      {
        label: "发票",
        path: "/resources/invoices",
        icon: ReceiptText,
        permission: "invoices:read",
      },
      {
        label: "现金流",
        path: "/resources/cashflow-forecasts",
        icon: ChartNoAxesCombined,
        permission: "cash-flow:read",
      },
    ],
  },
  {
    label: "产品与增长",
    items: [
      { label: "产品组合", path: "/resources/products", icon: Boxes, permission: "products:read" },
      {
        label: "市场机会",
        path: "/resources/opportunities",
        icon: Target,
        permission: "opportunities:read",
      },
      { label: "电竞教育", path: "/education", icon: GraduationCap, permission: "products:read" },
      {
        label: "GitHub 情报",
        path: "/resources/github-intel",
        icon: CodeXml,
        permission: "github-insights:read",
      },
    ],
  },
  {
    label: "协同",
    items: [
      { label: "AI 顾问", path: "/advisors", icon: Bot, permission: "advisors:read" },
      { label: "审批中心", path: "/approvals", icon: CheckCheck, permission: "approvals:read" },
      { label: "文件", path: "/resources/files", icon: Archive, permission: "files:read" },
      {
        label: "通知",
        path: "/resources/notifications",
        icon: Megaphone,
        permission: "notifications:read",
      },
      {
        label: "工作流",
        path: "/resources/workflows",
        icon: Workflow,
        permission: "workflow-definitions:read",
      },
    ],
  },
  {
    label: "系统",
    items: [
      { label: "成员与权限", path: "/resources/users", icon: Users, permission: "users:read" },
      {
        label: "审计日志",
        path: "/resources/audit-events",
        icon: FileClock,
        permission: "audit-events:read",
      },
      { label: "集成与备份", path: "/settings", icon: Settings, permission: "settings:read" },
    ],
  },
];

export const mobileNav: NavItem[] = [
  { label: "总览", path: "/", icon: CircleGauge },
  {
    label: "执行",
    path: "/resources/tasks",
    icon: BriefcaseBusiness,
    permission: "tasks:read",
  },
  { label: "审批", path: "/approvals", icon: ShieldCheck, permission: "approvals:read" },
  { label: "顾问", path: "/advisors", icon: Sparkles, permission: "advisors:read" },
  { label: "更多", path: "/menu", icon: Building2 },
];

export function findNavItem(pathname: string): NavItem | undefined {
  return navGroups.flatMap((group) => group.items).find((item) => item.path === pathname);
}
