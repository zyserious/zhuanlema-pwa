#!/usr/bin/env bash
# 同步逻辑回归测试
set -e
cd "$(dirname "$0")"
node extract.js
node cases.js
node gift.js

# 计薪/日历的纯函数回归（不联网、不渲染）
if command -v python >/dev/null 2>&1; then
  export PYTHONIOENCODING=utf-8
  python test_today_golden.py
  python test_ics_titles.py > /dev/null
  echo "PASS  日历状态矩阵（上班前倒计时 / 上班中金额 / 休息日静默）"
  python test_push_schedule.py > /dev/null
  echo "PASS  推送时段矩阵（30/10 分钟两档 + 跨午夜收工 + 未排班静默）"
  python test_share.py > /dev/null
  echo "PASS  只读分享链接（签发幂等 / 免登录可读 / 撤销失效 / 设置零改动）"
else
  echo "  skip python 用例（没装 python）"
fi
