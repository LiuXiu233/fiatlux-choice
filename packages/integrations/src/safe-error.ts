export interface SanitizeIntegrationErrorOptions {
  maxLength?: number;
}

export function sanitizeIntegrationError(
  error: unknown,
  fallback: string,
  options: SanitizeIntegrationErrorOptions = {},
) {
  const raw = error instanceof Error ? error.message : fallback;
  const maxLength = Math.max(1, options.maxLength ?? 5_000);
  const sanitized = raw
    .replace(/\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]")
    .replace(
      /((?:authorization|password|secret|token|api[-_ ]?key|access[-_ ]?token|cookie|session)\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?["']?[^,\s"'&}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/bearer\s+[A-Za-z0-9._~-]+/gi, "bearer [REDACTED]")
    .replace(/\/\/[^/\s:@]*:[^@\s/]+@/g, "//[REDACTED]@")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maxLength);
  return sanitized || fallback;
}
