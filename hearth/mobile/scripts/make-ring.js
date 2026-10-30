#!/usr/bin/env node
// Writes ios-native/resources/ring.wav, the sound an incoming call's notification plays on an iPhone (the server
// sends aps.sound "ring.wav"; NotificationService keeps it for a fresh ring). iOS plays a notification sound once
// and only if it is 30 seconds or shorter, so this is 15 seconds: five rounds of a soft two-note chime, each note
// played twice, then a pause. Mono 16-bit PCM at 16 kHz (about 480 KB), which iOS accepts in a WAV file.
// Made from code so it's ours to ship and the same every time: `node scripts/make-ring.js` (from hearth/mobile).
'use strict';
const fs = require('fs');
const path = require('path');

const RATE = 16000;
const ROUND = 3;   // seconds per round
const ROUNDS = 5;
// E6 then B5, a falling fourth, at these times (seconds) into each round.
const NOTES = [[0, 1318.5], [0.22, 987.77], [0.6, 1318.5], [0.82, 987.77]];
const NOTE_LEN = 0.9;

function samples() {
  const out = new Float64Array(RATE * ROUND * ROUNDS);
  for (let r = 0; r < ROUNDS; r++) {
    for (const [at, f] of NOTES) {
      const start = Math.round((r * ROUND + at) * RATE);
      for (let i = 0; i < NOTE_LEN * RATE && start + i < out.length; i++) {
        const t = i / RATE;
        // A bell-like note: a quick attack, an exponential fade, and two quieter overtones that fade faster.
        const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.22);
        const tone = Math.sin(2 * Math.PI * f * t)
          + 0.25 * Math.sin(2 * Math.PI * 2 * f * t) * Math.exp(-t / 0.08)
          + 0.08 * Math.sin(2 * Math.PI * 3 * f * t) * Math.exp(-t / 0.05);
        out[start + i] += env * tone;
      }
    }
  }
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const gain = 0.7 / peak; // about -3 dBFS
  return out.map((s) => s * gain);
}

function wav(data) {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);         // fmt chunk size
  buf.writeUInt16LE(1, 20);          // PCM
  buf.writeUInt16LE(1, 22);          // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);   // bytes per second
  buf.writeUInt16LE(2, 32);          // bytes per frame
  buf.writeUInt16LE(16, 34);         // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data.length * 2, 40);
  data.forEach((s, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2));
  return buf;
}

const file = path.join(__dirname, '..', 'ios-native', 'resources', 'ring.wav');
fs.writeFileSync(file, wav(samples()));
console.log(`${path.relative(process.cwd(), file)}: ${ROUND * ROUNDS} s, ${fs.statSync(file).size} bytes`);
