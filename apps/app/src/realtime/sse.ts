import { EventStreamContentType, fetchEventSource } from "@microsoft/fetch-event-source";
import { API_BASE_URL } from "@/config";
import type { RealtimeEvent } from "./invalidation";

/** The server's reconnect time (`retry: 1000`) after a stream that ended normally. */
const ROLLOVER_MS = 1000;
/** A stream that ends sooner than this after opening counts as a failure (backoff), so a server that closes at once is not hammered. */
const MIN_HEALTHY_MS = 10_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * One SSE connection per tab to `GET /events` (conventions.md). fetch-event-source sends the
 * auth header (EventSource can't), retries with backoff after a drop, and sends `Last-Event-ID`
 * on reconnect so the server replays what was missed. The server ends every stream after a few
 * minutes and on shutdown; the library resolves on a clean end, so `onclose` turns it into a retry
 * (TF-182). Returns a function that closes it.
 */
export function connectRealtime(opts: {
  getToken: () => Promise<string | null>;
  onEvent: (e: RealtimeEvent & { id: string }) => void;
  onStatus?: (status: "open" | "retrying" | "closed") => void;
  /** The stream was refused with 401: the error's code (e.g. `session_replaced`, F01 §10). */
  onUnauthorized?: (code: string) => void;
  /** The stream is open again after a failure (the API was unreachable or erroring): what the replay may not cover should be refetched. */
  onResume?: () => void;
}): () => void {
  const controller = new AbortController();
  let delay = 1000;
  let openedAt = 0;
  let failed = false;
  void fetchEventSource(`${API_BASE_URL}/events`, {
    signal: controller.signal,
    openWhenHidden: true,
    async fetch(input, init) {
      const token = await opts.getToken();
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
    async onopen(res) {
      if (res.ok && res.headers.get("content-type")?.startsWith(EventStreamContentType)) {
        openedAt = Date.now();
        opts.onStatus?.("open");
        if (failed) {
          failed = false;
          opts.onResume?.();
        }
        return;
      }
      // 401: the session is gone; stop and let the auth gate take over.
      if (res.status === 401) {
        const code = await res
          .json()
          .then((b: { code?: string }) => b.code ?? "unauthenticated")
          .catch(() => "unauthenticated");
        opts.onUnauthorized?.(code);
        throw new FatalError("401");
      }
      if (res.status === 403) throw new FatalError(String(res.status));
      throw new Error(`events: ${res.status}`);
    },
    onmessage(msg) {
      if (!msg.event) return;
      let data: Record<string, unknown> = {};
      try {
        data = msg.data ? (JSON.parse(msg.data) as Record<string, unknown>) : {};
      } catch {
        return;
      }
      opts.onEvent({ id: msg.id, event: msg.event, data });
    },
    onclose() {
      // The server ended the stream: reconnect (with Last-Event-ID) through onerror.
      throw new StreamEnded();
    },
    onerror(err) {
      if (err instanceof FatalError) {
        opts.onStatus?.("closed");
        throw err;
      }
      opts.onStatus?.("retrying");
      const lived = openedAt ? Date.now() - openedAt : 0;
      openedAt = 0;
      if (lived >= MIN_HEALTHY_MS) {
        // A healthy stream: its normal end reconnects at once; a drop starts the backoff afresh.
        delay = 1000;
        if (err instanceof StreamEnded) return ROLLOVER_MS;
      }
      failed = true;
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      return delay;
    },
  }).catch(() => opts.onStatus?.("closed"));
  return () => controller.abort();
}

class FatalError extends Error {}
class StreamEnded extends Error {}
