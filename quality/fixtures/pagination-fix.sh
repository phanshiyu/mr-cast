#!/usr/bin/env bash
# Fixture: small cursor-pagination bug fix in a TypeScript service, with its spec.
set -euo pipefail
dir="${1:?usage: pagination-fix.sh <target-dir>}"
rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"
git init -q -b main
git config user.email dev@northwind.example
git config user.name "Priya Raman"

mkdir -p src/lib src/routes
cat > README.md <<'EOF'
# activity-feed

Small service that stores account activity events and serves them to the dashboard.

    GET /accounts/:id/events?limit=50&cursor=<opaque>

Responses look like `{ "items": [...], "nextCursor": "..." | null }`. Pass `nextCursor` back
as `cursor` to get the following page. Events are returned oldest first.
EOF
cat > package.json <<'EOF'
{
  "name": "activity-feed",
  "version": "1.4.2",
  "private": true,
  "scripts": {
    "build": "tsc -p .",
    "spec": "jest"
  },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.11.5"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "@jest/globals": "^29.7.0",
    "jest": "^29.7.0"
  }
}
EOF
cat > src/lib/cursor.ts <<'EOF'
export interface Cursor {
  createdAt: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  if (typeof parsed.createdAt !== 'string') throw new Error('malformed cursor');
  return { createdAt: parsed.createdAt };
}
EOF
cat > src/lib/pagination.ts <<'EOF'
import { decodeCursor, encodeCursor } from './cursor';

export interface EventRow {
  id: string;
  accountId: string;
  type: string;
  createdAt: string;
}

export interface Db {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export async function listEvents(
  db: Db,
  accountId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<Page<EventRow>> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const after = opts.cursor ? decodeCursor(opts.cursor) : null;

  const rows = await db.query<EventRow>(
    `SELECT id, account_id AS "accountId", type, created_at AS "createdAt"
       FROM events
      WHERE account_id = $1
        AND ($2::timestamptz IS NULL OR created_at > $2)
      ORDER BY created_at ASC
      LIMIT $3`,
    [accountId, after?.createdAt ?? null, limit],
  );

  const last = rows[rows.length - 1];
  return {
    items: rows,
    nextCursor: rows.length === limit ? encodeCursor({ createdAt: last.createdAt }) : null,
  };
}
EOF
cat > src/lib/pagination.spec.ts <<'EOF'
import { describe, expect, it } from '@jest/globals';
import { listEvents, type Db, type EventRow } from './pagination';

function fakeDb(rows: EventRow[]): Db {
  return {
    async query<T>(_sql: string, params: unknown[]) {
      const [, after, limit] = params as [string, string | null, number];
      return rows
        .filter((r) => after === null || r.createdAt > after)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .slice(0, limit) as unknown as T[];
    },
  };
}

const row = (n: number): EventRow => ({
  id: `e${n}`,
  accountId: 'acc_1',
  type: 'login',
  createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, n)).toISOString(),
});

describe('listEvents', () => {
  it('returns the first page and a cursor', async () => {
    const db = fakeDb([1, 2, 3, 4, 5].map(row));
    const page = await listEvents(db, 'acc_1', { limit: 2 });
    expect(page.items.map((r) => r.id)).toEqual(['e1', 'e2']);
    expect(page.nextCursor).not.toBeNull();
  });

  it('walks every event once', async () => {
    const db = fakeDb([1, 2, 3, 4, 5].map(row));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listEvents(db, 'acc_1', { limit: 2, cursor });
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });
});
EOF
git add -A && git commit -qm "Initial activity feed"

git checkout -q -b fix/feed-cursor-ties
cat > src/lib/cursor.ts <<'EOF'
export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  if (typeof parsed.createdAt !== 'string') throw new Error('malformed cursor');
  // Cursors handed out before 1.4.3 only carry createdAt. Treat the id as the lowest
  // possible value so the page resumes at the start of that timestamp.
  return { createdAt: parsed.createdAt, id: typeof parsed.id === 'string' ? parsed.id : '' };
}
EOF
git add -A && git commit -qm "Carry the event id in the cursor"
cat > src/lib/pagination.ts <<'EOF'
import { decodeCursor, encodeCursor } from './cursor';

export interface EventRow {
  id: string;
  accountId: string;
  type: string;
  createdAt: string;
}

export interface Db {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export async function listEvents(
  db: Db,
  accountId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<Page<EventRow>> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const after = opts.cursor ? decodeCursor(opts.cursor) : null;

  // Ask for one extra row: it tells us whether another page exists without a second query.
  const rows = await db.query<EventRow>(
    `SELECT id, account_id AS "accountId", type, created_at AS "createdAt"
       FROM events
      WHERE account_id = $1
        AND ($2::timestamptz IS NULL OR (created_at, id) > ($2, $3))
      ORDER BY created_at ASC, id ASC
      LIMIT $4`,
    [accountId, after?.createdAt ?? null, after?.id ?? '', limit + 1],
  );

  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > limit ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}
EOF
python3 - <<'EOF'
p='src/lib/pagination.spec.ts'
s=open(p).read()
s=s.replace("""      const [, after, limit] = params as [string, string | null, number];
      return rows
        .filter((r) => after === null || r.createdAt > after)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .slice(0, limit) as unknown as T[];""","""      const [, afterAt, afterId, limit] = params as [string, string | null, string, number];
      return rows
        .filter((r) => afterAt === null || r.createdAt > afterAt || (r.createdAt === afterAt && r.id > afterId))
        .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1))
        .slice(0, limit) as unknown as T[];""")
s=s.replace("""    expect(seen).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });
""","""    expect(seen).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('has no next page when the last page is exactly full', async () => {
    const db = fakeDb([1, 2, 3, 4].map(row));
    const first = await listEvents(db, 'acc_1', { limit: 2 });
    const second = await listEvents(db, 'acc_1', { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((r) => r.id)).toEqual(['e3', 'e4']);
    expect(second.nextCursor).toBeNull();
  });

  it('does not drop events that share a timestamp across a page boundary', async () => {
    const at = '2024-01-01T00:00:00.000Z';
    const tied = ['a', 'b', 'c', 'd'].map((id) => ({ id, accountId: 'acc_1', type: 'import', createdAt: at }));
    const db = fakeDb(tied);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listEvents(db, 'acc_1', { limit: 2, cursor });
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
  });
""")
open(p,'w').write(s)
EOF
git add -A && git commit -qm "Page on (created_at, id) and fetch one extra row to detect the last page"
echo "pagination-fix repo ready at $dir (branch fix/feed-cursor-ties, base main)"
