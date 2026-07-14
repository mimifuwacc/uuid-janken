import { v7 as uuidV7 } from "uuid";
import { coinFlipUuidV7Pair } from "./protocol";

// Decides which player's UUID v7 "wins" (sorts higher) by actually racing two
// Worker threads (see race-worker.ts), instead of a coin-flip RNG bit. Both
// workers are released from a shared barrier at the same instant and race to
// post a result message back; the main thread issues an argument-less v7()
// the moment each message arrives, so the issuing order itself is the race
// outcome. The uuid package's internal state (updateV7State) makes those
// calls strictly monotonic — within one millisecond it increments seq, across
// milliseconds the timestamp grows — so the earlier arrival always gets the
// lower-sorting UUID. This makes the outcome depend on real OS thread
// scheduling, which was measured (in a throwaway node:worker_threads
// prototype, not part of this test suite) to be only approximately fair —
// occasionally biased well outside sampling noise. That tradeoff (genuine
// race over guaranteed fairness) was a deliberate, user-confirmed choice.
export const RACE_SUPPORTED =
  typeof SharedArrayBuffer !== "undefined" &&
  typeof crossOriginIsolated !== "undefined" &&
  crossOriginIsolated;

const GO = 0;

// Real rounds settle in a handful of milliseconds; this only guards against a
// worker that never responds (blocked load, crash, etc.), so it can be short
// without risking a false timeout on a healthy race.
const ROUND_TIMEOUT_MS = 1000;

let workerA: Worker | null = null;
let workerB: Worker | null = null;
let view: Int32Array | null = null;

// Builds both workers in a local before touching the module variables.
// `new Worker(...)` can throw synchronously (CSP blocking module workers,
// unsupported environment, etc.); if workerA got created and assigned before
// workerB's construction threw, workerA would leak past a caller-side
// discardWorkers() that only runs on the *next* call. Terminating a locally
// held first worker in the catch means a thrown error leaves the module
// variables untouched and nothing outstanding, so callers only ever need to
// discard a fully-formed pair.
function ensureWorkers(): void {
  if (workerA && workerB && view) return;

  const sab = new SharedArrayBuffer(4);
  const a = new Worker(new URL("./race-worker.ts", import.meta.url), { type: "module" });
  let b: Worker;
  try {
    b = new Worker(new URL("./race-worker.ts", import.meta.url), { type: "module" });
  } catch (err) {
    a.terminate();
    throw err;
  }
  a.postMessage({ type: "init", sab });
  b.postMessage({ type: "init", sab });

  view = new Int32Array(sab);
  workerA = a;
  workerB = b;
}

// Terminates and discards the current worker pair so ensureWorkers() spins up
// a fresh pair next round, instead of retrying against workers that already
// proved broken (crashed, blocked, or stuck mid-round).
function discardWorkers(): void {
  workerA?.terminate();
  workerB?.terminate();
  workerA = null;
  workerB = null;
  view = null;
}

// Resolves null (instead of throwing) on error or timeout, so callers can fall
// back to a coin flip rather than hang forever. Each worker's UUID is issued
// right when its result message arrives — the arrival order is the race, and
// the earlier arrival holds the earlier-generated (lower-sorting) UUID. If
// the round times out after only one result, the already-issued UUID is
// discarded along with the round.
function runRound(): Promise<{ uuidA: string; uuidB: string } | null> {
  const a = workerA!;
  const b = workerB!;
  const v = view!;

  return new Promise((resolve) => {
    Atomics.store(v, GO, 0);

    let readyCount = 0;
    let uuidA = "";
    let uuidB = "";
    let doneCount = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      a.removeEventListener("message", handlerA);
      b.removeEventListener("message", handlerB);
      a.removeEventListener("error", onError);
      b.removeEventListener("error", onError);
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    }, ROUND_TIMEOUT_MS);

    const onMessageFrom = (who: "a" | "b") => (e: MessageEvent) => {
      if (settled) return;
      const msg = e.data;
      if (msg.type === "ready") {
        readyCount++;
        if (readyCount === 2) {
          Atomics.store(v, GO, 1);
          // Wakes both workers (each blocked in Atomics.wait) at once, so
          // they're released from the barrier as close to simultaneously as
          // possible and the actual race is decided by thread scheduling.
          Atomics.notify(v, GO);
        }
      } else if (msg.type === "result") {
        if (who === "a") uuidA = uuidV7();
        else uuidB = uuidV7();
        doneCount++;
        if (doneCount === 2) {
          settled = true;
          cleanup();
          resolve({ uuidA, uuidB });
        }
      }
    };
    const handlerA = onMessageFrom("a");
    const handlerB = onMessageFrom("b");
    a.addEventListener("message", handlerA);
    b.addEventListener("message", handlerB);
    a.addEventListener("error", onError);
    b.addEventListener("error", onError);
    a.postMessage({ type: "round" });
    b.postMessage({ type: "round" });
  });
}

// Builds a UUID v7 pair without racing workers, for use when
// SharedArrayBuffer/cross-origin isolation isn't available or the worker race
// itself fails to resolve. The coin-flip pair (implementation shared with the
// online server, see protocol.ts) stays as fair as the real race.
export function fallbackUuidV7Pair(): [string, string] {
  return coinFlipUuidV7Pair();
}

// Returns a pair of UUID v7 strings, one per player, decided by racing two
// Worker threads. Falls back to a fair coin flip when SharedArrayBuffer/
// cross-origin isolation isn't available, when the worker race itself fails
// to resolve, or when starting/running the workers throws synchronously
// (e.g. a CSP blocking module workers), so v7 play never hangs or throws.
export async function raceUuidV7Pair(): Promise<[string, string]> {
  if (!RACE_SUPPORTED) {
    return fallbackUuidV7Pair();
  }

  let result;
  try {
    ensureWorkers();
    result = await runRound();
  } catch {
    discardWorkers();
    return fallbackUuidV7Pair();
  }
  if (!result) {
    discardWorkers();
    return fallbackUuidV7Pair();
  }

  return [result.uuidA, result.uuidB];
}
