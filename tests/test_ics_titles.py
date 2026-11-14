#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""订阅日历的「状态矩阵」探针：打印一天里每个时点，锁屏上那行字会变成什么。
不渲染、不联网，纯函数验证。  python tests/test_ics_titles.py
"""
import os
import re
import sys
import types
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TZ = timezone(timedelta(hours=8))

if 'pywebpush' not in sys.modules:
    try:
        import pywebpush  # noqa: F401
    except Exception:
        stub = types.ModuleType('pywebpush')

        class WebPushException(Exception):
            pass

        stub.WebPushException = WebPushException
        stub.webpush = lambda *a, **k: None
        sys.modules['pywebpush'] = stub

sys.path.insert(0, os.path.join(ROOT, 'push'))
import server  # noqa: E402

ST = {'salary': 5300, 'payDays': 26, 'start': '08:00', 'end': '18:00',
      'nightStart': '16:00', 'nightEnd': '00:00', 'noLunch': True,
      'lunchStart': '12:00', 'lunchEnd': '13:00', 'lunchPaid': False,
      'days': [1, 2, 3, 4, 5, 6, 0], 'remindMin': 30}


def events(ics):
    """拆出 (SUMMARY, DTSTART, DTEND)"""
    out = []
    for blk in ics.split('BEGIN:VEVENT')[1:]:
        body = blk.split('END:VEVENT')[0]

        def g(key):
            m = re.search(r'^%s(?:;[^:]*)?:(.*)$' % key, body, re.M)
            return m.group(1).strip() if m else ''

        out.append((g('SUMMARY'), g('DTSTART'), g('DTEND')))
    return out


def show(day, hm, override, label):
    h, m = [int(x) for x in hm.split(':')]
    now = day.replace(hour=h, minute=m, second=0, microsecond=0)
    dd = {'shifts': {day.strftime('%Y-%m-%d'): override}} if override else {}
    ics = server.build_ics(ST, dd, now, days=1)
    ev = events(ics)
    line = ' / '.join(e[0] for e in ev) if ev else '（锁屏无事件）'
    print('%-8s %-6s %-4s %s' % (label, hm, override or '-', line))
    return ev


def main():
    day = datetime(2026, 11, 16, tzinfo=TZ)      # 周一
    print('=== 夜班 16:00–24:00 全天 ===')
    for hm in ['08:00', '15:00', '15:29', '15:30', '15:31', '15:45',
               '16:00', '17:00', '22:09', '23:45', '23:59']:
        show(day, hm, 'n', '夜班')

    print()
    print('=== 白班 08:00–18:00 ===')
    for hm in ['07:00', '07:29', '07:30', '07:45', '08:00', '12:00', '17:59']:
        show(day, hm, 'd', '白班')

    print()
    print('=== 休息 / 未排班 ===')
    show(day, '12:00', 'x', '休息')
    show(day, '12:00', None, '未排班')

    print()
    print('=== 跨天：夜班 23:59 拉取，事件得跨到次日 0 点 ===')
    ev = show(day, '23:59', 'n', '跨天')
    if ev:
        print('         DTSTART=%s DTEND=%s' % (ev[0][1], ev[0][2]))

    print()
    print('=== 未来 7 天只导出明确排班的日期 ===')
    dd = {'shifts': {(day + timedelta(days=i)).strftime('%Y-%m-%d'): v
                     for i, v in [(0, 'd'), (1, 'n'), (3, 'x'), (5, 'n')]}}
    now = day.replace(hour=9, minute=0)
    ics = server.build_ics(ST, dd, now, days=7)
    for s, a, b in events(ics):
        print('  %s  (%s → %s)' % (s, a, b))

    assert '已赚' in show(day, '17:00', 'n', '断言')[0][0], '上班中必须显示金额'
    assert '还有' in show(day, '15:30', 'n', '断言')[-1][0], '开工前 30 分钟必须有倒计时'
    assert not show(day, '12:00', 'x', '断言'), '休息日必须完全没有事件'
    print('\nOK 全部断言通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
