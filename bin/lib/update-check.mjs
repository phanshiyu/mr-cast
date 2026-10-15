// The background half of updateNotice: looks up the latest version and caches it. Failures are silent;
// the next check is a day later.
import { fetchLatest, writeCache } from './update.mjs';

try {
  writeCache(await fetchLatest(10_000));
} catch { /* offline or sandboxed */ }
