import type { WeatherMood } from '@/types/protocol';

export interface SoundMixerLevels {
  bgm: number; // 0..1 유자 노천탕 겨울 캐롤 BGM (Flow Music 생성 트랙)
  water: number; // 0..1 온천 폭포·물줄기 소리
  wind: number; // 0..1 산바람·설경 바람 소리
  fire: number; // 0..1 족욕탕 모닥불 장작 타는 소리
  chime: number; // 0..1 바가지·풍경·대나무 시시오도시 효과음
}

/**
 * 온라인 노천탕(유자탕) 전용 5채널 믹서(겨울 캐롤 BGM + Web Audio 절차적 자연음) 엔진.
 */
export class ArcaneAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private streamGain: GainNode | null = null;
  private breezeGain: GainNode | null = null;
  private fireGain: GainNode | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  private dropletTimer: number | null = null;
  private muted = false;
  private unlocked = false;
  private currentMood: WeatherMood = 'starlight';
  private levels: SoundMixerLevels = {
    bgm: 0.55,
    water: 0.8,
    wind: 0.65,
    fire: 0.7,
    chime: 0.85,
  };

  public isMuted(): boolean {
    return this.muted;
  }

  public getLevels(): SoundMixerLevels {
    return { ...this.levels };
  }

  public setLevels(next: Partial<SoundMixerLevels>): void {
    this.levels = { ...this.levels, ...next };
    this.applyMixerGains();
  }

  public async unlock(): Promise<void> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();
      this.setupAmbientGraph(this.ctx);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (!this.bgmAudio) {
      const audio = new Audio('/bgm/winter-carol.mp3');
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = this.muted
        ? 0
        : Math.min(1, Math.max(0, this.levels.bgm * 0.72));
      this.bgmAudio = audio;
    }

    this.unlocked = true;
    this.syncBgmPlayback();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncBgmPlayback();
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(muted ? 0.0001 : 0.9, now, 0.08);
  }

  public toggleMute(): boolean {
    if (!this.unlocked) {
      void this.unlock();
    }
    this.setMuted(!this.muted);
    return this.muted;
  }

  public setWeatherMood(mood: WeatherMood): void {
    this.currentMood = mood;
    this.applyMixerGains();
  }

  private syncBgmPlayback(): void {
    if (!this.bgmAudio) return;
    const targetVol = this.muted
      ? 0
      : Math.min(1, Math.max(0, this.levels.bgm * 0.72));
    this.bgmAudio.volume = targetVol;

    if (!this.unlocked || this.muted || this.levels.bgm <= 0.01) {
      if (!this.bgmAudio.paused) {
        this.bgmAudio.pause();
      }
      return;
    }

    if (this.bgmAudio.paused) {
      void this.bgmAudio.play().catch(() => {
        // 브라우저 자동재생 정책으로 차단된 경우 다음 인터랙션에서 재생
      });
    }
  }

  private applyMixerGains(): void {
    this.syncBgmPlayback();
    if (!this.ctx || !this.streamGain || !this.breezeGain || !this.fireGain) {
      return;
    }
    const now = this.ctx.currentTime;
    const moodBoost = this.currentMood === 'rainstorm' ? 1.25 : 1.0;
    this.streamGain.gain.setTargetAtTime(
      0.22 * this.levels.water * moodBoost,
      now,
      0.3
    );
    this.breezeGain.gain.setTargetAtTime(
      0.14 * this.levels.wind * moodBoost,
      now,
      0.3
    );
    this.fireGain.gain.setTargetAtTime(0.16 * this.levels.fire, now, 0.3);
  }

  /**
   * 히노끼 바가지로 온천수 끼얹기 사운드 ("톡, 촤르륵~ 퐁당")
   */
  public playPageTurn(): void {
    if (this.muted || this.levels.chime <= 0.01) return;
    void this.unlock().then(() => {
      if (!this.ctx || !this.masterGain || this.muted) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const fxVol = this.levels.chime;

      // 1. 편백나무 바가지 '통' 울림
      const woodOsc = ctx.createOscillator();
      const woodGain = ctx.createGain();
      woodOsc.type = 'sine';
      woodOsc.frequency.setValueAtTime(380, now);
      woodOsc.frequency.exponentialRampToValueAtTime(195, now + 0.065);

      woodGain.gain.setValueAtTime(0.12 * fxVol, now);
      woodGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

      woodOsc.connect(woodGain);
      woodGain.connect(this.masterGain);
      woodOsc.start(now);
      woodOsc.stop(now + 0.08);

      // 2. 따뜻한 온천수 끼얹는 물결 노이즈 ('촤르륵~')
      const duration = 0.28;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        const env = Math.sin((i / bufferSize) * Math.PI);
        data[i] = (Math.random() * 2 - 1) * env;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(2.2, now);
      filter.frequency.setValueAtTime(520, now);
      filter.frequency.exponentialRampToValueAtTime(1480, now + 0.12);
      filter.frequency.exponentialRampToValueAtTime(680, now + duration);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.17 * fxVol, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + duration + 0.02);

      // 3. 귀여운 물방울 '퐁당!' 처프(Chirp) 2방울
      this.playWaterDrop(now + 0.08, 620, 1080, 0.09 * fxVol);
      this.playWaterDrop(now + 0.18, 760, 1280, 0.07 * fxVol);
    });
  }

  /**
   * "어~ 시원하다~" 처마 밑 풍경(Wind Chime) & 온기 사운드
   */
  public playLumosChime(isRemote = false): void {
    if (this.muted || this.levels.chime <= 0.01) return;
    void this.unlock().then(() => {
      if (!this.ctx || !this.masterGain || this.muted) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const attenuation = (isRemote ? 0.5 : 1.0) * this.levels.chime;

      const notes = [1046.5, 1318.5, 1567.98, 1975.5];
      notes.forEach((freq, idx) => {
        const start = now + idx * 0.055;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.08 * attenuation, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.8);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(start);
        osc.stop(start + 1.85);
      });
    });
  }

  /**
   * 대나무 시시오도시(물받이 '딱! — 통~') 및 온천 싱잉볼 울림
   */
  public playClocktowerResonance(): void {
    if (this.muted || this.levels.chime <= 0.01) return;
    void this.unlock().then(() => {
      if (!this.ctx || !this.masterGain || this.muted) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const fxVol = this.levels.chime;

      for (const hitOffset of [0, 0.24]) {
        const t = now + hitOffset;
        const bambooOsc = ctx.createOscillator();
        const bambooGain = ctx.createGain();
        bambooOsc.type = 'triangle';
        bambooOsc.frequency.setValueAtTime(hitOffset === 0 ? 580 : 420, t);
        bambooOsc.frequency.exponentialRampToValueAtTime(190, t + 0.08);

        bambooGain.gain.setValueAtTime(0.19 * fxVol, t);
        bambooGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

        bambooOsc.connect(bambooGain);
        bambooGain.connect(this.masterGain);
        bambooOsc.start(t);
        bambooOsc.stop(t + 0.12);
      }

      this.playWaterDrop(now + 0.32, 480, 960, 0.11 * fxVol);
      this.playWaterDrop(now + 0.44, 640, 1180, 0.09 * fxVol);

      const bowlFreqs = [261.63, 392.0, 523.25, 659.25];
      for (let i = 0; i < bowlFreqs.length; i += 1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(bowlFreqs[i], now + 0.35);

        gain.gain.setValueAtTime(0.0001, now + 0.35);
        gain.gain.linearRampToValueAtTime(
          (0.06 / (i + 1)) * fxVol,
          now + 0.55
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.8);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now + 0.35);
        osc.stop(now + 4.9);
      }
    });
  }

  private playWaterDrop(
    startTime: number,
    startFreq: number,
    endFreq: number,
    amp: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + 0.065);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(amp, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.075);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + 0.08);
  }

  private triggerCampfireCrackle(): void {
    if (!this.ctx || !this.masterGain || this.levels.fire <= 0.02) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1300 + Math.random() * 1400, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.018);

    filter.type = 'highpass';
    filter.frequency.value = 850;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(
      0.03 * this.levels.fire,
      now + 0.003
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.025);
  }

  private setupAmbientGraph(ctx: AudioContext): void {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0.0001 : 0.9;
    this.masterGain.connect(ctx.destination);

    const bufferLen = ctx.sampleRate * 8;
    const pinkBuffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const output = pinkBuffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < bufferLen; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
      b6 = white * 0.115926;
    }

    // 1. 온천 폭포 & 대나무 물줄기 레이어
    const streamSource = ctx.createBufferSource();
    streamSource.buffer = pinkBuffer;
    streamSource.loop = true;

    const streamFilter = ctx.createBiquadFilter();
    streamFilter.type = 'bandpass';
    streamFilter.frequency.value = 680;
    streamFilter.Q.value = 1.1;

    const streamLfo = ctx.createOscillator();
    const streamLfoGain = ctx.createGain();
    streamLfo.frequency.value = 0.25;
    streamLfoGain.gain.value = 180;
    streamLfo.connect(streamLfoGain);
    streamLfoGain.connect(streamFilter.frequency);
    streamLfo.start();

    this.streamGain = ctx.createGain();
    this.streamGain.gain.value = 0.22 * this.levels.water;

    streamSource.connect(streamFilter);
    streamFilter.connect(this.streamGain);
    this.streamGain.connect(this.masterGain);
    streamSource.start();

    // 2. 산바람 레이어
    const breezeSource = ctx.createBufferSource();
    breezeSource.buffer = pinkBuffer;
    breezeSource.loop = true;

    const breezeFilter = ctx.createBiquadFilter();
    breezeFilter.type = 'lowpass';
    breezeFilter.frequency.value = 320;

    this.breezeGain = ctx.createGain();
    this.breezeGain.gain.value = 0.14 * this.levels.wind;

    breezeSource.connect(breezeFilter);
    breezeFilter.connect(this.breezeGain);
    this.breezeGain.connect(this.masterGain);
    breezeSource.start();

    // 3. 모닥불 온기 저음 레이어
    const fireSource = ctx.createBufferSource();
    fireSource.buffer = pinkBuffer;
    fireSource.loop = true;

    const fireFilter = ctx.createBiquadFilter();
    fireFilter.type = 'lowpass';
    fireFilter.frequency.value = 190;

    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0.16 * this.levels.fire;

    fireSource.connect(fireFilter);
    fireFilter.connect(this.fireGain);
    this.fireGain.connect(this.masterGain);
    fireSource.start();

    // 4. 간헐적인 물방울 & 장작 탁탁거리는 소리
    if (this.dropletTimer === null) {
      this.dropletTimer = window.setInterval(() => {
        if (!this.ctx || !this.masterGain || this.muted) return;
        if (Math.random() > 0.45 && this.levels.water > 0.05) {
          const base = 520 + Math.random() * 340;
          this.playWaterDrop(
            this.ctx.currentTime,
            base,
            base * 1.65,
            0.036 * this.levels.water
          );
        }
        if (Math.random() > 0.5 && this.levels.fire > 0.05) {
          this.triggerCampfireCrackle();
        }
      }, 1100);
    }
  }
}
