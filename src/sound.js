// Task 4: Sound synthesizer via Web Audio API (Zero audio files, pure oscillator)
class IslandSound {
  constructor() {
    this.ctx = null;
    this.config = null;
    this.isMuted = false;
  }

  init(soundConfig) {
    this.config = soundConfig;
  }

  setMuted(muted) {
    this.isMuted = muted;
  }

  getAudioContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTick() {
    if (this.isMuted || !this.config || !this.config.enabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const tickCfg = this.config.tick || { frequency: 880, durationMs: 60, waveType: 'sine' };
    const volume = this.config.volume ?? 0.25;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = tickCfg.waveType || 'sine';
    osc.frequency.setValueAtTime(tickCfg.frequency || 880, ctx.currentTime);

    const now = ctx.currentTime;
    const duration = (tickCfg.durationMs || 60) / 1000;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playTwoTone() {
    if (this.isMuted || !this.config || !this.config.enabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const toneCfg = this.config.twoTone || { note1: 587.33, note2: 880, noteDurationMs: 150, waveType: 'sine' };
    const volume = this.config.volume ?? 0.25;
    const noteDuration = (toneCfg.noteDurationMs || 150) / 1000;
    const now = ctx.currentTime;

    // Note 1: lower gentle note
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = toneCfg.waveType || 'sine';
    osc1.frequency.setValueAtTime(toneCfg.note1 || 587.33, now);

    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + noteDuration);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + noteDuration);

    // Note 2: higher resolving note
    const note2Time = now + noteDuration * 0.85; // slight overlap for natural chime feel
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = toneCfg.waveType || 'sine';
    osc2.frequency.setValueAtTime(toneCfg.note2 || 880, note2Time);

    gain2.gain.setValueAtTime(0.0001, note2Time);
    gain2.gain.exponentialRampToValueAtTime(volume * 1.1, note2Time + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.0001, note2Time + noteDuration);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(note2Time);
    osc2.stop(note2Time + noteDuration + 0.02);
  }
}

window.islandSound = new IslandSound();
