// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectRealtime } from "./sse";

/** TF-182: the SSE client reconnects after the server ends the stream, with Last-Event-ID, and backs off while the API is down. */

const encoder = new TextEncoder();
const FIVE_MIN = 5 * 60_000;
/** An event-stream response that sends `body` and then ends cleanly after `lifeMs` (the server ends each stream after 5 minutes). */
function stream(body: string, lifeMs = 0) {
  return new Response(
    new ReadableStream({
      start(c) {
        if (body) c.enqueue(encoder.encode(body));
        if (lifeMs) setTimeout(() => c.close(), lifeMs);
        else c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
const event = (id: string) => `id: ${id}\nevent: entity.changed\ndata: {"entityType":"boq","entityId":"b${id}"}\n\n`;

type Call = { lastEventId: string | null; at: number };
let calls: Call[];
let close: (() => void) | null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  calls = [];
  close = null;
});
afterEach(() => {
  close?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function serve(respond: (n: number) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string, init: RequestInit) => {
      calls.push({ lastEventId: new Headers(init.headers).get("last-event-id"), at: Date.now() });
      return respond(calls.length);
    }),
  );
}

describe("TF-182 connectRealtime", () => {
  it("reconnects after a clean end of the stream and sends Last-Event-ID; the replayed event arrives", async () => {
    // Each stream ends cleanly after its lifetime; the reconnect gets the replay.
    serve((n) => stream(event(`4${n}`), FIVE_MIN));
    const events: string[] = [];
    const status: string[] = [];
    close = connectRealtime({ getToken: async () => null, onEvent: (e) => events.push(e.id), onStatus: (s) => status.push(s) });

    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual(["41"]);
    expect(calls).toHaveLength(1);
    // The stream ends cleanly at 5:00; the client reconnects within the server's 1 s retry.
    await vi.advanceTimersByTimeAsync(FIVE_MIN + 1_500);
    expect(calls).toHaveLength(2);
    expect(calls[1].lastEventId).toBe("41");
    expect(calls[1].at - calls[0].at).toBeLessThanOrEqual(FIVE_MIN + 1_100);
    expect(events).toEqual(["41", "42"]);
    expect(status).toEqual(["open", "retrying", "open"]);
  });

  it("backs off while the API is down", async () => {
    serve(() => {
      throw new TypeError("Failed to fetch");
    });
    close = connectRealtime({ getToken: async () => null, onEvent: () => {} });
    await vi.advanceTimersByTimeAsync(60_000);
    // 2, 4, 8, 15, 15… seconds: a handful of attempts in a minute, not sixty.
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it("does not spin on streams that end as soon as they open", async () => {
    serve(() => stream(""));
    close = connectRealtime({ getToken: async () => null, onEvent: () => {} });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it("calls onResume once the stream is back after the API was down, not after a normal rollover", async () => {
    let up = true;
    serve(() => (up ? stream("", 60_000) : new Response("down", { status: 503 })));
    const resumed: number[] = [];
    close = connectRealtime({ getToken: async () => null, onEvent: () => {}, onResume: () => resumed.push(Date.now()) });
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 2_000);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(resumed).toEqual([]);
    up = false;
    await vi.advanceTimersByTimeAsync(70_000);
    up = true;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(resumed).toHaveLength(1);
  });
});
