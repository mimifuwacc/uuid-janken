import qrcode from "qrcode-generator";
import { createIcons, Home, RefreshCcw, Crown, Users, Volume2 } from "lucide";
import { navigate, type View } from "../router";
import { RoomConnection } from "../room-connection";
import { rankByUuid, type RoomRosterPlayer, type RoomStartPlayer } from "../room-protocol";
import { getRevealDelay, REVEAL_CHARACTER_COUNT } from "../reveal";
import { prepareAudio, playCallSound, playRevealSound, playFanfareSound } from "../game/audio";
import { buildUuidRevealHtml } from "../game/uuid-reveal";
import { burstParticles, disposeParticles, initParticles, stopParticles } from "../game/particles";

const ICONS = { Home, RefreshCcw, Crown, Users, Volume2 };

// Rooms are always v4, so the battle cry's digit is fixed at "4".
const ROOM_CALL_SEQUENCE = [
  { text: "最初は", cls: "call-saisho", duration: 1000 },
  { text: "4", cls: "call-four", duration: 950 },
  { text: "じゃんけん", cls: "call-janken", duration: 900 },
];

type RoomPhase = "lobby" | "countdown" | "reveal" | "result";

let appEl: HTMLElement;
let conn: RoomConnection;
let roomId = "";
let disposed = false;

let phase: RoomPhase = "lobby";
let youId = "";
let players: RoomRosterPlayer[] = [];
let connected = true;

// Per-round state.
let roundInfo = new Map<string, RoomRosterPlayer>();
let ranked: RoomStartPlayer[] = [];
let myUuid = "";
let revealCount = 0;
let revealTimer = 0;
let countdownEl: HTMLElement | null = null;
let roomUuidEl: HTMLElement | null = null;

const labelOf = (num: number) => `プレイヤー${num}`;
const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function qrDataUrl(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 12);
}

/* ===== Lobby ===== */

function renderLobby(): void {
  const joinUrl = window.location.href;
  const you = players.find((p) => p.id === youId);
  const youReady = you?.ready ?? false;
  const readyCount = players.filter((p) => p.ready).length;

  const roster = players
    .map((p) => {
      const isYou = p.id === youId;
      return `
        <li class="room-member${p.ready ? " ready" : ""}${isYou ? " you" : ""}" style="--player-color:${p.color}">
          <span class="room-member-dot"></span>
          <span class="room-member-name">${escapeHtml(labelOf(p.num))}${isYou ? "（あなた）" : ""}</span>
          <span class="room-member-state">${p.ready ? "準備OK" : "…"}</span>
        </li>`;
    })
    .join("");

  const hint = !connected
    ? "接続が切れました"
    : players.length < 2
      ? "他の参加者を待っています（2人以上で開始）"
      : youReady
        ? `全員の準備を待っています（${readyCount}/${players.length}）`
        : "全員が準備すると自動で始まります";

  appEl.innerHTML = `
    <div class="room-lobby">
      <div class="room-head">
        <button type="button" class="room-back" id="room-back">
          <i data-lucide="home" class="room-back-icon"></i>もどる
        </button>
        <h1 class="room-title">みんなで対戦</h1>
      </div>

      <div class="room-invite">
        <img class="room-qr" alt="参加用QRコード" src="${qrDataUrl(joinUrl)}" />
        <p class="room-invite-note">このQRコード（またはURL）を共有して参加</p>
        <button type="button" class="room-copy" id="room-copy">${escapeHtml(joinUrl)}</button>
      </div>

      <ul class="room-members"><li class="room-members-head"><i data-lucide="users"></i>参加者 ${players.length}</li>${roster}</ul>

      <div class="room-hint">${hint}</div>

      ${
        connected
          ? `<button type="button" class="room-ready${youReady ? " armed" : ""}" id="room-ready">${
              youReady ? "準備完了 ✓（キャンセル）" : "準備する"
            }</button>`
          : `<button type="button" class="room-ready" id="room-reconnect">再接続</button>`
      }
      <div class="sound-note"><i data-lucide="volume-2" class="sound-note-icon"></i>音が出ます</div>
    </div>
  `;
  createIcons({ icons: ICONS });

  document.getElementById("room-back")?.addEventListener("click", leaveRoom);
  document.getElementById("room-copy")?.addEventListener("click", () => {
    void navigator.clipboard?.writeText(joinUrl);
  });
  document.getElementById("room-ready")?.addEventListener("click", toggleReady);
  document.getElementById("room-reconnect")?.addEventListener("click", () => {
    connected = true;
    conn.connect();
    renderLobby();
  });
}

function toggleReady(): void {
  prepareAudio();
  const you = players.find((p) => p.id === youId);
  if (!you) return;
  if (you.ready) {
    you.ready = false;
    conn.sendCancel();
  } else {
    you.ready = true;
    conn.sendReady();
  }
  renderLobby(); // optimistic; the server's roster echo will reconcile
}

function leaveRoom(): void {
  conn.close();
  navigate("/");
}

/* ===== Countdown → reveal → result ===== */

function runCountdown(): void {
  phase = "countdown";
  appEl.innerHTML = `<div class="room-countdown active" id="room-countdown"></div>`;
  countdownEl = document.getElementById("room-countdown");
  let step = 0;

  const tick = () => {
    if (disposed) return;
    if (!countdownEl) return;
    if (step >= ROOM_CALL_SEQUENCE.length) {
      runReveal();
      return;
    }
    const { text, cls, duration } = ROOM_CALL_SEQUENCE[step];
    countdownEl.innerHTML = `<div class="countdown-number ${cls}">${text}</div>`;
    playCallSound();
    step++;
    setTimeout(tick, duration);
  };
  tick();
}

function runReveal(): void {
  phase = "reveal";
  revealCount = 0;
  const me = roundInfo.get(youId);
  appEl.innerHTML = `
    <div class="room-reveal" style="--player-color:${me?.color ?? "#00ff88"}">
      <div class="room-reveal-label">あなた${me ? `（${escapeHtml(labelOf(me.num))}）` : ""}</div>
      <div class="uuid-display room-uuid" id="room-uuid"></div>
      <div class="room-reveal-sub">大きいほど強い…！</div>
    </div>`;
  roomUuidEl = document.getElementById("room-uuid");

  const tick = () => {
    if (disposed || phase !== "reveal") return;
    revealCount++;
    if (roomUuidEl) roomUuidEl.innerHTML = buildUuidRevealHtml(myUuid, revealCount);
    playRevealSound(revealCount);
    if (revealCount < REVEAL_CHARACTER_COUNT) {
      revealTimer = window.setTimeout(tick, getRevealDelay(revealCount));
    } else {
      revealTimer = window.setTimeout(showResult, 600);
    }
  };
  if (roomUuidEl) roomUuidEl.innerHTML = buildUuidRevealHtml(myUuid, 0);
  revealTimer = window.setTimeout(tick, getRevealDelay(revealCount));
}

function showResult(): void {
  phase = "result";
  playFanfareSound();

  const rows = ranked
    .map((p, i) => {
      const info = roundInfo.get(p.id);
      const isYou = p.id === youId;
      const isWinner = i === 0;
      return `
        <li class="room-rank rank-${i + 1}${isWinner ? " winner" : ""}${isYou ? " you" : ""}" style="--player-color:${info?.color ?? "#888"}">
          <span class="room-rank-no">${isWinner ? '<i data-lucide="crown"></i>' : i + 1}</span>
          <span class="room-rank-dot"></span>
          <span class="room-rank-name">${escapeHtml(info ? labelOf(info.num) : "?")}${isYou ? "（あなた）" : ""}</span>
          <span class="room-rank-uuid">${p.uuid}</span>
        </li>`;
    })
    .join("");

  appEl.innerHTML = `
    <div class="room-result">
      <h2 class="room-result-title">結果</h2>
      <ol class="room-ranking">${rows}</ol>
      <div class="room-actions">
        <button type="button" class="room-ready" id="room-again">
          <i data-lucide="refresh-ccw" class="room-again-icon"></i>もう一度
        </button>
        <button type="button" class="room-back solo" id="room-leave">
          <i data-lucide="home" class="room-back-icon"></i>メニューに戻る
        </button>
      </div>
    </div>`;
  createIcons({ icons: ICONS });

  document.getElementById("room-again")?.addEventListener("click", playAgain);
  document.getElementById("room-leave")?.addEventListener("click", leaveRoom);

  // Confetti over the winner's row.
  const first = appEl.querySelector<HTMLElement>(".room-rank.winner");
  if (first) burstParticles(first.getBoundingClientRect());
}

function playAgain(): void {
  prepareAudio();
  stopParticles();
  const you = players.find((p) => p.id === youId);
  if (you) you.ready = true;
  conn.sendReady();
  phase = "lobby";
  renderLobby();
}

/* ===== Connection handlers ===== */

function onRoster(id: string, roster: RoomRosterPlayer[]): void {
  youId = id;
  players = roster;
  connected = true;
  // Only the lobby reflects roster live; mid-round updates are applied to state
  // but the animation/result screens stay put until the player acts.
  if (phase === "lobby") renderLobby();
}

function onStart(startPlayers: RoomStartPlayer[]): void {
  // Ignore a stray start if we're already mid-round.
  if (phase !== "lobby") return;
  roundInfo = new Map(players.map((p) => [p.id, p]));
  ranked = rankByUuid(startPlayers);
  myUuid = startPlayers.find((p) => p.id === youId)?.uuid ?? startPlayers[0]?.uuid ?? "";
  runCountdown();
}

function onDisconnected(): void {
  if (disposed) return;
  connected = false;
  // Drop back to the lobby with a reconnect prompt whatever we were doing.
  clearTimeout(revealTimer);
  phase = "lobby";
  players = [];
  renderLobby();
}

/* ===== View ===== */

export function createRoomView(): View {
  return {
    mount(root, params) {
      disposed = false;
      appEl = root;
      root.classList.add("room");
      roomId = params.id ?? "";
      phase = "lobby";
      youId = "";
      players = [];
      connected = true;
      revealCount = 0;
      initParticles();
      renderLobby();
      conn = new RoomConnection(roomId, { onRoster, onStart, onDisconnected });
      conn.connect();
    },
    unmount() {
      disposed = true;
      clearTimeout(revealTimer);
      conn.close();
      disposeParticles();
    },
  };
}
