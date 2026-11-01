/**
 * Pickup chime from Blocked Pixel Panzer (Blocked.Shared/Managers/PickupSfx.cs, the sound for
 * diamonds and supplies), synthesised the same way: a C5-E5-G5-C6 rising arpeggio, 55 ms per
 * note, sine + 35% octave above, exponential decay, 1 ms attack, normalised to 0.8, 10 ms fade,
 * tanh soft clip. Volume = 0.45 x master x effects (Settings), pitch in octaves with a small
 * random jitter so back-to-back pickups don't sound identical.
 */
const RATE = 44100;
const NOTES = [523.25, 659.25, 783.99, 1046.5];
const NOTE_LEN = 0.055;
const VOLUME = 0.45;

let ctx = null;
let buffer = null;

function build(ac) {
  const n = Math.floor(RATE * NOTE_LEN * NOTES.length);
  const buf = new Float32Array(n);
  NOTES.forEach((f, k) => {
    const off = Math.floor(k * NOTE_LEN * RATE);
    const len = Math.floor(NOTE_LEN * RATE);
    for (let i = 0; i < len && off + i < n; i++) {
      const t = i / RATE;
      const s = Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t);
      buf[off + i] += s * Math.exp(-t * 22) * Math.min(1, t / 0.001);
    }
  });
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max > 1e-6) for (let i = 0; i < n; i++) buf[i] *= 0.8 / max;
  const fade = Math.floor(RATE * 0.01);
  for (let i = 0; i < fade; i++) buf[n - fade + i] *= 1 - i / (fade - 1);
  const out = ac.createBuffer(1, n, RATE);
  const data = out.getChannelData(0);
  // 16-bit PCM in the original: tanh soft clip at 32000 / 32768.
  for (let i = 0; i < n; i++) data[i] = Math.tanh(buf[i]) * (32000 / 32768);
  return out;
}

export const PickupSfx = {
  /** Browsers only start audio after a user gesture: call from the first click / key. */
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        buffer = build(ctx);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch {
      ctx = null;
    }
  },

  /**
   * @param {number} gain 0..1 (master x effects from the settings)
   * @param {number} pan -1 left .. 1 right
   * @param {number} pitch octaves (-1..1)
   */
  play(gain = 1, pan = 0, pitch = 0) {
    if (!ctx || !buffer || gain <= 0) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const p = Math.max(-1, Math.min(1, pitch + (Math.random() - 0.5) * 0.08));
      src.playbackRate.value = Math.pow(2, p);
      const g = ctx.createGain();
      g.gain.value = Math.min(1, VOLUME * gain);
      let node = src.connect(g);
      if (ctx.createStereoPanner) {
        const sp = ctx.createStereoPanner();
        sp.pan.value = Math.max(-1, Math.min(1, pan));
        node = node.connect(sp);
      }
      node.connect(ctx.destination);
      src.start();
    } catch {
      // out of voices: skip
    }
  },
};
