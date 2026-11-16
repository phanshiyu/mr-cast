// The video, drawn by the engine compiled to WebAssembly (engine/wasm) on a canvas, so the player and the MP4 draw
// the same frames. A frame clock drives it; the voice clips play beside it, one audio element per clip, kept in step
// on play, seek and speed changes. Frames that repeat the one before are not drawn again.

import init, { Player } from 'mrc-wasm';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { syntaxColours } from '../engine/highlight';
import { FPS, HEIGHT, WIDTH, formatTime, timeline } from '../utils/timing';
import { clipTime, fullScale, nextLevel, playingScale, voiceClips } from './clock';
import type { PlayerEvent, PlayerHandle, PlayerListener, VideoPlayerProps } from './types';

let wasm: Promise<{ memory: WebAssembly.Memory }> | null = null;
/** Where the clock is now, between frames. */
const exactFrame = (c: { frame: number; playing: boolean; anchorFrame: number; anchorTime: number; rate: number }) =>
  c.playing ? c.anchorFrame + ((performance.now() - c.anchorTime) / 1000) * FPS * c.rate : c.frame;

const loadWasm = () => {
  wasm ??= init();
  return wasm;
};

/** How far a clip may drift from the frame clock before it is moved back. */
const DRIFT_S = 0.08;

/** Frames timed for the draw-time average. */
const SAMPLES = 12;

export const CanvasPlayer: React.FC<VideoPlayerProps & { ref?: Ref<PlayerHandle> }> = ({
  walkthrough,
  durationInFrames: total,
  autoPlay,
  initiallyMuted,
  poster,
  playbackRate,
  ref,
}) => {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<{ player: Player; memory: WebAssembly.Memory } | null>(null);
  const events = useMemo(() => new Map<PlayerEvent, Set<PlayerListener>>(), []);
  // The clock: the frame shown, and while playing, the frame and time it last started from.
  const clock = useRef({ frame: 0, playing: false, anchorFrame: 0, anchorTime: 0, rate: playbackRate });
  const draw = useRef({ frame: -1, scale: 0, level: 0, times: [] as number[], cssWidth: WIDTH, raf: 0 });
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [muted, setMuted] = useState(initiallyMuted);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clips = useMemo(() => voiceClips(timeline(walkthrough.storyboard, walkthrough.voiceover)), [walkthrough]);
  const audios = useMemo(
    () =>
      walkthrough.audioBaseUrl === undefined
        ? []
        : clips.map((c) => {
            const a = new Audio(walkthrough.audioBaseUrl + c.src);
            a.preload = 'auto';
            return a;
          }),
    [clips, walkthrough.audioBaseUrl],
  );
  useEffect(() => () => audios.forEach((a) => a.pause()), [audios]);
  // A clip takes a moment to start after play(): once it has, it is put where the clock is by then.
  useEffect(() => {
    const offs = audios.map((a, i) => {
      const onPlaying = () => {
        const clip = clips[i];
        const t = clip ? clipTime(clip, exactFrame(clock.current)) : null;
        if (t !== null && Math.abs(a.currentTime - t) > 0.03) a.currentTime = t;
      };
      a.addEventListener('playing', onPlaying);
      return () => a.removeEventListener('playing', onPlaying);
    });
    return () => offs.forEach((off) => off());
  }, [audios, clips]);
  useEffect(() => {
    for (const a of audios) {
      a.muted = muted;
      a.volume = volume;
    }
  }, [audios, muted, volume]);

  const emit = useCallback(
    (type: PlayerEvent, f: number) => {
      for (const l of events.get(type) ?? []) l({ detail: { frame: f } });
    },
    [events],
  );

  /** Puts each clip where the clock is: playing from the right point inside its span, paused outside it. */
  const syncAudio = useCallback(
    (exact: number, force: boolean) => {
      const { playing: on, rate } = clock.current;
      clips.forEach((clip, i) => {
        const a = audios[i];
        if (!a) return;
        const t = on ? clipTime(clip, exact) : null;
        if (t === null) {
          if (!a.paused) a.pause();
          return;
        }
        a.playbackRate = rate;
        if (a.paused || force || Math.abs(a.currentTime - t) > DRIFT_S) a.currentTime = t;
        if (a.paused) void a.play().catch(() => {});
      });
    },
    [clips, audios],
  );

  /** Draws frame `f` if it or the size changed; a frame that repeats the one drawn costs only its fingerprint. */
  const paint = useCallback((f: number) => {
    const e = engine.current;
    const c = canvas.current;
    if (!e || !c) return;
    const d = draw.current;
    const full = fullScale(d.cssWidth, window.devicePixelRatio || 1);
    const scale = clock.current.playing ? playingScale(full, d.level) : full;
    if (f === d.frame && scale === d.scale) return;
    const t0 = performance.now();
    const drew = e.player.render(f, scale);
    if (drew || scale !== d.scale) {
      const w = e.player.width();
      const h = e.player.height();
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const pixels = new Uint8ClampedArray(e.memory.buffer, e.player.pixelsPtr(), w * h * 4);
      c.getContext('2d')?.putImageData(new ImageData(pixels, w, h), 0, 0);
    }
    if (drew && clock.current.playing) {
      d.times.push(performance.now() - t0);
      if (d.times.length >= SAMPLES) {
        const average = d.times.reduce((a, b) => a + b, 0) / d.times.length;
        // For checking the player keeps up: the recent average and the slowest draw yet, and the scale it draws at.
        c.dataset.drawMs = average.toFixed(1);
        c.dataset.drawMaxMs = Math.max(...d.times, Number(c.dataset.drawMaxMs ?? 0)).toFixed(1);
        d.level = nextLevel(d.level, average);
        d.times = [];
      }
    }
    d.frame = f;
    d.scale = scale;
    c.dataset.scale = scale.toFixed(3);
  }, []);

  const show = useCallback(
    (f: number) => {
      clock.current.frame = f;
      setFrame(f);
      paint(f);
    },
    [paint],
  );

  const tick = useCallback(
    (now: number) => {
      const c = clock.current;
      if (!c.playing) return;
      const exact = c.anchorFrame + ((now - c.anchorTime) / 1000) * FPS * c.rate;
      if (exact >= total - 1) {
        c.playing = false;
        setPlaying(false);
        syncAudio(total - 1, false);
        show(total - 1);
        emit('frameupdate', total - 1);
        emit('ended', total - 1);
        return;
      }
      const f = Math.floor(exact);
      if (f !== c.frame) {
        show(f);
        emit('frameupdate', f);
      }
      syncAudio(exact, false);
      draw.current.raf = requestAnimationFrame(tick);
    },
    [total, show, emit, syncAudio],
  );

  const play = useCallback(() => {
    const c = clock.current;
    if (c.playing) return;
    if (c.frame >= total - 1) show(0);
    Object.assign(c, { playing: true, anchorFrame: c.frame, anchorTime: performance.now() });
    setPlaying(true);
    setPlayed(true);
    emit('play', c.frame);
    syncAudio(c.frame, true);
    draw.current.raf = requestAnimationFrame(tick);
  }, [total, show, emit, syncAudio, tick]);

  const pause = useCallback(() => {
    const c = clock.current;
    if (!c.playing) return;
    c.playing = false;
    cancelAnimationFrame(draw.current.raf);
    setPlaying(false);
    syncAudio(c.frame, false);
    // Paused, the frame is drawn at full size again.
    paint(c.frame);
  }, [syncAudio, paint]);

  const seekTo = useCallback(
    (to: number) => {
      const f = Math.max(0, Math.min(total - 1, Math.round(to)));
      const c = clock.current;
      Object.assign(c, { anchorFrame: f, anchorTime: performance.now() });
      show(f);
      syncAudio(f, true);
      emit('seeked', f);
    },
    [total, show, syncAudio, emit],
  );

  useImperativeHandle(
    ref,
    () => ({
      seekTo,
      pause,
      toggle: () => (clock.current.playing ? pause() : play()),
      getCurrentFrame: () => clock.current.frame,
      addEventListener: (type: PlayerEvent, l: PlayerListener) => {
        events.set(type, (events.get(type) ?? new Set()).add(l));
      },
      removeEventListener: (type: PlayerEvent, l: PlayerListener) => {
        events.get(type)?.delete(l);
      },
    }),
    [seekTo, pause, play, events],
  );

  // A new speed starts from where the clock is, so the frame does not jump.
  useEffect(() => {
    const c = clock.current;
    if (c.playing) {
      const now = performance.now();
      c.anchorFrame += ((now - c.anchorTime) / 1000) * FPS * c.rate;
      c.anchorTime = now;
    }
    c.rate = playbackRate;
    syncAudio(c.anchorFrame, true);
  }, [playbackRate, syncAudio]);

  // The engine loads once per walkthrough: the props, with the syntax colours the MP4 is drawn with.
  // biome-ignore lint/correctness/useExhaustiveDependencies: autoPlay and play are read once, when the walkthrough loads
  useEffect(() => {
    let live = true;
    const props = JSON.stringify({
      ...walkthrough,
      showCaptions: false,
      highlight: syntaxColours(walkthrough.storyboard, walkthrough.hunks),
    });
    loadWasm().then(
      ({ memory }) => {
        if (!live) return;
        try {
          engine.current = { player: new Player(props), memory };
        } catch (err) {
          setError(String(err));
          return;
        }
        draw.current.frame = -1;
        paint(clock.current.frame);
        if (autoPlay && !clock.current.playing) play();
      },
      (err: unknown) => setError(`could not load the player's renderer: ${String(err)}`),
    );
    return () => {
      live = false;
      clock.current.playing = false;
      cancelAnimationFrame(draw.current.raf);
      engine.current?.player.free();
      engine.current = null;
    };
  }, [walkthrough, paint]);

  // The canvas draws at its device-pixel size, so it is sharp at any width.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      draw.current.cssWidth = entry.contentRect.width;
      paint(clock.current.frame);
    });
    ro.observe(el);
    const onFull = () => setFullscreen(document.fullscreenElement === el);
    document.addEventListener('fullscreenchange', onFull);
    return () => {
      ro.disconnect();
      document.removeEventListener('fullscreenchange', onFull);
    };
  }, [paint]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen();
  };

  return (
    <div
      ref={box}
      className="group relative w-full bg-black"
      style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
      data-testid="canvas-player"
    >
      <canvas
        ref={canvas}
        className="block h-full w-full cursor-pointer"
        onClick={() => (clock.current.playing ? pause() : play())}
        onDoubleClick={toggleFullscreen}
        aria-label="Video"
      />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {poster && !played ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the controls below play by keyboard
        <div className="absolute inset-0" onClick={play}>
          {poster()}
        </div>
      ) : null}
      <div
        className={`absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 text-white transition-opacity ${
          playing ? 'opacity-0 group-hover:opacity-100 focus-within:opacity-100' : 'opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => (playing ? pause() : play())}
          aria-label={playing ? 'Pause' : 'Play'}
          className="rounded p-1 hover:bg-white/10"
        >
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="rounded p-1 hover:bg-white/10"
        >
          {muted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            setMuted(Number(e.target.value) === 0);
          }}
          aria-label="Volume"
          className="w-20 accent-indigo-400"
        />
        <span className="font-mono text-xs tabular-nums text-slate-200">
          {formatTime(frame)} / {formatTime(total)}
        </span>
        <input
          type="range"
          min={0}
          max={total - 1}
          step={1}
          value={frame}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          className="flex-1 accent-indigo-400"
        />
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          className="rounded p-1 hover:bg-white/10"
        >
          {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      </div>
    </div>
  );
};
