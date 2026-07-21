/**
 * Deliberately insecure Semgrep canary. Never import, build, or deploy this file.
 * The production SAST command excludes security/semgrep/canary/** explicitly.
 */
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { Agent } from "node:https";

type UnsafeRequest = {
  body: { password: string };
  query: { id: string; url: string };
};

export const apiToken = "aaaaaaaaaaaaaaaaaaaaaaaa";

export function unsafeSql(db: { query: (statement: string) => unknown }, request: UnsafeRequest) {
  return db.query(`SELECT * FROM users WHERE id = '${request.query.id}'`);
}

export function unsafeRawSql(sql: { raw: (statement: string) => unknown }, request: UnsafeRequest) {
  return sql.raw(request.query.id);
}

export function unsafeCommand(command: string) {
  return exec(command);
}

export function unsafeDynamicCode(source: string) {
  // biome-ignore lint/security/noGlobalEval: This file is an intentionally vulnerable SAST canary.
  return eval(source);
}

export async function unsafeOutboundRequest(request: UnsafeRequest) {
  return fetch(request.query.url);
}

export const insecureTlsAgent = new Agent({ rejectUnauthorized: false });

export function weakDigest(value: string) {
  return createHash("md5").update(value).digest("hex");
}

export function leakPassword(request: UnsafeRequest) {
  console.error(request.body.password);
}

export function UnsafeHtml({ html }: { html: string }) {
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: This is an intentionally vulnerable SAST canary.
    <main dangerouslySetInnerHTML={{ __html: html }} />
  );
}
