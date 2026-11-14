#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回归基准：today_payload 的逐字段快照。

用途：改 server.py 的班次/计薪逻辑前先跑 --save 存一份，改完再跑一次，
输出必须逐字节一致，否则就是动了用户的数。

    python tests/test_today_golden.py --save   # 存基准
    python tests/test_today_golden.py          # 比对
"""
import gzip
import json
import os
import sys
import types
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.join(HERE, 'today_golden.json.gz')
TZ = timezone(timedelta(hours=8))

# server.py 顶部 import pywebpush，本地不一定装了，先塞个 stub
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

SETTINGS = {
    'real': {'salary': 5300, 'payDays': 26, 'start': '08:00', 'end': '18:00',
             'nightStart': '16:00', 'nightEnd': '00:00', 'noLunch': True,
             'lunchStart': '12:00', 'lunchEnd': '13:00', 'lunchPaid': False,
             'days': [1, 2, 3, 4, 5, 6, 0], 'remindMin': 30},
    'office': {'salary': 10000, 'payDays': 21.75, 'start': '09:00', 'end': '18:00',
               'nightStart': '16:00', 'nightEnd': '01:00', 'noLunch': False,
               'lunchStart': '12:00', 'lunchEnd': '13:00', 'lunchPaid': False,
               'days': [1, 2, 3, 4, 5], 'remindMin': 15},
    'lunchpaid': {'salary': 8000, 'payDays': 22, 'start': '08:30', 'end': '17:30',
                  'nightStart': '20:00', 'nightEnd': '23:30', 'noLunch': False,
                  'lunchStart': '12:00', 'lunchEnd': '13:00', 'lunchPaid': True,
                  'days': [1, 3, 5], 'remindMin': 60},
    'empty': {},
}

TIMES = []
for h in range(0, 24):
    for m in (0, 30):
        TIMES.append('%02d:%02d' % (h, m))
TIMES += ['07:29', '07:30', '07:31', '15:59', '15:30', '23:29', '23:59']

OVERRIDES = [None, 'd', 'n', 'x']


def build():
    out = []
    day0 = datetime(2026, 11, 16, tzinfo=TZ)  # 周一
    dates = [day0 + timedelta(days=i) for i in range(7)]  # 一整周，覆盖 days 过滤
    for sname, st in SETTINGS.items():
        for ov in OVERRIDES:
            for d in dates:
                for hm in TIMES:
                    h, m = [int(x) for x in hm.split(':')]
                    now = d.replace(hour=h, minute=m, second=0, microsecond=0)
                    dd = {'shifts': {d.strftime('%Y-%m-%d'): ov}} if ov else {}
                    p = server.today_payload(st, dd, now)
                    p.pop('now', None)
                    out.append({'s': sname, 'ov': ov, 'd': d.strftime('%m-%d'), 'hm': hm, 'p': p})
    return out


def main():
    data = build()
    if '--save' in sys.argv:
        with gzip.open(BASE, 'wt', encoding='utf-8', compresslevel=9) as f:
            json.dump(data, f, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        print('saved %d cases -> %s' % (len(data), BASE))
        return 0

    if not os.path.isfile(BASE):
        print('缺少基准文件，先跑 --save')
        return 2
    with gzip.open(BASE, 'rt', encoding='utf-8') as f:
        want = json.load(f)

    bad = 0
    if len(want) != len(data):
        print('用例数不一致: %d vs %d' % (len(want), len(data)))
        return 2
    for a, b in zip(want, data):
        if a != b:
            bad += 1
            if bad <= 5:
                ka = {k: a['p'].get(k) for k in a['p'] if a['p'].get(k) != b['p'].get(k)}
                kb = {k: b['p'].get(k) for k in b['p'] if a['p'].get(k) != b['p'].get(k)}
                print('差异 %s %s %s %s' % (a['s'], a['ov'], a['d'], a['hm']))
                print('  旧:', ka)
                print('  新:', kb)
    if bad:
        print('FAIL: %d/%d 个用例发生变化' % (bad, len(data)))
        return 1
    print('OK: %d 个用例逐字段一致' % len(data))
    return 0


if __name__ == '__main__':
    sys.exit(main())
