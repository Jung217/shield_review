// Wrap JSZip + GPX parser. Yields parsed tracks with progress callbacks.
// JSZip is loaded globally via <script> in index.html.

import { parseGPX } from './gpx-parser.js';

export async function loadZipFromBlob(blob, onProgress) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip 沒載入');
  const zip = await JSZip.loadAsync(blob);
  const gpxEntries = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (!path.toLowerCase().endsWith('.gpx')) return;
    if (path.split('/').some(seg => seg.startsWith('.') || seg === '__MACOSX')) return;
    gpxEntries.push({ path, entry });
  });

  if (gpxEntries.length === 0) throw new Error('壓縮檔內找不到 .gpx');

  const tracks = [];
  let done = 0;
  const total = gpxEntries.length;

  // Parse sequentially to keep memory bounded; 369 files × ~775KB → ~280MB if
  // held in raw text simultaneously. Sequential parse + immediate discard keeps
  // peak well under that. Yield to the event loop every N files so the UI updates.
  const YIELD_EVERY = 5;
  for (const { path, entry } of gpxEntries) {
    try {
      const text = await entry.async('string');
      const filename = path.split('/').pop();
      const track = parseGPX(text, filename);
      if (track) tracks.push(track);
    } catch (e) {
      console.warn(`Skipping ${path}:`, e.message);
    }
    done++;
    if (onProgress) onProgress(done, total, path);
    if (done % YIELD_EVERY === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Sort by startTime so list/dashboard always shows chronological order
  tracks.sort((a, b) => {
    const ta = a.startTime ? new Date(a.startTime) : 0;
    const tb = b.startTime ? new Date(b.startTime) : 0;
    return ta - tb;
  });

  return tracks;
}

export async function loadZipFromUrl(url, onProgress) {
  if (onProgress) onProgress(0, 1, '下載示範資料⋯');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載失敗：${res.status}`);
  const blob = await res.blob();
  return loadZipFromBlob(blob, onProgress);
}
