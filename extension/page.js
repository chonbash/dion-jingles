// Dion Jingles — код в мире страницы (content_scripts, world: MAIN, document_start).
// Перехватываем только navigator.mediaDevices.getUserMedia: dion получает смешанный
// аудиотрек «микрофон + джинглы». RTCPeerConnection и SDP не трогаем — dion сам
// отправляет то, что ему вернул getUserMedia, а его мьют глушит и джинглы.
// Единственная точка вмешательства в страницу — window.dionJingles.

(function () {
  'use strict';

  if (window.dionJingles) return;

  var LOG = '[DionJingles]';
  var RESUME_TIMEOUT_MS = 300;

  var AC = window.AudioContext || window.webkitAudioContext;
  var md = navigator.mediaDevices;
  var MDProto = window.MediaDevices && window.MediaDevices.prototype;
  var originalGetUserMedia = MDProto && MDProto.getUserMedia;

  var ctx = null;        // общий AudioContext всех микшеров
  var jinglesBus = null; // GainNode, куда играют джинглы; подключён ко всем микшерам
  var enabled = true;    // «Встраивание в WebRTC» из popup
  var mixers = new Set();
  var buffers = new Map(); // soundType -> AudioBuffer (декодированный mp3)
  var mixerSeq = 0;

  function ensureContext() {
    if (ctx && ctx.state === 'closed') {
      ctx = null;
      jinglesBus = null;
    }
    if (!ctx) {
      ctx = new AC();
      jinglesBus = ctx.createGain();
      jinglesBus.gain.value = enabled ? 1 : 0;
    }
    return ctx;
  }

  // AudioContext может остаться suspended (политика автозапуска) — тогда смешанный
  // трек молчал бы вместе с голосом. Ждём resume() недолго.
  function waitRunning(c) {
    if (c.state === 'running') return Promise.resolve(true);
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        resolve(c.state === 'running');
      };
      setTimeout(finish, RESUME_TIMEOUT_MS);
      try {
        c.resume().then(finish, finish);
      } catch (e) {
        finish();
      }
    });
  }

  function liveMixers() {
    var out = [];
    mixers.forEach(function (m) {
      if (m.micTrack.readyState === 'live' && m.mixedTrack.readyState === 'live') out.push(m);
    });
    return out;
  }

  function destroyMixer(m) {
    if (!mixers.has(m)) return;
    mixers.delete(m);
    try { m.micSource.disconnect(); } catch (e) { /* уже отключён */ }
    try { jinglesBus && jinglesBus.disconnect(m.destination); } catch (e) { /* уже отключён */ }
  }

  function proxyToMic(mixedTrack, micTrack, name) {
    if (typeof micTrack[name] !== 'function') return;
    Object.defineProperty(mixedTrack, name, {
      configurable: true,
      writable: true,
      value: function () {
        return micTrack[name].apply(micTrack, arguments);
      }
    });
  }

  // Строит смешанный поток для одного результата getUserMedia.
  // Возвращает null, если смешивать нельзя — тогда отдаём исходный поток.
  function buildMixedStream(stream) {
    var micTrack = stream.getAudioTracks()[0];
    if (!micTrack || micTrack.readyState !== 'live') return Promise.resolve(null);
    var c = ensureContext();
    return waitRunning(c).then(function (running) {
      if (!running) {
        console.warn(LOG, 'AudioContext не запущен (' + c.state + ') — отдаём исходный поток без джинглов');
        return null;
      }
      var destination = c.createMediaStreamDestination();
      var micSource = c.createMediaStreamSource(new MediaStream([micTrack]));
      micSource.connect(destination);
      jinglesBus.connect(destination);

      var mixedTrack = destination.stream.getAudioTracks()[0];
      if (!mixedTrack) {
        try { micSource.disconnect(); } catch (e) { /* ignore */ }
        try { jinglesBus.disconnect(destination); } catch (e) { /* ignore */ }
        return null;
      }

      var m = {
        id: ++mixerSeq,
        micTrack: micTrack,
        mixedTrack: mixedTrack,
        micSource: micSource,
        destination: destination
      };
      mixers.add(m);

      // Смешанный трек выглядит для dion как микрофонный.
      Object.defineProperty(mixedTrack, 'label', {
        configurable: true,
        get: function () { return micTrack.label; }
      });
      proxyToMic(mixedTrack, micTrack, 'getSettings');
      proxyToMic(mixedTrack, micTrack, 'getConstraints');
      proxyToMic(mixedTrack, micTrack, 'getCapabilities');
      proxyToMic(mixedTrack, micTrack, 'applyConstraints');

      var nativeStop = mixedTrack.stop;
      Object.defineProperty(mixedTrack, 'stop', {
        configurable: true,
        writable: true,
        value: function () {
          try { micTrack.stop(); } catch (e) { /* ignore */ }
          nativeStop.call(mixedTrack);
          destroyMixer(m);
        }
      });

      // Микрофон пропал (устройство отключили) — сообщаем dion через смешанный трек.
      micTrack.addEventListener('ended', function () {
        if (mixedTrack.readyState === 'live') {
          nativeStop.call(mixedTrack);
          destroyMixer(m);
          try { mixedTrack.dispatchEvent(new Event('ended')); } catch (e) { /* ignore */ }
        } else {
          destroyMixer(m);
        }
      });

      var tracks = [mixedTrack];
      stream.getTracks().forEach(function (t) {
        if (t !== micTrack) tracks.push(t);
      });
      console.log(LOG, 'Микшер #' + m.id + ' создан для', micTrack.label || micTrack.id);
      return new MediaStream(tracks);
    });
  }

  if (AC && md && originalGetUserMedia) {
    var wrappedGetUserMedia = function getUserMedia(constraints) {
      var self = this;
      return originalGetUserMedia.apply(self, arguments).then(function (stream) {
        var safe;
        try {
          safe = buildMixedStream(stream);
        } catch (e) {
          console.warn(LOG, 'Ошибка микширования — отдаём исходный поток:', e);
          return stream;
        }
        return safe.then(function (mixed) {
          return mixed || stream;
        }, function (e) {
          console.warn(LOG, 'Ошибка микширования — отдаём исходный поток:', e);
          return stream;
        });
      });
    };
    Object.defineProperty(MDProto, 'getUserMedia', {
      configurable: true,
      writable: true,
      enumerable: true,
      value: wrappedGetUserMedia
    });
  } else {
    console.warn(LOG, 'getUserMedia/AudioContext недоступны — джинглы только локально');
  }

  // --- Пассивное наблюдение за отправителями dion (только чтение) ---
  // Мьют dion в звонке — sender.replaceTrack(null), включение — track.enabled = true +
  // replaceTrack(смешанный трек); в превью — track.enabled = false. Чтобы узнать,
  // слышат ли участники джинглы, запоминаем отправителей, которых создаёт или меняет
  // сам dion. Обёртки передают аргументы и результат без изменений; сами мы ничего
  // не вызываем на соединениях и SDP не трогаем. Ошибки наблюдателя глотаются.

  var HAS_WEAKREF = typeof WeakRef === 'function';
  var senderEntries = [];          // { sender: WeakRef|RTCRtpSender, pc: WeakRef|RTCPeerConnection|null }
  var knownSenders = new WeakSet();

  function makeRef(obj) {
    if (!obj) return null;
    return HAS_WEAKREF ? new WeakRef(obj) : obj;
  }

  function deref(ref) {
    if (!ref) return null;
    return HAS_WEAKREF ? ref.deref() : ref;
  }

  function pcClosed(pc) {
    try {
      return !!pc && (pc.signalingState === 'closed' || pc.connectionState === 'closed');
    } catch (e) {
      return false;
    }
  }

  // Убираем собранных сборщиком мусора и отправителей закрытых соединений.
  function pruneSenders() {
    senderEntries = senderEntries.filter(function (e) {
      var s = deref(e.sender);
      if (!s) return false;
      var pc = deref(e.pc);
      if (e.pc && (!pc || pcClosed(pc))) {
        knownSenders.delete(s);
        return false;
      }
      return true;
    });
  }

  function observeSender(sender, pc) {
    try {
      if (!sender || typeof sender !== 'object') return;
      if (knownSenders.has(sender)) {
        if (pc) {
          senderEntries.forEach(function (e) {
            if (!e.pc && deref(e.sender) === sender) e.pc = makeRef(pc);
          });
        }
        return;
      }
      knownSenders.add(sender);
      pruneSenders();
      senderEntries.push({ sender: makeRef(sender), pc: makeRef(pc || null) });
    } catch (e) {
      /* наблюдатель не должен влиять на dion */
    }
  }

  function wrapMethod(proto, name, after) {
    if (!proto) return;
    var desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') return;
    var original = desc.value;
    var wrapped = {
      [name]: function () {
        var result = original.apply(this, arguments);
        try { after(this, result, arguments); } catch (e) { /* только наблюдение */ }
        return result;
      }
    }[name];
    Object.defineProperty(proto, name, {
      configurable: desc.configurable,
      enumerable: desc.enumerable,
      writable: desc.writable,
      value: wrapped
    });
  }

  var SenderProto = window.RTCRtpSender && window.RTCRtpSender.prototype;
  var PCProto = window.RTCPeerConnection && window.RTCPeerConnection.prototype;

  wrapMethod(SenderProto, 'replaceTrack', function (sender) {
    observeSender(sender, null);
  });
  wrapMethod(PCProto, 'addTrack', function (pc, sender) {
    observeSender(sender, pc);
  });
  wrapMethod(PCProto, 'addTransceiver', function (pc, transceiver) {
    observeSender(transceiver && transceiver.sender, pc);
  });

  function isMixedTrack(track) {
    if (!track) return false;
    var found = false;
    mixers.forEach(function (m) {
      if (m.mixedTrack === track) found = true;
    });
    return found;
  }

  function onAirSenders() {
    pruneSenders();
    var count = 0;
    senderEntries.forEach(function (e) {
      var s = deref(e.sender);
      var t = s && s.track;
      if (t && isMixedTrack(t) && t.readyState === 'live' && t.enabled) count++;
    });
    return count;
  }

  // Слышат ли участники джинглы:
  // disabled — «Встраивание» выключено; no-mixer — нет живого микшера;
  // muted — смешанный трек не на отправителе или выключен; on-air — идёт в эфир.
  function airState() {
    if (!enabled) return 'disabled';
    if (liveMixers().length === 0) return 'no-mixer';
    return onAirSenders() > 0 ? 'on-air' : 'muted';
  }

  document.addEventListener('__dionJinglesQueryAir', function (ev) {
    var det = ev.detail || {};
    var air;
    try {
      air = airState();
    } catch (e) {
      air = 'unknown';
    }
    document.dispatchEvent(new CustomEvent('__dionJinglesAirState', {
      detail: { id: det.id, air: air }
    }));
  });

  // --- Воспроизведение джинглов в общую шину ---

  // Параметры синтеза (как в content.js): длительность 0.5 с.
  function generateBuffer(c, soundType) {
    var duration = 0.5;
    var sr = c.sampleRate;
    var n = Math.floor(sr * duration);
    var buf = c.createBuffer(1, n, sr);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) {
      var t = i / sr;
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

  // Возвращает true, если есть куда играть (включено и есть живой микшер).
  function canPlay() {
    if (!enabled) return false;
    if (!ctx || !jinglesBus || ctx.state === 'closed') return false;
    return liveMixers().length > 0;
  }

  var currentSources = new Map(); // soundType -> AudioBufferSourceNode (в эфир)

  // Как playLocal в content.js: повторный звук того же типа останавливает предыдущий.
  function playBuffer(buf, soundType) {
    if (ctx.state !== 'running') ctx.resume().catch(function () {});
    var previous = currentSources.get(soundType);
    if (previous) {
      try { previous.stop(); } catch (e) { /* уже закончился */ }
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(jinglesBus);
    src.onended = function () {
      if (currentSources.get(soundType) === src) currentSources.delete(soundType);
    };
    currentSources.set(soundType, src);
    src.start(0);
  }

  // data:audio/mpeg;base64,... -> ArrayBuffer без fetch (не зависим от CSP страницы).
  function dataUrlToArrayBuffer(dataUrl) {
    var comma = dataUrl.indexOf(',');
    var bin = atob(dataUrl.slice(comma + 1));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function playFromDataUrl(soundType, dataUrl) {
    if (!canPlay()) return;
    var cached = soundType && buffers.get(soundType);
    if (cached && cached.sampleRate === ctx.sampleRate) {
      playBuffer(cached, soundType);
      return;
    }
    var c = ctx;
    var decoded;
    try {
      decoded = c.decodeAudioData(dataUrlToArrayBuffer(dataUrl));
    } catch (e) {
      decoded = Promise.reject(e);
    }
    decoded.then(function (buf) {
      if (soundType) buffers.set(soundType, buf);
      if (ctx === c && canPlay()) playBuffer(buf, soundType);
    }).catch(function (e) {
      console.warn(LOG, 'Не удалось декодировать звук, играем синтезированный:', e);
      if (canPlay()) playBuffer(generateBuffer(ctx, soundType), soundType);
    });
  }

  document.addEventListener('__dionJinglesPlayWithUrl', function (ev) {
    var det = ev.detail || {};
    if (typeof det.soundDataUrl !== 'string') return;
    playFromDataUrl(det.soundType, det.soundDataUrl);
  });

  document.addEventListener('__dionJinglesPlayGenerated', function (ev) {
    var det = ev.detail || {};
    if (!det.soundType || !canPlay()) return;
    playBuffer(generateBuffer(ctx, det.soundType), det.soundType);
  });

  document.addEventListener('__dionJinglesSetEnabled', function (ev) {
    var det = ev.detail || {};
    enabled = det.enabled !== false;
    if (jinglesBus) jinglesBus.gain.value = enabled ? 1 : 0;
  });

  // Консольный API (контекст top): dionJingles.status(), dionJingles.play('applause').
  Object.defineProperty(window, 'dionJingles', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      status: function () {
        return {
          intercepted: !!(MDProto && MDProto.getUserMedia !== originalGetUserMedia),
          enabled: enabled,
          contextState: ctx ? ctx.state : 'none',
          mixers: Array.from(mixers).map(function (m) {
            return {
              id: m.id,
              mic: m.micTrack.label,
              micState: m.micTrack.readyState,
              mixedState: m.mixedTrack.readyState,
              mixedEnabled: m.mixedTrack.enabled,
              mixedMuted: m.mixedTrack.muted
            };
          }),
          liveMixers: liveMixers().length,
          senders: (pruneSenders(), senderEntries.length),
          air: airState()
        };
      },
      // Тот же путь, что кнопка popup: content.js играет локально и отправляет звук сюда.
      play: function (soundType) {
        document.dispatchEvent(new CustomEvent('__dionJinglesRequestPlay', {
          detail: { soundType: String(soundType || 'applause') }
        }));
      }
    })
  });

  // Просим content.js прислать текущее состояние «Встраивания».
  document.dispatchEvent(new CustomEvent('__dionJinglesHello'));
})();
