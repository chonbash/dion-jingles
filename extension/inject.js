// Injection script - выполняется в контексте страницы
// КРИТИЧНО: перехват RTCPeerConnection и jingles должны быть в начале (до __dionJinglesInjected),
// чтобы сработать до скриптов dion.vc

(function() {
  'use strict';
  var DION_DEBUG_BUILD = 'dbg-8ca4bb-r4';
  // #region agent log
  function __dionEmitDebug(hypothesisId, location, message, data) {
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId:hypothesisId,location:location,message:message,data:data,timestamp:Date.now()})}).catch(function(){});
  }
  // #endregion

  // --- WebRTC в контексте страницы: jingles-трек и перехват PC (если ранний инлайн ещё не сработал) ---
  var jinglesContext = null;
  var jinglesDestination = null;
  var jinglesTrack = null;
  var pcMixers = new WeakMap();
  if (!window.__dionJinglesPagePCWrapped) {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      jinglesContext = new AC();
      jinglesDestination = jinglesContext.createMediaStreamDestination();
      var tracks = jinglesDestination.stream.getAudioTracks();
      if (tracks.length > 0) {
        jinglesTrack = tracks[0];
        console.log('[DionJingles] Page jingles track created:', jinglesTrack.id);
      }
    }
  } catch (e) {
    console.warn('[DionJingles] Page jingles context failed:', e);
  }
  }

  var PageOriginalRTCPeerConnection = window.RTCPeerConnection;
  if (PageOriginalRTCPeerConnection && !window.__dionJinglesPagePCWrapped) {
    window.__dionJinglesPagePCWrapped = true;
    window.RTCPeerConnection = function(...args) {
      var pc = new PageOriginalRTCPeerConnection(...args);
      // #region agent log
      fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H6',location:'inject.js:RTCPeerConnectionWrapped',message:'page pc created',data:{hasJinglesTrack:!!jinglesTrack,pcSignalingState:pc.signalingState,pcConnectionState:pc.connectionState},timestamp:Date.now()})}).catch(function(){});
      // #endregion
      if (jinglesTrack) {
        try {
          pc.addTrack(jinglesTrack);
          // #region agent log
          var _sendersAfterAdd = (typeof pc.getSenders === 'function' ? pc.getSenders() : []);
          var _hasJinglesSender = Array.prototype.some.call(_sendersAfterAdd, function(s) { return s && s.track === jinglesTrack; });
          fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H7',location:'inject.js:RTCPeerConnectionWrapped',message:'addTrack to page pc',data:{sendersCount:_sendersAfterAdd.length,hasJinglesSender:_hasJinglesSender,jinglesTrackId:jinglesTrack&&jinglesTrack.id},timestamp:Date.now()})}).catch(function(){});
          // #endregion
          console.log('[DionJingles] Jingles track added to PC in page context');
        } catch (err) {
          console.warn('[DionJingles] Failed to add jingles track to PC:', err);
        }
      }
      ensurePcMixer(pc);
      if (!window.__dionJinglesPCs) window.__dionJinglesPCs = [];
      window.__dionJinglesPCs.push(pc);
      return pc;
    };
    Object.setPrototypeOf(window.RTCPeerConnection, PageOriginalRTCPeerConnection);
    Object.setPrototypeOf(window.RTCPeerConnection.prototype, PageOriginalRTCPeerConnection.prototype);
    window.RTCPeerConnection.__dionJinglesIntercepted = true;
  }

  function ensurePcMixer(pc) {
    if (!pc || !jinglesDestination || typeof pc.getSenders !== 'function') return null;
    if (pcMixers.has(pc)) {
      __dionEmitDebug('H19','inject.js:ensurePcMixer','mixer reuse', { pcConnectionState: pc.connectionState });
      return pcMixers.get(pc);
    }
    var senders = pc.getSenders();
    var micSender = null;
    for (var i = 0; i < senders.length; i++) {
      var s = senders[i];
      if (s && s.track && s.track.kind === 'audio' && s.track !== jinglesTrack && s.track.readyState === 'live') {
        micSender = s;
        break;
      }
    }
    __dionEmitDebug('H19','inject.js:ensurePcMixer','mixer discovery', {
      hasMicSender: !!micSender,
      sendersCount: senders.length,
      pcConnectionState: pc.connectionState,
      pcSignalingState: pc.signalingState
    });
    if (!micSender) return null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      var mixContext = new AC();
      if (mixContext.state === 'suspended') {
        mixContext.resume().catch(function() {});
      }
      var mixDestination = mixContext.createMediaStreamDestination();
      var micSource = mixContext.createMediaStreamSource(new MediaStream([micSender.track]));
      micSource.connect(mixDestination);
      var jinglesSource = mixContext.createMediaStreamSource(jinglesDestination.stream);
      var jinglesGain = mixContext.createGain();
      jinglesGain.gain.value = 1.0;
      jinglesSource.connect(jinglesGain);
      jinglesGain.connect(mixDestination);
      var mixedTrack = mixDestination.stream.getAudioTracks()[0];
      var mixer = { mixContext: mixContext, mixDestination: mixDestination, micSender: micSender, mixedTrack: mixedTrack };
      pcMixers.set(pc, mixer);
      micSender.replaceTrack(mixedTrack).then(function() {
        __dionEmitDebug('H20','inject.js:ensurePcMixer','replaceTrack with mixed track success', {
          mixedTrackId: mixedTrack && mixedTrack.id,
          originalTrackId: micSender.track && micSender.track.id
        });
      }).catch(function(err) {
        __dionEmitDebug('H20','inject.js:ensurePcMixer','replaceTrack with mixed track failed', { error: String(err) });
      });
      return mixer;
    } catch (e) {
      __dionEmitDebug('H20','inject.js:ensurePcMixer','mixer setup failed', { error: String(e) });
      return null;
    }
  }

  function ensureMixersForAllPCs() {
    var pcs = window.__dionJinglesPCs || [];
    for (var i = 0; i < pcs.length; i++) {
      ensurePcMixer(pcs[i]);
    }
    __dionEmitDebug('H19','inject.js:ensureMixersForAllPCs','mixers ensured', { pcsCount: pcs.length });
  }

  document.addEventListener('__dionJinglesPlayWithUrl', function(event) {
    var detail = event.detail;
    var url = detail && (detail.soundDataUrl || detail.soundUrl);
    // #region agent log
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H8',location:'inject.js:__dionJinglesPlayWithUrl',message:'playWithUrl event',data:{hasUrl:!!url,jinglesContextState:jinglesContext&&jinglesContext.state,hasDestination:!!jinglesDestination,pcsCount:(window.__dionJinglesPCs||[]).length},timestamp:Date.now()})}).catch(function(){});
    // #endregion
    if (!url || !jinglesContext || !jinglesDestination) return;
    if (jinglesContext.state === 'suspended') {
      jinglesContext.resume().catch(function() {});
    }
    ensureMixersForAllPCs();
    fetch(url)
      .then(function(r) { return r.arrayBuffer(); })
      .then(function(buf) { return jinglesContext.decodeAudioData(buf); })
      .then(function(buffer) {
        var src = jinglesContext.createBufferSource();
        src.buffer = buffer;
        src.connect(jinglesDestination);
        src.start(0);
        // #region agent log
        var _pcs = window.__dionJinglesPCs || [];
        var _pcSnapshot = _pcs.map(function(pc, idx) {
          var senders = (pc && typeof pc.getSenders === 'function') ? pc.getSenders() : [];
          return {
            idx: idx,
            signalingState: pc && pc.signalingState,
            connectionState: pc && pc.connectionState,
            sendersCount: senders.length,
            audioSenders: senders.filter(function(s) { return s && s.track && s.track.kind === 'audio'; }).length
          };
        });
        fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H9',location:'inject.js:__dionJinglesPlayWithUrl',message:'buffer started into destination',data:{pcCount:_pcs.length,pcSnapshot:_pcSnapshot},timestamp:Date.now()})}).catch(function(){});
        // #endregion
        // #region agent log
        setTimeout(function() {
          var pcs = window.__dionJinglesPCs || [];
          pcs.forEach(function(pc, pcIndex) {
            if (!pc || typeof pc.getSenders !== 'function') return;
            var senders = pc.getSenders();
            __dionEmitDebug('H13','inject.js:__dionJinglesPlayWithUrl','audio senders snapshot', {
              pcIndex: pcIndex,
              audioSenders: senders.filter(function(s) { return s && s.track && s.track.kind === 'audio'; }).map(function(s, idx) {
                return {
                  senderIndex: idx,
                  trackId: s.track && s.track.id,
                  kind: s.track && s.track.kind,
                  enabled: s.track && s.track.enabled,
                  muted: s.track && s.track.muted,
                  readyState: s.track && s.track.readyState,
                  isJinglesTrack: s.track === jinglesTrack
                };
              })
            });
            senders.forEach(function(sender, senderIndex) {
              if (!sender || !sender.track || sender.track.kind !== 'audio') return;
              if (typeof sender.getStats !== 'function') {
                __dionEmitDebug('H21','inject.js:__dionJinglesPlayWithUrl','sender.getStats unavailable', {
                  pcIndex: pcIndex,
                  senderIndex: senderIndex,
                  trackId: sender.track.id,
                  isJinglesTrack: sender.track === jinglesTrack
                });
                return;
              }
              sender.getStats().then(function(report) {
                var outbound = null;
                report.forEach(function(stat) {
                  if (!outbound && stat.type === 'outbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio') && !stat.isRemote) {
                    outbound = stat;
                  }
                });
                __dionEmitDebug(sender.track === jinglesTrack ? 'H13' : 'H21','inject.js:__dionJinglesPlayWithUrl',sender.track === jinglesTrack ? 'jingles sender stats' : 'mixed/mic sender stats', {
                  pcIndex: pcIndex,
                  senderIndex: senderIndex,
                  trackId: sender.track.id,
                  isJinglesTrack: sender.track === jinglesTrack,
                  packetsSent: outbound && outbound.packetsSent,
                  bytesSent: outbound && outbound.bytesSent,
                  totalAudioEnergy: outbound && outbound.totalAudioEnergy,
                  timestamp: outbound && outbound.timestamp
                });
              }).catch(function(err) {
                __dionEmitDebug('H21','inject.js:__dionJinglesPlayWithUrl','stats read failed', {
                  pcIndex: pcIndex,
                  senderIndex: senderIndex,
                  isJinglesTrack: sender.track === jinglesTrack,
                  error: String(err)
                });
              });
            });
          });
        }, 350);
        // #endregion
      })
      .catch(function(e) { console.warn('[DionJingles] Page play failed:', e); });
  });

  function generateAndPlayIntoStream(soundType) {
    // #region agent log
    var _t0 = Date.now();
    // #endregion
    if (!jinglesContext || !jinglesDestination) return;
    if (jinglesContext.state === 'suspended') {
      jinglesContext.resume().catch(function() {});
    }
    var duration = 0.5;
    var sampleRate = jinglesContext.sampleRate;
    var frameCount = sampleRate * duration;
    var buffer = jinglesContext.createBuffer(1, frameCount, sampleRate);
    var data = buffer.getChannelData(0);
    var i, t, decay, freq;
    switch (soundType) {
      case 'applause':
        for (i = 0; i < frameCount; i++) {
          t = i / sampleRate;
          decay = Math.exp(-t * 2);
          data[i] = (Math.random() * 2 - 1) * decay * 0.3;
        }
        break;
      case 'error':
        for (i = 0; i < frameCount; i++) {
          t = i / sampleRate;
          freq = 200 + Math.sin(t * 20) * 50;
          decay = Math.exp(-t * 3);
          data[i] = Math.sin(2 * Math.PI * freq * t) * decay * 0.4;
        }
        break;
      case 'success':
        for (i = 0; i < frameCount; i++) {
          t = i / sampleRate;
          freq = 400 + t * 200;
          decay = Math.exp(-t * 2);
          data[i] = Math.sin(2 * Math.PI * freq * t) * decay * 0.3;
        }
        break;
      case 'notification':
        for (i = 0; i < frameCount; i++) {
          t = i / sampleRate;
          freq = 800;
          decay = Math.exp(-t * 5);
          data[i] = Math.sin(2 * Math.PI * freq * t) * decay * 0.3;
        }
        break;
      default:
        for (i = 0; i < frameCount; i++) {
          t = i / sampleRate;
          freq = 440;
          decay = Math.exp(-t * 3);
          data[i] = Math.sin(2 * Math.PI * freq * t) * decay * 0.3;
        }
    }
    var src = jinglesContext.createBufferSource();
    src.buffer = buffer;
    src.connect(jinglesDestination);
    src.start(0);
    // #region agent log
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',location:'inject.js:generateAndPlayIntoStream',message:'generateAndPlay done',data:{durationMs:Date.now()-_t0,soundType:soundType},timestamp:Date.now(),hypothesisId:'H8'})}).catch(function(){});
    // #endregion
  }
  document.addEventListener('__dionJinglesPlayGenerated', function(event) {
    if (event.detail && event.detail.soundType) {
      generateAndPlayIntoStream(event.detail.soundType);
    }
  });

  // --- Остальная часть inject (консольный API, анализ) ---
  if (window.__dionJinglesInjected) {
    return;
  }
  window.__dionJinglesInjected = true;

  // Хранилище для ссылки на player
  let playerRef = null;
  
  // Получаем bridge элемент для коммуникации
  function getBridge() {
    return document.getElementById('__dionJinglesBridge');
  }
  
  // Функция для получения player через специальный механизм
  // Так как мы не можем передать объект напрямую между контекстами,
  // используем другой подход - injection script может получить доступ
  // к window страницы, но content script работает в изолированном контексте
  // Поэтому нужно использовать другой механизм
  
  // Попробуем получить player через прямое обращение к content script window
  // Но это не сработает, так как контексты изолированы
  
  // Альтернатива: используем скрытый элемент как флаг
  function checkPlayerReady() {
    const bridge = getBridge();
    if (bridge && bridge.getAttribute('data-player-ready') === 'true') {
      return true;
    }
    return false;
  }
  
  // Слушаем обновления от content script через document события
  document.addEventListener('__dionJinglesPlayerUpdate', function(event) {
    if (event.detail && event.detail.ready) {
      console.log('[DionJingles] Получено уведомление о готовности player');
      // Player готов, но мы не можем получить сам объект напрямую
      // Нужно использовать другой подход
    }
  });
  
  // Функция для запроса player у content script
  function requestPlayer() {
    console.log('[DionJingles] Запрос player...');
    
    // Отправляем запрос через document
    const event = new CustomEvent('__dionJinglesGetPlayer', {
      detail: { timestamp: Date.now() }
    });
    document.dispatchEvent(event);
    
    // Проверяем bridge элемент
    return new Promise((resolve) => {
      // Сначала проверяем, готов ли уже player
      if (checkPlayerReady()) {
        console.log('[DionJingles] Player уже готов');
        resolve(createPlayerProxy());
        return;
      }
      
      console.log('[DionJingles] Ожидание готовности player...');
      
      // Если нет, ждем уведомления
      // #region agent log
      var _pollCount = 0;
      // #endregion
      const checkInterval = setInterval(() => {
        // #region agent log
        _pollCount++;
        if (_pollCount % 5 === 0) {
          fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',location:'inject.js:requestPlayer',message:'player poll tick',data:{pollCount:_pollCount},timestamp:Date.now(),hypothesisId:'H10'})}).catch(function(){});
        }
        // #endregion
        if (checkPlayerReady()) {
          clearInterval(checkInterval);
          console.log('[DionJingles] Player готов (через polling)');
          resolve(createPlayerProxy());
        }
      }, 50);
      
      // Также слушаем событие
      const eventListener = function() {
        if (checkPlayerReady()) {
          clearInterval(checkInterval);
          document.removeEventListener('__dionJinglesPlayerUpdate', eventListener);
          console.log('[DionJingles] Player готов (через событие)');
          resolve(createPlayerProxy());
        }
      };
      document.addEventListener('__dionJinglesPlayerUpdate', eventListener);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        document.removeEventListener('__dionJinglesPlayerUpdate', eventListener);
        if (checkPlayerReady()) {
          console.log('[DionJingles] Player готов (таймаут)');
          resolve(createPlayerProxy());
        } else {
          console.warn('[DionJingles] Player не готов после таймаута');
          resolve(null);
        }
      }, 500);
    });
  }
  
  // Создаем прокси-объект для выполнения команд в content script
  function createPlayerProxy() {
    const proxy = {
      // Выполняем команды через события
      playSound: function(soundType) {
        const event = new CustomEvent('__dionJinglesCommand', {
          detail: { command: 'playSound', args: [soundType] }
        });
        document.dispatchEvent(event);
      }
    };
    
    // Добавляем геттеры для свойств (асинхронные)
    const properties = ['isWebRTCEnabled', 'audioContext', 'mixingContext', 'mixingDestination', 
                       'microphoneStream', 'microphoneSource', 'currentSounds',
                       'jinglesContext', 'jinglesDestination', 'jinglesTrack', 'jinglesPCs'];
    
    // Кэш для значений свойств (чтобы не запрашивать повторно)
    const propertyCache = new Map();
    
    properties.forEach(prop => {
      Object.defineProperty(proxy, prop, {
        get: function() {
          // Проверяем кэш
          if (propertyCache.has(prop)) {
            const cached = propertyCache.get(prop);
            // Кэш действителен 100мс
            if (Date.now() - cached.timestamp < 100) {
              return Promise.resolve(cached.value);
            }
          }
          
          // Возвращаем промис для асинхронного получения
          return new Promise((resolve) => {
            const requestId = `${Date.now()}_${Math.random()}`;
            let resolved = false;
            
            // Слушаем ответ ПЕРЕД отправкой запроса
            const listener = function(event) {
              if (event.detail && event.detail.requestId === requestId && !resolved) {
                resolved = true;
                document.removeEventListener('__dionJinglesPropertyResult', listener);
                const value = event.detail.value;
                // Кэшируем значение
                propertyCache.set(prop, { value: value, timestamp: Date.now() });
                console.log('[DionJingles] Получен ответ для свойства:', prop, '=', value);
                resolve(value);
              }
            };
            document.addEventListener('__dionJinglesPropertyResult', listener);
            
            // Отправляем запрос
            const resultEvent = new CustomEvent('__dionJinglesGetProperty', {
              detail: { property: prop, requestId: requestId }
            });
            document.dispatchEvent(resultEvent);
            console.log('[DionJingles] Отправлен запрос свойства:', prop, 'requestId:', requestId);
            
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                document.removeEventListener('__dionJinglesPropertyResult', listener);
                console.warn('[DionJingles] Таймаут получения свойства:', prop);
                resolve(undefined);
              }
            }, 500);
          });
        }
      });
    });
    
    return proxy;
  }
  
  // Функция для анализа кода dion.vc (доступна из консоли страницы)
  // Функция анализа dion.vc (асинхронная, как диагностика)
  window.analyzeDionVC = async function() {
    console.log('=== АНАЛИЗ DION.VC ===');
    
    // Проверяем базовые вещи
    console.log('\n--- БАЗОВАЯ ПРОВЕРКА ---');
    console.log('RTCPeerConnection в window:', typeof window.RTCPeerConnection);
    console.log('RTCPeerConnection перехвачен:', window.RTCPeerConnection?.__dionJinglesIntercepted);
    console.log('RTCPeerConnection является функцией:', typeof window.RTCPeerConnection === 'function');
    console.log('RTCPeerConnection.prototype:', window.RTCPeerConnection?.prototype ? 'есть' : 'нет');
    console.log('window.__dionJinglesPCs:', window.__dionJinglesPCs?.length || 0);
    console.log('webkitRTCPeerConnection:', typeof window.webkitRTCPeerConnection);
    console.log('webkitRTCPeerConnection перехвачен:', window.webkitRTCPeerConnection?.__dionJinglesIntercepted);
    console.log('mozRTCPeerConnection:', typeof window.mozRTCPeerConnection);
    
    // Проверяем, не используется ли webkitRTCPeerConnection
    if (window.webkitRTCPeerConnection) {
      console.warn('⚠️ Обнаружен webkitRTCPeerConnection - возможно, dion.vc использует его вместо RTCPeerConnection');
      console.log('Проверяем, перехвачен ли webkitRTCPeerConnection...');
    }
    
    // ДИАГНОСТИКА: Проверяем, почему перехват не сработал
    if (!window.RTCPeerConnection.__dionJinglesIntercepted) {
      console.error('❌ ПРОБЛЕМА: RTCPeerConnection НЕ перехвачен!');
      console.log('Проверяем возможные причины...');
      console.log('1. RTCPeerConnection определен до загрузки скрипта:', window.RTCPeerConnection !== undefined);
      console.log('2. isIntercepted в замыкании:', 'недоступно из inject.js');
      console.log('3. Попробуем перехватить вручную...');
      
      // Пытаемся перехватить вручную
      try {
        const original = window.RTCPeerConnection;
        window.RTCPeerConnection = function(...args) {
          const pc = new original(...args);
          console.log('[DionJingles] 🔍 RTCPeerConnection создан (ручной перехват из inject.js)');
          if (!window.__dionJinglesPCs) {
            window.__dionJinglesPCs = [];
          }
          window.__dionJinglesPCs.push(pc);
          return pc;
        };
        Object.setPrototypeOf(window.RTCPeerConnection, original);
        Object.setPrototypeOf(window.RTCPeerConnection.prototype, original.prototype);
        window.RTCPeerConnection.__dionJinglesIntercepted = true;
        console.log('✅ Ручной перехват установлен из inject.js');
      } catch (e) {
        console.error('Ошибка ручного перехвата:', e);
      }
    }
    
    // Ждем готовности player
    const player = await window.dionJingles.getPlayer();
    if (!player) {
      console.error('❌ Player не найден');
      return [];
    }
    
    console.log('player.allPeerConnections:', player.allPeerConnections?.length || 0);
    
    const foundPCs = [];
    
    // 1. Ищем через ранний перехват
    if (window.__dionJinglesPCs && window.__dionJinglesPCs.length > 0) {
      console.log(`\n✅ Найдено RTCPeerConnection (ранний перехват): ${window.__dionJinglesPCs.length}`);
      window.__dionJinglesPCs.forEach((pc, index) => {
        foundPCs.push({ source: 'early_intercept', index, pc });
      });
    } else {
      console.log('\n⚠️ window.__dionJinglesPCs пуст или не существует');
    }
    
    // 2. Ищем через player.allPeerConnections
    if (player.allPeerConnections && player.allPeerConnections.length > 0) {
      console.log(`\n✅ Найдено RTCPeerConnection (player.allPeerConnections): ${player.allPeerConnections.length}`);
      player.allPeerConnections.forEach((pc, index) => {
        if (!foundPCs.find(p => p.pc === pc)) {
          foundPCs.push({ source: 'player_list', index, pc });
        }
      });
    }
    
    // 3. Глубокий поиск в window
    console.log('\n--- Глубокий поиск в window ---');
    const searchInObject = (obj, path = '', depth = 0, maxDepth = 3) => {
      if (depth > maxDepth) return;
      if (!obj || typeof obj !== 'object') return;
      
      try {
        // Проверяем сам объект
        if (obj instanceof RTCPeerConnection && typeof obj.getTransceivers === 'function') {
          if (!foundPCs.find(p => p.pc === obj)) {
            foundPCs.push({ source: 'deep_search', path, pc: obj });
            console.log(`✅ Найден RTCPeerConnection в ${path}`);
          }
          return;
        }
        
        // Ищем в свойствах
        const keys = Object.keys(obj);
        for (const key of keys) {
          try {
            const value = obj[key];
            if (value && typeof value === 'object') {
              const newPath = path ? `${path}.${key}` : key;
              searchInObject(value, newPath, depth + 1, maxDepth);
            }
          } catch (e) {
            // Игнорируем ошибки доступа
          }
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    };
    
    // Ищем в основных объектах window
    const searchTargets = [
      'window',
      '__REACT_DEVTOOLS_GLOBAL_HOOK__',
      '__REDUX_DEVTOOLS_EXTENSION__',
      'React',
      'ReactDOM'
    ];
    
    searchTargets.forEach(target => {
      try {
        const obj = eval(target);
        if (obj) {
          searchInObject(obj, target, 0, 2);
        }
      } catch (e) {
        // Игнорируем
      }
    });
    
    // 4. Ищем через Object.keys (все ключи window)
    console.log('\n--- Поиск через Object.keys(window) ---');
    try {
      const allKeys = Object.keys(window);
      console.log(`Всего ключей в window: ${allKeys.length}`);
      
      for (const key of allKeys) {
        try {
          const obj = window[key];
          if (obj && typeof obj === 'object') {
            // Прямая проверка
            if (obj instanceof RTCPeerConnection) {
              if (!foundPCs.find(p => p.pc === obj)) {
                foundPCs.push({ source: 'window_keys', name: key, pc: obj });
                console.log(`✅ Найден RTCPeerConnection в window.${key}`);
              }
            }
            // Поиск внутри объекта (только первый уровень, ограничиваем для производительности)
            else {
              try {
                const innerKeys = Object.keys(obj).slice(0, 20);
                for (const innerKey of innerKeys) {
                  try {
                    const innerObj = obj[innerKey];
                    if (innerObj instanceof RTCPeerConnection) {
                      if (!foundPCs.find(p => p.pc === innerObj)) {
                        foundPCs.push({ source: 'window_keys_nested', name: `${key}.${innerKey}`, pc: innerObj });
                        console.log(`✅ Найден RTCPeerConnection в window.${key}.${innerKey}`);
                      }
                    }
                  } catch (e) {
                    // Игнорируем
                  }
                }
              } catch (e) {
                // Игнорируем ошибки доступа к ключам
              }
            }
          }
        } catch (e) {
          // Игнорируем ошибки доступа
        }
      }
    } catch (e) {
      console.warn('Ошибка поиска через Object.keys:', e);
    }
    
    // 5. Анализируем найденные PC
    console.log(`\n=== РЕЗУЛЬТАТЫ АНАЛИЗА: найдено ${foundPCs.length} RTCPeerConnection ===`);
    
    foundPCs.forEach(({ source, path, name, index, pc }) => {
      try {
        const label = path || name || `${source}[${index}]`;
        console.log(`\n--- Анализ ${label} (${source}) ---`);
        
        const transceivers = pc.getTransceivers();
        console.log(`Transceivers: ${transceivers.length}`);
        
        transceivers.forEach((t, i) => {
          if (t.sender && t.sender.track) {
            const track = t.sender.track;
            console.log(`  Transceiver ${i}:`, {
              kind: track.kind,
              id: track.id,
              label: track.label,
              readyState: track.readyState,
              enabled: track.enabled,
              muted: track.muted,
              direction: t.direction,
              mid: t.mid
            });
            
            // Если это аудио трек - это то, что нам нужно!
            if (track.kind === 'audio' && track.readyState === 'live') {
              console.log(`  ⚠️ ВАЖНО: Это живой аудио трек! ID: ${track.id}, Label: ${track.label}`);
            }
          } else {
            console.log(`  Transceiver ${i}: нет трека, direction: ${t.direction}`);
          }
        });
        
        const senders = pc.getSenders();
        console.log(`Senders: ${senders.length}`);
        senders.forEach((s, i) => {
          if (s.track) {
            const track = s.track;
            console.log(`  Sender ${i}:`, {
              kind: track.kind,
              id: track.id,
              label: track.label,
              readyState: track.readyState,
              enabled: track.enabled,
              muted: track.muted
            });
            
            if (track.kind === 'audio' && track.readyState === 'live') {
              console.log(`  ⚠️ ВАЖНО: Это живой аудио трек в sender! ID: ${track.id}, Label: ${track.label}`);
            }
          } else {
            console.log(`  Sender ${i}: нет трека`);
          }
        });
        
        // Проверяем connection state
        console.log(`Connection state: ${pc.connectionState}`);
        console.log(`ICE connection state: ${pc.iceConnectionState}`);
        console.log(`Signaling state: ${pc.signalingState}`);
        
      } catch (e) {
        console.warn(`Ошибка анализа ${label}:`, e);
      }
    });
    
    if (foundPCs.length === 0) {
      console.warn('\n⚠️ RTCPeerConnection не найден ни одним способом!');
      console.log('\nВозможные причины:');
      console.log('1. RTCPeerConnection создается в Web Worker (недоступен из основного контекста)');
      console.log('2. RTCPeerConnection хранится в замыканиях React/Redux (не в глобальных переменных)');
      console.log('3. RTCPeerConnection создается динамически и не сохраняется в переменных');
      console.log('\nРекомендации:');
      console.log('1. Откройте DevTools -> Sources -> Event Listener Breakpoints -> RTCPeerConnection');
      console.log('2. Поставьте breakpoint на создание RTCPeerConnection');
      console.log('3. Проверьте React DevTools - может быть PC в state компонента');
      console.log('4. Проверьте Redux DevTools - может быть PC в store');
      console.log('5. Попробуйте найти через: Object.getOwnPropertyNames(window)');
    } else {
      console.log(`\n✅ Найдено ${foundPCs.length} RTCPeerConnection. Проверьте вывод выше для деталей.`);
    }
    
    return foundPCs;
  };
  
  // Добавляем функции в window для доступа из консоли
  window.dionJingles = {
    // Проверка доступности
    check: async function() {
      const player = await this.getPlayer();
      const result = player !== null;
      console.log('[DionJingles] check() результат:', result);
      return result;
    },
    
    // Получить player
    getPlayer: async function() {
      if (playerRef) {
        return playerRef;
      }
      playerRef = await requestPlayer();
      return playerRef;
    },
    
    // Быстрая диагностика
    diagnose: async function() {
      const player = await this.getPlayer();
      if (!player) {
        console.error('❌ Расширение не загружено');
        console.warn('Проверьте:');
        console.warn('1. Расширение установлено и включено');
        console.warn('2. Вы на странице dion.vc');
        console.warn('3. Страница перезагружена');
        return false;
      }
      
      console.log('=== ДИАГНОСТИКА DION JINGLES ===');
      
      // Получаем свойства асинхронно
      const isWebRTCEnabled = await player.isWebRTCEnabled;
      const audioContext = await player.audioContext;
      const mixingContext = await player.mixingContext;
      const mixingDestination = await player.mixingDestination;
      const microphoneStream = await player.microphoneStream;
      const microphoneSource = await player.microphoneSource;
      const currentSounds = await player.currentSounds;
      
      // Правильная интерпретация значений
      const formatValue = (val, isObject = false) => {
        if (val === null || val === undefined || val === false) return '❌';
        if (isObject && val.state) return `✅ ${val.state}`;
        if (val === true || (typeof val === 'object' && val !== null)) return '✅';
        return `✅ ${val}`;
      };
      
      console.log('WebRTC:', formatValue(isWebRTCEnabled), isWebRTCEnabled);
      console.log('AudioContext:', formatValue(audioContext, true), audioContext);
      console.log('MixingContext:', formatValue(mixingContext, true), mixingContext);
      console.log('MixingDestination:', formatValue(mixingDestination), mixingDestination);
      console.log('MicrophoneStream:', formatValue(microphoneStream), microphoneStream || 'null');
      console.log('MicrophoneSource:', formatValue(microphoneSource), microphoneSource || 'null');
      
      if (Array.isArray(currentSounds)) {
        console.log('Active sounds:', currentSounds.length > 0 ? currentSounds.join(', ') : 'нет');
      } else if (currentSounds) {
        console.log('Active sounds:', currentSounds);
      } else {
        console.log('Active sounds: нет');
      }
      
      return true;
    },
    
    // Воспроизвести звук
    play: async function(soundType) {
      const player = await this.getPlayer();
      if (!player) {
        console.error('❌ Расширение не загружено');
        return false;
      }
      console.log('[DionJingles] Воспроизведение звука:', soundType);
      player.playSound(soundType);
      console.log('[DionJingles] ✅ Команда отправлена');
      return true;
    }
  };
  
  // Добавляем геттер для прямого доступа (синхронный, но может вернуть null)
  Object.defineProperty(window, 'dionJinglesPlayer', {
    get: function() {
      return playerRef;
    },
    configurable: true
  });
  
  // Создаем window.__dionResearch в контексте страницы
  // Данные будут передаваться из research.js через DOM события
  window.__dionResearch = {
    _logs: [],
    _isReady: false,
    _pendingRequests: new Map(),
    
    // Метод для запроса логов у content script
    _requestLogs: function(type = 'all') {
      return new Promise((resolve, reject) => {
        const requestId = `research_logs_${Date.now()}_${Math.random()}`;
        this._pendingRequests.set(requestId, { resolve, reject });
        
        const event = new CustomEvent('__dionResearchRequestLogs', {
          detail: { requestId, type }
        });
        document.dispatchEvent(event);
        
        setTimeout(() => {
          if (this._pendingRequests.has(requestId)) {
            this._pendingRequests.delete(requestId);
            reject(new Error('[DionJingles] Таймаут получения логов исследования. Content script не ответил.'));
          }
        }, 2000); // 2 секунды таймаут
      });
    },
    
    // Слушаем ответы от content script
    _initListener: function() {
      if (this._isReady) return;
      document.addEventListener('__dionResearchResponseLogs', (event) => {
        const { requestId, logs, type } = event.detail;
        if (this._pendingRequests.has(requestId)) {
          const { resolve } = this._pendingRequests.get(requestId);
          this._pendingRequests.delete(requestId);
          this._logs = logs; // Обновляем локальные логи
          resolve(logs);
        }
      });
      
      // Слушаем периодические обновления
      document.addEventListener('__dionResearchUpdate', (event) => {
        if (event.detail && event.detail.logs) {
          this._logs = event.detail.logs;
        }
      });
      
      this._isReady = true;
    },
    
    getLogs: async function() {
      if (!this._isReady) this._initListener();
      return await this._requestLogs('all');
    },
    
    getLogsByType: async function(type) {
      if (!this._isReady) this._initListener();
      return await this._requestLogs(type);
    },
    
    getSummary: async function() {
      if (!this._isReady) this._initListener();
      const summary = await this._requestLogs('summary');
      return summary;
    },
    
    printSummary: async function() {
      if (!this._isReady) this._initListener();
      const summary = await this._requestLogs('summary');
      console.log('=== СВОДКА ИССЛЕДОВАНИЯ (из inject.js) ===');
      console.log('Всего событий:', summary.totalLogs);
      console.log('По типам:', summary.byType);
      console.log('RTCPeerConnection создано:', summary.peerConnections.length);
      console.log('Аудио треков стало live:', summary.audioTracks.length);
      console.log('Детали:', summary);
      return summary;
    }
  };
  
  window.__dionResearch._initListener(); // Инициализируем слушатель сразу
  
  console.log('[DionJingles] ✅ Injection script загружен');
  // #region agent log
  __dionEmitDebug('H16','inject.js:boot','inject script build marker',{build:DION_DEBUG_BUILD});
  // #endregion
  console.log('[DionJingles] Доступные команды:');
  console.log('  - window.dionJingles.check() - проверить загрузку');
  console.log('  - window.dionJingles.getPlayer() - получить player');
  console.log('  - window.dionJingles.diagnose() - полная диагностика');
  console.log('  - window.dionJingles.play("applause") - воспроизвести звук');
  console.log('  - window.analyzeDionVC() - анализ кода dion.vc (найти RTCPeerConnection)');
  console.log('  - window.dionJinglesPlayer - прямая ссылка (может быть null)');
  console.log('  - window.__dionResearch.printSummary() - сводка исследования WebRTC');
  console.log('[DionJingles] ✅ window.__dionResearch создан в контексте страницы');
})();

