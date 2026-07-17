// Web Audio SFX shared by the 1v1 game and the room mode. One AudioContext for
// the whole app, resumed on the first user gesture via prepareAudio().

import { getRevealFrequency } from "../reveal";

let audioContext: AudioContext | null = null;

export function prepareAudio() {
  audioContext ??= new AudioContext();
  void audioContext.resume();
}

// Short blip per revealed character, rising in pitch as more are opened.
export function playRevealSound(revealCount: number) {
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
export function playCallSound() {
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
export function playFanfareSound() {
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
