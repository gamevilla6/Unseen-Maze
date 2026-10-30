import type { GameEvent, LevelDef } from './engine';

/** Audio is constructed only after a gesture, as required by browsers. */
class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private drone: OscillatorNode | null = null;
  private volume = 0.5;
  private theme: LevelDef['theme'] = 'standard';
  private muted = false;

  async unlock() {
    if (!this.ctx) {
      const AudioCtor = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      this.ctx = new AudioCtor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.35;
      const compressor = this.ctx.createDynamicsCompressor();
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
      this.ambience = this.ctx.createGain();
      this.ambience.gain.value = 0.07;
      this.ambience.connect(this.master);
      this.drone = this.ctx.createOscillator();
      this.drone.type = 'sine';
      this.drone.frequency.value = 52;
      this.drone.connect(this.ambience);
      this.drone.start();
      // Subtle amplitude modulation makes the soundscape breathe without assets.
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = 0.13;
      depth.gain.value = 0.025;
      lfo.connect(depth);
      depth.connect(this.ambience.gain);
      lfo.start();
      this.setTheme(this.theme);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.muted = false;
    this.applyVolume();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  private applyVolume() {
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.35, this.ctx.currentTime, 0.08);
    }
  }

  setTheme(theme: LevelDef['theme']) {
    this.theme = theme;
    if (!this.ctx || !this.drone) return;
    const frequencies = { standard: 52, vault: 41, crystal: 110, water: 46, cyber: 65.4, void: 32.7 };
    this.drone.frequency.setTargetAtTime(frequencies[theme], this.ctx.currentTime, 0.8);
    this.drone.type = theme === 'cyber' ? 'triangle' : 'sine';
  }

  play(event: GameEvent) {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return;
    if (event === 'step') {
      this.tone(this.theme === 'water' ? 160 : 90, 32, 0.09, 0.17, 'triangle');
    } else if (event === 'sonar') {
      this.tone(880, this.theme === 'crystal' ? 620 : 220, 0.8, 0.3, 'sine');
      // Small discrete repeats simulate tight concrete vs extended crystal echoes.
      const count = this.theme === 'crystal' ? 4 : this.theme === 'vault' ? 3 : 2;
      for (let i = 1; i <= count; i++) {
        this.tone(740, 190, 0.45, 0.14 / i, 'sine', i * (this.theme === 'vault' ? 0.1 : 0.24));
      }
    } else if (event === 'hazard') {
      this.tone(170, 70, 0.28, 0.32, 'sawtooth');
      this.tone(130, 55, 0.28, 0.2, 'triangle', 0.15);
    } else if (event === 'shift') {
      this.tone(65, 260, 1.4, 0.3, 'sine');
      this.tone(130, 520, 1.6, 0.14, 'triangle', 0.3);
    } else if (event === 'win') {
      [440, 554.37, 659.25, 880].forEach((f, i) => this.tone(f, f, 0.75, 0.22, 'sine', i * 0.16));
    }
  }

  private tone(from: number, to: number, duration: number, amplitude: number, type: OscillatorType, delay = 0) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const time = ctx.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(from, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), time + duration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(amplitude, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(time);
    osc.stop(time + duration + 0.05);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  suspend() { this.muted = true; this.applyVolume(); }
  resume() {
    this.muted = false;
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    this.applyVolume();
  }
}
export const audio = new Soundscape();
