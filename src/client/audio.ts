/**
 * Procedural sound effects (no audio files yet), reacting to SimEvents. The
 * WebAudio context starts on the first user gesture, as browsers require.
 */
import type { SimEvent } from '../sim/events';

type FilterType = BiquadFilterType;

/** Output gain at full volume: the mix was tuned at this level. */
const MASTER = 0.45;

export class Audio {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  /** Master volume 0-1, from settings. */
  private volume = 1;
  /** Pickups in quick succession chime a step higher each, like coins in a run. */
  private chain = { count: 0, at: 0 };

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.out) this.out.gain.value = MASTER * volume;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const c = new AudioContext();
    this.ctx = c;
    this.out = c.createGain();
    this.out.gain.value = MASTER * this.volume;
    this.out.connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  handle(e: SimEvent): void {
    switch (e.type) {
      case 'swing':
        return this.burst(0.14, 1300, 0.22, 'bandpass', [700, 2800]);
      case 'damaged':
        if (e.isPlayer) {
          this.burst(0.22, 450, 0.5, 'lowpass');
          return this.tone(
            [
              [220, 1],
              [160, 0.8],
            ],
            0.2,
            0.08,
            'square',
          );
        }
        this.burst(0.12, 600, 0.5, 'lowpass');
        return this.tone([[e.crit ? 260 : 180, 1]], 0.12, 0.08, 'square');
      case 'blocked':
        return this.tone(
          [
            [620, 1],
            [1450, 0.5],
            [2300, 0.3],
          ],
          0.45,
          0.08,
          'triangle',
        );
      case 'killed':
        return this.tone(
          [
            [880, 1],
            [1320, 0.6],
          ],
          0.6,
          0.035,
        );
      case 'roll':
        return this.burst(0.2, 450, 0.22, 'lowpass');
      case 'tileHit':
        this.burst(0.09, 420, 0.4, 'lowpass');
        return this.tone([[140, 1]], 0.08, 0.06, 'square');
      case 'tileCut':
        if (e.hits <= 1) return this.burst(0.08, 2400, 0.12, 'highpass');
        this.burst(0.35, 300, 0.55, 'lowpass');
        return this.burst(0.15, 1500, 0.2, 'bandpass', [1800, 600]);
      case 'pickedUp': {
        const p = this.chainPitch();
        return e.kind === 'souls'
          ? this.tone(
              [
                [880 * p, 1],
                [1320 * p, 0.6],
              ],
              0.4,
              0.025,
            )
          : this.arp([880 * p, 1175 * p], 60, 0.25, 0.06);
      }
      case 'healed':
        return this.arp([523, 659, 784], 70, 0.5, 0.06);
      case 'flaskEmpty':
        return this.tone([[150, 1]], 0.15, 0.06, 'square');
      case 'enemyAttack':
        if (e.kind === 'charge') {
          this.burst(1.0, 300, 0.4, 'bandpass', [180, 600]);
          return this.tone(
            [
              [70, 1],
              [92, 0.7],
            ],
            1.0,
            0.12,
            'sawtooth',
          );
        }
        return e.kind === 'shoot'
          ? this.burst(0.1, 1800, 0.12)
          : this.burst(0.14, 1100, 0.18, 'bandpass', [600, 2200]);
      case 'wallSlam':
        this.burst(0.9, 120, 1.0, 'lowpass');
        return this.burst(0.3, 900, 0.3);
      case 'bonfireLit':
        this.tone(
          [
            [196, 1],
            [294, 0.8],
            [392, 0.6],
          ],
          2,
          0.06,
        );
        return this.burst(0.7, 400, 0.35, 'lowpass');
      case 'rested':
        return this.arp([392, 494, 587], 110, 0.6, 0.05);
      case 'read':
        return this.tone([[460, 1]], 0.04, 0.03, 'square');
      case 'playerDied':
        return this.tone(
          [
            [110, 1],
            [131, 0.8],
            [55, 1],
          ],
          2.8,
          0.1,
          'sawtooth',
        );
      case 'itemGained': {
        const p = this.chainPitch();
        return this.arp([659 * p, 988 * p], 50, 0.2, 0.04);
      }
      case 'crafted':
        this.burst(0.12, 2600, 0.15, 'highpass');
        return this.arp([523, 784], 80, 0.35, 0.05);
      case 'upgraded':
        this.burst(0.25, 3200, 0.3, 'highpass');
        return this.arp([392, 523, 784, 1047], 90, 0.7, 0.05);
      case 'craftFailed':
      case 'inventoryFull':
        return this.tone([[150, 1]], 0.15, 0.06, 'square');
      case 'buffStarted':
        return this.arp([440, 554, 659], 60, 0.5, 0.05);
      case 'stationOpened':
        return this.burst(0.1, 900, 0.12, 'bandpass', [500, 1400]);
      case 'abilityUsed':
        if (e.slot === 'super') {
          this.burst(0.6, 500, 0.4, 'lowpass');
          return this.arp([196, 262, 330, 392], 70, 0.9, 0.06);
        }
        return this.burst(0.18, e.slot === 'aoe' ? 1400 : 2600, 0.22, 'bandpass', [400, 3200]);
      case 'blast':
        this.burst(0.25 + e.radius / 200, 160, 0.5 + e.radius / 160, 'lowpass');
        return this.burst(0.2, 1100, 0.25, 'bandpass', [900, 300]);
      case 'abilityNotReady':
        return this.tone([[180, 1]], 0.08, 0.04, 'square');
      case 'abilityReady':
        return e.slot === 'super'
          ? this.arp([523, 659, 784, 1047], 60, 0.6, 0.05)
          : this.tone([[1175, 1]], 0.12, 0.02);
      case 'empowered':
        return this.tone(
          [
            [110, 1],
            [165, 0.7],
          ],
          1.2,
          0.08,
          'sawtooth',
        );
      case 'empowerEnded':
        return this.arp([392, 330, 262], 80, 0.4, 0.04);
      case 'classChanged':
        return this.arp([294, 392, 494], 90, 0.6, 0.05);
      case 'playerRespawned':
      case 'areaEntered':
        return;
    }
  }

  /** Pitch multiplier for the next pickup chime: up a whole tone per quick pickup, up to an octave. */
  private chainPitch(): number {
    const now = performance.now();
    this.chain.count = now - this.chain.at < 450 ? Math.min(this.chain.count + 1, 6) : 0;
    this.chain.at = now;
    return Math.pow(2, (this.chain.count * 2) / 12);
  }

  private burst(
    dur: number,
    freq: number,
    gain: number,
    type: FilterType = 'bandpass',
    sweep?: [number, number],
  ): void {
    const { ctx: c, out, noise } = this;
    if (!c || !out || !noise || this.muted) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (sweep) {
      f.frequency.setValueAtTime(sweep[0], t);
      f.frequency.exponentialRampToValueAtTime(sweep[1], t + dur);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
  }

  private tone(partials: [number, number][], dur: number, gain: number, type: OscillatorType = 'sine'): void {
    const { ctx: c, out } = this;
    if (!c || !out || this.muted) return;
    const t = c.currentTime;
    for (const [freq, amp] of partials) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur);
    }
  }

  private arp(notes: number[], gapMs: number, dur: number, gain: number): void {
    notes.forEach((n, i) => setTimeout(() => this.tone([[n, 1]], dur, gain, 'triangle'), i * gapMs));
  }
}
