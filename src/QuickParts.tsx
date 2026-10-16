import { Check, Copy, Volume2 } from 'lucide-react';
import { useState } from 'react';
import type { VoiceStatus } from './useVoiceChoice';

/** The voice's progress while `play` makes it, then the button that turns it on. */
export const VoicePill: React.FC<{ status: VoiceStatus; onVoice: () => void }> = ({ status, onVoice }) => {
  if (status.kind === 'building') {
    return (
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono" aria-live="polite">
        Voice: {status.done} of {status.total} scenes
      </span>
    );
  }
  if (status.kind !== 'ready') return null;
  return (
    <button
      onClick={onVoice}
      className="flex items-center gap-1.5 rounded-full bg-indigo-500 px-3 py-1 font-semibold text-white hover:bg-indigo-400"
    >
      <Volume2 size={13} />
      Play with voice (V)
    </button>
  );
};

const NEXT_STEPS = [
  { say: 'go deeper', what: 'A full walkthrough of the same code, keeping these scenes.' },
  { say: 'the whole branch', what: "A full walkthrough of the branch's changes." },
  { say: 'save it', what: 'This video as an MP4.' },
];

/** What a quick video can become next, as phrases to type to Claude. */
export const QuickEndCard: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(text), () => {});
  };
  return (
    <div className="absolute inset-x-0 top-0 bottom-12 flex items-center justify-center bg-black/75 p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1018] p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Next, say to Claude</div>
        <ul className="mt-3 flex flex-col gap-2">
          {NEXT_STEPS.map(({ say, what }) => (
            <li key={say} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm text-white">"{say}"</div>
                <div className="text-xs text-slate-400">{what}</div>
              </div>
              <button
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
