export async function readSingleLineSecret(
  input: NodeJS.ReadableStream = process.stdin,
  maxBytes = 4_096,
) {
  if ("isTTY" in input && input.isTTY) {
    throw new Error("Secret input must be piped through stdin or redirected from a secret file");
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of input as AsyncIterable<Buffer | string>) {
      const buffer = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
      chunks.push(buffer);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) throw new Error("Secret input exceeds the maximum allowed size");
    }
    const combined = Buffer.concat(chunks);
    try {
      let end = combined.length;
      if (end > 0 && combined[end - 1] === 0x0a) end -= 1;
      if (end > 0 && combined[end - 1] === 0x0d) end -= 1;
      const value = combined.subarray(0, end);
      if (!value.length) throw new Error("Secret input is empty");
      if (value.includes(0x0a) || value.includes(0x0d) || value.includes(0x00)) {
        throw new Error("Secret input must contain exactly one non-NUL line");
      }
      return value.toString("utf8");
    } finally {
      combined.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}
