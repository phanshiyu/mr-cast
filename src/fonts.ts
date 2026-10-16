import { continueRender, delayRender } from 'remotion';
import hand from './assets/caveat-latin-600.woff2';
import mono from './assets/jetbrains-mono-latin.woff2';
import sans from './assets/inter-latin.woff2';

// Every face mr-cast draws text in ships with it, so text measures the same on every system as in
// shared/font-metrics.mjs, which scripts/measure-fonts.mjs measured from these files.

export const FACES = { sans: 'mr-cast-sans', mono: 'mr-cast-mono', hand: 'mr-cast-hand' } as const;

const SOURCES = [
  { family: FACES.sans, url: sans, weight: '400 800' },
  { family: FACES.mono, url: mono, weight: '400 800' },
  { family: FACES.hand, url: hand, weight: '600' },
];

/** Settles once every face is loaded and added to the document, or has failed to load and warned. */
export const fontsReady: Promise<void> =
  typeof document === 'undefined' || typeof FontFace === 'undefined'
    ? Promise.resolve()
    : (() => {
        // A render waits for the faces before its first frame; the player waits before it first paints.
        const handle = delayRender('Loading the fonts mr-cast draws text in');
        return Promise.all(
          SOURCES.map(({ family, url, weight }) =>
            new FontFace(family, `url(${url}) format('woff2')`, { weight })
              .load()
              .then((face) => void document.fonts.add(face))
              .catch((err) => console.warn(`mr-cast: ${family} falls back to a system font: ${err}`)),
          ),
        ).then(() => continueRender(handle));
      })();
