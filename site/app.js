"use strict";

// ───────── 설정 ─────────
const REFRESH_MS = 10 * 60 * 1000;
const PALETTE = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"];
const state = { range: 0, wmode: "abs", group: "char", search: "", date: null, sort: null, d: null };

// ───────── 유틸 ─────────
const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const nf = new Intl.NumberFormat("ko-KR");
const fmt = n => (n == null || Number.isNaN(n) ? "—" : nf.format(Math.round(n)));
const signed = n => (n == null || Number.isNaN(n) ? "—" : (Math.round(n) > 0 ? "+" : "") + fmt(n));
const pct = n => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(1) + "%");
function short(n) {
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, "") + "억";
  if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "만";
  return nf.format(Math.round(n));
}
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const dayNum = d => Date.parse(d + "T00:00:00Z") / 864e5;
const kst = (iso, o) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", ...o });
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => (s || "").normalize("NFC").trim().replace(/\s+/g, " ");

// ───────── 데이터 ─────────
// 집계 기준: 매일 사이트에 공개된 전체 캐릭터의 합계
// 순증: 직전 수집과의 차이를 24시간 기준으로 환산(수집 시각이 밀려도 같은 잣대로 비교) — 탑툰챗과 같은 방식
const MIN_GAP_H = 6; // 이보다 짧은 간격은 환산 오차가 커서 순증을 표시하지 않음
function gain24(days, i, get) {
  const v = get(days[i]);
  if (v == null) return null;
  for (let j = i - 1; j >= 0; j--) {
    const p = get(days[j]);
    if (p == null) continue;
    const hours = (days[i].t - days[j].t) / 3.6e6;
    if (!(hours >= MIN_GAP_H)) return { v: null, raw: v - p, hours, from: days[j].date };
    return { v: Math.round((v - p) * 24 / hours), raw: v - p, hours, from: days[j].date };
  }
  return null;
}
const hrs = h => (h >= 47.5 ? `${(h / 24).toFixed(1)}일` : `${Math.round(h)}시간`);

function prepare(raw) {
  const days = (raw.days || []).map(d => {
    const ids = Object.keys(d.items);
    let msg = 0;
    const works = {};
    for (const id of ids) {
      const [, work, m] = d.items[id];
      msg += m;
      const w = norm(work) || "(원작 없음)";
      works[w] = (works[w] || 0) + m;
    }
    const nWorks = Object.keys(works).filter(w => w !== "(원작 없음)").length;
    return { ...d, t: Date.parse(d.captured_at), msg, works, chars: ids.length, nWorks };
  }).sort((a, b) => a.t - b.t);
  days.forEach((d, i) => {
    d.gMsg = gain24(days, i, x => x.msg);
  });
  // 원작은 최근 누적이 큰 순서로 고정 색 배정
  const last = days.at(-1);
  const works = last ? Object.keys(last.works).sort((a, b) => last.works[b] - last.works[a]) : [];
  const firstOwn = days.find(d => d.origin === "own")?.date || null;
  return { source: raw.source, days, works, firstOwn };
}

async function load() {
  try {
    const r = await fetch(`data/teaz.json?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    state.d = prepare(await r.json());
  } catch {
    if (!state.d) state.d = prepare({ days: [] });
  }
}

function inRange(days) {
  if (!state.range || !days.length) return days;
  const end = dayNum(days.at(-1).date);
  return days.filter(d => dayNum(d.date) > end - state.range);
}

// ───────── 차트 공통 ─────────
function niceTicks(min, max, count = 4) {
  if (max === min) { max += Math.max(1, Math.abs(max) * 0.01); min -= Math.max(1, Math.abs(min) * 0.01); }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 1e-6; t += step) ticks.push(t);
  if (ticks.at(-1) < max) ticks.push(ticks.at(-1) + step);
  return ticks;
}

function frame(el, days, pad) {
  const W = el.clientWidth || 560, H = el.clientHeight || 360;
  const iw = W - pad.l - pad.r;
  const d0 = dayNum(days[0].date), d1 = dayNum(days.at(-1).date), span = Math.max(1, d1 - d0);
  const x = d => pad.l + (days.length > 1 ? ((dayNum(d) - d0) / span) * iw : iw / 2);
  const dayW = days.length > 1 ? iw / span : iw;
  return { W, H, iw, x, dayW };
}

function dateAxis(f, days, H) {
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(f.iw / 64))));
  let s = `<g class="axis">`;
  const xEnd = f.x(days.at(-1).date);
  days.forEach((d, k) => {
    const isLast = k === days.length - 1;
    if ((k % every === 0 && xEnd - f.x(d.date) > 44) || isLast)
      s += `<text x="${f.x(d.date)}" y="${H - 4}" text-anchor="middle">${md(d.date)}</text>`;
  });
  return s + `</g>`;
}

function divider(f, days, top, bottom) {
  const fo = state.d.firstOwn;
  if (!fo || fo <= days[0].date || fo > days.at(-1).date) return "";
  const xx = f.x(fo) - f.dayW / 2;
  return `<line class="divider" x1="${xx}" x2="${xx}" y1="${top}" y2="${bottom}"/>` +
    `<text class="divlabel" x="${xx + 4}" y="${top + 10}">직접 수집 →</text>`;
}

function yAxis(ticks, y, x0, x1) {
  const tl = ticks.map(short), lab = new Set(tl).size < tl.length ? ticks.map(fmt) : tl;
  let s = `<g class="axis">`;
  ticks.forEach((t, i) => {
    s += `<line class="gridline" x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text x="${x0 - 6}" y="${y(t) + 4}" text-anchor="end">${lab[i]}</text>`;
  });
  return s + `</g>`;
}

function attachHover(el, f, days, pad, html) {
  const s = el.querySelector("svg"), cross = s.querySelector(".cross"), tip = $("#tip");
  const hit = s.querySelector(".hit");
  hit.addEventListener("mousemove", e => {
    const r = s.getBoundingClientRect();
    const px = (e.clientX - r.left) * (f.W / r.width);
    let k = 0, best = Infinity;
    days.forEach((d, i) => { const dx = Math.abs(f.x(d.date) - px); if (dx < best) { best = dx; k = i; } });
    const xx = f.x(days[k].date);
    cross.setAttribute("x1", xx); cross.setAttribute("x2", xx); cross.setAttribute("visibility", "visible");
    tip.innerHTML = html(days[k]);
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = e.clientY + 14 + "px";
  });
  hit.addEventListener("mouseleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
}

const srcLabel = d => (d.origin === "own" ? "직접 수집" : "원본 사이트 기록");
const gainRow = g => g
  ? `<div class="row"><span>순증(24h 환산)</span><span>${g.v == null ? "—" : signed(g.v)}</span></div>` +
    `<div class="row sub"><span>실제 증가 · ${hrs(g.hours)}</span><span>${signed(g.raw)}</span></div>`
  : "";

// 메시지: 그날 순증 막대(24시간 기준 환산)만. 누적값은 패널 오른쪽 위 숫자로 표시
function drawGain() {
  const el = $("#plot-msg"), all = state.d.days, days = inRange(all);
  if (!days.length) { el.innerHTML = `<div class="empty">아직 수집된 데이터가 없습니다</div>`; return; }
  const pad = { l: 56, r: 64, t: 14, b: 22 };
  const f = frame(el, days, pad);
  const ph = f.H - pad.t - pad.b;
  const color = css("--s1");
  const gv = days.map(d => d.gMsg?.v).filter(v => v != null);
  let s = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="메시지 일별 순증">`;
  if (!gv.length) {
    s += `<text class="gainlabel" x="${pad.l + f.iw / 2}" y="${pad.t + ph / 2}" text-anchor="middle">수집이 2일 이상 쌓이면 표시됩니다</text></svg>`;
    el.innerHTML = s; return;
  }
  const ticks = niceTicks(Math.min(0, ...gv), Math.max(0, ...gv, 1));
  const lo = ticks[0], hi = ticks.at(-1);
  const y = v => pad.t + ph - ((v - lo) / (hi - lo || 1)) * ph;
  s += yAxis(ticks, y, pad.l, f.W - pad.r);
  const bw = Math.max(2, Math.min(18, f.dayW * 0.6));
  for (const d of days) {
    const g = d.gMsg?.v;
    if (g == null || g === 0) continue;
    const y0 = y(0), y1 = y(g), h = Math.abs(y0 - y1), top = Math.min(y0, y1), x0 = f.x(d.date) - bw / 2;
    const r = Math.min(4, h / 2, bw / 2);
    const op = d.origin === "own" ? 1 : 0.6; // 원본 사이트 기록 구간은 옅게
    s += g > 0
      ? `<path d="M${x0},${y0}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${y0}Z" fill="${color}" fill-opacity="${op}"/>`
      : `<rect x="${x0}" y="${top}" width="${bw}" height="${h}" fill="${css("--down")}" fill-opacity="${op}"/>`;
  }
  s += `<line class="baseline" x1="${pad.l}" x2="${f.W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  const last = days.at(-1), lg = last.gMsg?.v;
  if (lg != null) s += `<text class="endlabel" x="${f.x(last.date) + bw / 2 + 6}" y="${y(lg) + 4}">${(lg > 0 ? "+" : "") + short(lg)}</text>`;
  s += divider(f, days, pad.t, f.H - pad.b);
  s += dateAxis(f, days, f.H);
  s += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${f.H - pad.b}" visibility="hidden"/>`;
  s += `<rect class="hit" x="${pad.l - 10}" y="${pad.t}" width="${f.iw + 20}" height="${ph}"/></svg>`;
  el.innerHTML = s;
  attachHover(el, f, days, pad, d =>
    `<b>${d.date} · ${srcLabel(d)}</b>` +
    `<div class="row sub"><span>수집 ${kst(d.captured_at, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span>캐릭터 ${d.chars}개</span></div>` +
    `<div class="row"><span>메시지 누적</span><span>${fmt(d.msg)}</span></div>` + gainRow(d.gMsg));
}

// 캐릭터 수 · 원작 수 (계단선) — 그날 새로 생기거나 빠진 캐릭터·원작은 마우스를 올리면 표시
function countChanges(all, d) {
  const i = all.indexOf(d), p = i > 0 ? all[i - 1] : null;
  if (!p) return { addC: [], delC: [], addW: [], delW: [] };
  const names = x => new Map(Object.entries(x.items).map(([id, v]) => [id, v[0]]));
  const a = names(d), b = names(p);
  const wa = new Set(Object.keys(d.works)), wb = new Set(Object.keys(p.works));
  return {
    addC: [...a].filter(([id]) => !b.has(id)).map(([, n]) => n),
    delC: [...b].filter(([id]) => !a.has(id)).map(([, n]) => n),
    addW: [...wa].filter(w => !wb.has(w) && w !== "(원작 없음)"),
    delW: [...wb].filter(w => !wa.has(w) && w !== "(원작 없음)"),
  };
}

function drawCounts() {
  const el = $("#plot-count"), all = state.d.days, days = inRange(all);
  if (!days.length) { el.innerHTML = `<div class="empty">아직 수집된 데이터가 없습니다</div>`; $("#count-legend").innerHTML = ""; return; }
  const series = [
    { key: "chars", label: "캐릭터", color: css("--s1") },
    { key: "nWorks", label: "원작", color: css("--s2") },
  ];
  const pad = { l: 40, r: 76, t: 14, b: 22 };
  const f = frame(el, days, pad);
  const ph = f.H - pad.t - pad.b;
  const max = Math.max(...days.flatMap(d => series.map(s => d[s.key])));
  const step = Math.max(1, niceTicks(0, max + 2)[1]);
  const tk = []; for (let t = 0; t <= max + 2; t += step) tk.push(t);
  if (tk.at(-1) < max + 1) tk.push(tk.at(-1) + step);
  const hi = tk.at(-1);
  const y = v => pad.t + ph - (v / hi) * ph;
  let s = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="캐릭터 수와 원작 수 추이">`;
  s += yAxis(tk, y, pad.l, f.W - pad.r);
  const iOwn = days.findIndex(d => d.origin === "own");
  const labels = [];
  for (const se of series) {
    const path = list => list.map((d, j) => j
      ? `H${f.x(d.date).toFixed(1)}V${y(d[se.key]).toFixed(1)}`
      : `M${f.x(d.date).toFixed(1)},${y(d[se.key]).toFixed(1)}`).join("");
    const line = (list, dash) => list.length < 2 ? "" :
      `<path d="${path(list)}" fill="none" stroke="${se.color}" stroke-width="2" ${dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`;
    if (iOwn < 0) s += line(days, true);
    else { s += line(days.slice(0, iOwn + 1), true); s += line(days.slice(iOwn), false); }
    // 값이 바뀐 날에만 점
    days.forEach((d, j) => {
      if (j === 0 || d[se.key] !== days[j - 1][se.key] || j === days.length - 1)
        s += `<circle cx="${f.x(d.date)}" cy="${y(d[se.key])}" r="3" fill="${se.color}"/>`;
    });
    const last = days.at(-1);
    labels.push({ y: y(last[se.key]), text: `${se.label} ${last[se.key]}`, color: se.color });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  for (const l of labels) s += `<text class="endlabel" x="${f.W - pad.r + 8}" y="${l.y + 4}" style="fill:${l.color}">${l.text}</text>`;
  s += divider(f, days, pad.t, f.H - pad.b);
  s += dateAxis(f, days, f.H);
  s += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${f.H - pad.b}" visibility="hidden"/>`;
  s += `<rect class="hit" x="${pad.l - 10}" y="${pad.t}" width="${f.iw + 20}" height="${ph}"/></svg>`;
  el.innerHTML = s;
  const diffTxt = (d, key) => {
    const i = all.indexOf(d); if (i < 1) return "";
    const v = d[key] - all[i - 1][key];
    return v ? ` <em class="${v > 0 ? "" : "neg"}">${v > 0 ? "+" : ""}${v}</em>` : "";
  };
  const list = (k, arr) => arr.length ? `<div class="row sub"><span>${k}</span><span>${arr.map(esc).join(", ")}</span></div>` : "";
  attachHover(el, f, days, pad, d => {
    const c = countChanges(all, d);
    return `<b>${d.date} · ${srcLabel(d)}</b>` +
      `<div class="row"><span><i style="background:${series[0].color}"></i>캐릭터 수</span><span>${d.chars}${diffTxt(d, "chars")}</span></div>` +
      `<div class="row"><span><i style="background:${series[1].color}"></i>원작 수</span><span>${d.nWorks}${diffTxt(d, "nWorks")}</span></div>` +
      list("새 캐릭터", c.addC) + list("빠진 캐릭터", c.delC) + list("새 원작", c.addW) + list("빠진 원작", c.delW);
  });
  $("#count-legend").innerHTML = series.map(se => `<span><i style="background:${se.color}"></i>${se.label} 수</span>`).join("") +
    `<span class="note">선이 계단처럼 바뀌는 날 = 캐릭터·원작 추가/제외</span>`;
}

// 원작별 여러 선
function workValue(days, i, w, mode) {
  const d = days[i];
  if (mode === "abs") return d.works[w] ?? null;
  const g = gain24(days, i, x => x.works[w] ?? null);
  if (mode === "gain") return g ? g.v : null;
  const tot = d.gMsg?.v;
  return g && tot > 0 ? (g.v / tot) * 100 : null;
}

function drawWorks() {
  const el = $("#plot-works"), all = state.d.days, works = state.d.works;
  const idx = new Map(all.map((d, i) => [d, i]));
  const days = inRange(all);
  if (!days.length) { el.innerHTML = `<div class="empty">아직 수집된 데이터가 없습니다</div>`; $("#works-legend").innerHTML = ""; return; }
  const mode = state.wmode;
  const series = works.map((w, k) => ({ w, color: css(PALETTE[k % PALETTE.length]), pts: days.map(d => ({ d, v: workValue(all, idx.get(d), w, mode) })) }));
  const vals = series.flatMap(s => s.pts.map(p => p.v)).filter(v => v != null);
  if (!vals.length) { el.innerHTML = `<div class="empty">순증은 두 번째 수집부터 표시됩니다</div>`; return; }
  const pad = { l: 56, r: 76, t: 14, b: 22 };
  const f = frame(el, days, pad);
  const ph = f.H - pad.t - pad.b;
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
  const lo = mode === "abs" ? niceTicks(Math.min(...vals), Math.max(...vals))[0] : ticks[0];
  const tk = mode === "abs" ? niceTicks(Math.min(...vals), Math.max(...vals)) : ticks;
  const hi = tk.at(-1);
  const y = v => pad.t + ph - ((v - lo) / (hi - lo || 1)) * ph;
  let s = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="원작별 메시지">`;
  s += mode === "share"
    ? (() => { let g = `<g class="axis">`; tk.forEach(t => { g += `<line class="gridline" x1="${pad.l}" x2="${f.W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`; }); return g + `</g>`; })()
    : yAxis(tk, y, pad.l, f.W - pad.r);
  const labels = [];
  for (const se of series) {
    const p = se.pts.filter(q => q.v != null);
    if (!p.length) continue;
    const path = p.map((q, j) => (j ? "L" : "M") + f.x(q.d.date).toFixed(1) + "," + y(q.v).toFixed(1)).join("");
    s += `<path d="${path}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lp = p.at(-1);
    s += `<circle cx="${f.x(lp.d.date)}" cy="${y(lp.v)}" r="3" fill="${se.color}"/>`;
    labels.push({ y: y(lp.v), text: mode === "share" ? lp.v.toFixed(0) + "%" : short(lp.v), color: se.color });
  }
  // 끝 라벨 겹침 방지
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  for (const l of labels) s += `<text class="endlabel" x="${f.W - pad.r + 8}" y="${l.y + 4}" style="fill:${l.color}">${l.text}</text>`;
  s += divider(f, days, pad.t, f.H - pad.b);
  s += dateAxis(f, days, f.H);
  s += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${f.H - pad.b}" visibility="hidden"/>`;
  s += `<rect class="hit" x="${pad.l - 10}" y="${pad.t}" width="${f.iw + 20}" height="${ph}"/></svg>`;
  el.innerHTML = s;
  const unit = v => (mode === "share" ? pct(v) : mode === "gain" ? signed(v) : fmt(v));
  attachHover(el, f, days, pad, d => {
    const i = idx.get(d);
    const rows = series.map(se => ({ se, v: workValue(all, i, se.w, mode) })).filter(r => r.v != null).sort((a, b) => b.v - a.v);
    return `<b>${d.date} · ${{ abs: "원작별 누적", gain: "원작별 일 순증(24h)", share: "일 순증 점유율" }[mode]}</b>` +
      rows.map(r => `<div class="row"><span><i style="background:${r.se.color}"></i>${esc(r.se.w)}</span><span>${unit(r.v)}</span></div>`).join("");
  });
  $("#works-legend").innerHTML = series.map(se => `<span><i style="background:${se.color}"></i>${esc(se.w)}</span>`).join("");
}

// ───────── 패널 오른쪽 위 숫자 ─────────
function renderStats() {
  const days = state.d.days, last = days.at(-1), prev = days.at(-2);
  const stat = (k, v, d, cls = "", title = "") =>
    `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span><span class="d ${cls}" title="${esc(title)}">${d}</span></div>`;
  if (!last) { $("#stat-msg").innerHTML = $("#stat-count").innerHTML = ""; return; }
  const g = last.gMsg, v = g?.v;
  // 직전 7회 평균 대비(마우스를 올리면 표시)
  const recent = days.slice(-8, -1).map(d => d.gMsg?.v).filter(x => x != null);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  const title = g ? `실제 ${signed(g.raw)} (${hrs(g.hours)} 동안)` + (avg != null && v != null ? ` · 직전 7회 평균 ${signed(avg)} 대비 ${v >= avg ? "+" : ""}${((v / avg - 1) * 100).toFixed(0)}%` : "") : "";
  $("#stat-msg").innerHTML = stat("메시지 누적", fmt(last.msg), v != null ? signed(v) : "", v != null && v < 0 ? "down" : "", title);
  const delta = k => {
    if (!prev) return ["", ""];
    const x = last[k] - prev[k];
    return x ? [`${x > 0 ? "+" : ""}${x}`, x > 0 ? "" : "down"] : ["변동 없음", "flat"];
  };
  const workNames = state.d.works.filter(w => w !== "(원작 없음)" && last.works[w] != null);
  const [dc, cc] = delta("chars"), [dw, cw] = delta("nWorks");
  $("#stat-count").innerHTML = stat("캐릭터", fmt(last.chars), dc, cc) + stat("원작", fmt(last.nWorks), dw, cw, workNames.join(" · "));
}

// ───────── 표 ─────────
function currentRows() {
  const days = state.d.days, i = days.findIndex(x => x.date === state.date);
  const rows = [];
  if (i >= 0) {
    const d = days[i];
    const prevIdx = i - 1, p = prevIdx >= 0 ? days[prevIdx] : null;
    const hours = p ? (d.t - p.t) / 3.6e6 : null;
    const k = hours ? 24 / hours : null;
    const totalGain = d.gMsg?.v;
    for (const [id, [name, work, m, , pub]] of Object.entries(d.items)) {
      const q = p?.items[id];
      const gm = q && k && hours >= MIN_GAP_H ? Math.round((m - q[2]) * k) : null;
      rows.push({
        name, work: norm(work), url: `https://myteaz.io/ko/chat/c/${encodeURIComponent(pub || id)}`,
        msg: m, gmsg: gm, share: gm != null && totalGain > 0 ? (gm / totalGain) * 100 : null, isNew: !q && !!p,
      });
    }
  }
  let list = rows;
  if (state.group === "work") {
    const map = new Map();
    for (const r of rows) {
      const g = map.get(r.work) || { name: r.work || "(원작 없음)", work: "", n: 0, msg: 0, gmsg: 0, share: 0, url: null, gNull: true };
      g.n++; g.msg += r.msg;
      if (r.gmsg != null) { g.gmsg += r.gmsg; g.share += r.share || 0; g.gNull = false; }
      map.set(r.work, g);
    }
    list = [...map.values()].map(g => ({ ...g, work: `캐릭터 ${g.n}명`, gmsg: g.gNull ? null : g.gmsg, share: g.gNull ? null : g.share }));
  }
  const sort = state.sort || { key: "msg", dir: -1 };
  const q = state.search.trim().toLowerCase();
  const shown = q ? list.filter(r => (r.name + " " + r.work).toLowerCase().includes(q)) : list.slice();
  shown.sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * sort.dir;
  });
  return { rows, list, shown, sort, day: days[i], prev: i > 0 ? days[i - 1] : null };
}

const COLS = () => [
  { key: "rank", label: "순위" },
  { key: "name", label: state.group === "work" ? "원작" : "캐릭터", l: true },
  { key: "work", label: state.group === "work" ? "구성" : "원작", l: true },
  { key: "msg", label: "메시지" },
  { key: "gmsg", label: "일 순증(24h)" },
  { key: "share", label: "순증 점유율" },
];

function renderTable() {
  const { list, shown, sort, day, prev } = currentRows();
  $("#table thead").innerHTML = "<tr>" + COLS().map(c =>
    `<th class="${c.l ? "l" : ""}" data-key="${c.key}">${c.label}<span class="arrow">${sort.key === c.key ? (sort.dir < 0 ? " ▼" : " ▲") : ""}</span></th>`).join("") + "</tr>";
  const cls = v => (v == null ? "zero" : Math.round(v) > 0 ? "up" : Math.round(v) < 0 ? "down" : "zero");
  const sum = k => list.some(r => r[k] != null) ? list.reduce((a, r) => a + (r[k] || 0), 0) : null;
  const maxShare = Math.max(1, ...shown.map(r => r.share || 0));
  const total = list.length ? `<tr class="total"><td></td><td class="l">합계</td><td class="l">${state.group === "work" ? `원작 ${list.length}개` : `캐릭터 ${list.length}명`}</td>` +
    `<td>${fmt(sum("msg"))}</td><td>${signed(sum("gmsg"))}</td><td></td></tr>` : "";
  $("#table tbody").innerHTML = total + (shown.map((r, i) => `<tr><td>${i + 1}</td>` +
    `<td class="l name">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a>` : esc(r.name)}${r.isNew ? ' <span class="badge">신규</span>' : ""}</td>` +
    `<td class="l work">${esc(r.work || "—")}</td>` +
    `<td>${fmt(r.msg)}</td><td class="${cls(r.gmsg)}">${signed(r.gmsg)}</td>` +
    `<td>${r.share != null ? `<span class="bar-cell" style="width:${Math.max(2, (r.share / maxShare) * 60)}px"></span>` : ""}${pct(r.share)}</td></tr>`).join("")
    || `<tr><td colspan="6" class="l zero">표시할 항목이 없습니다</td></tr>`);
  $("#table-sub").textContent = day
    ? `${kst(day.captured_at)} 수집 · ${srcLabel(day)}` +
      (prev ? ` · 순증은 직전 수집(${prev.date}, ${hrs((day.t - prev.t) / 3.6e6)} 간격) 대비를 24시간 기준으로 환산` : "") +
      " · 제목을 누르면 정렬"
    : "";
}

function renderDates() {
  const dates = state.d.days.map(x => x.date);
  if (!state.date || !dates.includes(state.date)) state.date = dates.at(-1) || null;
  $("#date").innerHTML = dates.slice().reverse().map(x => `<option ${x === state.date ? "selected" : ""}>${x}</option>`).join("");
}

function renderUpdated() {
  const last = state.d.days.at(-1);
  if (!last) { $("#updated").textContent = "아직 수집된 데이터가 없습니다"; return; }
  const text = `마지막 수집 ${kst(last.captured_at, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  const kstHour = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  const stale = last.date !== kstToday() && kstHour >= 9;
  $("#updated").innerHTML = esc(text) + (stale ? ` · <span class="warn">오늘 수집이 아직 없어요</span>` : "");
}

function renderCharts() {
  drawGain();
  drawCounts();
  drawWorks();
}

function render() { renderUpdated(); renderStats(); renderCharts(); renderDates(); renderTable(); }

// ───────── 이벤트 ─────────
function seg(id, fn) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    $(id).querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    fn(b.dataset.v);
  });
}
seg("#range", v => { state.range = Number(v); renderCharts(); });
seg("#wmode", v => { state.wmode = v; drawWorks(); });
seg("#group", v => { state.group = v; state.sort = null; renderTable(); });
$("#date").addEventListener("change", e => { state.date = e.target.value; renderTable(); });
$("#search").addEventListener("input", e => { state.search = e.target.value; renderTable(); });
$("#table thead").addEventListener("click", e => {
  const th = e.target.closest("th"); if (!th || th.dataset.key === "rank") return;
  const key = th.dataset.key, cur = currentRows().sort;
  state.sort = { key, dir: cur.key === key ? -cur.dir : (["name", "work"].includes(key) ? 1 : -1) };
  renderTable();
});
$("#csv").addEventListener("click", () => {
  const { shown } = currentRows();
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = COLS().slice(1).map(c => c.label).concat("링크");
  const r1 = v => (v == null ? "" : Math.round(v * 10) / 10);
  const body = shown.map(r => [r.name, r.work, r.msg, r1(r.gmsg), r1(r.share), r.url].map(q).join(","));
  const blob = new Blob([String.fromCharCode(0xFEFF) + [head.map(q).join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `teaz-${state.group}-${state.date}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderCharts, 150); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderCharts);

async function refresh() { await load(); render(); }
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
