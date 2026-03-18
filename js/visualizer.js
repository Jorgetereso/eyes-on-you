const TAU = Math.PI * 2;

export class VisualizerEngine {
  constructor(canvas) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.dpr       = window.devicePixelRatio || 1;
    this.autoClear = true; // set false when WarpRenderer owns the clear

    // Particles
    this.PARTICLE_COUNT = 120;
    this.particles = [];

    // Beat detection state
    this.lastBeatTime = 0;
    this.smoothedBass = 0;
    this.beatRings = []; // { radius, maxRadius, alpha }

    // Offscreen canvas for scan lines
    this.scanCanvas = null;
    this.scanCtx = null;

    this._initParticles();
    this._buildScanLines();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.scale(dpr, dpr);
    this._initParticles();
    this._buildScanLines();
  }

  _initParticles() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.particles = Array.from({ length: this.PARTICLE_COUNT }, (_, i) => ({
      homeX: Math.random() * W,
      homeY: Math.random() * H,
      x: Math.random() * W,
      y: Math.random() * H,
      vx: 0,
      vy: 0,
      freqBin: Math.floor(Math.random() * 512),
      size: 1 + Math.random() * 2,
    }));
  }

  _buildScanLines() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sc = document.createElement('canvas');
    sc.width = W;
    sc.height = H;
    const sCtx = sc.getContext('2d');
    sCtx.fillStyle = 'rgba(255,220,0,1)';
    for (let y = 0; y < H; y += 4) {
      sCtx.fillRect(0, y, W, 1);
    }
    this.scanCanvas = sc;
    this.scanCtx = sCtx;
  }

  render(bands, freqData, timeData, excitement = 0) {
    const ctx = this.ctx;
    const W = window.innerWidth;
    const H = window.innerHeight;

    // Clear (skipped when WarpRenderer has already drawn the frame)
    if (this.autoClear) ctx.clearRect(0, 0, W, H);

    this._drawParticles(ctx, W, H, bands, freqData, excitement);
    this._drawRings(ctx, W, H, bands, excitement);
    this._drawVignette(ctx, W, H, bands);
    this._drawScanLines(ctx, W, H, bands);
    this._drawExcitementHUD(ctx, W, H, excitement);
  }

  // ─── Effect 1: Particle field ───────────────────────────────────────────────
  _drawParticles(ctx, W, H, bands, freqData, excitement = 0) {
    const energy = (bands.bass * 0.5 + bands.mid * 0.3 + bands.treble * 0.2) * (1 + excitement * 0.0015);

    for (const p of this.particles) {
      const bin = Math.min(p.freqBin, (freqData?.length ?? 512) - 1);
      const binEnergy = freqData ? freqData[bin] / 255 : 0;

      // Spring force toward home
      const dx = p.homeX - p.x;
      const dy = p.homeY - p.y;
      const spring = 0.04;
      p.vx += dx * spring;
      p.vy += dy * spring;

      // Scatter on audio energy
      if (energy > 0.05) {
        const scatter = binEnergy * energy * 8;
        p.vx += (Math.random() - 0.5) * scatter;
        p.vy += (Math.random() - 0.5) * scatter;
      }

      // Damping
      p.vx *= 0.82;
      p.vy *= 0.82;

      p.x += p.vx;
      p.y += p.vy;

      const opacity = 0.15 + binEnergy * 0.75;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + binEnergy), 0, TAU);
      ctx.fillStyle = `rgba(255,220,0,${opacity.toFixed(3)})`;
      ctx.fill();
    }
  }

  // ─── Effect 2: Waveform line ─────────────────────────────────────────────────
  _drawWaveform(ctx, W, H, timeData) {
    if (!timeData) return;
    const len = timeData.length;
    const midY = H / 2;
    const amp = H * 0.25;

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,220,0,0.75)';
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(255,220,0,0.4)';
    ctx.beginPath();

    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * W;
      const v = (timeData[i] / 128.0 - 1) * amp;
      if (i === 0) ctx.moveTo(x, midY + v);
      else ctx.lineTo(x, midY + v);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ─── Effect 3: Concentric rings ──────────────────────────────────────────────
  _drawRings(ctx, W, H, bands, excitement = 0) {
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(W, H) * 0.5;
    const now = performance.now();

    // Static pulsing rings
    const staticRadii = [0.25, 0.40, 0.55];
    for (const frac of staticRadii) {
      const r = maxR * frac * (1 + bands.mid * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = `rgba(255,220,0,${(0.06 + bands.mid * 0.12).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Beat detection: excitement lowers threshold and cooldown
    const BEAT_THRESHOLD = Math.max(1.05, 1.4 - excitement * 0.0003);
    const BEAT_COOLDOWN  = Math.max(120,  300 - excitement * 0.18);
    this.smoothedBass = this.smoothedBass * 0.9 + bands.bass * 0.1;

    if (
      bands.bass > this.smoothedBass * BEAT_THRESHOLD &&
      bands.bass > 0.15 &&
      now - this.lastBeatTime > BEAT_COOLDOWN
    ) {
      this.lastBeatTime = now;
      this.beatRings.push({ startTime: now, maxRadius: maxR * 0.85 });
    }

    // Draw & update beat rings
    this.beatRings = this.beatRings.filter(ring => {
      const age = (now - ring.startTime) / 1000; // seconds
      const duration = 0.8;
      if (age >= duration) return false;

      const t = age / duration;
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const r = ring.maxRadius * eased;
      const alpha = (1 - t) * 0.6;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = `rgba(255,220,0,${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return true;
    });
  }

  // ─── Effect 4: Edge vignette ─────────────────────────────────────────────────
  _drawVignette(ctx, W, H, bands) {
    const bassSquared = bands.bass * bands.bass;
    const alpha = bassSquared * 0.35;
    if (alpha < 0.005) return;

    const cx = W / 2;
    const cy = H / 2;
    const r = Math.sqrt(cx * cx + cy * cy);

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,220,0,0)');
    grad.addColorStop(1, `rgba(255,220,0,${alpha.toFixed(4)})`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ─── Effect 5: Scan lines ─────────────────────────────────────────────────────
  _drawScanLines(ctx, W, H, bands) {
    if (bands.treble < 0.05) return;
    if (!this.scanCanvas) return;

    const alpha = bands.treble * 0.12;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.scanCanvas, 0, 0, W, H);
    ctx.restore();
  }

  // ─── Effect 6: Excitement HUD ────────────────────────────────────────────────
  _drawExcitementHUD(ctx, W, H, excitement) {
    const frac = Math.min(1, excitement / 1000);
    const now  = performance.now();

    ctx.save();

    // ── Vertical bar — left edge ────────────────────────────────────────────
    const BAR_X   = 18;
    const BAR_W   = 7;
    const BAR_TOP = 52;
    const BAR_BOT = H - 96;
    const BAR_H   = BAR_BOT - BAR_TOP;
    const fillH   = BAR_H * frac;
    const fillY   = BAR_BOT - fillH;

    // Label
    ctx.fillStyle = 'rgba(255,220,0,0.5)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('EXCITATION', BAR_X, BAR_TOP - 9);

    // Track outline
    ctx.strokeStyle = 'rgba(255,220,0,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(BAR_X, BAR_TOP, BAR_W, BAR_H);

    // Gradient fill
    if (fillH > 0.5) {
      const grad = ctx.createLinearGradient(0, fillY, 0, BAR_BOT);
      grad.addColorStop(0, 'rgba(255,220,0,0.95)');
      grad.addColorStop(1, 'rgba(255,160,0,0.35)');
      ctx.fillStyle = grad;
      ctx.fillRect(BAR_X, fillY, BAR_W, fillH);
    }

    // Tick marks at 0 / 250 / 500 / 750 / 1000
    ctx.font = '7px monospace';
    ctx.textAlign = 'right';
    for (const v of [0, 250, 500, 750, 1000]) {
      const ty = BAR_BOT - (v / 1000) * BAR_H;
      ctx.strokeStyle = 'rgba(255,220,0,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(BAR_X - 3, ty);
      ctx.lineTo(BAR_X + BAR_W + 3, ty);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,0,0.35)';
      ctx.fillText(v, BAR_X - 5, ty + 3);
    }

    // Number — floats up with fill level, grows with excitement
    const numSize = Math.round(18 + frac * 22);
    const shake   = frac > 0.75 ? Math.sin(now * 0.07) * (frac - 0.75) * 16 : 0;
    const numY    = Math.max(BAR_TOP + numSize, fillY + numSize * 0.55);
    ctx.fillStyle = `rgba(255,220,0,${(0.6 + frac * 0.4).toFixed(2)})`;
    ctx.font      = `bold ${numSize}px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(excitement), BAR_X + BAR_W + 8 + shake, numY + shake);

    // ── Excitement arcs — centre screen, one per 250-unit milestone ─────────
    const arcCount = Math.floor(excitement / 250); // 0–3
    const minD = Math.min(W, H);
    for (let i = 0; i < arcCount; i++) {
      const tier  = Math.max(0, (excitement - (i + 1) * 250) / 250);
      const pulse = 1 + Math.sin(now * 0.0025 + i * 2.1) * 0.03;
      const r     = minD * (0.17 + i * 0.1) * pulse;
      const alpha = (0.06 + tier * 0.12).toFixed(3);
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, TAU);
      ctx.strokeStyle = `rgba(255,220,0,${alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── Secondary vertical bars — mirror on right, grow with excitement ──────
    const rightBars = Math.floor(excitement / 333); // 0–2 extra bars
    for (let i = 0; i < rightBars; i++) {
      const bx     = W - BAR_X - BAR_W - i * (BAR_W + 5);
      const tier   = Math.max(0, (excitement - (i + 1) * 333) / 333);
      const bFillH = BAR_H * tier;
      const bFillY = BAR_BOT - bFillH;
      ctx.strokeStyle = 'rgba(255,220,0,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, BAR_TOP, BAR_W, BAR_H);
      if (bFillH > 0.5) {
        ctx.fillStyle = `rgba(255,220,0,${(0.15 + tier * 0.25).toFixed(2)})`;
        ctx.fillRect(bx, bFillY, BAR_W, bFillH);
      }
    }

    // ── Peak flash ──────────────────────────────────────────────────────────
    if (excitement > 800) {
      const t     = (excitement - 800) / 200;
      const flash = ((Math.sin(now * 0.01) + 1) / 2) * t * 0.75;
      ctx.fillStyle = `rgba(255,220,0,${flash.toFixed(3)})`;
      ctx.font = `bold ${12 + Math.round(t * 10)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('!! EXCITED !!', W / 2, 28);
    }

    ctx.restore();
  }
}
