const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 2,
});

export function formatDate(value: unknown): string {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : dateFormatter.format(parsed);
}

export function formatDateTime(value: unknown): string {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : dateTimeFormatter.format(parsed);
}

export function formatMoney(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? moneyFormatter.format(parsed) : "—";
}

export function formatMoneyCents(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? moneyFormatter.format(parsed / 100) : "—";
}

export function formatConfidence(value: number): string {
  const normalized = value > 100 ? value / 100 : value > 1 ? value : value * 100;
  return `${Math.round(normalized)}%`;
}

export function recordLabel(record: {
  title?: string;
  name?: string;
  displayName?: string;
  filename?: string;
  summary?: string;
}): string {
  return (
    record.title ??
    record.name ??
    record.displayName ??
    record.filename ??
    record.summary ??
    "未命名记录"
  );
}
