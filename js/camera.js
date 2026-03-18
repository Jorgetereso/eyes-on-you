export class CameraManager {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.facingMode = 'user'; // front camera
  }

  async start(facingMode = this.facingMode) {
    this.facingMode = facingMode;
    const constraints = {
      video: {
        facingMode: this.facingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.stream = stream;
    this.videoEl.srcObject = stream;

    // iOS requires a user-gesture context; play() here is safe because
    // start() is always called from a tap handler.
    await this.videoEl.play();
  }

  async flip() {
    this.stop();
    const next = this.facingMode === 'user' ? 'environment' : 'user';
    await this.start(next);
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.videoEl.srcObject = null;
  }
}
