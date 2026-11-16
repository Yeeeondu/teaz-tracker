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
// 일 순증 = (이번 값 − 직전 수집 값) × 24 ÷ 두 수집 사이 시간. 수집 시각이 들쭉날쭉해도 하루치로 비교되게 함.
function gain24(days, i, get) {
  const v = get(days[i]);
  if (v == null) return null;
  for (let j = i - 1; j >= 0; j--) {
    const p = get(days[j]);
    if (p == null) continue;
    const hours = (days[i].t - days[j].t) / 3.6e6;
    if (hours <= 0) return null;
    return { v: (v - p) * 24 / hours, raw: v - p, hours, from: days[j].date };
  }
  return null;
}

function prepare(raw) {
  const days = (raw.days || []).map(d => {
    const ids = Object.keys(d.items);
    let msg = 0, like = 0, likeOk = d.origin === "own";
    const works = {};
    for (const id of ids) {
      const [, work, m, l] = d.items[id];
      msg += m;
      if (l == null) likeOk = false; else like += l;
      const w = norm(work) || "(원작 없음)";
      works[w] = (works[w] || 0) + m;
    }
    return { ...d, t: Date.parse(d.captured_at), msg, like: likeOk ? like : null, works, chars: ids.length };
  }).sort((a, b) => a.t - b.t);
  days.forEach((d, i) => {
    d.gMsg = gain24(days, i, x => x.msg);
    d.gLike = gain24(days, i, x => x.like);
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
  ? `<div class="row"><span>일 순증(24h 환산)</span><span>${signed(g.v)}</span></div>` +
    `<div class="row sub"><span>실제 증가 · ${g.from} 이후 ${g.hours.toFixed(1)}시간</span><span>${signed(g.raw)}</span></div>`
  : "";

// 선(누적) + 아래 막대(일 순증)
function drawLineBar(el, all, key, gkey, colorVar, label, empty) {
  const days = inRange(all).filter(d => d[key] != null);
  if (!days.length) { el.innerHTML = `<div class="empty">${empty}</div>`; return; }
  const pad = { l: 56, r: 76, t: 14, b: 22 }, barH = 74, gap = 22;
  const f = frame(el, days, pad);
  const lh = f.H - pad.t - pad.b - barH - gap;
  const color = css(colorVar), surface = css("--surface");
  const vals = days.map(d => d[key]);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const lo = ticks[0], hi = ticks.at(-1);
  const y = v => pad.t + lh - ((v - lo) / (hi - lo || 1)) * lh;
  let s = `<svg viewBox="0 0 ${f.W} ${f.H}" role="img" aria-label="${label} 누적과 일 순증">`;
  s += yAxis(ticks, y, pad.l, f.W - pad.r);
  // 원본 기록 구간은 점선, 직접 수집 구간은 실선. 하루 넘게 비면 선을 끊지 않고 이어 그림.
  const seg = (list, dash) => {
    if (list.length < 2) return "";
    const p = list.map((d, j) => (j ? "L" : "M") + f.x(d.date).toFixed(1) + "," + y(d[key]).toFixed(1)).join("");
    return `<path d="${p}" fill="none" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`;
  };
  const iOwn = days.findIndex(d => d.origin === "own");
  if (iOwn < 0) s += seg(days, true);
  else { s += seg(days.slice(0, iOwn + 1), true); s += seg(days.slice(iOwn), false); }
  const last = days.at(-1);
  s += `<circle cx="${f.x(last.date)}" cy="${y(last[key])}" r="4" fill="${color}" stroke="${surface}" stroke-width="2"/>`;
  s += `<text class="endlabel" x="${f.x(last.date) + 8}" y="${y(last[key]) + 4}">${short(last[key])}</text>`;

  // 막대
  const bTop = pad.t + lh + gap;
  const gv = days.map(d => d[gkey]?.v).filter(v => v != null);
  const gLo = Math.min(0, ...gv), gHi = Math.max(1, ...gv);
  const gt = niceTicks(gLo, gHi, 2), bLo = Math.min(0, gt[0]), bHi = gt.at(-1);
  const by = v => bTop + barH - ((v - bLo) / (bHi - bLo || 1)) * barH;
  s += `<line class="gridline" x1="${pad.l}" x2="${f.W - pad.r}" y1="${by(bHi)}" y2="${by(bHi)}"/>`;
  s += `<g class="axis"><text x="${pad.l - 6}" y="${by(bHi) + 4}" text-anchor="end">${gv.length ? short(bHi) : ""}</text>` +
    `<text x="${pad.l - 6}" y="${by(0) + 4}" text-anchor="end">0</text></g>`;
  const bw = Math.max(2, Math.min(16, f.dayW * 0.62));
  for (const d of days) {
    const g = d[gkey]?.v;
    if (g == null || Math.round(g) === 0) continue;
    const y0 = by(0), y1 = by(g), h = Math.abs(y0 - y1), top = Math.min(y0, y1), x0 = f.x(d.date) - bw / 2;
    const r = Math.min(3, h / 2, bw / 2);
    s += g > 0
      ? `<path class="gainbar" d="M${x0},${y0}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${y0}Z" fill="${color}"/>`
      : `<rect class="gainbar" x="${x0}" y="${top}" width="${bw}" height="${h}" fill="${css("--down")}"/>`;
  }
  s += `<line class="baseline" x1="${pad.l}" x2="${f.W - pad.r}" y1="${by(0)}" y2="${by(0)}"/>`;
  s += `<text class="gainlabel" x="${f.W - pad.r + 8}" y="${by(bHi) + 10}">일 순증</text>`;
  if (last[gkey]) s += `<text class="endlabel" x="${f.W - pad.r + 8}" y="${by(bHi) + 26}">${(last[gkey].v > 0 ? "+" : "") + short(last[gkey].v)}</text>`;
  s += divider(f, days, pad.t, f.H - pad.b);
  s += dateAxis(f, days, f.H);
  s += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${f.H - pad.b}" visibility="hidden"/>`;
  s += `<rect class="hit" x="${pad.l - 10}" y="${pad.t}" width="${f.iw + 20}" height="${f.H - pad.t - pad.b}"/></svg>`;
  el.innerHTML = s;
  attachHover(el, f, days, pad, d =>
    `<b>${d.date} · ${srcLabel(d)}</b>` +
    `<div class="row sub"><span>수집 ${kst(d.captured_at, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span>캐릭터 ${d.chars}개</span></div>` +
    `<div class="row"><span>${label} 누적</span><span>${fmt(d[key])}</span></div>` + gainRow(d[gkey]));
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

// ───────── 카드 ─────────
function renderCards() {
  const days = state.d.days, last = days.at(-1);
  if (!last) { $("#cards").innerHTML = ""; return; }
  const likeDays = days.filter(d => d.like != null), lastLike = likeDays.at(-1);
  const workCount = Object.keys(last.works).filter(w => w !== "(원작 없음)").length;
  const g = last.gMsg;
  // 최근 7일 평균 대비
  const recent = days.slice(-8, -1).map(d => d.gMsg?.v).filter(v => v != null);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  const vsAvg = g && avg ? ((g.v / avg - 1) * 100) : null;
  const card = (k, v, d, cls = "") => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="d ${cls}">${d}</div></div>`;
  $("#cards").innerHTML =
    card("메시지 누적", fmt(last.msg), `${last.date} 수집`) +
    card("일 순증 (24h 환산)", signed(g?.v), vsAvg == null ? "직전 수집 대비" : `직전 7회 평균 ${signed(avg)} 대비 ${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(0)}%`, vsAvg == null ? "" : vsAvg >= 0 ? "up" : "down") +
    card("좋아요 누적", lastLike ? fmt(lastLike.like) : "—", lastLike ? (lastLike.gLike ? `일 순증 ${signed(lastLike.gLike.v)}` : "직접 수집 첫날") : "직접 수집부터 기록") +
    card("캐릭터 · 원작", `${last.chars} · ${workCount}`, "공개 캐릭터 수 · 원작 수");
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
    for (const [id, [name, work, m, l, pub]] of Object.entries(d.items)) {
      const q = p?.items[id];
      const gm = q && k ? (m - q[2]) * k : null;
      const gl = q && k && l != null && q[3] != null ? (l - q[3]) * k : null;
      rows.push({
        name, work: norm(work), url: `https://myteaz.io/ko/chat/c/${encodeURIComponent(pub || id)}`,
        msg: m, gmsg: gm, share: gm != null && totalGain > 0 ? (gm / totalGain) * 100 : null, like: l, glike: gl, isNew: !q && !!p,
      });
    }
  }
  let list = rows;
  if (state.group === "work") {
    const map = new Map();
    for (const r of rows) {
      const g = map.get(r.work) || { name: r.work || "(원작 없음)", work: "", n: 0, msg: 0, gmsg: 0, share: 0, like: 0, glike: 0, url: null, gNull: true, lNull: false };
      g.n++; g.msg += r.msg;
      if (r.gmsg != null) { g.gmsg += r.gmsg; g.share += r.share || 0; g.gNull = false; }
      if (r.like == null) g.lNull = true; else g.like += r.like;
      if (r.glike != null) g.glike += r.glike;
      map.set(r.work, g);
    }
    list = [...map.values()].map(g => ({ ...g, work: `캐릭터 ${g.n}명`, gmsg: g.gNull ? null : g.gmsg, share: g.gNull ? null : g.share, like: g.lNull ? null : g.like, glike: g.lNull ? null : g.glike }));
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
  { key: "like", label: "좋아요" },
  { key: "glike", label: "좋아요 순증" },
];

function renderTable() {
  const { list, shown, sort, day, prev } = currentRows();
  $("#table thead").innerHTML = "<tr>" + COLS().map(c =>
    `<th class="${c.l ? "l" : ""}" data-key="${c.key}">${c.label}<span class="arrow">${sort.key === c.key ? (sort.dir < 0 ? " ▼" : " ▲") : ""}</span></th>`).join("") + "</tr>";
  const cls = v => (v == null ? "zero" : Math.round(v) > 0 ? "up" : Math.round(v) < 0 ? "down" : "zero");
  const sum = k => list.some(r => r[k] != null) ? list.reduce((a, r) => a + (r[k] || 0), 0) : null;
  const maxShare = Math.max(1, ...shown.map(r => r.share || 0));
  const total = list.length ? `<tr class="total"><td></td><td class="l">합계</td><td class="l">${state.group === "work" ? `원작 ${list.length}개` : `캐릭터 ${list.length}명`}</td>` +
    `<td>${fmt(sum("msg"))}</td><td>${signed(sum("gmsg"))}</td><td></td><td>${fmt(day?.like)}</td><td>${signed(sum("glike"))}</td></tr>` : "";
  $("#table tbody").innerHTML = total + (shown.map((r, i) => `<tr><td>${i + 1}</td>` +
    `<td class="l name">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a>` : esc(r.name)}${r.isNew ? ' <span class="badge">신규</span>' : ""}</td>` +
    `<td class="l work">${esc(r.work || "—")}</td>` +
    `<td>${fmt(r.msg)}</td><td class="${cls(r.gmsg)}">${signed(r.gmsg)}</td>` +
    `<td>${r.share != null ? `<span class="bar-cell" style="width:${Math.max(2, (r.share / maxShare) * 60)}px"></span>` : ""}${pct(r.share)}</td>` +
    `<td>${fmt(r.like)}</td><td class="${cls(r.glike)}">${signed(r.glike)}</td></tr>`).join("")
    || `<tr><td colspan="8" class="l zero">표시할 항목이 없습니다</td></tr>`);
  $("#table-sub").textContent = day
    ? `${kst(day.captured_at)} 수집 · ${srcLabel(day)}` +
      (prev ? ` · 순증은 직전 수집(${prev.date}, ${((day.t - prev.t) / 3.6e6).toFixed(1)}시간 전) 대비를 24시간으로 환산` : "") +
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
  const days = state.d.days;
  drawLineBar($("#plot-msg"), days, "msg", "gMsg", "--s1", "메시지", "아직 수집된 데이터가 없습니다");
  drawLineBar($("#plot-like"), days, "like", "gLike", "--s6", "좋아요", "첫 직접 수집부터 그래프가 시작됩니다");
  drawWorks();
}

function render() { renderUpdated(); renderCards(); renderCharts(); renderDates(); renderTable(); }

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
  const body = shown.map(r => [r.name, r.work, r.msg, r1(r.gmsg), r1(r.share), r.like, r1(r.glike), r.url].map(q).join(","));
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
