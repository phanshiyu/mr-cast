import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Storyboard, Voiceover } from './types';
import { timeline } from './utils/timing';

/**
 * none: silent. building: `play` is still voicing, `done` of `total` scenes have clips. failed: `play` stopped
 * voicing with an error, which it printed. ready: every clip is there and the viewer can switch to it. on: the
 * walkthrough plays with its voice.
 */
export type VoiceStatus =
  | { kind: 'none' }
  | { kind: 'building'; done: number; total: number }
  | { kind: 'failed' }
  | { kind: 'ready' }
  | { kind: 'on' };

const voicedScenes = (storyboard: Storyboard, voiceover: Voiceover | null) =>
  timeline(storyboard, voiceover).filter((c) => c.segments.length > 0 && c.segments.every((s) => s.clip)).length;

/**
 * Which voice-over the player shows. `play` opens before the voice is made and sends a `voice` event after each
 * clip; `voiceEvents` counts them. Until the viewer asks for the voice, the walkthrough plays silent, timed for
 * reading at the voice's pace, so the audio never switches in mid-play. A walkthrough already voiced when the page
 * loads plays with its voice.
 */
export function useVoiceChoice(storyboard: Storyboard | null, loaded: Voiceover | null | undefined, voiceEvents: number) {
  const [latest, setLatest] = useState<Voiceover | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const applied = useRef(0);

  useEffect(() => {
    if (loaded !== undefined) setLatest(loaded);
  }, [loaded]);

  useEffect(() => {
    if (!voiceEvents) return;
    fetch('./data/voiceover.json', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<Voiceover>) : null))
      .then((voiceover) => {
        // A slow answer to an earlier event must not undo a later one.
        if (voiceEvents < applied.current) return;
        applied.current = voiceEvents;
        // Voicing ended with nothing voiced: keep the timeline as it is, so the player does not restart.
        if (!voiceover || (!voiceover.pending && !Object.keys(voiceover.clips).length)) return setFailed(true);
        setFailed(false);
        setLatest(voiceover);
      }, () => {});
  }, [voiceEvents]);

  const done = storyboard ? voicedScenes(storyboard, latest) : 0;
  const complete = Boolean(latest && !latest.pending && done > 0);

  // Decided from the first load itself: `latest` only catches up with it on the next render.
  useEffect(() => {
    if (chosen === null && loaded !== undefined && storyboard) setChosen(Boolean(loaded && !loaded.pending && voicedScenes(storyboard, loaded) > 0));
  }, [chosen, loaded, storyboard]);

  const on = Boolean(chosen) && complete;
  const status: VoiceStatus = on ? { kind: 'on' }
    : complete ? { kind: 'ready' }
    : failed ? { kind: 'failed' }
    : latest?.pending && storyboard ? { kind: 'building', done, total: storyboard.scenes.length }
    : { kind: 'none' };

  // Silent at the voice's pace: one object per voice and pace, so a new clip does not restart the player.
  const { voice, speed, pauses } = latest ?? {};
  const silent = useMemo(() => (voice === undefined ? null : { voice, speed, pauses, clips: {} }), [voice, speed, pauses]);
  const shown = on ? latest : silent;
  const turnOn = useCallback(() => setChosen(true), []);
  return { decided: chosen !== null, shown, status, turnOn };
}
