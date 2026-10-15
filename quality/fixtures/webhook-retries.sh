#!/usr/bin/env bash
# Fixture: TypeScript webhook delivery worker with retries, backoff, dead-letter handling and a new table.
set -euo pipefail
dir="${1:?usage: webhook-retries.sh <target-dir>}"
rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"
git init -q -b main
git config user.email dev@parcelhub.example
git config user.name "Marcus Oyelaran"

mkdir -p src/events src/db src/config db/migrations
cat > README.md <<'EOF'
# parcelhub-api

Shipment tracking API. Customers register webhook endpoints to hear about shipment events.

## Running

    npm install
    npm run migrate
    npm start

Configuration comes from environment variables, see `src/config`.
EOF
cat > package.json <<'EOF'
{
  "name": "parcelhub-api",
  "version": "2.8.0",
  "private": true,
  "scripts": {
    "build": "tsc -p .",
    "start": "node dist/server.js",
    "migrate": "node dist/db/migrate.js",
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
cat > src/db/client.ts <<'EOF'
import { Pool } from 'pg';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}
EOF
cat > src/config/index.ts <<'EOF'
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://localhost/parcelhub',
};
EOF
cat > src/events/publish.ts <<'EOF'
import { query } from '../db/client';

export interface ShipmentEvent {
  type: 'shipment.created' | 'shipment.in_transit' | 'shipment.delivered' | 'shipment.exception';
  shipmentId: string;
  accountId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export async function publishEvent(event: ShipmentEvent): Promise<void> {
  await query(
    `INSERT INTO shipment_events (shipment_id, account_id, type, occurred_at, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [event.shipmentId, event.accountId, event.type, event.occurredAt, JSON.stringify(event.data)],
  );
}
EOF
cat > src/server.ts <<'EOF'
import express from 'express';
import { config } from './config';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`parcelhub-api listening on ${config.port}`);
});
EOF
cat > db/migrations/006_webhook_endpoints.sql <<'EOF'
CREATE TABLE webhook_endpoints (
  id          BIGSERIAL PRIMARY KEY,
  account_id  TEXT NOT NULL,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webhook_endpoints_account_idx ON webhook_endpoints (account_id) WHERE active;
EOF
git add -A && git commit -qm "Initial shipment tracking API"

git checkout -q -b feature/webhook-retries

cat > db/migrations/007_webhook_deliveries.sql <<'EOF'
CREATE TYPE webhook_delivery_status AS ENUM ('pending', 'in_flight', 'delivered', 'dead');

CREATE TABLE webhook_deliveries (
  id               BIGSERIAL PRIMARY KEY,
  endpoint_id      BIGINT NOT NULL REFERENCES webhook_endpoints (id),
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           webhook_delivery_status NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status_code INTEGER,
  last_error       TEXT,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_due_idx
  ON webhook_deliveries (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX webhook_deliveries_endpoint_idx ON webhook_deliveries (endpoint_id, created_at DESC);
EOF
cat > src/config/webhooks.ts <<'EOF'
function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

export const webhookConfig = {
  /** How often the worker polls for due deliveries. */
  pollIntervalMs: int('WEBHOOK_POLL_INTERVAL_MS', 2_000),
  /** Deliveries claimed per poll. */
  batchSize: int('WEBHOOK_BATCH_SIZE', 25),
  /** After this many failed attempts the delivery moves to the dead-letter state. */
  maxAttempts: int('WEBHOOK_MAX_ATTEMPTS', 8),
  /** First retry waits this long, each further retry doubles it. */
  baseDelayMs: int('WEBHOOK_BASE_DELAY_MS', 5_000),
  /** Upper bound for a single wait. */
  maxDelayMs: int('WEBHOOK_MAX_DELAY_MS', 6 * 60 * 60 * 1000),
  requestTimeoutMs: int('WEBHOOK_REQUEST_TIMEOUT_MS', 10_000),
};

export type WebhookConfig = typeof webhookConfig;
EOF
mkdir -p src/webhooks
cat > src/webhooks/types.ts <<'EOF'
export type DeliveryStatus = 'pending' | 'in_flight' | 'delivered' | 'dead';

export interface Delivery {
  id: number;
  endpointId: number;
  eventType: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: Date;
}

export interface Endpoint {
  id: number;
  accountId: string;
  url: string;
  secret: string;
  active: boolean;
}

export type AttemptOutcome =
  | { kind: 'delivered'; statusCode: number }
  | { kind: 'retry'; statusCode: number | null; error: string }
  | { kind: 'dead'; statusCode: number | null; error: string };
EOF
cat > src/webhooks/backoff.ts <<'EOF'
import type { WebhookConfig } from '../config/webhooks';

/**
 * Delay before the retry that follows `attempts` failed attempts.
 * attempts = 1 gives the base delay, then 2x, 4x, 8x ... capped at maxDelayMs.
 */
export function retryDelayMs(attempts: number, cfg: Pick<WebhookConfig, 'baseDelayMs' | 'maxDelayMs'>): number {
  const exponent = Math.max(0, attempts - 1);
  const delay = cfg.baseDelayMs * 2 ** exponent;
  return Math.min(delay, cfg.maxDelayMs);
}

export function nextAttemptAt(now: Date, attempts: number, cfg: Pick<WebhookConfig, 'baseDelayMs' | 'maxDelayMs'>): Date {
  return new Date(now.getTime() + retryDelayMs(attempts, cfg));
}
EOF
cat > src/webhooks/signer.ts <<'EOF'
import { createHmac } from 'node:crypto';

export function signPayload(secret: string, timestamp: number, body: string): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}
EOF
cat > src/webhooks/repository.ts <<'EOF'
import { query } from '../db/client';
import type { Delivery, DeliveryStatus, Endpoint } from './types';

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: Date;
  last_status_code: number | null;
  last_error: string | null;
  created_at: Date;
}

function toDelivery(row: DeliveryRow): Delivery {
  return {
    id: Number(row.id),
    endpointId: Number(row.endpoint_id),
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export async function enqueueForAccount(accountId: string, eventType: string, payload: Record<string, unknown>): Promise<number> {
  const rows = await query<{ id: string }>(
    `INSERT INTO webhook_deliveries (endpoint_id, event_type, payload)
     SELECT id, $2, $3 FROM webhook_endpoints WHERE account_id = $1 AND active
     RETURNING id`,
    [accountId, eventType, JSON.stringify(payload)],
  );
  return rows.length;
}

/** Marks up to `limit` due deliveries as in_flight and returns them. */
export async function claimDue(now: Date, limit: number): Promise<Delivery[]> {
  const rows = await query<DeliveryRow>(
    `UPDATE webhook_deliveries
        SET status = 'in_flight'
      WHERE id IN (
        SELECT id FROM webhook_deliveries
         WHERE status = 'pending' AND next_attempt_at <= $1
         ORDER BY next_attempt_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [now, limit],
  );
  return rows.map(toDelivery);
}

export async function getEndpoint(id: number): Promise<Endpoint | null> {
  const rows = await query<{ id: string; account_id: string; url: string; secret: string; active: boolean }>(
    'SELECT id, account_id, url, secret, active FROM webhook_endpoints WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: Number(row.id), accountId: row.account_id, url: row.url, secret: row.secret, active: row.active };
}

export async function markDelivered(id: number, statusCode: number): Promise<void> {
  await query(
    `UPDATE webhook_deliveries
        SET status = 'delivered', attempts = attempts + 1, last_status_code = $2,
            last_error = NULL, delivered_at = now()
      WHERE id = $1`,
    [id, statusCode],
  );
}

export async function markRetry(id: number, nextAttemptAt: Date, statusCode: number | null, error: string): Promise<void> {
  await query(
    `UPDATE webhook_deliveries
        SET status = 'pending', attempts = attempts + 1, next_attempt_at = $2,
            last_status_code = $3, last_error = $4
      WHERE id = $1`,
    [id, nextAttemptAt, statusCode, error],
  );
}

export async function markDead(id: number, statusCode: number | null, error: string): Promise<void> {
  await query(
    `UPDATE webhook_deliveries
        SET status = 'dead', attempts = attempts + 1, last_status_code = $2, last_error = $3
      WHERE id = $1`,
    [id, statusCode, error],
  );
}

export async function listDead(endpointId: number, limit = 100): Promise<Delivery[]> {
  const rows = await query<DeliveryRow>(
    `SELECT * FROM webhook_deliveries
      WHERE endpoint_id = $1 AND status = 'dead'
      ORDER BY created_at DESC
      LIMIT $2`,
    [endpointId, limit],
  );
  return rows.map(toDelivery);
}

export async function requeueDead(id: number): Promise<boolean> {
  const rows = await query(
    `UPDATE webhook_deliveries
        SET status = 'pending', attempts = 0, next_attempt_at = now()
      WHERE id = $1 AND status = 'dead'
      RETURNING id`,
    [id],
  );
  return rows.length === 1;
}
EOF
cat > src/webhooks/deadLetter.ts <<'EOF'
import { listDead, requeueDead } from './repository';
import type { Delivery } from './types';

export interface DeadLetterSummary {
  id: number;
  eventType: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

export async function inspectDeadLetters(endpointId: number): Promise<DeadLetterSummary[]> {
  const dead = await listDead(endpointId);
  return dead.map(summarize);
}

/** Puts every dead delivery for the endpoint back in the queue. Returns how many were requeued. */
export async function replayDeadLetters(endpointId: number): Promise<number> {
  const dead = await listDead(endpointId, 1000);
  let replayed = 0;
  for (const delivery of dead) {
    if (await requeueDead(delivery.id)) replayed += 1;
  }
  return replayed;
}

function summarize(d: Delivery): DeadLetterSummary {
  return {
    id: d.id,
    eventType: d.eventType,
    attempts: d.attempts,
    lastStatusCode: d.lastStatusCode,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
  };
}
EOF
git add -A && git commit -qm "Add webhook_deliveries table, backoff, signer and repository"

cat > src/webhooks/worker.ts <<'EOF'
import { webhookConfig, type WebhookConfig } from '../config/webhooks';
import { nextAttemptAt } from './backoff';
import { claimDue, getEndpoint, markDead, markDelivered, markRetry } from './repository';
import { signPayload } from './signer';
import type { AttemptOutcome, Delivery } from './types';

type Fetch = typeof fetch;

export interface WorkerDeps {
  fetch: Fetch;
  now: () => Date;
  config: WebhookConfig;
}

const defaultDeps: WorkerDeps = { fetch, now: () => new Date(), config: webhookConfig };

/** Single attempt: POST the payload and classify what came back. */
export async function attemptDelivery(delivery: Delivery, deps: WorkerDeps = defaultDeps): Promise<AttemptOutcome> {
  const endpoint = await getEndpoint(delivery.endpointId);
  if (!endpoint || !endpoint.active) {
    return { kind: 'dead', statusCode: null, error: 'endpoint missing or disabled' };
  }

  const body = JSON.stringify({ id: delivery.id, type: delivery.eventType, data: delivery.payload });
  const timestamp = Math.floor(deps.now().getTime() / 1000);

  try {
    const res = await deps.fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-parcelhub-signature': signPayload(endpoint.secret, timestamp, body),
        'x-parcelhub-delivery': String(delivery.id),
      },
      body,
      signal: AbortSignal.timeout(deps.config.requestTimeoutMs),
    });
    if (res.ok) return { kind: 'delivered', statusCode: res.status };
    return failed(delivery, res.status, `endpoint answered ${res.status}`, deps);
  } catch (err) {
    return failed(delivery, null, err instanceof Error ? err.message : String(err), deps);
  }
}

function failed(delivery: Delivery, statusCode: number | null, error: string, deps: WorkerDeps): AttemptOutcome {
  const attemptsAfter = delivery.attempts + 1;
  if (attemptsAfter >= deps.config.maxAttempts) return { kind: 'dead', statusCode, error };
  return { kind: 'retry', statusCode, error };
}

async function settle(delivery: Delivery, outcome: AttemptOutcome, deps: WorkerDeps): Promise<void> {
  switch (outcome.kind) {
    case 'delivered':
      return markDelivered(delivery.id, outcome.statusCode);
    case 'retry': {
      const at = nextAttemptAt(deps.now(), delivery.attempts + 1, deps.config);
      return markRetry(delivery.id, at, outcome.statusCode, outcome.error);
    }
    case 'dead':
      return markDead(delivery.id, outcome.statusCode, outcome.error);
  }
}

/** One poll: claim due deliveries, attempt them concurrently, record the results. */
export async function runOnce(deps: WorkerDeps = defaultDeps): Promise<number> {
  const due = await claimDue(deps.now(), deps.config.batchSize);
  await Promise.all(
    due.map(async (delivery) => {
      const outcome = await attemptDelivery(delivery, deps);
      await settle(delivery, outcome, deps);
    }),
  );
  return due.length;
}

export function startWebhookWorker(deps: WorkerDeps = defaultDeps): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    try {
      const handled = await runOnce(deps);
      if (handled === deps.config.batchSize && !stopped) return void setImmediate(tick);
    } catch (err) {
      console.error('[webhooks] poll failed', err);
    }
    if (!stopped) timer = setTimeout(tick, deps.config.pollIntervalMs);
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
EOF
python3 - <<'EOF'
p='src/events/publish.ts'
s=open(p).read()
s=s.replace("import { query } from '../db/client';\n","import { query } from '../db/client';\nimport { enqueueForAccount } from '../webhooks/repository';\n")
s=s.replace("""    [event.shipmentId, event.accountId, event.type, event.occurredAt, JSON.stringify(event.data)],
  );
""","""    [event.shipmentId, event.accountId, event.type, event.occurredAt, JSON.stringify(event.data)],
  );
  await enqueueForAccount(event.accountId, event.type, {
    shipmentId: event.shipmentId,
    occurredAt: event.occurredAt,
    ...event.data,
  });
""")
open(p,'w').write(s)
p='src/server.ts'
s=open(p).read()
s=s.replace("import { config } from './config';\n","import { config } from './config';\nimport { startWebhookWorker } from './webhooks/worker';\n")
s=s.replace("""app.listen(config.port, () => {
  console.log(`parcelhub-api listening on ${config.port}`);
});
""","""const stopWebhookWorker = startWebhookWorker();

const server = app.listen(config.port, () => {
  console.log(`parcelhub-api listening on ${config.port}`);
});

process.on('SIGTERM', () => {
  stopWebhookWorker();
  server.close();
});
""")
open(p,'w').write(s)
EOF
git add -A && git commit -qm "Deliver shipment events to webhook endpoints from a polling worker"

cat > src/webhooks/backoff.spec.ts <<'EOF'
import { describe, expect, it } from '@jest/globals';
import { nextAttemptAt, retryDelayMs } from './backoff';

const cfg = { baseDelayMs: 5_000, maxDelayMs: 60_000 };

describe('retryDelayMs', () => {
  it('starts at the base delay and doubles', () => {
    expect(retryDelayMs(1, cfg)).toBe(5_000);
    expect(retryDelayMs(2, cfg)).toBe(10_000);
    expect(retryDelayMs(3, cfg)).toBe(20_000);
  });

  it('is capped at maxDelayMs', () => {
    expect(retryDelayMs(10, cfg)).toBe(60_000);
  });
});

describe('nextAttemptAt', () => {
  it('adds the delay to now', () => {
    const now = new Date('2024-05-01T12:00:00.000Z');
    expect(nextAttemptAt(now, 2, cfg).toISOString()).toBe('2024-05-01T12:00:10.000Z');
  });
});
EOF
cat > src/webhooks/worker.spec.ts <<'EOF'
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as repo from './repository';
import { attemptDelivery, runOnce, type WorkerDeps } from './worker';
import type { Delivery } from './types';

jest.mock('./repository');

const config = {
  pollIntervalMs: 1_000,
  batchSize: 10,
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  requestTimeoutMs: 1_000,
};

const now = new Date('2024-05-01T12:00:00.000Z');

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 1,
    endpointId: 7,
    eventType: 'shipment.delivered',
    payload: { shipmentId: 's_1' },
    status: 'in_flight',
    attempts: 0,
    nextAttemptAt: now,
    lastStatusCode: null,
    lastError: null,
    createdAt: now,
    ...overrides,
  };
}

function deps(status: number | Error): WorkerDeps {
  const fetchStub = jest.fn(async () => {
    if (status instanceof Error) throw status;
    return new Response('', { status });
  });
  return { fetch: fetchStub as unknown as typeof fetch, now: () => now, config };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(repo.getEndpoint).mockResolvedValue({
    id: 7,
    accountId: 'acc_1',
    url: 'https://hooks.example.com/parcel',
    secret: 'whsec_x',
    active: true,
  });
});

describe('attemptDelivery', () => {
  it('reports delivered on 2xx', async () => {
    expect(await attemptDelivery(delivery(), deps(204))).toEqual({ kind: 'delivered', statusCode: 204 });
  });

  it('asks for a retry on 500 while attempts remain', async () => {
    const outcome = await attemptDelivery(delivery({ attempts: 1 }), deps(500));
    expect(outcome.kind).toBe('retry');
  });

  it('goes dead on the final attempt', async () => {
    const outcome = await attemptDelivery(delivery({ attempts: 2 }), deps(500));
    expect(outcome).toMatchObject({ kind: 'dead', statusCode: 500 });
  });

  it('treats a network error as retryable', async () => {
    const outcome = await attemptDelivery(delivery(), deps(new Error('ECONNRESET')));
    expect(outcome).toMatchObject({ kind: 'retry', statusCode: null, error: 'ECONNRESET' });
  });
});

describe('runOnce', () => {
  it('schedules the retry with exponential backoff', async () => {
    jest.mocked(repo.claimDue).mockResolvedValue([delivery({ attempts: 1 })]);
    await runOnce(deps(503));
    expect(repo.markRetry).toHaveBeenCalledWith(1, new Date('2024-05-01T12:00:02.000Z'), 503, 'endpoint answered 503');
  });

  it('marks exhausted deliveries dead', async () => {
    jest.mocked(repo.claimDue).mockResolvedValue([delivery({ attempts: 2 })]);
    await runOnce(deps(503));
    expect(repo.markDead).toHaveBeenCalledWith(1, 503, 'endpoint answered 503');
  });
});
EOF
git add -A && git commit -qm "Add specs for backoff and the delivery worker"
echo "webhook-retries repo ready at $dir (branch feature/webhook-retries, base main)"
