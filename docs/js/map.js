// Map page: render all tracks on Leaflet with line/heat toggle and a sidebar list.

import { loadSession } from './storage.js';
import {
  computeSummary, fmtKm, fmtKmFull, fmtDuration, fmtDate, fmtDateTime,
} from './stats.js';

const empty = document.getElementById('empty');
const shell = document.getElementById('shell');
const summaryBox = document.getElementById('summary');
const trackListEl = document.getElementById('trackList');
const trackHeader = document.getElementById('trackHeader');
const toggles = document.querySelectorAll('.toggle');

let map, lineLayer, heatLayer, highlightLayer;
let mode = 'lines';
let tracks = [];
let activeIdx = -1;
let summary;

const IS_MOBILE =
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 700;

(async function init() {
  const session = await loadSession();
  if (!session || !session.tracks || session.tracks.length === 0) return;

  empty.remove();
  shell.style.display = 'flex';
  tracks = session.tracks;
  summary = session.meta?.summary || computeSummary(tracks);

  renderSummary(summary);
  renderTrackList(tracks);
  initMap(summary);
  bindToggles();
  addSavePosterFab();
})();

function renderSummary(s) {
  summaryBox.innerHTML = `
    <div class="item"><div class="v">${s.trackCount}</div><div class="k">趟數</div></div>
    <div class="item"><div class="v">${fmtKm(s.totalDistance)} km</div><div class="k">總里程</div></div>
    <div class="item"><div class="v">${fmtDuration(s.totalDuration)}</div><div class="k">總時數</div></div>
    <div class="item"><div class="v">${s.daysActive}</div><div class="k">出門天數</div></div>
  `;
}

function renderTrackList(tracks) {
  trackHeader.textContent = `軌跡（${tracks.length}）`;
  // Reverse so newest is on top
  const items = [...tracks].reverse();
  trackListEl.innerHTML = items.map((t, i) => {
    const realIdx = tracks.length - 1 - i;
    return `
      <div class="track-item" data-idx="${realIdx}">
        <div class="name">${escapeHtml(fmtDateTime(t.startTime))}</div>
        <div class="meta">${fmtKmFull(t.distance)} · ${fmtDuration(t.duration)} · 最高 ${t.maxSpeed.toFixed(0)} km/h</div>
      </div>
    `;
  }).join('');
  trackListEl.querySelectorAll('.track-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx, 10);
      focusTrack(idx);
    });
  });
}

function initMap(s) {
  map = L.map('leaflet-map', { preferCanvas: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OSM &copy; CARTO',
  }).addTo(map);

  drawLines();
  map.fitBounds([
    [s.bbox.minLat, s.bbox.minLon],
    [s.bbox.maxLat, s.bbox.maxLon],
  ], { padding: [30, 30] });
}

function drawLines() {
  if (lineLayer) { map.removeLayer(lineLayer); lineLayer = null; }
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

  lineLayer = L.layerGroup();
  tracks.forEach((t, idx) => {
    if (!t.polyline || t.polyline.length < 2) return;
    const line = L.polyline(t.polyline, {
      color: '#ff5a36', weight: 2, opacity: 0.55,
    });
    line.on('click', () => focusTrack(idx));
    line.addTo(lineLayer);
  });
  lineLayer.addTo(map);
}

function drawHeat() {
  if (lineLayer) { map.removeLayer(lineLayer); lineLayer = null; }
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

  const points = [];
  tracks.forEach(t => {
    if (!t.polyline) return;
    // For heat, take every nth so heatmap stays performant
    const stride = Math.max(1, Math.floor(t.polyline.length / 60));
    for (let i = 0; i < t.polyline.length; i += stride) {
      points.push([t.polyline[i][0], t.polyline[i][1], 0.3]);
    }
  });
  heatLayer = L.heatLayer(points, {
    radius: 18, blur: 22, maxZoom: 17,
    gradient: { 0.2: '#4dd0ff', 0.5: '#ffb84d', 0.8: '#ff5a36', 1.0: '#ff2b04' },
  }).addTo(map);
}

function focusTrack(idx) {
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
  const t = tracks[idx];
  if (!t || !t.polyline) return;

  const outer = L.polyline(t.polyline, { color: '#fff', weight: 5, opacity: 1 });
  const inner = L.polyline(t.polyline, { color: '#ff5a36', weight: 3, opacity: 1 });
  highlightLayer = L.layerGroup([outer, inner]).addTo(map);
  map.fitBounds(outer.getBounds(), { padding: [40, 40] });

  trackListEl.querySelectorAll('.track-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.idx, 10) === idx);
  });
  activeIdx = idx;
}

function bindToggles() {
  toggles.forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.mode;
      if (next === mode) return;
      toggles.forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      mode = next;
      if (mode === 'lines') drawLines();
      else drawHeat();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ============ SAVE POSTER ============

function addSavePosterFab() {
  const fab = document.createElement('div');
  fab.className = 'save-fab';
  fab.innerHTML = `
    <div class="toast"></div>
    <div class="menu">
      <button data-variant="landscape">🖥 橫式 16:9</button>
      <button data-variant="portrait-split">📱 直式・上文下圖</button>
      <button data-variant="portrait-fill">🌄 直式・地圖鋪滿</button>
    </div>
    <button class="main-btn" title="存總覽圖">🗺️</button>
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
    const variant = btn.dataset.variant;
    menu.querySelectorAll('button').forEach(b => b.disabled = true);
    showToast(toast, '產生總覽圖中⋯');
    try {
      await savePoster(variant);
      showToast(toast, '下載完成 ✓', 2000);
    } catch (err) {
      console.error(err);
      showToast(toast, `失敗：${err.message}`, 3500);
    } finally {
      menu.querySelectorAll('button').forEach(b => b.disabled = false);
    }
  });
}

function showToast(toast, msg, autohide = 0) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  if (autohide) toast._t = setTimeout(() => toast.classList.remove('show'), autohide);
}

async function savePoster(variant = 'landscape') {
  if (typeof html2canvas === 'undefined') throw new Error('html2canvas 沒載入');
  if (!summary) throw new Error('沒有資料');
  const s = summary;

  const hours = (s.totalMovingTime / 3600).toFixed(0);
  const maxSpeed = s.fastestTrack?.maxSpeed?.toFixed(0) ?? '—';
  const dateStart = s.dateRange.start ? fmtDate(s.dateRange.start) : '';
  const dateEnd = s.dateRange.end ? fmtDate(s.dateRange.end) : '';

  const brandRow = `
    <div class="brand-row">
      <div class="brand">Shield<span>·</span>Review</div>
      <div class="date-range">${escapeHtml(dateStart)} → ${escapeHtml(dateEnd)}</div>
    </div>`;
  const title = `<h1>你的<span class="dim">軌跡</span>總覽</h1>`;
  const statsBlock = `
    <div class="poster-stats">
      <div class="stat"><div class="v">${fmtKm(s.totalDistance)}<span class="unit">km</span></div><div class="k">總里程</div></div>
      <div class="stat"><div class="v">${s.trackCount}</div><div class="k">趟數</div></div>
      <div class="stat"><div class="v">${hours}<span class="unit">hr</span></div><div class="k">移動時間</div></div>
      <div class="stat"><div class="v">${s.daysActive}</div><div class="k">出門天數</div></div>
      <div class="stat"><div class="v">${maxSpeed}<span class="unit">km/h</span></div><div class="k">最高速度</div></div>
    </div>`;
  const footer = `<div class="poster-footer">shield · review · ${s.trackCount} 條軌跡・${s.dateRange.spanDays ?? '?'} 天</div>`;

  const poster = document.createElement('div');
  poster.className = `poster ${variant}`;
  if (variant === 'landscape') {
    poster.innerHTML = `
      <div class="poster-left">
        <div class="poster-head">${brandRow}${title}</div>
        ${statsBlock}
        ${footer}
      </div>
      <div class="poster-map"></div>
    `;
  } else if (variant === 'portrait-split') {
    poster.innerHTML = `
      <div class="poster-top">
        <div class="poster-head">${brandRow}${title}</div>
        ${statsBlock}
      </div>
      <div class="poster-map"></div>
      ${footer}
    `;
  } else if (variant === 'portrait-fill') {
    poster.innerHTML = `
      <div class="poster-map"></div>
      <div class="poster-overlay">
        ${brandRow}
        ${title}
        ${statsBlock}
        ${footer}
      </div>
    `;
  } else {
    throw new Error(`unknown variant: ${variant}`);
  }
  document.body.appendChild(poster);

  // Build a fresh Leaflet map inside the poster so we don't disturb the live
  // one. crossOrigin: 'anonymous' is required for html2canvas to read the
  // CARTO tiles without tainting the rasterised canvas.
  const mapEl = poster.querySelector('.poster-map');
  const pmap = L.map(mapEl, {
    zoomControl: false, attributionControl: false,
    dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
    boxZoom: false, keyboard: false, tap: false, touchZoom: false,
    preferCanvas: true,
    zoomSnap: 0.25,
  });
  const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: 'anonymous',
  }).addTo(pmap);
  tracks.forEach(t => {
    if (!t.polyline || t.polyline.length < 2) return;
    L.polyline(t.polyline, { color: '#ff5a36', weight: 2, opacity: 0.65 }).addTo(pmap);
  });
  // Keep the crop tight against the track bbox. Landscape and portrait-split
  // have framing / padding from the layout itself; portrait-fill is edge-to-edge
  // so extra padding here just adds dead sea around the tracks.
  const fitPadding = variant === 'portrait-fill' ? [6, 6]
                   : variant === 'portrait-split' ? [16, 16]
                   : [30, 30];
  pmap.fitBounds([[s.bbox.minLat, s.bbox.minLon], [s.bbox.maxLat, s.bbox.maxLon]], { padding: fitPadding });

  try {
    await waitForTiles(tileLayer);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 300)));

    const scale = IS_MOBILE ? 1.5 : 2;

    // html2canvas 1.4.1 mis-handles Leaflet's translate3d tile positioning, so
    // tile images vanish from the capture (polylines are fine — they're on a
    // <canvas>). We render the map ourselves via getBoundingClientRect (which
    // sees post-transform positions) and stamp it onto the html2canvas output.
    const mapCanvas = renderLeafletToCanvas(mapEl, scale);
    const isFill = variant === 'portrait-fill';
    const mapRect = mapEl.getBoundingClientRect();
    const posterRect = poster.getBoundingClientRect();
    const mapX = Math.round((mapRect.left - posterRect.left) * scale);
    const mapY = Math.round((mapRect.top - posterRect.top) * scale);

    let finalCanvas;
    if (isFill) {
      // html2canvas on the whole .poster (position: fixed, off-screen) refused
      // to render the absolutely-positioned overlay — the fill export came out
      // with a full map but zero text. Capturing just the overlay element is
      // simpler and sidesteps any stacking / transparency issues.
      const overlay = poster.querySelector('.poster-overlay');
      const overlayCanvas = await html2canvas(overlay, {
        backgroundColor: null,
        scale, useCORS: true, allowTaint: false, logging: false,
      });
      const overlayRect = overlay.getBoundingClientRect();
      const ox = Math.round((overlayRect.left - posterRect.left) * scale);
      const oy = Math.round((overlayRect.top  - posterRect.top)  * scale);

      finalCanvas = document.createElement('canvas');
      finalCanvas.width  = Math.round(posterRect.width  * scale);
      finalCanvas.height = Math.round(posterRect.height * scale);
      const fctx = finalCanvas.getContext('2d');
      fctx.fillStyle = '#0a0a0f';
      fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
      fctx.drawImage(mapCanvas, mapX, mapY);
      fctx.drawImage(overlayCanvas, ox, oy);
    } else {
      const posterCanvas = await html2canvas(poster, {
        backgroundColor: '#0a0a0f',
        scale, useCORS: true, allowTaint: false, logging: false,
      });
      posterCanvas.getContext('2d').drawImage(mapCanvas, mapX, mapY);
      finalCanvas = posterCanvas;
    }

    const fname = variant === 'landscape' ? 'shield-review-overview.png'
                : variant === 'portrait-split' ? 'shield-review-overview-portrait.png'
                : 'shield-review-overview-fill.png';
    await downloadCanvas(finalCanvas, fname);
  } finally {
    pmap.remove();
    poster.remove();
  }
}

// Draw Leaflet's tiles + vector canvas onto a fresh canvas by reading each
// element's post-transform position via getBoundingClientRect. Bypasses
// html2canvas's translate3d blind spot.
function renderLeafletToCanvas(mapEl, scale) {
  const rect = mapEl.getBoundingClientRect();
  const out = document.createElement('canvas');
  out.width = Math.round(rect.width * scale);
  out.height = Math.round(rect.height * scale);
  const ctx = out.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Clip to rounded map frame so tiles don't overflow the rounded corners
  const radius = 16;
  ctx.save();
  roundedRectPath(ctx, 0, 0, rect.width, rect.height, radius);
  ctx.clip();

  for (const img of mapEl.querySelectorAll('img.leaflet-tile')) {
    if (!img.complete || img.naturalWidth === 0) continue;
    const ir = img.getBoundingClientRect();
    ctx.globalAlpha = parseFloat(getComputedStyle(img).opacity) || 1;
    try {
      ctx.drawImage(img, ir.left - rect.left, ir.top - rect.top, ir.width, ir.height);
    } catch { /* cross-origin tile — skip */ }
  }
  ctx.globalAlpha = 1;

  for (const c of mapEl.querySelectorAll('canvas')) {
    const cr = c.getBoundingClientRect();
    try {
      ctx.drawImage(c, cr.left - rect.left, cr.top - rect.top, cr.width, cr.height);
    } catch { /* tainted — skip */ }
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

function waitForTiles(tileLayer) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    tileLayer.once('load', finish);
    // Safety net: if offline or CORS blocks tiles, don't hang forever.
    setTimeout(finish, 6000);
  });
}

function downloadCanvas(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('轉 PNG 失敗'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 800);
    }, 'image/png');
  });
}
