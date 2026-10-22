// Phone videos are big (half a minute of 1080p is about 60 MB) and this server's limit is usually smaller, and since
// messages are end-to-end encrypted the server can't make them smaller itself. So a video over the limit is made
// smaller on the device before it's encrypted and sent: up to 1280 px on its long side, at a bitrate that fits the
// limit, with the browser's own encoder (MediaRecorder): MP4 (H.264/AAC) where the browser has it (iPhone, Chrome),
// otherwise WebM. The browser has to play the video through to record it, so it takes as long as the video lasts,
// silently, with the progress where the upload's is (app.js deliver). It pauses while Hearth is out of sight (a phone
// stops playing then) and goes on when it's back.
//
// Phones only let a video play with sound after a tap, so startShrink() is called in the tap that sends (app.js
// send), before anything else waits: it makes the video and the audio routing and starts playing (into the
// recording, never the speaker). run() then does the work.
export const MAX_SIDE = 1280;
export const MAX_VIDEO_BPS = 2500000;
// Below this a video is too long to fit, even made smaller: it would be mush.
export const MIN_VIDEO_BPS = 220000;
const MARGIN = 0.85; // encoders overshoot a little; the result is checked anyway
const TYPES = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

const even = (x) => Math.max(2, Math.round(x / 2) * 2);
// The recording format this browser can make (null: it can't).
export function pickType(isSupported = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
  return TYPES.find((t) => { try { return isSupported(t); } catch { return false; } }) || null;
}
export function canShrink() {
  return typeof document !== 'undefined' && typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function' && !!pickType();
}
// What the smaller video will be for a video this long and this big, to fit in maxBytes: its size and bitrates, or
// null when it's too long to fit.
export function plan({ duration, width, height, maxBytes }) {
  if (!(duration > 0) || !Number.isFinite(duration) || !(maxBytes > 0)) return null;
  const budget = (maxBytes * 8 * MARGIN) / duration; // bits per second for sound and picture together
  const audioBps = budget > 1000000 ? 128000 : 64000;
  const videoBps = Math.min(MAX_VIDEO_BPS, budget - audioBps);
  if (videoBps < MIN_VIDEO_BPS) return null;
  // Fewer bits look better on fewer pixels.
  const long = videoBps >= 1500000 ? MAX_SIDE : videoBps >= 700000 ? 960 : 640;
  const w = width > 0 ? width : 1280; const h = height > 0 ? height : 720;
  const scale = Math.min(1, long / Math.max(w, h));
  return { width: even(w * scale), height: even(h * scale), videoBps: Math.round(videoBps), audioBps };
}
// How long a video can be and still fit in maxBytes once made smaller (seconds).
export const longestFitting = (maxBytes) => Math.floor((maxBytes * 8 * MARGIN) / (MIN_VIDEO_BPS + 64000));

// A video's length and size, read from the file without playing it.
export function probe(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (r) => { clearTimeout(t); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(r); };
    const t = setTimeout(() => done(null), 15000);
    v.preload = 'metadata'; v.muted = true; v.playsInline = true;
    v.onerror = () => done(null);
    v.onloadedmetadata = () => {
      // A recording straight from a browser has no length in it until it's been looked through to the end.
      if (Number.isFinite(v.duration)) return done({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      v.ondurationchange = () => { if (Number.isFinite(v.duration)) done({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); };
      v.currentTime = 1e9;
    };
    v.src = url;
  });
}

const cancelled = () => Object.assign(new Error('Upload cancelled.'), { cancelled: true });

// Called in the tap that sends. Returns { run({ maxBytes, onProgress, signal }) → Promise<File>, stop() }.
export function startShrink(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.playsInline = true; video.preload = 'auto';
  // On the page (some phones don't draw a video that isn't), but not to be seen or touched.
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
  video.setAttribute('aria-hidden', 'true');
  video.className = 'shrink-source';
  document.body.append(video);
  // The sound goes into the recording only: the element's own output is taken over by the audio graph, which isn't
  // connected to the speaker.
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null; let dest = null;
  try {
    ac = new AC();
    dest = ac.createMediaStreamDestination();
    ac.createMediaElementSource(video).connect(dest);
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  } catch { ac = null; dest = null; }
  video.src = url;
  // Playing now, in the tap, lets it play (with sound) later on phones; it waits at the start until run() is ready.
  const blessed = video.play().then(() => { video.pause(); return true; }, () => false);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { video.pause(); } catch { /* gone */ }
    video.removeAttribute('src'); video.load(); video.remove();
    URL.revokeObjectURL(url);
    if (ac) ac.close().catch(() => {});
  };
  async function run({ maxBytes, onProgress = () => {}, signal } = {}) {
    try {
      if (signal && signal.aborted) throw cancelled();
      if (video.readyState < 1) await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('This video can’t be opened here, so it can’t be made smaller.')); });
      await blessed;
      const info = await probe(file);
      const p = info && plan({ ...info, maxBytes });
      if (!p) throw new Error(info ? 'This video is too long to send here, even made smaller.' : 'This video can’t be opened here, so it can’t be made smaller.');
      const type = pickType();
      const canvas = document.createElement('canvas');
      canvas.width = p.width; canvas.height = p.height;
      const g = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      if (dest) dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: p.videoBps, audioBitsPerSecond: p.audioBps });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const finished = new Promise((resolve, reject) => { rec.onstop = resolve; rec.onerror = (e) => reject(e.error || new Error('Making the video smaller failed.')); });
      // Each frame the video shows goes onto the canvas the recorder records.
      let drawing = true;
      const draw = () => { if (!drawing) return; g.drawImage(video, 0, 0, p.width, p.height); next(); };
      const next = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw));
      // Out of sight a phone stops the video: the recording waits with it, and both go on once Hearth is back.
      const onVisible = () => {
        if (document.hidden) { video.pause(); return; }
        if (!stopped && !video.ended && rec.state === 'paused') video.play().catch(() => {});
      };
      const onPause = () => { if (!video.ended && rec.state === 'recording') rec.pause(); };
      const onPlay = () => { if (rec.state === 'paused') rec.resume(); };
      const onAbort = () => { drawing = false; if (rec.state !== 'inactive') rec.stop(); };
      document.addEventListener('visibilitychange', onVisible);
      video.addEventListener('pause', onPause);
      video.addEventListener('play', onPlay);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const tick = setInterval(() => onProgress(Math.min(0.99, video.currentTime / info.duration)), 500);
      try {
        video.currentTime = 0;
        g.drawImage(video, 0, 0, p.width, p.height);
        rec.start(1000);
        next();
        const ended = new Promise((resolve) => { video.onended = resolve; });
        if (!document.hidden) await video.play();
        else rec.pause();
        await Promise.race([ended, finished]);
        drawing = false;
        if (rec.state !== 'inactive') rec.stop();
        await finished;
      } finally {
        clearInterval(tick);
        document.removeEventListener('visibilitychange', onVisible);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('play', onPlay);
        if (signal) signal.removeEventListener('abort', onAbort);
        stream.getTracks().forEach((tr) => tr.stop());
      }
      if (signal && signal.aborted) throw cancelled();
      const base = type.split(';')[0];
      const blob = new Blob(chunks, { type: base });
      if (!blob.size) throw new Error('Making the video smaller failed.');
      if (blob.size > maxBytes) throw new Error('The video is still too big after making it smaller. Trim it and try again.');
      onProgress(1);
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'video'}.${base === 'video/mp4' ? 'mp4' : 'webm'}`, { type: base });
    } finally { stop(); }
  }
  return { run, stop };
}
