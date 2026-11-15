import { BookOpenCheck, Check, Circle } from 'lucide-react';
import { NOT_STATED, type GuidePanel as Guide } from '../shared/guide.mjs';

/**
 * A branch video's brief beside the video (docs/adr/0037-reviewer-brief.md): the six questions a reviewer has with
 * their short answers, a mark for the ones the video has reached, and a click that seeks to the first scene that
 * tells each; then the places to open first, and the questions for the author. It is part of the page, not of the
 * composition, so the rendered MP4 never has it.
 */
export const GuidePanel: React.FC<{ guide: Guide; scene: number; onScene: (scene: number) => void }> = ({
  guide,
  scene,
  onScene,
}) => (
  <section aria-label="Guide to this change" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
    <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
      <BookOpenCheck size={15} className="text-indigo-300" />
      Guide
    </h2>
    <div className="grid gap-x-8 gap-y-4 xl:grid-cols-2">
      <ol className="flex flex-col gap-1">
        {guide.questions.map((q) => {
          const reached = q.scene !== null && q.scene <= scene;
          return (
            <li key={q.id}>
              <button
                type="button"
                disabled={q.scene === null}
                onClick={() => (q.scene === null ? undefined : onScene(q.scene))}
                className="flex w-full gap-3 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-white/5"
              >
                {reached ? (
                  <Check size={14} className="mt-1 shrink-0 text-indigo-300" aria-label="The video has reached this" />
                ) : (
                  <Circle size={14} className="mt-1 shrink-0 text-slate-600" aria-label="Not reached yet" />
                )}
                <span className="min-w-0 text-sm">
                  <span className={reached ? 'block font-medium text-white' : 'block font-medium text-slate-300'}>
                    {q.label}
                  </span>
                  <span className={q.answer ? 'block text-slate-400' : 'block text-slate-500'}>
                    {q.answer ?? NOT_STATED}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-4">
        {guide.parts.length ? (
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-slate-500">What each part does</h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {guide.parts.map((p) => (
                <li key={p.name} className="px-2">
                  <span
                    className={p.weight === 'routine' ? 'font-medium text-slate-400' : 'font-medium text-slate-200'}
                  >
                    {p.name}
                  </span>
                  <span className="text-slate-400"> {p.does}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {guide.check.length ? (
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-slate-500">Open first</h3>
            <ul className="flex flex-col gap-1.5">
              {guide.check.map((c) => (
                <li key={c.where}>
                  <button
                    type="button"
                    disabled={c.scene === null}
                    onClick={() => (c.scene === null ? undefined : onScene(c.scene))}
                    className="w-full rounded-lg px-2 py-1 text-left text-sm enabled:hover:bg-white/5"
                  >
                    <span className="break-all font-mono text-slate-200">{c.where}</span>
                    <span className="text-slate-300"> {c.what}</span>
                    {c.why ? <span className="block text-xs text-slate-500">{c.why}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {guide.decisions.length ? (
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-slate-500">Decisions</h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {guide.decisions.map((d) => (
                <li key={d.text}>
                  <span
                    className={d.kind === 'mine' ? 'block text-xs text-amber-300/90' : 'block text-xs text-slate-500'}
                  >
                    {d.lead}
                  </span>
                  <span className="text-slate-300">{d.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {guide.ask.length ? (
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-slate-500">Ask the author</h3>
            <ul className="flex list-disc flex-col gap-1 pl-6 text-sm text-slate-300">
              {guide.ask.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  </section>
);
