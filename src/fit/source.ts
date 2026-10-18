import { fitText, type Fit } from '../../shared/textfit.mjs';
import { SAFE } from '../components/theme';
import type { HunkMap, Scene } from '../types';
import { SLOTS, sized } from './slots';

/** "In the code: limiter.ts, server.ts": the files of the hunks a pre-read's diagram cites in `from`, never typed. */
export function sourceText(scene: Scene, hunks: HunkMap): string | null {
  const files = [
    ...new Set((scene.from ?? []).flatMap((id) => (hunks[id] ? [hunks[id]!.file.split('/').at(-1)!] : []))),
  ];
  return files.length ? `In the code: ${files.join(', ')}` : null;
}

/** The quiet line above a diagram that names the files it explains, or null when it cites none. */
export function sourceFit(scene: Scene, hunks: HunkMap): Fit | null {
  const text = sourceText(scene, hunks);
  return text ? fitText(text, sized(SLOTS.sourceLine, 1920 - SAFE.left - SAFE.right), 'from') : null;
}
