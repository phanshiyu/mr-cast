import { Player, type PlayerRef } from '@remotion/player';
import { ArrowRightLeft, Brackets, ChartColumn, ChartGantt, CircleDot, Columns2, SquareTerminal, FolderTree, Code2, FlaskConical, Shapes, GitBranch, Layers, MemoryStick, MessageCircleWarning, Network, Play, Sheet, Table2, Target, Workflow, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sceneChapter } from './components/theme';
import { normalizeStoryboard } from '../shared/normalize.mjs';
import { checkPlan } from '../shared/plan.mjs';
import { PlanPage, type BuiltPicks } from './PlanPage';
import type { HunkMap, Plan, Scene, Voiceover, WalkthroughProps } from './types';
import { captionPage } from './utils/captions';
import { FPS, HEIGHT, WIDTH, formatTime, spokenAt, timeline, totalDurationInFrames, type SpokenSegment, type TimedScene } from './utils/timing';
import { Walkthrough } from './Walkthrough';

interface Meta {
  base?: string;
  head?: string;
  branch?: string;
}

/** plan.json as the page can use it, or the problems Claude still has to fix in it. */
type PlanData = { status: 'ok'; plan: Plan; built: BuiltPicks | null } | { status: 'invalid'; errors: string[] };

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; file: string; message: string }
  // One `walkthrough` object per load: the Player restarts its frame clock whenever `inputProps` changes
  // identity, and this component re-renders on every frame. It is null before Claude writes the storyboard.
  | { status: 'ready'; walkthrough: WalkthroughProps | null; meta: Meta | null; plan: PlanData | null };

type Tab = 'video' | 'plan';

const typeIcon: Record<Scene['type'], LucideIcon> = { intent: Target, graph: Network, code: Code2, flow: Workflow, sequence: ArrowRightLeft, er: Table2, state: CircleDot, mermaid: Shapes, tests: FlaskConical, table: Sheet, chart: ChartColumn, timeline: ChartGantt, files: FolderTree, review: MessageCircleWarning, compare: Columns2, terminal: SquareTerminal, layers: Layers, array: Brackets, memory: MemoryStick };

class DataError extends Error {
  constructor(readonly file: string, message: string) {
    super(message);
  }
}

async function fetchJson<T>(file: string): Promise<T> {
  const found = await fetchOptional<T>(file);
  if (found === null) throw new DataError(file, 'HTTP 404 Not Found');
  return found;
}

/** The data file, or null when the run has none. */
async function fetchOptional<T>(file: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`./data/${file}`, { cache: 'no-store' });
  } catch (err) {
    throw new DataError(file, `network error: ${(err as Error).message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new DataError(file, `HTTP ${res.status} ${res.statusText}`);
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new DataError(file, `invalid JSON: ${(err as Error).message}`);
  }
}

async function loadPlan(): Promise<PlanData | null> {
  let plan: unknown;
  try {
    plan = await fetchOptional<unknown>('plan.json');
  } catch (err) {
    return { status: 'invalid', errors: [err instanceof DataError ? err.message : String(err)] };
  }
  if (plan === null) return null;
  const { errors } = checkPlan(plan);
  if (errors.length) return { status: 'invalid', errors };
  const built = await fetchOptional<{ topics?: BuiltPicks }>('plan-built.json').catch(() => null);
  return { status: 'ok', plan: plan as Plan, built: built?.topics ?? null };
}

async function loadAll(): Promise<LoadState> {
  try {
    const [storyboard, plan, meta] = await Promise.all([
      fetchOptional<{ scenes?: unknown }>('storyboard.json'),
      loadPlan(),
      fetchJson<Meta>('meta.json').catch(() => null),
    ]);
    // Before Claude writes the storyboard, the run has only the plan, and the page shows only the plan.
    if (storyboard === null && (plan || onPlanPath())) return { status: 'ready', walkthrough: null, meta, plan };
    if (storyboard === null) throw new DataError('storyboard.json', 'HTTP 404 Not Found');
    if (!Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) {
      throw new DataError('storyboard.json', 'expected a non-empty "scenes" array');
    }
    const [hunks, voiceover] = await Promise.all([fetchJson<HunkMap>('hunks.json'), fetchJson<Voiceover>('voiceover.json').catch(() => null)]);
    return {
      status: 'ready',
      walkthrough: { storyboard: normalizeStoryboard(storyboard, hunks), hunks, showCaptions: false, voiceover, audioBaseUrl: './data/' },
      meta,
      plan,
    };
  } catch (err) {
    if (err instanceof DataError) return { status: 'error', file: err.file, message: err.message };
    return { status: 'error', file: 'unknown', message: String(err) };
  }
}

const onPlanPath = () => /\/plan\/?$/.test(window.location.pathname);

/** The write token mr-cast put in the URL it opened, as `#token=<hex>`. */
const urlToken = () => /token=([0-9a-f]{32})/.exec(window.location.hash)?.[1] ?? null;

function activeIndex(chapters: readonly TimedScene[], frame: number): number {
  const i = chapters.findIndex((c) => frame < c.from + c.durationInFrames);
  return i === -1 ? chapters.length - 1 : i;
}

export const App: React.FC = () => {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const playerRef = useRef<PlayerRef>(null);
  const resumeFrame = useRef<number | null>(null);
  const [frame, setFrame] = useState(0);
  const [rate, setRate] = useState(1);
  const [tab, setTab] = useState<Tab>(() => (onPlanPath() ? 'plan' : 'video'));
  const token = useMemo(urlToken, []);

  const reload = useCallback(async () => {
    resumeFrame.current = playerRef.current?.getCurrentFrame() ?? null;
    setState(await loadAll());
  }, []);

  useEffect(() => {
    void reload();
    const events = new EventSource('./events');
    events.addEventListener('change', () => void reload());
    return () => events.close();
  }, [reload]);

  const ready = state.status === 'ready' ? state : null;
  const walk = ready?.walkthrough ?? null;
  const shown: Tab = !walk ? 'plan' : !ready?.plan ? 'video' : tab;
  const chapters = useMemo(() => (walk ? timeline(walk.storyboard, walk.voiceover) : []), [walk]);
  const total = walk ? totalDurationInFrames(walk.storyboard, walk.voiceover) : 1;
  const voiced = chapters.some((c) => c.segments.some((s) => s.clip));

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (resumeFrame.current !== null) {
      player.seekTo(Math.min(resumeFrame.current, total - 1));
      resumeFrame.current = null;
    }
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('seeked', onFrame);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('seeked', onFrame);
    };
  }, [walk, total]);

  const current = activeIndex(chapters, frame);
  const seekChapter = useCallback(
    (index: number) => {
      const target = chapters[Math.max(0, Math.min(chapters.length - 1, index))];
      if (target) playerRef.current?.seekTo(target.from);
    },
    [chapters],
  );

  const switchTab = useCallback((next: Tab) => {
    if (next === 'plan') playerRef.current?.pause();
    setTab(next);
    window.history.replaceState(null, '', `${next === 'plan' ? 'plan' : './'}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (shown !== 'video') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        playerRef.current?.toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'j') {
        e.preventDefault();
        seekChapter(current - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'k') {
        e.preventDefault();
        seekChapter(current + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, seekChapter, shown]);

  if (state.status === 'loading') {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">Loading walkthrough…</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="flex h-screen items-center justify-center p-8">
        <div className="max-w-xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-slate-100">
          <div className="text-xs font-semibold uppercase tracking-widest text-rose-300">Could not load {state.file}</div>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-sm text-rose-100/90">{state.message}</pre>
          <button onClick={() => void reload()} className="mt-5 rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { walkthrough, meta, plan } = state;
  const branch = meta?.branch ?? meta?.head;
  const planView = (
    <PlanView
      plan={plan}
      token={token}
      hasVideo={Boolean(walkthrough)}
      title={walkthrough?.storyboard.title ?? 'What the video will cover'}
      branch={branch}
      active={shown === 'plan'}
    />
  );
  if (!walkthrough) return <Backdrop>{planView}</Backdrop>;

  const { storyboard } = walkthrough;
  const active = chapters[current]!;

  return (
    <Backdrop>
      {plan ? <Tabs tab={shown} onChange={switchTab} /> : null}
      {shown === 'plan' ? planView : null}
      <div className={shown === 'video' ? 'flex flex-1 flex-col' : 'hidden'}>
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/5 px-6 py-5">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{storyboard.title}</h1>
            {storyboard.subtitle ? <p className="mt-1 truncate text-sm text-slate-400">{storyboard.subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {branch ? (
              <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono">
                <GitBranch size={13} />
                {branch}
                {meta?.base ? <span className="text-slate-500">→ {meta.base}</span> : null}
              </span>
            ) : null}
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono">{formatTime(total)}</span>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-6 lg:flex-row">
          <nav className="lg:w-72 lg:shrink-0">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Chapters</div>
            <ol className="flex flex-col gap-1.5">
              {chapters.map((c) => {
                const Icon = typeIcon[c.scene.type];
                const isActive = c.index === current;
                const progress = isActive ? Math.min(1, (frame - c.from) / c.durationInFrames) : 0;
                return (
                  <li key={c.index}>
                    <button
                      onClick={() => seekChapter(c.index)}
                      className={`relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left transition ${
                        isActive ? 'border-indigo-400/40 bg-indigo-400/10' : 'border-transparent hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-5 font-mono text-xs text-slate-500">{c.index + 1}</span>
                        <Icon size={16} className={isActive ? 'text-indigo-300' : 'text-slate-500'} />
                        <span className={`flex-1 truncate text-sm ${isActive ? 'text-white' : 'text-slate-300'}`}>
                          {sceneChapter(c.scene)}
                        </span>
                        <span className="font-mono text-xs text-slate-500">{formatTime(c.from)}</span>
                      </div>
                      {isActive ? (
                        <div className="absolute bottom-0 left-0 h-0.5 bg-indigo-400" style={{ width: `${progress * 100}%` }} />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <main className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50">
              <Player
                ref={playerRef}
                component={Walkthrough}
                inputProps={walkthrough}
                durationInFrames={total}
                compositionWidth={WIDTH}
                compositionHeight={HEIGHT}
                fps={FPS}
                controls
                showVolumeControls
                // Browsers block autoplay with sound, so a voiced walkthrough waits for a click.
                autoPlay={!voiced}
                initiallyMuted={!voiced}
                renderPoster={voiced ? renderPlayPoster : undefined}
                showPosterWhenUnplayed
                posterFillMode="player-size"
                spaceKeyToPlayOrPause={false}
                playbackRate={rate}
                acknowledgeRemotionLicense
                style={{ width: '100%', aspectRatio: '16 / 9' }}
              />
            </div>
            <SubtitleHud segments={active.segments} frameInScene={frame - active.from} />
            <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <span>
                <Kbd>Space</Kbd> play / pause · <Kbd>←</Kbd> <Kbd>→</Kbd> or <Kbd>J</Kbd> <Kbd>K</Kbd> previous / next chapter
              </span>
              <PlaybackRate rate={rate} onChange={setRate} />
            </footer>
          </main>
        </div>
      </div>
    </Backdrop>
  );
};

const Backdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen flex-col bg-[radial-gradient(1200px_600px_at_10%_-10%,rgba(124,140,255,0.12),transparent_60%),linear-gradient(160deg,#0d1018,#07080c_55%)] text-slate-100">
    {children}
  </div>
);

const Tabs: React.FC<{ tab: Tab; onChange: (tab: Tab) => void }> = ({ tab, onChange }) => (
  <nav aria-label="View" className="flex gap-1 border-b border-white/5 px-4 pt-3 sm:px-6">
    {(['video', 'plan'] as const).map((t) => (
      <button
        key={t}
        onClick={() => onChange(t)}
        aria-current={t === tab ? 'page' : undefined}
        className={`-mb-px border-b-2 px-3 pb-2 text-sm transition ${t === tab ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
      >
        {t === 'video' ? 'Video' : 'Plan'}
      </button>
    ))}
  </nav>
);

/** The plan page, or what stands in for it while plan.json is missing or has problems. */
const PlanView: React.FC<{ plan: PlanData | null; token: string | null; hasVideo: boolean; title: string; branch?: string; active: boolean }> = ({ plan, ...props }) => {
  if (!plan) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="text-base text-slate-200">Claude is reading the change…</div>
        <div className="text-sm text-slate-500">The topics show up here as soon as Claude writes the plan.</div>
      </div>
    );
  }
  if (plan.status === 'invalid') {
    return (
      <div className="mx-auto mt-16 w-full max-w-[880px] px-4 sm:px-6">
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-6 text-slate-100">
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-200">The plan has problems</div>
          <p className="mt-2 text-sm text-slate-300">Claude is fixing plan.json. This page reloads when it does.</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 font-mono text-xs text-amber-100/90">
            {plan.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return <PlanPage plan={plan.plan} built={plan.built} {...props} />;
};

const RATES = [0.75, 1, 1.25, 1.5];

const PlaybackRate: React.FC<{ rate: number; onChange: (rate: number) => void }> = ({ rate, onChange }) => (
  <div role="group" aria-label="Playback speed" className="flex items-center gap-1">
    <span className="mr-1">Speed</span>
    {RATES.map((r) => (
      <button
        key={r}
        onClick={() => onChange(r)}
        aria-pressed={r === rate}
        className={`rounded-md px-2 py-0.5 font-mono ${r === rate ? 'bg-indigo-400/20 text-indigo-200' : 'text-slate-400 hover:bg-white/5'}`}
      >
        {r}x
      </button>
    ))}
  </div>
);

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{children}</kbd>
);

const renderPlayPoster = () => (
  <div className="flex h-full w-full cursor-pointer items-center justify-center bg-black/40">
    <div className="flex items-center gap-3 rounded-full bg-indigo-500 px-7 py-4 text-lg font-semibold text-white shadow-xl shadow-black/40">
      <Play size={24} fill="currentColor" />
      Play with voice-over
    </div>
  </div>
);

const SubtitleHud: React.FC<{ segments: readonly SpokenSegment[]; frameInScene: number }> = ({ segments, frameInScene }) => {
  const { text, word: current } = spokenAt(segments, frameInScene);
  const { words, lines } = captionPage(text, current, 90);
  return (
    <div className="min-h-[5.5rem] rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-4 text-center text-lg leading-relaxed">
      {lines.map((line, li) => (
        <div key={li}>
          {line.map((wi) => (
            <span
              key={wi}
              className={wi === current ? 'text-white [text-shadow:0_0_14px_rgba(124,140,255,0.7)]' : wi < current ? 'text-slate-200' : 'text-slate-500'}
            >
              {words[wi]}{' '}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};
