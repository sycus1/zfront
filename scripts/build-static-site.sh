#!/usr/bin/env bash
# Builds the static site that the Cloudflare Worker in wrangler.jsonc serves
# (staging.zfront.app): the production Vite build in static/, with
# static/index.html rendered as an environment-only app shell
# (src/server/RenderStaticIndex.ts --environment-only), plus a _headers file
# for Workers Static Assets. There is no game server: the client runs solo
# games locally, so the page names no server.
#
# Usage: GAME_ENV=staging DOMAIN=zfront.app scripts/build-static-site.sh
set -euo pipefail

cd "$(dirname "$0")/.."

export GAME_ENV="${GAME_ENV:-staging}"
export DOMAIN="${DOMAIN:-zfront.app}"
export GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse HEAD)}"
# Required by the page but unused by the solo client; this is Cloudflare's
# always-pass test key.
export TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY:-1x00000000000000000000AA}"
# Assets come from the same origin as the page.
export CDN_BASE=""

npm run build-prod

# RenderStaticIndex reads static/index.html as its template, so render to a
# temp file first.
tmp="$(mktemp)"
npx tsx src/server/RenderStaticIndex.ts --environment-only > "$tmp"
mv "$tmp" static/index.html
echo "$GIT_COMMIT" > static/commit.txt

# Hashed build output never changes under the same name.
cat > static/_headers <<'HEADERS'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/_assets/*
  Cache-Control: public, max-age=31536000, immutable
HEADERS

echo "Static site ready in static/ ($(find static -type f | wc -l) files)"
