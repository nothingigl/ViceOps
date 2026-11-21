import type { WeatherMode } from '../types';
import type { CarTelemetry } from '../vehicle/CarPhysics';

export type MissionAudioCue = 'upload_complete' | 'extracted' | 'failed' | 'wanted';

function createSoftClipCurve(amount = 2.6): Float32Array<ArrayBuffer> {
  const samples = 256;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * amount);
  }
  return curve;
}

function createNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export class SynthAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Engine nodes
  private engineMainOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineHarmOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Turbo spool nodes
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  // Tire screech / drift nodes
  private tireFilterA: BiquadFilterNode | null = null;
  private tireFilterB: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;

  // Rain ambience nodes
  private rainGain: GainNode | null = null;

  // Police siren nodes
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenPhase = 0;

  // Noise buffer reused for BOV, smoke, EMP & impacts
  private noiseBuffer: AudioBuffer | null = null;

  private initialized = false;
  private muted = false;
  private paused = false;
  private lastBlowOffTime = 0;
  private lastImpactTime = 0;

  public isUnlocked(): boolean {
    return this.initialized && this.ctx !== null && this.ctx.state === 'running';
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public unlock(): boolean {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.setupGraph(this.ctx);
      this.initialized = true;
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    this.applyMasterGain();
    return true;
  }

  private setupGraph(ctx: AudioContext): void {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted || this.paused ? 0 : 0.42;
    this.masterGain.connect(ctx.destination);

    this.noiseBuffer = createNoiseBuffer(ctx, 2.5);

    // 1. Engine synth: Sawtooth + Sub Triangle + Detuned Square -> SoftClip -> Dynamic Lowpass
    this.engineMainOsc = ctx.createOscillator();
    this.engineMainOsc.type = 'sawtooth';
    this.engineMainOsc.frequency.value = 58;

    this.engineSubOsc = ctx.createOscillator();
    this.engineSubOsc.type = 'triangle';
    this.engineSubOsc.frequency.value = 29;

    this.engineHarmOsc = ctx.createOscillator();
    this.engineHarmOsc.type = 'square';
    this.engineHarmOsc.frequency.value = 116;

    const mainMix = ctx.createGain();
    mainMix.gain.value = 0.55;
    const subMix = ctx.createGain();
    subMix.gain.value = 0.65;
    const harmMix = ctx.createGain();
    harmMix.gain.value = 0.16;

    const shaper = ctx.createWaveShaper();
    shaper.curve = createSoftClipCurve(2.4);

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineFilter.Q.value = 2.2;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.18;

    this.engineMainOsc.connect(mainMix);
    this.engineSubOsc.connect(subMix);
    this.engineHarmOsc.connect(harmMix);
    mainMix.connect(shaper);
    subMix.connect(shaper);
    harmMix.connect(shaper);
    shaper.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineMainOsc.start();
    this.engineSubOsc.start();
    this.engineHarmOsc.start();

    // 2. Turbo spool whine
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 1400;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboGain.connect(this.masterGain);
    this.turboOsc.start();

    // 3. Tire screech / drift noise
    const tireSource = ctx.createBufferSource();
    tireSource.buffer = this.noiseBuffer;
    tireSource.loop = true;

    this.tireFilterA = ctx.createBiquadFilter();
    this.tireFilterA.type = 'bandpass';
    this.tireFilterA.frequency.value = 1020;
    this.tireFilterA.Q.value = 5.5;

    this.tireFilterB = ctx.createBiquadFilter();
    this.tireFilterB.type = 'bandpass';
    this.tireFilterB.frequency.value = 1740;
    this.tireFilterB.Q.value = 4.2;

    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;

    tireSource.connect(this.tireFilterA);
    tireSource.connect(this.tireFilterB);
    this.tireFilterA.connect(this.tireGain);
    this.tireFilterB.connect(this.tireGain);
    this.tireGain.connect(this.masterGain);
    tireSource.start();

    // 4. Rain ambience loop
    const rainSource = ctx.createBufferSource();
    rainSource.buffer = this.noiseBuffer;
    rainSource.loop = true;

    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 2400;
    rainFilter.Q.value = 0.65;

    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;

    rainSource.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    rainSource.start();

    // 5. Procedural police siren (wail/yelp oscillator modulated by nearest patrol distance)
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'sawtooth';
    this.sirenOsc.frequency.value = 680;

    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = 'bandpass';
    sirenFilter.frequency.value = 1050;
    sirenFilter.Q.value = 2.4;

    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;

    this.sirenOsc.connect(sirenFilter);
    sirenFilter.connect(this.sirenGain);
    this.sirenGain.connect(this.masterGain);
    this.sirenOsc.start();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMasterGain();
  }

  private applyMasterGain(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = this.muted || this.paused ? 0 : 0.42;
    this.masterGain.gain.setTargetAtTime(target, now, 0.04);
  }

  public update(
    telemetry: Readonly<CarTelemetry>,
    weather: WeatherMode,
    sirenProximity = 0,
    dt = 1 / 60,
  ): void {
    if (!this.initialized || !this.ctx || this.ctx.state !== 'running') return;
    if (this.muted || this.paused) return;

    const now = this.ctx.currentTime;
    const rpmNorm = Math.max(
      0,
      Math.min(1, (telemetry.rpm - 900) / Math.max(1000, telemetry.redlineRpm - 900)),
    );
    const load = telemetry.throttle;

    const baseFreq = 44 + rpmNorm * 168;
    this.engineMainOsc?.frequency.setTargetAtTime(baseFreq, now, 0.025);
    this.engineSubOsc?.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.025);
    this.engineHarmOsc?.frequency.setTargetAtTime(baseFreq * 1.995, now, 0.025);

    const filterCutoff = 220 + rpmNorm * 1650 + load * 980;
    this.engineFilter?.frequency.setTargetAtTime(filterCutoff, now, 0.03);
    this.engineFilter?.Q.setTargetAtTime(1.8 + load * 2.1, now, 0.04);

    const engVolume = 0.14 + rpmNorm * 0.18 + load * 0.11;
    this.engineGain?.gain.setTargetAtTime(engVolume, now, 0.03);

    const turboFreq = 1300 + telemetry.turboBoost * 2400 + rpmNorm * 800;
    this.turboOsc?.frequency.setTargetAtTime(turboFreq, now, 0.04);
    this.turboGain?.gain.setTargetAtTime(telemetry.turboBoost * 0.035, now, 0.05);

    if (telemetry.blowOffTrigger > 0.35 && now - this.lastBlowOffTime > 0.38) {
      this.lastBlowOffTime = now;
      this.playBlowOffWhistle(now, telemetry.blowOffTrigger);
    }

    const isRain = weather === 'rain';
    const slip = telemetry.slipIntensity;
    if (this.tireFilterA && this.tireFilterB && this.tireGain) {
      const pitchShift = 1 + Math.min(telemetry.speedKmh / 240, 0.45);
      this.tireFilterA.frequency.setTargetAtTime((isRain ? 1450 : 980) * pitchShift, now, 0.04);
      this.tireFilterA.Q.setTargetAtTime(isRain ? 1.4 : 6.0, now, 0.05);
      this.tireFilterB.frequency.setTargetAtTime((isRain ? 2600 : 1680) * pitchShift, now, 0.04);
      this.tireFilterB.Q.setTargetAtTime(isRain ? 1.2 : 4.6, now, 0.05);
      this.tireGain.gain.setTargetAtTime(slip * (isRain ? 0.24 : 0.28), now, 0.035);
    }

    this.rainGain?.gain.setTargetAtTime(isRain ? 0.095 : 0, now, 0.2);

    // Police siren modulation (faster yelp when cruiser is right behind you!)
    const clampedProx = Math.max(0, Math.min(1, sirenProximity));
    if (this.sirenOsc && this.sirenGain) {
      if (clampedProx > 0.02) {
        const rate = 2.6 + clampedProx * 3.4;
        this.sirenPhase += dt * rate;
        const sweep = 0.5 + 0.5 * Math.sin(this.sirenPhase * Math.PI * 2);
        const freq = 640 + sweep * 560;
        this.sirenOsc.frequency.setTargetAtTime(freq, now, 0.02);
        this.sirenGain.gain.setTargetAtTime(clampedProx * 0.17, now, 0.06);
      } else {
        this.sirenGain.gain.setTargetAtTime(0, now, 0.12);
      }
    }

    if (telemetry.impactImpulse > 0.15 && now - this.lastImpactTime > 0.18) {
      this.lastImpactTime = now;
      this.playImpactThud(now, telemetry.impactImpulse);
    }
  }

  public playEmpPulse(): void {
    if (!this.ctx || !this.masterGain || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Sub-bass discharge drop
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.42);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + 0.44);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  public playSmokeDeploy(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.muted || this.ctx.state !== 'running') {
      return;
    }
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.55);
    filter.Q.value = 1.6;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.62);
  }

  public playJammerPulse(): void {
    if (!this.ctx || !this.masterGain || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.22);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.42);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.48);
  }

  public playMissionCue(cue: MissionAudioCue): void {
    if (!this.ctx || !this.masterGain || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    const notes =
      cue === 'extracted'
        ? [523.25, 659.25, 783.99, 1046.5]
        : cue === 'upload_complete'
          ? [440, 587.33, 880]
          : cue === 'wanted'
            ? [320, 240, 320]
            : [260, 195, 130];

    notes.forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const t = now + i * 0.11;
      const osc = this.ctx.createOscillator();
      osc.type = cue === 'failed' || cue === 'wanted' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  public playCollisionImpact(strength: number): void {
    if (!this.ctx || !this.masterGain || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - this.lastImpactTime < 0.18) return;
    this.lastImpactTime = now;
    this.playImpactThud(now, Math.max(0.2, Math.min(1, strength)));
  }

  private playBlowOffWhistle(now: number, strength: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400 + strength * 1200, now);
    bp.frequency.exponentialRampToValueAtTime(1150, now + 0.28);
    bp.Q.value = 6.5;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16 * strength, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);

    src.start(now);
    src.stop(now + 0.32);
  }

  private playImpactThud(now: number, strength: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(115 + strength * 40, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.14);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.32 * strength, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}
