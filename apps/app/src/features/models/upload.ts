import type { Schemas } from "@ifc-boq/api";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { idempotencyHeaders } from "@/api/idempotency";

type Instructions = Schemas["UploadInstructions"];

/** Client-side checks before anything is sent (F03 §2.1, F03-AC6). */
export function checkFile(file: File, maxMb: number | undefined): "not_ifc" | "too_large" | null {
  if (!/\.ifc$/i.test(file.name)) return "not_ifc";
  if (maxMb !== undefined && file.size > maxMb * 1024 * 1024) return "too_large";
  return null;
}

/** One PUT of the upload: the whole file, or one part of a multipart upload (bytes `[start, end)`). */
export interface PlannedPart {
  partNumber: number;
  start: number;
  end: number;
}

/**
 * The parts to send for an upload (A-40). A file over 100 MiB comes with `parts` and `partSizeBytes`:
 * part n is bytes `[(n - 1) * partSize, n * partSize)`; anything else is one PUT of the whole file to `url`.
 */
export function planParts(size: number, instructions: Instructions): { multipart: boolean; parts: PlannedPart[] } {
  const signed = instructions.parts ?? [];
  if (signed.length === 0) return { multipart: false, parts: [{ partNumber: 1, start: 0, end: size }] };
  const partSize = instructions.partSizeBytes;
  if (!partSize || partSize <= 0 || Math.ceil(size / partSize) !== signed.length) {
    throw new ApiError(0, "upload_parts_invalid", "The upload instructions do not match the file size.");
  }
  const parts = [...signed]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map(({ partNumber }) => ({ partNumber, start: (partNumber - 1) * partSize, end: Math.min(size, partNumber * partSize) }));
  return { multipart: true, parts };
}

/** What one PUT to storage answered. `status` 0: no answer (network). */
export interface PutAnswer {
  status: number;
  etag: string | null;
}

export type PutPart = (url: string, headers: Record<string, string>, body: Blob, onProgress: (loaded: number) => void) => Promise<PutAnswer>;

/** PUT to a signed URL with upload progress (fetch has no upload progress, so XHR). Storage exposes `ETag` (CORS). */
const xhrPut: PutPart = (url, headers, body, onProgress) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, etag: xhr.getResponseHeader("ETag") });
    xhr.onerror = () => resolve({ status: 0, etag: null });
    xhr.send(body);
  });

/**
 * An upload in progress: kept by the upload button so an interrupted upload resumes where it stopped
 * (the parts already sent and their ETags stay; storage keeps them until the upload completes or 24 h pass).
 */
export interface UploadSession {
  versionId: string;
  file: File;
  instructions: Instructions;
  /** Parts storage has accepted: part number → ETag (`""` for a single PUT). */
  sent: Map<number, string>;
}

/** An upload stopped part way; `session` resumes it (`sendModelUpload`). */
export class UploadInterrupted extends Error {
  readonly session: UploadSession;
  constructor(session: UploadSession, cause: unknown) {
    super(cause instanceof Error ? cause.message : "upload interrupted", { cause });
    this.name = "UploadInterrupted";
    this.session = session;
  }
}

export interface UploadOptions {
  /** Retries per part after the first try (A-40: three, with backoff). */
  retries?: number;
  /** Parts in flight at once. */
  concurrency?: number;
  /** Waits before retry `n` (1-based); tests pass no-op waits. */
  wait?: (attempt: number) => Promise<void>;
  put?: PutPart;
  /** Renews the signed URLs once they are about to expire or storage refuses one (403). */
  renew?: (versionId: string) => Promise<Instructions>;
  complete?: (versionId: string, parts: { partNumber: number; etag: string }[] | undefined) => Promise<Schemas["ModelVersion"]>;
  now?: () => number;
  /** A part failed and is tried again (attempt 1 = the first retry): the button says it is retrying. */
  onRetry?: (attempt: number) => void;
}

const backoff = (attempt: number) => new Promise<void>((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));

const renewUpload = async (versionId: string) =>
  (await api.POST("/model-versions/{versionId}/upload", { params: { path: { versionId } } })).data!;

const completeUpload = async (versionId: string, parts: { partNumber: number; etag: string }[] | undefined) =>
  (
    await api.POST("/model-versions/{versionId}/complete", {
      params: { path: { versionId } },
      body: parts ? { parts } : {},
      headers: idempotencyHeaders(`completeModelUpload:${versionId}`),
    })
  ).data!;

/** Statuses worth another try: no answer, an expired or refused signature, throttling, storage errors. */
const retryable = (status: number) => status === 0 || status === 403 || status === 408 || status === 429 || status >= 500;

/** Register a version (F03 §2); the bytes follow with `sendModelUpload`. */
export async function startModelUpload(modelId: string, file: File, note?: string): Promise<UploadSession> {
  const created = (
    await api.POST("/models/{modelId}/versions", { params: { path: { modelId } }, body: { fileName: file.name, sizeBytes: file.size, ...(note ? { note } : {}) } })
  ).data!;
  return { versionId: created.version.id, file, instructions: created.upload, sent: new Map() };
}

/**
 * Send the parts not sent yet, straight to storage, then complete (F03 §2, A-40). Each part is retried with
 * backoff; signed URLs are renewed when they expire. A part that still fails stops the upload with
 * `UploadInterrupted`, whose session resumes it. The parse then runs in the background (SSE `job.progress`).
 */
export async function sendModelUpload(session: UploadSession, onProgress: (share: number) => void, options: UploadOptions = {}) {
  const { retries = 3, concurrency = 3, wait = backoff, put = xhrPut, renew = renewUpload, complete = completeUpload, now = Date.now, onRetry } = options;
  const { file } = session;
  const plan = planParts(file.size, session.instructions);
  const total = Math.max(1, file.size);
  const loaded = new Map<number, number>();
  for (const part of plan.parts) if (session.sent.has(part.partNumber)) loaded.set(part.partNumber, part.end - part.start);
  const report = () => onProgress(Math.min(1, [...loaded.values()].reduce((a, b) => a + b, 0) / total));
  report();

  let renewing: Promise<void> | null = null;
  const renewOnce = (stale: Instructions) => {
    if (session.instructions !== stale) return Promise.resolve();      // another part already renewed them
    renewing ??= renew(session.versionId)
      .then((fresh) => {
        session.instructions = fresh;
      })
      .finally(() => {
        renewing = null;
      });
    return renewing;
  };
  const expiring = () => {
    const at = session.instructions.expiresAt ? Date.parse(session.instructions.expiresAt) : NaN;
    return Number.isFinite(at) && at - now() < 60_000;
  };
  const urlOf = (partNumber: number) =>
    plan.multipart ? session.instructions.parts?.find((p) => p.partNumber === partNumber)?.url : session.instructions.url;

  async function sendPart(part: PlannedPart) {
    const body = file.slice(part.start, part.end);
    for (let attempt = 0; ; attempt++) {
      if (expiring()) await renewOnce(session.instructions);
      const used = session.instructions;
      const url = urlOf(part.partNumber);
      if (!url) throw new ApiError(0, "upload_parts_invalid", `No signed URL for part ${part.partNumber}.`);
      const answer = await put(url, used.headers ?? {}, body, (bytes) => {
        loaded.set(part.partNumber, bytes);
        report();
      });
      if (answer.status >= 200 && answer.status < 300) {
        // A multipart upload needs each part's ETag; storage must expose it (CORS `ExposeHeaders: ETag`).
        if (plan.multipart && !answer.etag) throw new ApiError(answer.status, "upload_etag_hidden", "Storage did not expose the part's ETag.");
        session.sent.set(part.partNumber, answer.etag ?? "");
        loaded.set(part.partNumber, part.end - part.start);
        report();
        return;
      }
      loaded.set(part.partNumber, 0);
      report();
      if (!retryable(answer.status) || attempt >= retries) {
        throw answer.status === 0 ? ApiError.network(new Error("upload failed")) : new ApiError(answer.status, "upload_failed", `Storage answered ${answer.status}.`);
      }
      onRetry?.(attempt + 1);
      if (answer.status === 403) await renewOnce(used);
      await wait(attempt + 1);
    }
  }

  const queue = plan.parts.filter((p) => !session.sent.has(p.partNumber));
  let failure: unknown = null;
  const worker = async () => {
    for (let next = queue.shift(); next && failure === null; next = queue.shift()) {
      try {
        await sendPart(next);
      } catch (e) {
        failure ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, worker));
  if (failure !== null) throw new UploadInterrupted(session, failure);

  onProgress(1);
  const parts = plan.multipart ? plan.parts.map(({ partNumber }) => ({ partNumber, etag: session.sent.get(partNumber)! })) : undefined;
  try {
    return await complete(session.versionId, parts);
  } catch (e) {
    // No answer: the parts are in storage; completing again is safe (a completed version answers as it is).
    if (e instanceof ApiError && e.status === 0) throw new UploadInterrupted(session, e);
    throw e;
  }
}
