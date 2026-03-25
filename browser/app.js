import init, { parse_compact, tokenize_compact, check_compact } from '../wasm-compiler/pkg/compact_wasm_compiler.js';

// --- State ---
let wasmReady = false;
let checkTimer = null;
const API_URL = window.COMPACT_PLAYGROUND_API_URL || 'https://compact-playground.onrender.com';

// --- Examples ---
const EXAMPLES = {
  counter: `pragma language_version >= 0.21;

import CompactStandardLibrary;

export ledger counter: Counter;

export circuit increment(): [] {
  counter.increment(1);
}

export circuit decrement(): [] {
  counter.decrement(1);
}

export circuit getCount(): Uint<64> {
  return counter.read();
}`,
  token: `pragma language_version >= 0.21;

import CompactStandardLibrary;

export ledger totalSupply: Uint<64>;
export ledger balances: Map<Bytes<32>, Uint<64>>;

export circuit mint(to: Bytes<32>, amount: Uint<64>): [] {
  const current = balances.lookup(to) as Uint<64>;
  balances.insert(to, (current + amount) as Uint<64>);
  totalSupply = (totalSupply + amount) as Uint<64>;
}

export circuit transfer(from: Bytes<32>, to: Bytes<32>, amount: Uint<64>): [] {
  const fromBalance = balances.lookup(from) as Uint<64>;
  assert(fromBalance >= amount, "Insufficient balance");
  balances.insert(from, (fromBalance - amount) as Uint<64>);
  const toBalance = balances.lookup(to) as Uint<64>;
  balances.insert(to, (toBalance + amount) as Uint<64>);
}

export circuit getBalance(account: Bytes<32>): Uint<64> {
  return balances.lookup(account) as Uint<64>;
}`,
  'math-module': `module MathLib {
  pragma language_version >= 0.21;

  import CompactStandardLibrary;

  export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
    return (a + b) as Uint<64>;
  }

  export circuit subtract(a: Uint<64>, b: Uint<64>): Uint<64> {
    assert(a >= b, "Underflow");
    return (a - b) as Uint<64>;
  }
}`,
  minimal: `export circuit add(a: Uint<64>, b: Uint<64>): Uint<64> {
  return (a + b) as Uint<64>;
}`
};

// --- DOM Elements ---
const editor = document.getElementById('editor');
const lineNumbers = document.getElementById('line-numbers');
const cursorPos = document.getElementById('cursor-pos');
const wasmStatus = document.getElementById('wasm-status');
const btnCheck = document.getElementById('btn-check');
const btnCompile = document.getElementById('btn-compile');
const btnParse = document.getElementById('btn-parse');
const autoCheck = document.getElementById('auto-check');
const exampleSelect = document.getElementById('example-select');

const tabDiagnostics = document.getElementById('tab-diagnostics');
const tabAst = document.getElementById('tab-ast');
const tabTokens = document.getElementById('tab-tokens');
const tabCompile = document.getElementById('tab-compile');

// --- Initialize WASM ---
async function initWasm() {
  try {
    await init();
    wasmReady = true;
    wasmStatus.textContent = 'WASM Ready';
    wasmStatus.className = 'status ready';
    btnCheck.disabled = false;
    btnParse.disabled = false;
    btnCompile.disabled = false;

    // Run initial check
    runCheck();
  } catch (err) {
    wasmStatus.textContent = `WASM Error: ${err.message}`;
    wasmStatus.className = 'status error';
    console.error('Failed to init WASM:', err);
    // Still enable compile button (API-based)
    btnCompile.disabled = false;
  }
}

// --- Line numbers ---
function updateLineNumbers() {
  const lines = editor.value.split('\n').length;
  lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}

// --- Cursor position ---
function updateCursorPos() {
  const pos = editor.selectionStart;
  const text = editor.value.substring(0, pos);
  const line = text.split('\n').length;
  const col = pos - text.lastIndexOf('\n');
  cursorPos.textContent = `Ln ${line}, Col ${col}`;
}

// --- Tab switching ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// --- WASM Check ---
function runCheck() {
  if (!wasmReady) return;

  const source = editor.value;
  const start = performance.now();

  try {
    const resultJson = check_compact(source);
    const elapsed = (performance.now() - start).toFixed(1);
    const diagnostics = JSON.parse(resultJson);

    renderDiagnostics(diagnostics, elapsed);
  } catch (err) {
    tabDiagnostics.innerHTML = `<div class="diagnostic error"><div class="diagnostic-body"><span class="diagnostic-message">WASM error: ${escapeHtml(err.message)}</span></div></div>`;
  }
}

function renderDiagnostics(diagnostics, elapsed) {
  if (diagnostics.length === 0) {
    tabDiagnostics.innerHTML = `
      <div class="diagnostic info">
        <div class="diagnostic-body">
          <span class="diagnostic-message">No issues found</span>
        </div>
      </div>
      <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--overlay);">
        Checked in ${elapsed}ms (WASM)
      </div>
    `;
    updateDiagnosticsTab(0, 0);
    return;
  }

  const errors = diagnostics.filter(d => d.severity === 'Error');
  const warnings = diagnostics.filter(d => d.severity === 'Warning');
  const infos = diagnostics.filter(d => d.severity === 'Info');

  let html = '';
  for (const d of diagnostics) {
    const sev = (d.severity || 'error').toLowerCase();
    html += `
      <div class="diagnostic ${sev}">
        <div class="diagnostic-body">
          <span class="diagnostic-location">Ln ${d.line}:${d.column}</span>
          <span class="diagnostic-message">${escapeHtml(d.message)}</span>
        </div>
      </div>
    `;
  }

  html += `<div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--overlay);">
    ${diagnostics.length} diagnostic(s) in ${elapsed}ms (WASM)
  </div>`;

  tabDiagnostics.innerHTML = html;
  updateDiagnosticsTab(errors.length, warnings.length);
}

function updateDiagnosticsTab(errors, warnings) {
  const tab = document.querySelector('[data-tab="diagnostics"]');
  let badge = '';
  if (errors > 0) {
    badge = `<span class="count-badge errors">${errors}</span>`;
  } else if (warnings > 0) {
    badge = `<span class="count-badge warnings">${warnings}</span>`;
  } else {
    badge = `<span class="count-badge ok">OK</span>`;
  }
  tab.innerHTML = `Diagnostics${badge}`;
}

// --- Parse AST ---
function runParse() {
  if (!wasmReady) return;

  const source = editor.value;
  const start = performance.now();

  try {
    const resultJson = parse_compact(source);
    const elapsed = (performance.now() - start).toFixed(1);
    const result = JSON.parse(resultJson);

    // Render AST
    if (result.ast) {
      tabAst.innerHTML = `<div class="ast-tree">${syntaxHighlightJson(JSON.stringify(result.ast, null, 2))}</div>
        <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--overlay);">Parsed in ${elapsed}ms (WASM)</div>`;
    } else {
      tabAst.innerHTML = `<div class="diagnostic error"><div class="diagnostic-body"><span class="diagnostic-message">Parse failed - see diagnostics</span></div></div>`;
    }

    // Render tokens
    if (result.tokens) {
      renderTokens(result.tokens);
    }

    // Render analysis summary
    if (result.analysis) {
      renderAnalysisSummary(result.analysis);
    }

    // Switch to AST tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="ast"]').classList.add('active');
    tabAst.classList.add('active');
  } catch (err) {
    tabAst.innerHTML = `<div class="diagnostic error"><div class="diagnostic-body"><span class="diagnostic-message">Parse error: ${escapeHtml(err.message)}</span></div></div>`;
  }
}

function renderTokens(tokens) {
  let html = `<table class="token-table">
    <thead><tr><th>Kind</th><th>Text</th><th>Location</th></tr></thead>
    <tbody>`;

  for (const t of tokens) {
    html += `<tr>
      <td class="token-kind">${escapeHtml(t.kind)}</td>
      <td class="token-text">${escapeHtml(t.text)}</td>
      <td class="token-loc">${t.line}:${t.column}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  tabTokens.innerHTML = html;
}

function renderAnalysisSummary(analysis) {
  const s = analysis.summary;
  if (!s) return;

  // Append summary to diagnostics
  let summaryHtml = '<div class="summary"><h3>Program Summary</h3><div class="summary-grid">';

  summaryHtml += `<div class="summary-item"><div class="summary-label">Pragma</div><div class="summary-value">${s.has_pragma ? `v${s.pragma_version || '?'}` : 'Missing'}</div></div>`;
  summaryHtml += `<div class="summary-item"><div class="summary-label">Imports</div><div class="summary-value">${s.imports.length > 0 ? s.imports.join(', ') : 'None'}</div></div>`;
  summaryHtml += `<div class="summary-item"><div class="summary-label">Ledger Fields</div><div class="summary-value">${s.ledger_fields.length}</div></div>`;
  summaryHtml += `<div class="summary-item"><div class="summary-label">Circuits</div><div class="summary-value">${s.circuits.length}</div></div>`;

  if (s.circuits.length > 0) {
    for (const c of s.circuits) {
      let flags = [];
      if (c.exported) flags.push('exported');
      if (c.has_assertions) flags.push('asserts');
      if (c.uses_disclose) flags.push('disclose');
      summaryHtml += `<div class="summary-item"><div class="summary-label">${escapeHtml(c.name)}()</div><div class="summary-value">${c.param_count} params → ${escapeHtml(c.return_type)} ${flags.length > 0 ? `[${flags.join(', ')}]` : ''}</div></div>`;
    }
  }

  summaryHtml += '</div></div>';

  // Append to current diagnostics content
  tabDiagnostics.innerHTML += summaryHtml;
}

// --- Compile via API ---
async function runCompile() {
  const source = editor.value;

  // Switch to compile tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="compile"]').classList.add('active');
  tabCompile.classList.add('active');

  tabCompile.innerHTML = '<div class="compile-loading"><div class="spinner"></div>Compiling via API...</div>';
  btnCompile.disabled = true;

  try {
    const response = await fetch(`${API_URL}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: source,
        options: { wrapWithDefaults: true, skipZk: true }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server error ${response.status}: ${text}`);
    }

    const body = await response.json();
    const result = body.results?.[0] || body;

    if (result.success) {
      let html = '<div class="compile-success">';
      html += '<strong>Compilation Successful</strong>';
      if (result.executionTime) {
        html += `<div style="margin-top: 0.5rem; font-size: 0.78rem;">Compiled in ${result.executionTime}ms (server)</div>`;
      }
      if (result.warnings?.length > 0) {
        html += '<div style="margin-top: 0.5rem;">';
        for (const w of result.warnings) {
          html += `<div class="diagnostic warning"><div class="diagnostic-body"><span class="diagnostic-message">${escapeHtml(w.message || JSON.stringify(w))}</span></div></div>`;
        }
        html += '</div>';
      }
      html += '</div>';
      tabCompile.innerHTML = html;
    } else {
      let html = '<div class="compile-error">';
      html += '<strong>Compilation Failed</strong>';
      if (result.errors?.length > 0) {
        html += '<div style="margin-top: 0.5rem;">';
        for (const e of result.errors) {
          html += `<div class="diagnostic error"><div class="diagnostic-body">`;
          if (e.line) html += `<span class="diagnostic-location">Ln ${e.line}${e.column ? ':' + e.column : ''}</span>`;
          html += `<span class="diagnostic-message">${escapeHtml(e.message || JSON.stringify(e))}</span></div></div>`;
        }
        html += '</div>';
      } else if (result.message) {
        html += `<div style="margin-top: 0.5rem;">${escapeHtml(result.message)}</div>`;
      }
      html += '</div>';
      tabCompile.innerHTML = html;
    }
  } catch (err) {
    tabCompile.innerHTML = `<div class="compile-error"><strong>Connection Error</strong><div style="margin-top: 0.5rem;">${escapeHtml(err.message)}</div><div style="margin-top: 0.5rem; font-size: 0.78rem; color: var(--subtext);">The full Compact compiler runs server-side. Ensure the API is available at: ${escapeHtml(API_URL)}</div></div>`;
  } finally {
    btnCompile.disabled = false;
  }
}

// --- Helpers ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function syntaxHighlightJson(json) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'ast-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'ast-key' : 'ast-string';
        } else if (/true|false/.test(match)) {
          cls = 'ast-bool';
        } else if (/null/.test(match)) {
          cls = 'ast-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

// --- Event listeners ---
editor.addEventListener('input', () => {
  updateLineNumbers();
  if (autoCheck.checked && wasmReady) {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(runCheck, 200);
  }
});

editor.addEventListener('click', updateCursorPos);
editor.addEventListener('keyup', updateCursorPos);

editor.addEventListener('keydown', (e) => {
  // Tab key for indentation
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
    updateLineNumbers();
  }
  // Ctrl+Enter to compile
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runCompile();
  }
  // Ctrl+Shift+Enter to check
  if (e.key === 'Enter' && e.shiftKey && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runCheck();
  }
});

btnCheck.addEventListener('click', runCheck);
btnCompile.addEventListener('click', runCompile);
btnParse.addEventListener('click', runParse);

exampleSelect.addEventListener('change', () => {
  const key = exampleSelect.value;
  if (key && EXAMPLES[key]) {
    editor.value = EXAMPLES[key];
    updateLineNumbers();
    if (autoCheck.checked && wasmReady) {
      runCheck();
    }
  }
  exampleSelect.value = '';
});

// Sync scroll between editor and line numbers
editor.addEventListener('scroll', () => {
  lineNumbers.scrollTop = editor.scrollTop;
});

// --- Initialize ---
updateLineNumbers();
initWasm();
