import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createApp } from "./http.mjs";
import { acquireLock } from "./lock.mjs";
import { ensureXhs } from "./xhs-startup.mjs";
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
      configPath: resolve(dirname(dbPath), 'service-config.json'),
      assetsDir: resolve(process.env.REDNOTE_ASSETS || "data/assets"),
    },
  });
} catch (error) {
  release();
  throw error;
}
const port = Number(process.env.PORT || 4173);
try {
  const connector = await ensureXhs();
  console.log(connector.status === 'started' ? '小红书连接服务已自动启动（18060）' : '已复用运行中的小红书连接服务（18060）');
} catch (error) {
  // Keep manual product editing available, but never claim the connector is ready.
  console.error(`小红书连接服务不可用：${error.message}`);
}
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
