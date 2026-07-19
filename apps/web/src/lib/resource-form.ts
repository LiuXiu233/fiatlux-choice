import { chinaDateTimeInputToIso } from "./china-time";
import type { FieldConfig } from "./resources";

export function fieldPayload(field: FieldConfig, value: string): unknown {
  if (value === "") return null;
  if (field.kind === "number") {
    const parsed = Number(value);
    return field.key.endsWith("Cents") ? Math.round(parsed * 100) : parsed;
  }
  if (field.kind === "date") return value;
  if (field.kind === "datetime-local") return chinaDateTimeInputToIso(value);
  if (field.kind === "boolean") return value === "true";
  if (field.kind === "json") return JSON.parse(value) as unknown;
  return value;
}

export function buildResourcePayload(
  fields: FieldConfig[],
  values: Record<string, string>,
  mode: "create" | "update",
  originalValues: Record<string, string> = {},
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [];
  for (const field of fields) {
    const value = values[field.key] ?? "";
    if (mode === "update" && value === (originalValues[field.key] ?? "")) continue;
    if (value === "" && mode === "create" && !field.required) continue;
    entries.push([field.key, fieldPayload(field, value)]);
  }
  return Object.fromEntries(entries);
}
