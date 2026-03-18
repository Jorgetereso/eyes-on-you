const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs';
const WASM_URL   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.task';

export class SegmentTracker {
  constructor() {
    this.segmenter = null;
    this.ready     = false;
    this.lastTime  = -1;
    this.result    = null;
  }

  async init() {
    const { ImageSegmenter, FilesetResolver } = await import(VISION_URL);
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputCategoryMask:   false,
      outputConfidenceMasks: true,
    });
    this.ready = true;
  }

  detect(videoEl) {
    if (!this.ready || !videoEl.videoWidth) return null;
    const now = performance.now();
    if (videoEl.currentTime === this.lastTime) return this.result;
    this.lastTime = videoEl.currentTime;
    // Free previous GPU masks
    if (this.result) try { this.result.close(); } catch (_) {}
    try {
      this.result = this.segmenter.segmentForVideo(videoEl, now);
    } catch (_) {
      this.result = null;
    }
    return this.result;
  }
}
