// ===== Настройки =====
const TICKERS = ["GAZP", "YDEX", "MGNT", "SBER", "PLZL", "MTSS"];
const PRICE_MIN = 1;
const PRICE_MAX = 200;
const STORAGE_KEY = "cashflow_quotes_v1";             // история цен
const STORAGE_KEY_MODEL = "cashflow_quotes_model_v1"; // состояние модели
const DATA_URL = "data/quotes.json";                  // исходная история

// Параметры «более позитивного» рынка
const UP_DRIFT = 0.003;   // +0.3% базовый бычий дрейф
const LOW_BAND = 0.35;    // зона «низа» диапазона
const DRIFT_CAP = 0.012;  // макс. доп. буст от низа (~1.2%)

// Параметры локальных уровней
const LOCAL_WIN = 20;     // окно для локальных поддержек/сопротивлений (недель)

// Настройки представления (гранулярность/окно/масштаб)
const VIEW_KEY = "cashflow_view_settings_v1";
let Settings = loadViewSettings(); // { granularity:'W'|'D'|'M'|'Y', range:'3M'|'6M'|'1Y'|'ALL', yMode:'AUTO'|'GLOBAL'|'LOG' }

// ===== Дивиденды (на каждый 12-й ход) =====
const DIVIDEND_INTERVAL = 12;
const DIV_TURN_KEY = "cashflow_div_turn_v1";
const DIV_LOG_KEY  = "cashflow_div_log_v1";
function divGetTurn(){ const n = parseInt(localStorage.getItem(DIV_TURN_KEY)||"0",10); return Number.isFinite(n)?n:0; }
function divSetTurn(n){ localStorage.setItem(DIV_TURN_KEY, String(n)); }
function divLog(entry){
  let log=[]; try{ log=JSON.parse(localStorage.getItem(DIV_LOG_KEY)||"[]"); }catch{}
  log.push(entry); localStorage.setItem(DIV_LOG_KEY, JSON.stringify(log));
}
function ensureDividendModal(){
  let m = document.getElementById("dividendModal");
  if (m) return m;
  m = document.createElement("div");
  m.id = "dividendModal";
  m.style.cssText = "display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";
  m.innerHTML = `
    <div style="background:#fff;padding:20px 24px;border-radius:10px;max-width:460px;width:calc(100% - 32px);text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.2)">
      <h2 style="margin:0 0 8px">📢 Дивиденды</h2>
      <p id="dividendMessage" style="margin:0 0 16px"></p>
      <button id="dividendOkBtn" style="padding:10px 16px;background:#1f6feb;color:#fff;border:0;border-radius:8px;cursor:pointer;font-weight:700">OK</button>
    </div>`;
  document.body.appendChild(m);
  return m;
}
function showDividendModal(message) {
    const modal = document.getElementById("dividendModal");
    const messageEl = document.getElementById("dividendMessage");
    const closeBtn = document.getElementById("closeDividendModal");

    if (!modal || !messageEl) {
        console.error("Modal elements not found in DOM");
        return;
    }

    messageEl.textContent = message;
    modal.style.display = "block";

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            modal.style.display = "none";
        });
    }

    window.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.style.display = "none";
        }
    });
}


// ===== Вспомогательные =====
function clampInt(x, min, max) { return Math.max(min, Math.min(max, Math.round(x))); }
function randn() { let u=0,v=0; while(!u)u=Math.random(); while(!v)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
function sma(arr, p){ if(arr.length<p) return null; let s=0; for(let i=arr.length-p;i<arr.length;i++) s+=arr[i]; return s/p; }
function rollingMax(arr, p){ if(arr.length<p) return Math.max(...arr); let m=-Infinity; for (let i=arr.length-p;i<arr.length;i++) m=Math.max(m,arr[i]); return m; }
function rollingMin(arr, p){ if(arr.length<p) return Math.min(...arr); let m=Infinity; for (let i=arr.length-p;i<arr.length;i++) m=Math.min(m,arr[i]); return m; }
function minStepFrom(x){ return Math.max(1, Math.ceil(x*0.01)); }   // ≥1% и ≥$1
function withinPct(val, ref, pct=0.02){ return Math.abs(val-ref)/Math.max(1,ref) <= pct; }

// ===== Миграция/страховка модели =====
function ensureTickerModel(m) {
  if (!m) {
    return {
      regime: "trend",
      vol: 0.03,
      trendDir: 0,
      trendAge: 0,
      lastBreak: null,
      market: "trend",
      marketAge: 0,
      channel: { a: 0, b: 0, width: 8, age: 0, active: false },
      pattern: null
    };
  }
  if (!m.regime) m.regime = "trend";
  if (typeof m.vol !== "number") m.vol = 0.03;
  if (typeof m.trendDir !== "number") m.trendDir = 0;
  if (typeof m.trendAge !== "number") m.trendAge = 0;
  if (m.lastBreak && typeof m.lastBreak === "object" && m.lastBreak.fresh === undefined) m.lastBreak.fresh = false;

  if (m.market === undefined) m.market = "trend";
  if (m.marketAge === undefined) m.marketAge = 0;

  if (!m.channel) m.channel = { a: 0, b: 0, width: 8, age: 0, active: false };
  if (typeof m.channel.active !== "boolean") m.channel.active = false;
  if (typeof m.channel.a !== "number") m.channel.a = 0;
  if (typeof m.channel.b !== "number") m.channel.b = 0;
  if (typeof m.channel.width !== "number") m.channel.width = 8;
  if (typeof m.channel.age !== "number") m.channel.age = 0;

  if (m.pattern === undefined) m.pattern = null;
  return m;
}
function migrateModel(model) {
  if (!model) return null;
  for (const t of TICKERS) model[t] = ensureTickerModel(model[t]);
  return model;
}

// --- Маркет-режимы ---
function maybeSwitchMarket(m) {
  let p = 0.03 + Math.min(0.12, m.marketAge * 0.005);
  if (Math.random() < p) {
    const opts = ["trend","range","highvol"].filter(x => x !== m.market);
    m.market = opts[Math.floor(Math.random()*opts.length)];
    m.marketAge = 0;
    if (m.market === "trend") spawnChannel(m);
    else m.channel.active = (m.market === "range");
  } else {
    m.marketAge += 1;
  }
}

// --- Канал ---
function spawnChannel(m) {
  const slope = m.market === "trend" ? (Math.random()*0.6 - 0.3) : (Math.random()*0.1 - 0.05); // $/нед
  m.channel = { a: slope, b: 0, width: 8 + Math.random()*10, age: 0, active: true };
}
function updateChannel(m, lastPrice) {
  if (!m.channel.active) return;
  const x = m.channel.age;
  m.channel.b = lastPrice - m.channel.a * x;
  m.channel.age += 1;
  if (Math.random() < 0.1) m.channel.width = Math.max(4, Math.min(30, m.channel.width + (Math.random()*4 - 2)));
}
function enforceChannel(m, candidate) {
  if (!m.channel.active) return candidate;
  const x = m.channel.age; // после updateChannel
  const mid = m.channel.a * x + m.channel.b;
  const upper = mid + m.channel.width;
  const lower = mid - m.channel.width;

  if (candidate > upper) {
    if (Math.random() < 0.70) return clampInt(upper - 1, PRICE_MIN, PRICE_MAX);
    if (Math.random() < 0.67) return clampInt(Math.round((upper + mid)/2), PRICE_MIN, PRICE_MAX);
  } else if (candidate < lower) {
    if (Math.random() < 0.70) return clampInt(lower + 1, PRICE_MIN, PRICE_MAX);
    if (Math.random() < 0.67) return clampInt(Math.round((lower + mid)/2), PRICE_MIN, PRICE_MAX);
  }
  return candidate;
}

// --- Паттерны ---
function maybeSpawnPattern(m, series) {
  if (m.pattern) return;
  if (Math.random() >= 0.07) return; // редкий спавн

  const typePick = Math.random();
  let type;
  if (typePick < 0.30) type = "flag";
  else if (typePick < 0.60) type = "triangle";
  else if (typePick < 0.80) type = "doubleTop";
  else type = "doubleBottom";

  const last = series.at(-1);
  const dir = Math.random() < 0.55 ? 1 : -1;
  const duration = type === "flag" ? (4 + Math.floor(Math.random()*4))
                   : type === "triangle" ? (6 + Math.floor(Math.random()*6))
                   : (6 + Math.floor(Math.random()*6));
  m.pattern = {
    type, age: 0, duration, dir,
    pivot1: last,
    pivot2: last + (dir * Math.max(2, Math.round(last * 0.03)))
  };
}
function applyPatternBias(m, last, candidate) {
  const p = m.pattern;
  if (!p) return candidate;

  let biased = candidate;
  const progress = p.age / Math.max(1, p.duration);

  if (p.type === "flag") {
    const amp = Math.max(2, Math.round(last * 0.015));
    const center = (p.pivot1 + p.pivot2) / 2;
    const lo = center - amp, hi = center + amp;
    if (progress < 0.8) {
      biased = Math.max(lo, Math.min(hi, biased));
    } else {
      const step = Math.max(1, Math.round(last * 0.03));
      biased = clampInt(biased + p.dir * step, PRICE_MIN, PRICE_MAX);
    }
  } else if (p.type === "triangle") {
    const maxAmp = Math.max(3, Math.round(last * 0.05));
    const amp = Math.max(1, Math.round(maxAmp * (1 - progress)));
    const center = (p.pivot1 + p.pivot2) / 2;
    const lo = center - amp, hi = center + amp;
    biased = Math.max(lo, Math.min(hi, biased));
    if (progress > 0.95 && Math.random() < 0.5) {
      const step = Math.max(1, Math.round(last * 0.04));
      biased = clampInt(biased + (Math.random()<0.5?-1:1)*step, PRICE_MIN, PRICE_MAX);
    }
  } else if (p.type === "doubleTop") {
    const target = p.pivot1 + Math.max(2, Math.round(last*0.04));
    if (progress < 0.7) {
      biased = clampInt(Math.round((biased + target)/2), PRICE_MIN, PRICE_MAX);
    } else {
      const step = Math.max(1, Math.round(last * 0.03));
      biased = clampInt(Math.min(biased, target) - step, PRICE_MIN, PRICE_MAX);
    }
  } else if (p.type === "doubleBottom") {
    const target = p.pivot1 - Math.max(2, Math.round(last*0.04));
    if (progress < 0.7) {
      biased = clampInt(Math.round((biased + target)/2), PRICE_MIN, PRICE_MAX);
    } else {
      const step = Math.max(1, Math.round(last * 0.03));
      biased = clampInt(Math.max(biased, target) + step, PRICE_MIN, PRICE_MAX);
    }
  }

  m.pattern.age += 1;
  if (m.pattern.age >= m.pattern.duration) m.pattern = null;
  return biased;
}

// ===== Хранилище данных =====
async function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (TICKERS.every(t => Array.isArray(parsed[t]) && parsed[t].length>0)) return parsed;
    } catch {}
  }
  if (location.protocol === "http:" || location.protocol === "https:") {
    const resp = await fetch(DATA_URL, { cache: "no-store" });
    const data = await resp.json();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }
  const seedEl = document.getElementById("seed-quotes");
  if (seedEl?.textContent) {
    const data = JSON.parse(seedEl.textContent);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }
  throw new Error("Нет данных котировок (ни localStorage, ни seed, ни файл).");
}
function saveData(data){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

function loadModel(){
  const raw = localStorage.getItem(STORAGE_KEY_MODEL);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function saveModel(model){ localStorage.setItem(STORAGE_KEY_MODEL, JSON.stringify(model)); }

function loadViewSettings(){
  const raw = localStorage.getItem(VIEW_KEY);
  if (raw) { try { return JSON.parse(raw); } catch {} }
  return { granularity: "W", range: "ALL", yMode: "GLOBAL" };
}
function saveViewSettings(){ localStorage.setItem(VIEW_KEY, JSON.stringify(Settings)); }

// ===== Состояние модели =====
function initModel(state) {
  const model = {};
  for (const t of TICKERS) {
    model[t] = {
      regime: Math.random() < 0.5 ? "trend" : "revert",
      vol: 0.03,
      trendDir: 0,
      trendAge: 0,
      lastBreak: null,

      market: ["trend","range","highvol"][Math.floor(Math.random()*3)],
      marketAge: 0,
      channel: { a: 0, b: 0, width: 8, age: 0, active: false },
      pattern: null
    };
  }
  return model;
}

function updatePriceCaption(ticker, price) {
  const priceEl = document.getElementById(`${ticker}-price`);
  const captionEl = document.getElementById(`${ticker}-caption`);
  if (priceEl) priceEl.textContent = `$${price}`;
  if (captionEl) captionEl.textContent = `${ticker} — $${price}`;
}

// ===== Формирование представления (гранулярность/окно) =====
function interpolateDaily(weekly) {
  if (weekly.length === 0) return [];
  const out = [];
  for (let i=0; i<weekly.length-1; i++) {
    const a = weekly[i], b = weekly[i+1];
    for (let d=0; d<7; d++) {
      const val = a + (b-a)*(d/7);
      out.push(Math.round(val));
    }
  }
  out.push(weekly[weekly.length-1]);
  return out;
}
function aggregateClose(weekly, n) {
  if (n <= 1) return weekly.slice();
  const out = [];
  for (let i=n-1; i<weekly.length; i+=n) out.push(weekly[i]);
  if (weekly.length % n !== 0) out.push(weekly[weekly.length-1]);
  return out;
}
function applyGranularity(series, gran) {
  switch (gran) {
    case "D": return interpolateDaily(series);
    case "W": return series.slice();
    case "M": return aggregateClose(series, 4);
    case "Y": return aggregateClose(series, 52);
    default:  return series.slice();
  }
}
function sliceByRange(series, gran, range) {
  if (range === "ALL") return series.slice();
  const needWeeks = range === "3M" ? 12 : range === "6M" ? 26 : 52;
  let count;
  if (gran === "D")      count = needWeeks * 7;
  else if (gran === "W") count = needWeeks;
  else if (gran === "M") count = Math.ceil(needWeeks / 4);
  else if (gran === "Y") count = Math.max(1, Math.floor(needWeeks / 52));
  return series.slice(-count);
}
function buildLabels(n, gran) {
  const prefix = gran === "D" ? "День" : gran === "M" ? "Мес" : gran === "Y" ? "Год" : "Нед";
  return Array.from({length:n}, (_,i)=> `${prefix} ${i+1}`);
}

// ===== Движение цены (TA + дрейф + строгие S/R + кластеризация волы + каналы/паттерны) =====
function nextPriceTA(series, m, enforceJump) {
  m = ensureTickerModel(m);
  const last = series.at(-1);

  // --- Еженедельный джокер (±20%, игнорирует S/R/каналы/паттерны) ---
  if (enforceJump) {
    const delta = Math.max(1, Math.ceil(last * 0.20));
    const canUp = last + delta <= PRICE_MAX;
    const canDn = last - delta >= PRICE_MIN;
    let dir = canUp && canDn ? (Math.random()<0.5?1:-1) : (canUp?1:-1);
    let candidate = clampInt(last + dir*delta, PRICE_MIN, PRICE_MAX);
    m.trendDir = Math.sign(candidate - last);
    m.trendAge = m.trendDir ? 1 : 0;
    const ret = Math.abs((candidate - last)/last);
    m.vol = Math.max(0.01, Math.min(0.15, 0.6*m.vol + 0.4*ret));
    m.lastBreak = null;
    m.pattern = null;
    return candidate;
  }

  // --- Возможный ложный пробой (следующая неделя после пробоя) ---
  if (m.lastBreak?.fresh) {
    if (Math.random() < 0.20) {
      const step = minStepFrom(last);
      let candidate = m.lastBreak.dir === "up"
        ? clampInt(Math.min(last, m.lastBreak.level - step), PRICE_MIN, PRICE_MAX)
        : clampInt(Math.max(last, m.lastBreak.level + step), PRICE_MIN, PRICE_MAX);
      if (candidate === last) candidate = clampInt(last + (m.lastBreak.dir === "up" ? -1 : 1), PRICE_MIN, PRICE_MAX);
      m.lastBreak.fresh = false;
      m.trendDir = Math.sign(candidate - last);
      m.trendAge = m.trendDir ? 1 : 0;
      const ret = Math.abs((candidate - last)/last);
      m.vol = Math.max(0.01, Math.min(0.15, 0.6*m.vol + 0.4*ret));
      return candidate;
    }
    m.lastBreak.fresh = false;
  }

  // --- Режим рынка/канал ---
  maybeSwitchMarket(m);
  if (m.market === "trend" && !m.channel.active) spawnChannel(m);
  if (m.market !== "trend" && !m.channel.active && m.market === "range") spawnChannel(m);
  updateChannel(m, last);

  // --- База TA + дрейф ---
  if (Math.random() < 0.10) return last;

  const ma5  = sma(series, 5)  ?? last;
  const ma10 = sma(series, 10) ?? ma5;
  const bull = ma5 >= ma10;

  let bias = UP_DRIFT;
  if (m.regime === "trend") {
    const mom = Math.sign(last - ma5) + (bull ? 1 : -1);
    bias += 0.005 * mom;
  } else {
    bias += 0.006 * Math.sign(ma10 - last);
  }

  const lowThreshold = PRICE_MIN + LOW_BAND * (PRICE_MAX - PRICE_MIN);
  if (last <= lowThreshold) {
    const k = (lowThreshold - last) / (lowThreshold - PRICE_MIN);
    bias += Math.min(DRIFT_CAP, 0.012 * k);
  }

  // Кластеризация волы + highvol
  const prev = series.length >= 2 ? series.at(-2) : last;
  const prevRetAbs = Math.abs((last - prev) / prev);
  m.vol = Math.max(0.012, Math.min(0.18, 0.8*m.vol + 0.2*prevRetAbs));
  if (m.market === "highvol") m.vol = Math.min(0.22, m.vol * 1.25);

  // Сэмпл
  let ret = Math.max(-0.18, Math.min(0.18, bias + m.vol * randn()));
  let deltaAbs = Math.max(0.01, Math.abs(ret));
  let candidate = clampInt(last * (1 + Math.sign(ret) * deltaAbs), PRICE_MIN, PRICE_MAX);
  if (candidate === last) candidate = clampInt(last + (ret >= 0 ? 1 : -1), PRICE_MIN, PRICE_MAX);

  // --- Паттерны ---
  maybeSpawnPattern(m, series);
  candidate = applyPatternBias(m, last, candidate);

  // --- Канал ---
  candidate = enforceChannel(m, candidate);

  // --- Строгие S/R: 20% пробой / 80% отбой ---
  const srMax = rollingMax(series, 10);
  const srMin = rollingMin(series, 10);
  const nearRes = withinPct(last, srMax, 0.02);
  const nearSup = withinPct(last, srMin, 0.02);

  let handleRes=false, handleSup=false;
  if (nearRes && nearSup) { handleRes = (srMax-last) <= (last-srMin); handleSup = !handleRes; }
  else { handleRes = nearRes; handleSup = nearSup; }

  if (handleRes) {
    const willBreak = Math.random() < 0.20;
    const step = minStepFrom(last);
    if (willBreak) {
      if (candidate <= srMax) candidate = clampInt(Math.max(srMax + 1, last + step), PRICE_MIN, PRICE_MAX);
      m.lastBreak = { dir: "up", level: srMax, fresh: true };
    } else {
      if (candidate >= srMax) candidate = clampInt(Math.min(srMax - 1, last - step), PRICE_MIN, PRICE_MAX);
      m.lastBreak = null;
    }
  }
  if (handleSup) {
    const willBreak = Math.random() < 0.20;
    const step = minStepFrom(last);
    if (willBreak) {
      if (candidate >= srMin) candidate = clampInt(Math.min(srMin - 1, last - step), PRICE_MIN, PRICE_MAX);
      m.lastBreak = { dir: "down", level: srMin, fresh: true };
    } else {
      if (candidate <= srMin) candidate = clampInt(Math.max(srMin + 1, last + step), PRICE_MIN, PRICE_MAX);
      m.lastBreak = null;
    }
  }

  // Границы
  if (candidate === PRICE_MAX && candidate > last) candidate = PRICE_MAX - 1;
  if (candidate === PRICE_MIN && candidate < last) candidate = PRICE_MIN + 1;

  // Обновление тренда/режима TA
  const stepDir = Math.sign(candidate - last);
  if (stepDir !== 0) {
    if (stepDir === m.trendDir) m.trendAge += 1;
    else { m.trendDir = stepDir; m.trendAge = 1; }
  }
  let pSwitch = 0.08 + (m.trendAge >= 8 ? 0.15 : 0);
  if (m.regime === "trend" && bull && stepDir >= 0) pSwitch *= 0.6;
  if (Math.random() < pSwitch) { m.regime = (m.regime === "trend") ? "revert" : "trend"; m.trendAge = 0; }

  return candidate;
}

// ===== Линии поддержки/сопротивления =====
function computeLevels(series) {
  const n = series.length;
  const gSup = Math.min(...series);
  const gRes = Math.max(...series);
  const start = Math.max(0, n - LOCAL_WIN);
  const localSlice = series.slice(start);
  const lSup = Math.min(...localSlice);
  const lRes = Math.max(...localSlice);
  const line = (v)=>Array(n).fill(v);
  return {
    localSupport: line(lSup),
    localResistance: line(lRes),
    globalSupport: line(gSup),
    globalResistance: line(gRes),
  };
}

// ===== Канал: линии для текущего вида =====
function computeChannelLinesForView(n, m) {
  if (!m?.channel?.active) return null;
  const a = m.channel.a, b = m.channel.b, w = m.channel.width;
  const startX = m.channel.age - (n - 1);
  const mid = Array.from({length:n}, (_,i)=> a*(startX + i) + b);
  const up  = mid.map(v => clampInt(v + w, PRICE_MIN, PRICE_MAX));
  const dn  = mid.map(v => clampInt(v - w, PRICE_MIN, PRICE_MAX));
  return { upper: up, lower: dn };
}
function datasetChannel(lines) {
  if (!lines) return [];
  const base = { borderWidth:1, borderDash:[8,5], pointRadius:0, fill:false, order:0, borderColor:"rgba(31, 111, 235, 0.25)" };
  return [
    { label:"Channel Upper", data: lines.upper, ...base },
    { label:"Channel Lower", data: lines.lower, ...base },
  ];
}

// ===== Паттерны: визуализация =====
function datasetPattern(series, model) {
  if (!model?.pattern) return [];
  const n = series.length;
  const base = { borderWidth: 1, pointRadius: 0, fill: false, order: 0 };
  const p = model.pattern;

  if (p.type === "flag" || p.type === "triangle") {
    const center = Math.round((p.pivot1 + p.pivot2) / 2);
    const amp = Math.max(2, Math.round(series.at(-1) * 0.02));
    const lo = Array(n).fill(clampInt(center - amp, PRICE_MIN, PRICE_MAX));
    const hi = Array(n).fill(clampInt(center + amp, PRICE_MIN, PRICE_MAX));
    return [
      { label: "Pattern Low",  data: lo, borderDash: [4,4], borderColor: "rgba(155, 89, 182, 0.35)", ...base },
      { label: "Pattern High", data: hi, borderDash: [4,4], borderColor: "rgba(155, 89, 182, 0.35)", ...base },
    ];
  } else if (p.type === "doubleTop") {
    const lvl = clampInt(p.pivot1 + Math.max(2, Math.round(series.at(-1) * 0.04)), PRICE_MIN, PRICE_MAX);
    return [{ label: "Double Top", data: Array(n).fill(lvl), borderDash: [2,6], borderColor: "rgba(231, 76, 60, 0.5)", ...base }];
  } else if (p.type === "doubleBottom") {
    const lvl = clampInt(p.pivot1 - Math.max(2, Math.round(series.at(-1) * 0.04)), PRICE_MIN, PRICE_MAX);
    return [{ label: "Double Bottom", data: Array(n).fill(lvl), borderDash: [2,6], borderColor: "rgba(46, 204, 113, 0.5)", ...base }];
  }
  return [];
}

// ===== Графики =====
const charts = {}; // ticker -> Chart

function createCard(ticker) {
  const grid = document.getElementById("grid");
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-header">
      <div class="ticker">${ticker}</div>
      <div class="price" id="${ticker}-price">$—</div>
    </div>
    <div class="canvas-wrap">
      <canvas id="${ticker}-canvas"></canvas>
    </div>
    <div class="caption" id="${ticker}-caption">${ticker} — $—</div>
  `;
  grid.appendChild(card);
}

function datasetLevels(levels) {
  const common = { borderWidth:1, pointRadius:0, fill:false, order:0 };
  return [
    { label:"Local Support",     data:levels.localSupport,     borderDash:[6,4], borderColor:"rgba(231, 76, 60, 0.9)", ...common },
    { label:"Local Resistance",  data:levels.localResistance,  borderDash:[6,4], borderColor:"rgba(46, 204, 113, 0.9)", ...common },
    { label:"Global Support",    data:levels.globalSupport,    borderDash:[2,3], borderColor:"rgba(192, 57, 43, 0.6)",  ...common },
    { label:"Global Resistance", data:levels.globalResistance, borderDash:[2,3], borderColor:"rgba(39, 174, 96, 0.6)",  ...common },
  ];
}

function buildViewSeries(original) {
  const gran = Settings.granularity;
  let transformed = applyGranularity(original.slice(), gran);
  transformed = sliceByRange(transformed, gran, Settings.range);
  return transformed;
}

function applyYScaleOptions(chart) {
  const y = chart.options.scales.y;
  if (Settings.yMode === "LOG") {
    y.type = "logarithmic";
    y.min = Math.max(1, PRICE_MIN);
    delete y.max;
  } else {
    y.type = "linear";
    if (Settings.yMode === "GLOBAL") {
      y.min = PRICE_MIN; y.max = PRICE_MAX;
    } else {
      delete y.min; delete y.max;
    }
  }
}

function initChart(ticker, seriesWeekly) {
  MODEL_STATE[ticker] = ensureTickerModel(MODEL_STATE[ticker]);

  const seriesView = buildViewSeries(seriesWeekly);
  const ctx = document.getElementById(`${ticker}-canvas`);
  const labels = buildLabels(seriesView.length, Settings.granularity);

  const levels = computeLevels(seriesView);
  const chan   = computeChannelLinesForView(seriesView.length, MODEL_STATE[ticker]);
  const patt   = datasetPattern(seriesView, MODEL_STATE[ticker]);

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label:ticker, data:seriesView, tension:0.25, pointRadius:0, borderWidth:3, borderColor:"#1f6feb", order:10 },
        ...datasetLevels(levels),
        ...datasetChannel(chan),
        ...patt,
      ]
    },
    options: {
      animation:false, responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ mode:"index", intersect:false, callbacks:{ label:(c)=>`$${c.parsed.y}` } } },
      scales:{ x:{ grid:{display:false} }, y:{ ticks:{ callback:v=>`$${v}` } } }
    }
  });
  applyYScaleOptions(chart);
  chart.update();

  charts[ticker] = chart;
  updatePriceCaption(ticker, seriesWeekly.at(-1));
}

function refreshChart(ticker, seriesWeekly) {
  MODEL_STATE[ticker] = ensureTickerModel(MODEL_STATE[ticker]);

  const chart  = charts[ticker];
  const view   = buildViewSeries(seriesWeekly);
  const labels = buildLabels(view.length, Settings.granularity);

  const levels = computeLevels(view);
  const chan   = computeChannelLinesForView(view.length, MODEL_STATE[ticker]);
  const patt   = datasetPattern(view, MODEL_STATE[ticker]);

  chart.data.labels = labels;

  // 0) Цена
  chart.data.datasets[0].data = view;
  chart.data.datasets[0].borderWidth = 3;
  chart.data.datasets[0].borderColor = "#1f6feb";
  chart.data.datasets[0].order = 10;

  // 1) Уровни S/R (1..4)
  const lvSets = datasetLevels(levels);
  for (let i=0; i<lvSets.length; i++) {
    const idx = 1 + i;
    if (!chart.data.datasets[idx]) chart.data.datasets[idx] = lvSets[i];
    else {
      chart.data.datasets[idx].data        = lvSets[i].data;
      chart.data.datasets[idx].borderDash  = lvSets[i].borderDash;
      chart.data.datasets[idx].borderColor = lvSets[i].borderColor;
      chart.data.datasets[idx].borderWidth = lvSets[i].borderWidth;
      chart.data.datasets[idx].pointRadius = 0;
      chart.data.datasets[idx].fill        = false;
      chart.data.datasets[idx].order       = 0;
    }
  }

  // 2) Канал (после уровней)
  const chSets = datasetChannel(chan);
  for (let i=0; i<chSets.length; i++) {
    const idx = 1 + lvSets.length + i;
    if (!chart.data.datasets[idx]) chart.data.datasets[idx] = chSets[i];
    else {
      chart.data.datasets[idx].data        = chSets[i].data;
      chart.data.datasets[idx].borderDash  = chSets[i].borderDash;
      chart.data.datasets[idx].borderColor = chSets[i].borderColor;
      chart.data.datasets[idx].borderWidth = chSets[i].borderWidth;
      chart.data.datasets[idx].pointRadius = 0;
      chart.data.datasets[idx].fill        = false;
      chart.data.datasets[idx].order       = 0;
    }
  }

  // 3) Паттерн (после канала)
  for (let i=0; i<patt.length; i++) {
    const idx = 1 + lvSets.length + chSets.length + i;
    if (!chart.data.datasets[idx]) chart.data.datasets[idx] = patt[i];
    else {
      chart.data.datasets[idx].data        = patt[i].data;
      chart.data.datasets[idx].borderDash  = patt[i].borderDash;
      chart.data.datasets[idx].borderColor = patt[i].borderColor;
      chart.data.datasets[idx].borderWidth = patt[i].borderWidth;
      chart.data.datasets[idx].pointRadius = 0;
      chart.data.datasets[idx].fill        = false;
      chart.data.datasets[idx].order       = 0;
    }
  }

  // 4) Обрезка лишних датасетов (если канал/паттерн исчезли)
  const needed = 1 + lvSets.length + chSets.length + patt.length;
  if (chart.data.datasets.length > needed) {
    chart.data.datasets.splice(needed, chart.data.datasets.length - needed);
  }

  applyYScaleOptions(chart);
  chart.update();
  updatePriceCaption(ticker, seriesWeekly.at(-1));
}

function updateAllCharts(){
  TICKERS.forEach(t => refreshChart(t, STATE[t]));
}

// ===== Инициализация =====
let STATE = null;
let MODEL_STATE = null;

async function bootstrap() {
  TICKERS.forEach(createCard);
  STATE = await loadData();
  MODEL_STATE = loadModel() || initModel(STATE);
  MODEL_STATE = migrateModel(MODEL_STATE) || initModel(STATE);
  saveModel(MODEL_STATE);

  TICKERS.forEach(t => initChart(t, STATE[t]));
  initViewControls();
}

// «Следующий ход»: джокер у случайного тикера + дивиденды каждые 12 ходов
document.getElementById("nextBtn").addEventListener("click", () => {
  // счётчик (persist)
  const turn = divGetTurn() + 1;
  divSetTurn(turn);

  // определим «джокера»
  const jokerTicker = TICKERS[Math.floor(Math.random() * TICKERS.length)];

  // дивидендный ход?
  let dividendInfo = null;
  if (turn % DIVIDEND_INTERVAL === 0) {
    const divTicker = TICKERS[Math.floor(Math.random() * TICKERS.length)];
    const series = STATE[divTicker];
    const last = series.at(-1);
    const pct = 5 + Math.floor(Math.random() * 11); // 5..15
    let divAmount = Math.round(last * pct / 100);
    if (divAmount < 1) divAmount = 1;
    let after = clampInt(last * (1 - pct/100), PRICE_MIN, PRICE_MAX);
    if (after >= last && last > PRICE_MIN) after = clampInt(last - 1, PRICE_MIN, PRICE_MAX);

    // добавим новую точку ДЛЯ ВСЕХ тикеров, но для дивидендного — цена = after
    TICKERS.forEach(t => {
      if (t === divTicker) {
        STATE[t].push(after);
      } else {
        const next = nextPriceTA(STATE[t], MODEL_STATE[t], t === jokerTicker);
        STATE[t].push(next);
      }
    });

    dividendInfo = { ticker: divTicker, pct, divAmount, before: last, after };
  } else {
    // обычный ход
    TICKERS.forEach(t => {
      const next = nextPriceTA(STATE[t], MODEL_STATE[t], t === jokerTicker);
      STATE[t].push(next);
    });
  }

  saveData(STATE);
  saveModel(MODEL_STATE);
  updateAllCharts();

  // если были дивиденды — показываем модалку и логируем
  if (dividendInfo) {
    divLog({ ts: Date.now(), turn, ...dividendInfo });
    const { ticker, pct, divAmount, before, after } = dividendInfo;
    const html = `${ticker} объявляет дивиденды ${pct}% (${divAmount}$ на акцию).Цена: $${before} →$${after}.`;
    showDividendModal(html, null);
  }
});

// Reset
const resetBtn = document.getElementById("resetBtn");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    if (confirm("Сбросить данные и начать заново?")) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY_MODEL);
      localStorage.removeItem(DIV_TURN_KEY);
      localStorage.removeItem(DIV_LOG_KEY);
      location.reload();
    }
  });
}

// Переключатель уровней (только S/R — датасеты 1..4)
const SRToggleKey = "sr_levels_visible_v1";
function setLevelsVisibility(visible) {
  for (const t of TICKERS) {
    const ch = charts[t];
    if (!ch) continue;
    for (let i = 1; i <= 4; i++) {
      if (ch.data.datasets[i]) ch.data.datasets[i].hidden = !visible;
    }
    ch.update();
  }
  localStorage.setItem(SRToggleKey, JSON.stringify(!!visible));
}
(function initLevelsToggle(){
  const el = document.getElementById("levelsToggle");
  if (!el) return;
  const saved = localStorage.getItem(SRToggleKey);
  const visible = saved === null ? true : JSON.parse(saved);
  el.checked = visible;
  el.addEventListener("change", () => setLevelsVisibility(el.checked));

  const applyWhenReady = () => {
    if (Object.keys(charts).length === TICKERS.length) setLevelsVisibility(visible);
    else requestAnimationFrame(applyWhenReady);
  };
  applyWhenReady();
})();

// UI для вида
function initViewControls(){
  const g = document.getElementById("granularity");
  const r = document.getElementById("range");
  const y = document.getElementById("yscale");
  if (!g || !r || !y) return;

  g.value = Settings.granularity;
  r.value = Settings.range;
  y.value = Settings.yMode;

  g.addEventListener("change", ()=>{ Settings.granularity = g.value; saveViewSettings(); updateAllCharts(); });
  r.addEventListener("change", ()=>{ Settings.range = r.value; saveViewSettings(); updateAllCharts(); });
  y.addEventListener("change", ()=>{ Settings.yMode = y.value; saveViewSettings(); updateAllCharts(); });
}

bootstrap();
