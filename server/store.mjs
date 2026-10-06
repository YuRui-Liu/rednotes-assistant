import { DatabaseSync } from "node:sqlite";

import { randomUUID, createHash } from "node:crypto";

export class AppError extends Error {
  constructor(message, code = "VALIDATION", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (message, code, status) => {
  throw new AppError(message, code, status);
};

const text = (v, label) =>
  typeof v === "string" && v.trim() ? v.trim() : fail(`${label}不能为空`);

const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

const tables = [
  "products",
  "accounts",
  "batches",
  "topics",
  "notes",
  "schedules",
  "evidence",
  "interactions",
  "events",
  "jobs",
  "settings",
  "research",
];

const active = ["pending", "authorized"];

const pick = (o, keys) =>
  Object.fromEntries(
    keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]),
  );

export class AppStore {
  constructor(path = ":memory:", { dailyLimit = 3 } = {}) {
    this.db = new DatabaseSync(path);
    this.dailyLimit = dailyLimit;
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));",
    );
    this.recover();
  }
  close() {
    this.db.close();
  }
  list(kind) {
    if (!tables.includes(kind)) fail("未知资源");
    return this.db
      .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((r) => JSON.parse(r.data));
  }
  get(kind, id) {
    const row = this.db
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    if (!row) fail("记录不存在", "NOT_FOUND", 404);
    return JSON.parse(row.data);
  }
  save(kind, value) {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, value.id, JSON.stringify(value));
    return structuredClone(value);
  }
  add(kind, value) {
    return this.save(kind, {
      ...value,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
  }
  event(type, detail) {
    this.add("events", { type, detail });
  }
  state() {
    return Object.fromEntries(tables.map((k) => [k, this.list(k)]));
  }
  validateProduct(input) {
    for (const key of ["name", "url", "facts"])
      if (input[key] !== undefined && typeof input[key] !== "string")
        fail(`${key} 须为文字`);
    if (input.confirmed !== undefined && typeof input.confirmed !== "boolean")
      fail("confirmed 须为布尔值");
  }
  createProduct(input) {
    this.validateProduct(input);
    return this.add("products", {
      name: text(input.name, "商品名称"),
      url: input.url || "",
      facts: input.facts || "",
      images: this.images(input.images || []),
      confirmed: input.confirmed === true,
      version: 1,
    });
  }
  images(images) {
    if (
      !Array.isArray(images) ||
      images.some(
        (v) =>
          typeof v !== "string" ||
          !/^(https?:\/\/|\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$)/.test(v),
      )
    )
      fail("图片须为 HTTP(S) 或已保存素材 URL 数组");
    return images;
  }
  updateProduct(id, input) {
    this.validateProduct(input);
    const p = this.get("products", id);
    const updated = {
      ...p,
      ...pick(input, ["name", "url", "facts", "images", "confirmed"]),
      version: p.version + 1,
    };
    text(updated.name, "商品名称");
    this.images(updated.images);
    this.save("products", updated);
    for (const n of this.list("notes").filter((n) => n.productId === id)) {
      n.approvedRevision = null;
      n.contentApproval = null;
      this.save("notes", n);
      this.invalidate(n.id);
    }
    return updated;
  }
  createAccount(input) {
    this.validateConnection(input);
    return this.add("accounts", {
      name: text(input.name, "账号名称"),
      positioning: input.positioning || "",
      mcpUrl: input.mcpUrl || "",
      platformUserId: input.platformUserId || "",
      dailyLimit: this.limit(input.dailyLimit ?? this.dailyLimit),
      dailySlots: this.accountSlots(input.dailySlots ?? []),
    });
  }
  validateConnection(input, id) {
    if (input.mcpUrl) {
      let u;
      try {
        u = new URL(input.mcpUrl);
      } catch {
        fail("连接地址无效");
      }
      if (
        u.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
        u.username ||
        u.password ||
        u.pathname !== "/" ||
        u.search ||
        u.hash
      )
        fail("服务地址须为本机 HTTP 根地址");
      if (
        this.list("accounts").some(
          (a) => a.id !== id && a.mcpUrl && new URL(a.mcpUrl).port === u.port,
        )
      )
        fail("每个账号须使用独立服务端口");
    }
    if (
      input.platformUserId !== undefined &&
      typeof input.platformUserId !== "string"
    )
      fail("绑定用户 ID 无效");
  }
  limit(value) {
    if (!Number.isInteger(value) || value < 1 || value > 30)
      fail("每日上限须为 1 到 30 的整数");
    return value;
  }
  accountSlots(value) {
    if (
      !Array.isArray(value) ||
      value.length > 30 ||
      value.some(
        (slot) =>
          typeof slot !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot),
      ) ||
      new Set(value).size !== value.length
    )
      fail("账号常用时段须为不重复的 HH:mm 数组");
    return [...value];
  }
  updateAccount(id, input) {
    const a = this.get("accounts", id);
    this.validateConnection(input, id);
    text(input.name ?? a.name, "账号名称");
    const result = this.save("accounts", {
      ...a,
      ...pick(input, ["name", "positioning", "mcpUrl", "platformUserId"]),
      dailyLimit: this.limit(input.dailyLimit ?? a.dailyLimit),
      dailySlots: this.accountSlots(
        input.dailySlots === undefined ? a.dailySlots || [] : input.dailySlots,
      ),
    });
    if (
      (input.mcpUrl !== undefined && input.mcpUrl !== a.mcpUrl) ||
      (input.platformUserId !== undefined &&
        input.platformUserId !== a.platformUserId)
    ) {
      for (const s of this.list("schedules").filter(
        (s) => s.accountId === id && active.includes(s.status),
      ))
        this.save("schedules", { ...s, status: "invalidated", approval: null });
      for (const i of this.list("interactions").filter(
        (i) => i.accountId === id && i.status === "approved",
      ))
        this.save("interactions", {
          ...i,
          status: "draft",
          approvedRevision: null,
          approval: null,
        });
    }
    return result;
  }
  createBatch(input) {
    this.get("products", input.productId);
    this.get("accounts", input.accountId);
    const topicCount = input.topicCount ?? 6,
      targetCount = input.targetCount ?? 3;
    if (
      !Number.isInteger(topicCount) ||
      topicCount < 1 ||
      topicCount > 30 ||
      !Number.isInteger(targetCount) ||
      targetCount < 1 ||
      targetCount > topicCount
    )
      fail("选题和目标数量无效");
    return this.add("batches", {
      productId: input.productId,
      accountId: input.accountId,
      topicCount,
      targetCount,
      status: "planning",
    });
  }
  addTopics(id, { titles }) {
    const b = this.get("batches", id);
    if (!Array.isArray(titles) || !titles.length) fail("请提供选题");
    const count = this.list("topics").filter((t) => t.batchId === id).length;
    if (count + titles.length > b.topicCount) fail("超出批次选题数量");
    const valid = titles.map((t) => text(t, "选题"));
    return valid.map((title) =>
      this.add("topics", { batchId: id, title, confirmed: false }),
    );
  }
  confirmTopic(id) {
    const t = this.get("topics", id);
    return this.save("topics", { ...t, confirmed: true });
  }
  generate(id) {
    const b = this.get("batches", id),
      p = this.get("products", b.productId);
    const topics = this.list("topics").filter(
      (t) => t.batchId === id && t.confirmed,
    );
    if (!topics.length) fail("请先确认选题");
    const existing = this.list("notes").filter((n) => n.batchId === id);
    const selected = topics.filter(
      (t) => !existing.some((n) => n.topicId === t.id),
    );
    return selected.map((t) => {
      const content = {
        title: t.title,
        body: p.facts || "",
        images: [...p.images],
      };
      return this.add("notes", {
        batchId: id,
        topicId: t.id,
        productId: p.id,
        accountId: b.accountId,
        ...content,
        revision: 1,
        revisions: [
          { revision: 1, ...content, createdAt: new Date().toISOString() },
        ],
        approvedRevision: null,
        contentApproval: null,
        provenance: "manual-source-draft",
      });
    });
  }
  invalidate(noteId) {
    for (const s of this.list("schedules").filter(
      (s) => s.noteId === noteId && active.includes(s.status),
    ))
      this.save("schedules", { ...s, status: "invalidated", approval: null });
  }
  editNote(id, input) {
    const n = this.get("notes", id);
    const content = {
      ...pick(n, ["title", "body", "images"]),
      ...pick(input, ["title", "body", "images"]),
    };
    text(content.title, "标题");
    this.images(content.images);
    const revision = n.revision + 1;
    const result = this.save("notes", {
      ...n,
      ...content,
      revision,
      revisions: [
        ...n.revisions,
        { ...content, revision, createdAt: new Date().toISOString() },
      ],
      approvedRevision: null,
      contentApproval: null,
    });
    this.invalidate(id);
    return result;
  }
  fingerprint(n) {
    const p = this.get("products", n.productId);
    return hash({
      accountId: n.accountId,
      revision: n.revision,
      title: n.title,
      body: n.body,
      images: n.images,
      productVersion: p.version,
      facts: p.facts,
      productImages: p.images,
    });
  }
  approveNote(id, input = {}) {
    const n = this.get("notes", id),
      p = this.get("products", n.productId);
    if (
      this.list("jobs").some(
        (j) =>
          j.noteId === id &&
          !j.abandonedAt &&
          [
            "queued",
            "submitting",
            "submitted",
            "processing",
            "writing",
            "unknown",
          ].includes(j.status),
      )
    )
      fail("生成任务尚未完成或结果未知，不能批准");
    if (this.verifyAssets) this.verifyAssets(n.images);
    if (!p.confirmed || !p.facts?.trim()) fail("请先确认完整商品资料");
    if (!p.images.length || !n.images.length) fail("缺少商品图片");
    text(n.body, "正文");
    const mode = input.mode || "normal";
    if (!["normal", "product"].includes(mode)) fail("发布模式无效");
    if (mode === "product" && input.productId !== n.productId)
      fail("挂商品批准需匹配商品");
    if (n.contentApproval && n.contentApproval.mode !== mode)
      this.invalidate(id);
    return this.save("notes", {
      ...n,
      approvedRevision: n.revision,
      contentApproval: {
        fingerprint: this.fingerprint(n),
        mode,
        productId: mode === "product" ? p.id : null,
        at: new Date().toISOString(),
      },
    });
  }
  validateSchedule(input, except) {
    const n = this.get("notes", input.noteId);
    if (this.verifyAssets) this.verifyAssets(n.images);
    this.get("accounts", input.accountId);
    if (n.accountId !== input.accountId) fail("账号与笔记不匹配");
    if (
      n.approvedRevision !== n.revision ||
      n.contentApproval?.fingerprint !== this.fingerprint(n)
    )
      fail("内容尚未批准或批准已失效");
    if (!["normal", "product"].includes(input.mode)) fail("发布模式无效");
    if (
      input.mode !== n.contentApproval.mode ||
      (input.mode === "product" &&
        input.productId !== n.contentApproval.productId)
    )
      fail("发布模式或商品不匹配内容批准");
    const at = new Date(input.scheduledAt).getTime();
    if (!Number.isFinite(at) || at <= Date.now()) fail("排期必须是未来时间");
    const others = this.list("schedules").filter(
      (s) =>
        s.id !== except &&
        s.accountId === input.accountId &&
        ["pending", "authorized", "running", "unknown", "succeeded"].includes(
          s.status,
        ),
    );
    if (
      others.some(
        (s) => Math.abs(new Date(s.scheduledAt).getTime() - at) < 60000,
      )
    )
      fail("排期时间冲突，至少间隔一分钟");
    const day = new Date(at + 8 * 3600000).toISOString().slice(0, 10);
    if (
      others.filter(
        (s) =>
          new Date(new Date(s.scheduledAt).getTime() + 8 * 3600000)
            .toISOString()
            .slice(0, 10) === day,
      ).length >= this.get("accounts", input.accountId).dailyLimit
    )
      fail("超过每日发布上限");
    if (
      others.some(
        (s) =>
          s.noteId === n.id &&
          s.revision === n.revision &&
          ["pending", "authorized", "running", "unknown", "succeeded"].includes(
            s.status,
          ),
      )
    )
      fail("此笔记版本已有发布任务，禁止重复发布");
    return { n, at };
  }
  createSchedule(input) {
    const { n, at } = this.validateSchedule(input);
    return this.add("schedules", {
      noteId: n.id,
      accountId: input.accountId,
      productId: input.mode === "product" ? input.productId : null,
      mode: input.mode,
      revision: n.revision,
      fingerprint: this.fingerprint(n),
      scheduledAt: new Date(at).toISOString(),
      status: "pending",
      approval: null,
    });
  }
  approveSchedule(id) {
    const s = this.get("schedules", id);
    if (s.status !== "pending") fail("该排期不可批准");
    this.validateSchedule(s, id);
    return this.save("schedules", {
      ...s,
      status: "authorized",
      approval: hash(
        pick(s, [
          "accountId",
          "noteId",
          "revision",
          "fingerprint",
          "mode",
          "productId",
          "scheduledAt",
        ]),
      ),
    });
  }
  reschedule(id, input) {
    const s = this.get("schedules", id);
    if (!["pending", "authorized", "missed"].includes(s.status))
      fail("该任务不能改期，请创建新排期");
    const { at } = this.validateSchedule(
      { ...s, scheduledAt: input.scheduledAt },
      id,
    );
    return this.save("schedules", {
      ...s,
      scheduledAt: new Date(at).toISOString(),
      status: "pending",
      approval: null,
    });
  }
  cancelSchedule(id) {
    const s = this.get("schedules", id);
    if (!["pending", "authorized"].includes(s.status)) fail("任务不能取消");
    return this.save("schedules", {
      ...s,
      status: "cancelled",
      approval: null,
    });
  }
  recover() {
    for (const s of this.list("schedules").filter(
      (s) => s.status === "running",
    ))
      this.save("schedules", {
        ...s,
        status: "unknown",
        error: "执行中断，需人工核对结果",
      });
  }
  claim(now = Date.now()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const all = this.list("schedules");
      for (const s of all.filter(
        (s) =>
          ["pending", "authorized"].includes(s.status) &&
          new Date(s.scheduledAt).getTime() < now - 60000,
      ))
        this.save("schedules", { ...s, status: "missed" });
      if (this.list("schedules").some((s) => s.status === "running")) {
        this.db.exec("COMMIT");
        return null;
      }
      const blockedAccounts = new Set(
        this.list("schedules")
          .filter((s) => s.status === "unknown")
          .map((s) => s.accountId),
      );
      for (const interaction of this.list("interactions"))
        if (["unknown", "running"].includes(interaction.status))
          blockedAccounts.add(interaction.accountId);
      const job = this.list("schedules")
        .filter(
          (s) =>
            s.status === "authorized" &&
            !blockedAccounts.has(s.accountId) &&
            new Date(s.scheduledAt).getTime() <= now,
        )
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
      if (!job) {
        this.db.exec("COMMIT");
        return null;
      }
      const n = this.get("notes", job.noteId);
      if (this.verifyAssets) {
        try {
          this.verifyAssets(n.images);
        } catch {
          this.save("schedules", {
            ...job,
            status: "invalidated",
            approval: null,
            error: "素材完整性验证失败",
          });
          this.db.exec("COMMIT");
          return null;
        }
      }
      if (
        n.approvedRevision !== job.revision ||
        this.fingerprint(n) !== job.fingerprint ||
        n.contentApproval?.mode !== job.mode ||
        n.contentApproval?.productId !== job.productId ||
        job.approval !==
          hash(
            pick(job, [
              "accountId",
              "noteId",
              "revision",
              "fingerprint",
              "mode",
              "productId",
              "scheduledAt",
            ]),
          )
      ) {
        this.save("schedules", {
          ...job,
          status: "invalidated",
          approval: null,
        });
        this.db.exec("COMMIT");
        return null;
      }
      const result = this.save("schedules", {
        ...job,
        status: "running",
        startedAt: new Date(now).toISOString(),
      });
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  finish(id, result) {
    const s = this.get("schedules", id);
    if (s.status !== "running") return s;
    return this.save("schedules", {
      ...s,
      status: result.status,
      error: result.error || null,
      result: result.result || null,
      finishedAt: new Date().toISOString(),
    });
  }
  addEvidence(input) {
    text(input.query, "检索词");
    text(input.url, "来源链接");
    return this.add("evidence", {
      ...pick(input, ["query", "url", "title", "excerpt", "accountId"]),
      retrievedAt: new Date().toISOString(),
      provenance: "user-provided",
    });
  }
  createInteraction(input) {
    this.get("accounts", input.accountId);
    return this.add("interactions", {
      accountId: input.accountId,
      sourceUrl: text(input.sourceUrl, "来源链接"),
      body: text(input.body, "回复内容"),
      revision: 1,
      approvedRevision: null,
      status: "draft",
    });
  }
  editInteraction(id, input) {
    const i = this.get("interactions", id);
    return this.save("interactions", {
      ...i,
      body: text(input.body, "回复内容"),
      revision: i.revision + 1,
      approvedRevision: null,
      status: "draft",
    });
  }
  approveInteraction(id) {
    const i = this.get("interactions", id);
    return this.save("interactions", {
      ...i,
      approvedRevision: i.revision,
      status: "approved",
    });
  }
}
