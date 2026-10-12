/** Local model routing: native Codex stays on this machine; only Web models reach Mars. */
import { createHash, randomUUID } from "node:crypto";
import { readJsonRequestBody } from "./http-body";
import { forwardNativeCodexRequest, type NativeCodexEndpoint, type NativeFetch } from "./native-passthrough";
import { HttpTurnCounter } from "./server";
import { SplitEnvironmentReplay } from "./split-router-environment";

const HOP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length",
]);
type Row = Record<string, unknown>;

function cleanHeaders(source: Headers, response = false): Headers {
  const headers = new Headers(source);
  for (const name of headers.keys()) {
    if (HOP_HEADERS.has(name) || name.startsWith("cf-") || name.startsWith("x-forwarded-")
      || name === "cookie" || name === "set-cookie" || (response && name === "content-encoding")) {
      headers.delete(name);
    }
  }
  return headers;
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { type: "routing_error", message } }, { status });
}

export function mergeSplitCatalog(native: unknown, web: unknown): Row {
  const rows = (catalog: unknown): Row[] => {
    if (!catalog || typeof catalog !== "object" || !Array.isArray((catalog as Row).models)) {
      throw new Error("Invalid model catalog");
    }
    return (catalog as { models: unknown[] }).models.filter((row): row is Row => (
      !!row && typeof row === "object" && typeof (row as Row).slug === "string"
    ));
  };
  const nativeRows = rows(native).filter(row => !(row.slug as string).startsWith("chatgpt-web/"));
  const webRows = rows(web).filter(row => (row.slug as string).startsWith("chatgpt-web/"));
  return { ...(native as Row), models: [...nativeRows, ...webRows] };
}

export function createSplitRouter(options: {
  marsBase?: string;
  fetchNative?: NativeFetch;
  fetchMars?: NativeFetch;
  log?: (record: Row) => void;
} = {}) {
  const marsBase = options.marsBase ?? process.env.CODEX_SPLIT_WEB_BASE_URL ?? "http://127.0.0.1:17841";
  const fetchNative = options.fetchNative ?? (request => fetch(request));
  const fetchMars = options.fetchMars ?? (request => fetch(request));
  const sink = options.log ?? (record => console.info(JSON.stringify(record)));
  // Timestamp the observation, not the request payload. Persistent router faults
  // must correlate with native turns without exposing tokens or replaying calls.
  const log = (record: Row) => sink({ ...record, observedAt: new Date().toISOString() });
  const turns = new HttpTurnCounter();
  const environments = new SplitEnvironmentReplay();
  const counters = { official: 0, ccw: 0, catalogs: 0 };
  let lastWebCatalog: unknown;

  async function mars(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upstream = await fetchMars(new Request(`${marsBase}${url.pathname}${url.search}`, {
      method: request.method,
      headers: cleanHeaders(request.headers),
      ...(request.method === "POST" ? { body: await request.arrayBuffer() } : {}),
      signal: request.signal,
      redirect: "manual",
    }));
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: cleanHeaders(upstream.headers, true),
    });
  }

  async function catalog(request: Request): Promise<Response> {
    const metadataSignal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const metadataRequest = new Request(request, { signal: metadataSignal });
    // Official discovery happens locally. Mars contributes only its Web-model rows.
    const results = await Promise.allSettled([
      forwardNativeCodexRequest(metadataRequest.clone(), "models", fetchNative),
      mars(metadataRequest.clone()),
    ]);
    const nativeResult = results[0]!;
    const webResult = results[1]!;
    let web = lastWebCatalog;
    if (webResult.status === "fulfilled" && webResult.value.ok) {
      try {
        const candidate = await webResult.value.json();
        mergeSplitCatalog({ models: [] }, candidate);
        lastWebCatalog = web = candidate;
      } catch { log({ event: "web_catalog_invalid" }); }
    } else {
      if (webResult.status === "fulfilled") await webResult.value.body?.cancel();
      log({ event: "web_catalog_unavailable", cached: web !== undefined });
    }
    if (nativeResult.status === "rejected") return errorResponse(502, "Official model discovery is unavailable");
    const nativeResponse = nativeResult.value;
    if (!nativeResponse.ok) return nativeResponse;
    const merged = mergeSplitCatalog(await nativeResponse.json(), web ?? { models: [] });
    counters.catalogs++;
    const body = JSON.stringify(merged);
    return new Response(body, { headers: {
      "content-type": "application/json",
      etag: `W/"${createHash("sha256").update(body).digest("hex")}"`,
      "cache-control": "no-cache",
    } });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requestId = randomUUID();
    const started = performance.now();
    let routeStage = "request";
    let selectedRoute = "unknown";
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "codex-split-router", counters, active: turns.count() });
    }
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || authorization.length <= 7) {
      return errorResponse(401, "Bearer authorization required");
    }
    if (request.method === "GET" && url.pathname === "/v1/responses") {
      return errorResponse(426, "Use HTTP Responses streaming on this model route");
    }
    try {
      if (request.method === "GET" && url.pathname === "/v1/models") {
        routeStage = "catalog";
        return await catalog(request);
      }
      const endpoint = url.pathname.replace(/^\/v1\//, "") as NativeCodexEndpoint;
      if (request.method !== "POST" || ![
        "responses", "responses/compact", "alpha/search", "images/generations", "images/edits",
      ].includes(endpoint)) return errorResponse(404, "Unknown endpoint");

      return await turns.track(async signal => {
        const incoming = new Request(request, { headers: cleanHeaders(request.headers), signal });
        let decoded: unknown;
        let model: string | undefined;
        if (endpoint === "responses" || endpoint === "responses/compact") {
          decoded = await readJsonRequestBody(incoming.clone());
          if (decoded && typeof decoded === "object") model = (decoded as { model?: string }).model;
          if (typeof model !== "string" || !model) return errorResponse(400, "A model is required");
        }
        const route = model?.startsWith("chatgpt-web/") ? "ccw" : "official";
        selectedRoute = route;
        counters[route]++;
        log({ event: "model_route", requestId, route, endpoint, model });
        if (endpoint === "responses" && decoded) {
          routeStage = "environment";
          const prepared = environments.prepare(decoded, route === "ccw");
          if (route === "ccw" && prepared !== decoded) {
            const headers = new Headers(incoming.headers);
            headers.delete("content-encoding");
            routeStage = "upstream";
            return await mars(new Request(incoming, { headers, body: JSON.stringify(prepared) }));
          }
        }
        routeStage = "upstream";
        if (route === "ccw") return await mars(incoming);
        const native = await forwardNativeCodexRequest(incoming, endpoint, fetchNative, decoded);
        return new Response(native.body, { status: native.status, statusText: native.statusText,
          headers: cleanHeaders(native.headers, true) });
      }, request.signal, process.platform, endpoint === "responses/compact" ? "compact"
        : endpoint === "alpha/search" ? "search" : endpoint as "responses" | "images/generations" | "images/edits");
    } catch (error) {
      // Never log request bodies, bearer tokens, or exceptions containing request headers.
      const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : "unknown";
      const details = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } : {};
      log({ event: "route_failed", requestId, elapsedMs: Math.round(performance.now() - started),
        endpoint: url.pathname, route: selectedRoute, stage: routeStage,
        errorName: safe(details.name), errorCode: safe(details.code ?? details.cause?.code),
        clientAborted: request.signal.aborted });
      return errorResponse(502, "Model upstream transport failed");
    }
  }
  return { handle, counters, active: () => turns.count() };
}

if (import.meta.main) {
  const router = createSplitRouter();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 17843,
    idleTimeout: 0,
    maxRequestBodySize: 64 * 1024 * 1024,
    fetch: request => router.handle(request),
  });
  console.info(JSON.stringify({ event: "listening", host: server.hostname, port: server.port }));
  process.on("SIGTERM", () => { server.stop(true); process.exit(0); });
}
