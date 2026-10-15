#!/usr/bin/env bash
# Creates a throwaway git repo with a `main` branch and a `feature/rate-limit` branch
# whose diff exercises additions, deletions, a new file, a rename and a deletion.
# Usage: scripts/demo.sh <target-dir>
set -euo pipefail
dir="${1:?usage: demo.sh <target-dir>}"
rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"
git init -q -b main
git config user.email demo@mr-cast.local
git config user.name "mr-cast demo"

mkdir -p src/api src/services src/db
cat > src/api/server.ts <<'EOF'
import express from 'express';
import { createOrder } from '../services/orders';

const app = express();
app.use(express.json());

app.post('/orders', async (req, res) => {
  const order = await createOrder(req.body);
  res.status(201).json(order);
});

app.listen(3000);
EOF
cat > src/services/orders.ts <<'EOF'
import { db } from '../db/client';

export interface OrderInput {
  userId: string;
  items: { sku: string; qty: number }[];
}

export async function createOrder(input: OrderInput) {
  const total = input.items.reduce((sum, i) => sum + i.qty * 10, 0);
  const order = await db.insert('orders', { ...input, total });
  return order;
}
EOF
cat > src/db/client.ts <<'EOF'
export const db = {
  async insert(table: string, row: Record<string, unknown>) {
    return { id: Math.random().toString(36).slice(2), table, ...row };
  },
};
EOF
cat > src/legacy-throttle.ts <<'EOF'
// Old in-memory throttle, unused since the gateway was introduced.
const hits = new Map<string, number>();
export function throttle(key: string) {
  hits.set(key, (hits.get(key) ?? 0) + 1);
  return hits.get(key)! < 100;
}
EOF
cat > README.md <<'EOF'
# Orders API

POST /orders creates an order.

## Running

    npm install
    npm start

The server listens on port 3000.
EOF
git add -A && git commit -qm "Initial orders API"

git checkout -q -b feature/rate-limit
cat > src/api/server.ts <<'EOF'
import express from 'express';
import { createOrder } from '../services/orders';
import { rateLimit } from './rate-limit';
import { publish } from '../queue/events';

const app = express();
app.use(express.json());
app.use('/orders', rateLimit({ windowMs: 60_000, max: 20 }));

app.post('/orders', async (req, res) => {
  const order = await createOrder(req.body);
  await publish('order.created', { orderId: order.id, total: order.total });
  res.status(201).json(order);
});

app.listen(3000);
EOF
cat > src/api/rate-limit.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../db/redis';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export function rateLimit({ windowMs, max }: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `rl:${req.ip}:${Math.floor(Date.now() / windowMs)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, windowMs);
    if (count > max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}
EOF
cat > src/services/orders.ts <<'EOF'
import { db } from '../db/client';
import { priceFor } from './pricing';

export interface OrderInput {
  userId: string;
  items: { sku: string; qty: number }[];
}

export async function createOrder(input: OrderInput) {
  if (input.items.length === 0) throw new Error('empty order');
  const prices = await Promise.all(input.items.map((i) => priceFor(i.sku)));
  const total = input.items.reduce((sum, i, idx) => sum + i.qty * prices[idx], 0);
  const order = await db.insert('orders', { ...input, total, status: 'pending' });
  return order;
}
EOF
mkdir -p src/queue
cat > src/queue/events.ts <<'EOF'
export async function publish(topic: string, payload: Record<string, unknown>) {
  console.log(`[queue] ${topic}`, JSON.stringify(payload));
}
EOF
git mv README.md docs.md
printf "\nRequests are limited to 20 per minute per IP.\n" >> docs.md
git rm -q src/legacy-throttle.ts
git add -A && git commit -qm "Add Redis rate limiting and order.created events"
echo "demo repo ready at $dir (branch feature/rate-limit, base main)"
