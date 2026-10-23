// Инструмент для исследования WebRTC в dion.vc
// Просто наблюдает и логирует, НЕ перехватывает

(function() {
  'use strict';
  
  console.log('=== ИССЛЕДОВАНИЕ WEBRTC В DION.VC ===');
  console.log('Этот скрипт только наблюдает, не перехватывает');
  
  const logs = [];
  
  // КРИТИЧНО: Создаем объект сразу, чтобы он был доступен даже при ошибках
  window.__dionResearch = {
    logs: logs,
    getLogs: function() { return logs; },
    getLogsByType: function(type) { return logs.filter(log => log.type === type); },
    getSummary: function() {
      const summary = {
        totalLogs: logs.length,
        byType: {},
        peerConnections: [],
        audioTracks: []
      };
      logs.forEach(log => {
        summary.byType[log.type] = (summary.byType[log.type] || 0) + 1;
        if (log.type === 'RTCPeerConnection_created') summary.peerConnections.push(log);
        if (log.type === 'audioTrack_became_live') summary.audioTracks.push(log);
      });
      return summary;
    },
    printSummary: function() {
      const summary = this.getSummary();
      console.log('=== СВОДКА ИССЛЕДОВАНИЯ ===');
      console.log('Всего событий:', summary.totalLogs);
      console.log('По типам:', summary.byType);
      console.log('RTCPeerConnection создано:', summary.peerConnections.length);
      console.log('Аудио треков стало live:', summary.audioTracks.length);
      console.log('Детали:', summary);
      return summary;
    }
  };
  
  console.log('✅ window.__dionResearch создан заранее');
  
  // ПРИМЕЧАНИЕ: Мы НЕ перехватываем setParameters, потому что это не нужно для передачи звука аплодисментов.
  // Для передачи звука нужно:
  // 1. Перехватить getUserMedia() - получить доступ к микрофону
  // 2. Смешать звук аплодисментов с микрофоном (через Web Audio API)
  // 3. Передать смешанный поток через WebRTC (перехват addTrack())
  // setParameters - это метод для изменения параметров кодирования (битрейт, codec и т.д.), он НЕ нужен для передачи звука.
  
  // УДАЛЕНО: Весь код перехвата setParameters, так как он не нужен для основной задачи
    if (window.RTCRtpSender && window.RTCRtpSender.prototype) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(window.RTCRtpSender.prototype, 'setParameters');
        const originalSetParameters = descriptor ? descriptor.value : window.RTCRtpSender.prototype.setParameters;
        
        if (originalSetParameters && typeof originalSetParameters === 'function') {
          // Проверяем, не перехвачен ли уже
          if (originalSetParameters.__dionResearchIntercepted) {
            return true; // Уже перехвачен
          }
          
          console.log('✅ RTCRtpSender.setParameters найден на прототипе, перехватываем через defineProperty...');
          console.log('🔍 Оригинальный метод:', originalSetParameters);
          console.log('🔍 Оригинальный метод toString:', originalSetParameters.toString().substring(0, 100));
          
          // Создаем обертку
          const interceptedMethod = function(params) {
            console.log('🔍🔍🔍 RTCRtpSender.setParameters ВЫЗВАН!', params);
            console.log('🔍 this:', this);
            console.log('🔍 this.setParameters:', this.setParameters);
            console.log('🔍 this.setParameters === interceptedMethod?', this.setParameters === interceptedMethod);
            console.log('🔍 Stack trace вызова:', new Error().stack);
            
            // Пытаемся найти transceiver через sender
            let transceiver = null;
            let transceiverInfo = null;
            
            // Ищем transceiver, который содержит этот sender
            try {
              // Пытаемся найти через getTransceivers всех RTCPeerConnection
              if (window.RTCPeerConnection) {
                for (const key in window) {
                  try {
                    const value = window[key];
                    if (value instanceof RTCPeerConnection) {
                      const transceivers = value.getTransceivers();
                      for (const t of transceivers) {
                        if (t.sender === this) {
                          transceiver = t;
                          transceiverInfo = {
                            mid: t.mid,
                            direction: t.direction,
                            stopped: t.stopped,
                            senderTrack: t.sender?.track ? {
                              id: t.sender.track.id,
                              kind: t.sender.track.kind,
                              label: t.sender.track.label,
                              readyState: t.sender.track.readyState
                            } : null,
                            receiverTrack: t.receiver?.track ? {
                              id: t.receiver.track.id,
                              kind: t.receiver.track.kind,
                              label: t.receiver.track.label,
                              readyState: t.receiver.track.readyState
                            } : null
                          };
                          break;
                        }
                      }
                      if (transceiver) break;
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {
              console.error('❌ Ошибка при поиске transceiver:', e);
            }
            
            const log = {
              type: 'setParameters_called',
              timestamp: new Date().toISOString(),
              method: 'RTCRtpSender.setParameters',
              transceiver: transceiverInfo,
              sender: {
                track: this.track ? {
                  id: this.track.id,
                  kind: this.track.kind,
                  label: this.track.label,
                  readyState: this.track.readyState
                } : null
              },
              params: params,
              stack: new Error().stack
            };
            
            logs.push(log);
            console.log('🔍 RTCRtpSender.setParameters вызван:', log);
            
            return originalSetParameters.call(this, params);
          };
          
          // Помечаем как перехваченный
          interceptedMethod.__dionResearchIntercepted = true;
          interceptedMethod.__dionResearchOriginal = originalSetParameters;
          
          // Используем defineProperty для надежного перехвата
          Object.defineProperty(window.RTCRtpSender.prototype, 'setParameters', {
            value: interceptedMethod,
            writable: true,
            configurable: true,
            enumerable: true
          });
          
          // КРИТИЧНО: Также перехватываем через присваивание (на случай, если defineProperty не сработает)
          window.RTCRtpSender.prototype.setParameters = interceptedMethod;
          
          // Проверяем, что перехват установлен
          const checkDescriptor = Object.getOwnPropertyDescriptor(window.RTCRtpSender.prototype, 'setParameters');
          console.log('🔍 Проверка перехвата:', {
            descriptor: checkDescriptor,
            value: checkDescriptor?.value,
            isIntercepted: checkDescriptor?.value === interceptedMethod,
            prototypeValue: window.RTCRtpSender.prototype.setParameters,
            isIntercepted2: window.RTCRtpSender.prototype.setParameters === interceptedMethod
          });
          
          console.log('✅ RTCRtpSender.setParameters перехвачен на прототипе через defineProperty');
          return true;
        }
      } catch (e) {
        console.error('❌ Ошибка при перехвате RTCRtpSender.setParameters:', e);
      }
    }
    return false;
  }
  
  // УДАЛЕНО: Весь код перехвата setParameters, так как он не нужен для основной задачи
  
  // КРИТИЧНО: Перехватываем методы на ПРОТОТИПЕ ПЕРВЫМИ (до перехвата конструктора)
  // Это позволит видеть все вызовы, даже если content.js перехватил конструктор раньше
  if (window.RTCPeerConnection && window.RTCPeerConnection.prototype) {
    console.log('✅ RTCPeerConnection найден');
    console.log('RTCPeerConnection:', window.RTCPeerConnection);
    console.log('RTCPeerConnection.prototype:', window.RTCPeerConnection.prototype);
    
    // getTransceivers на прототипе (с обертыванием transceivers в Proxy для перехвата setParameters)
    const originalGetTransceivers = window.RTCPeerConnection.prototype.getTransceivers;
    if (originalGetTransceivers) {
      
      window.RTCPeerConnection.prototype.getTransceivers = function() {
        console.log('🔍🔍🔍 getTransceivers ВЫЗВАН!', this, new Error().stack);
        const transceivers = originalGetTransceivers.call(this);
        console.log('🔍🔍🔍 getTransceivers вернул:', transceivers.length, 'transceivers');
        
        // Обертываем transceivers в Proxy для перехвата setParameters
        const wrappedTransceivers = transceivers.map(t => {
          console.log('🔍 Обертываем transceiver:', t.mid, t.direction);
          return wrapTransceiver(t);
        });
        
        const log = {
          type: 'getTransceivers_called',
          timestamp: new Date().toISOString(),
          pc: this,
          transceiversCount: wrappedTransceivers.length,
          transceivers: wrappedTransceivers.map(t => ({
            mid: t.mid,
            direction: t.direction,
            stopped: t.stopped,
            senderTrack: t.sender?.track ? {
              id: t.sender.track.id,
              kind: t.sender.track.kind,
              label: t.sender.track.label,
              readyState: t.sender.track.readyState,
              enabled: t.sender.track.enabled,
              muted: t.sender.track.muted
            } : null,
            receiverTrack: t.receiver?.track ? {
              id: t.receiver.track.id,
              kind: t.receiver.track.kind,
              label: t.receiver.track.label,
              readyState: t.receiver.track.readyState,
              enabled: t.receiver.track.enabled,
              muted: t.receiver.track.muted
            } : null
          })),
          stack: new Error().stack
        };
        
        logs.push(log);
        console.log('🔍 getTransceivers вызван (прототип):', log);
        
        return wrappedTransceivers;
      };
      console.log('✅ getTransceivers перехвачен на прототипе (с Proxy для setParameters)');
    }
    
    // getSenders на прототипе - КРИТИЧНО! Оборачиваем senders в Proxy для перехвата setParameters
    const originalGetSenders = window.RTCPeerConnection.prototype.getSenders;
    if (originalGetSenders) {
      window.RTCPeerConnection.prototype.getSenders = function() {
        const senders = originalGetSenders.call(this);
        
        // Оборачиваем каждый sender в Proxy для перехвата setParameters
        const wrappedSenders = senders.map(sender => {
          if (!sender || sender.__dionResearchSenderWrapped) {
            return sender;
          }
          
          console.log('🔍 Обертываем sender в Proxy для перехвата setParameters');
          
          // Сохраняем оригинальный setParameters
          const originalSetParameters = sender.setParameters;
          
          const wrappedSender = new Proxy(sender, {
            get: function(target, prop) {
              if (prop === 'setParameters') {
                console.log('🔍🔍🔍 Доступ к setParameters через Proxy sender!');
                console.log('🔍 Stack trace доступа:', new Error().stack);
                
                // Возвращаем обернутый метод
                return function(params) {
                  console.log('🔍🔍🔍 RTCRtpSender.setParameters ВЫЗВАН через Proxy sender!', params);
                  console.log('🔍 Stack trace вызова:', new Error().stack);
                  
                  const log = {
                    type: 'setParameters_called',
                    timestamp: new Date().toISOString(),
                    method: 'RTCRtpSender.setParameters (Proxy sender)',
                    sender: {
                      track: target.track ? {
                        id: target.track.id,
                        kind: target.track.kind,
                        label: target.track.label,
                        readyState: target.track.readyState
                      } : null
                    },
                    params: params,
                    stack: new Error().stack
                  };
                  
                  logs.push(log);
                  console.log('🔍 RTCRtpSender.setParameters вызван (Proxy sender):', log);
                  
                  // Вызываем оригинальный метод
                  if (originalSetParameters && typeof originalSetParameters === 'function') {
                    return originalSetParameters.call(target, params);
                  } else {
                    // Если оригинальный метод не найден, пытаемся найти его на прототипе
                    const protoMethod = Object.getPrototypeOf(target).setParameters;
                    if (protoMethod && typeof protoMethod === 'function') {
                      return protoMethod.call(target, params);
                    }
                  }
                  
                  return Promise.resolve();
                };
              }
              return target[prop];
            }
          });
          
          wrappedSender.__dionResearchSenderWrapped = true;
          return wrappedSender;
        });
        
        const log = {
          type: 'getSenders_called',
          timestamp: new Date().toISOString(),
          pc: this,
          sendersCount: wrappedSenders.length,
          senders: wrappedSenders.map(s => ({
            track: s.track ? {
              id: s.track.id,
              kind: s.track.kind,
              label: s.track.label,
              readyState: s.track.readyState,
              enabled: s.track.enabled,
              muted: s.track.muted
            } : null
          })),
          stack: new Error().stack
        };
        
        logs.push(log);
        console.log('🔍 getSenders вызван (прототип), обернуто senders:', wrappedSenders.length);
        
        return wrappedSenders;
      };
      console.log('✅ getSenders перехвачен на прототипе (с Proxy для setParameters)');
    }
    
    // addTrack на прототипе
    const originalAddTrack = window.RTCPeerConnection.prototype.addTrack;
    if (originalAddTrack) {
      window.RTCPeerConnection.prototype.addTrack = function(track, ...streams) {
        const log = {
          type: 'addTrack_called',
          timestamp: new Date().toISOString(),
          pc: this,
          track: track ? {
            id: track.id,
            kind: track.kind,
            label: track.label,
            readyState: track.readyState,
            enabled: track.enabled,
            muted: track.muted
          } : null,
          streamsCount: streams.length,
          stack: new Error().stack
        };
        
        logs.push(log);
        console.log('🔍 addTrack вызван (прототип):', log);
        
        const result = originalAddTrack.call(this, track, ...streams);
        
        // Если addTrack возвращает RTCRtpSender, оборачиваем его transceiver
        if (result && result.transceiver) {
          console.log('🔍 addTrack вернул sender с transceiver, оборачиваем...');
          result.transceiver = wrapTransceiver(result.transceiver);
        }
        
        return result;
      };
      console.log('✅ addTrack перехвачен на прототипе');
    }
    
    // addTransceiver на прототипе - КРИТИЧНО! dion.vc может использовать это
    const originalAddTransceiver = window.RTCPeerConnection.prototype.addTransceiver;
    if (originalAddTransceiver) {
      window.RTCPeerConnection.prototype.addTransceiver = function(trackOrKind, init) {
        console.log('🔍🔍🔍 addTransceiver ВЫЗВАН!', trackOrKind, init);
        
        const result = originalAddTransceiver.call(this, trackOrKind, init);
        
        // Оборачиваем возвращаемый transceiver в Proxy
        if (result && result.transceiver) {
          console.log('🔍 addTransceiver вернул transceiver, оборачиваем в Proxy:', result.transceiver.mid);
          result.transceiver = wrapTransceiver(result.transceiver);
        } else if (result) {
          // Если result сам является transceiver
          console.log('🔍 addTransceiver вернул transceiver напрямую, оборачиваем:', result.mid);
          const wrapped = wrapTransceiver(result);
          
          const log = {
            type: 'addTransceiver_called',
            timestamp: new Date().toISOString(),
            pc: this,
            trackOrKind: typeof trackOrKind === 'string' ? trackOrKind : (trackOrKind ? {
              id: trackOrKind.id,
              kind: trackOrKind.kind,
              label: trackOrKind.label
            } : null),
            init: init,
            transceiver: {
              mid: wrapped.mid,
              direction: wrapped.direction,
              stopped: wrapped.stopped
            },
            stack: new Error().stack
          };
          
          logs.push(log);
          console.log('🔍 addTransceiver вызван (прототип):', log);
          
          return wrapped;
        }
        
        const log = {
          type: 'addTransceiver_called',
          timestamp: new Date().toISOString(),
          pc: this,
          trackOrKind: typeof trackOrKind === 'string' ? trackOrKind : (trackOrKind ? {
            id: trackOrKind.id,
            kind: trackOrKind.kind,
            label: trackOrKind.label
          } : null),
          init: init,
          result: result,
          stack: new Error().stack
        };
        
        logs.push(log);
        console.log('🔍 addTransceiver вызван (прототип):', log);
        
        return result;
      };
      console.log('✅ addTransceiver перехвачен на прототипе');
    }
  }
  
  // 1. Наблюдаем за созданием RTCPeerConnection (после перехвата методов на прототипе)
  const originalRTCPeerConnection = window.RTCPeerConnection;
  if (originalRTCPeerConnection) {
    // Перехватываем конструктор ТОЛЬКО для логирования
    // ВАЖНО: Сохраняем ссылку на оригинальный конструктор из замыкания
    const OriginalRTCPeerConnectionConstructor = originalRTCPeerConnection;
    
    window.RTCPeerConnection = function(...args) {
      const pc = new OriginalRTCPeerConnectionConstructor(...args);
      
      const log = {
        type: 'RTCPeerConnection_created',
        timestamp: new Date().toISOString(),
        args: args,
        pc: pc,
        stack: new Error().stack
      };
      
      logs.push(log);
      console.log('🔍 RTCPeerConnection создан:', log);
      
      // Наблюдаем за методами этого PC (дополнительно к перехвату на прототипе)
      observePeerConnection(pc);
      
      return pc;
    };
    
    // Копируем прототип
    Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnectionConstructor);
    Object.setPrototypeOf(window.RTCPeerConnection.prototype, OriginalRTCPeerConnectionConstructor.prototype);
    
    // Копируем статические свойства
    Object.getOwnPropertyNames(OriginalRTCPeerConnectionConstructor).forEach(name => {
      try {
        window.RTCPeerConnection[name] = OriginalRTCPeerConnectionConstructor[name];
      } catch (e) {}
    });
    
    console.log('✅ RTCPeerConnection конструктор перехвачен');
  }
  
  // 2. Перехватываем методы на ПРОТОТИПЕ (дублируем для надежности) - УДАЛЕНО, уже сделано выше
  
  // 3. Наблюдаем за методами конкретного RTCPeerConnection (для дополнительного логирования)
  function observePeerConnection(pc) {
    // getTransceivers
    const originalGetTransceivers = pc.getTransceivers;
    if (originalGetTransceivers) {
      pc.getTransceivers = function() {
        const transceivers = originalGetTransceivers.call(this);
        
        const log = {
          type: 'getTransceivers_called',
          timestamp: new Date().toISOString(),
          pc: this,
          transceiversCount: transceivers.length,
          transceivers: transceivers.map(t => ({
            mid: t.mid,
            direction: t.direction,
            stopped: t.stopped,
            senderTrack: t.sender?.track ? {
              id: t.sender.track.id,
              kind: t.sender.track.kind,
              label: t.sender.track.label,
              readyState: t.sender.track.readyState,
              enabled: t.sender.track.enabled,
              muted: t.sender.track.muted
            } : null,
            receiverTrack: t.receiver?.track ? {
              id: t.receiver.track.id,
              kind: t.receiver.track.kind,
              label: t.receiver.track.label,
              readyState: t.receiver.track.readyState,
              enabled: t.receiver.track.enabled,
              muted: t.receiver.track.muted
            } : null
          })),
          stack: new Error().stack
        };
        
        logs.push(log);
        console.log('🔍 getTransceivers вызван:', log);
        
        return transceivers;
      };
    }
    
    // getSenders
    const originalGetSenders = pc.getSenders;
    if (originalGetSenders) {
      pc.getSenders = function() {
        const senders = originalGetSenders.call(this);
        
        const log = {
          type: 'getSenders_called',
          timestamp: new Date().toISOString(),
          pc: this,
          sendersCount: senders.length,
          senders: senders.map(s => ({
            track: s.track ? {
              id: s.track.id,
              kind: s.track.kind,
              label: s.track.label,
              readyState: s.track.readyState,
              enabled: s.track.enabled,
              muted: s.track.muted
            } : null
          })),
          stack: new Error().stack
        };
        
        logs.push(log);
        console.log('🔍 getSenders вызван:', log);
        
        return senders;
      };
    }
    
    // addTrack
    const originalAddTrack = pc.addTrack;
    if (originalAddTrack) {
      pc.addTrack = function(track, ...streams) {
        const log = {
          type: 'addTrack_called',
          timestamp: new Date().toISOString(),
          pc: this,
          track: track ? {
            id: track.id,
            kind: track.kind,
            label: track.label,
            readyState: track.readyState,
            enabled: track.enabled,
            muted: track.muted
          } : null,
          streams: streams.map(s => ({
            id: s.id,
            audioTracks: s.getAudioTracks().map(t => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState
            })),
            videoTracks: s.getVideoTracks().map(t => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState
            }))
          })),
          stack: new Error().stack
        };
        
        logs.push(log);
        console.log('🔍 addTrack вызван:', log);
        
        return originalAddTrack.call(this, track, ...streams);
      };
    }
  }
  
  // 3. Наблюдаем за getUserMedia
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = function(constraints) {
      const log = {
        type: 'getUserMedia_called',
        timestamp: new Date().toISOString(),
        constraints: constraints,
        stack: new Error().stack
      };
      
      logs.push(log);
      console.log('🔍 getUserMedia вызван:', log);
      
      return originalGetUserMedia.call(this, constraints).then(stream => {
        const streamLog = {
          type: 'getUserMedia_resolved',
          timestamp: new Date().toISOString(),
          stream: {
            id: stream.id,
            active: stream.active,
            audioTracks: stream.getAudioTracks().map(t => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted
            })),
            videoTracks: stream.getVideoTracks().map(t => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted
            }))
          }
        };
        
        logs.push(streamLog);
        console.log('🔍 getUserMedia resolved:', streamLog);
        
        return stream;
      });
    };
  }
  
  // 4. КРИТИЧНО: Перехватываем RTCRtpSender.prototype.setParameters
  // dion.vc вызывает transceiver.sender.setParameters(), а не transceiver.setParameters()!
  function interceptSenderSetParameters() {
    if (window.RTCRtpSender && window.RTCRtpSender.prototype) {
      const originalSetParameters = window.RTCRtpSender.prototype.setParameters;
      if (originalSetParameters && typeof originalSetParameters === 'function' && !window.RTCRtpSender.prototype.setParameters.__dionResearchIntercepted) {
        console.log('✅ RTCRtpSender.setParameters найден на прототипе, перехватываем...');
        window.RTCRtpSender.prototype.setParameters = function(params) {
          console.log('🔍🔍🔍 RTCRtpSender.setParameters ВЫЗВАН!', params);
          console.log('🔍 Stack trace вызова:', new Error().stack);
          
          // Пытаемся найти transceiver через sender
          let transceiver = null;
          let transceiverInfo = null;
          
          // Ищем transceiver, который содержит этот sender
          try {
            // Пытаемся найти через getTransceivers всех RTCPeerConnection
            if (window.RTCPeerConnection) {
              for (const key in window) {
                try {
                  const value = window[key];
                  if (value instanceof RTCPeerConnection) {
                    const transceivers = value.getTransceivers();
                    for (const t of transceivers) {
                      if (t.sender === this) {
                        transceiver = t;
                        transceiverInfo = {
                          mid: t.mid,
                          direction: t.direction,
                          stopped: t.stopped,
                          senderTrack: t.sender?.track ? {
                            id: t.sender.track.id,
                            kind: t.sender.track.kind,
                            label: t.sender.track.label,
                            readyState: t.sender.track.readyState
                          } : null,
                          receiverTrack: t.receiver?.track ? {
                            id: t.receiver.track.id,
                            kind: t.receiver.track.kind,
                            label: t.receiver.track.label,
                            readyState: t.receiver.track.readyState
                          } : null
                        };
                        break;
                      }
                    }
                    if (transceiver) break;
                  }
                } catch (e) {}
              }
            }
          } catch (e) {
            console.error('❌ Ошибка при поиске transceiver:', e);
          }
          
          const log = {
            type: 'setParameters_called',
            timestamp: new Date().toISOString(),
            method: 'RTCRtpSender.setParameters',
            transceiver: transceiverInfo,
            sender: {
              track: this.track ? {
                id: this.track.id,
                kind: this.track.kind,
                label: this.track.label,
                readyState: this.track.readyState
              } : null
            },
            params: params,
            stack: new Error().stack
          };
          
          logs.push(log);
          console.log('🔍 RTCRtpSender.setParameters вызван:', log);
          
          return originalSetParameters.call(this, params);
        };
        window.RTCRtpSender.prototype.setParameters.__dionResearchIntercepted = true;
        console.log('✅ RTCRtpSender.setParameters перехвачен на прототипе');
        return true;
      }
    }
    return false;
  }
  
  // 4. Наблюдаем за RTCRtpTransceiver.setParameters - АГРЕССИВНЫЙ ПЕРЕХВАТ (на случай, если используется)
  function interceptSetParameters() {
    if (window.RTCRtpTransceiver && window.RTCRtpTransceiver.prototype) {
      const originalSetParameters = window.RTCRtpTransceiver.prototype.setParameters;
      if (originalSetParameters && !window.RTCRtpTransceiver.prototype.setParameters.__dionResearchIntercepted) {
        console.log('✅ setParameters найден на прототипе, перехватываем...');
        window.RTCRtpTransceiver.prototype.setParameters = function(params) {
          console.log('🔍🔍🔍 setParameters ВЫЗВАН напрямую на прототипе!', this.mid, params);
          const log = {
            type: 'setParameters_called',
            timestamp: new Date().toISOString(),
            method: 'RTCRtpTransceiver.setParameters',
            transceiver: {
              mid: this.mid,
              direction: this.direction,
              stopped: this.stopped,
              senderTrack: this.sender?.track ? {
                id: this.sender.track.id,
                kind: this.sender.track.kind,
                label: this.sender.track.label,
                readyState: this.sender.track.readyState
              } : null,
              receiverTrack: this.receiver?.track ? {
                id: this.receiver.track.id,
                kind: this.receiver.track.kind,
                label: this.receiver.track.label,
                readyState: this.receiver.track.readyState
              } : null
            },
            params: params,
            stack: new Error().stack
          };
          
          logs.push(log);
          console.log('🔍 setParameters вызван:', log);
          
          return originalSetParameters.call(this, params);
        };
        window.RTCRtpTransceiver.prototype.setParameters.__dionResearchIntercepted = true;
        console.log('✅ setParameters перехвачен на прототипе');
        return true;
      }
    }
    return false;
  }
  
  // КРИТИЧНО: Перехватываем RTCRtpSender.setParameters ПЕРВЫМ (это то, что использует dion.vc!)
  if (!interceptSenderSetParameters()) {
    console.log('⚠️ RTCRtpSender.setParameters не найден на прототипе, пытаемся найти позже...');
    
    // Пытаемся найти позже - несколько попыток
    let attempts = 0;
    const maxAttempts = 20;
    const checkInterval = setInterval(() => {
      attempts++;
      if (interceptSenderSetParameters()) {
        clearInterval(checkInterval);
        console.log(`✅ RTCRtpSender.setParameters найден и перехвачен после ${attempts} попыток`);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.log('⚠️ RTCRtpSender.setParameters не найден после всех попыток');
        console.log('🔍 Пробуем перехватить через Object.defineProperty на прототипе...');
        
        // Последняя попытка - через Object.defineProperty для RTCRtpSender
        if (window.RTCRtpSender && window.RTCRtpSender.prototype) {
          try {
            const originalDescriptor = Object.getOwnPropertyDescriptor(window.RTCRtpSender.prototype, 'setParameters');
            const originalMethod = originalDescriptor ? originalDescriptor.value : null;
            
            if (originalMethod && typeof originalMethod === 'function') {
              Object.defineProperty(window.RTCRtpSender.prototype, 'setParameters', {
                value: function(params) {
                  console.log('🔍🔍🔍 RTCRtpSender.setParameters ВЫЗВАН через defineProperty!', params);
                  console.log('🔍 Stack trace вызова:', new Error().stack);
                  
                  const log = {
                    type: 'setParameters_called',
                    timestamp: new Date().toISOString(),
                    method: 'RTCRtpSender.setParameters (defineProperty)',
                    sender: {
                      track: this.track ? {
                        id: this.track.id,
                        kind: this.track.kind,
                        label: this.track.label,
                        readyState: this.track.readyState
                      } : null
                    },
                    params: params,
                    stack: new Error().stack
                  };
                  
                  logs.push(log);
                  console.log('🔍 RTCRtpSender.setParameters вызван (defineProperty):', log);
                  
                  return originalMethod.call(this, params);
                },
                writable: true,
                configurable: true
              });
              console.log('✅ RTCRtpSender.setParameters перехвачен через defineProperty');
            }
          } catch (e) {
            console.error('❌ Ошибка при перехвате RTCRtpSender.setParameters через defineProperty:', e);
          }
        }
      }
    }, 500);
  }
  
  // Также перехватываем RTCRtpTransceiver.setParameters (на случай, если используется)
  if (!interceptSetParameters()) {
    console.log('⚠️ setParameters не найден на прототипе, пытаемся найти позже...');
    
    // Пытаемся найти позже - несколько попыток
    let attempts = 0;
    const maxAttempts = 20; // Увеличиваем количество попыток
    const checkInterval = setInterval(() => {
      attempts++;
      if (interceptSetParameters()) {
        clearInterval(checkInterval);
        console.log(`✅ setParameters найден и перехвачен после ${attempts} попыток`);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.log('⚠️ setParameters не найден после всех попыток');
        console.log('🔍 Пробуем перехватить через Object.defineProperty на прототипе...');
        
        // Последняя попытка - через Object.defineProperty
        if (window.RTCRtpTransceiver && window.RTCRtpTransceiver.prototype) {
          try {
            // Сохраняем оригинальный метод, если он есть
            const originalDescriptor = Object.getOwnPropertyDescriptor(window.RTCRtpTransceiver.prototype, 'setParameters');
            const originalMethod = originalDescriptor ? originalDescriptor.value : null;
            
            Object.defineProperty(window.RTCRtpTransceiver.prototype, 'setParameters', {
              value: function(params) {
                console.log('🔍🔍🔍 setParameters ВЫЗВАН через defineProperty!', this.mid, params);
                const log = {
                  type: 'setParameters_called',
                  timestamp: new Date().toISOString(),
                  transceiver: {
                    mid: this.mid,
                    direction: this.direction,
                    stopped: this.stopped,
                    senderTrack: this.sender?.track ? {
                      id: this.sender.track.id,
                      kind: this.sender.track.kind,
                      label: this.sender.track.label,
                      readyState: this.sender.track.readyState
                    } : null,
                    receiverTrack: this.receiver?.track ? {
                      id: this.receiver.track.id,
                      kind: this.receiver.track.kind,
                      label: this.receiver.track.label,
                      readyState: this.receiver.track.readyState
                    } : null
                  },
                  params: params,
                  stack: new Error().stack
                };
                
                logs.push(log);
                console.log('🔍 setParameters вызван (defineProperty):', log);
                
                // Пытаемся вызвать оригинальный метод
                if (originalMethod && typeof originalMethod === 'function') {
                  return originalMethod.call(this, params);
                }
                
                // Если оригинальный метод не найден, пытаемся найти его в цепочке прототипов
                let proto = Object.getPrototypeOf(this);
                while (proto) {
                  const protoDescriptor = Object.getOwnPropertyDescriptor(proto, 'setParameters');
                  if (protoDescriptor && typeof protoDescriptor.value === 'function') {
                    return protoDescriptor.value.call(this, params);
                  }
                  proto = Object.getPrototypeOf(proto);
                }
                
                // Если оригинальный метод не найден, возвращаем Promise
                console.warn('⚠️ Оригинальный setParameters не найден, возвращаем Promise.resolve()');
                return Promise.resolve();
              },
              writable: true,
              configurable: true,
              enumerable: true
            });
            console.log('✅ setParameters перехвачен через defineProperty');
          } catch (e) {
            console.error('❌ Ошибка при перехвате через defineProperty:', e);
          }
        }
      }
    }, 500);
  }
  
  // 5. Наблюдаем за изменениями треков
  try {
    if (window.MediaStreamTrack && window.MediaStreamTrack.prototype) {
      const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(window.MediaStreamTrack.prototype, 'readyState');
      if (originalReadyStateDescriptor && originalReadyStateDescriptor.get) {
        const originalGetter = originalReadyStateDescriptor.get;
        Object.defineProperty(window.MediaStreamTrack.prototype, 'readyState', {
          get: function() {
            const state = originalGetter.call(this);
            
            if (this.kind === 'audio' && state === 'live') {
              const log = {
                type: 'audioTrack_became_live',
                timestamp: new Date().toISOString(),
                track: {
                  id: this.id,
                  kind: this.kind,
                  label: this.label,
                  enabled: this.enabled,
                  muted: this.muted,
                  readyState: state
                },
                stack: new Error().stack
              };
              
              logs.push(log);
              console.log('🔍 Аудио трек стал live:', log);
            }
            
            return state;
          },
          configurable: true,
          enumerable: true
        });
      }
    }
  } catch (e) {
    console.warn('⚠️ Ошибка при перехвате readyState:', e);
  }
  
  // 6. Периодически ищем все RTCPeerConnection и оборачиваем их transceivers в Proxy
  const foundPCs = new WeakSet(); // Храним найденные PC, чтобы не обрабатывать повторно
  const foundTransceivers = new WeakSet(); // Храним найденные transceivers
  function wrapAllTransceivers() {
    try {
      // Ищем все RTCPeerConnection через различные способы
      const allPCs = [];
      
      // Способ 1: через window (если они там есть)
      for (const key in window) {
        try {
          const value = window[key];
          if (value && value.constructor && value.constructor.name === 'RTCPeerConnection') {
            if (!foundPCs.has(value)) {
              allPCs.push(value);
              foundPCs.add(value);
            }
          }
        } catch (e) {}
      }
      
      // Способ 2: через getTransceivers (если они вызываются)
      allPCs.forEach(pc => {
        try {
          if (pc.getTransceivers) {
            const transceivers = pc.getTransceivers();
            transceivers.forEach(t => {
              if (t && !foundTransceivers.has(t)) {
                console.log('🔍 Найден transceiver через getTransceivers, оборачиваем:', t.mid);
                const wrapped = wrapTransceiver(t);
                foundTransceivers.add(t);
                foundTransceivers.add(wrapped);
                
                // КРИТИЧНО: Перехватываем setParameters напрямую на экземпляре
                // Пытаемся найти метод разными способами
                let originalSetParameters = null;
                if (t.setParameters && typeof t.setParameters === 'function') {
                  originalSetParameters = t.setParameters;
                } else if (Object.getPrototypeOf(t).setParameters && typeof Object.getPrototypeOf(t).setParameters === 'function') {
                  originalSetParameters = Object.getPrototypeOf(t).setParameters;
                } else if (t.constructor && t.constructor.prototype && t.constructor.prototype.setParameters) {
                  originalSetParameters = t.constructor.prototype.setParameters;
                }
                
                if (originalSetParameters) {
                  t.setParameters = function(params) {
                    console.log('🔍🔍🔍 setParameters ВЫЗВАН напрямую на экземпляре!', this.mid, params);
                    const log = {
                      type: 'setParameters_called',
                      timestamp: new Date().toISOString(),
                      transceiver: {
                        mid: this.mid,
                        direction: this.direction,
                        stopped: this.stopped,
                        senderTrack: this.sender?.track ? {
                          id: this.sender.track.id,
                          kind: this.sender.track.kind,
                          label: this.sender.track.label,
                          readyState: this.sender.track.readyState
                        } : null,
                        receiverTrack: this.receiver?.track ? {
                          id: this.receiver.track.id,
                          kind: this.receiver.track.kind,
                          label: this.receiver.track.label,
                          readyState: this.receiver.track.readyState
                        } : null
                      },
                      params: params,
                      stack: new Error().stack
                    };
                    
                    logs.push(log);
                    console.log('🔍 setParameters вызван (напрямую на экземпляре):', log);
                    
                    return originalSetParameters.call(this, params);
                  };
                  console.log('✅ setParameters перехвачен напрямую на экземпляре transceiver:', t.mid);
                } else {
                  console.log('⚠️ setParameters не найден на transceiver:', t.mid);
                }
              }
            });
          }
        } catch (e) {
          console.error('❌ Ошибка при обработке transceivers:', e);
        }
      });
      
      if (allPCs.length > 0) {
        console.log(`🔍 Найдено новых RTCPeerConnection: ${allPCs.length}`);
      }
    } catch (e) {
      // Игнорируем ошибки
    }
  }
  
  // Запускаем периодический поиск
  setInterval(wrapAllTransceivers, 2000);
  
  // 7. Обновляем ссылку на logs (она уже создана выше)
  // window.__dionResearch уже создан в начале, просто обновляем ссылку на logs
  try {
    window.__dionResearch.logs = logs;
    
    // Слушаем запросы от inject.js (контекст страницы)
    document.addEventListener('__dionResearchRequestLogs', function(event) {
      try {
        const { requestId, type } = event.detail;
        let responseLogs = [];
        
        if (type === 'all') {
          responseLogs = logs;
        } else if (type === 'summary') {
          responseLogs = {
            totalLogs: logs.length,
            byType: {},
            peerConnections: [],
            audioTracks: []
          };
          logs.forEach(log => {
            responseLogs.byType[log.type] = (responseLogs.byType[log.type] || 0) + 1;
            if (log.type === 'RTCPeerConnection_created') responseLogs.peerConnections.push(log);
            if (log.type === 'audioTrack_became_live') responseLogs.audioTracks.push(log);
          });
        } else {
          responseLogs = logs.filter(log => log.type === type);
        }
        
        const responseEvent = new CustomEvent('__dionResearchResponseLogs', {
          detail: { requestId, logs: responseLogs, type }
        });
        document.dispatchEvent(responseEvent);
      } catch (e) {
        // Игнорируем ошибки
      }
    });
    
    // Периодически отправляем обновления в контекст страницы
    setInterval(() => {
      try {
        const responseEvent = new CustomEvent('__dionResearchUpdate', {
          detail: { logs: logs }
        });
        document.dispatchEvent(responseEvent);
      } catch (e) {
        // Игнорируем ошибки
      }
    }, 1000);
    
  // КРИТИЧНО: Периодически ищем все существующие senders и оборачиваем их в Proxy
  function wrapAllSenders() {
    try {
      // Ищем все RTCPeerConnection
      const allPCs = [];
      for (const key in window) {
        try {
          const value = window[key];
          if (value instanceof RTCPeerConnection) {
            allPCs.push(value);
          }
        } catch (e) {}
      }
      
      // Для каждого PC получаем senders и оборачиваем их
      allPCs.forEach(pc => {
        try {
          const senders = pc.getSenders();
          senders.forEach(sender => {
            if (sender && !sender.__dionResearchSenderWrapped) {
              console.log('🔍 Найден sender, оборачиваем в Proxy:', sender.track?.id);
              const wrapped = wrapSender(sender);
              // Заменяем sender в массиве (хотя это не поможет, если dion.vc сохранил ссылку)
              const index = senders.indexOf(sender);
              if (index !== -1) {
                senders[index] = wrapped;
              }
            }
          });
          
          // Также получаем transceivers и оборачиваем их senders
          const transceivers = pc.getTransceivers();
          transceivers.forEach(transceiver => {
            if (transceiver && transceiver.sender && !transceiver.sender.__dionResearchSenderWrapped) {
              console.log('🔍 Найден sender через transceiver, оборачиваем в Proxy:', transceiver.mid);
              transceiver.sender = wrapSender(transceiver.sender);
            }
          });
        } catch (e) {
          console.error('❌ Ошибка при оборачивании senders:', e);
        }
      });
      
      console.log(`🔍 Проверено RTCPeerConnection: ${allPCs.length}`);
    } catch (e) {
      console.error('❌ Ошибка при поиске senders:', e);
    }
  }
  
  // Запускаем периодический поиск senders
  setInterval(wrapAllSenders, 1000); // Каждую секунду
  
  // ДОПОЛНИТЕЛЬНО: Добавляем глобальную функцию для отладки в консоли
  window.__dionResearchDebug = {
    // Перехватывает setParameters и показывает stack trace
    interceptSetParameters: function() {
      if (window.RTCRtpSender && window.RTCRtpSender.prototype) {
        const original = window.RTCRtpSender.prototype.setParameters;
        window.RTCRtpSender.prototype.setParameters = function(...args) {
          console.log('🔍🔍🔍 DEBUG: setParameters вызван!', this, args);
          console.log('🔍 Stack trace:', new Error().stack);
          console.log('🔍 Sender object:', this);
          console.log('🔍 Is Proxy?', this instanceof Proxy);
          console.log('🔍 __dionResearchSenderWrapped?', this.__dionResearchSenderWrapped);
          return original.apply(this, args);
        };
        console.log('✅ DEBUG: setParameters перехвачен для отладки');
        return true;
      }
      return false;
    },
    // Проверяет, перехвачен ли setParameters на прототипе
    checkInterception: function() {
      if (window.RTCRtpSender && window.RTCRtpSender.prototype) {
        const method = window.RTCRtpSender.prototype.setParameters;
        console.log('🔍 Проверка перехвата setParameters:', {
          method: method,
          isFunction: typeof method === 'function',
          isIntercepted: method.__dionResearchIntercepted,
          toString: method.toString().substring(0, 200)
        });
        return method;
      }
      return null;
    },
    // Показывает все senders в текущих RTCPeerConnection
    showAllSenders: function() {
      const allPCs = [];
      for (const key in window) {
        try {
          const value = window[key];
          if (value instanceof RTCPeerConnection) {
            allPCs.push(value);
          }
        } catch (e) {}
      }
      
      console.log(`Найдено RTCPeerConnection: ${allPCs.length}`);
      allPCs.forEach((pc, index) => {
        try {
          const senders = pc.getSenders();
          const transceivers = pc.getTransceivers();
          console.log(`PC ${index}:`, {
            senders: senders.map(s => ({
              track: s.track?.id,
              setParameters: typeof s.setParameters,
              isProxy: s instanceof Proxy,
              wrapped: s.__dionResearchSenderWrapped
            })),
            transceivers: transceivers.map(t => ({
              mid: t.mid,
              sender: {
                track: t.sender?.track?.id,
                setParameters: typeof t.sender?.setParameters,
                isProxy: t.sender instanceof Proxy,
                wrapped: t.sender?.__dionResearchSenderWrapped
              }
            }))
          });
        } catch (e) {
          console.error(`Ошибка при проверке PC ${index}:`, e);
        }
      });
    }
  };
  
  console.log('✅ Инструмент исследования установлен');
  console.log('Используйте window.__dionResearch.printSummary() для сводки');
  console.log('Используйте window.__dionResearch.getLogs() для всех логов');
  console.log('Используйте window.__dionResearchDebug.interceptSetParameters() для отладки');
  console.log('Используйте window.__dionResearchDebug.showAllSenders() для просмотра всех senders');
    
    // Загружаем inject.js в контекст страницы, чтобы создать window.__dionResearch
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      script.onload = function() {
        console.log('✅ inject.js загружен в контекст страницы');
      };
      script.onerror = function() {
        console.error('❌ Ошибка загрузки inject.js');
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.error('❌ Ошибка при загрузке inject.js:', e);
    }
  } catch (e) {
    console.error('❌ Ошибка при обновлении инструмента исследования:', e);
    console.error('Stack:', e.stack);
  }
})();

