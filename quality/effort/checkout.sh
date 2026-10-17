#!/usr/bin/env bash
# A reviewer's checkout: the seeded fixture with main and the feature branch checked out, no remote, no mr-cast files.
# Usage: quality/effort/checkout.sh <dest> <fixture>
set -euo pipefail
dest="${1:?usage: checkout.sh <dest> <fixture>}"
fixture="${2:?usage: checkout.sh <dest> <fixture>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "${dest:?}"
bash "$here/../fixtures/$fixture.sh" "$dest" >/dev/null
bash "$here/../node.sh" "$here/seed.mjs" "$dest" "$fixture" >/dev/null
