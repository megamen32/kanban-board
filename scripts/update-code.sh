#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "refusing update: code checkout is dirty" >&2
  exit 2
fi

git fetch --prune origin main
git merge --ff-only origin/main
echo "code updated to $(git rev-parse --short HEAD); private task data was not touched"
