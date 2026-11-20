class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock() {
    this.ensureCtx();
  }

  public setMuted(m: boolean) {
    this.muted = m;
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    gainVal: number
  ) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(25, freqEnd), now + duration);

    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  public click() {
    this.playTone(540, 320, 0.055, 'triangle', 0.05);
  }

  public command() {
    this.playTone(380, 520, 0.075, 'sine', 0.06);
  }

  public swordHit() {
    this.playTone(260, 95, 0.09, 'sawtooth', 0.065);
  }

  public heavyHit() {
    this.playTone(170, 55, 0.14, 'sawtooth', 0.09);
  }

  public arrowShot() {
    this.playTone(680, 290, 0.07, 'triangle', 0.04);
  }

  public gather() {
    this.playTone(480, 720, 0.09, 'sine', 0.05);
  }

  public buildPlace() {
    this.playTone(180, 110, 0.14, 'square', 0.06);
    setTimeout(() => this.playTone(240, 140, 0.12, 'triangle', 0.05), 60);
  }

  public complete() {
    this.playTone(440, 440, 0.1, 'triangle', 0.06);
    setTimeout(() => this.playTone(554, 554, 0.12, 'triangle', 0.06), 90);
    setTimeout(() => this.playTone(659, 659, 0.18, 'triangle', 0.07), 180);
  }

  public levelUp() {
    const notes = [392, 493.88, 587.33, 783.99];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, n * 1.01, 0.18, 'triangle', 0.07), idx * 90);
    });
  }

  public victory() {
    const chord = [392, 493.88, 587.33, 783.99];
    chord.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, n, 0.35, 'triangle', 0.08), idx * 120);
    });
  }

  public defeat() {
    const notes = [293.66, 261.63, 220, 174.61];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, n * 0.96, 0.32, 'sawtooth', 0.06), idx * 150);
    });
  }
}

export const sound = new SoundEngine();
