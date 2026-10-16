#!/usr/bin/env bash
# Creates a throwaway git repo whose `feature/password-reset` branch adds password reset tokens, with
# three planted problems for review mode to find, and nothing else wrong:
#   bug   src/reset.js    redeemResetToken deletes the token by user id, so a used token still works
#   risk  src/routes.js   the reset request logs the token, a secret that resets the password
#   nit   src/password.js validPassword returns an error message, not a boolean as its name says
# `node --test` passes on the branch: no test redeems a token twice.
# Usage: scripts/review-demo.sh <target-dir>
set -euo pipefail
dir="${1:?usage: review-demo.sh <target-dir>}"
rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"
git init -q -b main
git config user.email demo@mr-cast.local
git config user.name "mr-cast demo"

mkdir -p src test
cat > package.json <<'EOF'
{
  "name": "accounts",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOF
cat > src/db.js <<'EOF'
import { scryptSync, timingSafeEqual } from 'node:crypto';

// An in-memory store with the shape of the real one: every call is async.
const hash = (id, password) => scryptSync(password, `user:${id}`, 32);
const users = new Map();
const resetTokens = new Map();

export const db = {
  users: {
    async insert({ id, email, password }) {
      users.set(id, { id, email, passwordHash: hash(id, password) });
    },
    async find(id) {
      return users.get(id) ?? null;
    },
    /** Stores only a salted hash of the password. */
    async setPassword(id, password) {
      const user = users.get(id);
      if (!user) throw new Error(`no user ${id}`);
      user.passwordHash = hash(id, password);
    },
    async checkPassword(id, password) {
      const user = users.get(id);
      return Boolean(user) && timingSafeEqual(user.passwordHash, hash(id, password));
    },
  },
  resetTokens: {
    async insert(row) {
      resetTokens.set(row.token, { ...row });
    },
    /** The row for a token, or null. */
    async find(token) {
      return resetTokens.get(token) ?? null;
    },
    /** Removes a token so it cannot be used again. */
    async delete(token) {
      resetTokens.delete(token);
    },
  },
};
EOF
cat > src/routes.js <<'EOF'
import { db } from './db.js';

export async function handle(req) {
  if (req.method === 'GET' && req.path === '/me') {
    const user = await db.users.find(req.userId);
    return user ? { status: 200, body: { id: user.id, email: user.email } } : { status: 404 };
  }
  return { status: 404 };
}
EOF
git add -A && git commit -qm "Accounts service with an in-memory store"

git checkout -qb feature/password-reset
cat > src/password.js <<'EOF'
export const MIN_LENGTH = 12;

/** Why a new password is not allowed, or null when it is. */
export function validPassword(password) {
  if (typeof password !== 'string') return 'password must be text';
  if (password.length < MIN_LENGTH) return `password must be at least ${MIN_LENGTH} characters`;
  if (!/[0-9]/.test(password)) return 'password must contain a digit';
  return null;
}
EOF
cat > src/reset.js <<'EOF'
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { validPassword } from './password.js';

export const TOKEN_TTL_MS = 15 * 60 * 1000;

/** A one-time token that lets `userId` set a new password for the next 15 minutes. */
export async function createResetToken(userId, now = Date.now()) {
  const token = randomBytes(32).toString('hex');
  await db.resetTokens.insert({ token, userId, expiresAt: now + TOKEN_TTL_MS });
  return token;
}

/** Sets the new password if the token is known and not expired, then retires the token. */
export async function redeemResetToken(token, newPassword, now = Date.now()) {
  const row = await db.resetTokens.find(token);
  if (!row || row.expiresAt <= now) throw new Error('invalid or expired token');
  const problem = validPassword(newPassword);
  if (problem) throw new Error(problem);
  await db.users.setPassword(row.userId, newPassword);
  await db.resetTokens.delete(row.userId);
}
EOF
cat > src/routes.js <<'EOF'
import { db } from './db.js';
import { createResetToken, redeemResetToken } from './reset.js';

export async function handle(req) {
  if (req.method === 'GET' && req.path === '/me') {
    const user = await db.users.find(req.userId);
    return user ? { status: 200, body: { id: user.id, email: user.email } } : { status: 404 };
  }
  if (req.method === 'POST' && req.path === '/reset/request') {
    const user = await db.users.find(req.body.userId);
    // Answer the same whether or not the user exists, so the endpoint does not reveal accounts.
    if (!user) return { status: 202 };
    const token = await createResetToken(user.id);
    console.log(`reset requested for ${user.email}: token ${token}`);
    await req.mailer.send(user.email, `Reset your password: https://example.test/reset?token=${token}`);
    return { status: 202 };
  }
  if (req.method === 'POST' && req.path === '/reset/confirm') {
    try {
      await redeemResetToken(req.body.token, req.body.password);
      return { status: 204 };
    } catch (err) {
      return { status: 400, body: { error: err.message } };
    }
  }
  return { status: 404 };
}
EOF
cat > test/reset.test.js <<'EOF'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from '../src/db.js';
import { TOKEN_TTL_MS, createResetToken, redeemResetToken } from '../src/reset.js';

test('a fresh token sets the new password', async () => {
  await db.users.insert({ id: 'u1', email: 'a@example.test', password: 'old' });
  const token = await createResetToken('u1', 1000);
  await redeemResetToken(token, 'correct horse 42', 2000);
  assert.equal(await db.users.checkPassword('u1', 'correct horse 42'), true);
});

test('an expired token is refused', async () => {
  await db.users.insert({ id: 'u2', email: 'b@example.test', password: 'old' });
  const token = await createResetToken('u2', 1000);
  await assert.rejects(redeemResetToken(token, 'correct horse 42', 1000 + TOKEN_TTL_MS), /expired/);
});

test('a weak password is refused', async () => {
  await db.users.insert({ id: 'u3', email: 'c@example.test', password: 'old' });
  const token = await createResetToken('u3', 1000);
  await assert.rejects(redeemResetToken(token, 'short', 2000), /at least 12/);
});
EOF
git add -A && git commit -qm "Add password reset tokens"
