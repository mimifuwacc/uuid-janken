import "./style.css";
import { icon } from "@fortawesome/fontawesome-svg-core";
import { faTwitter } from "@fortawesome/free-brands-svg-icons/faTwitter";
import { createIcons, Swords, RefreshCcw, ChevronsDownUp, Volume2 } from "lucide";
import {
  getRevealDelay,
  getRevealFrequency,
  getRevealShakeDistance,
  REVEAL_CHARACTER_COUNT,
} from "./reveal";
import { createDrawShareUrl, createWinnerShareUrl } from "./share";

const ICONS = { Swords, RefreshCcw, ChevronsDownUp, Volume2 };
const TWITTER_ICON = icon(faTwitter).html.join("");

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
let revealShake: Animation | null = null;
// "最初は / 4〜 / じゃんけん...." — UUID v4 battle cry
const CALL_SEQUENCE: { text: string; cls: string; duration: number }[] = [
  { text: "最初は", cls: "call-saisho", duration: 1000 },
  { text: "4", cls: "call-four", duration: 950 },
  { text: "じゃんけん", cls: "call-janken", duration: 900 },
];
const PARTICLE_COLORS = ["#00ff88", "#ff5f35", "#ffffff", "#ffdd00", "#00cfff", "#ff66cc"];
// Must match the desktop split in style.css (halves side-by-side, not rotated).
const DESKTOP_SPLIT_QUERY = "(min-width: 900px) and (orientation: landscape)";

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

// Rich chord stab for each battle-cry step ("最初は" / "4" / "じゃんけん").
function playCallSound() {
  if (!audioContext) return;
  const ctx = audioContext;
  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const root = 392.0; // G4 — same pitch on every step

  // Root + fifth + octave for a full stab that rings out.
  const voices = [root, root * 1.5, root * 2];
  voices.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i === 0 ? "sawtooth" : "triangle";
    osc.frequency.value = freq;
    osc.detune.value = i === 0 ? -6 : 6;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    gain.gain.setValueAtTime(0.16, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.8);
  });

  // Bright bell sparkle two octaves up, with a long tail.
  const bell = ctx.createOscillator();
  const bellGain = ctx.createGain();
  bell.type = "triangle";
  bell.frequency.value = root * 4;
  bellGain.gain.setValueAtTime(0.0001, now);
  bellGain.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
  bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  bell.connect(bellGain);
  bellGain.connect(master);
  bell.start(now);
  bell.stop(now + 0.65);
}

// "じゃじゃーん！" — a lush fanfare: pickup arpeggio into a big detuned major
// chord, with sub-bass weight, bell sparkles and a cymbal-like shimmer swell.
function playFanfareSound() {
  if (!audioContext) return;
  const ctx = audioContext;
  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  // Glue bus for the tonal layers.
  const bus = ctx.createBiquadFilter();
  bus.type = "lowpass";
  bus.frequency.value = 6500;
  bus.connect(master);

  const playNote = (
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    detune = 0,
  ) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  };

  // Pickup arpeggio: "じゃ・じゃ・じゃ…"
  const pickup = [392.0, 523.25, 659.25];
  pickup.forEach((f, i) => playNote(f, now + i * 0.07, 0.22, "triangle", 0.16));

  // The big chord hit: "ジャーン！" — C major spread across two octaves.
  const hit = now + 0.21;
  const chord = [261.63, 523.25, 659.25, 783.99, 1046.5, 1318.51];
  chord.forEach((f, i) => playNote(f, hit + i * 0.012, 1.4, "sawtooth", 0.13, i % 2 ? 7 : -7));

  // Sub-bass thump for weight, and bright bell sparkles on top.
  playNote(130.81, hit, 1.1, "sine", 0.4);
  playNote(2093.0, hit + 0.02, 1.5, "triangle", 0.07);
  playNote(2637.02, hit + 0.07, 1.3, "triangle", 0.05);

  // Cymbal-like shimmer: high-passed noise swell.
  const noiseDur = 1.3;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, hit);
  noiseGain.gain.exponentialRampToValueAtTime(0.05, hit + 0.05);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, hit + noiseDur);
  noise.connect(hp);
  hp.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(hit);
  noise.stop(hit + noiseDur);
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
  // Clear the "準備完了！" labels — they're not needed during the count.
  setStatus(0, "");
  setStatus(1, "");
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
    playCallSound();
    step++;

    setTimeout(tick, duration);
  };

  tick();
}

function startReveal() {
  phase = "reveal";
  revealCount = 0;
  const app = document.getElementById("app")!;
  refreshUUIDs();

  const tick = () => {
    if (phase !== "reveal") return;
    revealCount++;
    const shakeDistance = getRevealShakeDistance(revealCount);
    refreshUUIDs();
    playRevealSound();
    playRevealShake(app, shakeDistance);
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
  revealShake?.cancel();
  playFanfareSound();

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
    const replayLabel = winner === "draw" ? "あいこでしょ" : "もう一度";
    const makeBtn = (target: HTMLElement) => {
      const btn = document.createElement("button");
      btn.className = "replay-btn";
      btn.innerHTML = `<i data-lucide="refresh-ccw" class="btn-icon"></i>${replayLabel}`;
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        resetGame();
      });
      btn.addEventListener("click", resetGame);
      target.appendChild(btn);
    };
    const makeShareBtn = (target: HTMLElement, href: string) => {
      const shareLink = document.createElement("a");
      shareLink.className = "share-btn";
      shareLink.href = href;
      shareLink.target = "_blank";
      shareLink.rel = "noopener noreferrer";
      shareLink.innerHTML = `${TWITTER_ICON}ツイートする`;
      target.appendChild(shareLink);
    };
    makeBtn(replaySlots[0]);
    makeBtn(replaySlots[1]);
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
    createIcons({ icons: ICONS });
  }, 1800);
}

function resetGame() {
  clearTimeout(revealTimer);
  cancelAnimationFrame(rafId);
  revealShake?.cancel();
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
      <div class="sound-note"><i data-lucide="volume-2" class="sound-note-icon"></i>音が出ます</div>
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

init();
