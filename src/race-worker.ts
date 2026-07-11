// Runs in a dedicated Worker. Blocks on a shared "go" flag via Atomics.wait
// so both race workers are released from the barrier at (as close to) the
// same instant by the main thread's Atomics.notify, then immediately post a
// result message — the race is decided by whose message reaches the main
// thread first. The main thread (see race.ts) issues a v7 UUID on the spot
// as each result arrives, so the earlier arrival gets the earlier-generated
// (lower-sorting) UUID.

type InitMessage = { type: "init"; sab: SharedArrayBuffer };
type RoundMessage = { type: "round" };
type InMessage = InitMessage | RoundMessage;

const GO = 0;

let view: Int32Array | null = null;

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;

  if (msg.type === "init") {
    view = new Int32Array(msg.sab);
    return;
  }

  if (msg.type === "round" && view) {
    postMessage({ type: "ready" });
    // Atomics.wait can return "not-equal" or wake spuriously without the
    // flag actually being set, so re-check the flag itself in a loop rather
    // than trusting a single wait() call to mean "go".
    while (Atomics.load(view, GO) !== 1) Atomics.wait(view, GO, 0);
    postMessage({ type: "result" });
  }
};
