import { ArrowRightLeft, Brackets, ChartColumn, ChartGantt, Check, CircleDot, Code2, Columns2, Copy, Layers, MemoryStick, Network, RotateCcw, Sheet, Split, SquareTerminal, Table2, Workflow, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEPTHS, formatLength, pickOf, planSeconds, samePick, suggestionOf } from '../shared/plan.mjs';
import { VIEWS } from '../shared/views.mjs';
import { aType } from '../shared/words.mjs';
import type { Depth, Plan, PlanTopic, TopicPick, ViewKey } from './types';

const viewIcon: Record<ViewKey, LucideIcon> = {
  parts: Network, calls: ArrowRightLeft, data: Workflow, decisions: Split, states: CircleDot, layers: Layers, schema: Table2, compare: Columns2,
  timing: ChartGantt, facts: Sheet, numbers: ChartColumn, shell: SquareTerminal, memory: MemoryStick, steps: Brackets, code: Code2,
};

const depthLabel: Record<Depth, string> = { skip: 'Skip', brief: 'Brief', deep: 'Deep' };
const depthHint: Record<Depth, string> = {
  skip: 'Leave it out of the video',
  brief: 'The view, then the key lines',
  deep: 'The view, then the code line by line',
};
/** A pre-read shows no code, so a deeper look is one more diagram that traces a real case. */
const prereadHint: Record<Depth, string> = {
  skip: depthHint.skip,
  brief: 'The picture and its key fact.',
  deep: 'Trace one real case through it, with the actual limits, keys and order.',
};

/** The picks the current video was built from, by topic id (plan-built.json). */
export type BuiltPicks = Record<string, TopicPick>;

type Save = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'failed'; body: ChoiceBody } | { status: 'stale' };
interface ChoiceBody {
  topic: string;
  choice: TopicPick | null;
}

/** Topic ids whose content (not the viewer's choice) is new or differs from `before`. */
function editedTopics(before: Plan | null, after: Plan): Set<string> {
  if (!before) return new Set();
  const strip = ({ choice: _choice, ...rest }: PlanTopic) => JSON.stringify(rest);
  const old = new Map(before.topics.map((t) => [t.id, strip(t)]));
  return new Set(after.topics.filter((t) => old.get(t.id) !== strip(t)).map((t) => t.id));
}

const withChoice = (plan: Plan, { topic, choice }: ChoiceBody): Plan => ({
  topics: plan.topics.map((t) => {
    if (t.id !== topic) return t;
    const { choice: _old, ...rest } = t;
    return choice ? { ...rest, choice } : rest;
  }),
});

export const PlanPage: React.FC<{
  plan: Plan;
  built: BuiltPicks | null;
  token: string | null;
  /** The video exists, so Claude is not waiting in the terminal for the picks. */
  hasVideo: boolean;
  title: string;
  branch?: string;
  /** An explanation has no tests scene at the end. */
  explanation: boolean;
  /** Keys move between rows and change picks only while the page is on screen. */
  active: boolean;
  /** A pre-read (`--audience preread`): no code on screen, and the video ends on the order to read the code in. */
  preread: boolean;
}> = ({ plan, built, token, hasVideo, title, branch, explanation, active, preread }) => {
  const [local, setLocal] = useState(plan);
  const [row, setRow] = useState(0);
  const [save, setSave] = useState<Save>({ status: 'idle' });
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const previous = useRef<Plan | null>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const edited = editedTopics(previous.current, plan);
    previous.current = plan;
    setLocal(plan);
    setRow((r) => Math.min(r, plan.topics.length - 1));
    if (!edited.size) return;
    setFlash(edited);
    const timer = setTimeout(() => setFlash(new Set()), 2400);
    return () => clearTimeout(timer);
  }, [plan]);

  const send = useCallback(
    async (body: ChoiceBody) => {
      setLocal((p) => withChoice(p, body));
      setSave({ status: 'saving' });
      try {
        const res = await fetch('./plan/choice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Mr-Cast-Token': token ?? '' },
          body: JSON.stringify(body),
        });
        if (res.ok) return setSave({ status: 'saved' });
        setLocal(previous.current ?? plan);
        // The token is new each time mr-cast serves, so a 403 means this tab outlived the server that opened it.
        setSave(res.status === 403 ? { status: 'stale' } : { status: 'failed', body });
      } catch {
        setLocal(previous.current ?? plan);
        setSave({ status: 'failed', body });
      }
    },
    [token, plan],
  );

  const choose = useCallback(
    (topic: PlanTopic, change: Partial<TopicPick>) => {
      if (!token) return;
      const next = { ...pickOf(topic), ...change };
      if (samePick(next, pickOf(topic))) return;
      void send({ topic: topic.id, choice: next });
    },
    [send, token],
  );

  useEffect(() => {
    if (save.status !== 'saved') return;
    const timer = setTimeout(() => setSave({ status: 'idle' }), 1600);
    return () => clearTimeout(timer);
  }, [save]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const topic = local.topics[row];
      if (!topic) return;
      const pick = pickOf(topic);
      const move = (to: number) => {
        const next = Math.max(0, Math.min(local.topics.length - 1, to));
        setRow(next);
        rows.current[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      if (e.key === 'ArrowDown') move(row + 1);
      else if (e.key === 'ArrowUp') move(row - 1);
      else if (e.key === '1' || e.key === '2' || e.key === '3') choose(topic, { depth: DEPTHS[Number(e.key) - 1] });
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && pick.depth !== 'skip') {
        const i = topic.views.indexOf(pick.view) + (e.key === 'ArrowRight' ? 1 : -1);
        const view = topic.views[Math.max(0, Math.min(topic.views.length - 1, i))];
        if (view) choose(topic, { view });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, local, row, choose]);

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-40 pt-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300/80">Plan</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">
            Pick how much time each topic gets, and how it is shown.{preread ? ' No code on screen: you read the code after the video.' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <SaveNote save={save} />
          {branch ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono">{branch}</span> : null}
          <span className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-sm font-medium text-indigo-100" aria-live="polite">
            {formatLength(planSeconds(local))}
          </span>
        </div>
      </header>

      {save.status === 'failed' ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-100">
          Could not save. Is <code className="font-mono text-rose-50">mr-cast plan</code> still running?
          <button onClick={() => void send(save.body)} className="rounded-md bg-white/10 px-3 py-1 text-xs hover:bg-white/20">
            Retry
          </button>
        </div>
      ) : null}
      {save.status === 'stale' ? (
        <div role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-100">
          This tab is from an earlier session. Reopen the link mr-cast printed.
        </div>
      ) : null}
      {!token ? (
        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-100">
          This page is read-only. Open the link mr-cast printed in the terminal to change the picks.
        </div>
      ) : null}

      <FixedRow text="The opening: what the change is for, and what to watch for." />
      <ol className="mt-3 flex flex-col gap-3">
        {local.topics.map((topic, i) => (
          <TopicRow
            key={topic.id}
            ref={(el) => {
              rows.current[i] = el;
            }}
            topic={topic}
            built={built?.[topic.id]}
            current={i === row}
            flash={flash.has(topic.id)}
            editable={Boolean(token)}
            onFocusRow={() => setRow(i)}
            onChoose={(change) => choose(topic, change)}
            onReset={() => void send({ topic: topic.id, choice: null })}
            hints={preread ? prereadHint : depthHint}
          />
        ))}
      </ol>
      {explanation ? null : <FixedRow text={preread ? 'The tests, then the order in which to read the code, with what to check at each place.' : 'The tests, and what is left to check.'} />}

      <p className="mt-6 hidden text-xs text-slate-500 sm:block">
        <Kbd>↑</Kbd> <Kbd>↓</Kbd> topic · <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> skip, brief, deep · <Kbd>←</Kbd> <Kbd>→</Kbd> how it is shown
      </p>

      <HandBack hasVideo={hasVideo} changed={Boolean(built) && local.topics.some((t) => built?.[t.id] && !samePick(built[t.id], pickOf(t)))} />
    </div>
  );
};

const FixedRow: React.FC<{ text: string }> = ({ text }) => (
  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-white/10 px-4 py-2.5 text-sm text-slate-500">
    <span>{text}</span>
    <span className="shrink-0 text-xs">Always included</span>
  </div>
);

const SaveNote: React.FC<{ save: Save }> = ({ save }) => {
  if (save.status === 'saving') return <span>Saving…</span>;
  if (save.status === 'saved')
    return (
      <span className="flex items-center gap-1 text-emerald-300">
        <Check size={13} /> Saved
      </span>
    );
  return null;
};

interface TopicRowProps {
  topic: PlanTopic;
  built: TopicPick | undefined;
  current: boolean;
  flash: boolean;
  editable: boolean;
  onFocusRow: () => void;
  onChoose: (change: Partial<TopicPick>) => void;
  onReset: () => void;
  ref: React.Ref<HTMLLIElement>;
  hints: Record<Depth, string>;
}

const TopicRow: React.FC<TopicRowProps> = ({ topic, built, current, flash, editable, onFocusRow, onChoose, onReset, ref, hints }) => {
  const pick = pickOf(topic);
  const suggested = suggestionOf(topic);
  const changed = !samePick(pick, suggested);
  const notInVideo = built && !samePick(built, pick);
  const skipped = pick.depth === 'skip';
  return (
    <li
      ref={ref}
      onMouseDown={onFocusRow}
      className={`relative rounded-2xl border px-4 py-4 transition sm:px-5 ${current ? 'border-indigo-400/40 bg-white/[0.05]' : 'border-white/10 bg-white/[0.025]'} ${flash ? 'ring-2 ring-amber-300/60' : ''}`}
    >
      {changed ? <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] rounded-full bg-indigo-400" /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className={`min-w-0 flex-1 basis-64 ${skipped ? 'opacity-45' : ''}`}>
          <h2 className="text-base font-semibold text-slate-100">{topic.title}</h2>
          <p className="mt-0.5 text-sm text-slate-300">{topic.summary}</p>
          {topic.files.length ? <p className="mt-1 font-mono text-xs text-slate-500">{formatFiles(topic.files)}</p> : null}
        </div>
        <DepthControl value={pick.depth} suggested={suggested.depth} disabled={!editable} hints={hints} onChange={(depth) => onChoose({ depth })} />
      </div>

      {skipped ? null : <ViewPicker topic={topic} value={pick.view} disabled={!editable} onChange={(view) => onChoose({ view })} />}

      {topic.why || changed || notInVideo ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {topic.why ? (
            <details className="text-slate-400">
              <summary className="cursor-pointer select-none hover:text-slate-200">Why this?</summary>
              <p className="mt-1 max-w-xl text-slate-300">{topic.why}</p>
            </details>
          ) : null}
          {changed && editable ? (
            <button onClick={onReset} className="flex items-center gap-1 text-slate-400 hover:text-slate-200">
              <RotateCcw size={12} /> Back to suggested
            </button>
          ) : null}
          {notInVideo ? <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-0.5 text-amber-200">Changed, not in the video yet</span> : null}
        </div>
      ) : null}
    </li>
  );
};

/** "limiter.ts, orders.ts +2": the first two file names, and how many more. */
function formatFiles(files: readonly string[]): string {
  const names = files.slice(0, 2).map((f) => f.split('/').at(-1));
  return `${names.join(', ')}${files.length > 2 ? ` +${files.length - 2}` : ''}`;
}

const DepthControl: React.FC<{ value: Depth; suggested: Depth; disabled: boolean; hints: Record<Depth, string>; onChange: (depth: Depth) => void }> = ({ value, suggested, disabled, hints, onChange }) => (
  <div role="radiogroup" aria-label="Depth" className="flex shrink-0 rounded-lg border border-white/10 bg-black/20 p-0.5">
    {DEPTHS.map((depth) => (
      <button
        key={depth}
        role="radio"
        aria-checked={depth === value}
        title={`${hints[depth]}${depth === suggested ? ' (suggested)' : ''}`}
        disabled={disabled}
        onClick={() => onChange(depth)}
        className={`relative rounded-md px-3.5 py-1.5 text-sm transition disabled:cursor-default ${
          depth === value ? (depth === 'skip' ? 'bg-white/15 text-slate-100' : 'bg-indigo-500 text-white shadow') : 'text-slate-400 enabled:hover:text-slate-100'
        }`}
      >
        {depthLabel[depth]}
        {depth === suggested ? <span aria-hidden className="absolute right-1 top-1 h-1 w-1 rounded-full bg-current opacity-70" /> : null}
      </button>
    ))}
  </div>
);

const ViewPicker: React.FC<{ topic: PlanTopic; value: ViewKey; disabled: boolean; onChange: (view: ViewKey) => void }> = ({ topic, value, disabled, onChange }) => {
  if (topic.views.length === 1) {
    const only = topic.views[0]!;
    const Icon = viewIcon[only];
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-slate-400">
        <Icon size={15} className="text-slate-500" /> Shown as: <span className="text-slate-200">{VIEWS[only].label}</span>
      </p>
    );
  }
  return (
    <div role="radiogroup" aria-label="Shown as" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {topic.views.map((view, i) => {
        const Icon = viewIcon[view];
        const on = view === value;
        return (
          <button
            key={view}
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={`Drawn as ${VIEWS[view].scenes.map(aType).join(' or ')} scene`}
            onClick={() => onChange(view)}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition disabled:cursor-default ${
              on ? 'border-indigo-400/60 bg-indigo-400/15 text-white' : 'border-white/10 text-slate-300 enabled:hover:border-white/25 enabled:hover:bg-white/5'
            }`}
          >
            <Icon size={18} className={on ? 'shrink-0 text-indigo-300' : 'shrink-0 text-slate-500'} />
            <span className="flex flex-1 flex-col leading-snug">
              {VIEWS[view].label}
              {i === 0 ? <span className="text-[10px] font-medium uppercase tracking-wider text-indigo-300/80">Suggested</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const HandBack: React.FC<{ hasVideo: boolean; changed: boolean }> = ({ hasVideo, changed }) => {
  const [copied, setCopied] = useState(false);
  const say = 'update the video';
  const copy = () => {
    void navigator.clipboard?.writeText(say).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  if (hasVideo && !changed) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-white/10 bg-[#0b0d14]/95 px-4 py-3 backdrop-blur" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
      <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-slate-200">
        {hasVideo ? (
          <>
            <span>In the terminal, say:</span>
            <code className="rounded-md bg-white/10 px-2 py-0.5 font-mono">{say}</code>
            <button onClick={copy} className="flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1 text-xs hover:bg-white/10">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </>
        ) : (
          <span>
            <strong className="font-semibold text-white">Done?</strong> Go back to the terminal and press Enter.
          </span>
        )}
      </div>
    </div>
  );
};

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{children}</kbd>
);
