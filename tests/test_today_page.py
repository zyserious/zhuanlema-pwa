#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""today.html 四态渲染探针。

做法：生成 4 个临时变体（注入 auth + mock fetch），用无头 Chrome --dump-dom 抓渲染结果，
再用断言检查关键文案与进度环偏移。跑完删掉临时文件。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'today.html')
PORT = 18090
CHROME = None
for c in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
):
    if os.path.isfile(c):
        CHROME = c
        break

BASE = {
    'ok': True, 'status': 'working',
    'now': '2026-11-14 22:33:00', 'date': '2026-11-14', 'weekday': 6,
    'shift': 'n', 'shiftName': '夜班', 'shiftEmoji': '🌙', 'scheduled': True,
    'window': [57600, 86400], 'windowText': '16:00–24:00',
    'perSec': 0.007065, 'earned': 154.03, 'dayTotal': 203.85, 'dailyPay': 203.85,
    'salary': 5300.0, 'payDays': 26.0, 'paidSec': 23235, 'fullSec': 28800,
    'remainSec': 5360, 'remainText': '1:29', 'untilStartSec': 0, 'untilStartText': '',
    'workedText': '6:27', 'progress': 0.755,
}

CASES = {
    'working': dict(BASE),
    'before': dict(BASE, status='before', earned=0.0, paidSec=0, remainSec=0,
                   progress=0.0, untilStartSec=1800, untilStartText='30 分钟'),
    'done': dict(BASE, status='done', earned=203.85, paidSec=28800, remainSec=0,
                 progress=1.0, now='2026-11-15 00:03:00'),
    'off': dict(BASE, status='off', shift='x', shiftName='休息', shiftEmoji='😴',
                window=None, windowText='', earned=0.0, remaining=0, progress=0.0,
                remainSec=0, paidSec=0),
}

INJECT = """<script>
try{ localStorage.setItem('auth', JSON.stringify({token:'probe-token',user:'probe'})); }catch(e){}
navigator.serviceWorker.register = function(){ return Promise.reject(new Error('stub')); };
window.fetch = function(){
  return Promise.resolve({ status:200, ok:true, json:function(){ return Promise.resolve(__P__); } });
};
</script>
"""


def build_variant(name, payload):
    with open(SRC, encoding='utf-8') as f:
        html = f.read()
    inject = INJECT.replace('__P__', json.dumps(payload, ensure_ascii=False))
    out = html.replace('</head>', inject + '</head>', 1)
    path = os.path.join(ROOT, '__probe_%s.html' % name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    return path


def dump(url):
    cmd = [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
           '--hide-scrollbars', '--force-device-scale-factor=2',
           '--virtual-time-budget=2500', '--dump-dom', url]
    r = subprocess.run(cmd, capture_output=True, timeout=90)
    return r.stdout.decode('utf-8', 'replace')


def shot(url, out, dark=False):
    cmd = [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
           '--hide-scrollbars', '--force-device-scale-factor=2',
           '--window-size=390,844', '--virtual-time-budget=2500',
           '--screenshot=' + out]
    if dark:
        cmd.insert(1, '--blink-settings=preferredColorScheme=0')
    subprocess.run(cmd + [url], capture_output=True, timeout=90)


def text_of(dom):
    body = re.search(r'<body[^>]*>(.*)</body>', dom, re.S)
    s = body.group(1) if body else dom
    s = re.sub(r'<div id="gate".*?</div>\s*</body>', ' ', s, flags=re.S)
    s = re.sub(r'<script[^>]*>.*?</script>', ' ', s, flags=re.S)
    s = re.sub(r'<style[^>]*>.*?</style>', ' ', s, flags=re.S)
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def main():
    if not CHROME:
        print('SKIP 找不到 Chrome，无法跑渲染探针')
        return 0
    if not os.path.isfile(SRC):
        print('FAIL 缺 today.html')
        return 1

    made = []
    for name, payload in CASES.items():
        made.append(build_variant(name, payload))

    httpd = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)],
                             cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = True
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/' % PORT, timeout=1)
                break
            except Exception:
                time.sleep(0.15)

        results = {}
        for name in CASES:
            dom = dump('http://127.0.0.1:%d/__probe_%s.html' % (PORT, name))
            txt = text_of(dom)
            results[name] = (dom, txt)

        def check(name, cond, msg):
            nonlocal ok
            if not cond:
                ok = False
                print('FAIL [%s] %s' % (name, msg))

        d, t = results['working']
        check('working', '还剩' in t, '缺少「还剩」倒计时')
        check('working', re.search(r'154\.\d\d', t), '金额没有从 154.03 起步：%r' % t[:120])
        check('working', '夜班' in t, '缺少班次标签')
        check('working', '16:00' in t and '24:00' in t, '班次时间窗没写对')
        check('working', '今天目标 203.85' in t, '缺少今日目标')
        bar = re.search(r'id="bar"[^>]*style="([^"]*)"', d)
        check('working', bar and 'stroke-dashoffset' in bar.group(1) and '527.79' not in bar.group(1),
              '进度环没推进')
        check('working', 'hide' in (re.search(r'id="gate" class="([^"]*)"', d) or ['', ''])[1],
              '已登录却还挡着登录提示')

        d, t = results['before']
        check('before', '距开工' in t, '缺少「距开工」')
        check('before', '快上班了' in t, '30 分钟内应提示快上班')
        check('before', '203.85' in t, '未显示今日目标')

        d, t = results['done']
        check('done', '收工' in t, '缺少收工状态')
        check('done', '203.85' in t, '收工金额不对')
        check('done', '今天赚完了' in t, '缺少完成说明')

        d, t = results['off']
        check('off', '今天不用上班' in t, '休息日文案不对')
        check('off', '休息' in t, '缺少休息标记')

        if '--shot' in sys.argv:
            d = os.path.join(ROOT, '.shots')
            os.makedirs(d, exist_ok=True)
            for name in CASES:
                u = 'http://127.0.0.1:%d/__probe_%s.html' % (PORT, name)
                shot(u, os.path.join(d, name + '-light.png'), dark=False)
                shot(u, os.path.join(d, name + '-dark.png'), dark=True)
            print('截图写入', d)

        for name, (dom, txt) in results.items():
            print('--- %s ---' % name)
            print(txt[:180])
        print('')
        print('OK 四态全部通过' if ok else 'FAIL 有断言未通过')
        return 0 if ok else 1
    finally:
        httpd.terminate()
        try:
            httpd.wait(timeout=5)
        except Exception:
            httpd.kill()
        for p in made:
            try:
                os.remove(p)
            except OSError:
                pass


if __name__ == '__main__':
    sys.exit(main())
