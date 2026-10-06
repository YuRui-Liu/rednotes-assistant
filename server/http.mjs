import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AppStore, AppError } from "./store.mjs";
import { Services } from "./services.mjs";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
};
async function body(req, limit = 1024 * 1024) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > limit)
      throw new AppError("请求内容过大", "TOO_LARGE", 413);
  }
  if (!data) return {};
  try {
    const value = JSON.parse(data);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new AppError("JSON 格式错误");
  }
}
export function createApp({
  dbPath = ":memory:",
  publish,
  routeHook,
  staticDir = publicDir,
  publishTimeoutMs = 120000,
  serviceOptions,
  enableServices = false,
} = {}) {
  const store = new AppStore(dbPath);
  const services = enableServices ? new Services(store, serviceOptions) : null;
  if (services && !publish) publish = (args) => services.publish(args);
  let execution = null,
    closing = false,
    closePromise = null;
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || "";
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
        throw new AppError("仅允许本机访问", "HOST", 403);
      const url = new URL(req.url, `http://${host}`),
        path = url.pathname,
        method = req.method;
      if (
        !["GET", "HEAD"].includes(method) &&
        req.headers.origin &&
        req.headers.origin !== `http://${host}`
      )
        throw new AppError("拒绝跨域写入", "ORIGIN", 403);
      if (path.startsWith("/api/")) {
        if (
          ["POST", "PATCH", "PUT"].includes(method) &&
          !/^application\/json(?:\s*;|$)/i.test(
            req.headers["content-type"] || "",
          )
        )
          throw new AppError(
            "写入请求需要 application/json",
            "CONTENT_TYPE",
            415,
          );
        const b = ["POST", "PATCH", "PUT"].includes(method)
          ? await body(
              req,
              path === "/api/assets" ? 15 * 1024 * 1024 : 1024 * 1024,
            )
          : {};
        let data,
          status = 200;
        const parts = path.split("/").filter(Boolean),
          kind = parts[1],
          id = parts[2],
          action = parts[3];
        const hook = routeHook
          ? await routeHook({ method, path, body: b, store })
          : undefined;
        if (hook !== undefined) {
          json(res, hook.status || 200, { data: hook.data });
          return;
        }
        const serviceResult = services
          ? await services.route({ method, kind, id, action, body: b })
          : undefined;
        if (serviceResult !== undefined) data = serviceResult;
        else if (method === "GET" && path === "/api/state")
          data = store.state();
        else if (method === "GET" && path === "/api/health")
          data = services
            ? services.health()
            : { status: "ok", publisherConnected: Boolean(publish) };
        else if (method === "GET" && !action)
          data = id ? store.get(kind, id) : store.list(kind);
        else if (method === "POST" && !id) {
          status = 201;
          const fn = {
            products: "createProduct",
            accounts: "createAccount",
            batches: "createBatch",
            schedules: "createSchedule",
            evidence: "addEvidence",
            interactions: "createInteraction",
          }[kind];
          if (fn) data = store[fn](b);
          else throw new AppError("接口不存在", "NOT_FOUND", 404);
        } else if (method === "PATCH" && !action) {
          const fn = {
            products: "updateProduct",
            accounts: "updateAccount",
            notes: "editNote",
            schedules: "reschedule",
            interactions: "editInteraction",
          }[kind];
          if (fn) data = store[fn](id, b);
          else throw new AppError("接口不存在", "NOT_FOUND", 404);
        } else if (
          method === "POST" &&
          kind === "batches" &&
          action === "topics"
        )
          data = store.addTopics(id, b);
        else if (
          method === "POST" &&
          kind === "batches" &&
          action === "generate"
        )
          data = store.generate(id);
        else if (method === "POST" && kind === "topics" && action === "confirm")
          data = store.confirmTopic(id);
        else if (method === "POST" && kind === "notes" && action === "approve")
          data = store.approveNote(id, b);
        else if (
          method === "POST" &&
          kind === "schedules" &&
          action === "approve"
        )
          data = store.approveSchedule(id);
        else if (
          method === "POST" &&
          kind === "schedules" &&
          action === "cancel"
        )
          data = store.cancelSchedule(id);
        else if (
          method === "POST" &&
          kind === "interactions" &&
          action === "approve"
        )
          data = store.approveInteraction(id);
        else throw new AppError("接口不存在", "NOT_FOUND", 404);
        if (method !== "GET") store.event("api.mutation", { method, path });
        json(res, status, { data });
        return;
      }
      if (method !== "GET" && method !== "HEAD")
        throw new AppError("方法不允许", "METHOD", 405);
      if (services && path.startsWith("/assets/")) {
        const asset = services.assets.verify(path);
        res.writeHead(200, {
          "Content-Type": asset.mime,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(method === "HEAD" ? undefined : asset.bytes);
        return;
      }
      const root = resolve(staticDir),
        file = resolve(
          root,
          `.${decodeURIComponent(path === "/" ? "/index.html" : path)}`,
        );
      if (!file.startsWith(root + sep))
        throw new AppError("路径不允许", "FORBIDDEN", 403);
      let bytes;
      try {
        bytes = await readFile(file);
      } catch {
        throw new AppError("文件不存在", "NOT_FOUND", 404);
      }
      res.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          }[extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(method === "HEAD" ? undefined : bytes);
    } catch (e) {
      json(res, e.status || 500, {
        error: {
          code: e.code || "INTERNAL",
          message: e.status ? e.message : "服务器内部错误",
        },
      });
    }
  });
  async function execute(schedule) {
    if (!publish) {
      store.finish(schedule.id, {
        status: "failed",
        error: "未连接发布服务，未执行发布",
      });
      return;
    }
    // A deadline changes our knowledge of the result, not the lifetime of the
    // external request. Retain the lock until that request actually settles.
    const timer = setTimeout(() => {
      store.finish(schedule.id, {
        status: "unknown",
        error: "执行超时，需人工核对结果",
      });
    }, publishTimeoutMs);
    timer.unref();
    try {
      const note = store.get("notes", schedule.noteId);
      const result = await publish({
        schedule,
        note,
        account: store.get("accounts", schedule.accountId),
        product: store.get("products", note.productId),
      });
      if (!result?.url && !result?.id)
        throw new Error("发布结果缺少可核对的 ID 或链接");
      // finish only transitions running; a late receipt must not erase unknown.
      store.finish(schedule.id, { status: "succeeded", result });
    } catch (e) {
      store.finish(schedule.id, {
        status:
          e.code === "PRODUCT_UNVERIFIED" ||
          e.code === "IDENTITY" ||
          e.code === "DISCONNECTED"
            ? "failed"
            : "unknown",
        error: e.status ? e.message : "发布请求失败，需人工核对",
      });
    } finally {
      clearTimeout(timer);
    }
  }
  async function tick(now = Date.now()) {
    if (closing || execution || services?.browserBusy) return;
    const schedule = store.claim(now);
    if (!schedule) return;
    execution = execute(schedule);
    try {
      await execution;
    } finally {
      execution = null;
    }
  }
  const interval = setInterval(
    () =>
      tick().catch((e) => {
        if (!closing) store.event("worker.error", { message: e.message });
      }),
    1000,
  );
  interval.unref();
  const jobInterval = services
    ? setInterval(() => services.tick().catch(() => {}), 5000)
    : null;
  jobInterval?.unref();
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    clearInterval(interval);
    if (jobInterval) clearInterval(jobInterval);
    closePromise = (async () => {
      if (server.listening)
        await new Promise((r, j) => server.close((e) => (e ? j(e) : r())));
      // Drain the real request before releasing SQLite. New ticks are blocked.
      if (execution) await execution;
      if (services) await services.close();
      store.close();
    })();
    return closePromise;
  }
  return { server, store, services, tick, close };
}
