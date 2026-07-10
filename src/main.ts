import "./style.css";
import { createIcons, Swords, RefreshCcw, ChevronsDownUp } from "lucide";
import {
  getRevealDelay,
  getRevealFrequency,
  getRevealShakeDistance,
  REVEAL_CHARACTER_COUNT,
} from "./reveal";

const ICONS = { Swords, RefreshCcw, ChevronsDownUp };

type Phase = "idle" | "countdown" | "reveal" | "result";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  shape: "rect" | "circle";
  rotation: number;
  rotSpeed: number;
}

let phase: Phase = "idle";
let ready: [boolean, boolean] = [false, false];
let uuids: [string, string] = ["", ""];
let revealCount = 0;
let winner: 0 | 1 | "draw" | null = null;
let particles: Particle[] = [];
let rafId = 0;
let revealTimer = 0;
let audioContext: AudioContext | null = null;
// "最初は / 4〜 / じゃんけん...." — UUID v4 battle cry
const CALL_SEQUENCE: { text: string; cls: string; duration: number }[] = [
  { text: "最初は", cls: "call-saisho", duration: 750 },
  { text: "4", cls: "call-four", duration: 850 },
  { text: "じゃんけん", cls: "call-janken", duration: 1050 },
];
const PARTICLE_COLORS = ["#00ff88", "#ff5f35", "#ffffff", "#ffdd00", "#00cfff", "#ff66cc"];

let halfEls: [HTMLElement, HTMLElement];
let uuidEls: [HTMLElement, HTMLElement];
let statusEls: [HTMLElement, HTMLElement];
let replaySlots: [HTMLElement, HTMLElement];
let countdownEl: HTMLElement;
let countdownHalves: [HTMLElement, HTMLElement];
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

function buildUUID(): string {
  return crypto.randomUUID();
}

function compareUUIDs(a: string, b: string): "a" | "b" | "draw" {
  const n = (s: string) => s.replace(/-/g, "").toUpperCase();
  const na = n(a),
    nb = n(b);
  if (na > nb) return "a";
  if (na < nb) return "b";
  return "draw";
}

function buildUUIDHtml(playerIdx: 0 | 1): string {
  const uuid = uuids[playerIdx];
  if (!uuid) return "";

  const revealFrom = 36 - revealCount;

  const spans = uuid.split("").map((ch, i) => {
    const isDash = ch === "-";
    if (i >= revealFrom) {
      const isNew = i === revealFrom;
      const cls = ["uuid-char", isDash ? "dash" : "", "revealed", isNew ? "new" : ""]
        .filter(Boolean)
        .join(" ");
      return `<span class="${cls}">${ch}</span>`;
    }
    return `<span class="uuid-char${isDash ? " dash" : ""}">${isDash ? "-" : "·"}</span>`;
  });

  // Split into two rows at the third dash (index 18) for larger font
  const row1 = spans.slice(0, 18).join("");
  const row2 = spans.slice(18).join("");
  return `<div class="uuid-row">${row1}</div><div class="uuid-row">${row2}</div>`;
}

function refreshUUIDs() {
  for (let p = 0 as 0 | 1; p < 2; p = (p + 1) as 0 | 1) {
    uuidEls[p].innerHTML = buildUUIDHtml(p);
  }
}

function setStatus(p: 0 | 1, html: string) {
  statusEls[p].innerHTML = html;
}

function prepareAudio() {
  audioContext ??= new AudioContext();
  void audioContext.resume();
}

function playRevealSound() {
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  oscillator.type = "square";
  oscillator.frequency.value = getRevealFrequency(revealCount);
  gain.gain.setValueAtTime(0.035, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.05);
}

function spawnRipple(half: HTMLElement, x: number, y: number) {
  const rect = half.getBoundingClientRect();
  const r = document.createElement("div");
  r.className = "ripple";
  r.style.left = `${x - rect.left}px`;
  r.style.top = `${y - rect.top}px`;
  half.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

function onTap(player: 0 | 1, x: number, y: number) {
  prepareAudio();
  if (phase !== "idle") return;
  if (ready[player]) return;

  ready[player] = true;
  halfEls[player].classList.add("ready");
  spawnRipple(halfEls[player], x, y);
  setStatus(player, "準備完了！");

  if (ready[0] && ready[1]) {
    startCountdown();
  }
}

function startCountdown() {
  phase = "countdown";
  uuids[0] = buildUUID();
  uuids[1] = buildUUID();
  revealCount = 0;

  countdownEl.classList.add("active");
  let step = 0;

  const tick = () => {
    if (step >= CALL_SEQUENCE.length) {
      countdownHalves[0].innerHTML = "";
      countdownHalves[1].innerHTML = "";
      countdownEl.classList.remove("active");
      startReveal();
      return;
    }

    const { text, cls, duration } = CALL_SEQUENCE[step];
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
    step++;

    setTimeout(tick, duration);
  };

  tick();
}

function startReveal() {
  phase = "reveal";
  revealCount = 0;
  const app = document.getElementById("app")!;
  app.classList.add("revealing");
  refreshUUIDs();

  const tick = () => {
    if (phase !== "reveal") return;
    revealCount++;
    const shakeDistance = getRevealShakeDistance(revealCount);
    app.style.setProperty("--reveal-shake-distance", `${shakeDistance}px`);
    app.style.setProperty("--reveal-shake-distance-negative", `${-shakeDistance}px`);
    refreshUUIDs();
    playRevealSound();
    if (revealCount < REVEAL_CHARACTER_COUNT) {
      revealTimer = window.setTimeout(tick, getRevealDelay(revealCount));
    } else {
      revealTimer = window.setTimeout(showResult, 600);
    }
  };

  revealTimer = window.setTimeout(tick, getRevealDelay(revealCount));
}

function spawnParticles(winnerIdx: 0 | 1) {
  const rect = halfEls[winnerIdx].getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  for (let i = 0; i < 120; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 10;
    particles.push({
      x: cx + (Math.random() - 0.5) * rect.width * 0.6,
      y: cy + (Math.random() - 0.5) * rect.height * 0.4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      size: 4 + Math.random() * 7,
      life: 0.8 + Math.random() * 0.2,
      shape: Math.random() > 0.45 ? "rect" : "circle",
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.25,
    });
  }

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;
      p.vx *= 0.985;
      p.life -= 0.012;
      p.rotation += p.rotSpeed;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.min(p.life * 1.8, 1);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 6;
      ctx.shadowColor = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);

      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.55);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (particles.length > 0) {
      rafId = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  rafId = requestAnimationFrame(draw);
}

function showResult() {
  phase = "result";
  const app = document.getElementById("app")!;
  app.classList.remove("revealing");
  app.style.removeProperty("--reveal-shake-distance");
  app.style.removeProperty("--reveal-shake-distance-negative");

  const cmp = compareUUIDs(uuids[0], uuids[1]);
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
    setTimeout(() => app.classList.remove("shaking"), 500);
    setStatus(winner, "WIN！");
    setStatus(loser, "LOSE...");
    spawnParticles(winner);
  }

  setTimeout(() => {
    const makeBtn = (target: HTMLElement) => {
      const btn = document.createElement("button");
      btn.className = "replay-btn";
      btn.innerHTML = `<i data-lucide="refresh-ccw" class="btn-icon"></i>もう一度`;
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        resetGame();
      });
      btn.addEventListener("click", resetGame);
      target.appendChild(btn);
    };
    makeBtn(replaySlots[0]);
    makeBtn(replaySlots[1]);
    createIcons({ icons: ICONS });
  }, 1800);
}

function resetGame() {
  clearTimeout(revealTimer);
  cancelAnimationFrame(rafId);
  particles = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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
  setStatus(0, "タップして準備");
  setStatus(1, "タップして準備");

  createIcons({ icons: ICONS });
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function init() {
  const app = document.getElementById("app")!;

  // Both halves share the SAME DOM order (divider → outward). rotate(180deg)
  // on the top half makes that order read naturally for the facing player,
  // so identical DOM = mirror-symmetric appearance.
  const halfInner = (player: 1 | 2) => `
      <div class="tap-hint"><i data-lucide="swords" class="tap-icon"></i></div>
      <div class="uuid-display" id="uuid-${player === 1 ? 0 : 1}"></div>
      <div class="status" id="status-${player === 1 ? 0 : 1}">タップして準備</div>
      <div class="replay-slot" id="replay-${player === 1 ? 0 : 1}"></div>
      <div class="player-label">PLAYER ${player}</div>`;

  app.innerHTML = `
    <div class="half top" id="half-1">${halfInner(2)}</div>
    <div class="divider"><i data-lucide="chevrons-down-up" class="divider-icon"></i></div>
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
  countdownEl = document.getElementById("countdown") as HTMLElement;
  countdownHalves = [
    document.getElementById("countdown-bottom") as HTMLElement,
    document.getElementById("countdown-top") as HTMLElement,
  ];

  canvas = document.getElementById("particles") as HTMLCanvasElement;
  ctx = canvas.getContext("2d")!;
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const addTapListeners = (el: HTMLElement, player: 0 | 1) => {
    el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        const t = e.touches[0];
        onTap(player, t.clientX, t.clientY);
      },
      { passive: false },
    );
    el.addEventListener("click", (e) => {
      onTap(player, e.clientX, e.clientY);
    });
  };

  addTapListeners(halfEls[0], 0);
  addTapListeners(halfEls[1], 1);
}

init();
