// Upload page orchestrator: handles drag/drop, file picker, demo loader,
// then runs zip → parse → stats → IndexedDB → redirect.

import { loadZipFromBlob, loadZipFromUrl } from './zip-loader.js';
import { computeSummary } from './stats.js';
import { saveSession } from './storage.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const demoBtn = document.getElementById('demoBtn');
const progress = document.getElementById('progress');
const pLabel = document.getElementById('pLabel');
const pFill = document.getElementById('pFill');
const pCount = document.getElementById('pCount');

let busy = false;

// ---- Drag & drop ----
['dragenter', 'dragover'].forEach(ev => {
  dropzone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.add('drag');
  });
});
['dragleave', 'drop'].forEach(ev => {
  dropzone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.remove('drag');
  });
});
dropzone.addEventListener('drop', e => {
  if (busy) return;
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

// ---- File picker ----
fileInput.addEventListener('change', e => {
  if (busy) return;
  const file = e.target.files?.[0];
  if (file) handleFile(file);
});

// ---- Demo ----
demoBtn.addEventListener('click', () => {
  if (busy) return;
  handleDemo();
});

// ---- Pipeline ----
async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    alert('請選擇 .zip 檔');
    return;
  }
  await runPipeline(
    onP => loadZipFromBlob(file, onP),
    file.name,
  );
}

async function handleDemo() {
  await runPipeline(
    onP => loadZipFromUrl('./demo.zip', onP),
    'demo.zip',
  );
}

async function runPipeline(loaderFactory, sourceName) {
  busy = true;
  setBusy(true);
  showProgress('解壓中⋯', 0, 0);
  try {
    const tracks = await loaderFactory((done, total, lastPath) => {
      const pct = total > 0 ? (done / total) : 0;
      const filename = lastPath ? lastPath.split('/').pop() : '';
      showProgress(`解析 ${filename || ''}`, pct, `${done} / ${total}`);
    });

    showProgress('計算統計⋯', 1, '');
    const summary = computeSummary(tracks);
    await saveSession(tracks, { source: sourceName, summary });

    showProgress('完成 — 跳轉到回顧⋯', 1, `${tracks.length} 條軌跡`);
    setTimeout(() => { location.href = './dashboard.html'; }, 400);
  } catch (e) {
    console.error(e);
    showProgress(`錯誤：${e.message}`, 0, '');
    busy = false;
    setBusy(false);
  }
}

function showProgress(label, ratio, count) {
  progress.classList.add('active');
  pLabel.textContent = label;
  pFill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  pCount.textContent = count || '';
}

function setBusy(b) {
  fileInput.disabled = b;
  demoBtn.disabled = b;
}
