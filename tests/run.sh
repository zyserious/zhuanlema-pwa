#!/usr/bin/env bash
# 同步逻辑回归测试
set -e
cd "$(dirname "$0")"
node extract.js
node cases.js
node gift.js
