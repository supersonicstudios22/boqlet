import { beforeAll, describe, expect, it } from "vitest";
import { client } from "../support/env";
import { duplexBytes, waitForVersion } from "../support/models";
import { setPlan } from "../support/plans";
import { signUp, uniqueEmail, type TestUser } from "../support/users";

/**
 * A model over 100 MiB through the multipart upload (review A-40, ENG-002, FM-16): the sequence
 * `apps/app/src/features/models/upload.ts` sends. Each part goes to its own signed URL, the ETags go to
 * `complete`; URLs renewed part way (`renewModelUpload`) keep the parts already sent.
 */

const MIB = 1024 * 1024;
const slug = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

let owner: TestUser;
let projectId: string;

beforeAll(async () => {
  owner = await signUp("Upload Owner", uniqueEmail("uploads"));
  const { data: org } = await client(owner.token).POST("/orgs", { body: { name: "Uploads Firm", slug: slug("uploads") } });
  await setPlan(owner, org!.id, "team");      // 300 MB per model version
  const { data: project } = await client(owner.token).POST("/orgs/{orgId}/projects", { params: { path: { orgId: org!.id } }, body: { name: "Big models" } });
  projectId = project!.id;
});

/** The Duplex with blank lines before its last `ENDSEC;` up to `size` bytes: a big file that parses. */
async function bigIfc(size: number) {
  const duplex = await duplexBytes();
  const end = Buffer.from(duplex).lastIndexOf("ENDSEC;");
  const bytes = new Uint8Array(size).fill(0x0a);
  bytes.set(duplex.subarray(0, end));
  bytes.set(duplex.subarray(end), size - (duplex.byteLength - end));
  return bytes;
}

async function putPart(url: string, bytes: Uint8Array) {
  const answer = await fetch(url, { method: "PUT", body: new Blob([bytes as BlobPart]) });
  expect(answer.status).toBe(200);
  const etag = answer.headers.get("ETag");
  expect(etag).toBeTruthy();
  return etag!;
}

describe("multipart upload over 100 MiB (A-40)", () => {
  it("101 MiB: seven 16 MiB parts, URLs renewed after three, completes and parses", async () => {
    const api = client(owner.token);
    const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Big", discipline: "architecture" } });
    const size = 101 * MIB;
    const bytes = await bigIfc(size);
    const created = await api.POST("/models/{modelId}/versions", { params: { path: { modelId: model!.id } }, body: { fileName: "big.ifc", sizeBytes: size } });
    expect(created.response.status).toBe(201);
    const { version, upload } = created.data!;
    expect(upload.partSizeBytes).toBe(16 * MIB);
    expect(upload.parts).toHaveLength(7);
    expect(upload.url).toBe(upload.parts![0].url);
    const partSize = upload.partSizeBytes!;
    const slice = (n: number) => bytes.subarray((n - 1) * partSize, Math.min(size, n * partSize));

    const etags: { partNumber: number; etag: string }[] = [];
    for (const part of upload.parts!.slice(0, 3)) etags.push({ partNumber: part.partNumber, etag: await putPart(part.url, slice(part.partNumber)) });

    // An interrupted upload resumes with fresh URLs for the same storage upload.
    const renewed = await api.POST("/model-versions/{versionId}/upload", { params: { path: { versionId: version.id } } });
    expect(renewed.response.status).toBe(200);
    expect(renewed.data!.parts).toHaveLength(7);
    expect(Date.parse(renewed.data!.expiresAt!)).toBeGreaterThan(Date.now());
    for (const part of renewed.data!.parts!.slice(3)) etags.push({ partNumber: part.partNumber, etag: await putPart(part.url, slice(part.partNumber)) });

    // Without the parts, nothing is completed (the bug ENG-002 hit: the app sent `{}`).
    const bare = await api.POST("/model-versions/{versionId}/complete", { params: { path: { versionId: version.id } }, body: {} });
    expect(bare.response.status).toBe(400);
    expect((bare.error as { code: string }).code).toBe("upload_parts_invalid");

    const done = await api.POST("/model-versions/{versionId}/complete", { params: { path: { versionId: version.id } }, body: { parts: etags } });
    expect(done.response.status).toBe(200);
    expect(["queued", "processing", "ready"]).toContain(done.data!.status);
    expect(done.data!.sizeBytes).toBe(size);

    // Once the file is in, there is nothing left to renew.
    const late = await api.POST("/model-versions/{versionId}/upload", { params: { path: { versionId: version.id } } });
    expect(late.response.status).toBe(409);
    expect((late.error as { code: string }).code).toBe("upload_not_awaited");
    const parsed = await waitForVersion(owner, version.id, 300_000);
    expect(parsed.status).toBe("ready");
    expect(parsed.summary!.elementCount).toBeGreaterThan(100);
  }, 360_000);

  it("a small file's renewed instructions are one signed PUT, as before", async () => {
    const api = client(owner.token);
    const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Small", discipline: "architecture" } });
    const bytes = await duplexBytes();
    const created = await api.POST("/models/{modelId}/versions", { params: { path: { modelId: model!.id } }, body: { fileName: "small.ifc", sizeBytes: bytes.byteLength } });
    expect(created.data!.upload.parts ?? []).toHaveLength(0);
    const renewed = await api.POST("/model-versions/{versionId}/upload", { params: { path: { versionId: created.data!.version.id } } });
    expect(renewed.response.status).toBe(200);
    expect(renewed.data!.parts ?? []).toHaveLength(0);
    const put = await fetch(renewed.data!.url, { method: "PUT", body: new Blob([bytes as BlobPart]) });
    expect(put.status).toBe(200);
    const done = await api.POST("/model-versions/{versionId}/complete", { params: { path: { versionId: created.data!.version.id } }, body: {} });
    expect(done.response.status).toBe(200);
    expect((await waitForVersion(owner, created.data!.version.id)).status).toBe("ready");
  });

  it("someone who can't edit models can't renew an upload", async () => {
    const api = client(owner.token);
    const { data: model } = await api.POST("/projects/{projectId}/models", { params: { path: { projectId } }, body: { name: "Other", discipline: "architecture" } });
    const created = await api.POST("/models/{modelId}/versions", { params: { path: { modelId: model!.id } }, body: { fileName: "x.ifc", sizeBytes: 1000 } });
    const stranger = await signUp("Stranger", uniqueEmail("uploads-stranger"));
    const refused = await client(stranger.token).POST("/model-versions/{versionId}/upload", { params: { path: { versionId: created.data!.version.id } } });
    expect(refused.response.status).toBe(404);
  });
});
