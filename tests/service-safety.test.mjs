import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppStore } from "../server/store.mjs";
import { Services } from "../server/services.mjs";
import * as lock from "../server/lock.mjs";
const bytes = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex",
);
function setup(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "red-safety-"));
  const s = new AppStore();
  const service = new Services(s, { assetsDir: dir, env: {}, ...opts });
  const asset = service.assets.save(bytes),
    p = s.createProduct({
      name: "p",
      facts: "fact",
      images: [asset.url],
      confirmed: true,
    }),
    a = s.createAccount({
      name: "a",
      mcpUrl: "http://127.0.0.1:18060",
      platformUserId: "u1",
    }),
    b = s.createBatch({ productId: p.id, accountId: a.id });
  const [t] = s.addTopics(b.id, { titles: ["title"] });
  service.editTopic(t.id, { imagePlan: [{ role: "cover", prompt: "image" }] });
  service.confirmTopic(t.id);
  return {
    s,
    service,
    a,
    b,
    t,
    cleanup() {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("approval cannot race queued image jobs and plan edits make jobs stale", async () => {
  const x = setup();
  try {
    const [n] = await x.service.generate(x.b.id, {
      provider: "manual",
      textProvider: "manual",
    });
    x.service.enqueueImages(n.id);
    assert.throws(() => x.s.approveNote(n.id), /生成/);
    x.service.editTopic(x.t.id, { title: "new plan" });
    await x.service.tick();
    assert.equal(x.s.list("jobs")[0].status, "stale");
  } finally {
    x.cleanup();
  }
});
test("known tasks still recover assets after edits without mutating the note", async () => {
  let resolveRequest;
  const x = setup({
    env: { GRSAI_BASE_URL: "https://grsai.example", GRSAI_API_KEY: "key" },
    resolveHost: async () => [{ address: "93.184.216.34" }],
    fetch: (url) =>
      url.endsWith("/generate")
        ? new Promise((r) => (resolveRequest = r))
        : Promise.resolve(
            url.includes("/v1/api/result?")
              ? Response.json({
                  status: "succeeded",
                  results: [{ url: "https://images.example.com/result.png" }],
                })
              : new Response(bytes),
          ),
  });
  try {
    const [n] = await x.service.generate(x.b.id, {
      provider: "manual",
      textProvider: "manual",
    });
    x.service.enqueueImages(n.id);
    const tick = x.service.tick();
    await new Promise((r) => setImmediate(r));
    x.s.editNote(n.id, { body: "human edit" });
    resolveRequest(Response.json({ id: "remote" }));
    await tick;
    await x.service.tick();
    assert.equal(x.s.get("notes", n.id).body, "human edit");
    assert.equal(x.s.list("jobs")[0].status, "stale");
    assert.match(x.s.list("jobs")[0].assetUrl, /^\/assets\//);
    assert.throws(() => x.service.retryJob(x.s.list("jobs")[0].id));
  } finally {
    x.cleanup();
  }
});
test("identity mismatch stops interaction before write, mutations invalidate approval", async () => {
  let writes = 0;
  const x = setup({
    fetch: async (url, opts) => {
      if (opts?.method === "POST") writes++;
      return Response.json({
        success: true,
        data: { is_logged_in: true, user_id: "wrong" },
      });
    },
  });
  try {
    const i = x.service.createInteraction({
      accountId: x.a.id,
      kind: "like",
      targetUrl: "https://www.xiaohongshu.com/explore/n1",
      feedId: "n1",
      xsecToken: "token",
      reason: "related topic",
    });
    x.service.approveInteraction(i.id);
    await assert.rejects(() => x.service.executeInteraction(i.id), /不一致/);
    assert.equal(writes, 0);
    x.service.editInteraction(i.id, { reason: "changed" });
    await assert.rejects(() => x.service.executeInteraction(i.id), /未批准/);
  } finally {
    x.cleanup();
  }
});
test("single instance lock refuses an active owner and releases cleanly", () => {
  const dir = mkdtempSync(join(tmpdir(), "red-lock-"));
  try {
    const release = lock.acquireLock(join(dir, "db"));
    assert.throws(() => lock.acquireLock(join(dir, "db")), /运行/);
    release();
    lock.acquireLock(join(dir, "db"))();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("research preserves unknown and separates sales from heat", () => {
  const x = setup();
  try {
    x.service.importResearch({
      rows: [
        {
          category: "c",
          candidate: "p",
          url: "https://example.com",
          sampledAt: "2026-10-06",
          likes: "1.2万",
        },
        {
          category: "c",
          candidate: "q",
          url: "https://example.com",
          sampledAt: "2026-10-06",
          sales: "20",
        },
      ],
    });
    const g = x.service.report().groups[0];
    assert.equal(g.heatRanking[0].heat, 12000);
    assert.equal(g.heatRanking[0].sales, null);
    assert.equal(g.salesRanking[0].candidate, "q");
  } finally {
    x.cleanup();
  }
});

test("abandon preserves unknown charge evidence, unlocks manual approval and never retries", async () => {
  let calls = 0;
  const x = setup({
    fetch: async () => {
      calls++;
      throw new Error("must not call");
    },
  });
  try {
    const [note] = await x.service.generate(x.b.id, {
      provider: "manual",
      textProvider: "manual",
    });
    const job = x.s.add("jobs", {
      kind: "image",
      noteId: note.id,
      status: "unknown",
      cost: null,
      error: "submission interrupted",
    });
    assert.throws(() => x.s.approveNote(note.id), /生成/);
    const abandoned = x.service.abandonJob(job.id, {
      reason: "人工确认不再使用本次结果，已上传替代图片",
    });
    assert.equal(abandoned.status, "unknown");
    assert.equal(abandoned.cost, null);
    assert.equal(abandoned.error, "submission interrupted");
    assert.ok(abandoned.abandonedAt);
    x.s.editNote(note.id, { images: [x.service.assets.save(bytes).url] });
    assert.equal(x.s.approveNote(note.id).approvedRevision, 2);
    await x.service.tick();
    assert.equal(calls, 0);
    assert.throws(() => x.service.retryJob(job.id));
    assert.ok(x.s.list("events").some((e) => e.type === "job.abandoned"));
    const active = x.s.add("jobs", {
      kind: "image",
      noteId: note.id,
      status: "submitted",
      taskId: "live",
    });
    assert.throws(() => x.service.abandonJob(active.id, { reason: "stop" }));
  } finally {
    x.cleanup();
  }
});

test("abandoned unknown task with known id polls only and does not apply its output", async () => {
  let submissions = 0;
  const x = setup({
    env: { GRSAI_BASE_URL: "https://grsai.example", GRSAI_API_KEY: "key" },
    resolveHost: async () => [{ address: "93.184.216.34" }],
    fetch: async (url) => {
      if (url.endsWith("/generate")) submissions++;
      return url.includes("/v1/api/result?")
        ? Response.json({
            status: "succeeded",
            results: [{ url: "https://images.example.com/output.png" }],
          })
        : new Response(bytes);
    },
  });
  try {
    const [note] = await x.service.generate(x.b.id, {
      provider: "manual",
      textProvider: "manual",
    });
    const [queued] = x.service.enqueueImages(note.id);
    x.s.save("jobs", { ...queued, status: "unknown", taskId: "known-task" });
    x.service.abandonJob(queued.id, { reason: "手动完成，不使用外部结果" });
    await x.service.tick();
    const finished = x.s.get("jobs", queued.id);
    assert.ok(finished.assetUrl);
    assert.ok(finished.abandonedAt);
    assert.equal(finished.abandonedFromStatus, "unknown");
    assert.equal(x.s.get("notes", note.id).revision, note.revision + 1);
    assert.equal(submissions, 0);
    const failed = x.s.add("jobs", {
      kind: "image",
      noteId: note.id,
      status: "failed",
    });
    x.service.abandonJob(failed.id, { reason: "不再使用" });
    assert.throws(() => x.service.retryJob(failed.id));
  } finally {
    x.cleanup();
  }
});

test("interaction rechecks approval after delayed identity response", async () => {
  for (const mutation of ["body", "account"]) {
    let respond,
      writes = 0;
    const x = setup({
      fetch: (url, options) => {
        if (options.method === "POST") {
          writes++;
          return Promise.resolve(Response.json({ success: true, data: {} }));
        }
        return new Promise((resolve) => (respond = resolve));
      },
    });
    try {
      const i = x.service.createInteraction({
        accountId: x.a.id,
        kind: "comment",
        targetUrl: "https://www.xiaohongshu.com/explore/n1",
        feedId: "n1",
        xsecToken: "token",
        body: "approved comment",
        reason: "relevant",
      });
      x.service.approveInteraction(i.id);
      const execution = x.service.executeInteraction(i.id);
      await new Promise((r) => setImmediate(r));
      if (mutation === "body")
        x.service.editInteraction(i.id, { body: "new comment" });
      else x.s.updateAccount(x.a.id, { platformUserId: "new-id" });
      respond(
        Response.json({
          success: true,
          data: { is_logged_in: true, user_id: "u1" },
        }),
      );
      await assert.rejects(() => execution, /批准/);
      assert.equal(writes, 0);
      assert.equal(x.s.get("interactions", i.id).status, "draft");
      if (mutation === "body")
        assert.equal(x.s.get("interactions", i.id).body, "new comment");
    } finally {
      x.cleanup();
    }
  }
});

test("single failed image retry advances untouched sibling job revisions only", async () => {
  const x = setup();
  try {
    x.service.editTopic(x.t.id, {
      imagePlan: [
        { role: "cover", prompt: "cover" },
        { role: "detail", prompt: "detail" },
        { role: "closing", prompt: "closing" },
      ],
    });
    x.service.confirmTopic(x.t.id);
    const [n] = await x.service.generate(x.b.id, {
      provider: "manual",
      textProvider: "manual",
    });
    const [first, second, third] = x.service.enqueueImages(n.id);
    x.s.save("jobs", { ...first, status: "failed" });
    x.s.save("jobs", { ...third, status: "processing", taskId: "third" });
    x.service.retryJob(first.id);
    const revision = x.s.get("notes", n.id).revision;
    assert.equal(x.s.get("jobs", second.id).expectedRevision, revision);
    assert.equal(x.s.get("jobs", third.id).expectedRevision, revision);
    x.s.editNote(n.id, { body: "human change" });
    const retry = x.s
      .list("jobs")
      .find((j) => j.slot === 0 && j.id !== first.id);
    x.s.save("jobs", { ...retry, status: "failed" });
    x.service.retryJob(retry.id);
    assert.equal(x.s.get("jobs", second.id).expectedRevision, revision);
    assert.equal(x.s.get("jobs", third.id).expectedRevision, revision);
  } finally {
    x.cleanup();
  }
});

test("in-flight sibling refreshes CAS after poll and download while preserving human edits", async () => {
  for (const delayAt of ["poll", "download"])
    for (const humanEdit of [false, true]) {
      let release;
      const x = setup({
        env: { GRSAI_BASE_URL: "https://grsai.example", GRSAI_API_KEY: "key" },
        resolveHost: async () => [{ address: "93.184.216.34" }],
        fetch: async (url) => {
          const poll = url.includes("/v1/api/result?");
          if ((poll && delayAt === "poll") || (!poll && delayAt === "download"))
            await new Promise((r) => (release = r));
          return poll
            ? Response.json({
                status: "succeeded",
                results: [{ url: "https://images.example.com/out.png" }],
              })
            : new Response(bytes);
        },
      });
      try {
        x.service.editTopic(x.t.id, {
          imagePlan: [
            { role: "cover", prompt: "cover" },
            { role: "detail", prompt: "detail" },
          ],
        });
        x.service.confirmTopic(x.t.id);
        const [n] = await x.service.generate(x.b.id, {
          provider: "manual",
          textProvider: "manual",
        });
        const [failed, sibling] = x.service.enqueueImages(n.id);
        x.s.save("jobs", { ...failed, status: "failed" });
        x.s.save("jobs", {
          ...sibling,
          status: "processing",
          taskId: "existing",
        });
        const running = x.service.tick();
        await new Promise((r) => setImmediate(r));
        x.service.retryJob(failed.id);
        if (humanEdit) x.s.editNote(n.id, { body: "human edit while polling" });
        release();
        await running;
        assert.equal(
          x.s.get("jobs", sibling.id).status,
          humanEdit ? "stale" : "succeeded",
        );
        assert.equal(x.s.get("notes", n.id).revision, n.revision + 3);
        if (humanEdit)
          assert.equal(x.s.get("notes", n.id).body, "human edit while polling");
        else assert.ok(x.s.get("notes", n.id).generatedSlots[1]);
      } finally {
        x.cleanup();
      }
    }
});

test("pending poll response cannot roll back sibling revision advancement", async () => {
  let release;
  const x = setup({
    env: { GRSAI_BASE_URL: "https://grsai.example", GRSAI_API_KEY: "key" },
    fetch: async () => {
      await new Promise((r) => (release = r));
      return Response.json({ status: "processing" });
    },
  });
  try {
    x.service.editTopic(x.t.id, {
      imagePlan: [
        { role: "cover", prompt: "cover" },
        { role: "detail", prompt: "detail" },
      ],
    });
    x.service.confirmTopic(x.t.id);
    const [n] = await x.service.generate(x.b.id, {
      provider: "manual",
      textProvider: "manual",
    });
    const [failed, sibling] = x.service.enqueueImages(n.id);
    x.s.save("jobs", { ...failed, status: "failed" });
    x.s.save("jobs", { ...sibling, status: "processing", taskId: "existing" });
    const running = x.service.tick();
    await new Promise((r) => setImmediate(r));
    x.service.retryJob(failed.id);
    release();
    await running;
    assert.equal(
      x.s.get("jobs", sibling.id).expectedRevision,
      x.s.get("notes", n.id).revision,
    );
  } finally {
    x.cleanup();
  }
});

test("account slots persist, validate and override global schedule suggestions", async () => {
  const x = setup();
  try {
    assert.throws(() =>
      x.s.createAccount({ name: "invalid", dailySlots: ["25:00"] }),
    );
    assert.throws(() =>
      x.s.updateAccount(x.a.id, { dailySlots: ["12:00", "12:00"] }),
    );
    x.service.settings({ dailySlots: ["10:15"] });
    const account = x.s.updateAccount(x.a.id, { dailySlots: ["18:25"] });
    assert.deepEqual(account.dailySlots, ["18:25"]);
    const [note] = await x.service.generate(x.b.id, {
      provider: "manual",
      textProvider: "manual",
    });
    const local = x.service.suggestions({
      accountId: x.a.id,
      noteIds: [note.id],
      days: 2,
    });
    assert.equal(
      new Date(Date.parse(local.suggestions[0].scheduledAt) + 8 * 3600000)
        .toISOString()
        .slice(11, 16),
      "18:25",
    );
    x.s.updateAccount(x.a.id, { dailySlots: [] });
    const fallback = x.service.suggestions({
      accountId: x.a.id,
      noteIds: [note.id],
      days: 2,
    });
    assert.equal(
      new Date(Date.parse(fallback.suggestions[0].scheduledAt) + 8 * 3600000)
        .toISOString()
        .slice(11, 16),
      "10:15",
    );
    assert.deepEqual(
      x.s.createAccount({ name: "custom", dailySlots: ["09:30"] }).dailySlots,
      ["09:30"],
    );
  } finally {
    x.cleanup();
  }
});

test("whole-image regeneration and text retry invalidate authorized publication before execution", async () => {
  for (const kind of ["image", "text"]) {
    const x = setup();
    try {
      const [n] = await x.service.generate(x.b.id, {
        provider: "manual",
        textProvider: "manual",
      });
      const failed =
        kind === "text"
          ? x.s.add("jobs", { kind: "text", noteId: n.id, status: "failed" })
          : null;
      x.s.approveNote(n.id);
      const schedule = x.s.createSchedule({
        noteId: n.id,
        accountId: x.a.id,
        mode: "normal",
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      });
      x.s.approveSchedule(schedule.id);
      if (kind === "image") x.service.enqueueImages(n.id);
      else x.service.retryJob(failed.id);
      assert.equal(x.s.get("notes", n.id).approvedRevision, null);
      assert.equal(x.s.get("schedules", schedule.id).status, "invalidated");
      assert.equal(x.s.claim(Date.parse(schedule.scheduledAt)), null);
    } finally {
      x.cleanup();
    }
  }
});

test("unknown or running interaction blocks publication claims for that account", async () => {
  for (const status of ["unknown", "running"]) {
    const x = setup();
    try {
      const [n] = await x.service.generate(x.b.id, {
        provider: "manual",
        textProvider: "manual",
      });
      x.s.approveNote(n.id);
      const schedule = x.s.createSchedule({
        noteId: n.id,
        accountId: x.a.id,
        mode: "normal",
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      });
      x.s.approveSchedule(schedule.id);
      x.s.add("interactions", { accountId: x.a.id, status });
      assert.equal(x.s.claim(Date.parse(schedule.scheduledAt)), null);
      assert.equal(x.s.get("schedules", schedule.id).status, "authorized");
    } finally {
      x.cleanup();
    }
  }
});
