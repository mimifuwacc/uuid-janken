// Confetti burst on the shared full-screen #particles canvas, used for the
// winner celebration in both the 1v1 game and the room ranking.

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

const PARTICLE_COLORS = ["#00ff88", "#ff5f35", "#ffffff", "#ffdd00", "#00cfff", "#ff66cc"];

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let rafId = 0;

function resize(): void {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// Grabs the global #particles canvas and starts tracking the viewport size.
export function initParticles(): void {
  canvas = document.getElementById("particles") as HTMLCanvasElement;
  ctx = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
}

function draw(): void {
  if (!ctx || !canvas) return;
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
    rafId = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// Sprays confetti outward from the centre of `rect` (e.g. the winner's area).
export function burstParticles(rect: DOMRect): void {
  if (!ctx || !canvas) return;
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

  if (!rafId) rafId = requestAnimationFrame(draw);
}

// Stops the animation and clears the canvas (call on reset / round restart).
export function stopParticles(): void {
  cancelAnimationFrame(rafId);
  rafId = 0;
  particles = [];
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Full teardown when a view unmounts.
export function disposeParticles(): void {
  stopParticles();
  window.removeEventListener("resize", resize);
  canvas = null;
  ctx = null;
}
