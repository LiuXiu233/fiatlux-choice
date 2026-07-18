import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabase } from "./index.js";

const { db, client } = createDatabase();

try {
  await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
} finally {
  await client.end();
}
