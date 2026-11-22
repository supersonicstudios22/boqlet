import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proxyApi } from "./proxy";

/**
 * TF-183: the dev proxy of `/api/v1` (next dev, the browser smoke). An API that can't be reached is a
 * `503 {"code":"api_unavailable"}` the app understands, not a bare text 500; everything else passes through.
 */

let server: Server;
let target: string;
const seen: { method?: string; url?: string; host?: string; forwardedHost?: string; cookie?: string; body?: string } = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      Object.assign(seen, { method: req.method, url: req.url, host: req.headers.host, forwardedHost: req.headers["x-forwarded-host"], cookie: req.headers.cookie, body });
      res.statusCode = 201;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Set-Cookie", ["a=1; Path=/; HttpOnly", "b=2; Path=/"]);
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  target = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("TF-183 proxyApi", () => {
  it("answers 503 api_unavailable as JSON when the API can't be reached", async () => {
    // A port nothing listens on.
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));

    const res = await proxyApi(new Request("http://localhost:3000/api/v1/boqs/b1/overrides/batch", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), `http://127.0.0.1:${port}`);
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(((await res.json()) as { code: string }).code).toBe("api_unavailable");
  });

  it("forwards method, path, query, body and cookies, and passes status, body and every Set-Cookie back", async () => {
    const res = await proxyApi(
      new Request("http://localhost:3000/api/v1/boqs/b1/overrides/batch?x=1", { method: "POST", body: '{"overrides":[]}', headers: { "content-type": "application/json", cookie: "boqlet_session=s" } }),
      target,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/"]);
    expect(seen).toMatchObject({ method: "POST", url: "/api/v1/boqs/b1/overrides/batch?x=1", forwardedHost: "localhost:3000", cookie: "boqlet_session=s", body: '{"overrides":[]}' });
    expect(seen.host).toBe(new URL(target).host);
  });

  it("says the API is not configured (404) in a production build without a target", async () => {
    const res = await proxyApi(new Request("http://localhost:3000/api/v1/me"), null);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("not_found");
  });
});
