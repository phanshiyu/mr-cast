/**
 * What `play` serves: a storyboard and the voice-over made for it, replaced together, so the page never pairs an
 * edited scene with a voice it does not have yet.
 *
 * `now(storyboard)` is the voice-over the storyboard can play with at once, and `wait` when some of its texts still
 * need voicing. `voice(storyboard, voiced)` voices them and resolves to the whole voice-over, or to null when play is
 * stopping. `reload()` tells open pages to load what is served.
 *
 * `start()` voices the first storyboard when it needs it. `ready` resolves once that storyboard is served with its
 * voice, or with a failed voicing. Until then the served voice-over is the clips so far, marked `pending`.
 */
export async function createServing({ raw, storyboard, now, voice, reload }) {
  let served;
  // Storyboards handed to voicing, and the one `served` holds: while they differ an edit is being voiced.
  let turns = 0;
  let settled = 0;
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  const serve = (turn, next) => {
    served = next;
    settled = turn;
    markReady();
  };

  // One voicing at a time, and only for the newest storyboard: an edit made while one runs replaces any still waiting.
  let voicing = Promise.resolve();
  const voiceInTurn = (rawNext, sb, voiced) => {
    const turn = ++turns;
    voicing = voicing.then(async () => {
      if (turn !== turns) return;
      const voiceover = await voice(sb, voiced);
      if (voiceover === null || turn !== turns) return;
      serve(turn, { storyboard: rawNext, voiceover });
      reload();
    });
  };

  const first = await now(storyboard);
  if (first.wait) served = { storyboard: raw, voiceover: { ...first.voiceover, pending: true } };
  else serve(0, { storyboard: raw, voiceover: first.voiceover });

  return {
    ready,
    start() {
      if (first.wait && turns === 0) voiceInTurn(raw, storyboard, first.voiceover);
    },
    storyboard: () => served.storyboard,
    voiceover: () => served.voiceover,
    /** Whether an edit is still being voiced, so a change now should wait for its reload. */
    holding: () => settled !== turns,
    /**
     * A valid edited storyboard. Served at once when every text is voiced; otherwise voiced first, and 'hold', which
     * tells open pages an update is coming.
     */
    async edit(rawNext, sb) {
      const next = await now(sb);
      if (next.wait) {
        voiceInTurn(rawNext, sb, next.voiceover);
        return 'hold';
      }
      // Already voiced: any voicing still running is for an older storyboard, so its result must not replace this.
      serve(++turns, { storyboard: rawNext, voiceover: next.voiceover });
      return undefined;
    },
  };
}
