// How much slower than a quiet developer machine the suites may run (review B-08, DEC-07): CI runners have
// two CPUs and a full `mvn verify` runs the API, the engine and a browser at once. Every timeout of the
// shared suites, the browser suite and NativeWorkerTest's waits is multiplied by it.
// `BOQLET_TEST_TIME_FACTOR`, a number from 1 to 10; 1 by default.
export function timeFactor() {
  const raw = process.env.BOQLET_TEST_TIME_FACTOR;
  if (raw === undefined || raw === "") return 1;
  const factor = Number(raw);
  if (!Number.isFinite(factor) || factor < 1 || factor > 10) throw new Error(`BOQLET_TEST_TIME_FACTOR must be a number from 1 to 10, not ${raw}`);
  return factor;
}
