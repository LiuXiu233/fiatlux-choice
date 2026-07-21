import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildEducationContentJsonSchema } from "../apps/web/src/lib/education-content-schema.js";

async function main() {
  const outputPath = resolve("content/education/education-content.schema.json");
  const schema = buildEducationContentJsonSchema();
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  process.stdout.write(`已生成 ${outputPath}\n`);
}

void main();
