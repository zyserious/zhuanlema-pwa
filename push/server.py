#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""今天赚了吗 · 班次提醒推送服务
- 保存 PWA 的 Web Push 订阅与排班表
- 定时（每 20 秒）检查是否该提醒：上班前 N 分钟 / 前一天晚上预告
- 通过 pywebpush 推给 Apple / FCM
"""
import base64
import hashlib
import json
import os
import secrets
import threading
import time
import traceback
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pywebpush import WebPushException, webpush

TZ = timezone(timedelta(hours=8))          # 北京时间
DATA_FILE = os.environ.get('DATA_FILE', '/data/subs.json')
ICS_DIR = os.environ.get('ICS_DIR', '/data/ics')
ACCOUNTS_FILE = os.environ.get('ACCOUNTS_FILE', '/data/accounts.json')
ACCOUNT_USER = os.environ.get('ACCOUNT_USER', 'demo').strip()
ACCOUNT_PASS = os.environ.get('ACCOUNT_PASS', 'demo').strip()
TOKEN_TTL_DAYS = 180
VAPID_PUBLIC = os.environ.get('VAPID_PUBLIC', '').strip()
VAPID_PRIVATE_B64 = os.environ.get('VAPID_PRIVATE_B64', '').strip()
VAPID_PRIVATE_RAW = os.environ.get('VAPID_PRIVATE_RAW', '').strip()
VAPID_SUBJECT = os.environ.get('VAPID_SUBJECT', 'mailto:you@example.com')
PORT = int(os.environ.get('PORT', '8000'))

_lock = threading.Lock()
SHIFT_NAME = {'d': '☀️ 白班', 'n': '🌙 夜班', 'x': '😴 休息'}


def log(*a):
    print('[push]', *a, flush=True)


# ---------------- 存储 ----------------
def load_db():
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_db(db):
    tmp = DATA_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


def sub_key(sub):
    return sub.get('endpoint') or (sub.get('subscription') or {}).get('endpoint', '')


# ---------------- 账号 ----------------
def load_accounts():
    try:
        with open(ACCOUNTS_FILE, 'r', encoding='utf-8') as f:
            d = json.load(f)
    except Exception:
        d = {}
    d.setdefault('users', {})
    d.setdefault('tokens', {})
    return d


def save_accounts(db):
    tmp = ACCOUNTS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False)
    os.replace(tmp, ACCOUNTS_FILE)


SNAP_DIR = os.environ.get('SNAP_DIR', '/data/snapshots')
_last_snap = [0.0]


def snapshot_accounts(force=False):
    """写用户数据前留一份快照：万一被误覆盖，还能从 /data/snapshots 捞回来。
    最多保留最近 30 份；60 秒内最多拍一次，避免频繁写盘。"""
    try:
        now = time.time()
        if not force and now - _last_snap[0] < 60:
            return
        _last_snap[0] = now
        if not os.path.exists(ACCOUNTS_FILE):
            return
        os.makedirs(SNAP_DIR, exist_ok=True)
        dst = os.path.join(SNAP_DIR, 'accounts-%s.json' % datetime.now(TZ).strftime('%Y%m%d-%H%M%S'))
        with open(ACCOUNTS_FILE, 'rb') as src, open(dst, 'wb') as out:
            out.write(src.read())
        olds = sorted(f for f in os.listdir(SNAP_DIR) if f.startswith('accounts-') and f.endswith('.json'))
        for f in olds[:-30]:
            try:
                os.remove(os.path.join(SNAP_DIR, f))
            except Exception:
                pass
    except Exception as e:
        log('snapshot failed:', e)


def _score(payload):
    """用户数据丰富度，只用于日志排查（排班/加班/摸鱼/愿望/存钱/首富）"""
    try:
        d = (payload or {}).get('data') or {}
        k = lambda o: len(o or {})
        return (k(d.get('shifts')) * 3 + k((d.get('ot') or {}).get('log')) * 2 +
                len(d.get('fish') or []) * 2 + len(d.get('wishes') or []) * 3 +
                len(d.get('deposits') or []) * 2 + len(d.get('wall') or []) + k(d.get('rich')) * 2)
    except Exception:
        return -1


DIAG = []


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), bytes.fromhex(salt), 120000).hex()
    return salt, h


def seed_account():
    """首次启动时建好唯一的账号（默认 demo / demo，务必改强密码）"""
    db = load_accounts()
    if ACCOUNT_USER not in db['users']:
        salt, h = hash_pw(ACCOUNT_PASS)
        db['users'][ACCOUNT_USER] = {
            'salt': salt, 'hash': h, 'data': {},
            'created': datetime.now(TZ).strftime('%Y-%m-%d %H:%M'),
        }
        save_accounts(db)
        log('account seeded:', ACCOUNT_USER)
    return db


def check_token(db, token):
    rec = db['tokens'].get(token or '')
    if not rec:
        return None
    if rec.get('exp', 0) < time.time():
        db['tokens'].pop(token, None)
        save_accounts(db)
        return None
    return rec.get('user')


def bearer(handler):
    auth = handler.headers.get('Authorization') or ''
    return auth[7:].strip() if auth.lower().startswith('bearer ') else ''


# ---------------- 推送 ----------------
def vapid_private_pem():
    return base64.b64decode(VAPID_PRIVATE_B64).decode('utf-8')


_pem_cache = {'v': None}


def vapid_key():
    """把 32 字节私钥标量重建成合法 PEM，交给 pywebpush 使用"""
    if _pem_cache['v']:
        return _pem_cache['v']
    if VAPID_PRIVATE_RAW:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        raw = VAPID_PRIVATE_RAW
        raw += '=' * (-len(raw) % 4)
        d = base64.urlsafe_b64decode(raw)
        key = ec.derive_private_key(int.from_bytes(d, 'big'), ec.SECP256R1())
        pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()).decode('utf-8')
    else:
        pem = vapid_private_pem()
    _pem_cache['v'] = pem
    return pem


def push_one(sub, title, body, tag, url='./'):
    payload = json.dumps({'title': title, 'body': body, 'tag': tag, 'url': url}, ensure_ascii=False)
    last = 'no key'
    for name, key in _key_candidates():
        try:
            webpush(
                subscription_info=sub['subscription'],
                data=payload,
                vapid_private_key=key,
                vapid_claims={'sub': VAPID_SUBJECT},
                ttl=1800,
            )
            log('push ok via', name)
            return True, None
        except WebPushException as e:
            code = getattr(getattr(e, 'response', None), 'status_code', None)
            last = 'http %s: %s' % (code, str(e)[:150])
            log('push fail', name, last)
            return False, last
        except Exception as e:  # noqa: BLE001
            last = '%s: %s' % (name, str(e)[:130])
            log('push key error', last)
            if 'deserialize' in str(e).lower() or 'incorrect format' in str(e).lower():
                continue
            return False, last
    return False, last


def _key_candidates():
    """不同版本的 pywebpush 接受不同形态的 VAPID 私钥，依次尝试"""
    out = []
    raw = VAPID_PRIVATE_RAW
    if raw:
        out.append(('raw-b64url', raw))
    try:
        out.append(('pem', vapid_key()))
    except Exception:
        pass
    return out


# ---------------- 时间计算 ----------------
def hm_to_sec(s, default):
    try:
        h, m = [int(x) for x in str(s or default).split(':')[:2]]
        return h * 3600 + m * 60
    except Exception:
        h, m = [int(x) for x in default.split(':')]
        return h * 3600 + m * 60


def window_text(sh, st):
    if sh == 'd':
        return '%s – %s' % (st.get('start', '08:00'), st.get('end', '16:00'))
    if sh == 'n':
        end = st.get('nightEnd', '00:00')
        return '%s – %s' % (st.get('nightStart', '16:00'), '24:00' if end in ('00:00', '24:00') else end)
    return ''


def due_messages(sub, now):
    """返回 [(dedupe_key, title, body, tag)]"""
    st = sub.get('settings') or {}
    shifts = sub.get('shifts') or {}
    today_k = now.strftime('%Y-%m-%d')
    tmr_k = (now + timedelta(days=1)).strftime('%Y-%m-%d')
    out = []

    # 1) 前一天晚上 21:00 预告
    eve = st.get('eveHour', 21)
    if st.get('evePreview', True) and now.hour == eve and now.minute < 1:
        sh = shifts.get(tmr_k)
        if sh:
            key = 'eve:' + tmr_k
            if sh == 'x':
                out.append((key, '明天休息 😴', '不用上班，睡到自然醒～', 'eve-' + tmr_k))
            else:
                out.append((key, '明天%s' % SHIFT_NAME[sh],
                            '上班时间 %s，记得定好闹钟。' % window_text(sh, st),
                            'eve-' + tmr_k))

    # 2) 上班前 N 分钟
    pre = int(st.get('remindMin', 30) or 30)
    sh = shifts.get(today_k)
    if sh and sh != 'x':
        start = hm_to_sec(st.get('nightStart') if sh == 'n' else st.get('start'), '08:00')
        sec_now = now.hour * 3600 + now.minute * 60 + now.second
        delta_min = (start - sec_now) / 60.0
        if 0 <= delta_min <= pre and delta_min > pre - 1.2:
            key = 'pre:' + today_k + ':' + sh
            out.append((key, '%s %d 分钟后上班' % (SHIFT_NAME[sh], max(1, int(round(delta_min)))),
                        '上班时间 %s，该出门啦 🚀' % window_text(sh, st),
                        'pre-' + today_k))
    return out


def scheduler():
    log('scheduler started')
    while True:
        try:
            now = datetime.now(TZ)
            db = load_db()
            changed = False
            for key, sub in list(db.items()):
                sent = sub.setdefault('sent', {})
                for dk, title, body, tag in due_messages(sub, now):
                    if dk in sent:
                        continue
                    ok, err = push_one(sub, title, body, tag)
                    if ok:
                        sent[dk] = now.strftime('%Y-%m-%d %H:%M')
                        changed = True
                        log('sent', tag, '->', key[:36])
                    else:
                        log('send fail', tag, err)
                # 清理 30 天前的去重记录
                cutoff = (now - timedelta(days=30)).strftime('%Y-%m-%d')
                for dk in [k for k, v in sent.items() if str(v)[:10] < cutoff]:
                    sent.pop(dk, None)
                    changed = True
            if changed:
                with _lock:
                    save_db(db)
        except Exception:
            traceback.print_exc()
        time.sleep(20)


# ---------------- HTTP ----------------
class Handler(BaseHTTPRequestHandler):
    server_version = 'zhuanlema-push/1.0'

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Cache-Control', 'no-store')

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ('/api/vapid', '/vapid'):
            return self._json({'key': VAPID_PUBLIC})
        if path in ('/api/health', '/health'):
            db = load_db()
            return self._json({'ok': True, 'subs': len(db), 'time': datetime.now(TZ).isoformat()})
        if path in ('/api/diag', '/diag'):
            return self._json({'ok': True, 'items': DIAG[-10:]})
        if path in ('/api/data', '/data'):
            acc = load_accounts()
            user = check_token(acc, bearer(self))
            if not user:
                return self._json({'ok': False, 'error': 'unauthorized'}, 401)
            rec = acc['users'].get(user, {})
            return self._json({'ok': True, 'user': user, 'data': rec.get('data') or {},
                               'saved': rec.get('saved', '')})
        if path.startswith('/api/cal/') and path.endswith('.ics'):
            token = path[len('/api/cal/'):].replace('.ics', '')
            fp = os.path.join(ICS_DIR, token + '.ics')
            if not os.path.isfile(fp):
                return self._json({'ok': False, 'error': 'gone'}, 404)
            with open(fp, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/calendar; charset=utf-8')
            self.send_header('Content-Disposition', 'inline; filename="paiban.ics"')
            self.send_header('Content-Length', str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return
        return self._json({'ok': False, 'error': 'not found'}, 404)

    def do_POST(self):
        path = self.path.split('?')[0]
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            return self._json({'ok': False, 'error': 'bad json'}, 400)

        if path in ('/api/diag', '/diag'):
            info = dict(body)
            info['ip'] = self.client_address[0] if self.client_address else ''
            info['at'] = datetime.now(TZ).strftime('%H:%M:%S')
            log('DIAG', json.dumps(info, ensure_ascii=False)[:1200])
            DIAG.append(info)
            del DIAG[:-20]
            return self._json({'ok': True})

        if path in ('/api/login', '/login'):
            acc = load_accounts()
            name = (body.get('username') or '').strip()
            pw = body.get('password') or ''
            rec = acc['users'].get(name)
            if not rec:
                return self._json({'ok': False, 'error': '账号或密码不对'}, 401)
            _, h = hash_pw(pw, rec['salt'])
            if not secrets.compare_digest(h, rec['hash']):
                return self._json({'ok': False, 'error': '账号或密码不对'}, 401)
            token = secrets.token_urlsafe(24)
            acc['tokens'][token] = {'user': name, 'exp': time.time() + TOKEN_TTL_DAYS * 86400,
                                    'at': datetime.now(TZ).strftime('%Y-%m-%d %H:%M')}
            # 只保留最近 10 个会话
            if len(acc['tokens']) > 10:
                for k in sorted(acc['tokens'], key=lambda x: acc['tokens'][x]['exp'])[:-10]:
                    acc['tokens'].pop(k, None)
            save_accounts(acc)
            log('login ok:', name)
            return self._json({'ok': True, 'token': token, 'user': name,
                               'data': rec.get('data') or {}, 'saved': rec.get('saved', '')})

        if path in ('/api/logout', '/logout'):
            acc = load_accounts()
            tk = bearer(self)
            if tk in acc['tokens']:
                acc['tokens'].pop(tk)
                save_accounts(acc)
            return self._json({'ok': True})

        if path in ('/api/data', '/data'):
            acc = load_accounts()
            user = check_token(acc, bearer(self))
            if not user:
                return self._json({'ok': False, 'error': 'unauthorized'}, 401)
            rec = acc['users'].setdefault(user, {})
            inc = body.get('data') or {}
            cur = rec.get('data') or {}
            cur_saved = rec.get('saved') or ''

            # 行情/模拟股价这类自动保存：只合并 stock 字段，不动用户数据，也不改 saved 锚点
            if body.get('auto'):
                cur_data = cur.get('data') or {}
                inc_data = inc.get('data') or {}
                inc_stock = inc_data.get('stock') or {}
                # 只接受结构完整的价格数据，避免半截对象把云端行情冲掉
                if inc_stock and inc_stock.get('px') and inc_stock.get('hist'):
                    cur_data['stock'] = inc_stock
                cur['data'] = cur_data
                rec['data'] = cur
                rec['savedAuto'] = datetime.now(TZ).strftime('%Y-%m-%d %H:%M:%S')
                save_accounts(acc)
                return self._json({'ok': True, 'saved': cur_saved, 'auto': True})

            # 用户数据全量写入：base 必须是客户端上次看到的 saved，否则判定为冲突，
            # 让客户端先拉取最新数据 —— 旧设备/空数据就没法把云端覆盖掉了。
            base = (body.get('base') or '').strip()
            if cur and cur_saved and base != cur_saved and not body.get('force'):
                log('conflict base=%r cur=%r' % (base, cur_saved))
                return self._json({'ok': False, 'error': 'conflict',
                                   'saved': cur_saved, 'data': cur}, 409)

            snapshot_accounts()
            old_score = _score(cur)
            rec['data'] = inc
            rec['saved'] = datetime.now(TZ).strftime('%Y-%m-%d %H:%M:%S')
            log('write ok base=%r -> %r score %d -> %d ua=%r' % (
                base, rec['saved'], old_score, _score(inc),
                (self.headers.get('User-Agent') or '')[:60]))
            save_accounts(acc)
            return self._json({'ok': True, 'saved': rec['saved']})

        if path in ('/api/subscribe', '/subscribe'):
            sub = body.get('subscription') or {}
            key = sub.get('endpoint', '')
            if not key:
                return self._json({'ok': False, 'error': 'no endpoint'}, 400)
            db = load_db()
            rec = db.get(key, {})
            rec['subscription'] = sub
            rec['shifts'] = body.get('shifts') or {}
            rec['settings'] = body.get('settings') or {}
            rec['updated'] = datetime.now(TZ).strftime('%Y-%m-%d %H:%M')
            db[key] = rec
            with _lock:
                save_db(db)
            log('subscribed', key[:40], 'days:', len(rec['shifts']))
            return self._json({'ok': True, 'subs': len(db)})

        if path in ('/api/schedule', '/schedule'):
            key = (body.get('subscription') or {}).get('endpoint', '')
            db = load_db()
            if key not in db:
                return self._json({'ok': False, 'error': 'not subscribed'}, 404)
            db[key]['shifts'] = body.get('shifts') or {}
            db[key]['settings'] = body.get('settings') or {}
            with _lock:
                save_db(db)
            return self._json({'ok': True})

        if path in ('/api/unsubscribe', '/unsubscribe'):
            key = (body.get('subscription') or {}).get('endpoint', '')
            db = load_db()
            db.pop(key, None)
            with _lock:
                save_db(db)
            return self._json({'ok': True})

        if path in ('/api/test', '/test'):
            key = (body.get('subscription') or {}).get('endpoint', '')
            db = load_db()
            sub = db.get(key)
            if not sub:
                return self._json({'ok': False, 'error': 'not subscribed'}, 404)
            ok, err = push_one(sub, '提醒已开启 🔔', '以后白班/夜班前我会提前提醒你。', 'test-%d' % int(time.time()))
            return self._json({'ok': ok, 'error': err})

        if path in ('/api/ics', '/ics'):
            ics = body.get('ics') or ''
            if 'BEGIN:VCALENDAR' not in ics:
                return self._json({'ok': False, 'error': 'bad ics'}, 400)
            os.makedirs(ICS_DIR, exist_ok=True)
            # 只保留最近 20 份，避免堆积
            try:
                olds = sorted(
                    (os.path.join(ICS_DIR, f) for f in os.listdir(ICS_DIR)),
                    key=os.path.getmtime, reverse=True)
                for fp in olds[19:]:
                    os.remove(fp)
            except Exception:
                pass
            token = secrets.token_urlsafe(10).replace('-', 'a').replace('_', 'b')
            with open(os.path.join(ICS_DIR, token + '.ics'), 'w', encoding='utf-8') as f:
                f.write(ics.replace('\r\n', '\r\n'))
            return self._json({'ok': True, 'url': '/api/cal/' + token + '.ics'})

        return self._json({'ok': False, 'error': 'not found'}, 404)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    if not VAPID_PUBLIC or (not VAPID_PRIVATE_B64 and not VAPID_PRIVATE_RAW):
        raise SystemExit('missing VAPID env')
    os.makedirs(os.path.dirname(DATA_FILE) or '.', exist_ok=True)
    if not os.path.exists(DATA_FILE):
        save_db({})
    seed_account()
    try:
        k = vapid_key()
        log('vapid key ok | bytes:', len(k), '| lines:', len(k.splitlines()), '| head:', k.splitlines()[0][:28])
    except Exception as e:  # noqa: BLE001
        log('vapid key ERROR:', e)
    threading.Thread(target=scheduler, daemon=True).start()
    log('listening on', PORT)
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
