import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/api/client", () => ({ api: { GET: (...args: unknown[]) => get(...args) } }));

const { jobError, jobPollDelay, waitForJob } = await import("./jobs");
const job = (status: string, extra: Record<string, unknown> = {}) => ({ id: "j1", kind: "export_xlsx", status, ...extra }) as never;

describe("the app's one job wait (review B-15)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("one delay policy: often in the first second, then less, then every half second", () => {
    expect([0, 999, 1000, 9_999, 10_000, 60_000].map(jobPollDelay)).toEqual([100, 100, 250, 250, 500, 500]);
  });

  it("asks GET /jobs/{id} until the job ends and returns it as it ended", async () => {
    get.mockResolvedValueOnce({ data: job("running") }).mockResolvedValueOnce({ data: job("failed", { error: { code: "engine_error", message: "boom" } }) });
    const done = waitForJob(job("queued"));
    await vi.advanceTimersByTimeAsync(300);
    const ended = await done;
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]).toEqual(["/jobs/{jobId}", { params: { path: { jobId: "j1" } } }]);
    expect(ended).toMatchObject({ status: "failed" });
    expect(jobError(ended, "export failed")).toMatchObject({ message: "boom", code: "engine_error" });
  });

  it("a finished job is returned without asking", async () => {
    expect(await waitForJob(job("succeeded"))).toMatchObject({ status: "succeeded" });
    expect(get).not.toHaveBeenCalled();
  });

  it("gives up after the timeout, naming the job", async () => {
    get.mockResolvedValue({ data: job("running") });
    const done = waitForJob(job("running"), { timeoutMs: 2_000, what: "preview" });
    const failed = expect(done).rejects.toThrow("preview timed out");
    await vi.advanceTimersByTimeAsync(3_000);
    await failed;
  });
});
