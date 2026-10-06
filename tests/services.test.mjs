import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppStore } from "../server/store.mjs";
import * as services from "../server/services.mjs";
test("immutable assets validate signatures and detect changed bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "red-assets-"));
  try {
    const a = new services.Assets(dir);
    assert.throws(() =>
      a.upload({ base64: Buffer.from("fake").toString("base64") }),
    );
    const saved = a.upload({
      base64: Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
        "hex",
      ).toString("base64"),
    });
    assert.match(saved.url, /^\/assets\/[a-f0-9]{64}\.png$/);
    assert.equal(a.verify(saved.url).hash, saved.hash);
    writeFileSync(a.path(saved.url), "changed");
    assert.throws(() => a.verify(saved.url));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("settings reject secrets, persist bounded values and plan edits invalidate confirmation", async () => {
  const s = new AppStore();
  const dir = mkdtempSync(join(tmpdir(), "red-service-"));
  try {
    const service = new services.Services(s, { assetsDir: dir, env: {} });
    assert.equal(service.settings().topicCount, 6);
    assert.throws(() => service.settings({ apiKey: "secret" }));
    assert.throws(() => service.settings({ maxImages: 99 }));
    const p = s.createProduct({ name: "p" }),
      a = s.createAccount({ name: "a" }),
      b = s.createBatch({ productId: p.id, accountId: a.id });
    const [t] = s.addTopics(b.id, { titles: ["title"] });
    assert.throws(() => service.confirmTopic(t.id));
    service.editTopic(t.id, {
      imagePlan: [{ role: "cover", prompt: "product photo" }],
    });
    service.confirmTopic(t.id);
    assert.equal(
      service.editTopic(t.id, { title: "changed" }).confirmed,
      false,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("GRSai preserves submitted task id and downloads finished image without resubmitting", async () => {
  const s = new AppStore(),
    dir = mkdtempSync(join(tmpdir(), "red-job-"));
  let submits = 0;
  const bytes = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
    "hex",
  );
  const fetch = async (url, opts) => {
    if (url.endsWith("/generate")) {
      submits++;
      assert.equal(JSON.parse(opts.body).replyType, "async");
      return Response.json({ id: "remote-1", status: "queued" });
    }
    if (url.includes("/result"))
      return Response.json({
        status: "succeeded",
        results: [{ url: "https://images.example.com/output.png" }],
      });
    return new Response(bytes);
  };
  try {
    const service = new services.Services(s, {
      assetsDir: dir,
      fetch,
      resolveHost: async () => [{ address: "93.184.216.34" }],
      env: {
        GRSAI_BASE_URL: "https://grsai.example.com",
        GRSAI_API_KEY: "key",
      },
    });
    const asset = service.assets.upload({ base64: bytes.toString("base64") });
    const p = s.createProduct({
        name: "p",
        facts: "provided fact",
        images: [asset.url],
        confirmed: true,
      }),
      a = s.createAccount({ name: "a" }),
      b = s.createBatch({ productId: p.id, accountId: a.id });
    const [t] = s.addTopics(b.id, { titles: ["title"] });
    service.editTopic(t.id, {
      imagePlan: [{ role: "cover", prompt: "photo" }],
    });
    service.confirmTopic(t.id);
    const [note] = await service.generate(b.id, {
      provider: "manual",
      textProvider: "manual",
    });
    service.enqueueImages(note.id);
    await service.tick();
    assert.equal(s.list("jobs")[0].taskId, "remote-1");
    await service.tick();
    assert.equal(submits, 1);
    assert.equal(s.list("jobs")[0].status, "succeeded");
    assert.match(s.get("notes", note.id).images[0], /^\/assets\//);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
