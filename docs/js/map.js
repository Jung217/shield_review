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

(async function init() {
  const session = await loadSession();
  if (!session || !session.tracks || session.tracks.length === 0) return;

  empty.remove();
  shell.style.display = 'flex';
  tracks = session.tracks;
  const s = session.meta?.summary || computeSummary(tracks);

  renderSummary(s);
  renderTrackList(tracks);
  initMap(s);
  bindToggles();
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
