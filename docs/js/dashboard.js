// Render the scroll-snap card reel dashboard from the cached session.

import { loadSession } from './storage.js';
import {
  computeSummary, fmtKm, fmtKmFull, fmtDuration, fmtSpeed,
  fmtTimeOfDay, fmtDate, fmtDateTime,
} from './stats.js';

const root = document.getElementById('root');
const empty = document.getElementById('empty');

let summaryRef = null;

(async function init() {
  const session = await loadSession();
  if (!session || !session.tracks || session.tracks.length === 0) return;

  empty.remove();
  // Recompute (cheap) so we don't depend on what was cached
  const s = session.meta?.summary || computeSummary(session.tracks);
  render(s, session.tracks);
})();

function render(s, tracks) {
  summaryRef = s;
  const reel = el('div', 'reel');

  reel.appendChild(slideHero(s));
  reel.appendChild(slideDistance(s));
  reel.appendChild(slideTime(s));
  reel.appendChild(slideRides(s));
  reel.appendChild(slideHours(s));
  reel.appendChild(slideDow(s));
  reel.appendChild(slideMonths(s));
  reel.appendChild(slideFastest(s));
  reel.appendChild(slideLongest(s));
  reel.appendChild(slideEarlyLate(s));
  reel.appendChild(slideOutro(s));

  root.appendChild(reel);
  // Flag the page so CSS can lock body-scroll and make nav fixed —
  // otherwise on mobile body + reel both scroll, snap misaligns,
  // and currentSlideIndex() reads 0.
  document.body.classList.add('reel-mode');

  // Init mini-maps once they're in DOM
  initMiniMap('mini-fast', s.fastestTrack, '#ff5a36');
  initMiniMap('mini-long', s.longestTrack, '#ffb84d');

  addSaveFab();
}

const IS_MOBILE =
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 700;

// ============ SAVE AS IMAGE ============

function addSaveFab() {
  const fab = document.createElement('div');
  fab.className = 'save-fab';
  fab.innerHTML = `
    <div class="toast"></div>
    <div class="menu">
      <button data-action="current">📸 存這張</button>
      <button data-action="all">🗂 存完整回顧 (zip)</button>
    </div>
    <button class="main-btn" title="存成圖片">💾</button>
  `;
  document.body.appendChild(fab);

  const mainBtn = fab.querySelector('.main-btn');
  const menu = fab.querySelector('.menu');
  const toast = fab.querySelector('.toast');

  mainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fab.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!fab.contains(e.target)) fab.classList.remove('open');
  });
  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    fab.classList.remove('open');
    const action = btn.dataset.action;
    setMenuBusy(menu, true);
    showToast(toast, '產生圖片中⋯');
    try {
      if (action === 'current') await saveCurrentSlide();
      else await saveAllSlides();
      showToast(toast, '下載完成 ✓', 2000);
    } catch (err) {
      console.error(err);
      showToast(toast, `失敗：${err.message}`, 3000);
    } finally {
      setMenuBusy(menu, false);
    }
  });
}

function setMenuBusy(menu, busy) {
  menu.querySelectorAll('button').forEach(b => b.disabled = busy);
}

function showToast(toast, msg, autohide = 0) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  if (autohide) {
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), autohide);
  }
}

function currentSlideIndex() {
  const reel = document.querySelector('.reel');
  const slides = document.querySelectorAll('.slide');
  if (!reel || slides.length === 0) return 0;
  const scrollTop = reel.scrollTop;
  let best = 0, bestDist = Infinity;
  slides.forEach((s, i) => {
    const d = Math.abs(s.offsetTop - scrollTop);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

// Export cards at a fixed 9:16 canvas so all slides come out identical
// regardless of the viewer's viewport.
const EXPORT_W = 1080;
const EXPORT_H = 1920;

function h2cOpts(scale) {
  return {
    backgroundColor: '#0a0a0f',
    scale,
    useCORS: true,
    allowTaint: false,
    logging: false,
    width: EXPORT_W,
    height: EXPORT_H,
    windowWidth: EXPORT_W,
    windowHeight: EXPORT_H,
    onclone(clonedDoc) {
      clonedDoc.body.classList.add('capturing');
      clonedDoc.body.classList.remove('reel-mode');
      const target = clonedDoc.querySelector('[data-export-target="1"]');
      if (target) {
        target.style.setProperty('width', EXPORT_W + 'px', 'important');
        target.style.setProperty('height', EXPORT_H + 'px', 'important');
        target.style.setProperty('min-height', EXPORT_H + 'px', 'important');
        target.style.setProperty('box-sizing', 'border-box', 'important');
      }
      flattenForCapture(clonedDoc);
    },
  };
}

async function captureSlide(slide, scale) {
  if (slide.querySelector('.mini-map')) {
    return captureSlideWithMap(slide, scale);
  }
  slide.setAttribute('data-export-target', '1');
  try {
    return await html2canvas(slide, h2cOpts(scale));
  } finally {
    slide.removeAttribute('data-export-target');
  }
}

// Slides with a Leaflet mini-map can't be captured directly: the live map is
// sized to the viewer's viewport, and html2canvas also mis-handles Leaflet's
// translate3d tile positioning. We clone the slide off-screen at the export
// size, rebuild a fresh Leaflet map inside it, stamp the tiles+polyline onto
// the html2canvas output (mirroring the poster export in map.js).
async function captureSlideWithMap(slide, scale) {
  if (typeof L === 'undefined') throw new Error('Leaflet 沒載入');

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `position:fixed;left:-99999px;top:0;width:${EXPORT_W}px;height:${EXPORT_H}px;overflow:hidden;`;
  const clone = slide.cloneNode(true);
  clone.setAttribute('data-export-target', '1');
  clone.style.setProperty('width', EXPORT_W + 'px', 'important');
  clone.style.setProperty('height', EXPORT_H + 'px', 'important');
  clone.style.setProperty('min-height', EXPORT_H + 'px', 'important');
  clone.style.setProperty('box-sizing', 'border-box', 'important');
  // slide-inner normally caps at 720px — give the map room to breathe.
  const inner = clone.querySelector('.slide-inner');
  if (inner) inner.style.setProperty('max-width', '920px', 'important');
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  // Wipe stale Leaflet DOM from the cloned mini-map so L.map can take over.
  const miniEl = clone.querySelector('.mini-map');
  miniEl.innerHTML = '';
  miniEl.className = 'mini-map';
  // The default .mini-map is only 280px tall — too small at 1920 export height.
  // Bump it so the map reads as the main subject of the card.
  miniEl.style.setProperty('width', '100%', 'important');
  miniEl.style.setProperty('max-width', '880px', 'important');
  miniEl.style.setProperty('height', '1000px', 'important');
  miniEl.style.setProperty('margin', '32px auto', 'important');

  const track = miniEl.id === 'mini-fast' ? summaryRef?.fastestTrack
              : miniEl.id === 'mini-long' ? summaryRef?.longestTrack : null;
  const color = miniEl.id === 'mini-fast' ? '#ff5a36' : '#ffb84d';

  let pmap = null;
  try {
    if (!track || !track.polyline || track.polyline.length < 2) {
      return await html2canvas(clone, h2cOpts(scale));
    }
    pmap = L.map(miniEl, {
      zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, tap: false, touchZoom: false,
      preferCanvas: true, zoomSnap: 0.25,
    });
    const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      maxZoom: 18, crossOrigin: 'anonymous',
    }).addTo(pmap);
    const line = L.polyline(track.polyline, { color, weight: 4, opacity: 0.9 }).addTo(pmap);
    const start = track.polyline[0];
    const end = track.polyline[track.polyline.length - 1];
    L.circleMarker(start, { radius: 5, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(pmap);
    L.circleMarker(end,   { radius: 5, color: '#fff', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(pmap);
    pmap.fitBounds(line.getBounds(), { padding: [20, 20] });

    await waitForTiles(tileLayer);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 300)));

    const mapCanvas = renderLeafletToCanvas(miniEl, scale);
    const canvas = await html2canvas(clone, h2cOpts(scale));
    const miniRect  = miniEl.getBoundingClientRect();
    const cloneRect = clone.getBoundingClientRect();
    const mx = Math.round((miniRect.left - cloneRect.left) * scale);
    const my = Math.round((miniRect.top  - cloneRect.top)  * scale);
    canvas.getContext('2d').drawImage(mapCanvas, mx, my);
    return canvas;
  } finally {
    if (pmap) pmap.remove();
    wrapper.remove();
  }
}

function waitForTiles(tileLayer) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    tileLayer.once('load', finish);
    setTimeout(finish, 6000);
  });
}

function renderLeafletToCanvas(mapEl, scale) {
  const rect = mapEl.getBoundingClientRect();
  const out = document.createElement('canvas');
  out.width = Math.round(rect.width * scale);
  out.height = Math.round(rect.height * scale);
  const ctx = out.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const radius = 16;
  ctx.save();
  roundedRectPath(ctx, 0, 0, rect.width, rect.height, radius);
  ctx.clip();

  for (const img of mapEl.querySelectorAll('img.leaflet-tile')) {
    if (!img.complete || img.naturalWidth === 0) continue;
    const ir = img.getBoundingClientRect();
    ctx.globalAlpha = parseFloat(getComputedStyle(img).opacity) || 1;
    try { ctx.drawImage(img, ir.left - rect.left, ir.top - rect.top, ir.width, ir.height); }
    catch { /* cross-origin tile — skip */ }
  }
  ctx.globalAlpha = 1;

  for (const c of mapEl.querySelectorAll('canvas')) {
    const cr = c.getBoundingClientRect();
    try { ctx.drawImage(c, cr.left - rect.left, cr.top - rect.top, cr.width, cr.height); }
    catch { /* tainted — skip */ }
  }
  ctx.restore();
  return out;
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function flattenForCapture(doc) {
  doc.querySelectorAll('.save-fab, .scroll-hint, .nav').forEach(n => {
    n.style.setProperty('display', 'none', 'important');
  });
  const flatten = (n, color) => {
    n.style.setProperty('background', 'none', 'important');
    n.style.setProperty('background-image', 'none', 'important');
    n.style.setProperty('-webkit-background-clip', 'border-box', 'important');
    n.style.setProperty('background-clip', 'border-box', 'important');
    n.style.setProperty('color', color, 'important');
    n.style.setProperty('-webkit-text-fill-color', color, 'important');
  };
  // Big gradient numbers across slides
  doc.querySelectorAll('.big-num').forEach(n => flatten(n, '#ff5a36'));
  // .grad helper used on the upload hero
  doc.querySelectorAll('.grad').forEach(n => flatten(n, '#ff5a36'));
  // Inline `background-clip:text` spans (hero date range, etc.)
  doc.querySelectorAll('[style*="background-clip"]').forEach(n => flatten(n, '#ff5a36'));
  // The `km` / `小時` units inside .big-num should stay dim, not orange
  doc.querySelectorAll('.big-num .unit').forEach(n => {
    n.style.setProperty('color', '#9999a8', 'important');
    n.style.setProperty('-webkit-text-fill-color', '#9999a8', 'important');
  });
}

async function saveCurrentSlide() {
  if (typeof html2canvas === 'undefined') throw new Error('html2canvas 沒載入');
  const slides = document.querySelectorAll('.slide');
  const idx = currentSlideIndex();
  const slide = slides[idx];
  if (!slide) throw new Error('找不到卡片');

  const scale = IS_MOBILE ? 1.5 : 2;
  const canvas = await captureSlide(slide, scale);
  await downloadCanvas(canvas, `shield-review-${String(idx+1).padStart(2,'0')}.png`);
}

async function saveAllSlides() {
  if (typeof html2canvas === 'undefined') throw new Error('html2canvas 沒載入');
  if (typeof JSZip === 'undefined') throw new Error('JSZip 沒載入');
  const slides = Array.from(document.querySelectorAll('.slide:not(.no-save)'));
  if (slides.length === 0) throw new Error('沒有卡片');

  const scale = IS_MOBILE ? 1.5 : 2;
  const zip = new JSZip();
  for (let i = 0; i < slides.length; i++) {
    const c = await captureSlide(slides[i], scale);
    const blob = await new Promise((resolve, reject) =>
      c.toBlob(b => b ? resolve(b) : reject(new Error('轉 PNG 失敗')), 'image/png')
    );
    zip.file(`shield-review-${String(i + 1).padStart(2, '0')}.png`, blob);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, 'shield-review.zip');
}

function downloadCanvas(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('轉 PNG 失敗'));
      downloadBlob(blob, filename);
      resolve();
    }, 'image/png');
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

// ============ SLIDES ============

function slideHero(s) {
  const slide = el('section', 'slide tinted-1');
  const start = s.dateRange.start ? fmtDate(s.dateRange.start) : '';
  const end = s.dateRange.end ? fmtDate(s.dateRange.end) : '';
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">Shield · Review</div>
      <h2>你的<br><span style="background:linear-gradient(135deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent">${escapeHtml(start)} → ${escapeHtml(end)}</span><br>軌跡回顧</h2>
      <p class="sub">這份回顧涵蓋 ${s.dateRange.spanDays ?? '?'} 天，${s.trackCount} 條軌跡。</p>
    </div>
    <div class="scroll-hint">↓ 滑動看故事</div>
  `;
  return slide;
}

function slideDistance(s) {
  const slide = el('section', 'slide tinted-2');
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">總里程</div>
      <h2>你跑了</h2>
      <div class="big-num">${fmtKm(s.totalDistance)}<span class="unit">km</span></div>
      <p class="sub">大約等於 ${roundEarthFraction(s.totalDistance)}</p>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideTime(s) {
  const slide = el('section', 'slide tinted-3');
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">總時數</div>
      <h2>在路上</h2>
      <div class="big-num">${(s.totalDuration/3600).toFixed(0)}<span class="unit">小時</span></div>
      <p class="sub">扣掉停等：實際移動 ${fmtDuration(s.totalMovingTime)}</p>
      <div class="kv-row">
        <div class="kv"><div class="v">${(s.totalElevationGain/1000).toFixed(1)} km</div><div class="k">總爬升</div></div>
        <div class="kv"><div class="v">${(s.totalPoints/1000).toFixed(0)}k</div><div class="k">GPS 點數</div></div>
      </div>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideRides(s) {
  const slide = el('section', 'slide tinted-4');
  const streakRange = s.longestStreakRange
    ? `${fmtDate(s.longestStreakRange.start)} → ${fmtDate(s.longestStreakRange.end)}`
    : '';
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">出門次數</div>
      <h2>你出門了</h2>
      <div class="big-num">${s.trackCount}<span class="unit">趟</span></div>
      <div class="kv-row">
        <div class="kv"><div class="v">${s.daysActive}</div><div class="k">出門天數</div></div>
        <div class="kv"><div class="v">${s.longestStreak}</div><div class="k">連續紀錄</div></div>
      </div>
      <p class="sub">${streakRange ? `最長連續：${streakRange}` : ''}</p>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideHours(s) {
  const slide = el('section', 'slide tinted-5');
  const max = Math.max(...s.byHour);
  const cells = s.byHour.map((c, h) => {
    const ratio = max ? c / max : 0;
    const bg = `rgba(255, 90, 54, ${0.08 + ratio * 0.92})`;
    return `<div class="cell" style="background:${bg}" title="${h}:00 — ${c} 趟"></div>`;
  }).join('');
  const labels = Array.from({length:24}, (_,i)=>i)
    .map(i => i % 3 === 0 ? `<span>${i}</span>` : `<span></span>`)
    .join('');

  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">時間分布</div>
      <h2>你最常 <span style="color:var(--accent)">${String(s.peakHour).padStart(2,'0')}:00</span> 出門</h2>
      <div class="heatmap h24">${cells}</div>
      <div class="hour-labels">${labels}</div>
      <p class="sub">深色 = 那個鐘頭出發的趟數最多</p>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideDow(s) {
  const slide = el('section', 'slide tinted-2');
  const max = Math.max(...s.byDow);
  const bars = s.byDow.map((c, i) => {
    const h = max ? Math.round((c / max) * 100) : 0;
    return `
      <div class="day">
        <div class="bar"><div class="fill" style="height:${h}%"></div></div>
        <div class="lbl">週${s.labels.dow[i]}</div>
        <div class="v">${c}</div>
      </div>
    `;
  }).join('');
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">星期分布</div>
      <h2>最常出門的是<br><span style="color:var(--accent)">週${s.labels.dow[s.peakDow]}</span></h2>
      <div class="dow-bars">${bars}</div>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideMonths(s) {
  const slide = el('section', 'slide tinted-3');
  const months = Object.keys(s.byMonth).sort();
  const max = Math.max(...months.map(m => s.byMonth[m].distance), 1);
  const bars = months.map(m => {
    const data = s.byMonth[m];
    const h = Math.round((data.distance / max) * 100);
    const label = m.slice(2).replace('-', '/');
    return `
      <div class="bar" style="height:${h}%" title="${m}: ${fmtKmFull(data.distance)}">
        <div class="lbl">${label}</div>
      </div>
    `;
  }).join('');
  slide.innerHTML = `
    <div class="slide-inner bars-wrap">
      <div class="eyebrow">月度趨勢</div>
      <h2>每個月的里程</h2>
      <div class="bars">${bars}</div>
      <p class="sub">柱高 = 該月總公里數</p>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideFastest(s) {
  const slide = el('section', 'slide tinted-1');
  const t = s.fastestTrack;
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">最快一刻</div>
      <h2>最高速度</h2>
      <div class="big-num">${t.maxSpeed.toFixed(0)}<span class="unit">km/h</span></div>
      <p class="sub">${fmtDateTime(t.startTime)}</p>
      <div class="mini-map" id="mini-fast"></div>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideLongest(s) {
  const slide = el('section', 'slide tinted-2');
  const t = s.longestTrack;
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">最長一趟</div>
      <h2>單趟最遠</h2>
      <div class="big-num">${fmtKm(t.distance)}<span class="unit">km</span></div>
      <p class="sub">${fmtDateTime(t.startTime)} · 跑了 ${fmtDuration(t.duration)}</p>
      <div class="mini-map" id="mini-long"></div>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideEarlyLate(s) {
  const slide = el('section', 'slide tinted-4');
  const e = s.earliestRide, l = s.latestRide;
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">早起 vs 夜貓</div>
      <h2>你的一天</h2>
      <div class="kv-row">
        <div class="kv">
          <div class="v" style="color:var(--accent-3)">${fmtTimeOfDay(e.minutes)}</div>
          <div class="k">最早出門</div>
        </div>
        <div class="kv">
          <div class="v" style="color:var(--accent)">${fmtTimeOfDay(l.minutes)}</div>
          <div class="k">最晚出門</div>
        </div>
      </div>
      <p class="sub">最早：${fmtDate(e.time)} · 最晚：${fmtDate(l.time)}</p>
    </div>
    <div class="scroll-hint">↓</div>
  `;
  return slide;
}

function slideOutro(s) {
  const slide = el('section', 'slide tinted-1 no-save');
  slide.innerHTML = `
    <div class="slide-inner">
      <div class="eyebrow">下一站</div>
      <h2>看完整地圖</h2>
      <p class="sub" style="margin-bottom: 32px">把全部 ${s.trackCount} 條軌跡疊在一張地圖上</p>
      <div class="upload-actions" style="justify-content:center">
        <a href="./map.html" class="btn">前往地圖</a>
        <a href="./index.html" class="btn ghost">換一份資料</a>
      </div>
    </div>
  `;
  return slide;
}

// ============ Helpers ============

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function roundEarthFraction(meters) {
  const km = meters / 1000;
  if (km < 5) return `${(km * 1000).toFixed(0)} 公尺，是的⋯就這樣`;
  if (km < 42.195) return `${(km / 42.195 * 100).toFixed(0)}% 的全馬距離`;
  if (km < 100) return `${(km / 42.195).toFixed(1)} 個全馬`;
  if (km < 394) return `${(km / 394 * 100).toFixed(0)}% 從台北到墾丁`;
  if (km < 1100) return `${(km / 394).toFixed(1)} 趟台北–墾丁`;
  if (km < 40075) return `${(km / 40075 * 100).toFixed(1)}% 的地球周長`;
  return `${(km / 40075).toFixed(2)} 圈地球`;
}

function initMiniMap(id, track, color) {
  const elNode = document.getElementById(id);
  if (!elNode || !track || !track.polyline || track.polyline.length < 2) return;
  const map = L.map(elNode, {
    zoomControl: false, attributionControl: false,
    dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
    boxZoom: false, keyboard: false, tap: false, touchZoom: false,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    maxZoom: 18,
  }).addTo(map);
  const line = L.polyline(track.polyline, { color, weight: 4, opacity: 0.9 }).addTo(map);
  // Start/end markers
  const start = track.polyline[0];
  const end = track.polyline[track.polyline.length - 1];
  L.circleMarker(start, { radius: 5, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(map);
  L.circleMarker(end, { radius: 5, color: '#fff', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [20, 20] });
}

