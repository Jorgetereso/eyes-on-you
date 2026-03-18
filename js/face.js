const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs';
const WASM_URL   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.lastTime   = -1;
    this.result     = null;
    this.ready      = false;
  }

  async init() {
    const { FaceLandmarker, FilesetResolver } = await import(VISION_URL);
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      outputFaceBlendshapes: true,
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    this.ready = true;
  }

  detect(videoEl) {
    if (!this.ready || !videoEl.videoWidth) return null;
    const now = performance.now();
    if (videoEl.currentTime === this.lastTime) return this.result;
    this.lastTime = videoEl.currentTime;
    try {
      this.result = this.landmarker.detectForVideo(videoEl, now);
    } catch (_) {
      this.result = null;
    }
    return this.result;
  }
}
