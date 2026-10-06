import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createApp } from "./http.mjs";
import { acquireLock } from "./lock.mjs";
if (existsSync(".env")) process.loadEnvFile(".env");
const dbPath = resolve(process.env.REDNOTE_DB || "data/rednote.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
const release = acquireLock(dbPath);
let app;
try {
  app = createApp({
    dbPath,
    enableServices: true,
    serviceOptions: {
      assetsDir: resolve(process.env.REDNOTE_ASSETS || "data/assets"),
    },
  });
} catch (error) {
  release();
  throw error;
}
const port = Number(process.env.PORT || 4173);
app.server.listen(port, "127.0.0.1", () =>
  console.log(`RedNote listening on http://127.0.0.1:${port}`),
);
app.server.on("error", async () => {
  await app.close();
  release();
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    release();
    process.exit(0);
  });
