#!/usr/bin/env bash
# 版本一致性校验：四处版本标记 + CHANGELOG 必须相互对齐
# 跑法：bash tests/version-check.sh
set -e
cd "$(dirname "$0")/.."

python - <<'PY'
import json, re, sys

fail = []
ok = []

# 1) v.json
build = json.load(open('v.json', encoding='utf-8')).get('build', '')
if not build:
    fail.append('v.json 缺少 build 字段')
else:
    ok.append(f'v.json build={build}')

html = open('index.html', encoding='utf-8').read()
sw = open('sw.js', encoding='utf-8').read()
import os
log = open('CHANGELOG.md', encoding='utf-8').read() if os.path.exists('CHANGELOG.md') else None

# 2) 页脚版本
m = re.search(r'class="foot">[^<]*?v(\d+\.\d+)', html)
foot = m.group(1) if m else ''
if foot != build:
    fail.append(f'页脚版本 v{foot or "?"} 与 v.json build={build} 不一致')
else:
    ok.append(f'页脚 v{foot}')

# 3) sw.js?v=N
m = re.search(r"sw\.js\?v=(\d+)", html)
swv = m.group(1) if m else ''
if not swv:
    fail.append('index.html 里没找到 sw.js?v=N 注册')
else:
    ok.append(f'sw.js?v={swv}')

# 4) sw.js CACHE
m = re.search(r"const CACHE = '([^']+)'", sw)
cache = m.group(1) if m else ''
if not cache:
    fail.append('sw.js 里没找到 CACHE 常量')
else:
    ok.append(f'CACHE={cache}')

# 5) CHANGELOG 当前版本的声明
if log is None:
    print('  skip CHANGELOG.md 不存在（部署目录可只校验四处标记）')
else:
    m = re.search(r'^## \[v' + re.escape(build) + r'\][^\n]*\n(.*?)(?=^## |\Z)', log, re.S | re.M)
    if not m:
        fail.append(f'CHANGELOG.md 里没有 v{build} 的记录')
    else:
        block = m.group(1)
        ok.append(f'CHANGELOG 有 v{build}')
        d_sw = re.search(r'sw\.js\?v=(\d+)', block)
        d_cache = re.search(r'CACHE=([\w-]+)', block)
        if d_sw and d_sw.group(1) != swv:
            fail.append(f'CHANGELOG 写 sw.js?v={d_sw.group(1)}，实际是 ?v={swv}')
        elif not d_sw:
            fail.append('CHANGELOG 该版本没写 sw.js?v=N')
        if d_cache and d_cache.group(1) != cache:
            fail.append(f'CHANGELOG 写 CACHE={d_cache.group(1)}，实际是 {cache}')
        elif not d_cache:
            fail.append('CHANGELOG 该版本没写 CACHE=...')

for s in ok:
    print('  ok   ' + s)
if fail:
    print()
    for f in fail:
        print('  FAIL ' + f)
    print('\n版本标记不一致，先对齐再发版')
    sys.exit(1)
print('\n版本标记一致 ✓')
PY
