import { icon } from "@fortawesome/fontawesome-svg-core";
import { faTwitter } from "@fortawesome/free-brands-svg-icons/faTwitter";
import { createIcons, Swords, RefreshCcw, Globe, Users, Volume2, QrCode } from "lucide";
import { getRevealDelay, getRevealShakeDistance, REVEAL_CHARACTER_COUNT } from "../reveal";
import { OnlineConnection, type OnlineHandlers } from "../online";
import { fallbackUuidV7Pair } from "../race";
import { createDrawShareUrl, createLoserShareUrl, createWinnerShareUrl } from "../share";
import { compareUuids, generateRaceUuids, generateUuidV4, type UuidVersion } from "../uuid";
import { navigate, type View } from "../router";
import { prepareAudio, playCallSound, playRevealSound, playFanfareSound } from "../game/audio";
import { buildUuidRevealHtml } from "../game/uuid-reveal";
import { burstParticles, disposeParticles, initParticles, stopParticles } from "../game/particles";

const ICONS = { Swords, RefreshCcw, Globe, Users, Volume2, QrCode };

// Mints a short, URL-safe room id for the "みんなで対戦" deep link. Collisions
// are harmless at this game's scale (a fresh id is just a fresh empty room).
function generateRoomId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
const TWITTER_ICON = icon(faTwitter).html.join("");

type Phase = "idle" | "countdown" | "reveal" | "result";

let phase: Phase = "idle";
let ready: [boolean, boolean] = [false, false];
let uuids: [string, string] = ["", ""];
let revealCount = 0;
let winner: 0 | 1 | "draw" | null = null;
let revealTimer = 0;
let revealShake: Animation | null = null;
let uuidVersion: UuidVersion = "v4";
// Online play: bottom half is always "you", top half is the opponent driven
// by server events (see online.ts / worker/index.ts).
let mode: "local" | "online" = "local";
let online: OnlineConnection | null = null;
let onlineMatched = false;
let opponentLeft = false;
// Set on unmount so deferred callbacks (countdown/reveal ticks, the result
// button timeout, socket handlers) bail out instead of touching torn-down DOM.
let disposed = false;
// The #app root this view is mounted into (captured on mount).
let appEl: HTMLElement;
// "最初は / 4〜 / じゃんけん...." — battle cry, version digit matches the round's version
const callSequence = (version: UuidVersion): { text: string; cls: string; duration: number }[] => [
  { text: "最初は", cls: "call-saisho", duration: 1000 },
  { text: version === "v4" ? "4" : "7", cls: "call-four", duration: 950 },
  { text: "じゃんけん", cls: "call-janken", duration: 900 },
];
// Must match the desktop split in style.css (halves side-by-side, not rotated).
const DESKTOP_SPLIT_QUERY = "(min-width: 900px) and (orientation: landscape)";

let halfEls: [HTMLElement, HTMLElement];
let uuidEls: [HTMLElement, HTMLElement];
let statusEls: [HTMLElement, HTMLElement];
let labelEls: [HTMLElement, HTMLElement];
let replaySlots: [HTMLElement, HTMLElement];
let modeToggleEl: HTMLElement;
let roomEntryEl: HTMLElement;
let countdownEl: HTMLElement;
let countdownHalves: [HTMLElement, HTMLElement];
let versionToggleEls: HTMLElement[];

function refreshUUIDs() {
  for (let p = 0 as 0 | 1; p < 2; p = (p + 1) as 0 | 1) {
    uuidEls[p].innerHTML = buildUuidRevealHtml(uuids[p], revealCount);
  }
}

function setStatus(p: 0 | 1, html: string) {
  statusEls[p].innerHTML = html;
}

function setIdleControlsVisible(visible: boolean) {
  for (const el of versionToggleEls) {
    el.style.display = visible ? "" : "none";
  }
  modeToggleEl.style.display = visible ? "" : "none";
  roomEntryEl.style.display = visible ? "" : "none";
}

function playRevealShake(app: HTMLElement, shakeDistance: number) {
  revealShake?.cancel();
  if (shakeDistance === 0) return;

  revealShake = app.animate(
    [
      { transform: `translateX(${shakeDistance}px)` },
      { transform: `translateX(${-shakeDistance}px)` },
      { transform: "translateX(0)" },
    ],
    { duration: Math.min(getRevealDelay(revealCount), 120), easing: "ease-out" },
  );
}

function spawnRipple(half: HTMLElement, x: number, y: number) {
  const rect = half.getBoundingClientRect();
  // The top half is rotated 180° on mobile, so its local coordinate system is
  // flipped — mirror the offsets there so the ripple lands under the finger.
  const rotated = half.classList.contains("top") && !window.matchMedia(DESKTOP_SPLIT_QUERY).matches;
  const r = document.createElement("div");
  r.className = "ripple";
  r.style.left = `${rotated ? rect.right - x : x - rect.left}px`;
  r.style.top = `${rotated ? rect.bottom - y : y - rect.top}px`;
  half.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

function onTap(player: 0 | 1, x: number, y: number) {
  prepareAudio();
  if (phase !== "idle") return;

  if (mode === "online") {
    // Only your own (bottom) half is tappable, and only once matched.
    if (player !== 0 || !onlineMatched || ready[0]) return;
    ready[0] = true;
    halfEls[0].classList.add("ready");
    spawnRipple(halfEls[0], x, y);
    setStatus(0, "準備完了！");
    online?.sendReady(uuidVersion);
    return;
  }

  if (ready[player]) return;

  ready[player] = true;
  halfEls[player].classList.add("ready");
  spawnRipple(halfEls[player], x, y);
  setStatus(player, "準備完了！");

  if (ready[0] && ready[1]) {
    // Kicked off now so it has the whole countdown (2.6s) to resolve — the
    // race finishes in well under that, v4 resolves immediately.
    startCountdown(generateRaceUuids(uuidVersion), uuidVersion);
  }
}

function startCountdown(uuidsPromise: Promise<[string, string]>, version: UuidVersion) {
  phase = "countdown";
  setIdleControlsVisible(false);
  // Clear the "準備完了！" labels — they're not needed during the count.
  setStatus(0, "");
  setStatus(1, "");
  revealCount = 0;

  countdownEl.classList.add("active");
  const sequence = callSequence(version);
  let step = 0;

  const tick = () => {
    if (disposed) return;
    if (step >= sequence.length) {
      countdownHalves[0].innerHTML = "";
      countdownHalves[1].innerHTML = "";
      countdownEl.classList.remove("active");
      void uuidsPromise
        .then(([player0, player1]) => {
          if (disposed) return;
          uuids[0] = player0;
          uuids[1] = player1;
          startReveal();
        })
        // generateRaceUuids() shouldn't reject in practice (race.ts falls
        // back internally on error/timeout), but guard against a stray
        // rejection so the game can't get stuck on the countdown screen.
        .catch(() => {
          if (disposed) return;
          const [player0, player1] =
            version === "v4" ? [generateUuidV4(), generateUuidV4()] : fallbackUuidV7Pair();
          uuids[0] = player0;
          uuids[1] = player1;
          startReveal();
        });
      return;
    }

    const { text, cls, duration } = sequence[step];
    const makeEl = () => {
      const el = document.createElement("div");
      el.className = `countdown-number ${cls}`;
      el.textContent = text;
      return el;
    };
    countdownHalves[0].innerHTML = "";
    countdownHalves[0].appendChild(makeEl());
    countdownHalves[1].innerHTML = "";
    countdownHalves[1].appendChild(makeEl());
    playCallSound();
    step++;

    setTimeout(tick, duration);
  };

  tick();
}

function startReveal() {
  phase = "reveal";
  revealCount = 0;
  const app = appEl;
  refreshUUIDs();

  const tick = () => {
    if (disposed || phase !== "reveal") return;
    revealCount++;
    const shakeDistance = getRevealShakeDistance(revealCount);
    refreshUUIDs();
    playRevealSound(revealCount);
    playRevealShake(app, shakeDistance);
    if (revealCount < REVEAL_CHARACTER_COUNT) {
      revealTimer = window.setTimeout(tick, getRevealDelay(revealCount));
    } else {
      revealTimer = window.setTimeout(showResult, 600);
    }
  };

  revealTimer = window.setTimeout(tick, getRevealDelay(revealCount));
}

function showResult() {
  phase = "result";
  const app = appEl;
  revealShake?.cancel();
  playFanfareSound();

  const cmp = compareUuids(uuids[0], uuids[1]);
  if (cmp === "draw") {
    winner = "draw";
    halfEls[0].classList.add("draw");
    halfEls[1].classList.add("draw");
    setStatus(0, "引き分け！");
    setStatus(1, "引き分け！");
  } else {
    winner = cmp === "a" ? 0 : 1;
    const loser = winner === 0 ? 1 : 0;
    halfEls[winner].classList.add("win");
    halfEls[loser].classList.add("lose");
    app.classList.add("shaking");
    setTimeout(() => {
      if (disposed) return;
      app.classList.remove("shaking");
    }, 500);
    setStatus(winner, "WIN！");
    setStatus(loser, "LOSE...");
    burstParticles(halfEls[winner].getBoundingClientRect());
  }

  setTimeout(() => {
    if (disposed) return;
    if (mode === "online") {
      buildOnlineResultButtons();
    } else {
      const replayLabel = winner === "draw" ? "あいこでしょ" : "もう一度";
      makeActionBtn(replaySlots[0], replayLabel, resetGame);
      makeActionBtn(replaySlots[1], replayLabel, resetGame);
      if (winner === "draw") {
        const drawShareUrl = createDrawShareUrl(uuids[0], uuids[1], window.location.href);
        makeShareBtn(replaySlots[0], drawShareUrl);
        makeShareBtn(replaySlots[1], drawShareUrl);
      } else if (winner !== null) {
        makeShareBtn(
          replaySlots[winner],
          createWinnerShareUrl(uuids[0], uuids[1], window.location.href),
        );
      }
    }
    createIcons({ icons: ICONS });
  }, 1800);
}

function makeActionBtn(
  target: HTMLElement,
  label: string,
  action: () => void,
  icon = "refresh-ccw",
  extraClass = "",
) {
  const btn = document.createElement("button");
  btn.className = extraClass ? `replay-btn ${extraClass}` : "replay-btn";
  btn.innerHTML = `<i data-lucide="${icon}" class="btn-icon"></i>${label}`;
  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    action();
  });
  btn.addEventListener("click", action);
  target.appendChild(btn);
}

function makeShareBtn(target: HTMLElement, href: string) {
  const shareLink = document.createElement("a");
  shareLink.className = "share-btn";
  shareLink.href = href;
  shareLink.target = "_blank";
  shareLink.rel = "noopener noreferrer";
  shareLink.innerHTML = `${TWITTER_ICON}ツイートする`;
  target.appendChild(shareLink);
}

// Online result screen: everything lives on your (bottom) half — the
// opponent's half never gets buttons. Reconnect/requeue take priority over a
// plain rematch when the connection or the opponent is gone; a still-present
// opponent additionally gets a "leave online and go back to local play" option.
function buildOnlineResultButtons() {
  if (!online?.isOpen) {
    makeActionBtn(replaySlots[0], "再接続", requeueOnline);
  } else if (opponentLeft) {
    makeActionBtn(replaySlots[0], "対戦相手を探す", requeueOnline);
  } else {
    const label = winner === "draw" ? "あいこでしょ" : "もう一度";
    makeActionBtn(replaySlots[0], label, readyAgainOnline);
    // "もう一度" already covers rematching; the second slot instead drops back
    // to offline local play (closing the socket, which the server relays to
    // the opponent as opponent_left — same path as toggleMode/tab close).
    makeActionBtn(replaySlots[0], "ローカルに戻る", switchToLocalMode, "users", "leave-btn");
  }
  // Unlike local play (strangers with no one to lose face in front of),
  // online losses get a share button too — see createLoserShareUrl().
  if (winner === "draw") {
    makeShareBtn(replaySlots[0], createDrawShareUrl(uuids[0], uuids[1], window.location.href));
  } else if (winner === 0) {
    makeShareBtn(replaySlots[0], createWinnerShareUrl(uuids[0], uuids[1], window.location.href));
  } else if (winner === 1) {
    makeShareBtn(replaySlots[0], createLoserShareUrl(uuids[0], uuids[1], window.location.href));
  }
}

function resetGame() {
  clearTimeout(revealTimer);
  stopParticles();
  revealShake?.cancel();

  phase = "idle";
  ready = [false, false];
  uuids = ["", ""];
  revealCount = 0;
  winner = null;

  halfEls[0].className = "half bottom";
  halfEls[1].className = "half top";
  uuidEls[0].innerHTML = "";
  uuidEls[1].innerHTML = "";
  replaySlots[0].innerHTML = "";
  replaySlots[1].innerHTML = "";
  if (mode === "online") {
    setStatus(0, onlineMatched ? "タップして準備" : "");
    setStatus(1, onlineMatched ? "" : "対戦相手を探しています…");
  } else {
    setStatus(0, "タップして準備");
    setStatus(1, "タップして準備");
  }
  setIdleControlsVisible(true);

  createIcons({ icons: ICONS });
}

/* ===== Online mode ===== */

const onlineHandlers: OnlineHandlers = {
  onWaiting: () => {
    onlineMatched = false;
    if (phase === "idle") {
      setStatus(0, "");
      setStatus(1, "対戦相手を探しています…");
    }
  },
  onMatched: () => {
    onlineMatched = true;
    opponentLeft = false;
    if (phase === "idle") {
      setStatus(0, "タップして準備");
      setStatus(1, "対戦相手が見つかりました！");
    }
  },
  onOpponentReady: () => {
    if (phase === "idle") {
      halfEls[1].classList.add("ready");
      setStatus(1, "準備完了！");
    }
  },
  onStart: (version, mine, theirs) => {
    if (phase !== "idle") return;
    startCountdown(Promise.resolve<[string, string]>([mine, theirs]), version);
  },
  onOpponentLeft: () => {
    onlineMatched = false;
    opponentLeft = true;
    // Mid-round the reveal plays out with the UUIDs already delivered; the
    // result screen then offers "対戦相手を探す" instead of a rematch.
    if (phase === "idle") {
      requeueOnline();
    } else if (phase === "result" && replaySlots[0].children.length > 0) {
      // Result buttons already rendered (e.g. the opponent used "この相手と
      // 切断する" after both saw the result) — rebuild them now instead of
      // leaving a stale もう一度 button that would silently do nothing.
      replaySlots[0].innerHTML = "";
      buildOnlineResultButtons();
      createIcons({ icons: ICONS });
    }
  },
  onDisconnected: () => {
    onlineMatched = false;
    if (phase === "idle") {
      setStatus(0, "");
      setStatus(1, "接続できませんでした");
      replaySlots[0].innerHTML = "";
      makeActionBtn(replaySlots[0], "再接続", requeueOnline);
      createIcons({ icons: ICONS });
    } else if (phase === "result" && replaySlots[0].children.length > 0) {
      // Result buttons (もう一度/切断する) were already rendered
      // before the connection died — rebuild them now via
      // buildOnlineResultButtons(), which checks online.isOpen first and
      // renders 再接続 instead, so a stale button never just does nothing.
      replaySlots[0].innerHTML = "";
      buildOnlineResultButtons();
      createIcons({ icons: ICONS });
    }
    // Otherwise (countdown/reveal, or result not yet rendered): the pending
    // buildOnlineResultButtons() call in showResult() will already see
    // online.isOpen === false and render 再接続 from the start.
  },
};

// Rematch with the same opponent — clicking the button counts as your ready tap.
function readyAgainOnline() {
  resetGame();
  ready[0] = true;
  halfEls[0].classList.add("ready");
  setStatus(0, "準備完了！");
  online?.sendReady(uuidVersion);
}

// Leave online play entirely and return to offline local mode. Closing the
// socket is what notifies the (still-connected) opponent — the server's
// webSocketClose handler relays it as opponent_left, just like a tab close.
// Also the online→local path shared with toggleMode().
function switchToLocalMode() {
  online?.close();
  online = null;
  mode = "local";
  onlineMatched = false;
  opponentLeft = false;
  appEl.classList.remove("online");
  updateModeUi();
  resetGame();
}

// Look for a new opponent, reconnecting first if the socket has died.
function requeueOnline() {
  opponentLeft = false;
  onlineMatched = false;
  resetGame();
  if (online?.isOpen) {
    online.sendRequeue(uuidVersion);
  } else {
    online?.connect(uuidVersion);
  }
}

function toggleMode() {
  prepareAudio();
  if (phase !== "idle" && phase !== "result") return;
  if (mode === "local") {
    mode = "online";
    onlineMatched = false;
    opponentLeft = false;
    appEl.classList.add("online");
    updateModeUi();
    resetGame();
    online = new OnlineConnection(onlineHandlers);
    online.connect(uuidVersion);
  } else {
    switchToLocalMode();
  }
}

function updateModeUi() {
  labelEls[0].textContent = mode === "online" ? "あなた" : "PLAYER 1";
  labelEls[1].textContent = mode === "online" ? "相手" : "PLAYER 2";
  // The button shows the CURRENT mode (tapping switches to the other one);
  // the green highlight while online reinforces which state is active.
  modeToggleEl.innerHTML =
    mode === "online"
      ? `<i data-lucide="globe" class="mode-icon"></i>オンライン対戦`
      : `<i data-lucide="users" class="mode-icon"></i>ローカル対戦`;
  createIcons({ icons: ICONS });
}

function buildDom() {
  const app = appEl;

  // Both halves share the SAME DOM order (divider → outward). rotate(180deg)
  // on the top half makes that order read naturally for the facing player,
  // so identical DOM = mirror-symmetric appearance.
  const halfInner = (player: 1 | 2) => `
      <div class="tap-hint"><i data-lucide="swords" class="tap-icon"></i></div>
      <div class="uuid-display" id="uuid-${player === 1 ? 0 : 1}"></div>
      <div class="status" id="status-${player === 1 ? 0 : 1}">タップして準備</div>
      <div class="sound-note"><i data-lucide="volume-2" class="sound-note-icon"></i>音が出ます</div>
      <div class="replay-slot" id="replay-${player === 1 ? 0 : 1}"></div>
      <div class="player-label">PLAYER ${player}</div>`;

  app.innerHTML = `
    <div class="half top" id="half-1">${halfInner(2)}</div>
    <div class="divider">
      <button type="button" class="version-toggle version-toggle-left">${uuidVersion}</button>
      <button type="button" class="mode-toggle" id="mode-toggle"></button>
      <button
        type="button"
        class="room-entry"
        id="room-entry"
        aria-label="みんなで対戦"
        title="みんなで対戦（部屋を作る）"
      >
        <i data-lucide="qr-code" class="mode-icon"></i
        ><span class="room-entry-label">みんなで対戦</span>
      </button>
      <button type="button" class="version-toggle version-toggle-right">${uuidVersion}</button>
    </div>
    <div class="half bottom" id="half-0">${halfInner(1)}</div>
    <div class="countdown-overlay" id="countdown">
      <div class="countdown-half for-top" id="countdown-top"></div>
      <div class="countdown-half for-bottom" id="countdown-bottom"></div>
    </div>
  `;
  createIcons({ icons: ICONS });

  halfEls = [
    document.getElementById("half-0") as HTMLElement,
    document.getElementById("half-1") as HTMLElement,
  ];
  uuidEls = [
    document.getElementById("uuid-0") as HTMLElement,
    document.getElementById("uuid-1") as HTMLElement,
  ];
  statusEls = [
    document.getElementById("status-0") as HTMLElement,
    document.getElementById("status-1") as HTMLElement,
  ];
  replaySlots = [
    document.getElementById("replay-0") as HTMLElement,
    document.getElementById("replay-1") as HTMLElement,
  ];
  labelEls = [
    halfEls[0].querySelector(".player-label") as HTMLElement,
    halfEls[1].querySelector(".player-label") as HTMLElement,
  ];
  modeToggleEl = document.getElementById("mode-toggle") as HTMLElement;
  modeToggleEl.addEventListener("click", toggleMode);
  roomEntryEl = document.getElementById("room-entry") as HTMLElement;
  roomEntryEl.addEventListener("click", () => navigate(`/room/${generateRoomId()}`));
  updateModeUi();
  countdownEl = document.getElementById("countdown") as HTMLElement;
  countdownHalves = [
    document.getElementById("countdown-bottom") as HTMLElement,
    document.getElementById("countdown-top") as HTMLElement,
  ];
  versionToggleEls = Array.from(document.querySelectorAll<HTMLElement>(".version-toggle"));
  const toggleVersion = () => {
    if (phase !== "idle") return;
    // Locked once matched: matchmaking only pairs same-version waiters (see
    // worker/index.ts's enqueue()), so switching after that would silently
    // desync the round the opponent already agreed to play.
    if (mode === "online" && onlineMatched) return;
    uuidVersion = uuidVersion === "v4" ? "v7" : "v4";
    for (const el of versionToggleEls) {
      el.textContent = uuidVersion;
      el.classList.remove("switching");
    }
    void versionToggleEls[0].offsetWidth; // restart the animation on repeat clicks
    for (const el of versionToggleEls) el.classList.add("switching");
    if (mode === "online" && online?.isOpen) {
      // Still just waiting (not matched) — move to the other version's
      // queue so matchmaking considers the new preference immediately.
      online.sendRequeue(uuidVersion);
    }
  };
  for (const el of versionToggleEls) el.addEventListener("click", toggleVersion);

  initParticles();

  // Let taps on interactive children (replay button / share link) behave
  // natively — otherwise the half's preventDefault swallows the link's tap.
  const isInteractive = (target: EventTarget | null) =>
    target instanceof Element && target.closest("a, button") !== null;

  const addTapListeners = (el: HTMLElement, player: 0 | 1) => {
    el.addEventListener(
      "touchstart",
      (e) => {
        if (isInteractive(e.target)) return;
        e.preventDefault();
        const t = e.touches[0];
        onTap(player, t.clientX, t.clientY);
      },
      { passive: false },
    );
    el.addEventListener("click", (e) => {
      if (isInteractive(e.target)) return;
      onTap(player, e.clientX, e.clientY);
    });
  };

  addTapListeners(halfEls[0], 0);
  addTapListeners(halfEls[1], 1);
}

// The default screen (route "/"): local face-to-face 1v1 with an in-divider
// toggle to random-online 1v1, plus a "みんなで対戦" button into the room mode.
export function createGame1v1View(): View {
  return {
    mount(root) {
      disposed = false;
      appEl = root;
      // Reset all round state so a remount always starts clean.
      phase = "idle";
      ready = [false, false];
      uuids = ["", ""];
      revealCount = 0;
      winner = null;
      revealTimer = 0;
      revealShake = null;
      uuidVersion = "v4";
      mode = "local";
      online = null;
      onlineMatched = false;
      opponentLeft = false;

      buildDom();
      resetGame();
    },
    unmount() {
      disposed = true;
      clearTimeout(revealTimer);
      revealShake?.cancel();
      // Closing the socket is how the (still-connected) opponent is told we
      // left — the server relays it as opponent_left.
      online?.close();
      online = null;
      disposeParticles();
    },
  };
}
