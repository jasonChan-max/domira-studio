/* 裝修報價面板 —— 把 Domira 的報價／工期／法規接進空間設計工作室。
 *
 * 為什麼獨立成一個模組：不動他們的 app.js 既有流程，只讀 state（房間尺寸）
 * 與呼叫 /api/plan；壞了也不會拖垮 3D 編輯。
 *
 * 金額與工期一律由 Worker 的 quote/ 規則層計算，前端只負責顯示。
 */
import { API_BASE } from './api-config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const money = (v) => (v == null ? '—' : 'HK$' + Math.round(Number(v)).toLocaleString('en-US'));

/* 把 /api/plan 的結果渲染成 HTML（純函式，方便測試）。 */
export function renderQuoteResult(data) {
  const s = data?.summary || {};
  const agents = data?.agents || {};
  const budget = agents.budget?.output || {};
  const aging = agents.aging?.output || {};
  const schedule = agents.schedule?.output || {};
  const vendor = agents.vendor?.output || {};

  if (!s.total_cost_hkd && s.total_cost_hkd !== 0) {
    return '<p class="quote-error">報價服務沒有回傳金額，請確認 Worker 的 /api/plan 已部署。</p>';
  }

  const kpis = [
    ['工程總額', money(s.total_cost_hkd)],
    ['總工期', s.duration_weeks != null ? `${s.duration_weeks} 週` : '—'],
    ['材料 / 人工', `${money(s.material_total)} / ${money(s.labour_total)}`],
    ['適老化措施', `${s.aging_measures ?? 0} 項`],
  ].map(([k, v]) => `<div class="quote-kpi"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');

  const modeLabel = s.mode === 'retrofit' ? '舊屋改造（只加不改）' : '全屋裝修';
  const budgetLine = budget.total_review
    ? `<p class="quote-note">預算 ${money(budget.total_review.budget)}，`
      + `${budget.total_review.gap > 0 ? '超出 ' + money(budget.total_review.gap) : '預算內'}。</p>`
    : '';

  // orchestrator 會在 summary.scenarios 補上工期；預算 agent 的 scenarios 沒有週數，
  // 所以優先讀 summary，缺了才退回 budget。
  const scenarioRows = (s.scenarios && s.scenarios.length) ? s.scenarios : (budget.scenarios || []);
  const scenarios = scenarioRows.map((row) => `
    <tr><td>${esc(row.label)}</td><td>${money(row.total)}</td>
    <td>${row.weeks != null ? esc(row.weeks) + ' 週' : '—'}</td>
    <td>${row.saving_vs_standard > 0 ? '省 ' + money(row.saving_vs_standard) : '—'}</td></tr>`).join('');

  const warnings = (aging.restricted_warnings || []).slice(0, 4).map((w) => `
    <li><strong>${esc(w.item)}</strong>：${esc(w.risk)}</li>`).join('');

  const measures = (aging.measures || []).slice(0, 6).map((m) => `
    <li>${esc(m.measure || m.code)}${m.spec ? ' <span class="quote-dim">' + esc(m.spec) + '</span>' : ''}</li>`).join('');

  const vendors = (vendor.recommended_vendors || []).slice(0, 3).map((v) => `
    <li>${esc(v.name)}（${esc(v.score)} 分，${esc(v.covered_trades?.length || 0)} 個工種）</li>`).join('');

  const critical = (schedule.critical_path || []).slice(0, 4).map((c) => `
    <li>${esc(c.name)}（${esc(c.weeks)} 週）</li>`).join('');

  return `
    <div class="quote-kpis">${kpis}</div>
    ${budgetLine}
    <p class="quote-mode">方案：${esc(modeLabel)}${s.recommended_mode ? `　·　系統建議：${esc(s.recommended_mode === 'retrofit' ? '舊屋改造' : '全屋裝修')}` : ''}</p>
    ${scenarios ? `<h4>三套方案</h4><table class="quote-table"><thead><tr><th>方案</th><th>金額</th><th>工期</th><th>較標準省</th></tr></thead><tbody>${scenarios}</tbody></table>` : ''}
    ${warnings ? `<h4>法規紅線（不可改動）</h4><ul class="quote-list">${warnings}</ul>` : ''}
    ${measures ? `<h4>適老化措施</h4><ul class="quote-list">${measures}</ul>` : ''}
    ${critical ? `<h4>關鍵路徑</h4><ul class="quote-list">${critical}</ul>` : ''}
    ${vendors ? `<h4>建議承辦商</h4><ul class="quote-list">${vendors}</ul>` : ''}
    <p class="quote-note">金額由價目表計算、工期由關鍵路徑計算；法規數值與津貼依據來自香港官方文件知識庫。</p>`;
}

/* 掛載面板：讀目前專案的房間尺寸，讓使用者補樓齡／預算／住戶情況。 */
export function createQuotePanel({ getState, notify } = {}) {
  const root = document.querySelector('#quote-panel');
  if (!root) return null;

  root.innerHTML = `
    <style>
      .quote-section { margin: 28px 0; padding: 26px; border-radius: 22px;
        background: rgba(18,22,26,.72); border: 1px solid rgba(255,255,255,.08); }
      .quote-section h2 { margin: 4px 0 6px; font-size: 22px; }
      .quote-section .eyebrow { font-size: 11px; letter-spacing: .16em; color: #8fd6b4; }
      .quote-form { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr));
        gap: 12px; margin: 18px 0; align-items: end; }
      .quote-form label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #9aa7a0; }
      .quote-form input[type=number] { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
        color: #e9efe9; border-radius: 10px; padding: 9px 11px; font-size: 14px; }
      .quote-form .check { flex-direction: row; align-items: center; gap: 8px; }
      .quote-kpis { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 12px; margin: 18px 0; }
      .quote-kpi { padding: 14px; border-radius: 14px; background: rgba(255,255,255,.04); }
      .quote-kpi span { display: block; font-size: 11px; color: #8b988f; }
      .quote-kpi strong { font-size: 19px; }
      .quote-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0 14px; }
      .quote-table th, .quote-table td { text-align: left; padding: 7px 8px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .quote-list { margin: 6px 0 14px; padding-left: 18px; font-size: 13px; color: #c9d4cc; }
      .quote-list li { margin: 4px 0; }
      .quote-dim { color: #8b988f; font-size: 12px; }
      .quote-note { font-size: 12px; color: #8b988f; margin: 6px 0; }
      .quote-error { color: #ffb4a8; }
      .quote-section h4 { margin: 14px 0 4px; font-size: 14px; }
    </style>
    <span class="eyebrow">FROM SPACE TO BUDGET</span>
    <h2>裝修報價與工期</h2>
    <p class="quote-note">用目前房間的尺寸，算出香港裝修要多少錢、要多久、有幾條法規紅線。</p>
    <form class="quote-form" id="quote-form">
      <label>樓齡（年）<input id="q-age" type="number" min="0" max="100" value="30"></label>
      <label>預算 HK$<input id="q-budget" type="number" min="0" step="10000" value="500000"></label>
      <label>房間數<input id="q-rooms" type="number" min="1" max="6" value="2"></label>
      <label class="check"><input id="q-elderly" type="checkbox" checked> 有長者／行動不便</label>
      <label class="check"><input id="q-retrofit" type="checkbox"> 只做加裝（舊屋改造）</label>
      <button class="generate-btn" id="q-run" type="submit">產生裝修報價</button>
    </form>
    <div id="q-result"></div>`;

  const form = root.querySelector('#quote-form');
  const result = root.querySelector('#q-result');
  const button = root.querySelector('#q-run');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const state = getState?.() || {};
    const room = state.room || {};
    if (!room.width || !room.depth) {
      result.innerHTML = '<p class="quote-error">請先建立或開啟一個房間。</p>';
      return;
    }

    button.disabled = true;
    result.innerHTML = '<p class="quote-note">正在計算報價與工期…</p>';
    try {
      const payload = {
        room: { width: room.width, depth: room.depth, height: room.height || 2.7 },
        rooms: Number(root.querySelector('#q-rooms').value || 1),
        building_age: Number(root.querySelector('#q-age').value || 0),
        budget_hkd: Number(root.querySelector('#q-budget').value || 0),
        district: '香港',
        renovation_mode: root.querySelector('#q-retrofit').checked ? 'retrofit' : 'full',
        occupants: root.querySelector('#q-elderly').checked
          ? [{ age: 72, mobility: 'limited' }]
          : [{ age: 35, mobility: 'normal' }],
      };
      const response = await fetch(API_BASE + '/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '報價服務暫時無法使用');
      result.innerHTML = renderQuoteResult(data);
      notify?.('裝修報價已產生。');
    } catch (err) {
      result.innerHTML = `<p class="quote-error">${esc(err.message)}</p>`;
    } finally {
      button.disabled = false;
    }
  });

  return { renderQuoteResult };
}
