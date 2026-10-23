// Dion Jingles — content script (изолированный мир).
// Принимает команды popup, играет джингл локально (ведущий слышит всегда) и
// передаёт звук в page.js (мир страницы), который подмешивает его в микрофон dion.
// Связь с page.js — только CustomEvent на document.

(function () {
  'use strict';

  const LOG = '[DionJingles]';

  let audioContext = null;
  let webrtcEnabled = true;
  const dataUrlCache = new Map(); // soundType -> data:audio/mpeg;base64,... | null (mp3 нет)
  const localBufferCache = new Map(); // soundType -> AudioBuffer
  const currentSounds = new Map(); // soundType -> AudioBufferSourceNode (локально)

  function ensureAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  // --- Состояние «Встраивание в WebRTC» → page.js ---

  function sendEnabledToPage() {
    document.dispatchEvent(new CustomEvent('__dionJinglesSetEnabled', {
      detail: { enabled: webrtcEnabled }
    }));
  }

  function setWebRTCEnabled(enabled) {
    webrtcEnabled = enabled !== false;
    sendEnabledToPage();
  }

  try {
    chrome.storage.local.get(['webrtcEnabled'], (result) => {
      setWebRTCEnabled(result && result.webrtcEnabled !== undefined ? result.webrtcEnabled : true);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.webrtcEnabled) {
        setWebRTCEnabled(changes.webrtcEnabled.newValue);
      }
    });
  } catch (e) {
    console.warn(LOG, 'chrome.storage недоступен:', e);
  }

  // page.js загрузился и просит состояние.
  document.addEventListener('__dionJinglesHello', sendEnabledToPage);

  // --- Синтез звука (если mp3 нет) ---

  function generateBuffer(ctx, soundType) {
    const duration = 0.5;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * duration);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      switch (soundType) {
        case 'applause':
          d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2) * 0.3;
          break;
        case 'error':
          d[i] = Math.sin(2 * Math.PI * (200 + Math.sin(t * 20) * 50) * t) * Math.exp(-t * 3) * 0.4;
          break;
        case 'success':
          d[i] = Math.sin(2 * Math.PI * (400 + t * 200) * t) * Math.exp(-t * 2) * 0.3;
          break;
        case 'notification':
          d[i] = Math.sin(2 * Math.PI * 800 * t) * Math.exp(-t * 5) * 0.3;
          break;
        default:
          d[i] = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-t * 3) * 0.3;
      }
    }
    return buf;
  }

  async function fetchSound(soundType) {
    const response = await fetch(chrome.runtime.getURL(`sounds/${soundType}.mp3`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  // --- Локальное воспроизведение ---

  async function playLocal(soundType) {
    const ctx = ensureAudioContext();
    let buffer = localBufferCache.get(soundType);
    if (!buffer) {
      try {
        buffer = await ctx.decodeAudioData(await fetchSound(soundType));
      } catch (e) {
        buffer = generateBuffer(ctx, soundType);
      }
      localBufferCache.set(soundType, buffer);
    }
    const previous = currentSounds.get(soundType);
    if (previous) {
      try { previous.stop(); } catch (e) { /* уже закончился */ }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (currentSounds.get(soundType) === source) currentSounds.delete(soundType);
    };
    currentSounds.set(soundType, source);
    source.start(0);
  }

  // --- Отправка в мир страницы ---

  async function getSoundDataUrl(soundType) {
    if (dataUrlCache.has(soundType)) {
      const cached = dataUrlCache.get(soundType);
      if (cached === null) throw new Error(`sounds/${soundType}.mp3 нет`);
      return cached;
    }
    let bytes;
    try {
      bytes = new Uint8Array(await fetchSound(soundType));
    } catch (e) {
      dataUrlCache.set(soundType, null); // mp3 нет — дальше сразу синтез, без fetch
      throw e;
    }
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    const dataUrl = `data:audio/mpeg;base64,${btoa(binary)}`;
    dataUrlCache.set(soundType, dataUrl);
    return dataUrl;
  }

  async function dispatchSoundToPageContext(soundType) {
    if (!webrtcEnabled) return;
    try {
      const soundDataUrl = await getSoundDataUrl(soundType);
      document.dispatchEvent(new CustomEvent('__dionJinglesPlayWithUrl', {
        detail: { soundDataUrl, soundType }
      }));
    } catch (e) {
      document.dispatchEvent(new CustomEvent('__dionJinglesPlayGenerated', {
        detail: { soundType }
      }));
    }
  }

  function playSound(soundType) {
    if (!soundType) return;
    playLocal(soundType).catch((e) => console.warn(LOG, 'Локальное воспроизведение не удалось:', e));
    dispatchSoundToPageContext(soundType);
  }

  // --- Состояние эфира от page.js ---
  // disabled / no-mixer / muted / on-air; нет ответа — unknown (popup не предупреждает).

  const AIR_TIMEOUT_MS = 300;
  let airQuerySeq = 0;

  function queryAirState() {
    return new Promise((resolve) => {
      const id = `${Date.now()}-${++airQuerySeq}`;
      let timer = null;
      const onState = (ev) => {
        const det = ev.detail || {};
        if (det.id !== id) return;
        finish(typeof det.air === 'string' ? det.air : 'unknown');
      };
      const finish = (air) => {
        clearTimeout(timer);
        document.removeEventListener('__dionJinglesAirState', onState);
        resolve(air);
      };
      document.addEventListener('__dionJinglesAirState', onState);
      timer = setTimeout(() => finish('unknown'), AIR_TIMEOUT_MS);
      try {
        document.dispatchEvent(new CustomEvent('__dionJinglesQueryAir', { detail: { id } }));
      } catch (e) {
        finish('unknown');
      }
    });
  }

  // --- Команды ---

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'playSound') {
      playSound(request.soundType);
      queryAirState()
        .then((air) => sendResponse({ success: true, air }))
        .catch(() => sendResponse({ success: true, air: 'unknown' }));
      return true; // ответ асинхронный
    } else if (request.action === 'toggleWebRTC') {
      setWebRTCEnabled(request.enabled);
      sendResponse({ success: true, enabled: webrtcEnabled });
    }
    return false;
  });

  // window.dionJingles.play(type) из консоли страницы.
  document.addEventListener('__dionJinglesRequestPlay', (ev) => {
    const soundType = ev.detail && ev.detail.soundType;
    if (typeof soundType === 'string') playSound(soundType);
  });

  console.log(LOG, 'Content script загружен');
})();
