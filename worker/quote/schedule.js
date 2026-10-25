/* 工期排程與關鍵路徑（CPM）—— Python core/schedule.py 的 JS 版。
 *
 * 為什麼要真的算，而不是讓模型寫個「大約 8 週」：
 * Domira 的賣點是「快」，而「快」必須能被拆解 —— 要知道哪幾道工序在決定
 * 總工期（關鍵路徑），才知道壓縮哪裡才有用。壓縮非關鍵路徑，一天都省不下來。
 *
 * 香港舊樓改造的兩個關鍵洞察已編進模型：
 * 1. 津貼視察是硬約束：未經市建局視察開工，該項目不獲津貼。
 * 2. 訂造傢俬可在離場時同步製作：這是把 8 週壓到 6 週的主要來源。
 */
import { pyRound } from './pricing.js';

function roundTo(x, digits) {
  const k = Math.pow(10, digits);
  return pyRound(x * k) / k;
}

export function buildTasks({
  hasElderly = false,
  urgencyHigh = false,
  needsSubsidy = true,
  excludeTrades = new Set(),
} = {}) {
  let tasks = [
    {
      id: 'subsidy',
      name: '提交津貼申請並安排市建局視察施工前狀況',
      weeks: 1.0, deps: [], trade: '業主',
      note: '硬約束：未經視察開工，該項目不獲津貼',
    },
    {
      id: 'demolition',
      name: '清拆舊裝修及泥頭清運',
      weeks: 1.0, deps: ['subsidy'], trade: '清拆',
      note: '舊樓須注意結構牆與甲類裝置不可動',
    },
    {
      id: 'order_joinery',
      name: '訂造傢俬與到頂櫃下單（廠內製作）',
      weeks: 5.0, deps: ['subsidy'], trade: '木工',
      note: '離場製作，與泥水並行 —— 壓縮工期的關鍵',
    },
    {
      id: 'order_fixtures',
      name: '廚廁設備與潔具下單',
      weeks: 2.0, deps: ['subsidy'], trade: '廚廁',
      note: '選現貨可縮短至 1 週',
    },
    {
      id: 'electrical',
      name: '全屋電線重造（註冊電工）',
      weeks: 2.0, deps: ['demolition'], trade: '水電',
      note: '完工須出 WR1 證明',
    },
    {
      id: 'plumbing',
      name: '來水及去水重造（持牌水喉匠）',
      weeks: 2.0, deps: ['demolition'], trade: '水電',
      note: '完工須出 WWO46 及小型工程表格',
    },
    {
      id: 'windows',
      name: '鋁窗更換及窗邊防水',
      weeks: 1.0, deps: ['demolition'], trade: '門窗',
      note: '與水電同期進行，避免二次搭棚',
    },
    {
      id: 'masonry',
      name: '泥水、防水、防滑地磚',
      weeks: 2.0, deps: ['electrical', 'plumbing'], trade: '泥水',
      note: '浴室須做閉水測試',
    },
    {
      id: 'carpentry',
      name: '傢俬與地台安裝',
      weeks: 1.5, deps: ['masonry', 'order_joinery'], trade: '木工', note: '',
    },
    {
      id: 'fixtures',
      name: '廚櫃與潔具安裝',
      weeks: 1.5, deps: ['masonry', 'order_fixtures'], trade: '廚廁', note: '',
    },
    {
      id: 'painting',
      name: '油漆及收口',
      weeks: 1.0, deps: ['carpentry', 'fixtures'], trade: '油漆',
      note: '須待木工完成後進場',
    },
  ];

  let finalDeps;
  if (hasElderly) {
    tasks.push({
      id: 'aging',
      name: '扶手、夜燈、推桿水龍頭安裝',
      weeks: 0.5, deps: ['painting'], trade: '適老化安裝',
      note: '丙類可自行施工，毋須批准；扶手位置須按使用者身高現場定位',
    });
    finalDeps = ['aging'];
  } else {
    finalDeps = ['painting'];
  }

  tasks.push({
    id: 'handover',
    name: '清潔、驗收、合規文件遞交',
    weeks: 0.5, deps: finalDeps, trade: '業主',
    note: '須收齊 WR1 / WWO46 / 小型工程表格方可結案',
  });

  // 不符津貼資格時整條移除，並解除它對其他工序的阻塞。
  if (!needsSubsidy) {
    tasks = tasks.filter((t) => t.id !== 'subsidy');
    for (const task of tasks) {
      if (task.deps.includes('subsidy')) {
        task.deps = task.deps.filter((d) => d !== 'subsidy');
      }
    }
  }

  if (excludeTrades && excludeTrades.size) {
    tasks = dropTrades(tasks, excludeTrades);
  }
  return tasks;
}

function dropTrades(tasks, trades) {
  const removed = new Set(tasks.filter((t) => trades.has(t.trade)).map((t) => t.id));
  if (!removed.size) return tasks;

  const byId = new Map(tasks.map((t) => [t.id, t]));

  function resolve(dep, seen = new Set()) {
    if (!removed.has(dep)) return [dep];
    if (seen.has(dep)) return [];
    seen.add(dep);
    const out = [];
    for (const parent of (byId.get(dep) || {}).deps || []) {
      for (const item of resolve(parent, seen)) {
        if (!out.includes(item)) out.push(item);
      }
    }
    return out;
  }

  const kept = tasks.filter((t) => !removed.has(t.id));
  for (const task of kept) {
    const next = [];
    for (const dep of task.deps) {
      for (const item of resolve(dep)) {
        if (!next.includes(item)) next.push(item);
      }
    }
    task.deps = next;
  }
  return kept;
}

/* 舊屋改造：不清拆、不重做水電泥水，只加裝。住戶可繼續住，工期以日計。 */
export function buildRetrofitTasks() {
  return [
    {
      id: 'protect',
      name: '進場保護與家具移位（不清拆）',
      weeks: 0.5, deps: [], trade: '雜工',
      note: '保留原有裝修；地板、門框、家具都要包保護，避免加裝時刮花',
    },
    {
      id: 'install',
      name: '加裝適老化設施（扶手、夜燈、防滑、推桿水龍頭）',
      weeks: 1.0, deps: ['protect'], trade: '適老化安裝',
      note: '多屬丙類可自行施工，毋須批准；扶手位置須按使用者身高現場定位',
    },
    {
      id: 'handover',
      name: '清潔、使用教學、驗收',
      weeks: 0.5, deps: ['install'], trade: '業主',
      note: '無須遞交小型工程文件；重點是教會使用者怎麼用，而不是交鎖匙',
    },
  ];
}

/* CPM 正推與逆推，得出總工期、浮時與關鍵路徑。 */
export function compute(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const es = {};
  const ef = {};

  function forward(taskId, guard = new Set()) {
    if (taskId in ef) return ef[taskId];
    if (guard.has(taskId)) return 0.0;
    guard.add(taskId);
    const task = byId.get(taskId);
    const start = task.deps.length ? Math.max(...task.deps.map((d) => forward(d, guard))) : 0.0;
    es[taskId] = start;
    ef[taskId] = start + Number(task.weeks);
    return ef[taskId];
  }
  for (const task of tasks) forward(task.id);

  const duration = Object.keys(ef).length ? Math.max(...Object.values(ef)) : 0.0;

  const successors = {};
  for (const task of tasks) successors[task.id] = [];
  for (const task of tasks) {
    for (const dep of task.deps) {
      if (!successors[dep]) successors[dep] = [];
      successors[dep].push(task.id);
    }
  }

  const lf = {};
  const ls = {};
  function backward(taskId) {
    if (taskId in lf) return lf[taskId];
    const succs = successors[taskId] || [];
    const latestFinish = succs.length ? Math.min(...succs.map((s) => backward(s))) : duration;
    const task = byId.get(taskId);
    lf[taskId] = latestFinish;
    ls[taskId] = latestFinish - Number(task.weeks);
    return ls[taskId];
  }
  for (const task of tasks) backward(task.id);

  const rows = tasks.map((task) => {
    const tid = task.id;
    const slack = roundTo(ls[tid] - es[tid], 3);
    return {
      id: tid,
      name: task.name,
      trade: task.trade,
      weeks: task.weeks,
      start_week: roundTo(es[tid], 2),
      finish_week: roundTo(ef[tid], 2),
      slack_weeks: slack,
      critical: slack <= 0.001,
      note: task.note,
    };
  });

  rows.sort((a, b) => (a.start_week - b.start_week) || (a.finish_week - b.finish_week));
  const criticalPath = rows.filter((r) => r.critical)
    .sort((a, b) => a.start_week - b.start_week);

  return {
    duration_weeks: roundTo(duration, 2),
    tasks: rows,
    critical_path: criticalPath.map((r) => ({ name: r.name, weeks: r.weeks, trade: r.trade })),
    parallel_groups: parallelGroups(rows),
  };
}

function parallelGroups(rows) {
  const groups = [];
  for (const row of rows) {
    let placed = false;
    for (const group of groups) {
      if (Math.abs(group.start_week - row.start_week) < 0.001) {
        group.tasks.push(row.name);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ start_week: row.start_week, tasks: [row.name] });
  }
  return groups.filter((g) => g.tasks.length > 1);
}
