import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export const OFFICIAL_SOURCE_ALLOWED_HOSTS = new Set([
  "flk.npc.gov.cn",
  "gjj.gz.gov.cn",
  "guangdong.chinatax.gov.cn",
  "openstd.samr.gov.cn",
  "rsj.gz.gov.cn",
  "www.cac.gov.cn",
  "www.gov.cn",
  "www.panyu.gov.cn",
  "www.thnet.gov.cn",
]);

export const OFFICIAL_SOURCE_FETCHER_VERSION = "official-source-fetcher-v1";
export const OFFICIAL_SOURCE_MAX_BYTES = 2 * 1024 * 1024;

// RegExp constructors avoid a Semgrep 1.170.0 TypeScript parser bug around HTML-comment
// regex literals. These remain closed, static patterns; no request data becomes executable code.
const HTML_DOCUMENT_PATTERN_SOURCE = "<html[\\s>]";
const HTML_COMMENT_PATTERN_SOURCE = "<!--[\\s\\S]*?-->";
const HTML_UNSAFE_ELEMENT_PATTERN_SOURCE =
  "<(script|style|noscript|svg|template)\\b[^>]*>[\\s\\S]*?<\\/\\1>";
const HTML_TAG_PATTERN_SOURCE = "<[^>]+>";
const HTML_DOCUMENT_PATTERN = new RegExp(HTML_DOCUMENT_PATTERN_SOURCE, "i");
const HTML_COMMENT_PATTERN = new RegExp(HTML_COMMENT_PATTERN_SOURCE, "g");
const HTML_UNSAFE_ELEMENT_PATTERN = new RegExp(HTML_UNSAFE_ELEMENT_PATTERN_SOURCE, "gi");
const HTML_TAG_PATTERN = new RegExp(HTML_TAG_PATTERN_SOURCE, "g");

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

interface TransportInput {
  url: URL;
  address: ResolvedAddress;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

export interface OfficialSourceReaderOptions {
  allowedHosts?: ReadonlySet<string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  transport?: (input: TransportInput) => Promise<TransportResponse>;
}

export interface OfficialSourceFetchInput {
  url: string;
  etag?: string | null;
  lastModified?: string | null;
}

export interface OfficialSourceSnapshot {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
  sizeBytes: number;
  etag: string | null;
  lastModified: string | null;
  rawHash: string | null;
  normalizedHash: string | null;
  normalizedExcerpt: string | null;
  notModified: boolean;
  fetcherVersion: string;
}

export interface OfficialSourceFetcher {
  fetch(input: OfficialSourceFetchInput): Promise<OfficialSourceSnapshot>;
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function ipv4Number(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return null;
  return (
    (((parts[0] ?? 0) << 24) |
      ((parts[1] ?? 0) << 16) |
      ((parts[2] ?? 0) << 8) |
      (parts[3] ?? 0)) >>>
    0
  );
}

function inIpv4Range(value: number, base: string, prefix: number) {
  const baseValue = ipv4Number(base);
  if (baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

/** Rejects non-routable, private, documentation, benchmarking and multicast destinations. */
export function isPublicNetworkAddress(address: string) {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    if (value === null) return false;
    const denied: Array<[string, number]> = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ];
    return !denied.some(([base, prefix]) => inIpv4Range(value, base, prefix));
  }
  if (family !== 6) return false;
  const words = ipv6Words(address);
  if (!words) return false;
  const word = (index: number) => words[index] ?? 0;
  const firstSixZero = words.slice(0, 6).every((value) => value === 0);

  // IPv4-compatible and IPv4-mapped forms can hide loopback or link-local destinations.
  if (firstSixZero || (words.slice(0, 5).every((value) => value === 0) && word(5) === 0xffff)) {
    return false;
  }
  // Reject transition networks conservatively even when their embedded IPv4 happens to be public.
  if (
    (word(0) === 0x0064 &&
      word(1) === 0xff9b &&
      word(2) === 0 &&
      word(3) === 0 &&
      word(4) === 0 &&
      word(5) === 0) ||
    (word(0) === 0x0064 && word(1) === 0xff9b && word(2) === 1) ||
    word(0) === 0x2002 ||
    (word(0) === 0x2001 && word(1) === 0)
  ) {
    return false;
  }
  return !(
    (word(0) & 0xfe00) === 0xfc00 ||
    (word(0) & 0xffc0) === 0xfe80 ||
    (word(0) & 0xffc0) === 0xfec0 ||
    (word(0) & 0xff00) === 0xff00 ||
    (word(0) === 0x2001 && word(1) === 0x0db8) ||
    (word(0) === 0x2001 && word(1) === 0x0002 && word(2) === 0)
  );
}

function ipv6Words(address: string): number[] | null {
  let normalized = address.toLowerCase();
  if (normalized.includes("%")) return null;
  const dottedTail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedTail) {
    const value = ipv4Number(dottedTail);
    if (value === null) return null;
    normalized = `${normalized.slice(0, -dottedTail.length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string) => {
    if (!half) return [];
    const parts = half.split(":");
    if (parts.some((part) => !/^[a-f0-9]{1,4}$/.test(part))) return null;
    return parts.map((part) => Number.parseInt(part, 16));
  };
  const head = parseHalf(halves[0] ?? "");
  const tail = parseHalf(halves[1] ?? "");
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const zeroCount = 8 - head.length - tail.length;
  if (zeroCount < 1) return null;
  return [...head, ...Array.from({ length: zeroCount }, () => 0), ...tail];
}

function validateUrl(rawUrl: string, allowedHosts: ReadonlySet<string>) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Official source URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Official source URL must use HTTP or HTTPS");
  }
  if (url.username || url.password)
    throw new Error("Official source URL cannot contain credentials");
  if (
    url.port &&
    !(
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    )
  ) {
    throw new Error("Official source URL cannot use a non-standard port");
  }
  const hostname = normalizeHostname(url.hostname);
  if (isIP(hostname) || !allowedHosts.has(hostname)) {
    throw new Error("Official source host is not allowlisted");
  }
  url.hostname = hostname;
  return url;
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.flatMap((record) =>
    record.family === 4 || record.family === 6
      ? [{ address: record.address, family: record.family }]
      : [],
  );
}

function headerValue(
  headers: import("node:http").IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function defaultTransport(input: TransportInput): Promise<TransportResponse> {
  return await new Promise((resolve, reject) => {
    const requester = input.url.protocol === "https:" ? httpsRequest : httpRequest;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const succeed = (response: TransportResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    };
    const request = requester(
      input.url,
      {
        method: "GET",
        headers: input.headers,
        signal: controller.signal,
        lookup: (_hostname, _options, callback) => {
          callback(null, input.address.address, input.address.family);
        },
      },
      (response) => {
        const contentLength = Number(headerValue(response.headers, "content-length"));
        if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
          const error = new Error("Official source response exceeds the size limit");
          response.destroy(error);
          request.destroy(error);
          fail(error);
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > input.maxBytes) {
            const error = new Error("Official source response exceeds the size limit");
            response.destroy(error);
            request.destroy(error);
            fail(error);
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", fail);
        response.once("aborted", () => fail(new Error("Official source response was aborted")));
        response.once("end", () => {
          succeed({
            status: response.statusCode ?? 0,
            headers: {
              location: headerValue(response.headers, "location"),
              "content-type": headerValue(response.headers, "content-type"),
              "content-encoding": headerValue(response.headers, "content-encoding"),
              etag: headerValue(response.headers, "etag"),
              "last-modified": headerValue(response.headers, "last-modified"),
            },
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.once("error", fail);
    request.once("close", () => clearTimeout(timer));
    request.end();
  });
}

async function withinDeadline<T>(promise: Promise<T>, remainingMs: number, operation: string) {
  if (remainingMs <= 0) throw new Error(`Official source ${operation} timed out`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Official source ${operation} timed out`)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function decodeBody(body: Uint8Array, contentType: string | null) {
  const charset = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase();
  const encoding =
    charset === "gbk" || charset === "gb2312" || charset === "gb18030" ? "gb18030" : "utf-8";
  try {
    return new TextDecoder(encoding).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,7});/g, (_match, code: string) => {
      const value = Number(code);
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : " ";
    });
}

export function normalizeOfficialSourceContent(body: Uint8Array, contentType: string | null) {
  const type = contentType?.toLowerCase() ?? "";
  if (type.includes("pdf") || type.includes("octet-stream")) return null;
  let text = decodeBody(body, contentType).normalize("NFKC");
  if (type.includes("html") || HTML_DOCUMENT_PATTERN.test(text)) {
    text = text
      .replace(HTML_COMMENT_PATTERN, " ")
      .replace(HTML_UNSAFE_ELEMENT_PATTERN, " ")
      .replace(HTML_TAG_PATTERN, " ");
    text = decodeHtmlEntities(text);
  }
  return text.replace(/\s+/g, " ").trim();
}

function utf8Excerpt(value: string, maxBytes = 100_000) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (encoded[end] ?? 0) >> 6 === 0b10) end -= 1;
  return encoded.subarray(0, end).toString("utf8");
}

export class OfficialSourceReader implements OfficialSourceFetcher {
  readonly #allowedHosts: ReadonlySet<string>;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #maxRedirects: number;
  readonly #resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  readonly #transport: (input: TransportInput) => Promise<TransportResponse>;

  constructor(options: OfficialSourceReaderOptions = {}) {
    this.#allowedHosts = options.allowedHosts ?? OFFICIAL_SOURCE_ALLOWED_HOSTS;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxBytes = options.maxBytes ?? OFFICIAL_SOURCE_MAX_BYTES;
    this.#maxRedirects = options.maxRedirects ?? 3;
    this.#resolve = options.resolve ?? defaultResolve;
    this.#transport = options.transport ?? defaultTransport;
  }

  async fetch(input: OfficialSourceFetchInput): Promise<OfficialSourceSnapshot> {
    const requestedUrl = validateUrl(input.url, this.#allowedHosts);
    let currentUrl = requestedUrl;
    const deadline = Date.now() + this.#timeoutMs;
    for (let redirectCount = 0; redirectCount <= this.#maxRedirects; redirectCount += 1) {
      const addresses = await withinDeadline(
        this.#resolve(currentUrl.hostname),
        deadline - Date.now(),
        "DNS resolution",
      );
      if (
        addresses.length === 0 ||
        addresses.some((address) => !isPublicNetworkAddress(address.address))
      ) {
        throw new Error("Official source DNS resolution returned a non-public destination");
      }
      const address = addresses[0];
      if (!address) throw new Error("Official source DNS resolution returned no destination");
      const headers: Record<string, string> = {
        accept:
          "text/html,application/xhtml+xml,application/pdf,text/plain,application/xml;q=0.9,*/*;q=0.5",
        "accept-encoding": "identity",
        "user-agent": `FIAT-LUX-CHOICE/${OFFICIAL_SOURCE_FETCHER_VERSION}`,
      };
      if (redirectCount === 0 && input.etag) headers["if-none-match"] = input.etag;
      if (redirectCount === 0 && input.lastModified)
        headers["if-modified-since"] = input.lastModified;

      const remainingMs = deadline - Date.now();
      const response = await withinDeadline(
        this.#transport({
          url: currentUrl,
          address,
          headers,
          timeoutMs: Math.max(1, remainingMs),
          maxBytes: this.#maxBytes,
        }),
        remainingMs,
        "request",
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= this.#maxRedirects)
          throw new Error("Official source redirect limit exceeded");
        const location = response.headers.location;
        if (!location) throw new Error("Official source redirect is missing a location");
        currentUrl = validateUrl(new URL(location, currentUrl).toString(), this.#allowedHosts);
        continue;
      }
      if (currentUrl.protocol !== "https:") {
        throw new Error(
          "Official source returned content over insecure HTTP without an HTTPS redirect",
        );
      }
      const contentEncoding = response.headers["content-encoding"]?.trim().toLowerCase();
      if (response.body.byteLength > 0 && contentEncoding && contentEncoding !== "identity") {
        throw new Error("Official source returned unsupported compressed content");
      }
      const contentType = response.headers["content-type"]?.slice(0, 500) ?? null;
      const metadata = {
        requestedUrl: requestedUrl.toString(),
        finalUrl: currentUrl.toString(),
        httpStatus: response.status,
        contentType,
        etag: response.headers.etag?.slice(0, 1_000) ?? null,
        lastModified: response.headers["last-modified"]?.slice(0, 1_000) ?? null,
        fetcherVersion: OFFICIAL_SOURCE_FETCHER_VERSION,
      };
      if (response.status === 304) {
        return {
          ...metadata,
          sizeBytes: 0,
          rawHash: null,
          normalizedHash: null,
          normalizedExcerpt: null,
          notModified: true,
        };
      }
      if (response.status !== 200)
        throw new Error(`Official source returned HTTP ${response.status}`);
      if (response.body.byteLength === 0)
        throw new Error("Official source returned an empty response");
      if (response.body.byteLength > this.#maxBytes)
        throw new Error("Official source response exceeds the size limit");
      const rawHash = createHash("sha256").update(response.body).digest("hex");
      const normalized = normalizeOfficialSourceContent(response.body, contentType);
      const normalizedHash = createHash("sha256")
        .update(normalized === null ? response.body : normalized)
        .digest("hex");
      return {
        ...metadata,
        sizeBytes: response.body.byteLength,
        rawHash,
        normalizedHash,
        normalizedExcerpt: normalized === null ? null : utf8Excerpt(normalized),
        notModified: false,
      };
    }
    throw new Error("Official source redirect limit exceeded");
  }
}
