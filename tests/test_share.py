#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读分享链接的端到端探针。

不联网、不碰线上数据：把 ACCOUNTS_FILE 指到临时目录，起一个真的 HTTP 服务，
用 urllib 走一遍「签发 → 只读访问 → 撤销 → 失效」，并确认用户设置一个字没变。
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import types
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = tempfile.mkdtemp(prefix='zl-share-')

os.environ['ACCOUNTS_FILE'] = os.path.join(TMP, 'accounts.json')
os.environ['DATA_FILE'] = os.path.join(TMP, 'subs.json')
os.environ['ICS_DIR'] = os.path.join(TMP, 'ics')
os.environ['SNAP_DIR'] = os.path.join(TMP, 'snaps')
os.environ['ACCOUNT_USER'] = 'xyt'
os.environ['ACCOUNT_PASS'] = 'xyt'
os.environ['VAPID_PUBLIC'] = 'x'
os.environ['PORT'] = '0'

sys.path.insert(0, os.path.join(ROOT, 'push'))
try:
    import pywebpush  # noqa: F401
except Exception:
    m = types.ModuleType('pywebpush')
    m.WebPushException = type('WebPushException', (Exception,), {})
    m.webpush = lambda *a, **k: None
    sys.modules['pywebpush'] = m

import server  # noqa: E402

SETTINGS = {
    'salary': 5000, 'payDays': 26, 'start': '08:00', 'end': '18:00',
    'nightStart': '16:00', 'nightEnd': '00:00', 'noLunch': True,
    'days': [0, 1, 2, 3, 4, 5, 6], 'remindMin': 30,
}
SHIFTS = {'2026-11-14': 'n', '2026-11-15': 'd', '2026-11-16': 'x'}

ok = [True]


def check(cond, msg):
    if not cond:
        ok[0] = False
        print('FAIL', msg)


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8') or '{}')
        except Exception:
            return e.code, {}


def post(url, body=None, headers=None):
    data = json.dumps(body or {}).encode('utf-8')
    h = {'Content-Type': 'application/json'}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, json.loads(r.read().decode('utf-8') or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8') or '{}')
        except Exception:
            return e.code, {}


def main():
    server.seed_account()
    db = server.load_accounts()
    db['users']['xyt']['data'] = {'settings': SETTINGS, 'data': {'shifts': SHIFTS}}
    db['users']['xyt']['saved'] = '2026-11-14 22:50'
    server.save_accounts(db)

    httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d' % port
    try:
        # 登录拿 Bearer
        st, r = post(base + '/api/login', {'username': 'xyt', 'password': 'xyt'})
        check(st == 200 and r.get('ok'), '登录失败: %s' % st)
        tk = r.get('token', '')
        auth = {'Authorization': 'Bearer ' + tk}

        # 1) 签发
        st, r = get(base + '/api/share-link', auth)
        check(st == 200 and r.get('ok'), '签发失败: %s %s' % (st, r))
        share = r.get('token', '')
        url = r.get('url', '')
        check(8 <= len(share) <= 24, 'token 长度异常: %r' % share)
        check(url.endswith('today.html?t=' + share), '链接不对: %r' % url)

        # 2) 幂等：再要一次还是同一串
        st, r2 = get(base + '/api/share-link', auth)
        check(r2.get('token') == share, '同一个人的 token 应该稳定')

        # 3) 只读访问：不带 Authorization 也能拿到今天的数
        st, r = get(base + '/api/today?t=' + share)
        check(st == 200 and r.get('ok'), '只读访问失败: %s %s' % (st, r))
        check(r.get('guest') is True, '响应没标记 guest')
        check(abs(float(r.get('dayTotal') or 0) - 5000 / 26) < 0.02,
              '日薪算错: %r' % r.get('dayTotal'))
        for leak in ('settings', 'data', 'shifts', 'salary', 'salt', 'hash'):
            check(leak not in r, '只读响应泄露了字段: ' + leak)

        # 4) 不带 token 仍然 401
        st, r = get(base + '/api/today')
        check(st == 401, '裸访问应该 401，实际 %s' % st)

        # 5) 假 token 404
        st, r = get(base + '/api/today?t=deadbeefdead')
        check(st == 404, '假 token 应该 404，实际 %s' % st)

        # 6) 只读 token 不能读整份数据，也不能签发别人的
        st, r = get(base + '/api/data?t=' + share)
        check(st == 401, '分享 token 不该能读 /api/data，实际 %s' % st)

        # 7) 撤销后立刻失效
        st, r = post(base + '/api/share-revoke', {}, auth)
        check(st == 200 and r.get('revoked') == 1, '撤销失败: %s %s' % (st, r))
        st, r = get(base + '/api/today?t=' + share)
        check(st == 404, '撤销后老链接应 404，实际 %s' % st)

        # 8) 撤销后重新签发，拿到新 token
        st, r = get(base + '/api/share-link', auth)
        check(r.get('ok') and r.get('token') and r.get('token') != share,
              '撤销后应换新 token')

        # 9) 用户数据一个字段都没动
        db2 = server.load_accounts()
        rec = db2['users']['xyt']
        s = (rec.get('data') or {}).get('settings') or {}
        sh = ((rec.get('data') or {}).get('data') or {}).get('shifts') or {}
        check(s.get('salary') == 5000 and s.get('payDays') == 26, '设置被改了: %r' % s)
        check(s.get('start') == '08:00' and s.get('nightStart') == '16:00', '班次时间被改了')
        check(len(sh) == 3 and sh.get('2026-11-14') == 'n', '排班被改了: %r' % sh)
        check(rec.get('saved') == '2026-11-14 22:50', 'saved 时间被改了')
        check('share' in db2, 'accounts.json 缺 share 键')
    finally:
        httpd.shutdown()

    print('OK 只读分享全部通过' if ok[0] else 'FAIL 有断言未通过')
    return 0 if ok[0] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
