#!/bin/bash -e
# Re-vendor the golden test corpus from the upstream Shader Minifier clone.
UP="${1:-$HOME/projects/shader-minifier}"
cd "$(dirname "$0")/.."
rm -rf tests
cp -R "$UP/tests" tests
cp "$UP/LICENSE" tests/LICENSE-shader-minifier
(cd "$UP" && git rev-parse HEAD) > tests/UPSTREAM
rm -rf tests/out
echo "synced tests from $UP @ $(cat tests/UPSTREAM)"
