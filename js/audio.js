const AudioCtx = window.AudioContext || window.webkitAudioContext;

export class AudioManager {
  constructor(audioEl) {
    this.audioEl = audioEl;
    this.context = null;
    this.analyser = null;
    this.freqData = null;
    this.timeData = null;
    this.micStream = null;
    this.fileSource = null;

    // Smoothed band values (0–1)
    this.bands = { bass: 0, mid: 0, treble: 0, presence: 0 };
  }

  init() {
    if (this.context) return;
    this.context = new AudioCtx();

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyser.connect(this.context.destination);

    const bins = this.analyser.frequencyBinCount; // 1024
    this.freqData = new Uint8Array(bins);
    this.timeData = new Uint8Array(this.analyser.fftSize);

    // Attempt immediate resume (iOS gesture context)
    this.context.resume().catch(() => {});

    // Resume on page visibility restore
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.context?.resume().catch(() => {});
      }
    });
  }

  async startMic() {
    this.init();
    await this.context.resume();

    // Disconnect any previous file source
    if (this.fileSource) {
      try { this.fileSource.disconnect(); } catch (_) {}
      this.fileSource = null;
    }

    // Stop any previous mic stream
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.micStream = stream;
    const src = this.context.createMediaStreamSource(stream);
    src.connect(this.analyser);
  }

  loadFile(file) {
    this.init();

    // Disconnect previous file source
    if (this.fileSource) {
      try { this.fileSource.disconnect(); } catch (_) {}
      this.fileSource = null;
    }

    // Stop mic if active
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    const url = URL.createObjectURL(file);
    this.audioEl.src = url;

    // createMediaElementSource must be called only once per element
    if (!this._elementSourceCreated) {
      this.fileSource = this.context.createMediaElementSource(this.audioEl);
      this.fileSource.connect(this.analyser);
      this._elementSourceCreated = true;
    }
  }

  getBands() {
    if (!this.analyser) return this.bands;
    this.analyser.getByteFrequencyData(this.freqData);

    const avg = (lo, hi) => {
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += this.freqData[i];
      return sum / ((hi - lo) * 255);
    };

    const raw = {
      bass:     avg(1, 20),
      mid:      avg(20, 100),
      treble:   avg(100, 300),
      presence: avg(300, 600),
    };

    // Exponential smoothing: 80% old, 20% new
    const a = 0.8;
    this.bands.bass     = this.bands.bass     * a + raw.bass     * (1 - a);
    this.bands.mid      = this.bands.mid      * a + raw.mid      * (1 - a);
    this.bands.treble   = this.bands.treble   * a + raw.treble   * (1 - a);
    this.bands.presence = this.bands.presence * a + raw.presence * (1 - a);

    return this.bands;
  }

  getFrequencyData() {
    if (this.analyser) this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  getTimeDomainData() {
    if (this.analyser) this.analyser.getByteTimeDomainData(this.timeData);
    return this.timeData;
  }
}
