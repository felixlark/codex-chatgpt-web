import { expect, test } from "bun:test";
import { createSplitRouter, mergeSplitCatalog } from "../src/split-router";

const request = (model: string) => new Request("http://127.0.0.1:17843/v1/responses", {
  method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
  body: JSON.stringify({ model, input: [] }),
});

test("concurrent failures correlate to their own route without replaying requests", async () => {
  const logs: Record<string, unknown>[] = [];
  let calls = 0;
  const fail = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 2));
    throw Object.assign(new TypeError("private"), { code: "ENOTFOUND" });
  };
  const router = createSplitRouter({ log: row => logs.push(row), fetchNative: fail, fetchMars: fail });
  const responses = await Promise.all([
    router.handle(request("gpt-6.1-sol")), router.handle(request("chatgpt-web/gpt-5.6-sol")),
  ]);
  expect(responses.map(response => response.status)).toEqual([502, 502]);
  expect(calls).toBe(2);
  const routes = logs.filter(row => row.event === "model_route");
  expect(new Set(routes.map(row => row.requestId)).size).toBe(2);
  for (const failure of logs.filter(row => row.event === "route_failed")) {
    const route = routes.find(row => row.requestId === failure.requestId)!;
    expect(route).toBeDefined();
    expect(failure.route).toBe(route.route);
    expect(failure.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(failure.errorCode).toBe("ENOTFOUND");
  }
  expect(router.active()).toBe(0);
  expect(JSON.stringify(logs)).not.toContain("private");
});

test("upstream failure records bounded transport evidence without replay or secret messages", async () => {
  const logs: Record<string, unknown>[] = [];
  let calls = 0;
  const router = createSplitRouter({ log: row => logs.push(row), fetchMars: async () => {
    calls++;
    throw Object.assign(new Error("Bearer secret https://user:password@example.test"), {
      cause: { code: "ECONNRESET" },
    });
  } });
  expect((await router.handle(request("chatgpt-web/gpt-5.6-sol"))).status).toBe(502);
  expect(calls).toBe(1);
  expect(router.active()).toBe(0);
  expect(logs.at(-1)).toMatchObject({ event: "route_failed", endpoint: "/v1/responses", route: "ccw",
    stage: "upstream", errorName: "Error", errorCode: "ECONNRESET", clientAborted: false });
  expect(logs.at(-1)?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(JSON.stringify(logs)).not.toContain("secret");
  expect(JSON.stringify(logs)).not.toContain("password");
});

test("official certificate rejection remains a single failed call with timestamped safe evidence", async () => {
  const logs: Record<string, unknown>[] = [];
  let calls = 0;
  const router = createSplitRouter({ log: row => logs.push(row), fetchNative: async () => {
    calls++;
    throw Object.assign(new TypeError("credential-bearing TLS detail must stay private"), {
      code: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
    });
  } });
  expect((await router.handle(request("gpt-6.1-sol"))).status).toBe(502);
  expect(calls).toBe(1);
  expect(router.active()).toBe(0);
  expect(logs.at(-1)).toMatchObject({ event: "route_failed", route: "official", stage: "upstream",
    errorCode: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR", clientAborted: false });
  expect(Number.isFinite(Date.parse(String(logs.at(-1)?.observedAt)))).toBe(true);
  expect(JSON.stringify(logs)).not.toContain("credential-bearing");
});

test("official and CCW requests use disjoint upstreams and preserve streaming", async () => {
  const seen: string[] = [];
  const router = createSplitRouter({
    marsBase: "https://web.example.test",
    log: () => {},
    fetchNative: async req => { seen.push(req.url); return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }); },
    fetchMars: async req => { seen.push(req.url); expect((await req.json() as { model: string }).model).toBe("chatgpt-web/high"); return new Response("ccw"); },
  });
  expect(await (await router.handle(request("gpt-6-astra"))).text()).toBe("data: [DONE]\n\n");
  expect(await (await router.handle(request("chatgpt-web/high"))).text()).toBe("ccw");
  expect(seen).toEqual(["https://chatgpt.com/backend-api/codex/responses", "https://web.example.test/v1/responses"]);
  expect(router.active()).toBe(0);
});

test("Mars cannot replace official catalog metadata", () => {
  const merged = mergeSplitCatalog({ models: [{ slug: "gpt-6-astra", marker: "official" }] }, {
    models: [{ slug: "gpt-6-astra", marker: "mars" }, { slug: "chatgpt-web/high" }],
  });
  expect(merged.models).toEqual([{ slug: "gpt-6-astra", marker: "official" }, { slug: "chatgpt-web/high" }]);
});

test("compressed CCW and compaction requests remain on Mars", async () => {
  let sent = 0;
  const router = createSplitRouter({ log: () => {}, fetchNative: async () => { throw new Error("wrong route"); }, fetchMars: async req => {
    sent++; expect(req.headers.get("content-encoding")).toBe("zstd");
    expect(req.headers.get("cf-access-client-secret")).toBeNull();
    expect(JSON.parse(new TextDecoder().decode(await Bun.zstdDecompress(new Uint8Array(await req.arrayBuffer())))).model).toBe("chatgpt-web/high");
    return new Response("ok");
  } });
  for (const endpoint of ["responses", "responses/compact"]) {
    const req = new Request(`http://127.0.0.1:17843/v1/${endpoint}`, {
      method: "POST", headers: { authorization: "Bearer test", "content-encoding": "zstd", "cf-access-client-secret": "do-not-forward" },
      body: new Uint8Array(await Bun.zstdCompress(new TextEncoder().encode(JSON.stringify({ model: "chatgpt-web/high", input: [] })))).buffer,
    });
    expect(await (await router.handle(req)).text()).toBe("ok");
  }
  expect(sent).toBe(2);
});

test("unauthenticated and unknown endpoints never reach either upstream", async () => {
  const fail = async () => { throw new Error("must not send"); };
  const router = createSplitRouter({ fetchNative: fail, fetchMars: fail });
  expect((await router.handle(new Request("http://localhost/v1/models"))).status).toBe(401);
  expect((await router.handle(new Request("http://localhost/v1/other", { headers: { authorization: "Bearer test" } }))).status).toBe(404);
});

test("client cancellation reaches official inference without replay", async () => {
  const abort = new AbortController();
  let upstreamSignal: AbortSignal | undefined;
  let calls = 0;
  const router = createSplitRouter({ log: () => {}, fetchNative: async req => {
    calls++; upstreamSignal = req.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: progress\n\n")); } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const response = await router.handle(new Request(request("gpt-6-astra"), { signal: abort.signal }));
  const reader = response.body!.getReader();
  await reader.read(); abort.abort(); await reader.read();
  expect(upstreamSignal?.aborted).toBe(true); expect(calls).toBe(1); expect(router.active()).toBe(0);
});

test("catalog refresh keeps native discovery local and retains Web rows through a Mars outage", async () => {
  let marsOnline = true;
  const nativeUrls: string[] = [];
  const router = createSplitRouter({ log: () => {},
    fetchNative: async req => { nativeUrls.push(req.url); return Response.json({ models: [{ slug: "gpt-6-astra" }] }); },
    fetchMars: async () => {
      if (!marsOnline) return new Response("offline", { status: 503 });
      return Response.json({ models: [{ slug: "gpt-6-astra", marker: "wrong-source" }, { slug: "chatgpt-web/high" }] });
    },
  });
  const req = () => new Request("http://localhost/v1/models?client_version=0.159.2", { headers: { authorization: "Bearer test" } });
  const first = await (await router.handle(req())).json();
  marsOnline = false;
  expect(await (await router.handle(req())).json()).toEqual(first);
  expect((first as { models: unknown[] }).models).toEqual([{ slug: "gpt-6-astra" }, { slug: "chatgpt-web/high" }]);
  expect(nativeUrls).toEqual(Array(2).fill("https://chatgpt.com/backend-api/codex/models?client_version=0.159.2"));
});
