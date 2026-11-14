#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""推送时段矩阵探针：验证 due_messages 在一天各时刻只发该发的消息。

运行：PYTHONIOENCODING=utf-8 python test_push_schedule.py
（server.py 依赖 pywebpush，本机没有时用桩替身，只测纯函数）
"""
import os
import sys
import types
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'push'))
try:
    import pywebpush  # noqa: F401
except ImportError:
    _m = types.ModuleType('pywebpush')
    _m.WebPushException = type('WebPushException', (Exception,), {})
    _m.webpush = lambda *a, **k: None
    sys.modules['pywebpush'] = _m

import server  # noqa: E402

TZ = timezone(timedelta(hours=8))
ST = {'salary': 5300, 'payDays': 26, 'start': '08:00', 'end': '18:00',
      'nightStart': '16:00', 'nightEnd': '00:00', 'remindMin': 30,
      'evePreview': True, 'eveHour': 21}

# 11-16 周一：夜班；11-17：白班（测跨午夜收工用 11-16 夜班 + 11-17 00:00 时刻）
SHIFTS = {'2026-11-16': 'n', '2026-11-17': 'd', '2026-11-15': 'n'}
SUB = {'settings': ST, 'shifts': SHIFTS}


def at(day, hh, mm, ss=0):
    return datetime(2026, 11, day, hh, mm, ss, tzinfo=TZ)


def keys(now):
    return [k for k, _, _, _ in server.due_messages(SUB, now)]


fails = []


def check(name, now, expect):
    got = sorted(keys(now))
    if got != sorted(expect):
        fails.append('%s @ %s: 期望 %s，实际 %s' % (name, now.strftime('%m-%d %H:%M'), expect, got))
    else:
        print('PASS %-18s %s -> %s' % (name, now.strftime('%m-%d %H:%M'), got or '(静默)'))


# --- 夜班日 11-16（16:00 上班，24:00 收工）---
check('深夜静默', at(16, 2, 0), [])
check('中午静默', at(16, 12, 0), [])
check('30 分钟档', at(16, 15, 30), ['pre:2026-11-16:n'])
check('30 分钟档窗口内', at(16, 15, 31), ['pre:2026-11-16:n'])
check('30 分钟档已关', at(16, 15, 32), [])
check('20 分钟静默', at(16, 15, 40), [])
check('10 分钟档', at(16, 15, 50), ['pre10:2026-11-16:n'])
check('开工瞬间静默', at(16, 16, 0), [])
check('班中静默', at(16, 20, 0), [])
# 跨午夜收工：11-16 夜班的收工发生在 11-17 00:00
check('跨午夜收工', at(17, 0, 0, 30), ['done:2026-11-16:n'])
check('跨午夜收工尾', at(17, 0, 1, 0), [])
# 11-17 白班（08:00-18:00）
check('白班 30 分钟档', at(17, 7, 30), ['pre:2026-11-17:d'])
check('白班 10 分钟档', at(17, 7, 50), ['pre10:2026-11-17:d'])
check('白班收工', at(17, 18, 0, 30), ['done:2026-11-17:d'])
check('白班收工尾', at(17, 18, 1, 0), [])
# 前夜预告：11-15 21:00 预告 11-16 夜班
check('前夜预告', at(15, 21, 0), ['eve:2026-11-16'])
# 未排班的日子：什么都不发
check('未排班静默', at(20, 15, 30), [])
check('未排班收工', at(20, 18, 0, 30), [])
# 休息日：全天静默（11-18 没排班，eve 预告也不该有——因为 11-19 也没排）
check('休息日 eve 静默', at(18, 21, 0), [])

# 收工金额
msgs = server.due_messages(SUB, at(17, 18, 0, 30))
pay = [m for m in msgs if m[0].startswith('done:')]
if pay:
    body = pay[0][2]
    if '203.85' not in body:
        fails.append('收工金额错误：%s' % body)
    else:
        print('PASS 收工金额 203.85 ✓')

if fails:
    print()
    for f in fails:
        print('FAIL', f)
    sys.exit(1)
print()
print('OK 推送时段矩阵全部通过')
