// Node validation: load the shared engine + prices + systems and run every system.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'calc');
const { computeAll, inputsFor } = require(path.join(dir, 'engine.js'));
const prices = JSON.parse(fs.readFileSync(path.join(dir, 'prices.json'), 'utf8'));
const systems = JSON.parse(fs.readFileSync(path.join(dir, 'systems.json'), 'utf8'));

let bad = 0;
console.log('id   '.padEnd(5), 'req/mo'.padStart(11), 'p95'.padStart(9), 'ttft'.padStart(9), '$/mo'.padStart(11), '$/1k'.padStart(10), 'inputs');
for (const s of systems) {
  const i = Object.assign({}, s.defaults);
  const r = computeAll(s, i, prices);
  const stageSum = r.latency.stages.reduce((a, b) => a + b.ms, 0);
  const lineSum = r.cost.lines.reduce((a, b) => a + b.mo, 0);
  const ok = r.capacity.reqMonth > 0 && r.latency.p95Ms > 0 && r.latency.ttftMs > 0 &&
             r.latency.ttftMs <= r.latency.p95Ms + 0.5 && r.cost.monthly > 0 && isFinite(r.cost.per1k) &&
             Math.abs(stageSum - r.latency.p95Ms) < 1e-6 && Math.abs(lineSum - r.cost.monthly) < 1e-6 &&
             inputsFor(s.flags).every(k => k in s.defaults || k === 'model');
  if (!ok) { bad++; console.log('FAIL', s.id, JSON.stringify(r.capacity), JSON.stringify(r.latency).slice(0, 80)); }
  console.log(s.id.padEnd(5), Math.round(r.capacity.reqMonth).toLocaleString().padStart(11),
    (Math.round(r.latency.p95Ms) + 'ms').padStart(9), (Math.round(r.latency.ttftMs) + 'ms').padStart(9),
    ('$' + Math.round(r.cost.monthly).toLocaleString()).padStart(11), ('$' + r.cost.per1k.toFixed(2)).padStart(10),
    inputsFor(s.flags).length);
}
console.log(bad ? ('\n' + bad + ' FAILED') : ('\nALL ' + systems.length + ' systems OK'));
process.exit(bad ? 1 : 0);
