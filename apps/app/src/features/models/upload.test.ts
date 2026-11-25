import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({ api: {} }));

import type { Schemas } from "@ifc-boq/api";
import { planParts, sendModelUpload, UploadInterrupted, type PutAnswer, type UploadSession } from "./upload";

const MIB = 1024 * 1024;
const PART = 16 * MIB;
const later = () => new Date(Date.now() + 3_600_000).toISOString();

function multipart(size: number, tag = "a"): Schemas["UploadInstructions"] {
  const parts = Array.from({ length: Math.ceil(size / PART) }, (_, i) => ({ partNumber: i + 1, url: `https://s3/${tag}/part/${i + 1}` }));
  return { method: "PUT", url: parts[0]!.url, expiresAt: later(), partSizeBytes: PART, parts };
}

/** A file of `size` bytes without allocating them all: one byte repeated (Blob slices stay lazy). */
const fileOf = (size: number, name = "big.ifc") => new File([new Uint8Array(size)], name);

const session = (file: File, instructions: Schemas["UploadInstructions"]): UploadSession => ({ versionId: "v1", file, instructions, sent: new Map() });

/** A fake storage: answers each PUT from `script` (by URL, in order), else 200 with an ETag naming the URL. */
function storage(script: Record<string, PutAnswer[]> = {}) {
  const calls: { url: string; bytes: number }[] = [];
  const put = vi.fn(async (url: string, _h: Record<string, string>, body: Blob, onProgress: (n: number) => void) => {
    calls.push({ url, bytes: body.size });
    const answer = script[url]?.shift() ?? { status: 200, etag: `"etag-${url.split("/").pop()}"` };
    if (answer.status === 200) onProgress(body.size);
    return answer;
  });
  return { put, calls };
}

const quick = { wait: async () => {} };

describe("planParts", () => {
  it("slices a 101 MiB file into 16 MiB parts, the last one short", () => {
    const { multipart: isMultipart, parts } = planParts(101 * MIB, multipart(101 * MIB));
    expect(isMultipart).toBe(true);
    expect(parts).toHaveLength(7);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: PART });
    expect(parts[6]).toEqual({ partNumber: 7, start: 6 * PART, end: 101 * MIB });
    expect(parts.reduce((n, p) => n + p.end - p.start, 0)).toBe(101 * MIB);
  });

  it("is one PUT of the whole file without parts (under 100 MiB: unchanged)", () => {
    expect(planParts(5 * MIB, { method: "PUT", url: "https://s3/single" })).toEqual({ multipart: false, parts: [{ partNumber: 1, start: 0, end: 5 * MIB }] });
  });

  it("refuses instructions whose parts don't cover the file", () => {
    expect(() => planParts(101 * MIB, { ...multipart(101 * MIB), partSizeBytes: 8 * MIB })).toThrow();
  });
});

describe("sendModelUpload", () => {
  it("PUTs each part to its own URL and completes with every part's ETag", async () => {
    const file = fileOf(101 * MIB);
    const { put, calls } = storage();
    const complete = vi.fn(async () => ({ id: "v1" }) as Schemas["ModelVersion"]);
    const progress: number[] = [];
    await sendModelUpload(session(file, multipart(file.size)), (s) => progress.push(s), { ...quick, put, complete });
    expect(calls.map((c) => c.url).sort()).toEqual(Array.from({ length: 7 }, (_, i) => `https://s3/a/part/${i + 1}`));
    expect(calls.find((c) => c.url.endsWith("/7"))!.bytes).toBe(101 * MIB - 6 * PART);
    expect(complete).toHaveBeenCalledWith("v1", Array.from({ length: 7 }, (_, i) => ({ partNumber: i + 1, etag: `"etag-${i + 1}"` })));
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("sends a small file whole to `url` and completes without parts", async () => {
    const file = fileOf(MIB, "small.ifc");
    const { put, calls } = storage();
    const complete = vi.fn(async () => ({ id: "v1" }) as Schemas["ModelVersion"]);
    await sendModelUpload(session(file, { method: "PUT", url: "https://s3/single", expiresAt: later() }), () => {}, { ...quick, put, complete });
    expect(calls).toEqual([{ url: "https://s3/single", bytes: MIB }]);
    expect(complete).toHaveBeenCalledWith("v1", undefined);
  });

  it("retries a failing part with backoff, then succeeds", async () => {
    const file = fileOf(101 * MIB);
    const { put, calls } = storage({ "https://s3/a/part/3": [{ status: 0, etag: null }, { status: 503, etag: null }] });
    const wait = vi.fn(async () => {});
    const onRetry = vi.fn();
    const complete = vi.fn(async () => ({ id: "v1" }) as Schemas["ModelVersion"]);
    await sendModelUpload(session(file, multipart(file.size)), () => {}, { wait, put, complete, onRetry });
    expect(calls.filter((c) => c.url.endsWith("/part/3"))).toHaveLength(3);
    expect(wait.mock.calls).toEqual([[1], [2]]);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("stops after three retries; the session resumes with only the missing part", async () => {
    const file = fileOf(101 * MIB);
    const down: PutAnswer = { status: 0, etag: null };
    const { put, calls } = storage({ "https://s3/a/part/5": [down, down, down, down] });
    const complete = vi.fn(async () => ({ id: "v1" }) as Schemas["ModelVersion"]);
    const s = session(file, multipart(file.size));
    const stopped = await sendModelUpload(s, () => {}, { ...quick, put, complete }).catch((e: unknown) => e);
    expect(stopped).toBeInstanceOf(UploadInterrupted);
    expect(calls.filter((c) => c.url.endsWith("/part/5"))).toHaveLength(4);
    expect(complete).not.toHaveBeenCalled();
    expect(s.sent.has(5)).toBe(false);

    calls.length = 0;
    const progress: number[] = [];
    await sendModelUpload((stopped as UploadInterrupted).session, (p) => progress.push(p), { ...quick, put, complete });
    expect(calls.map((c) => c.url)).toEqual(["https://s3/a/part/5"]);
    expect(progress[0]).toBeCloseTo((101 * MIB - PART) / (101 * MIB));
    expect(complete).toHaveBeenCalledWith("v1", expect.arrayContaining([{ partNumber: 5, etag: '"etag-5"' }]));
  });

  it("renews expired URLs before sending and after storage refuses a signature (403)", async () => {
    const file = fileOf(101 * MIB);
    const old = { ...multipart(file.size, "old"), expiresAt: new Date(Date.now() - 1000).toISOString() };
    const renew = vi.fn(async () => multipart(file.size, "new"));
    const { put, calls } = storage({ "https://s3/new/part/2": [{ status: 403, etag: null }] });
    const complete = vi.fn(async () => ({ id: "v1" }) as Schemas["ModelVersion"]);
    await sendModelUpload(session(file, old), () => {}, { ...quick, put, complete, renew });
    expect(calls.some((c) => c.url.includes("/old/"))).toBe(false);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("refuses a part without an ETag (storage CORS must expose it) and does not retry", async () => {
    const file = fileOf(101 * MIB);
    const { put } = storage({ "https://s3/a/part/1": [{ status: 200, etag: null }] });
    const stopped = await sendModelUpload(session(file, multipart(file.size)), () => {}, { ...quick, put, complete: vi.fn() }).catch((e: unknown) => e);
    expect(stopped).toBeInstanceOf(UploadInterrupted);
    expect(((stopped as UploadInterrupted).cause as { code: string }).code).toBe("upload_etag_hidden");
  });

  it("does not retry a refusal that a retry can't fix (400)", async () => {
    const file = fileOf(MIB);
    const { put, calls } = storage({ "https://s3/single": [{ status: 400, etag: null }] });
    const stopped = await sendModelUpload(session(file, { method: "PUT", url: "https://s3/single" }), () => {}, { ...quick, put, complete: vi.fn() }).catch((e: unknown) => e);
    expect(stopped).toBeInstanceOf(UploadInterrupted);
    expect(calls).toHaveLength(1);
  });
});
