const CHINA_TIME_ZONE = "Asia/Shanghai";

const chinaDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHINA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function chinaDateTimeParts(value: unknown): Record<string, string> | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return Object.fromEntries(
    chinaDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function formatChinaDateInput(value: unknown): string {
  const parts = chinaDateTimeParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatChinaDateTimeInput(value: unknown): string {
  const parts = chinaDateTimeParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function chinaDateTimeInputToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("无效的北京时间");
  }
  const instant = new Date(`${value}:00+08:00`);
  if (Number.isNaN(instant.getTime()) || formatChinaDateTimeInput(instant) !== value) {
    throw new Error("无效的北京时间");
  }
  return instant.toISOString();
}

export { CHINA_TIME_ZONE };
