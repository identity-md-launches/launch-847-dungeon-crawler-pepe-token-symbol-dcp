#!/usr/bin/env sh
set -eu
forge build --offline
forge test --offline
forge fmt --check
node --test test/*.test.mjs
node scripts/build-web.mjs
