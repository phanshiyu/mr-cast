import { Check, Copy, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { plainText } from '../shared/markup.mjs';
import { flagText, readingChecklist, type ReadingOrder } from '../shared/reading.mjs';
import { severityInk } from './components/theme';

type Copied = 'idle' | 'copied' | 'failed';

/**
 * A pre-read's reading order beside the video, to follow in the editor once it ends: every item with its file and
 * lines, what to check, the finding it carries and the chapter that explains it, which seeks the video there.
 */
export const ReadingPanel: React.FC<{ order: ReadingOrder; onChapter: (chapter: string) => void }> = ({ order, onChapter }) => {
  const [copied, setCopied] = useState<Copied>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${readingChecklist(order)}\n`);
      setCopied('copied');
      setTimeout(() => setCopied('idle'), 2000);
    } catch {
      // A browser that refuses the clipboard gets the checklist to copy by hand; it stays until the next copy.
      setCopied('failed');
    }
  };
  return (
    <section aria-label="Reading order" className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          <ListChecks size={15} className="text-indigo-300" />
          Reading order
        </h2>
        <button
          onClick={() => void copy()}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 hover:bg-white/10"
        >
          {copied === 'copied' ? <Check size={13} /> : <Copy size={13} />}
          {copied === 'copied' ? 'Copied' : 'Copy as checklist'}
        </button>
      </div>
      {copied === 'failed' ? (
        <div className="mb-3">
          <p className="mb-1 text-xs text-amber-200">The browser blocked the clipboard. Copy the checklist from here:</p>
          <textarea
            readOnly
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={`${readingChecklist(order)}\n`}
            rows={6}
            className="w-full rounded-lg border border-white/10 bg-black/30 p-2 font-mono text-xs text-slate-200"
          />
        </div>
      ) : null}
      {order.groups.map((group, g) => (
        <div key={g} className="mb-3 last:mb-0">
          {group.title ? <div className="mb-1.5 text-xs font-medium text-slate-500">{plainText(group.title)}</div> : null}
          <ol className="flex flex-col gap-1.5">
            {group.items.map((item) => (
              <li key={item.hunkId} className="flex gap-3 text-sm">
                <span className="w-5 shrink-0 text-right font-mono text-slate-500">{item.number}.</span>
                <div className="min-w-0">
                  <span className="font-mono text-slate-200">{item.where}</span>
                  <span className="text-slate-300"> {plainText(item.check)}</span>
                  {item.finding ? (
                    <div className="text-xs" style={{ color: severityInk[item.finding.severity] }}>
                      {flagText(item.finding)}
                    </div>
                  ) : null}
                  {item.explainedIn ? (
                    <button onClick={() => onChapter(item.explainedIn!)} className="block text-xs text-slate-500 hover:text-indigo-300">
                      Explained in: {item.explainedIn}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {order.skim.length ? (
        <div className="mt-3 border-t border-white/5 pt-3 text-xs text-slate-500">
          {order.skim.map((group, g) => (
            <div key={g}>
              Skim{group.title ? ` (${plainText(group.title)})` : ''}: <span className="font-mono">{group.items.map((item) => item.where).join(', ')}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};
