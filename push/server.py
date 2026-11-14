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
    d.setdefault('ics', {})          # 订阅日历 token → 用户名，只新增不覆盖
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


def ensure_ics_token(user):
    """给用户一个稳定的订阅 token：只新增、永远不改动已有排班和设置。
    同一个人重复调用拿到同一个 token，换手机/改工资都不用重新订阅。"""
    with _lock:
        acc = load_accounts()
        for tk, u in (acc.get('ics') or {}).items():
            if u == user:
                return tk
        snapshot_accounts()
        tk = secrets.token_urlsafe(16).replace('-', 'a').replace('_', 'b')
        acc['ics'][tk] = user
        save_accounts(acc)
        log('ics token issued for', user)
        return tk


def ics_owner(token):
    """订阅 token → 用户名。没有就是 None（老链接走静态文件兜底）。"""
    return (load_accounts().get('ics') or {}).get(token)


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


# ---------------- 今日计薪（iOS 小组件 / 锁屏用，只读） ----------------
def _end_sec(s, default):
    """结束时间：00:00 视作次日 0 点（86400），与前端 endHm 一致"""
    v = hm_to_sec(s, default)
    return 86400 if v == 0 else v


def _fmt_hms(sec):
    sec = max(0, int(sec))
    h, m = sec // 3600, sec % 3600 // 60
    return ('%d:%02d' % (h, m)) if h else ('%d' % m)


def _yuan(v):
    """金额显示：153.52 → ¥153.52，203.00 → ¥203（省一位，锁屏上寸土寸金）"""
    try:
        v = float(v or 0)
    except Exception:
        v = 0.0
    return ('¥%d' % round(v)) if abs(v - round(v)) < 0.005 else ('¥%.2f' % v)


def work_days(st):
    """设置里的「默认工作日」，JS getDay() 口径：周日=0"""
    return [int(x) for x in ((st or {}).get('days') or [1, 2, 3, 4, 5]) if isinstance(x, (int, float))]


def shift_on(st, dd, day):
    """某天的班次 d/n/x。有排班以排班为准，没排班才按默认工作日兜底。"""
    saved = ((dd or {}).get('shifts') or {}).get(day.strftime('%Y-%m-%d'))
    if saved in ('d', 'n', 'x'):
        return saved
    return 'd' if (day.isoweekday() % 7) in work_days(st) else 'x'


def shift_window(st, sh):
    """班次时间窗（当天秒数），休息或配置非法返回 None。"""
    if sh == 'x':
        return None
    st = st or {}
    if sh == 'n':
        s, e = hm_to_sec(st.get('nightStart'), '16:00'), _end_sec(st.get('nightEnd'), '00:00')
    else:
        s, e = hm_to_sec(st.get('start'), '08:00'), _end_sec(st.get('end'), '16:00')
    return (s, e) if e > s else None


def today_payload(st, dd, now=None):
    """按与前端完全一致的规则算「今天的班次 / 已赚 / 剩余 / 进度」。
    规则来源 index.html：shiftOf / windowOf / paidIntervalsFor / perSecond。
    纯计算，不写任何数据。"""
    st = st or {}
    dd = dd or {}
    now = now or datetime.now(TZ)

    js_dow = now.isoweekday() % 7                       # JS getDay(): 周日=0
    key = now.strftime('%Y-%m-%d')
    saved = (dd.get('shifts') or {}).get(key)
    shift = shift_on(st, dd, now)

    start, end = hm_to_sec(st.get('start'), '08:00'), _end_sec(st.get('end'), '16:00')
    no_lunch = bool(st.get('noLunch', True))
    lunch_paid = bool(st.get('lunchPaid', False))
    lunch = (hm_to_sec(st.get('lunchStart'), '12:00'), hm_to_sec(st.get('lunchEnd'), '13:00'))

    def window(sh):
        return shift_window(st, sh)

    def intervals(sh):
        w = window(sh)
        if not w:
            return []
        s, e = w
        ls, le = lunch
        if no_lunch:
            return [(s, e)]
        if not lunch_paid and ls >= s and le <= e and le > ls:
            return [(s, ls), (le, e)]
        return [(s, e)]

    w = window(shift)
    ref = w or (start, end)                             # 休息日按白班长度算每秒单价
    ref_sec = ref[1] - ref[0]
    if not no_lunch and not lunch_paid and lunch[0] >= ref[0] and lunch[1] <= ref[1] and lunch[1] > lunch[0]:
        ref_sec -= lunch[1] - lunch[0]
    if ref_sec <= 0:
        ref_sec = 28800

    try:
        salary = float(st.get('salary') or 0) or 10000.0
    except Exception:
        salary = 10000.0
    try:
        pay_days = float(st.get('payDays') or 0) or 21.75
    except Exception:
        pay_days = 21.75
    daily = salary / pay_days
    per_sec = daily / ref_sec

    sec_now = now.hour * 3600 + now.minute * 60 + now.second + now.microsecond / 1e6
    paid = 0.0
    for a, b in intervals(shift):
        paid += max(0.0, min(sec_now, b) - a)
    full = float(sum(b - a for a, b in intervals(shift)))

    if shift == 'x':
        status = 'off'
    elif w and sec_now < w[0]:
        status = 'before'
    elif w and sec_now < w[1]:
        status = 'working'
    else:
        status = 'done'

    remain = int(max(0, w[1] - sec_now)) if w and status == 'working' else 0
    until = int(max(0, w[0] - sec_now)) if w and status == 'before' else 0
    done_sec = int(min(sec_now, w[1]) - w[0]) if w and status in ('working', 'done') else 0

    return {
        'ok': True,
        'now': now.strftime('%Y-%m-%d %H:%M:%S'),
        'date': key,
        'weekday': js_dow,
        'shift': shift,
        'shiftName': {'d': '白班', 'n': '夜班', 'x': '休息'}[shift],
        'shiftEmoji': {'d': '☀️', 'n': '🌙', 'x': '😴'}[shift],
        'scheduled': saved in ('d', 'n', 'x'),
        'status': status,
        'window': [w[0], w[1]] if w else None,
        'windowText': window_text(shift, st) if w else '',
        'perSec': round(per_sec, 6),
        'earned': round(paid * per_sec, 2),
        'dayTotal': round(full * per_sec, 2),
        'dailyPay': round(daily, 2),
        'salary': round(salary, 2),
        'payDays': pay_days,
        'paidSec': int(paid),
        'fullSec': int(full),
        'remainSec': remain,
        'remainText': _fmt_hms(remain),
        'untilStartSec': until,
        'untilStartText': _fmt_hms(until),
        'workedText': _fmt_hms(done_sec),
        'progress': round(min(1.0, max(0.0, paid / full)), 4) if full else 0,
    }


# ---------------- 订阅日历：锁屏上的那行字 ----------------
# 思路：不用「导出 .ics」，改成「订阅一个 URL」。iOS 每隔一段时间来拉一次，
# 每次都在服务端现算，所以「今天」那条的标题永远是此刻的金额 —— 日历被当成一块只读显示屏。
ICS_DAYS = int(os.environ.get('ICS_DAYS', '62'))
ICS_APP_URL = os.environ.get('ICS_APP_URL', 'https://xyt.zyserious.xyz/')
PRE_WINDOW = 30 * 60          # 「快上班了」的窗口：30 分钟


def _ics_esc(s):
    return (str(s).replace('\\', '\\\\').replace(';', '\\;')
            .replace(',', '\\,').replace('\r', '').replace('\n', '\\n'))


def _ics_dt(dt):
    return dt.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def _hm(sec):
    sec = int(sec) % 86400
    return '%02d:%02d' % (sec // 3600, sec % 3600 // 60)


def _round5(sec):
    """倒计时取整到 5 分钟。日历最快 15 分钟才刷一次，写太精确反而显得假。"""
    m = int(max(0, sec) // 60)
    return max(5, min(30, ((m + 4) // 5) * 5))


def shift_label(st, sh):
    """纯排班标题：🌙 夜班 16:00–24:00"""
    w = shift_window(st, sh)
    if not w:
        return ''
    s, e = w
    return '%s %s–%s' % (SHIFT_NAME.get(sh, ''), _hm(s), '24:00' if e >= 86400 else _hm(e))


def daily_pay(st):
    """日薪。和 today_payload 同口径。"""
    try:
        salary = float((st or {}).get('salary') or 0) or 10000.0
    except Exception:
        salary = 10000.0
    try:
        pay_days = float((st or {}).get('payDays') or 0) or 21.75
    except Exception:
        pay_days = 21.75
    return salary / pay_days


def _left_text(sec):
    """剩余时间。不足 1 小时写成「15 分钟」，比「0:15」好懂。"""
    sec = max(0, int(sec))
    if sec >= 3600:
        return '%d:%02d' % (sec // 3600, sec % 3600 // 60)
    return '%d 分钟' % max(1, (sec + 59) // 60)


def live_summary(p):
    """只在「上班中」和「快上班」两个窗口给数字；休息日返回 None，锁屏保持干净。"""
    if p.get('shift') == 'x':
        return None
    if p.get('status') == 'working':
        if float(p.get('earned') or 0) < 1:
            return '开工啦 · 剩 %s' % _left_text(p['remainSec'])
        return '已赚 %s · 剩 %s' % (_yuan(p['earned']), _left_text(p['remainSec']))
    return None


def _vevent(uid, start, end, summary, desc, alarm_min=None, stamp=None):
    lines = ['BEGIN:VEVENT', 'UID:%s@zhuanlema' % uid,
             'DTSTAMP:' + _ics_dt(stamp or start),
             'DTSTART:' + _ics_dt(start), 'DTEND:' + _ics_dt(end),
             'SUMMARY:' + _ics_esc(summary), 'DESCRIPTION:' + _ics_esc(desc),
             'URL:' + ICS_APP_URL, 'TRANSP:OPAQUE']
    if alarm_min:
        lines += ['BEGIN:VALARM', 'ACTION:DISPLAY',
                  'DESCRIPTION:' + _ics_esc('该准备上班啦'),
                  'TRIGGER:-PT%dM' % int(alarm_min), 'END:VALARM']
    lines.append('END:VEVENT')
    return lines


def build_ics(st, dd, now=None, days=None):
    """订阅日历全文。今天用实时状态，未来只写明确排过班的日期（未排班不臆造）。"""
    st = st or {}
    dd = dd or {}
    now = now or datetime.now(TZ)
    days = ICS_DAYS if days is None else days
    pre = int(st.get('remindMin') or 30)
    pre_w = min(PRE_WINDOW, max(5, pre) * 60)       # 倒计时窗口最多半小时，不跟着 remindMin 无限放大
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    goal = _yuan(daily_pay(st))

    out = ['BEGIN:VCALENDAR', 'VERSION:2.0',
           'PRODID:-//zhuanlema//live-shift//CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
           'X-WR-CALNAME:今天赚了吗', 'X-WR-TIMEZONE:Asia/Shanghai',
           'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M']

    for i in range(days):
        d = today + timedelta(days=i)
        k = d.strftime('%Y-%m-%d')
        kk = k.replace('-', '')
        start_of = lambda sec: d + timedelta(seconds=sec)

        if i == 0:
            p = today_payload(st, dd, now)
            w = p.get('window')
            if not w:
                continue                                # 休息 / 未排班：锁屏什么都不留
            head = live_summary(p) or shift_label(st, p['shift'])
            if not head:
                continue
            if p['status'] == 'working':
                desc = '还剩 %s · 进度 %d%% · 今天目标 %s' % (
                    _left_text(p['remainSec']), int(round(p['progress'] * 100)), goal)
            elif p['status'] == 'done':
                desc = '今天赚了 %s · %s–%s' % (_yuan(p['dayTotal']), _hm(w[0]),
                                               '24:00' if w[1] >= 86400 else _hm(w[1]))
            else:
                desc = '%s 开工 · 今天目标 %s' % (_hm(w[0]), goal)
            out += _vevent('shift-' + kk, start_of(w[0]),
                           start_of(w[1]), head, desc,
                           alarm_min=pre if p.get('scheduled') else None, stamp=now)
            left = p.get('untilStartSec') or 0
            if p['status'] == 'before' and 0 < left <= pre_w:
                out += _vevent('pre-' + kk, start_of(max(0, w[0] - pre_w)),
                               start_of(w[0]), '⏰ 还有 %d 分钟开工' % _round5(left),
                               '%s 开工 · 今天目标 %s' % (_hm(w[0]), goal), stamp=now)
            continue

        saved = (dd.get('shifts') or {}).get(k)
        if saved not in ('d', 'n'):
            continue                                    # 未排班 / 休息：不导出、不上锁屏
        w = shift_window(st, saved)
        if not w:
            continue
        head = shift_label(st, saved)
        if not head:
            continue
        out += _vevent('shift-' + kk, start_of(w[0]), start_of(w[1]),
                       head, '今天目标 %s' % goal, alarm_min=pre, stamp=now)

    out.append('END:VCALENDAR')
    return '\r\n'.join(out) + '\r\n'


def _daily_pay(st):
    try:
        return (float(st.get('salary') or 0) or 10000.0) / (float(st.get('payDays') or 0) or 21.75)
    except Exception:
        return 10000.0 / 21.75


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

    # 2) 上班前 N 分钟（用户设的 remindMin，默认 30）
    pre = int(st.get('remindMin', 30) or 30)
    sh = shifts.get(today_k)
    if sh and sh != 'x':
        start = hm_to_sec(st.get('nightStart') if sh == 'n' else st.get('start'), '08:00')
        end = _end_sec(st.get('nightEnd') if sh == 'n' else st.get('end'), '16:00')
        sec_now = now.hour * 3600 + now.minute * 60 + now.second
        delta_min = (start - sec_now) / 60.0

        if 0 <= delta_min <= pre and delta_min > pre - 1.2:
            out.append(('pre:' + today_k + ':' + sh,
                        '%s %d 分钟后上班' % (SHIFT_NAME[sh], max(1, int(round(delta_min)))),
                        '上班时间 %s，该出门啦 🚀' % window_text(sh, st),
                        'pre-' + today_k))

        # 3) 开工前 10 分钟固定再催一次
        if 0 <= delta_min <= 10 and delta_min > 8.8:
            out.append(('pre10:' + today_k + ':' + sh,
                        '还有 10 分钟上班',
                        '上班时间 %s，收拾一下准备开工 🔔' % window_text(sh, st),
                        'pre10-' + today_k))

        # 4) 收工：下班那一刻推当日总结（不跨午夜的班次当天检测）
        if end < 86400:
            over_min = (sec_now - end) / 60.0
            if 0 <= over_min <= 0.7:
                out.append(('done:' + today_k + ':' + sh, '收工 🎉',
                            '今天赚了 %s，辛苦啦，回见' % _yuan(_daily_pay(st)),
                            'done-' + today_k))

    # 5) 跨午夜夜班（如 16:00-00:00）的收工发生在次日凌晨：不管今天排没排班，都查昨天
    yk = (now - timedelta(days=1)).strftime('%Y-%m-%d')
    yend = _end_sec(st.get('nightEnd'), '00:00')
    if shifts.get(yk) == 'n' and yend >= 86400:
        over_min = (now.hour * 3600 + now.minute * 60 + now.second - (yend - 86400)) / 60.0
        if 0 <= over_min <= 0.7:
            out.append(('done:' + yk + ':n', '收工 🎉',
                        '今天赚了 %s，辛苦啦，回见' % _yuan(_daily_pay(st)),
                        'done-' + yk))
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
        if path in ('/api/today', '/today'):
            acc = load_accounts()
            user = check_token(acc, bearer(self))
            if not user:
                return self._json({'ok': False, 'error': 'unauthorized'}, 401)
            blob = (acc['users'].get(user, {}) or {}).get('data') or {}
            p = today_payload(blob.get('settings') or {}, blob.get('data') or {})
            p['user'] = user
            return self._json(p)
        if path in ('/api/cal-link', '/cal-link'):
            acc = load_accounts()
            user = check_token(acc, bearer(self))
            if not user:
                return self._json({'ok': False, 'error': 'unauthorized'}, 401)
            tok = ensure_ics_token(user)
            host = (self.headers.get('Host') or 'xyt.zyserious.xyz').strip()
            return self._json({'ok': True, 'token': tok,
                               'path': '/api/cal/%s.ics' % tok,
                               'url': 'https://%s/api/cal/%s.ics' % (host, tok),
                               'webcal': 'webcal://%s/api/cal/%s.ics' % (host, tok),
                               'days': ICS_DAYS, 'ttl': 900})
        if path.startswith('/api/cal/') and path.endswith('.ics'):
            token = path[len('/api/cal/'):].replace('.ics', '')
            data = None
            owner = ics_owner(token)
            if owner:
                try:
                    rec = (load_accounts()['users'].get(owner) or {})
                    blob = rec.get('data') or {}
                    data = build_ics(blob.get('settings') or {}, blob.get('data') or {})
                except Exception as e:
                    log('build_ics failed:', e)
                    data = None
            if data is None:                          # 老链接：回落到预先导出的静态文件
                fp = os.path.join(ICS_DIR, token + '.ics')
                if not os.path.isfile(fp):
                    return self._json({'ok': False, 'error': 'gone'}, 404)
                with open(fp, 'rb') as f:
                    data = f.read()
            elif isinstance(data, str):
                data = data.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/calendar; charset=utf-8')
            self.send_header('Content-Disposition', 'inline; filename="paiban.ics"')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-cache, max-age=0')
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
                log('conflict xyt base=%r cur=%r' % (base, cur_saved))
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
