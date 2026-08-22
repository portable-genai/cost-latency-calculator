/* cost-latency-calculator: shared compute engine (pure, no DOM, no fetch).
 *
 * computeAll(system, inputs, prices) -> { capacity, latency, cost }
 *   system : one entry from systems.json (id, flags, defaults, unitLabel, ...)
 *   inputs : the current input values (volumePerDay, model, tokensIn, ...)
 *   prices : the parsed prices.json ({ models, services, constants })
 *
 * The math mirrors the system-design reference tool: 30.4-day months, decode-rate
 * latency + TTFT, classify-blended Document AI, per-query Agent Search, bytes/token
 * WORM logging, Little's-law serving concurrency, damped ReAct fan-out.
 *
 * Loads in a browser via <script src="engine.js"> (attaches window.CalcEngine) and
 * in node via require() (module.exports). No globals leak.
 */
(function (root) {
  'use strict';

  // input registry: key -> {group, type, min, max, step, label}. {unit}/{short}
  // are substituted from the system at render time by app.js.
  var REG = {
    volumePerDay:       { g: 'Workload', t: 'number', min: 1, step: 1,   lbl: '{unit} / day' },
    burst:              { g: 'Workload', t: 'range',  min: 1.5, max: 8, step: 0.5, lbl: 'Peak burst x' },
    activeHoursPerWeek: { g: 'Workload', t: 'range',  min: 20, max: 168, step: 2, lbl: 'Active hours / week' },
    model:              { g: 'Model', t: 'model', lbl: 'Model' },
    tokensIn:           { g: 'Model', t: 'number', min: 0, step: 100, lbl: 'Tokens in / request' },
    tokensOut:          { g: 'Model', t: 'number', min: 0, step: 50,  lbl: 'Tokens out / request' },
    thinkingTokens:     { g: 'Model', t: 'number', min: 0, step: 100, lbl: 'Thinking tokens / request' },
    docPages:           { g: 'Documents', t: 'number', min: 0, step: 1, lbl: 'Pages / {short}' },
    retrievalQueries:   { g: 'Retrieval', t: 'number', min: 0, step: 1, lbl: 'Retrieval queries / request' },
    groundingCalls:     { g: 'Retrieval', t: 'number', min: 0, step: 1, lbl: 'Web grounding calls / request' },
    agents:             { g: 'Agentic', t: 'number', min: 1, step: 1, lbl: 'Agents (fan-out)' },
    iterations:         { g: 'Agentic', t: 'number', min: 1, step: 1, lbl: 'ReAct iterations' },
    examplesPerRun:     { g: 'Eval', t: 'number', min: 1, step: 1, lbl: 'Golden examples / run' },
    metrics:            { g: 'Eval', t: 'number', min: 1, step: 1, lbl: 'Metrics / example' },
    bytesPerEvent:      { g: 'Ingest', t: 'number', min: 0, step: 100, lbl: 'Bytes / event' }
  };

  function _n(x, d) { x = Number(x); return isFinite(x) ? x : (d || 0); }
  function nf(x, dp) {
    x = Number(x) || 0; var a = Math.abs(x);
    if (a >= 1e9) return (x / 1e9).toFixed(dp || 1) + 'B';
    if (a >= 1e6) return (x / 1e6).toFixed(dp || 1) + 'M';
    if (a >= 1e3) return (x / 1e3).toFixed(dp || 1) + 'k';
    return dp ? x.toFixed(dp) : Math.round(x).toString();
  }

  function computeAll(S, i, P) {
    var f = S.flags || {};
    var MODELS = P.models, PR = P.services, K = P.constants;
    var M = MODELS[i.model] || MODELS[Object.keys(MODELS)[0]];
    var msOut = 1000 / M.dec;
    var vol = Math.max(1, _n(i.volumePerDay, 1));
    var burst = Math.max(1, _n(i.burst, 3));
    var ahw = Math.max(1, _n(i.activeHoursPerWeek, 50));
    var activeSec = ahw * 3600 / 7;
    var avgQPS = vol / activeSec, peakQPS = avgQPS * burst, reqMonth = vol * K.DAYS;
    var tIn = _n(i.tokensIn, 0), tOut = _n(i.tokensOut, 0), tTh = f.thinking ? _n(i.thinkingTokens, 0) : 0;

    var calls = 1, reactCyc = 1;
    if (f.multiStep) { reactCyc = 1 + (Math.max(1, _n(i.iterations, 1)) - 1) * 0.5; calls = Math.max(1, _n(i.agents, 1)) * reactCyc; }
    if (f.evalRun) { calls = Math.max(1, _n(i.examplesPerRun, 1)) * Math.max(1, _n(i.metrics, 1)); }

    // ---------------- latency ----------------
    var st = [], preGen = 0;
    function push(label, ms) { st.push({ label: label, ms: ms }); }
    if (f.redact) { push('PII redaction (DLP)', PR.dlpMs); preGen += PR.dlpMs; }
    if (f.guardrail) { push('Guardrail screen IN (Model Armor)', PR.armorMs); preGen += PR.armorMs; }
    if (f.docAI) { var dm = Math.max(0, _n(i.docPages, 0)) * PR.docMsPerPage; push('Document AI extract', dm); preGen += dm; }
    if (f.retrieval) { push('Governed retrieval (Agent Search)', PR.searchMs); preGen += PR.searchMs; }
    if (f.grounding) { push('Web grounding (slowest source)', PR.groundMs); preGen += PR.groundMs; }
    var dec = (tOut + tTh) * msOut;
    if (f.generate && f.multiStep) { push('Multi-agent generate + validate', M.ttft + dec * reactCyc + K.VALIDATOR_MS * reactCyc); }
    else if (f.generate && f.evalRun) { push('Eval run (judge, ' + K.EVAL_PARALLEL + '-way parallel)', (M.ttft + dec) * calls / K.EVAL_PARALLEL); }
    else if (f.generate) { push('LLM generation (TTFT + output)', M.ttft + dec); }
    if (f.complianceCheck) { push('Compliance check (C1 /ask)', PR.complianceMs); }
    if (f.guardrail) { push('Guardrail screen OUT (Model Armor)', PR.armorMs); }
    if (f.dbOnly) { push('Registry DB op', PR.dbMs); }
    if (f.ingestHeavy) { push('Async audit ack (off request path)', PR.ackMs); }
    var p95 = st.reduce(function (s, x) { return s + x.ms; }, 0);
    var ttft = (f.multiStep || f.evalRun) ? p95
             : preGen + (f.generate ? M.ttft : 0) + (f.dbOnly ? PR.dbMs : 0) + (f.ingestHeavy ? PR.ackMs : 0);

    // ---------------- cost ----------------
    var lines = [];
    function add(name, mo, calc) { if (mo > 0) lines.push({ name: name, mo: mo, calc: calc }); }
    if (f.generate) {
      var per = (tIn * M.inP + (tOut + tTh) * M.outP) / 1e6, mo = per * calls * reqMonth;
      add('GenAI tokens (' + M.label + ')', mo, nf(tIn) + ' in @ $' + M.inP + '/M + ' + nf(tOut + tTh) + ' out @ $' + M.outP + '/M x ' + nf(calls, 2) + ' call/req x ' + nf(reqMonth) + ' req/mo');
    }
    if (f.docAI) {
      var pg = Math.max(0, _n(i.docPages, 0)), bl = (1 - PR.docComplexShare) * PR.docPageOcr + PR.docComplexShare * PR.docPageLayout;
      add('Document AI', pg * bl * reqMonth, nf(pg) + ' pages x classify-blend $' + bl.toFixed(4) + '/page x ' + nf(reqMonth) + ' req/mo');
    }
    if (f.retrieval) { var q = Math.max(1, _n(i.retrievalQueries, 1)); add('Agent Search queries', q * PR.searchPerQuery * reqMonth, nf(q) + ' q x $' + PR.searchPerQuery + '/q x ' + nf(reqMonth)); }
    if (f.grounding) { var g = Math.max(1, _n(i.groundingCalls, 1)); add('Web grounding', g * PR.groundPerCall * reqMonth, nf(g) + ' x $' + PR.groundPerCall + ' x ' + nf(reqMonth)); }
    if (f.redact) { var gb = tIn * K.TOKEN_BYTES / 1e9; add('Sensitive Data Protection (DLP)', gb * PR.dlpPerGB * reqMonth, nf(tIn) + ' tok x4B = ' + gb.toFixed(6) + ' GB x $' + PR.dlpPerGB + '/GB x ' + nf(reqMonth)); }
    if (f.guardrail) { add('Model Armor (in+out screens)', PR.armorPerCall * 2 * reqMonth, '2 screens x $' + PR.armorPerCall + ' x ' + nf(reqMonth)); }
    if (f.complianceCheck) { add('C1 compliance sub-call', PR.complianceCall * reqMonth, '$' + PR.complianceCall + '/call x ' + nf(reqMonth)); }
    if (f.assetInventory) { add('Cloud Asset Inventory / SCC', PR.assetPerCall * reqMonth, '$' + PR.assetPerCall + '/call x ' + nf(reqMonth)); }
    if (f.bigQuery) { add('BigQuery (analytics)', PR.bqPerReq * reqMonth, '$' + PR.bqPerReq + '/req x ' + nf(reqMonth)); }
    var bytesReq = f.ingestHeavy ? _n(i.bytesPerEvent, 2000) : (tIn + tOut + tTh) * PR.logBytesPerTok;
    var gib = bytesReq * reqMonth / Math.pow(1024, 3);
    add('Cloud Logging (WORM audit)', gib * PR.logIngestGB + gib * PR.logRetainMo * PR.logRetainGBmo,
        nf(bytesReq) + ' B/req x ' + nf(reqMonth) + ' = ' + gib.toFixed(2) + ' GiB; ingest $' + PR.logIngestGB + '/GiB + ' + PR.logRetainMo + '-mo hold $' + PR.logRetainGBmo + '/GiB-mo');
    if (f.dbOnly) { var nodes = Math.max(1, Math.ceil(peakQPS / PR.dbQpsNode)); add('AlloyDB / Firestore nodes', nodes * PR.dbNodeMo, nodes + ' node x $' + PR.dbNodeMo + '/mo (peak ' + nf(peakQPS, 1) + ' QPS / ' + PR.dbQpsNode + ' per node)'); }
    if (f.cloudBuild) { add('Cloud Build (CI gate)', reqMonth * PR.ciMinScan * PR.ciPerMin, nf(reqMonth) + ' scans x ' + PR.ciMinScan + ' min x $' + PR.ciPerMin + '/min'); }
    var p95s = p95 / 1000, conc = peakQPS * p95s, instances = Math.max(2, Math.ceil(conc / PR.concPerInst));
    if (!f.evalRun) { add('Agent Runtime serving', instances * PR.instHr * K.HOURS, instances + ' inst x $' + PR.instHr + '/hr x ' + K.HOURS + ' hr (Little: ' + nf(peakQPS, 1) + ' QPS x ' + p95s.toFixed(1) + 's = ' + nf(conc, 1) + ' in-flight / ' + PR.concPerInst + ')'); }

    var monthly = lines.reduce(function (s, x) { return s + x.mo; }, 0);
    var per1k = reqMonth > 0 ? monthly / reqMonth * 1000 : 0;
    return {
      capacity: { reqMonth: reqMonth, avgQPS: avgQPS, peakQPS: peakQPS, calls: calls, instances: instances },
      latency: { ttftMs: ttft, p95Ms: p95, stages: st },
      cost: { monthly: monthly, per1k: per1k, lines: lines }
    };
  }

  function inputsFor(flags) {
    var L = ['volumePerDay', 'burst', 'activeHoursPerWeek'];
    if (flags.generate || flags.evalRun) L = L.concat(['model', 'tokensIn', 'tokensOut']);
    if (flags.thinking) L.push('thinkingTokens');
    if (flags.docAI) L.push('docPages');
    if (flags.retrieval) L.push('retrievalQueries');
    if (flags.grounding) L.push('groundingCalls');
    if (flags.multiStep) L = L.concat(['agents', 'iterations']);
    if (flags.evalRun) L = L.concat(['examplesPerRun', 'metrics']);
    if (flags.ingestHeavy) L.push('bytesPerEvent');
    return L;
  }

  var api = { computeAll: computeAll, REG: REG, nf: nf, inputsFor: inputsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CalcEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
