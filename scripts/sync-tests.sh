#!/bin/bash -e
# Re-vendor the golden test corpus from the upstream Shader Minifier clone,
# then re-apply the deliberate deviations recorded in tests/DEVIATIONS.md.
UP="${1:-$HOME/projects/shader-minifier}"
cd "$(dirname "$0")/.."
cp tests/DEVIATIONS.md /tmp/shader-minifier-DEVIATIONS.md
rm -rf tests
cp -R "$UP/tests" tests
cp "$UP/LICENSE" tests/LICENSE-shader-minifier
(cd "$UP" && git rev-parse HEAD) > tests/UPSTREAM
mv /tmp/shader-minifier-DEVIATIONS.md tests/DEVIATIONS.md
rm -rf tests/out
git apply scripts/golden-deviations.patch
echo "synced tests from $UP @ $(cat tests/UPSTREAM)"
