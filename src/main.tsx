import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { fontsReady } from './fonts';
import './index.css';

// The page paints once its fonts are in, so no text is drawn first in a system font and then jumps.
void fontsReady.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
