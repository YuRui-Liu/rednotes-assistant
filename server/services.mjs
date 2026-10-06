import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./store.mjs";
import { downloadPinned } from "./image-download.mjs";

const bad = (message, code = "VALIDATION", status = 400) => {
  throw new AppError(message, code, status);
};
const required = (v, label) =>
  typeof v === "string" && v.trim() ? v.trim() : bad(`${label}不能为空`);
const digest = (b) => createHash("sha256").update(b).digest("hex");
const snapshot = (v) => digest(JSON.stringify(v));
const MAX = 10 * 1024 * 1024;
const mime = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const now = () => new Date().toISOString();
const pick = (o, keys) =>
  Object.fromEntries(
    keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]),
  );
const privateIP = (a) =>
  a.includes(":")
    ? !a.toLowerCase().startsWith("2") && !a.toLowerCase().startsWith("3")
    : /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])|198\.(1[89])|192\.0|22[4-9]|23\d|24\d|25\d)(\.|$)/.test(
        a,
      );

export class Assets {
  constructor(dir) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }
  signature(bytes) {
    if (!bytes.length || bytes.length > MAX) bad("图片须小于 10MB");
    if (
      bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    )
      return "png";
    if (
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    )
      return "jpg";
    if (
      bytes.length >= 16 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    )
      return "webp";
    bad("仅接受 PNG、JPEG、WebP 图片");
  }
  save(bytes) {
    const ext = this.signature(bytes),
      hash = digest(bytes),
      url = `/assets/${hash}.${ext}`,
      path = this.path(url);
    if (!existsSync(path))
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    this.verify(url);
    return { url, hash, size: bytes.length, mime: mime[ext] };
  }
  upload({ base64 }) {
    if (typeof base64 !== "string") bad("缺少 base64 图片");
    const data = base64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
    if (
      data.length > Math.ceil(MAX / 3) * 4 ||
      !data.length ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
      data.length % 4
    )
      bad("图片 base64 无效或超过 10MB");
    return this.save(Buffer.from(data, "base64"));
  }
  path(url) {
    if (!/^\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(url))
      bad("请先上传不可变图片素材");
    return resolve(this.dir, url.slice(8));
  }
  verify(url) {
    const path = this.path(url);
    let bytes;
    try {
      bytes = readFileSync(path);
    } catch {
      bad("素材文件不存在");
    }
    const ext = this.signature(bytes),
      hash = digest(bytes);
    if (url !== `/assets/${hash}.${ext}`) bad("素材内容已改变，批准失效");
    return { path, bytes, hash, mime: mime[ext] };
  }
  dataURL(url) {
    const a = this.verify(url);
    return `data:${a.mime};base64,${a.bytes.toString("base64")}`;
  }
}

export class Services {
  constructor(
    store,
    {
      assetsDir = "data/assets",
      env = process.env,
      fetch = globalThis.fetch,
      resolveHost = lookup,
    } = {},
  ) {
    this.store = store;
    this.env = env;
    this.fetch = fetch;
    this.resolveHost = resolveHost;
    this.assets = new Assets(assetsDir);
    this.busy = false;
    this.browserBusy = false;
    store.verifyAssets = (urls) => {
      if (!urls.length) bad("缺少图片素材");
      return urls.map((url) => this.assets.verify(url));
    };
    for (const job of store.list("jobs"))
      if (["submitting", "writing"].includes(job.status))
        store.save("jobs", {
          ...job,
          status: "unknown",
          error: "请求中断，无法确认费用或结果；禁止自动重试",
        });
    for (const i of store.list("interactions"))
      if (i.status === "running")
        store.save("interactions", {
          ...i,
          status: "unknown",
          error: "执行中断，需人工核对",
        });
  }
  settings(input) {
    let saved = this.store.list("settings")[0] || {
      id: "global",
      topicCount: 6,
      targetCount: 3,
      maxImages: 9,
      imageProvider: "grsai",
      imageModel: this.env.GRSAI_MODEL || "gpt-image-2",
      llmModel: this.env.LLM_MODEL || "",
      dailySlots: ["10:00", "14:00", "20:00"],
    };
    if (input) {
      const allowed = [
        "topicCount",
        "targetCount",
        "maxImages",
        "imageProvider",
        "imageModel",
        "llmModel",
        "dailySlots",
      ];
      if (Object.keys(input).some((k) => !allowed.includes(k)))
        bad("设置字段不支持；密钥仅通过环境变量配置");
      saved = { ...saved, ...input };
      for (const key of ["topicCount", "targetCount", "maxImages"])
        if (
          !Number.isInteger(saved[key]) ||
          saved[key] < 1 ||
          saved[key] > (key === "maxImages" ? 18 : 30)
        )
          bad("设置数量超出范围");
      if (saved.targetCount > saved.topicCount) bad("建议数量不可超过选题数量");
      if (!["grsai", "manual"].includes(saved.imageProvider))
        bad("图片服务无效");
      for (const k of ["imageModel", "llmModel"])
        if (typeof saved[k] !== "string" || saved[k].length > 150)
          bad("模型名称无效");
      if (
        !Array.isArray(saved.dailySlots) ||
        !saved.dailySlots.length ||
        saved.dailySlots.length > 30 ||
        saved.dailySlots.some((v) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ||
        new Set(saved.dailySlots).size !== saved.dailySlots.length
      )
        bad("每日时间段无效");
      this.store.save("settings", saved);
    }
    return saved;
  }
  health() {
    return {
      status: "ok",
      llmConfigured: Boolean(
        this.env.LLM_BASE_URL &&
        this.env.LLM_API_KEY &&
        this.settings().llmModel,
      ),
      imageConfigured: Boolean(
        this.env.GRSAI_BASE_URL && this.env.GRSAI_API_KEY,
      ),
      publisherConfigured: this.store
        .list("accounts")
        .some((a) => a.mcpUrl && a.platformUserId),
      cost: { available: false, reason: "未配置可验证价格" },
      browsing: {
        supported: false,
        reason: "外部服务不保证持续可见浏览，未运行浏览计时",
      },
      productPublish: { supported: false, reason: "精确挂商品未验证" },
    };
  }
  async route({ method, kind, id, action, body: b }) {
    if (kind === "settings" && !id) {
      if (method === "GET") return this.settings();
      if (method === "PATCH") return this.settings(b);
    }
    if (kind === "assets" && method === "POST" && !id)
      return this.assets.upload(b);
    if (kind === "batches" && method === "POST" && action === "plan")
      return this.plan(id);
    if (kind === "batches" && method === "POST" && action === "generate")
      return this.generate(id, b);
    if (kind === "batches" && method === "POST" && !id)
      return this.store.createBatch({
        topicCount: this.settings().topicCount,
        targetCount: this.settings().targetCount,
        ...b,
      });
    if (kind === "topics" && method === "PATCH" && !action)
      return this.editTopic(id, b);
    if (kind === "topics" && method === "POST" && action === "confirm")
      return this.confirmTopic(id);
    if (kind === "notes" && method === "GET" && action === "export")
      return this.exportNote(id);
    if (kind === "notes" && method === "POST" && action === "regenerate")
      return this.enqueueImages(id, b.slot);
    if (kind === "jobs" && method === "POST" && action === "retry")
      return this.retryJob(id);
    if (kind === "jobs" && method === "POST" && action === "abandon")
      return this.abandonJob(id, b);
    if (kind === "accounts" && method === "GET" && action === "status")
      return this.browser(() =>
        this.xhs(this.store.get("accounts", id), "login/status"),
      );
    if (kind === "accounts" && method === "GET" && action === "qrcode")
      return this.browser(() =>
        this.xhs(this.store.get("accounts", id), "login/qrcode"),
      );
    if (kind === "research" && method === "POST" && id === "search")
      return this.search(b);
    if (kind === "research" && method === "POST" && id === "import")
      return this.importResearch(b);
    if (kind === "research" && method === "PATCH" && id && !action)
      return this.matchResearch(id, b);
    if (kind === "research" && method === "GET" && id === "report")
      return this.report();
    if (kind === "research" && method === "POST" && id === "detail")
      return this.browser(async () => {
        const a = this.store.get("accounts", b.accountId);
        await this.identity(a);
        return this.xhs(a, "feeds/detail", {
          feed_id: required(b.feedId, "笔记 ID"),
          xsec_token: required(b.xsecToken, "访问令牌"),
        });
      });
    if (kind === "schedules" && method === "POST" && id === "suggest")
      return this.suggestions(b);
    if (kind === "schedules" && method === "POST" && action === "reconcile")
      return this.reconcile(id, b);
    if (
      kind === "schedules" &&
      method === "POST" &&
      !id &&
      b.mode === "product"
    )
      bad("精确挂商品未验证，请导出素材手动发布", "PRODUCT_UNVERIFIED", 409);
    if (kind === "interactions" && method === "POST" && !id)
      return this.createInteraction(b);
    if (kind === "interactions" && method === "PATCH" && !action)
      return this.editInteraction(id, b);
    if (kind === "interactions" && method === "POST" && action === "approve")
      return this.approveInteraction(id);
    if (kind === "interactions" && method === "POST" && action === "reconcile")
      return this.reconcileInteraction(id, b);
    if (kind === "interactions" && method === "POST" && action === "execute")
      return this.executeInteraction(id);
  }
  interactionData(input) {
    const kind = input.kind || "comment";
    if (!["like", "comment"].includes(kind)) bad("互动类型无效");
    let u;
    try {
      u = new URL(input.targetUrl || input.sourceUrl);
    } catch {
      bad("互动目标链接无效");
    }
    if (u.protocol !== "https:" || !/(^|\.)xiaohongshu\.com$/.test(u.hostname))
      bad("互动目标须为小红书 HTTPS 链接");
    return {
      kind,
      targetUrl: u.href,
      sourceUrl: u.href,
      feedId: required(input.feedId, "目标笔记 ID"),
      xsecToken: required(input.xsecToken, "访问令牌"),
      body: kind === "comment" ? required(input.body, "评论内容") : "",
      reason: required(input.reason, "互动理由"),
    };
  }
  createInteraction(input) {
    this.store.get("accounts", input.accountId);
    return this.store.add("interactions", {
      ...this.interactionData(input),
      accountId: input.accountId,
      revision: 1,
      approvedRevision: null,
      approval: null,
      status: "draft",
    });
  }
  editInteraction(id, input) {
    const i = this.store.get("interactions", id);
    if (!["draft", "approved"].includes(i.status))
      bad("已执行或结果未知的互动不能修改");
    return this.store.save("interactions", {
      ...i,
      ...this.interactionData({ ...i, ...input }),
      revision: i.revision + 1,
      approvedRevision: null,
      approval: null,
      status: "draft",
    });
  }
  interactionSnapshot(i) {
    const a = this.store.get("accounts", i.accountId);
    return snapshot({
      data: pick(i, [
        "accountId",
        "kind",
        "targetUrl",
        "feedId",
        "xsecToken",
        "body",
        "reason",
        "revision",
      ]),
      identity: pick(a, ["mcpUrl", "platformUserId"]),
    });
  }
  approveInteraction(id) {
    const i = this.store.get("interactions", id);
    if (!["draft", "approved"].includes(i.status)) bad("该互动不能批准");
    this.interactionData(i);
    return this.store.save("interactions", {
      ...i,
      status: "approved",
      approvedRevision: i.revision,
      approval: this.interactionSnapshot(i),
    });
  }
  reconcileInteraction(id, { outcome, reason }) {
    const i = this.store.get("interactions", id);
    if (i.status !== "unknown" || !["succeeded", "failed"].includes(outcome))
      bad("只允许核对未知互动的成功或失败结果");
    required(reason, "人工核对依据");
    const result = this.store.save("interactions", {
      ...i,
      status: outcome,
      reconciliation: { reason, outcome, at: now() },
    });
    this.store.event("interaction.reconciled", { id, reason, outcome });
    return result;
  }
  async executeInteraction(id) {
    return this.browser(async () => {
      const i = this.store.get("interactions", id),
        a = this.store.get("accounts", i.accountId);
      if (
        i.status !== "approved" ||
        i.approvedRevision !== i.revision ||
        i.approval !== this.interactionSnapshot(i)
      )
        bad("互动未批准或批准已失效");
      if (
        this.store
          .list("interactions")
          .some((v) => v.accountId === i.accountId && v.status === "unknown") ||
        this.store
          .list("schedules")
          .some((v) => v.accountId === i.accountId && v.status === "unknown")
      )
        bad("该账号存在未知结果，需人工核对");
      await this.identity(a);
      // Identity verification performs I/O. Recheck the approved snapshot after
      // that await so concurrent edits cannot be overwritten or sent remotely.
      const current = this.store.get("interactions", id);
      if (
        current.status !== "approved" ||
        current.revision !== i.revision ||
        current.approvedRevision !== i.revision ||
        current.approval !== i.approval ||
        this.interactionSnapshot(current) !== i.approval
      )
        bad("互动批准在身份检查期间已失效");
      this.store.save("interactions", {
        ...i,
        status: "running",
        startedAt: now(),
      });
      try {
        const result = await this.xhs(
          a,
          i.kind === "like" ? "feeds/like" : "feeds/comment",
          i.kind === "like"
            ? { feed_id: i.feedId, xsec_token: i.xsecToken, unlike: false }
            : { feed_id: i.feedId, xsec_token: i.xsecToken, content: i.body },
        );
        const final = this.store.save("interactions", {
          ...i,
          status: "succeeded",
          result,
          finishedAt: now(),
        });
        this.store.event("interaction.executed", {
          id,
          kind: i.kind,
          feedId: i.feedId,
        });
        return final;
      } catch {
        const final = this.store.save("interactions", {
          ...i,
          status: "unknown",
          error: "外部互动结果未知，禁止重试",
          finishedAt: now(),
        });
        this.store.event("interaction.unknown", { id });
        return final;
      }
    });
  }
  async request(url, options = {}) {
    let response;
    try {
      response = await this.fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
    } catch {
      bad("外部服务请求失败或超时", "UPSTREAM", 502);
    }
    if (!response.ok)
      bad(`外部服务返回 HTTP ${response.status}`, "UPSTREAM", 502);
    return response;
  }
  async json(url, options = {}) {
    const r = await this.request(url, options);
    try {
      return await r.json();
    } catch {
      bad("外部服务响应不是有效 JSON", "UPSTREAM", 502);
    }
  }
  async download(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      bad("图片地址无效");
    }
    if (u.protocol !== "https:" || u.username || u.password)
      bad("图片下载只支持公网 HTTPS");
    const addresses = isIP(u.hostname)
      ? [{ address: u.hostname }]
      : await this.resolveHost(u.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => privateIP(a.address)))
      bad("不允许访问内网图片地址");
    if (this.fetch === globalThis.fetch)
      return this.assets.save(await downloadPinned(u, addresses, MAX));
    const r = await this.request(u.href);
    if (Number(r.headers.get("content-length")) > MAX) bad("图片超过 10MB");
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > MAX) {
        await r.body.cancel?.().catch(() => {});
        bad("图片超过 10MB");
      }
      chunks.push(chunk);
    }
    return this.assets.save(Buffer.concat(chunks));
  }
  async llm(system, input) {
    const s = this.settings();
    if (!this.env.LLM_BASE_URL || !this.env.LLM_API_KEY || !s.llmModel)
      bad("LLM 未配置，请配置环境变量或选择手工草稿", "DISCONNECTED", 503);
    const base = this.env.LLM_BASE_URL.replace(/\/$/, "");
    const result = await this.json(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: s.llmModel,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    });
    try {
      return JSON.parse(result.choices[0].message.content);
    } catch {
      bad("LLM 输出不符合 JSON 格式", "UPSTREAM", 502);
    }
  }
  validatePlan(plan) {
    if (
      !Array.isArray(plan) ||
      !plan.length ||
      plan.length > this.settings().maxImages
    )
      bad("图片规划数量须在设置范围内");
    return plan.map((v) => ({
      role: required(v.role, "图片角色"),
      prompt: required(v.prompt, "图片提示词"),
    }));
  }
  editTopic(id, input) {
    const t = this.store.get("topics", id),
      patch = pick(input, [
        "title",
        "audience",
        "angle",
        "factBasis",
        "evidenceIds",
        "imagePlan",
        "imageCountReason",
      ]);
    if (patch.title !== undefined) required(patch.title, "选题");
    if (patch.imagePlan !== undefined)
      patch.imagePlan = this.validatePlan(patch.imagePlan);
    if (
      patch.evidenceIds !== undefined &&
      (!Array.isArray(patch.evidenceIds) ||
        patch.evidenceIds.some((v) => typeof v !== "string"))
    )
      bad("证据 ID 无效");
    for (const k of ["audience", "angle", "factBasis", "imageCountReason"])
      if (patch[k] !== undefined && typeof patch[k] !== "string")
        bad("规划字段须为文字");
    return this.store.save("topics", { ...t, ...patch, confirmed: false });
  }
  confirmTopic(id) {
    const t = this.store.get("topics", id);
    this.validatePlan(t.imagePlan);
    return this.store.confirmTopic(id);
  }
  async plan(id) {
    const b = this.store.get("batches", id),
      product = this.store.get("products", b.productId),
      account = this.store.get("accounts", b.accountId),
      evidence = this.store.list("evidence");
    if (this.store.list("topics").some((t) => t.batchId === id))
      bad("批次已有选题，请编辑现有规划或新建批次");
    const result = await this.llm(
      "你是选题规划助手。只基于提供的商品事实和证据，不得编造销量、材质、效果或亲身体验。输出 JSON {topics:[{title,audience,angle,factBasis,evidenceIds:[],imagePlan:[{role,prompt}],imageCountReason}]}。图片数量由叙事需要决定，至少一张且不超过 maxImages。选题数必须等于 topicCount。证据 ID 只能使用给定列表。",
      {
        product,
        account,
        evidence,
        topicCount: b.topicCount,
        maxImages: this.settings().maxImages,
      },
    );
    if (!Array.isArray(result.topics) || result.topics.length !== b.topicCount)
      bad("LLM 选题数量无效", "UPSTREAM", 502);
    const valid = result.topics.map((t) => {
      for (const k of [
        "title",
        "audience",
        "angle",
        "factBasis",
        "imageCountReason",
      ])
        required(t[k], k);
      if (
        !Array.isArray(t.evidenceIds) ||
        t.evidenceIds.some((id) => !evidence.some((e) => e.id === id))
      )
        bad("LLM 引用了不存在的证据");
      return {
        ...pick(t, [
          "title",
          "audience",
          "angle",
          "factBasis",
          "evidenceIds",
          "imageCountReason",
        ]),
        imagePlan: this.validatePlan(t.imagePlan),
      };
    });
    return valid.map((t) =>
      this.store.add("topics", {
        ...t,
        batchId: id,
        confirmed: false,
        provenance: "llm-plan",
      }),
    );
  }
  async generate(
    id,
    { provider = this.settings().imageProvider, textProvider = "llm" } = {},
  ) {
    if (
      !["manual", "grsai"].includes(provider) ||
      !["manual", "llm"].includes(textProvider)
    )
      bad("生成服务无效");
    const topics = this.store
      .list("topics")
      .filter((t) => t.batchId === id && t.confirmed);
    if (!topics.length) bad("请先确认选题");
    for (const t of topics) this.validatePlan(t.imagePlan);
    if (
      provider === "grsai" &&
      (!this.env.GRSAI_BASE_URL || !this.env.GRSAI_API_KEY)
    )
      bad("GRSai 未配置", "DISCONNECTED", 503);
    if (
      textProvider === "llm" &&
      (!this.env.LLM_BASE_URL ||
        !this.env.LLM_API_KEY ||
        !this.settings().llmModel)
    )
      bad("LLM 未配置", "DISCONNECTED", 503);
    const notes = this.store.generate(id);
    for (const note of notes) {
      if (textProvider === "llm")
        this.store.add("jobs", {
          kind: "text",
          noteId: note.id,
          expectedRevision: note.revision,
          planHash: snapshot(this.store.get("topics", note.topicId)),
          status: "queued",
          createdAt: now(),
          cost: null,
        });
      if (provider === "grsai") this.enqueueImages(note.id);
    }
    return notes.map((note) => this.store.get("notes", note.id));
  }
  beginGeneration(id, topic) {
    const previous = this.store.get("notes", id);
    const current = this.store.editNote(id, {});
    // Preserve siblings only when no human edit separated their captured
    // revision from this system-only approval invalidation.
    for (const sibling of this.store
      .list("jobs")
      .filter(
        (job) =>
          job.noteId === id &&
          !job.abandonedAt &&
          [
            "queued",
            "submitting",
            "submitted",
            "processing",
            "writing",
          ].includes(job.status) &&
          job.expectedRevision === previous.revision &&
          job.planHash === snapshot(topic),
      )) {
      this.store.save("jobs", {
        ...sibling,
        expectedRevision: current.revision,
      });
    }
    return current;
  }
  enqueueImages(id, slot) {
    const n = this.store.get("notes", id),
      t = this.store.get("topics", n.topicId);
    this.validatePlan(t.imagePlan);
    const existing = this.store
      .list("jobs")
      .filter((j) => j.noteId === id && j.kind === "image");
    const slots = slot === undefined ? t.imagePlan.map((_, i) => i) : [slot];
    for (const index of slots) {
      if (!Number.isInteger(index) || !t.imagePlan[index]) bad("图片位置无效");
      if (
        existing.some(
          (j) =>
            j.slot === index &&
            !["failed", "cancelled", "succeeded", "stale"].includes(j.status),
        )
      )
        bad("该图片已有任务");
    }
    const current = this.beginGeneration(id, t);
    return slots.map((index) =>
      this.store.add("jobs", {
        kind: "image",
        noteId: id,
        slot: index,
        prompt: t.imagePlan[index].prompt,
        model: this.settings().imageModel,
        expectedRevision: current.revision,
        planHash: snapshot(t),
        status: "queued",
        taskId: null,
        cost: null,
      }),
    );
  }
  retryJob(id) {
    const j = this.store.get("jobs", id);
    if (j.status !== "failed" || j.abandonedAt)
      bad("只允许显式重试未放弃的失败任务；未知结果不可重试");
    if (j.kind === "image") return this.enqueueImages(j.noteId, j.slot);
    const original = this.store.get("notes", j.noteId);
    const n = this.beginGeneration(
      j.noteId,
      this.store.get("topics", original.topicId),
    );
    return this.store.add("jobs", {
      kind: "text",
      noteId: n.id,
      expectedRevision: n.revision,
      planHash: snapshot(this.store.get("topics", n.topicId)),
      status: "queued",
      cost: null,
    });
  }
  abandonJob(id, { reason }) {
    const job = this.store.get("jobs", id);
    if (!["unknown", "stale", "failed"].includes(job.status) || job.abandonedAt)
      bad("只能显式放弃未知、过期或失败任务");
    required(reason, "放弃依据");
    const result = this.store.save("jobs", {
      ...job,
      abandonedAt: now(),
      abandonedFromStatus: job.status,
      abandonment: {
        reason,
        status: job.status,
        cost: job.cost ?? null,
        error: job.error ?? null,
        taskId: job.taskId ?? null,
      },
    });
    this.store.event("job.abandoned", {
      id,
      noteId: job.noteId,
      reason,
      previousStatus: job.status,
      cost: job.cost ?? null,
    });
    return result;
  }
  async tick() {
    if (this.busy || this.closing) return;
    const j = this.store
      .list("jobs")
      .find(
        (j) =>
          ["queued", "submitted", "processing"].includes(j.status) ||
          (j.abandonedAt &&
            j.taskId &&
            !j.assetUrl &&
            !j.finishedAt &&
            ["unknown", "stale"].includes(j.status)),
      );
    if (!j) return;
    this.busy = true;
    this.jobPromise = this.runJob(j);
    try {
      await this.jobPromise;
    } finally {
      this.busy = false;
      this.jobPromise = null;
    }
  }
  async close() {
    this.closing = true;
    if (this.jobPromise) await this.jobPromise;
  }
  async runJob(job) {
    const s = this.store;
    let j = s.get("jobs", job.id);
    try {
      const n = s.get("notes", j.noteId),
        p = s.get("products", n.productId),
        t = s.get("topics", n.topicId);
      if (
        !j.taskId &&
        (n.revision !== j.expectedRevision ||
          snapshot(t) !== j.planHash ||
          !t.confirmed)
      ) {
        s.save("jobs", {
          ...j,
          status: "stale",
          error: "笔记已修改，任务不再写入",
        });
        return;
      }
      if (j.kind === "text") {
        j = s.save("jobs", { ...j, status: "writing" });
        const result = await this.llm(
          "只使用提供的商品事实和证据，写小红书草稿。禁止捏造亲身使用、购买经历、材质、疗效、性能、销量、评价或测试。事实不全就明确缺失。返回 JSON {title,body}。",
          {
            product: p,
            topic: t,
            evidence: s
              .list("evidence")
              .filter((e) => t.evidenceIds?.includes(e.id)),
          },
        );
        required(result.title, "标题");
        required(result.body, "正文");
        j = s.get("jobs", j.id);
        const current = s.get("notes", n.id);
        if (
          current.revision !== j.expectedRevision ||
          snapshot(s.get("topics", n.topicId)) !== j.planHash
        ) {
          s.save("jobs", { ...j, status: "stale" });
          return;
        }
        s.editNote(n.id, { title: result.title, body: result.body });
        const updated = s.get("notes", n.id);
        s.save("notes", {
          ...updated,
          provenance: "llm-fact-constrained-draft",
        });
        for (const other of s
          .list("jobs")
          .filter(
            (v) =>
              v.noteId === n.id &&
              v.status === "queued" &&
              v.expectedRevision === j.expectedRevision,
          ))
          s.save("jobs", { ...other, expectedRevision: updated.revision });
        s.save("jobs", { ...j, status: "succeeded", finishedAt: now() });
        return;
      }
      if (!this.env.GRSAI_BASE_URL || !this.env.GRSAI_API_KEY)
        bad("GRSai 未配置");
      const base = this.env.GRSAI_BASE_URL.replace(/\/$/, ""),
        headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.GRSAI_API_KEY}`,
        };
      if (!j.taskId) {
        const images = p.images.map((url) => this.assets.dataURL(url));
        j = s.save("jobs", { ...j, status: "submitting" });
        const result = await this.json(`${base}/v1/api/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: j.model,
            prompt: j.prompt,
            images,
            aspectRatio: "3:4",
            replyType: "async",
          }),
        });
        j = s.get("jobs", j.id);
        const taskId = result.id || result.data?.id;
        if (!taskId) {
          s.save("jobs", {
            ...j,
            status: "unknown",
            error: "提交响应缺少任务 ID，禁止自动重试",
          });
          return;
        }
        s.save("jobs", { ...j, taskId: String(taskId), status: "submitted" });
        return;
      }
      const raw = await this.json(
        `${base}/v1/api/result?id=${encodeURIComponent(j.taskId)}`,
        { headers },
      );
      // A sibling retry may advance this job's expected revision while polling.
      // Refresh before any write, including a still-processing response.
      j = s.get("jobs", j.id);
      const result = raw.data || raw;
      if (
        ["queued", "running", "pending", "processing", "submitted"].includes(
          result.status,
        )
      ) {
        s.save("jobs", {
          ...j,
          status: "processing",
          progress:
            typeof result.progress === "number" ? result.progress : null,
        });
        return;
      }
      if (["failed", "violation", "cancelled"].includes(result.status)) {
        s.save("jobs", {
          ...j,
          status: "failed",
          error: `图片任务${result.status}`,
          finishedAt: now(),
        });
        return;
      }
      if (result.status !== "succeeded" || !result.results?.[0]?.url)
        bad("图片结果格式无效");
      const asset = await this.download(result.results[0].url);
      j = s.get("jobs", j.id);
      const current = s.get("notes", n.id);
      if (
        j.abandonedAt ||
        current.revision !== j.expectedRevision ||
        snapshot(s.get("topics", n.topicId)) !== j.planHash
      ) {
        s.save("jobs", {
          ...j,
          status: "stale",
          assetUrl: asset.url,
          finishedAt: now(),
        });
        return;
      }
      const generatedSlots = {
        ...(current.generatedSlots || {}),
        [j.slot]: asset.url,
      };
      const output = Object.entries(generatedSlots)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, url]) => url);
      const changed = s.editNote(n.id, { images: output });
      s.save("notes", { ...changed, generatedSlots });
      for (const other of s
        .list("jobs")
        .filter(
          (v) =>
            v.noteId === n.id &&
            ["queued", "submitted", "processing"].includes(v.status) &&
            v.expectedRevision === j.expectedRevision,
        ))
        s.save("jobs", { ...other, expectedRevision: changed.revision });
      s.save("jobs", {
        ...j,
        status: "succeeded",
        assetUrl: asset.url,
        finishedAt: now(),
      });
    } catch (e) {
      const latest = s.get("jobs", j.id);
      if (latest.taskId && ["submitted", "processing"].includes(latest.status))
        s.save("jobs", {
          ...latest,
          status: "processing",
          error: "查询或素材保存失败，已保存任务 ID，将继续查询",
        });
      else
        s.save("jobs", {
          ...latest,
          status: ["submitting", "writing"].includes(latest.status)
            ? "unknown"
            : "failed",
          error: e instanceof AppError ? e.message : "生成失败",
          finishedAt: now(),
        });
    }
  }
  async browser(fn) {
    if (this.browserBusy) bad("浏览器正在执行另一任务", "BUSY", 409);
    this.browserBusy = true;
    try {
      return await fn();
    } finally {
      this.browserBusy = false;
    }
  }
  async xhs(account, path, body) {
    if (!account.mcpUrl) bad("账号未配置外部服务", "DISCONNECTED", 503);
    this.store.validateConnection(account, account.id);
    const r = await this.json(
      `${account.mcpUrl.replace(/\/$/, "")}/api/v1/${path}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    if (r.success !== true) bad("小红书服务未完成请求", "UPSTREAM", 502);
    return r.data ?? r;
  }
  async identity(account) {
    const status = await this.xhs(account, "login/status");
    if (!status.is_logged_in) bad("账号未登录", "IDENTITY", 409);
    if (
      !account.platformUserId ||
      String(status.user_id) !== account.platformUserId
    )
      bad("登录账号与绑定用户 ID 不一致", "IDENTITY", 409);
    return status;
  }
  async publish({ schedule, note, account }) {
    if (schedule.mode === "product")
      bad("精确挂商品未验证，请导出素材手动发布", "PRODUCT_UNVERIFIED", 409);
    return this.browser(async () => {
      await this.identity(account);
      const images = note.images.map((url) => this.assets.verify(url).path);
      const result = await this.xhs(account, "publish", {
        title: note.title,
        content: note.body,
        images,
      });
      return { id: result.id || result.note_id, url: result.url };
    });
  }
  exportNote(id) {
    const n = this.store.get("notes", id);
    return {
      title: n.title,
      body: n.body,
      images: n.images.map((url) => {
        try {
          const a = this.assets.verify(url);
          return { url, hash: a.hash, filename: url.slice(8) };
        } catch {
          return { url, available: false };
        }
      }),
      mode: n.contentApproval?.mode || "normal",
      product: this.store.get("products", n.productId),
      manualRequired: n.contentApproval?.mode === "product",
      reason: n.contentApproval?.mode === "product" ? "精确挂商品未验证" : null,
    };
  }
  reconcile(id, { outcome, url, reason }) {
    const s = this.store.get("schedules", id);
    if (s.status !== "unknown") bad("只能核对结果未知的任务");
    if (!["succeeded", "failed"].includes(outcome)) bad("核对结果无效");
    required(reason, "人工核对依据");
    if (outcome === "succeeded") {
      let u;
      try {
        u = new URL(url);
      } catch {
        bad("成功核对须提供发布链接");
      }
      if (
        u.protocol !== "https:" ||
        !/(^|\.)(xiaohongshu\.com|xhslink\.com)$/.test(u.hostname)
      )
        bad("请提供小红书发布链接");
    }
    const updated = this.store.save("schedules", {
      ...s,
      status: outcome,
      result: outcome === "succeeded" ? { url } : null,
      reconciledAt: now(),
      reconciliation: { reason, url: url || null, outcome },
    });
    this.store.event("schedule.reconciled", { id, outcome, url, reason });
    return updated;
  }
  async search({ accountId, query }) {
    required(query, "检索词");
    const a = this.store.get("accounts", accountId);
    return this.browser(async () => {
      await this.identity(a);
      const data = await this.xhs(a, "feeds/search", { keyword: query });
      const feeds = Array.isArray(data) ? data : data.feeds || data.items || [];
      if (!Array.isArray(feeds)) bad("搜索结果格式无效");
      return feeds
        .filter(
          (v) => v.id && v.noteCard && (!v.modelType || v.modelType === "note"),
        )
        .map((v) => {
          const card = v.noteCard,
            metrics = card.interactInfo || {};
          return this.store.add("research", {
            category: "搜索",
            recordType: "note-signal",
            confirmedProductMatch: false,
            title: card.displayTitle || "无标题",
            candidate: null,
            url: `https://www.xiaohongshu.com/explore/${encodeURIComponent(v.id)}`,
            feedId: v.id,
            xsecToken: v.xsecToken || "",
            query,
            accountId,
            metrics: {
              likes: this.numeric(metrics.likedCount),
              comments: this.numeric(metrics.commentCount),
              collects: this.numeric(metrics.collectedCount),
            },
            sales: null,
            sampledAt: now(),
            provenance: "xiaohongshu-mcp-search",
            scope: "本次搜索样本；不代表全市场",
            raw: v,
          });
        });
    });
  }
  numeric(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "string") {
      const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([万wW千kK]?)$/);
      if (!m) return null;
      v =
        Number(m[1]) *
        (["万", "w", "W"].includes(m[2])
          ? 10000
          : ["千", "k", "K"].includes(m[2])
            ? 1000
            : 1);
    }
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  }
  importResearch({ rows, csv }) {
    if (csv !== undefined) {
      if (typeof csv !== "string") bad("CSV 无效");
      const parsed = parseCSV(csv);
      const keys = (parsed.shift() || []).map((key) =>
        key.replace(/^\uFEFF/, "").trim(),
      );
      rows = parsed
        .filter((r) => r.some(Boolean))
        .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] || ""])));
    }
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
      bad("请提供 1 到 1000 条记录");
    const valid = rows.map((r) => {
      required(r.category, "品类");
      required(r.candidate, "候选商品");
      let url;
      try {
        url = new URL(r.url);
      } catch {
        bad("来源链接无效");
      }
      if (!["http:", "https:"].includes(url.protocol)) bad("来源链接无效");
      const sampledAt = r.sampledAt || r.sampleAt;
      if (!sampledAt || !Number.isFinite(Date.parse(sampledAt)))
        bad("需要有效采样时间");
      const metrics = r.metrics || r;
      return {
        recordType: "product-evidence",
        confirmedProductMatch: true,
        category: r.category,
        candidate: r.candidate,
        url: url.href,
        metrics: {
          likes: this.numeric(metrics.likes),
          comments: this.numeric(metrics.comments),
          collects: this.numeric(metrics.collects),
        },
        sales: this.numeric(r.sales),
        sampledAt: new Date(sampledAt).toISOString(),
        provenance: "user-import",
        scope: "用户提供的样本；销量仅为来源声明，未经独立验证",
        raw: r,
      };
    });
    return valid.map((v) => this.store.add("research", v));
  }
  matchResearch(id, input) {
    const r = this.store.get("research", id);
    if (input.confirmedProductMatch !== true) bad("需要明确确认商品匹配");
    const updated = this.store.save("research", {
      ...r,
      candidate: required(input.candidate, "商品名称"),
      category: required(input.category, "品类"),
      confirmedProductMatch: true,
      matchProvenance: "user-confirmed",
      matchedAt: now(),
    });
    this.store.event("research.product-match", {
      id,
      candidate: updated.candidate,
    });
    return updated;
  }
  report() {
    const all = this.store.list("research");
    const rows = all.filter((r) => r.confirmedProductMatch);
    return {
      noteSignals: all.filter((r) => !r.confirmedProductMatch),
      scope: "仅按已采集样本比较；热度不等于销量，单次快照不能推断增长",
      groups: [...new Set(rows.map((v) => v.category))].map((category) => {
        const selected = rows.filter((v) => v.category === category);
        const candidates = [
          ...new Set(selected.map((v) => JSON.stringify([v.candidate, v.url]))),
        ].map((key) => {
          const [candidate, url] = JSON.parse(key);
          const samples = selected.filter(
            (v) => v.candidate === candidate && v.url === url,
          );
          const latest = [...samples].sort((a, b) =>
            b.sampledAt.localeCompare(a.sampledAt),
          )[0];
          const values = Object.values(latest.metrics).filter(
            (v) => v !== null,
          );
          return {
            candidate,
            heat: values.length ? values.reduce((a, b) => a + b, 0) : null,
            sales: latest.sales,
            samples: samples.length,
            latestAt: latest.sampledAt,
            provenance: latest.provenance,
            sourceUrl: latest.url,
          };
        });
        return {
          category,
          heatRanking: candidates
            .filter((v) => v.heat !== null)
            .sort((a, b) => b.heat - a.heat),
          salesRanking: candidates
            .filter((v) => v.sales !== null)
            .sort((a, b) => b.sales - a.sales),
          unknown: candidates.filter(
            (v) => v.heat === null && v.sales === null,
          ),
        };
      }),
    };
  }
  suggestions({ accountId, noteIds, days = 7 }) {
    const a = this.store.get("accounts", accountId);
    if (
      !Array.isArray(noteIds) ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 30
    )
      bad("排期建议参数无效");
    const notes = noteIds.map((id) => this.store.get("notes", id));
    if (notes.some((n) => n.accountId !== accountId)) bad("笔记账号不匹配");
    const queue = this.store
      .list("schedules")
      .filter(
        (s) =>
          s.accountId === accountId &&
          ["pending", "authorized", "running", "unknown", "succeeded"].includes(
            s.status,
          ),
      );
    const slots = [];
    for (let day = 0; day < days && slots.length < notes.length; day++) {
      const date = new Date(Date.now() + day * 86400000 + 8 * 3600000)
        .toISOString()
        .slice(0, 10);
      let count = queue.filter(
        (s) =>
          new Date(Date.parse(s.scheduledAt) + 8 * 3600000)
            .toISOString()
            .slice(0, 10) === date,
      ).length;
      for (const time of a.dailySlots?.length
        ? a.dailySlots
        : this.settings().dailySlots) {
        const at = Date.parse(`${date}T${time}:00+08:00`);
        if (
          at <= Date.now() ||
          count >= a.dailyLimit ||
          queue.some((s) => Math.abs(Date.parse(s.scheduledAt) - at) < 60000)
        )
          continue;
        slots.push({
          noteId: notes[slots.length]?.id,
          accountId,
          scheduledAt: new Date(at).toISOString(),
        });
        count++;
        if (slots.length === notes.length) break;
      }
    }
    return {
      suggestions: slots,
      unscheduled: notes.length - slots.length,
      timezone: "Asia/Shanghai",
    };
  }
}

function parseCSV(text) {
  const rows = [],
    row = [];
  let value = "",
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quote = !quote;
    } else if (c === "," && !quote) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quote) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push([...row]);
      row.length = 0;
      value = "";
    } else value += c;
  }
  if (quote) bad("CSV 引号未闭合");
  row.push(value);
  rows.push(row);
  return rows;
}
