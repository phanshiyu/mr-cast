import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Shown when `play` could not make the voice, so the walkthrough plays silent with subtitles. */
export const VoiceFailed: React.FC = () => (
  <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-rose-200" aria-live="polite">
    Voice failed, see the terminal
  </span>
);

const NEXT_STEPS = [
  { say: 'go deeper', what: 'A full walkthrough of the same code, keeping these scenes.' },
  { say: 'the whole branch', what: "A full walkthrough of the branch's changes." },
  { say: 'save it', what: 'This video as an MP4.' },
];

/** What a quick video can become next, as phrases to type to Claude. */
export const QuickEndCard: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(text),
      () => {},
    );
  };
  return (
    <div className="absolute inset-x-0 top-0 bottom-12 flex items-center justify-center bg-black/75 p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1018] p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Next, say to Claude</div>
        <ul className="mt-3 flex flex-col gap-2">
          {NEXT_STEPS.map(({ say, what }) => (
            <li
              key={say}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm text-white">"{say}"</div>
                <div className="text-xs text-slate-400">{what}</div>
              </div>
              <button type="button"
                onClick={() => copy(say)}
                aria-label={`Copy "${say}"`}
                className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                {copied === say ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
