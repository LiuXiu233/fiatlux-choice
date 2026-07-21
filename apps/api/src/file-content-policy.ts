import { inflateRawSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");
const GIF_87_SIGNATURE = Buffer.from("GIF87a", "ascii");
const GIF_89_SIGNATURE = Buffer.from("GIF89a", "ascii");
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_MAX_ENTRIES = 10_000;
const ZIP_MAX_DECLARED_EXPANDED_BYTES = 200_000_000;
const ZIP_MAX_METADATA_BYTES = 2_000_000;

interface ZipEntry {
  name: string;
  flags: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const ooxmlTypes = {
  docx: {
    mainPart: "word/document.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    mainPart: "xl/workbook.xml",
    mainContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    mainPart: "ppt/presentation.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
} as const;

function startsWith(content: Buffer, signature: Buffer) {
  return (
    content.length >= signature.length && content.subarray(0, signature.length).equals(signature)
  );
}

function decodeUtf8(content: Buffer) {
  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}

function textContentIssue(content: Buffer, requireJson: boolean) {
  let decoded: string;
  try {
    decoded = decodeUtf8(content);
  } catch {
    return "Text content must be valid UTF-8";
  }
  for (let index = 0; index < decoded.length; index += 1) {
    const code = decoded.charCodeAt(index);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    ) {
      return "Text content contains binary control bytes";
    }
  }
  if (requireJson) {
    try {
      JSON.parse(decoded);
    } catch {
      return "JSON content is not syntactically valid";
    }
  }
  return undefined;
}

function findZipEnd(content: Buffer) {
  if (content.length < 22) throw new Error("ZIP end record is missing");
  const earliest = Math.max(0, content.length - 22 - 65_535);
  for (let offset = content.length - 22; offset >= earliest; offset -= 1) {
    if (content.readUInt32LE(offset) !== ZIP_END_SIGNATURE) continue;
    const commentLength = content.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === content.length) return offset;
  }
  throw new Error("ZIP end record is invalid");
}

function safeSliceEnd(start: number, length: number, total: number) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0) {
    throw new Error("ZIP entry range is invalid");
  }
  const end = start + length;
  if (!Number.isSafeInteger(end) || end > total) throw new Error("ZIP entry exceeds the archive");
  return end;
}

function safeZipPath(name: string) {
  if (!name || name.includes("\\") || name.startsWith("/") || name.includes("\0")) return false;
  const withoutDirectorySuffix = name.endsWith("/") ? name.slice(0, -1) : name;
  if (!withoutDirectorySuffix) return false;
  const segments = withoutDirectorySuffix.split("/");
  return segments.every(
    (segment) => segment && segment !== "." && segment !== ".." && !segment.includes(":"),
  );
}

function readZipEntries(content: Buffer) {
  const endOffset = findZipEnd(content);
  const diskNumber = content.readUInt16LE(endOffset + 4);
  const centralDisk = content.readUInt16LE(endOffset + 6);
  const diskEntries = content.readUInt16LE(endOffset + 8);
  const totalEntries = content.readUInt16LE(endOffset + 10);
  const centralSize = content.readUInt32LE(endOffset + 12);
  const centralOffset = content.readUInt32LE(endOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0 ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error("Multi-disk, empty, or ZIP64 Office packages are not accepted");
  }
  if (totalEntries > ZIP_MAX_ENTRIES) throw new Error("Office package has too many entries");
  const centralEnd = safeSliceEnd(centralOffset, centralSize, content.length);
  if (centralEnd !== endOffset) throw new Error("Office package central directory is ambiguous");

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let expandedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    safeSliceEnd(offset, 46, centralEnd);
    if (content.readUInt32LE(offset) !== ZIP_CENTRAL_FILE_SIGNATURE) {
      throw new Error("Office package central directory is malformed");
    }
    const flags = content.readUInt16LE(offset + 8);
    const compressionMethod = content.readUInt16LE(offset + 10);
    const crc32 = content.readUInt32LE(offset + 16);
    const compressedSize = content.readUInt32LE(offset + 20);
    const uncompressedSize = content.readUInt32LE(offset + 24);
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const startingDisk = content.readUInt16LE(offset + 34);
    const localHeaderOffset = content.readUInt32LE(offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    const recordEnd = safeSliceEnd(offset, recordLength, centralEnd);
    if (
      startingDisk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("ZIP64 or split Office entries are not accepted");
    }
    if ((flags & 0x2041) !== 0) throw new Error("Encrypted Office entries are not accepted");
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error("Office package uses an unsupported compression method");
    }
    const nameBytes = content.subarray(offset + 46, offset + 46 + nameLength);
    if (nameBytes.some((byte) => byte > 0x7f)) {
      throw new Error("Office package entry names must be canonical ASCII paths");
    }
    const name = nameBytes.toString("ascii");
    const normalizedName = name.toLowerCase();
    if (!safeZipPath(name) || names.has(normalizedName)) {
      throw new Error("Office package contains an unsafe or duplicate path");
    }
    names.add(normalizedName);
    expandedBytes += uncompressedSize;
    if (
      !Number.isSafeInteger(expandedBytes) ||
      expandedBytes > ZIP_MAX_DECLARED_EXPANDED_BYTES ||
      (uncompressedSize > 1_000_000 &&
        (compressedSize === 0 || uncompressedSize > compressedSize * 200))
    ) {
      throw new Error("Office package declares an unsafe expansion ratio or size");
    }
    entries.push({
      name,
      flags,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = recordEnd;
  }
  if (offset !== centralEnd) throw new Error("Office package has trailing central directory data");
  return { entries, centralOffset };
}

function validateZipEntryEnvelope(content: Buffer, entry: ZipEntry, payloadEnd = content.length) {
  const offset = entry.localHeaderOffset;
  safeSliceEnd(offset, 30, payloadEnd);
  if (content.readUInt32LE(offset) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error("Office package local header is missing");
  }
  const flags = content.readUInt16LE(offset + 6);
  const compressionMethod = content.readUInt16LE(offset + 8);
  const localCrc32 = content.readUInt32LE(offset + 14);
  const localCompressedSize = content.readUInt32LE(offset + 18);
  const localUncompressedSize = content.readUInt32LE(offset + 22);
  const nameLength = content.readUInt16LE(offset + 26);
  const extraLength = content.readUInt16LE(offset + 28);
  if (flags !== entry.flags || compressionMethod !== entry.compressionMethod) {
    throw new Error("Office package local and central headers disagree");
  }
  const usesDataDescriptor = (flags & 0x08) !== 0;
  if (
    (!usesDataDescriptor &&
      (localCrc32 !== entry.crc32 ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize)) ||
    (usesDataDescriptor &&
      ((localCrc32 !== 0 && localCrc32 !== entry.crc32) ||
        (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)))
  ) {
    throw new Error("Office package local sizes or checksum disagree with its directory");
  }
  const nameEnd = safeSliceEnd(offset + 30, nameLength, payloadEnd);
  const localName = content.subarray(offset + 30, nameEnd).toString("ascii");
  if (localName !== entry.name) throw new Error("Office package local entry name disagrees");
  const dataStart = safeSliceEnd(nameEnd, extraLength, payloadEnd);
  const dataEnd = safeSliceEnd(dataStart, entry.compressedSize, payloadEnd);
  return { start: offset, dataStart, end: dataEnd };
}

function extractZipEntry(content: Buffer, entry: ZipEntry) {
  if (entry.uncompressedSize > ZIP_MAX_METADATA_BYTES) {
    throw new Error("Office package metadata is too large");
  }
  const envelope = validateZipEntryEnvelope(content, entry);
  const compressed = content.subarray(envelope.dataStart, envelope.end);
  let expanded: Buffer;
  if (entry.compressionMethod === 0) {
    expanded = Buffer.from(compressed);
  } else {
    expanded = inflateRawSync(compressed, { maxOutputLength: ZIP_MAX_METADATA_BYTES });
  }
  if (expanded.length !== entry.uncompressedSize) {
    throw new Error("Office package entry size does not match its directory");
  }
  return expanded;
}

function hasActiveOfficeEntry(name: string) {
  const normalized = name.toLowerCase();
  if (
    normalized.endsWith("vbaproject.bin") ||
    normalized.includes("/activex/") ||
    normalized.includes("/embeddings/") ||
    normalized.startsWith("customui/")
  ) {
    return true;
  }
  return /\.(?:app|bat|cmd|com|dll|exe|hta|jar|js|mjs|msi|php|ps1|py|rb|scr|sh|vbs|wsf)$/u.test(
    normalized,
  );
}

function officeContentIssue(content: Buffer, extension: keyof typeof ooxmlTypes) {
  try {
    const { entries, centralOffset } = readZipEntries(content);
    const localRanges = entries
      .map((entry) => validateZipEntryEnvelope(content, entry, centralOffset))
      .sort((left, right) => left.start - right.start);
    for (let index = 1; index < localRanges.length; index += 1) {
      if ((localRanges[index]?.start ?? 0) < (localRanges[index - 1]?.end ?? 0)) {
        throw new Error("Office package local entries overlap");
      }
    }
    if (entries.some((entry) => hasActiveOfficeEntry(entry.name))) {
      return "Office package contains blocked active or embedded content";
    }
    const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
    const contentTypesEntry = byName.get("[content_types].xml");
    const rootRelationships = byName.get("_rels/.rels");
    const expected = ooxmlTypes[extension];
    const mainPart = byName.get(expected.mainPart);
    if (!contentTypesEntry || !rootRelationships || !mainPart) {
      return `Office package does not contain the required ${extension} structure`;
    }
    const contentTypes = decodeUtf8(extractZipEntry(content, contentTypesEntry));
    if (
      !contentTypes.includes(`PartName="/${expected.mainPart}"`) ||
      !contentTypes.includes(`ContentType="${expected.mainContentType}"`)
    ) {
      return `Office package content types do not match ${extension}`;
    }
    const relationships = decodeUtf8(extractZipEntry(content, rootRelationships));
    if (!relationships.includes("officeDocument") || !relationships.includes(expected.mainPart)) {
      return `Office package relationships do not identify the ${extension} main part`;
    }
    return undefined;
  } catch {
    return "Office package structure is invalid or unsafe";
  }
}

export function fileContentPolicyIssue(filename: string, contentType: string, content: Buffer) {
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "txt":
    case "csv":
    case "md":
      return textContentIssue(content, false);
    case "json":
      return textContentIssue(content, true);
    case "pdf": {
      if (!startsWith(content, PDF_SIGNATURE)) return "File content does not match PDF";
      const tail = content.subarray(Math.max(0, content.length - 2_048)).toString("latin1");
      return tail.includes("%%EOF") ? undefined : "PDF end marker is missing";
    }
    case "png":
      return startsWith(content, PNG_SIGNATURE) ? undefined : "File content does not match PNG";
    case "jpg":
    case "jpeg":
      return content.length >= 3 &&
        content[0] === 0xff &&
        content[1] === 0xd8 &&
        content[2] === 0xff
        ? undefined
        : "File content does not match JPEG";
    case "gif":
      return startsWith(content, GIF_87_SIGNATURE) || startsWith(content, GIF_89_SIGNATURE)
        ? undefined
        : "File content does not match GIF";
    case "webp":
      return content.length >= 12 &&
        content.subarray(0, 4).toString("ascii") === "RIFF" &&
        content.subarray(8, 12).toString("ascii") === "WEBP" &&
        content.readUInt32LE(4) + 8 === content.length
        ? undefined
        : "File content does not match WebP";
    case "docx":
    case "xlsx":
    case "pptx":
      return officeContentIssue(content, extension);
    default:
      return `File content policy does not support ${contentType}`;
  }
}
