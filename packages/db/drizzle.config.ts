import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://fiatlux:fiatlux@localhost:5432/fiatlux",
  },
  strict: true,
  verbose: true,
});
