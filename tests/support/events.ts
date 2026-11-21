import { API_URL, authentication } from "./env";

export interface ReceivedEvent {
  event: string;
  data: unknown;
}

/** Listens to `GET /events` as one person and collects what arrives (conventions.md "Server-Sent Events"). */
export async function listen(token: string) {
  const controller = new AbortController();
  const res = await fetch(`${API_URL}/events`, { headers: await authentication(token), signal: controller.signal });
  if (!res.ok) throw new Error(`/events answered ${res.status}`);
  const events: ReceivedEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          // The SSE format: "field: value" or "field:value" (one leading space is dropped); data lines join.
          let event: string | undefined;
          const data: string[] = [];
          for (const line of block.split("\n")) {
            const colon = line.indexOf(":");
            if (colon <= 0) continue;
            const field = line.slice(0, colon);
            const text = line.slice(colon + 1).replace(/^ /, "");
            if (field === "event") event = text;
            else if (field === "data") data.push(text);
          }
          if (event && data.length) events.push({ event, data: JSON.parse(data.join("\n")) });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return {
    events,
    /** The first event of `name` matching `where`, waiting up to `timeoutMs`. */
    async next<T>(name: string, where: (data: T) => boolean = () => true, timeoutMs = 5_000): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = events.find((e) => e.event === name && where(e.data as T));
        if (hit) return hit.data as T;
        if (Date.now() > deadline) throw new Error(`no ${name} within ${timeoutMs} ms (got ${events.map((e) => e.event).join(", ")})`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    close: () => controller.abort(),
  };
}
