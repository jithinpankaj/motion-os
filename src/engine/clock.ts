type Listener = () => void;

/**
 * The single source of time. Editing never touches the clock, so property changes cannot reset
 * playback. `time` is explicit; renderers evaluate the scene at `clock.time` each frame.
 */
export class Clock {
  time = 0;
  playing = true;
  speed = 1;
  loop = true;
  duration = 8;
  fps = 30;
  private last = 0;
  private listeners = new Set<Listener>();

  tick(now = performance.now()): number {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    if (this.playing && dt > 0) {
      let t = this.time + dt * this.speed;
      if (this.loop) t = ((t % this.duration) + this.duration) % this.duration;
      else if (t >= this.duration) { t = this.duration; this.playing = false; this.emit(); }
      this.time = t;
    }
    return this.time;
  }

  configure(o: { duration?: number; loop?: boolean; fps?: number }) {
    if (o.duration) this.duration = o.duration;
    if (o.loop !== undefined) this.loop = o.loop;
    if (o.fps) this.fps = o.fps;
    if (this.time > this.duration) this.time = this.loop ? this.time % this.duration : this.duration;
  }

  play() { if (!this.loop && this.time >= this.duration) this.time = 0; this.playing = true; this.last = 0; this.emit(); }
  pause() { this.playing = false; this.emit(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t: number) { this.time = Math.min(Math.max(t, 0), this.duration); this.emit(); }
  restart() { this.time = 0; this.emit(); }
  step(frames: number) { this.pause(); this.seek(Math.round(this.time * this.fps + frames) / this.fps); }
  setSpeed(s: number) { this.speed = s; this.emit(); }
  /** Resume from a hidden tab without a time jump. */
  resetDelta() { this.last = 0; }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach((f) => f()); }
}
