import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { fileContentPolicyIssue } from "../../src/file-content-policy.js";

interface ZipFixtureEntry {
  name: string;
  data: Buffer | string;
  flags?: number;
  compressionMethod?: 0 | 8;
}

function storedZip(entries: ZipFixtureEntry[]) {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "ascii");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const flags = entry.flags ?? 0;
    const compressionMethod = entry.compressionMethod ?? 8;
    const compressed = compressionMethod === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localRecords.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralRecords.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const localPayload = Buffer.concat(localRecords);
  const centralPayload = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralPayload.length, 12);
  end.writeUInt32LE(localPayload.length, 16);
  return Buffer.concat([localPayload, centralPayload, end]);
}

const officeTypes = {
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    mainPart: "word/document.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mainPart: "xl/workbook.xml",
    mainContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    mainPart: "ppt/presentation.xml",
    mainContentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
} as const;

function officeFixture(extension: keyof typeof officeTypes, extra: ZipFixtureEntry[] = []) {
  const expected = officeTypes[extension];
  return storedZip([
    {
      name: "[Content_Types].xml",
      data: `<Types><Override PartName="/${expected.mainPart}" ContentType="${expected.mainContentType}"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${expected.mainPart}"/></Relationships>`,
    },
    { name: expected.mainPart, data: "<document/>" },
    ...extra,
  ]);
}

describe("uploaded file content policy", () => {
  it("accepts UTF-8 text and syntactically valid JSON", () => {
    expect(
      fileContentPolicyIssue("说明.txt", "text/plain", Buffer.from("耀光电竞\n")),
    ).toBeUndefined();
    expect(
      fileContentPolicyIssue("record.json", "application/json", Buffer.from('{"status":"draft"}')),
    ).toBeUndefined();
  });

  it("rejects binary controls, invalid UTF-8 and malformed JSON", () => {
    expect(fileContentPolicyIssue("binary.txt", "text/plain", Buffer.from([0x61, 0, 0x62]))).toBe(
      "Text content contains binary control bytes",
    );
    expect(fileContentPolicyIssue("invalid.md", "text/markdown", Buffer.from([0xc3, 0x28]))).toBe(
      "Text content must be valid UTF-8",
    );
    expect(fileContentPolicyIssue("invalid.json", "application/json", Buffer.from("{no"))).toBe(
      "JSON content is not syntactically valid",
    );
  });

  it("recognizes the allowed binary signatures instead of trusting names", () => {
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(4, 4);
    webp.write("WEBP", 8, "ascii");
    const valid = [
      ["evidence.pdf", "application/pdf", Buffer.from("%PDF-1.7\n%%EOF\n")],
      ["image.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])],
      ["photo.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
      ["animation.gif", "image/gif", Buffer.from("GIF89a", "ascii")],
      ["picture.webp", "image/webp", webp],
    ] as const;
    for (const [filename, mime, content] of valid) {
      expect(fileContentPolicyIssue(filename, mime, content), filename).toBeUndefined();
    }
    for (const [filename, mime] of valid) {
      expect(
        fileContentPolicyIssue(filename, mime, Buffer.from("renamed executable")),
      ).toBeTruthy();
    }
  });

  it("requires each OOXML extension to contain its own package structure", () => {
    for (const extension of ["docx", "xlsx", "pptx"] as const) {
      const expected = officeTypes[extension];
      expect(
        fileContentPolicyIssue(`evidence.${extension}`, expected.mime, officeFixture(extension)),
      ).toBeUndefined();
    }
    expect(
      fileContentPolicyIssue("renamed.docx", officeTypes.docx.mime, officeFixture("xlsx")),
    ).toContain("required docx structure");
    expect(
      fileContentPolicyIssue(
        "generic.docx",
        officeTypes.docx.mime,
        storedZip([{ name: "payload.txt", data: "not an Office package" }]),
      ),
    ).toContain("required docx structure");
  });

  it("rejects active, embedded, encrypted and unsafe Office entries", () => {
    expect(
      fileContentPolicyIssue(
        "macro.docx",
        officeTypes.docx.mime,
        officeFixture("docx", [{ name: "word/vbaProject.bin", data: "macro" }]),
      ),
    ).toContain("blocked active");
    expect(
      fileContentPolicyIssue(
        "embedded.docx",
        officeTypes.docx.mime,
        officeFixture("docx", [{ name: "word/embeddings/object.bin", data: "object" }]),
      ),
    ).toContain("blocked active");
    expect(
      fileContentPolicyIssue(
        "encrypted.docx",
        officeTypes.docx.mime,
        storedZip([
          { name: "[Content_Types].xml", data: "<Types/>", flags: 1 },
          { name: "_rels/.rels", data: "<Relationships/>" },
          { name: "word/document.xml", data: "<document/>" },
        ]),
      ),
    ).toContain("invalid or unsafe");
    expect(
      fileContentPolicyIssue(
        "traversal.docx",
        officeTypes.docx.mime,
        officeFixture("docx", [{ name: "word/../payload.xml", data: "unsafe" }]),
      ),
    ).toContain("invalid or unsafe");
  });

  it("rejects malformed PDF and WebP envelopes", () => {
    expect(
      fileContentPolicyIssue("truncated.pdf", "application/pdf", Buffer.from("%PDF-1.7")),
    ).toBe("PDF end marker is missing");
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(999, 4);
    webp.write("WEBP", 8, "ascii");
    expect(fileContentPolicyIssue("wrong.webp", "image/webp", webp)).toBe(
      "File content does not match WebP",
    );
  });
});
