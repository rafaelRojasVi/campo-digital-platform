#!/usr/bin/env bash

set -euo pipefail

GITLEAKS_VERSION="8.30.1"
GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"

repo_root="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  pwd
)"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

curl -fsSL \
  --retry 3 \
  --retry-all-errors \
  -o "$tmp_dir/gitleaks.tar.gz" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"

printf "%s  %s\n" \
  "$GITLEAKS_SHA256" \
  "$tmp_dir/gitleaks.tar.gz" \
  | sha256sum -c -

tar -xzf \
  "$tmp_dir/gitleaks.tar.gz" \
  -C "$tmp_dir" \
  gitleaks

chmod 0755 "$tmp_dir/gitleaks"

cd "$repo_root"

"$tmp_dir/gitleaks" git \
  --log-opts="--all" \
  --redact \
  --verbose \
  --config .gitleaks.toml
