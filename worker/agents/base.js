/* 專業 agent 的基底 —— Python agents/base.py 的 JS 版。
 *
 * 設計原則：
 * - 每個 agent 只負責一件事，有自己的角色提示詞與輸出結構。
 * - 每個 agent 都必須提供 mock()，沒有 API key 時給出合理離線示例。
 * - 呼叫失敗自動降級到 mock，並在 note 說明原因 —— 觀眾看到的永遠是完整方案。
 *
 * 真實模型的三道防線：schema.normalize、postprocess、quality。
 */
import { LLMError, extractJson } from '../quote/llm.js';
import { normalize } from '../quote/schema.js';

export class BaseAgent {
  constructor(llm) {
    this.llm = llm;
    this.name = 'base';
    this.title = '基礎 Agent';
    this.icon = '🤖';
    this.systemPrompt = '';
  }

  // 子類可覆寫：決定要餵給模型多少上下文
  buildPayload(context) {
    return context;
  }

  // 子類可覆寫：把權威數值強制寫回模型輸出
  postprocess(data, context) {
    return data;
  }

  buildMessages(context) {
    return [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: JSON.stringify(this.buildPayload(context), null, 2) },
    ];
  }

  /* 執行本 agent，永遠回傳結構化結果、永不拋出例外。
   * 三段式：呼叫模型 → schema 校驗與 postprocess（絕不因這裡出錯而丟掉模型回覆）。 */
  async run(context) {
    const started = Date.now();
    let mode = 'live';
    let note = '';
    let issues = [];
    let errorKind = null;
    let errorHint = '';
    let parsed = null;

    // 第 1 段：呼叫模型
    try {
      if (!this.llm || !this.llm.live) throw new LLMError('mock', { kind: 'config' });
      const messages = this.buildMessages(context);
      const raw = await this.llm.chat(messages, { jsonMode: true });
      parsed = extractJson(raw);
    } catch (exc) {
      mode = 'mock';
      const message = exc && exc.message ? exc.message : String(exc);
      if (exc instanceof LLMError) {
        errorKind = exc.kind;
        errorHint = exc.hint;
      }
      note = message === 'mock' || /未設定 API key|mock/.test(message)
        ? '未設定 API key，使用離線示例'
        : `已降級為離線示例（${message}）`;
    }

    // 第 2 段：校驗與後處理
    let output;
    if (mode === 'live') {
      try {
        [output, issues] = normalize(this.name, parsed || {});
      } catch (exc) {
        output = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        issues = [`schema 校驗失敗（已保留原始輸出）：${exc && exc.message}`];
      }
    } else {
      output = this.mock(context);
      issues = [];
    }

    try {
      output = this.postprocess(output, context);
    } catch (exc) {
      issues = [...issues, `後處理失敗（已保留原始輸出）：${exc && exc.message}`];
    }

    const elapsed = Math.round((Date.now() - started) / 100) / 10;
    const quality = mode === 'live' && !issues.length
      ? 'ok'
      : mode === 'live' ? 'partial' : 'mock';

    return {
      agent: this.name,
      title: this.title,
      icon: this.icon,
      mode,
      note,
      quality,
      schema_issues: issues,
      error: errorKind ? { kind: errorKind, hint: errorHint } : null,
      elapsed_seconds: elapsed,
      output,
    };
  }

  mock() {
    throw new Error(`${this.constructor.name} 未提供 mock() 實作`);
  }
}

export function projectOf(context) {
  return context?.project || {};
}

export function areaOf(context) {
  const v = projectOf(context).area_sqft ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function money(value) {
  return 'HK$' + Math.round(Number(value) || 0).toLocaleString('en-US');
}

export function hasElderly(project) {
  const occupants = project?.occupants || [];
  return occupants.some((o) => o && typeof o === 'object'
    && (Number(o.age) || 0) >= 65);
}

export function mobilityLimited(project) {
  const occupants = project?.occupants || [];
  return occupants.some((o) => o && typeof o === 'object'
    && ['limited', 'wheelchair', '行動不便', '輪椅'].includes(String(o.mobility || '').toLowerCase()));
}
