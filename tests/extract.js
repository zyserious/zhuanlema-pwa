// 从 index.html 里抽出前端脚本，供 node 沙箱加载
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if(!m) throw new Error('没找到 <script>');
fs.writeFileSync(path.join(__dirname, '.app.js'), m[1]);
console.log('extracted', m[1].length, 'bytes');
