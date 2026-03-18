import { CameraManager } from './camera.js';
import { AudioManager } from './audio.js';
import { VisualizerEngine } from './visualizer.js';
import { FaceTracker } from './face.js';
import { SegmentTracker } from './segment.js';
import { WarpRenderer } from './warp.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const videoEl     = document.getElementById('camera-feed');
const canvasEl    = document.getElementById('viz-canvas');
const audioEl     = document.getElementById('audio-player');
const tapOverlay  = document.getElementById('tap-to-begin');
const btnMic      = document.getElementById('btn-mic');
const btnFlip     = document.getElementById('btn-flip');
const btnCapture  = document.getElementById('btn-capture');
const fileInput   = document.getElementById('file-input');
const albumEl     = document.getElementById('album');

// ─── Managers ────────────────────────────────────────────────────────────────
const camera     = new CameraManager(videoEl);
const audio      = new AudioManager(audioEl);
const visualizer = new VisualizerEngine(canvasEl);
const faceTracker    = new FaceTracker();
const segmentTracker = new SegmentTracker();
const warpRenderer   = new WarpRenderer(canvasEl, videoEl);

// ─── State ───────────────────────────────────────────────────────────────────
let state = 'idle'; // idle | camera-starting | running
let rafId = null;
let micActive = false;
let smoothExcitement = 0;

// ─── RAF loop ─────────────────────────────────────────────────────────────────
function loop() {
  rafId = requestAnimationFrame(loop);

  const faceResult = faceTracker.ready    ? faceTracker.detect(videoEl)    : null;
  const segResult  = segmentTracker.ready ? segmentTracker.detect(videoEl) : null;

  if (faceTracker.ready || segmentTracker.ready) {
    warpRenderer.render(faceResult, segResult);
  }

  // Excitement: weighted sum of expression blendshapes → 0–1000
  const cats = faceResult?.faceBlendshapes?.[0]?.categories;
  if (cats) {
    const b   = Object.fromEntries(cats.map(c => [c.categoryName, c.score]));
    const raw = Math.min(1,
      (b['jawOpen']        ?? 0) * 0.35 +
      ((b['mouthSmileLeft'] ?? 0) + (b['mouthSmileRight'] ?? 0)) * 0.5 * 0.25 +
      Math.max(b['browInnerUp'] ?? 0, b['browOuterUpLeft'] ?? 0, b['browOuterUpRight'] ?? 0) * 0.2 +
      Math.max(b['eyeWideLeft'] ?? 0, b['eyeWideRight'] ?? 0) * 0.2,
    );
    smoothExcitement = smoothExcitement * 0.88 + raw * 0.12;
  }

  const bands    = audio.getBands();
  const freqData = audio.getFrequencyData();
  const timeData = audio.getTimeDomainData();
  visualizer.render(bands, freqData, timeData, Math.round(smoothExcitement * 1000));

  animateAlbum();
}

function startLoop() {
  if (rafId !== null) return;
  loop();
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ─── Initialization (runs after first tap) ───────────────────────────────────
async function beginExperience() {
  if (state !== 'idle') return;
  state = 'running';

  // AudioContext must be created inside a user gesture
  audio.init();

  // Initial canvas size + hide overlay immediately so the UI feels responsive
  visualizer.resize();
  tapOverlay.classList.add('hidden');
  startLoop();

  // Camera starts in the background — permission prompt may delay it
  try {
    await camera.start('user');
  } catch (err) {
    console.warn('Camera unavailable:', err);
  }

  // Load face tracker after camera is up (downloads WASM + model in background)
  // Both trackers init in parallel — hide CSS video once either is ready
  let trackersActivated = false;
  const onTrackerReady = () => {
    if (trackersActivated) return;
    trackersActivated = true;
    visualizer.autoClear = false;
    videoEl.style.opacity = '0';
  };

  faceTracker.init().then(onTrackerReady).catch(err => console.warn('Face tracking unavailable:', err));
  segmentTracker.init().then(onTrackerReady).catch(err => console.warn('Segmentation unavailable:', err));
}

// ─── Tap to begin ─────────────────────────────────────────────────────────────
tapOverlay.addEventListener('click', beginExperience, { once: true });
tapOverlay.addEventListener('touchend', (e) => {
  e.preventDefault();
  beginExperience();
}, { once: true, passive: false });

// ─── Mic button ───────────────────────────────────────────────────────────────
btnMic.addEventListener('click', async () => {
  if (state !== 'running') return;

  if (micActive) {
    // Toggle off: just stop mic stream
    if (audio.micStream) {
      audio.micStream.getTracks().forEach(t => t.stop());
      audio.micStream = null;
    }
    micActive = false;
    btnMic.classList.remove('active');
    return;
  }

  try {
    await audio.context?.resume();
    await audio.startMic();
    micActive = true;
    btnMic.classList.add('active');
  } catch (err) {
    console.error('Mic error:', err);
  }
});

// ─── File upload ──────────────────────────────────────────────────────────────
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (state !== 'running') return;

  // Must call play() directly in this handler for iOS autoplay policy
  audio.loadFile(file);
  try {
    await audio.context?.resume();
    await audioEl.play();
    micActive = false;
    btnMic.classList.remove('active');
  } catch (err) {
    console.error('Audio play error:', err);
  }

  // Reset file input so same file can be re-selected
  fileInput.value = '';
});

// ─── Camera capture + animated album ──────────────────────────────────────────
const albumPhotos = []; // { el, birthTime, pathIndex }
let albumPathCounter = 0;

const ALBUM_PATHS = [
  (t, i) => ({
    x: Math.cos(t * 0.8 + i * 1.7) * 45,
    y: Math.sin(t * 1.2 + i * 1.7) * 120 + i * 18,
  }),
  (t, i) => ({
    x: Math.sin(t * 0.6 + i * 2.1) * 50,
    y: Math.sin(t * 1.2 + i * 2.1) * 100 + i * 22,
  }),
  (t, i) => {
    const r = 20 + (t * 0.3 + i * 8) % 80;
    return { x: Math.cos(t * 0.9 + i * 1.3) * r, y: Math.sin(t * 0.7 + i * 1.3) * r + i * 15 };
  },
  (t, i) => ({
    x: ((((t * 0.5 + i) % 4) < 2 ? ((t * 0.5 + i) % 2) : 2 - ((t * 0.5 + i) % 2)) - 1) * 55,
    y: Math.sin(t * 0.4 + i * 0.9) * 30 + i * 25,
  }),
  (t, i) => {
    const p = (t * 0.7 + i * 1.5) % (Math.PI * 2);
    const d = Math.abs(Math.cos(p)) + Math.abs(Math.sin(p));
    return { x: Math.cos(p) / d * 55, y: Math.sin(p) / d * 100 + i * 20 };
  },
];

function animateAlbum() {
  const now = performance.now() / 1000;
  for (let i = 0; i < albumPhotos.length; i++) {
    const photo = albumPhotos[i];
    const age = now - photo.birthTime;
    const pathFn = ALBUM_PATHS[photo.pathIndex % ALBUM_PATHS.length];
    const { x, y } = pathFn(now, i);
    const fadeIn = Math.min(1, age * 2);
    const rot = Math.sin(now * 0.5 + i * 1.1) * 8;
    photo.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
    photo.el.style.opacity = (0.75 * fadeIn).toFixed(2);
  }
}

btnCapture.addEventListener('click', () => {
  if (state !== 'running') return;
  const thumb = document.createElement('canvas');
  thumb.width  = 288;
  thumb.height = Math.round(288 * (canvasEl.height / canvasEl.width));
  thumb.getContext('2d').drawImage(canvasEl, 0, 0, thumb.width, thumb.height);
  const img = document.createElement('img');
  img.src       = thumb.toDataURL('image/jpeg', 0.75);
  img.className = 'album-photo';
  albumEl.prepend(img);
  albumPhotos.unshift({
    el: img,
    birthTime: performance.now() / 1000,
    pathIndex: albumPathCounter++,
  });
  while (albumEl.children.length > 14) {
    albumEl.lastChild.remove();
    albumPhotos.pop();
  }
});

// ─── Flip button ──────────────────────────────────────────────────────────────
btnFlip.addEventListener('click', async () => {
  if (state !== 'running') return;
  try {
    await camera.flip();
  } catch (err) {
    console.error('Camera flip error:', err);
  }
});

// ─── Resize / orientation ────────────────────────────────────────────────────
function onResize() {
  visualizer.resize();
}

window.addEventListener('resize', onResize);
screen.orientation?.addEventListener('change', onResize);

// ─── Visibility change ────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopLoop();
  } else {
    audio.context?.resume().catch(() => {});
    if (state === 'running') startLoop();
  }
});

// ─── Service Worker registration ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}
