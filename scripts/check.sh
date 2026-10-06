#!/usr/bin/env sh
set -eu
forge build
forge test
forge fmt --check
node --test test/*.test.mjs
node scripts/build-web.mjs
