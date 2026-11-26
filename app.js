/* Charley's Label Sheet — Amazon label + invoice → one A4 page (2 × A5), named from the invoice. */
'use strict';

const A4W = 595.28, A4H = 841.89;
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

/* ---------- PDF: two pages per A4, each rotated into an A5 half ---------- */
async function makeTwoUp(bytes) {
  const { PDFDocument, degrees } = PDFLib;
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  out.setTitle("Charley's Trading Co. — label sheet");
  const embedded = await out.embedPages(src.getPages());
  for (let i = 0; i < embedded.length; i += 2) {
    const sheet = out.addPage([A4W, A4H]);
    embedded.slice(i, i + 2).forEach((pg, slot) => {
      const pw = pg.width, ph = pg.height;
      const s = Math.min(A4W / ph, (A4H / 2) / pw);
      const boxY = slot === 0 ? A4H / 2 : 0;              // first page (label) on top
      const dx = (A4W - ph * s) / 2;
      const dy = boxY + (A4H / 2 - pw * s) / 2;
      sheet.drawPage(pg, { x: dx + ph * s, y: dy, xScale: s, yScale: s, rotate: degrees(90) });
    });
  }
  return { bytes: await out.save(), pages: src.getPageCount(), sheets: out.getPageCount() };
}

/* ---------- File name from the invoice ---------- */
async function getPdfText(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    text += ' ' + tc.items.map(it => it.str).join(' ');
  }
  return text.replace(/\s+/g, ' ');
}

// Invoice rows: "1 <title> | <ASIN> ( <SKU> ) HSN:63025900 ₹507.63 1 ₹507.63 ..."
function parseItems(text) {
  const items = [];
  for (const b of text.split(/Total\s*Amount/i).slice(1)) {
    const table = b.split(/TOTAL\s*:/)[0];
    const row = /(?:^|\s)\d{1,3}\s+(.+?)\s*\|\s*[A-Z0-9]{10}\b.*?(?:₹|Rs\.?)\s*[\d,]+\.\d{2}\s+(\d+)\s+(?:₹|Rs\.?)/g;
    let m;
    while ((m = row.exec(table))) items.push({ title: m[1].trim(), qty: parseInt(m[2], 10) || 1 });
  }
  return items;
}

// "Christmas Table Runner, White Embroidered Reindeer with Lace Edge, ..." -> "Runner Reindeer White"
const COLOURS = new Set(('white black red green blue yellow pink purple orange brown grey gray gold golden silver ' +
  'beige cream ivory maroon navy teal turquoise multicolor multicolour multi off-white rose peach mustard olive ' +
  'lavender magenta violet copper bronze tan khaki natural transparent clear').split(' '));
function shortName(title) {
  const parts = title.split(/\s*[,|(]\s*|\s+-\s+|\s+–\s+/).map(s => s.trim()).filter(Boolean);
  const words = s => s.split(/\s+/).filter(Boolean);
  const first = words(parts[0] || title);
  const out = [first[first.length - 1]];
  let detail = (parts[1] || '').split(/\s+(?:with|for|and)\s+/i)[0].trim();
  if (/\d/.test(detail)) detail = '';
  const dw = words(detail);
  const colours = [...first, ...dw].filter(w => COLOURS.has(w.toLowerCase()));
  const design = dw.filter(w => !COLOURS.has(w.toLowerCase())).pop();
  if (design) out.push(design);
  for (const c of colours) if (!out.includes(c)) out.push(c);
  return out.join(' ');
}

function nameFromItems(items) {
  if (!items.length) return null;
  const first = items[0];
  let name = (first.qty > 1 ? first.qty + ' x ' : '') + shortName(first.title);
  const rest = items.slice(1).reduce((n, it) => n + it.qty, 0);
  if (rest > 0) name += ' + ' + rest + ' more';
  return name;
}

function cleanFileName(s) {
  s = (s || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return (s || 'Amazon label') + '.pdf';
}

/* ---------- UI ---------- */
const $ = id => document.getElementById(id);
let current = null;      // { bytes, sourceName }
let downloadUrl = null;
let runId = 0;

function show(which) {
  for (const id of ['start', 'working', 'result']) $(id).hidden = id !== which;
  $('help').hidden = which === 'result';
}
function setProgress(p) { $('workBar').style.width = p + '%'; $('workPct').textContent = p + '%'; }
function msg(el, text) { el.textContent = text || ''; el.hidden = !text; }
function fmtSize(n) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + 'KB' : (n / 1048576).toFixed(1) + 'MB'; }
const tick = () => new Promise(r => setTimeout(r, 120));

async function handleFile(file) {
  const id = ++runId;
  $('workName').textContent = file.name || 'Amazon label.pdf';
  $('workTitle').textContent = 'Making your A4 sheet.';
  $('workRow').classList.remove('failed');
  $('workBarRow').hidden = false; $('workFail').hidden = true; $('retry').hidden = true;
  setProgress(5); show('working');
  try {
    const buf = await file.arrayBuffer();
    setProgress(25); await tick();
    let itemName = null;
    try { itemName = nameFromItems(parseItems(await getPdfText(buf.slice(0)))); } catch (_) {}
    if (id !== runId) return;
    setProgress(60); await tick();
    const r = await makeTwoUp(buf);
    if (id !== runId) return;
    setProgress(90);
    current = { bytes: r.bytes };
    $('fname').value = itemName || ((file.name || 'Amazon label').replace(/\.pdf$/i, '') + ' A4');
    $('resMeta').textContent = fmtSize(r.bytes.length) + ' · ' + r.pages + ' pages → ' +
      (r.sheets === 1 ? '1 A4 page' : r.sheets + ' A4 pages') + (itemName ? ' · named from invoice' : '');
    $('pageTag').textContent = 'A4 · Page 1/' + r.sheets;
    updateDownload();
    msg($('resultMsg'), '');
    await renderPreview(r.bytes);
    if (id !== runId) return;
    setProgress(100); await tick();
    show('result');
  } catch (e) {
    if (id !== runId) return;
    $('workRow').classList.add('failed');
    $('workTitle').textContent = "Couldn't read that file.";
    $('workBarRow').hidden = true; $('workFail').hidden = false; $('retry').hidden = false;
  }
}

async function renderPreview(bytes) {
  try {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, (Math.min(window.innerWidth, 480) * (window.devicePixelRatio || 1)) / base.width);
    const vp = page.getViewport({ scale });
    const c = $('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  } catch (_) { /* preview is optional */ }
}

function currentFile() {
  return new File([current.bytes], cleanFileName($('fname').value), { type: 'application/pdf' });
}

function updateDownload() {
  if (!current) return;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([current.bytes], { type: 'application/pdf' }));
  $('download').href = downloadUrl;
  $('download').download = cleanFileName($('fname').value);
}
$('fname').addEventListener('input', updateDownload);
$('fname').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

$('share').addEventListener('click', async () => {
  if (!current) return;
  const file = currentFile();
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
    msg($('resultMsg'), "This browser can't share files. Tap Download, then send it from WhatsApp.");
    return;
  }
  try {
    await navigator.share({ files: [file], title: file.name });
    msg($('resultMsg'), '');
  } catch (e) {
    if (e && e.name === 'AbortError') return;     // share menu closed
    msg($('resultMsg'), "Sharing didn't work. Tap Download, then send it from WhatsApp.");
  }
});

function reset() { runId++; current = null; $('file').value = ''; show('start'); }
$('again').addEventListener('click', reset);
$('again2').addEventListener('click', reset);
$('cancel').addEventListener('click', reset);
$('retry').addEventListener('click', () => { reset(); $('file').click(); });

$('file').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) handleFile(f);
});

// Drag and drop (desktop)
const zone = $('zone');
['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(t => zone.addEventListener(t, () => zone.classList.remove('drag')));
zone.addEventListener('drop', e => {
  e.preventDefault();
  const f = [...(e.dataTransfer?.files || [])].find(x => /pdf$/i.test(x.type) || /\.pdf$/i.test(x.name));
  if (f) handleFile(f);
});

/* ---------- PDF shared from another app (Android Share menu) ---------- */
async function loadShared() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('charleys-shared');
    const res = await cache.match('shared.pdf');
    if (!res) return;
    const name = decodeURIComponent(res.headers.get('x-file-name') || 'Amazon label.pdf');
    const blob = await res.blob();
    await cache.delete('shared.pdf');
    await handleFile(new File([blob], name, { type: 'application/pdf' }));
  } catch (_) { /* stay on the pick screen */ }
}

/* ---------- Install + offline ---------- */
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; $('install').hidden = false; });
$('install').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null; $('install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
loadShared();

// exposed for testing
window.__labelSheet = { makeTwoUp, parseItems, nameFromItems, shortName, cleanFileName, getPdfText };
