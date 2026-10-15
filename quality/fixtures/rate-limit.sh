#!/usr/bin/env bash
# Fixture: Redis rate limiting plus order events (the shipped demo repo).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$here/../../scripts/demo.sh" "${1:?usage: rate-limit.sh <target-dir>}"
