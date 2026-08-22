/* cost-latency-calculator: DOM layer + bootstrap.
 *
 * Loads after engine.js. On DOMContentLoaded it resolves which system to show
 * (?system= in the URL, else window.CALC_SYSTEM, else the first system), fetches
 * systems.json + prices.json (relative when served from this repo, or from the
 * jsDelivr base configured via window.CALC_BASE / CALC_REF / CALC_PRICES_REF when
 * embedded in a sibling repo), and renders the calculator into #calc-root.
 */
(function () {
  'use strict';
  var E = window.CalcEngine, REG = E.REG, nf = E.nf;
  var SYSTEMS = null, PRICES = null, SYS = null, inp = {};

  function base() { return window.CALC_BASE ? (window.CALC_BASE + '@' + (window.CALC_REF || 'v1') + '/calc/') : './'; }
  function pricesUrl() { return window.CALC_BASE ? (window.CALC_BASE + '@' + (window.CALC_PRICES_REF || 'main') + '/calc/prices.json') : './prices.json'; }
  function $(s, r) { return (r || document).querySelector(s); }
  function fmt$(x) { x = Number(x) || 0; if (x >= 1000) return '$' + Math.round(x).toLocaleString(); if (x >= 1) return '$' + x.toFixed(2); return '$' + x.toFixed(x >= 0.01 ? 3 : 5); }
  function fmtMs(ms) { ms = Number(ms) || 0; return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function lbl(k) { return REG[k].lbl.replace('{unit}', SYS.unitLabel).replace('{short}', SYS.unitShort); }

  var NOTES =
    '<details class="notes"><summary>Assumptions and method</summary><ul>' +
    '<li>Requests / month = volume per day x 30.4. Average QPS spreads the daily volume across the active window (active hours/week x 3600 / 7); peak applies the burst multiplier.</li>' +
    '<li>Latency p95 sums the critical-path stages; parallel grounding takes the slowest source. Decode rates are realistic streaming speeds (~250 tok/s Gemini 3.5 Flash, ~360 Flash-Lite, ~140 Gemini 3 Pro, ~70 Claude Opus) with TTFT 250-600 ms. First token = path before generation + model TTFT; a validator-gated multi-agent team waits for the validated draft, so first token = full.</li>' +
    '<li>GenAI cost = (tokens in x input price + tokens out and thinking x output price) x model calls per request. Agentic fan-out = agents x a damped ReAct loop (1 + (iterations-1) x 0.5).</li>' +
    '<li>Document AI uses a classify-first blend (OCR + layout/form). Agent Search bills per query. Web grounding per grounded prompt. DLP de-identifies inbound bytes. Cloud Logging assumes ~12 logged bytes per token with a 36-month WORM hold. Serving instances use Little’s law (peak QPS x p95 s, ~30 concurrent per instance, floor 2).</li>' +
    '<li>Prices come from a central <code>prices.json</code> (verified <span id="px-date"></span>), illustrative mid-2026 list prices, not a quote. Confirm against the official Google Cloud pricing pages. Inputs persist in your browser only.</li>' +
    '</ul></details>';

  function shell() {
    return '' +
      '<header>' +
        '<span class="id" id="sys-id"></span>' +
        '<div><h1 id="sys-name"></h1><p class="tag" id="sys-tag"></p></div>' +
        '<span class="sp"></span>' +
        '<label class="swwrap">system <select id="sysSel" class="sel"></select></label>' +
        '<a class="repo" id="repo-link" href="#" target="_blank" rel="noopener"></a>' +
        '<button class="btn" id="resetBtn">Reset</button>' +
        '<button class="btn" id="themeBtn">Theme</button>' +
      '</header>' +
      '<main><section id="inputs"></section><section>' +
        '<div class="panel"><h3>Capacity</h3><div id="cap"></div></div>' +
        '<div class="panel"><h3>Latency</h3><div id="lat"></div></div>' +
        '<div class="panel"><h3>Cost <span class="sub">(illustrative GCP list prices)</span></h3><div id="cost"></div></div>' +
      '</section></main>' +
      NOTES +
      '<div class="foot">Part of the open <a href="https://github.com/portable-genai/cost-latency-calculator">GenAI cost calculator</a>. Independent reference build, not affiliated with, endorsed by, or sponsored by Google LLC. Product names are trademarks of their owners, used descriptively.</div>';
  }

  function buildInputs() {
    var keys = E.inputsFor(SYS.flags), groups = {}, order = [];
    keys.forEach(function (k) { var g = REG[k].g; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(k); });
    var saved = {}; try { saved = JSON.parse(localStorage.getItem('calc:' + SYS.id) || '{}'); } catch (e) {}
    function val(k) { return (k in saved) ? saved[k] : SYS.defaults[k]; }
    var html = '';
    order.forEach(function (g) {
      html += '<fieldset><legend>' + g + '</legend>';
      groups[g].forEach(function (k) {
        var r = REG[k], v = val(k);
        html += '<div class="ctl"><label for="f-' + k + '">' + esc(lbl(k)) + '</label>';
        if (r.t === 'model') {
          html += '<select id="f-' + k + '" data-k="' + k + '">';
          Object.keys(PRICES.models).forEach(function (m) { html += '<option value="' + m + '"' + (m === v ? ' selected' : '') + '>' + esc(PRICES.models[m].label) + '</option>'; });
          html += '</select>';
        } else if (r.t === 'range') {
          html += '<div class="rng"><input id="f-' + k + '" data-k="' + k + '" type="range" min="' + r.min + '" max="' + r.max + '" step="' + r.step + '" value="' + v + '"><output id="o-' + k + '">' + v + '</output></div>';
        } else {
          html += '<input id="f-' + k + '" data-k="' + k + '" type="number" min="' + (r.min || 0) + '" step="' + (r.step || 1) + '" value="' + v + '">';
        }
        html += '</div>';
      });
      html += '</fieldset>';
    });
    $('#inputs').innerHTML = html;
  }

  function read() {
    inp = {};
    E.inputsFor(SYS.flags).forEach(function (k) {
      var el = $('#f-' + k); if (!el) return;
      inp[k] = (REG[k].t === 'model') ? el.value : Number(el.value);
      var o = $('#o-' + k); if (o) o.textContent = el.value;
    });
    try { localStorage.setItem('calc:' + SYS.id, JSON.stringify(inp)); } catch (e) {}
  }

  function kv(v, k) { return '<div class="kv"><b>' + v + '</b><span>' + k + '</span></div>'; }
  function big(v, k) { return '<div class="big"><b>' + v + '</b><span>' + k + '</span></div>'; }

  function render() {
    read();
    var R = E.computeAll(SYS, inp, PRICES), c = R.capacity, l = R.latency, co = R.cost;
    $('#cap').innerHTML = kv(nf(c.reqMonth), SYS.unitShort + 's / month') + kv(nf(c.avgQPS, 2), 'avg QPS') +
      kv(nf(c.peakQPS, 2), 'peak QPS') + kv(nf(c.calls, 2), 'model calls / req') + kv(c.instances, 'serving instances');
    var maxMs = Math.max.apply(null, l.stages.map(function (s) { return s.ms; }).concat([1]));
    var bars = l.stages.map(function (s) {
      return '<div class="bar"><span class="bl">' + esc(s.label) + '</span><span class="bt">' + fmtMs(s.ms) + '</span><i style="width:' + (100 * s.ms / maxMs).toFixed(1) + '%"></i></div>';
    }).join('');
    $('#lat').innerHTML = '<div class="big2">' + big(fmtMs(l.ttftMs), 'first token (p95)') + big(fmtMs(l.p95Ms), 'full response (p95)') + '</div><div class="bars">' + bars + '</div>';
    var total = co.monthly;
    var rows = co.lines.slice().sort(function (a, b) { return b.mo - a.mo; }).map(function (x) {
      return '<details class="cl"><summary><span>' + esc(x.name) + '</span><b>' + fmt$(x.mo) + '</b><i class="pct">' + (total > 0 ? (100 * x.mo / total).toFixed(0) : 0) + '%</i></summary><div class="calc">' + esc(x.calc) + '</div></details>';
    }).join('');
    $('#cost').innerHTML = '<div class="big2">' + big(fmt$(total), 'per month') + big(fmt$(co.per1k), 'per 1k ' + SYS.unitShort + 's') + '</div><div class="bom">' + rows + '</div>';
  }

  function mountSystem(id) {
    SYS = SYSTEMS.filter(function (s) { return s.id === id; })[0] || SYSTEMS[0];
    document.title = SYS.name + ' - cost & latency calculator';
    $('#sys-id').textContent = SYS.id;
    $('#sys-name').textContent = SYS.name;
    $('#sys-tag').textContent = SYS.tagline;
    $('#repo-link').href = 'https://github.com/portable-genai/' + SYS.repo;
    $('#repo-link').textContent = SYS.repo;
    $('#sysSel').value = SYS.id;
    buildInputs();
    render();
    try { history.replaceState(null, '', '?system=' + SYS.id); } catch (e) {}
  }

  function start() {
    var root = document.getElementById('calc-root') || document.body;
    root.innerHTML = shell();
    var pd = $('#px-date'); if (pd) pd.textContent = PRICES.verified || '';
    var sel = $('#sysSel');
    sel.innerHTML = SYSTEMS.map(function (s) { return '<option value="' + s.id + '">' + s.id + ' - ' + esc(s.name) + '</option>'; }).join('');
    sel.addEventListener('change', function () { mountSystem(sel.value); });
    $('#inputs').addEventListener('input', render);
    $('#resetBtn').addEventListener('click', function () {
      try { localStorage.removeItem('calc:' + SYS.id); } catch (e) {}
      buildInputs(); render();
    });
    $('#themeBtn').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', cur);
      try { localStorage.setItem('calc-theme', cur); } catch (e) {}
    });
    var want = (new URLSearchParams(location.search)).get('system') || window.CALC_SYSTEM || SYSTEMS[0].id;
    mountSystem(want);
  }

  function boot() {
    Promise.all([
      fetch(base() + 'systems.json').then(function (r) { return r.json(); }),
      fetch(pricesUrl()).then(function (r) { return r.json(); })
    ]).then(function (res) {
      SYSTEMS = res[0]; PRICES = res[1]; start();
    }).catch(function (err) {
      (document.getElementById('calc-root') || document.body).innerHTML =
        '<p style="padding:24px;font-family:system-ui;color:#b00">Could not load the calculator engine data: ' + esc(String(err)) + '</p>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
