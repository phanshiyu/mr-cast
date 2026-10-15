// Per-user cache outside the package, which a `sudo npm i -g` install leaves root-owned.

import os from 'node:os';
import path from 'node:path';

export const cacheRoot = () => path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'mr-cast');

export const cacheDir = (name) => path.join(cacheRoot(), name);
