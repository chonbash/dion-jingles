// Слушатель dion.vc: входит в комнату гостем и пишет входящий звук.
// Результаты в /out: levels.json (RMS каждые 50 мс), incoming.webm, скриншоты шагов.
// Переменные окружения: ROOM_URL, GUEST_NAME, LISTEN_SECONDS.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ROOM_URL = process.env.ROOM_URL || 'https://dion.vc/event/dvzhdanov-1';
const GUEST_NAME = process.env.GUEST_NAME || 'Слушатель (Claude)';
const LISTEN_SECONDS = Number(process.env.LISTEN_SECONDS || 90);
const OUT = '/out';
mkdirSync(OUT, { recursive: true });

// Тишина 1 с, 48 кГц моно — «виртуальный микрофон».
function silenceWav(path) {
  const sr = 48000, n = sr;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  writeFileSync(path, buf);
}
silenceWav('/tmp/silence.wav');

let step = 0;
async function shot(page, name) {
  const file = `${OUT}/${String(++step).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file }).catch(() => {});
  console.log('[listener] скриншот', file);
}

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=/tmp/silence.wav',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  locale: 'ru-RU',
  // dion отказывает «HeadlessChrome» как неподдерживаемому браузеру.
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  permissions: ['microphone', 'camera'],
});
const page = await context.newPage();
page.on('console', (m) => { if (/error/i.test(m.type())) console.log('[page]', m.text().slice(0, 200)); });

await page.goto(ROOM_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await shot(page, 'opened');

// Гостевой вход: заполняем видимые текстовые поля именем и жмём кнопку входа.
for (let attempt = 0; attempt < 6; attempt++) {
  const joined = await page.evaluate(() =>
    [...document.querySelectorAll('audio')].some((a) => a.srcObject && a.srcObject.getAudioTracks().length));
  if (joined) break;
  const inputs = page.locator('input[type="text"]:visible, input:not([type]):visible');
  for (let i = 0; i < await inputs.count(); i++) {
    const el = inputs.nth(i);
    if (!(await el.inputValue())) await el.fill(GUEST_NAME).catch(() => {});
  }
  const btn = page.getByRole('button', { name: /войти|присоединиться|продолжить|как гость|гост/i }).first();
  if (await btn.count()) {
    console.log('[listener] нажимаю:', (await btn.innerText().catch(() => '?')).trim());
    await btn.click().catch((e) => console.log('[listener] клик не удался', e.message));
  } else {
    console.log('[listener] кнопка входа не найдена');
  }
  await page.waitForTimeout(5000);
  await shot(page, `join-${attempt}`);
}

// «Виртуальный динамик»: RMS входящего звука и запись в webm.
const started = await page.evaluate(() => {
  const el = [...document.querySelectorAll('audio')].find((a) => a.srcObject && a.srcObject.getAudioTracks().length);
  if (!el) return false;
  const c = new AudioContext();
  const an = c.createAnalyser(); an.fftSize = 2048;
  c.createMediaStreamSource(el.srcObject).connect(an);
  const buf = new Float32Array(an.fftSize);
  window.__levels = [];
  const t0 = performance.now();
  setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let s = 0; for (const v of buf) s += v * v;
    window.__levels.push([Math.round(performance.now() - t0), Math.sqrt(s / buf.length)]);
  }, 50);
  window.__chunks = [];
  const rec = new MediaRecorder(el.srcObject, { mimeType: 'audio/webm' });
  rec.ondataavailable = (e) => window.__chunks.push(e.data);
  rec.start(1000);
  window.__rec = rec;
  window.__startedAt = Date.now();
  return true;
});
if (!started) {
  console.log('[listener] ВХОД НЕ УДАЛСЯ: нет входящего аудио');
  await shot(page, 'failed');
  await browser.close();
  process.exit(2);
}
const startedAt = await page.evaluate(() => window.__startedAt);
console.log('[listener] СЛУШАЮ с', new Date(startedAt).toISOString(), 'секунд:', LISTEN_SECONDS);
writeFileSync(`${OUT}/started.txt`, String(startedAt));
await shot(page, 'listening');

await page.waitForTimeout(LISTEN_SECONDS * 1000);

const levels = await page.evaluate(() => window.__levels);
writeFileSync(`${OUT}/levels.json`, JSON.stringify({ startedAt, levels }));
const b64 = await page.evaluate(async () => {
  window.__rec.stop();
  await new Promise((r) => setTimeout(r, 1200));
  const blob = new Blob(window.__chunks, { type: 'audio/webm' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
});
writeFileSync(`${OUT}/incoming.webm`, Buffer.from(b64, 'base64'));
console.log('[listener] готово: levels.json, incoming.webm');
await browser.close();
