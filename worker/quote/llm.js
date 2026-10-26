/* LLM 調用層 —— Python core/llm.py 的 JS 版（Cloudflare Worker 用 fetch）。
 *
 * 保留同樣的四類現實處理：
 * 1. 偶發失敗（429／5xx）— 指數退避重試
 * 2. 能力差異 — 供應商不支援 response_format 就自動去掉重試
 * 3. 錯誤難懂 — 翻成「金鑰無效／餘額不足／模型不存在」並附解法
 * 4. 回覆截斷 — 先修 JSON，再加大 max_tokens 重試
 *
 * 與 Python 版的差異：沒有 urllib，改用 fetch；沒有 time.sleep，用 setTimeout。
 */

export const DEFAULT_KINDS = {
  config: ['設定不完整', '設定 LLM_API_KEY 環境變數'],
  auth: ['金鑰無效或已失效', '到供應商後台重新複製金鑰，確認沒有多餘空格或換行'],
  quota: ['帳戶餘額不足或無此模型權限', '到供應商後台充值，或改用其他模型名稱'],
  rate_limit: ['請求太頻繁，被限流', '稍等再試；或把重試次數調大'],
  timeout: ['請求逾時', '網路較慢時把 LLM_TIMEOUT_MS 調大（例如 90000）'],
  network: ['連不上 API 端點', '檢查網路與 base_url；公司／校園網可能擋住某些域名'],
  endpoint: ['端點路徑不存在', '確認 base_url 是否包含正確的 /v1 或供應商前綴'],
  model: ['模型名稱不存在', '確認 LLM_MODEL 拼寫，或換成該供應商支援的模型'],
  server: ['供應商伺服器錯誤', '非你的問題，稍後重試即可'],
  format: ['模型回覆不是合法 JSON', '已自動修復或改用離線示例；多半是輸出被截斷'],
  truncated: ['回覆被輸出上限截斷', '已自動加大 max_tokens 重試；仍失敗請調高 LLM_MAX_TOKENS'],
  media: ['圖片被 API 拒絕', 'API 只接受有效的 JPEG/PNG/GIF/WebP；請確認檔案未損壞'],
  unknown: ['未預期的錯誤', '查看下方原始訊息'],
};

const RETRYABLE = new Set(['rate_limit', 'timeout', 'network', 'server']);

export class LLMError extends Error {
  constructor(message, { kind = 'unknown', status = null, retryable = null } = {}) {
    const [label, hint] = DEFAULT_KINDS[kind] || DEFAULT_KINDS.unknown;
    super(`${label}：${message}`);
    this.name = 'LLMError';
    this.kind = kind;
    this.status = status;
    this.rawMessage = message;
    this.label = label;
    this.hint = hint;
    this.retryable = retryable === null ? RETRYABLE.has(kind) : retryable;
  }

  asDict() {
    return {
      kind: this.kind,
      status: this.status,
      label: this.label,
      message: this.rawMessage,
      hint: this.hint,
      retryable: this.retryable,
    };
  }
}

/* 替未閉合的字串與括號補上結尾，讓殘缺 JSON 有機會被解析。 */
function closeJson(prefix) {
  const stack = [];
  let inString = false;
  let escape = false;

  for (const ch of prefix) {
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') { if (stack.length) stack.pop(); }
  }

  let suffix = stack.reverse().join('');
  if (inString) suffix = '"' + suffix;
  return prefix + suffix;
}

/* 修復被 max_tokens 截斷的 JSON：找「值剛好結束」的切點，截到那裡再補結尾。 */
export function repairTruncatedJson(text) {
  const safe = [];
  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length) stack.pop();
      safe.push(i + 1);
    } else if (ch === ',' && stack.length) {
      safe.push(i);
    }
  }

  for (const position of safe.slice(-8).reverse()) {
    try {
      const data = JSON.parse(closeJson(text.slice(0, position)));
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch (e) { /* 這個切點不行，換前一個 */ }
  }
  return null;
}

/* 從模型回覆抽出 JSON：圍欄 → 整段 → 首尾大括號 → 修復截斷。 */
export function extractJson(text) {
  if (!text || !String(text).trim()) throw new LLMError('模型回覆為空', { kind: 'format' });

  const candidates = [];
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1]);
  candidates.push(text);

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch (e) { /* 下一個 */ }
  }
  for (const candidate of candidates) {
    const repaired = repairTruncatedJson(candidate);
    if (repaired) return repaired;
  }
  throw new LLMError(`模型回覆不是合法 JSON：${String(text).slice(0, 200)}`, { kind: 'format' });
}

export function classifyHttp(status, body) {
  const lowered = String(body).toLowerCase();
  const mk = (kind) => new LLMError(String(body).slice(0, 300), { kind, status });

  if (status === 401) return mk('auth');
  if (status === 402 || status === 403) return mk('quota');
  if (status === 429) return mk('rate_limit');
  if (status === 404) return mk('endpoint');
  if (status === 400) {
    if (lowered.includes('response_format')) return mk('format');
    if (lowered.includes('uploaded an unsupported image') || lowered.includes('image is valid')) return mk('media');
    if (lowered.includes('model') && (lowered.includes('not exist') || lowered.includes('invalid'))) return mk('model');
    return mk('unknown');
  }
  if (status >= 500) return mk('server');
  return mk('unknown');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function redactKey(key) {
  if (!key) return '';
  const s = String(key);
  return s.length <= 8 ? '***' : `${s.slice(0, 4)}***${s.slice(-4)}`;
}

export class LLMClient {
  constructor({
    apiKey = '',
    baseUrl = 'https://api.deepseek.com/v1',
    model = 'deepseek-chat',
    provider = 'deepseek',
    temperature = 0.3,
    maxTokens = 4000,
    retryAttempts = 3,
    retryBase = 0.8,
    timeoutMs = 60000,
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.model = model;
    this.provider = provider;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.retryAttempts = retryAttempts;
    this.retryBase = retryBase;
    this.timeoutMs = timeoutMs;
    this.calls = 0;
    this.retries = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.lastError = null;
  }

  get live() {
    return !!this.apiKey;
  }

  stats() {
    return {
      calls: this.calls,
      retries: this.retries,
      prompt_tokens: this.promptTokens,
      completion_tokens: this.completionTokens,
      total_tokens: this.promptTokens + this.completionTokens,
    };
  }

  async chat(messages, { temperature = null, jsonMode = false, maxTokens = null, attempts = null } = {}) {
    if (!this.live) throw new LLMError('未設定 API key，目前為 mock 模式', { kind: 'config' });

    const url = `${this.baseUrl}/chat/completions`;
    const basePayload = {
      model: this.model,
      messages,
      temperature: temperature === null ? this.temperature : temperature,
      stream: false,
    };

    let wantsJson = jsonMode && ['deepseek', 'openai', 'moonshot'].includes(this.provider);
    const totalAttempts = attempts || Math.max(1, this.retryAttempts);
    let currentMax = maxTokens || this.maxTokens;
    let last = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const payload = { ...basePayload, max_tokens: currentMax };
      if (wantsJson) payload.response_format = { type: 'json_object' };

      let content;
      let finishReason;
      try {
        [content, finishReason] = await this.post(url, payload);
      } catch (exc) {
        last = exc;
        this.lastError = exc.asDict();

        // 不支援 json 模式 → 關掉再試，不算失敗
        if (exc.kind === 'format' && wantsJson && exc.status === 400) {
          wantsJson = false;
          this.retries += 1;
          continue;
        }
        if (exc.retryable && attempt < totalAttempts) {
          this.retries += 1;
          await sleep(this.retryBase * Math.pow(2, attempt - 1) * 1000);
          continue;
        }
        throw exc;
      }

      // 被輸出上限截斷 → 加倍額度重試
      if (finishReason === 'length' && currentMax < 16000 && attempt < totalAttempts) {
        currentMax = Math.min(currentMax * 2, 16000);
        this.retries += 1;
        last = new LLMError(`回覆達到 max_tokens，已提高到 ${currentMax} 重試`, { kind: 'truncated' });
        this.lastError = last.asDict();
        continue;
      }
      return content;
    }
    throw last || new LLMError('未知錯誤', { kind: 'unknown' });
  }

  async post(url, payload) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    this.calls += 1;

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (exc) {
      const name = exc && exc.name;
      if (name === 'AbortError' || name === 'TimeoutError') {
        throw new LLMError(`請求逾時（>${this.timeoutMs}ms）`, { kind: 'timeout' });
      }
      throw new LLMError(`連線失敗（${redactKey(url)}）：${exc && exc.message}`, { kind: 'network' });
    }

    const raw = await resp.text();
    if (!resp.ok) throw classifyHttp(resp.status, raw);

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new LLMError(`回應不是 JSON：${raw.slice(0, 200)}`, { kind: 'server' });
    }

    const usage = data.usage || {};
    this.promptTokens += Number(usage.prompt_tokens || 0);
    this.completionTokens += Number(usage.completion_tokens || 0);

    const choice = data?.choices?.[0];
    if (!choice || !choice.message) {
      throw new LLMError(`回應結構異常：${raw.slice(0, 300)}`, { kind: 'server' });
    }
    return [choice.message.content || '', String(choice.finish_reason || '')];
  }
}

export function clientFromEnv(env = {}) {
  return new LLMClient({
    apiKey: env.LLM_API_KEY || '',
    baseUrl: env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    model: env.LLM_MODEL || 'deepseek-chat',
    provider: env.LLM_PROVIDER || 'deepseek',
    temperature: Number(env.LLM_TEMPERATURE || 0.3),
    maxTokens: Number(env.LLM_MAX_TOKENS || 4000),
    retryAttempts: Number(env.LLM_RETRY_ATTEMPTS || 3),
    retryBase: Number(env.LLM_RETRY_BASE || 0.8),
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 60000),
  });
}
