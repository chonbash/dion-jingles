// Content script для инжекта в страницу dion.vc

// КРИТИЧНО: Перехватываем RTCPeerConnection ДО всего остального
// Это должно быть выполнено как можно раньше, до загрузки приложения
(function() {
  'use strict';
  const DION_DEBUG_BUILD = 'dbg-8ca4bb-r4';
  
  // Сохраняем оригинальный RTCPeerConnection в замыкании (чтобы избежать рекурсии)
  let OriginalRTCPeerConnection = null;
  let isIntercepted = false;
  
  // Сохраняем все созданные RTCPeerConnection до создания player
  // Когда player будет создан, добавим трек во все сохраненные PC
  // Используем window для доступа из других областей видимости
  if (!window.__dionJinglesPendingPCs) {
    window.__dionJinglesPendingPCs = [];
  }
  const pendingPCs = window.__dionJinglesPendingPCs;
  
  // Функция для установки перехвата
  function setupEarlyInterception() {
    // Если уже перехвачено, не делаем ничего
    if (isIntercepted) {
      return;
    }
    
    // Если RTCPeerConnection еще не загружен, ждем
    if (!window.RTCPeerConnection) {
      setTimeout(setupEarlyInterception, 10);
      return;
    }
    
    // КРИТИЧНО: Проверяем, не перехвачен ли уже через другой механизм
    // Если RTCPeerConnection уже перехвачен нашим скриптом, не делаем ничего
    if (window.RTCPeerConnection.__dionJinglesIntercepted) {
      console.log('[DionJingles] RTCPeerConnection уже перехвачен через другой механизм');
      isIntercepted = true;
      return;
    }
    
    // Сохраняем оригинальный RTCPeerConnection (только один раз)
    if (!OriginalRTCPeerConnection) {
      OriginalRTCPeerConnection = window.RTCPeerConnection;
    }
    
    // Если уже перехвачен через другой механизм, не делаем ничего
    if (window.RTCPeerConnection.__dionJinglesIntercepted) {
      isIntercepted = true;
      return;
    }
    
    // Перехватываем конструктор
    const InterceptedRTCPeerConnection = function(...args) {
      const pc = new OriginalRTCPeerConnection(...args);
      // #region agent log
      fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H1',location:'content.js:InterceptedRTCPeerConnection',message:'RTCPeerConnection created',data:{hasPlayer:!!window.dionJinglesPlayer,hasJinglesTrack:!!(window.dionJinglesPlayer&&window.dionJinglesPlayer.jinglesTrack),pendingPCsCount:(window.__dionJinglesPendingPCs||[]).length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      
      console.log('[DionJingles] 🔍 RTCPeerConnection создан (ранний перехват)');
      console.log('[DionJingles] Stack trace:', new Error().stack);
      
      // НОВЫЙ ПОДХОД: Добавляем трек с звуком аплодисментов в RTCPeerConnection
      // Это делается независимо от микрофона - просто добавляем отдельный трек
      console.log('[DionJingles] Проверка player:', {
        hasPlayer: !!window.dionJinglesPlayer,
        hasJinglesTrack: !!(window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack),
        jinglesTrackId: window.dionJinglesPlayer?.jinglesTrack?.id
      });
      
      if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack) {
        try {
          // Добавляем трек с звуком аплодисментов
          console.log('[DionJingles] Добавляем трек в RTCPeerConnection, track:', window.dionJinglesPlayer.jinglesTrack.id);
          pc.addTrack(window.dionJinglesPlayer.jinglesTrack);
          window.dionJinglesPlayer.jinglesPCs.add(pc);
          console.log('[DionJingles] ✅ Трек с звуком аплодисментов добавлен в RTCPeerConnection');
          
          // Проверяем, что трек действительно добавлен
          setTimeout(() => {
            const senders = pc.getSenders();
            const hasTrack = Array.from(senders).some(s => s.track === window.dionJinglesPlayer.jinglesTrack);
            console.log('[DionJingles] Проверка добавления трека:', {
              sendersCount: senders.length,
              hasTrack: hasTrack,
              tracks: Array.from(senders).map(s => ({ id: s.track?.id, kind: s.track?.kind }))
            });
          }, 100);
        } catch (e) {
          console.error('[DionJingles] ❌ Ошибка при добавлении трека:', e);
          console.error('[DionJingles] Stack:', e.stack);
        }
      } else {
        // Player еще не создан, сохраняем PC для последующего добавления трека
        pendingPCs.push(pc);
        console.log('[DionJingles] ⚠️ Player еще не создан, сохраняем PC для последующего добавления трека. Всего сохранено:', pendingPCs.length);
      }
      
      // КРИТИЧНО: Перехватываем createOffer - добавляем трек ПЕРЕД созданием offer
      // Это гарантирует, что трек попадет в SDP
      const originalCreateOffer = pc.createOffer;
      pc.createOffer = async function(...args) {
        console.log('[DionJingles] 🔍 createOffer вызван, проверяем трек...');
        
        // Добавляем трек ПЕРЕД созданием offer, если его еще нет
        if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack) {
          try {
            const senders = this.getSenders();
            const hasJinglesTrack = Array.from(senders).some(s => s.track === window.dionJinglesPlayer.jinglesTrack);
            
            if (!hasJinglesTrack) {
              console.log('[DionJingles] ✅ Добавляем трек ПЕРЕД createOffer');
              this.addTrack(window.dionJinglesPlayer.jinglesTrack);
              window.dionJinglesPlayer.jinglesPCs.add(this);
              
              // Проверяем через небольшую задержку
              setTimeout(() => {
                const newSenders = this.getSenders();
                const nowHasTrack = Array.from(newSenders).some(s => s.track === window.dionJinglesPlayer.jinglesTrack);
                console.log('[DionJingles] Проверка после добавления трека перед createOffer:', {
                  sendersCount: newSenders.length,
                  hasTrack: nowHasTrack,
                  tracks: Array.from(newSenders).map(s => ({ id: s.track?.id, kind: s.track?.kind }))
                });
              }, 50);
            } else {
              console.log('[DionJingles] Трек уже добавлен перед createOffer');
            }
          } catch (e) {
            console.error('[DionJingles] ❌ Ошибка при добавлении трека перед createOffer:', e);
          }
        }
        
        // Вызываем оригинальный createOffer
        return originalCreateOffer.apply(this, args);
      };
      
      // ДОПОЛНИТЕЛЬНО: Обрабатываем событие "ice end!" (icecandidate с candidate: null)
      // Это означает, что ICE gathering завершен и соединение готово
      // Используем это как дополнительную проверку для замены треков (старый подход)
      const originalOnIceCandidate = pc.onicecandidate;
      pc.onicecandidate = function(event) {
        // Вызываем оригинальный обработчик
        if (originalOnIceCandidate) {
          originalOnIceCandidate.call(pc, event);
        }
        
        // Если candidate === null, это означает "ice end!"
        if (event.candidate === null) {
          console.log('[DionJingles] 🔍 ICE gathering завершен (ice end!), проверяем треки...');
          
          // НОВЫЙ ПОДХОД: Убеждаемся, что трек с звуком добавлен
          if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack) {
            try {
              const senders = pc.getSenders();
              const hasJinglesTrack = Array.from(senders).some(s => s.track === window.dionJinglesPlayer.jinglesTrack);
              if (!hasJinglesTrack) {
                console.log('[DionJingles] Добавляем трек с звуком после ice end!');
                pc.addTrack(window.dionJinglesPlayer.jinglesTrack);
                window.dionJinglesPlayer.jinglesPCs.add(pc);
              }
            } catch (e) {
              console.warn('[DionJingles] Ошибка при добавлении трека после ice end!:', e);
            }
          }
          
          // Старый подход: проверка для замены треков (можно оставить как fallback)
          setTimeout(() => {
            // Проверяем все треки в этом RTCPeerConnection
            try {
              const transceivers = pc.getTransceivers();
              transceivers.forEach(transceiver => {
                if (transceiver.sender && transceiver.sender.track) {
                  const track = transceiver.sender.track;
                  if (track.kind === 'audio' && track.readyState === 'live') {
                    console.log('[DionJingles] ✅ Найден живой аудио трек после ice end!:', track.id);
                    // Если есть глобальный player, попробуем обработать трек
                    if (window.dionJinglesPlayer) {
                      window.dionJinglesPlayer.findAndProcessAudioTrack(track);
                    }
                  }
                }
              });
              
              const senders = pc.getSenders();
              senders.forEach(sender => {
                if (sender.track && sender.track.kind === 'audio' && sender.track.readyState === 'live') {
                  console.log('[DionJingles] ✅ Найден живой аудио трек в sender после ice end!:', sender.track.id);
                  if (window.dionJinglesPlayer) {
                    window.dionJinglesPlayer.findAndProcessAudioTrack(sender.track);
                  }
                }
              });
            } catch (e) {
              console.warn('[DionJingles] Ошибка при проверке треков после ice end!:', e);
            }
          }, 100);
        }
      };
      
      // Сохраняем для последующей обработки
      if (!window.__dionJinglesPCs) {
        window.__dionJinglesPCs = [];
      }
      window.__dionJinglesPCs.push(pc);
      
      return pc;
    };
    
    // Копируем статические свойства и методы
    Object.setPrototypeOf(InterceptedRTCPeerConnection, OriginalRTCPeerConnection);
    Object.setPrototypeOf(InterceptedRTCPeerConnection.prototype, OriginalRTCPeerConnection.prototype);
    
    // КРИТИЧНО: Перехватываем createOffer на прототипе
    // Это гарантирует, что трек будет добавлен ПЕРЕД созданием offer для всех PC
    if (OriginalRTCPeerConnection.prototype.createOffer) {
      const originalCreateOfferProto = OriginalRTCPeerConnection.prototype.createOffer;
      OriginalRTCPeerConnection.prototype.createOffer = async function(...args) {
        console.log('[DionJingles] 🔍 createOffer вызван (прототип), проверяем трек...');
        
        // Добавляем трек ПЕРЕД созданием offer, если его еще нет
        if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack) {
          try {
            const senders = this.getSenders();
            const hasJinglesTrack = Array.from(senders).some(s => s.track === window.dionJinglesPlayer.jinglesTrack);
            
            if (!hasJinglesTrack) {
              console.log('[DionJingles] ✅ Добавляем трек ПЕРЕД createOffer (прототип)');
              this.addTrack(window.dionJinglesPlayer.jinglesTrack);
              if (window.dionJinglesPlayer) {
                window.dionJinglesPlayer.jinglesPCs.add(this);
              }
              
              // Проверяем через небольшую задержку
              setTimeout(() => {
                const newSenders = this.getSenders();
                const nowHasTrack = Array.from(newSenders).some(s => s.track === window.dionJinglesPlayer.jinglesTrack);
                console.log('[DionJingles] Проверка после добавления трека перед createOffer (прототип):', {
                  sendersCount: newSenders.length,
                  hasTrack: nowHasTrack,
                  tracks: Array.from(newSenders).map(s => ({ id: s.track?.id, kind: s.track?.kind }))
                });
              }, 50);
            } else {
              console.log('[DionJingles] Трек уже добавлен перед createOffer (прототип)');
            }
          } catch (e) {
            console.error('[DionJingles] ❌ Ошибка при добавлении трека перед createOffer (прототип):', e);
          }
        }
        
        // Вызываем оригинальный createOffer
        return originalCreateOfferProto.apply(this, args);
      };
      console.log('[DionJingles] ✅ createOffer перехвачен на прототипе');
    }
    
    // Копируем все статические свойства
    Object.getOwnPropertyNames(OriginalRTCPeerConnection).forEach(name => {
      try {
        InterceptedRTCPeerConnection[name] = OriginalRTCPeerConnection[name];
      } catch (e) {
        // Игнорируем ошибки
      }
    });
    
    // Заменяем глобальный RTCPeerConnection
    window.RTCPeerConnection = InterceptedRTCPeerConnection;
    
    // Помечаем как перехваченный
    window.RTCPeerConnection.__dionJinglesIntercepted = true;
    isIntercepted = true;
    
    console.log('[DionJingles] ✅ Ранний перехват RTCPeerConnection установлен');
  }
  
  // КРИТИЧНО: Используем MutationObserver для отслеживания изменений в window
  // Это позволит перехватить RTCPeerConnection даже если он создается очень рано
  if (typeof MutationObserver !== 'undefined') {
    // #region agent log
    var _mutCount = 0;
    // #endregion
    const observer = new MutationObserver(() => {
      // #region agent log
      _mutCount++;
      if (_mutCount % 25 === 0) {
        fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'14efdd'},body:JSON.stringify({sessionId:'14efdd',location:'content.js:MutationObserver',message:'MutationObserver callback',data:{count:_mutCount},timestamp:Date.now(),hypothesisId:'H1'})}).catch(function(){});
      }
      // #endregion
      if (window.RTCPeerConnection && !isIntercepted) {
        setupEarlyInterception();
      }
    });
    
    // Наблюдаем за изменениями в document
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  
  // КРИТИЧНО: Также перехватываем webkitRTCPeerConnection (для старых браузеров)
  // dion.vc может использовать его
  function setupWebKitInterception() {
    if (window.webkitRTCPeerConnection && !window.webkitRTCPeerConnection.__dionJinglesIntercepted) {
      const OriginalWebKitRTCPeerConnection = window.webkitRTCPeerConnection;
      
      window.webkitRTCPeerConnection = function(...args) {
        const pc = new OriginalWebKitRTCPeerConnection(...args);
        
        console.log('[DionJingles] 🔍 webkitRTCPeerConnection создан');
        console.log('[DionJingles] Stack trace:', new Error().stack);
        
        // Добавляем трек с звуком аплодисментов
        if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack) {
          try {
            pc.addTrack(window.dionJinglesPlayer.jinglesTrack);
            window.dionJinglesPlayer.jinglesPCs.add(pc);
            console.log('[DionJingles] ✅ Трек с звуком добавлен в webkitRTCPeerConnection');
          } catch (e) {
            console.warn('[DionJingles] Не удалось добавить трек в webkitRTCPeerConnection:', e);
          }
        } else {
          // Player еще не создан, сохраняем PC
          if (!window.__dionJinglesPendingPCs) {
            window.__dionJinglesPendingPCs = [];
          }
          window.__dionJinglesPendingPCs.push(pc);
          console.log('[DionJingles] Player еще не создан, сохраняем webkitRTCPeerConnection');
        }
        
        if (!window.__dionJinglesPCs) {
          window.__dionJinglesPCs = [];
        }
        window.__dionJinglesPCs.push(pc);
        
        return pc;
      };
      
      Object.setPrototypeOf(window.webkitRTCPeerConnection, OriginalWebKitRTCPeerConnection);
      Object.setPrototypeOf(window.webkitRTCPeerConnection.prototype, OriginalWebKitRTCPeerConnection.prototype);
      window.webkitRTCPeerConnection.__dionJinglesIntercepted = true;
      
      console.log('[DionJingles] ✅ webkitRTCPeerConnection перехвачен');
    }
  }
  
  // Пытаемся установить перехват сразу
  setupEarlyInterception();
  setupWebKitInterception();
  
  // Также пытаемся установить при загрузке DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEarlyInterception);
  } else {
    setTimeout(setupEarlyInterception, 0);
  }
  
  // И при полной загрузке
  window.addEventListener('load', setupEarlyInterception);
  
  // КРИТИЧНО: Перехватываем через Proxy (если доступно)
  // Это позволит перехватить даже если RTCPeerConnection уже определен
  // Но только если обычный перехват не сработал
  try {
    // Проверяем, установлен ли флаг перехвата
    if (window.RTCPeerConnection && !window.RTCPeerConnection.__dionJinglesIntercepted) {
      const originalRTCPeerConnection = window.RTCPeerConnection;
      
      console.log('[DionJingles] Попытка перехвата через Proxy...');
      
      // Используем Proxy для перехвата всех обращений
      const ProxyRTCPeerConnection = new Proxy(originalRTCPeerConnection, {
        construct: function(target, args) {
          const pc = new originalRTCPeerConnection(...args);
          
          console.log('[DionJingles] 🔍 RTCPeerConnection создан (Proxy перехват)');
          console.log('[DionJingles] Stack trace:', new Error().stack);
          
          // Добавляем трек с звуком аплодисментов
          if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack) {
            try {
              pc.addTrack(window.dionJinglesPlayer.jinglesTrack);
              window.dionJinglesPlayer.jinglesPCs.add(pc);
              console.log('[DionJingles] ✅ Трек с звуком добавлен в RTCPeerConnection (Proxy)');
            } catch (e) {
              console.warn('[DionJingles] Не удалось добавить трек в RTCPeerConnection:', e);
            }
          } else {
            // Player еще не создан, сохраняем PC
            if (!window.__dionJinglesPendingPCs) {
              window.__dionJinglesPendingPCs = [];
            }
            window.__dionJinglesPendingPCs.push(pc);
            console.log('[DionJingles] Player еще не создан, сохраняем RTCPeerConnection (Proxy)');
          }
          
          // Сохраняем для последующей обработки
          if (!window.__dionJinglesPCs) {
            window.__dionJinglesPCs = [];
          }
          window.__dionJinglesPCs.push(pc);
          
          return pc;
        },
        get: function(target, prop) {
          // Пробрасываем все обращения к оригинальному RTCPeerConnection
          return target[prop];
        }
      });
      
      // Копируем все свойства
      Object.setPrototypeOf(ProxyRTCPeerConnection, originalRTCPeerConnection);
      Object.setPrototypeOf(ProxyRTCPeerConnection.prototype, originalRTCPeerConnection.prototype);
      
      // Заменяем
      window.RTCPeerConnection = ProxyRTCPeerConnection;
      window.RTCPeerConnection.__dionJinglesIntercepted = true;
      isIntercepted = true;
      console.log('[DionJingles] ✅ RTCPeerConnection перехвачен через Proxy');
    } else if (window.RTCPeerConnection && window.RTCPeerConnection.__dionJinglesIntercepted) {
      console.log('[DionJingles] RTCPeerConnection уже перехвачен, Proxy не нужен');
    }
  } catch (e) {
    console.warn('[DionJingles] Не удалось использовать Proxy для перехвата:', e);
  }
  
  // КРИТИЧНО: Также перехватываем webkitRTCPeerConnection через Proxy
  try {
    if (window.webkitRTCPeerConnection && !window.webkitRTCPeerConnection.__dionJinglesIntercepted) {
      const originalWebKit = window.webkitRTCPeerConnection;
      
      console.log('[DionJingles] Попытка перехвата webkitRTCPeerConnection через Proxy...');
      
      const ProxyWebKit = new Proxy(originalWebKit, {
        construct: function(target, args) {
          const pc = new originalWebKit(...args);
          
          console.log('[DionJingles] 🔍 webkitRTCPeerConnection создан (Proxy перехват)');
          console.log('[DionJingles] Stack trace:', new Error().stack);
          
          // Добавляем трек с звуком аплодисментов
          if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack) {
            try {
              pc.addTrack(window.dionJinglesPlayer.jinglesTrack);
              window.dionJinglesPlayer.jinglesPCs.add(pc);
              console.log('[DionJingles] ✅ Трек с звуком добавлен в webkitRTCPeerConnection');
            } catch (e) {
              console.warn('[DionJingles] Не удалось добавить трек в webkitRTCPeerConnection:', e);
            }
          } else {
            // Player еще не создан, сохраняем PC
            if (!window.__dionJinglesPendingPCs) {
              window.__dionJinglesPendingPCs = [];
            }
            window.__dionJinglesPendingPCs.push(pc);
            console.log('[DionJingles] Player еще не создан, сохраняем webkitRTCPeerConnection');
          }
          
          if (!window.__dionJinglesPCs) {
            window.__dionJinglesPCs = [];
          }
          window.__dionJinglesPCs.push(pc);
          
          return pc;
        },
        get: function(target, prop) {
          return target[prop];
        }
      });
      
      Object.setPrototypeOf(ProxyWebKit, originalWebKit);
      Object.setPrototypeOf(ProxyWebKit.prototype, originalWebKit.prototype);
      
      window.webkitRTCPeerConnection = ProxyWebKit;
      window.webkitRTCPeerConnection.__dionJinglesIntercepted = true;
      console.log('[DionJingles] ✅ webkitRTCPeerConnection перехвачен через Proxy');
    }
  } catch (e) {
    console.warn('[DionJingles] Не удалось использовать Proxy для webkitRTCPeerConnection:', e);
  }
  
  // КРИТИЧНО: Используем Object.defineProperty для перехвата всех обращений к RTCPeerConnection
  // Это должно перехватить даже если RTCPeerConnection создается очень рано
  try {
    if (window.RTCPeerConnection) {
      const originalRTCPeerConnection = window.RTCPeerConnection;
      let interceptedRTCPeerConnection = originalRTCPeerConnection;
      
      // КРИТИЧНО: Всегда создаем перехваченную версию, даже если уже перехвачено
      // Это гарантирует, что мы перехватим все создания
      const originalForInterception = originalRTCPeerConnection.__dionJinglesOriginal || originalRTCPeerConnection;
      
      // Создаем перехваченную версию
      interceptedRTCPeerConnection = function(...args) {
        const pc = new originalForInterception(...args);
        
        console.log('[DionJingles] 🔍 RTCPeerConnection создан (defineProperty перехват)');
        console.log('[DionJingles] Stack trace:', new Error().stack);
        console.log('[DionJingles] Args:', args);
        
        // Добавляем трек с звуком аплодисментов
        if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack) {
          try {
            pc.addTrack(window.dionJinglesPlayer.jinglesTrack);
            window.dionJinglesPlayer.jinglesPCs.add(pc);
            console.log('[DionJingles] ✅ Трек с звуком добавлен в RTCPeerConnection (defineProperty)');
          } catch (e) {
            console.warn('[DionJingles] Не удалось добавить трек в RTCPeerConnection:', e);
          }
        } else {
          // Player еще не создан, сохраняем PC
          if (!window.__dionJinglesPendingPCs) {
            window.__dionJinglesPendingPCs = [];
          }
          window.__dionJinglesPendingPCs.push(pc);
          console.log('[DionJingles] Player еще не создан, сохраняем RTCPeerConnection (defineProperty)');
        }
        
        if (!window.__dionJinglesPCs) {
          window.__dionJinglesPCs = [];
        }
        window.__dionJinglesPCs.push(pc);
        
        return pc;
      };
      
      // Копируем прототип и свойства
      Object.setPrototypeOf(interceptedRTCPeerConnection, originalForInterception);
      Object.setPrototypeOf(interceptedRTCPeerConnection.prototype, originalForInterception.prototype);
      
      // Копируем все статические свойства
      Object.getOwnPropertyNames(originalForInterception).forEach(name => {
        try {
          if (name !== 'prototype' && name !== 'length' && name !== 'name') {
            interceptedRTCPeerConnection[name] = originalForInterception[name];
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      });
      
      // Сохраняем оригинал для последующего использования
      interceptedRTCPeerConnection.__dionJinglesOriginal = originalForInterception;
      interceptedRTCPeerConnection.__dionJinglesIntercepted = true;
      
      // Перехватываем через defineProperty
      Object.defineProperty(window, 'RTCPeerConnection', {
        get: function() {
          // Убираем избыточное логирование - оно засоряет консоль
          // console.log('[DionJingles] 🔍 Доступ к RTCPeerConnection через getter');
          return interceptedRTCPeerConnection;
        },
        set: function(value) {
          console.log('[DionJingles] ⚠️ Попытка установить RTCPeerConnection:', value);
          // Не позволяем заменять наш перехваченный RTCPeerConnection
          interceptedRTCPeerConnection = value;
          // Но все равно перехватываем
          if (value && !value.__dionJinglesIntercepted) {
            const original = value;
            interceptedRTCPeerConnection = function(...args) {
              const pc = new original(...args);
              console.log('[DionJingles] 🔍 RTCPeerConnection создан (setter перехват)');
              if (!window.__dionJinglesPCs) {
                window.__dionJinglesPCs = [];
              }
              window.__dionJinglesPCs.push(pc);
              return pc;
            };
            Object.setPrototypeOf(interceptedRTCPeerConnection, original);
            Object.setPrototypeOf(interceptedRTCPeerConnection.prototype, original.prototype);
            interceptedRTCPeerConnection.__dionJinglesIntercepted = true;
          }
        },
        configurable: true,
        enumerable: true
      });
      
      console.log('[DionJingles] ✅ RTCPeerConnection перехвачен через defineProperty');
    }
  } catch (e) {
    console.warn('[DionJingles] Не удалось использовать defineProperty для перехвата:', e);
  }
  
  // Аналогично для webkitRTCPeerConnection
  try {
    if (window.webkitRTCPeerConnection) {
      const originalWebKit = window.webkitRTCPeerConnection;
      let interceptedWebKit = originalWebKit;
      
      if (originalWebKit.__dionJinglesIntercepted) {
        interceptedWebKit = originalWebKit;
      } else {
        interceptedWebKit = function(...args) {
          const pc = new originalWebKit(...args);
          console.log('[DionJingles] 🔍 webkitRTCPeerConnection создан (defineProperty перехват)');
          if (!window.__dionJinglesPCs) {
            window.__dionJinglesPCs = [];
          }
          window.__dionJinglesPCs.push(pc);
          return pc;
        };
        Object.setPrototypeOf(interceptedWebKit, originalWebKit);
        Object.setPrototypeOf(interceptedWebKit.prototype, originalWebKit.prototype);
        interceptedWebKit.__dionJinglesIntercepted = true;
      }
      
      Object.defineProperty(window, 'webkitRTCPeerConnection', {
        get: function() {
          return interceptedWebKit;
        },
        set: function(value) {
          interceptedWebKit = value;
        },
        configurable: true,
        enumerable: true
      });
      
      console.log('[DionJingles] ✅ webkitRTCPeerConnection перехвачен через defineProperty');
    }
  } catch (e) {
    console.warn('[DionJingles] Не удалось использовать defineProperty для webkitRTCPeerConnection:', e);
  }
})();

// Добавляем глобальную функцию для проверки доступности
// Используем Object.defineProperty для гарантированного добавления в window
try {
  Object.defineProperty(window, 'checkDionJingles', {
    value: function() {
      if (typeof window.dionJinglesPlayer === 'undefined') {
        console.warn('[DionJingles] ⚠️ Расширение не загружено. Проверьте:');
        console.warn('1. Расширение установлено и включено');
        console.warn('2. Вы находитесь на странице dion.vc');
        console.warn('3. Content script загружен (проверьте chrome://extensions/)');
        console.warn('4. Страница перезагружена после установки расширения');
        return false;
      }
      return true;
    },
    writable: false,
    configurable: true
  });
  
  // Также добавляем простой геттер для быстрой проверки
  Object.defineProperty(window, 'dionJingles', {
    get: function() {
      return window.dionJinglesPlayer || null;
    },
    configurable: true
  });
  
  // Функция для анализа кода dion.vc
  Object.defineProperty(window, 'analyzeDionVC', {
    value: function() {
      console.log('=== АНАЛИЗ DION.VC ===');
      
      // Ищем все RTCPeerConnection
      const pcs = window.__dionJinglesPCs || [];
      console.log('Найдено RTCPeerConnection:', pcs.length);
      
      pcs.forEach((pc, index) => {
        console.log(`\nRTCPeerConnection ${index}:`);
        try {
          const transceivers = pc.getTransceivers();
          console.log('  Transceivers:', transceivers.length);
          transceivers.forEach((t, i) => {
            if (t.sender && t.sender.track) {
              console.log(`    Transceiver ${i}:`, {
                kind: t.sender.track.kind,
                id: t.sender.track.id,
                readyState: t.sender.track.readyState,
                direction: t.direction
              });
            }
          });
          
          const senders = pc.getSenders();
          console.log('  Senders:', senders.length);
          senders.forEach((s, i) => {
            if (s.track) {
              console.log(`    Sender ${i}:`, {
                kind: s.track.kind,
                id: s.track.id,
                readyState: s.track.readyState
              });
            }
          });
        } catch (e) {
          console.warn('  Ошибка анализа:', e);
        }
      });
      
      // Ищем в глобальных переменных
      const possibleNames = ['pc', 'peerConnection', 'rtcPeerConnection', 'webrtc', 'rtc', 'connection'];
      possibleNames.forEach(name => {
        try {
          const obj = window[name];
          if (obj && obj instanceof RTCPeerConnection) {
            console.log(`\nНайден RTCPeerConnection в window.${name}:`, obj);
          }
        } catch (e) {
          // Игнорируем
        }
      });
      
      // Ищем через eval (может быть вложено)
      const possiblePaths = [
        'window.webrtc',
        'window.rtc',
        'window.peerConnection',
        'window.pc'
      ];
      
      possiblePaths.forEach(path => {
        try {
          const obj = eval(path);
          if (obj && obj instanceof RTCPeerConnection) {
            console.log(`\nНайден RTCPeerConnection в ${path}:`, obj);
          }
        } catch (e) {
          // Игнорируем
        }
      });
    },
    writable: false,
    configurable: true
  });
  
  console.log('[DionJingles] Функции отладки добавлены в window');
  console.log('[DionJingles] Используйте window.analyzeDionVC() для анализа кода dion.vc');
} catch (e) {
  console.warn('[DionJingles] Не удалось добавить функции отладки:', e);
}

class DionJinglesPlayer {
  constructor() {
    this.audioContext = null;
    this.mixingContext = null;
    this.mixingDestination = null;
    this.microphoneStream = null;
    this.microphoneSource = null;
    this.currentSounds = new Map();
    this.isWebRTCEnabled = true; // По умолчанию включено - основная функция
    this.originalGetUserMedia = null;
    this.allPeerConnections = []; // Храним все RTCPeerConnection для проверки
    
    // НОВЫЙ ПОДХОД: Отдельный контекст для звука аплодисментов (независимо от микрофона)
    this.jinglesContext = null;
    this.jinglesDestination = null;
    this.jinglesTrack = null; // Трек с звуком аплодисментов
    this.jinglesPCs = new Set(); // RTCPeerConnection, в которые добавлен трек
    
    // Включить детальное логирование для отладки
    // Можно отключить, установив window.DION_JINGLES_DEBUG = false
    this.debug = window.DION_JINGLES_DEBUG !== false;
    this.init();
    
    if (this.debug) {
      console.log('[DionJingles] Инициализация расширения');
      console.log('[DionJingles] Debug режим:', this.debug);
      // #region agent log
      fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId:'H16',location:'content.js:DionJinglesPlayer.constructor',message:'content script build marker',data:{build:DION_DEBUG_BUILD},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
  }

  init() {
    // Создаем mixing context СРАЗУ (в suspended состоянии, потом resume при первом взаимодействии)
    // Это критически важно - context должен существовать до перехвата потоков
    try {
      this.mixingContext = new (window.AudioContext || window.webkitAudioContext)();
      this.mixingDestination = this.mixingContext.createMediaStreamDestination();
      if (this.debug) {
        console.log('[DionJingles] ✅ Mixing context создан сразу:', {
          state: this.mixingContext.state,
          sampleRate: this.mixingContext.sampleRate
        });
      }
    } catch (e) {
      console.error('[DionJingles] Ошибка создания mixing context:', e);
    }
    
    // НОВЫЙ ПОДХОД: Создаем отдельный контекст для звука аплодисментов
    try {
      this.jinglesContext = new (window.AudioContext || window.webkitAudioContext)();
      this.jinglesDestination = this.jinglesContext.createMediaStreamDestination();
      const tracks = this.jinglesDestination.stream.getAudioTracks();
      if (tracks.length > 0) {
        this.jinglesTrack = tracks[0];
        if (this.debug) {
          console.log('[DionJingles] ✅ Jingles context создан (отдельный трек):', {
            state: this.jinglesContext.state,
            sampleRate: this.jinglesContext.sampleRate,
            trackId: this.jinglesTrack.id,
            trackKind: this.jinglesTrack.kind,
            trackReadyState: this.jinglesTrack.readyState,
            trackEnabled: this.jinglesTrack.enabled
          });
        }
      } else {
        console.error('[DionJingles] ❌ ОШИБКА: jinglesDestination.stream не содержит треков!');
        console.error('[DionJingles] Stream:', this.jinglesDestination.stream);
        console.error('[DionJingles] Tracks:', this.jinglesDestination.stream.getTracks());
      }
    } catch (e) {
      console.error('[DionJingles] ❌ Ошибка создания jingles context:', e);
      console.error('[DionJingles] Stack:', e.stack);
    }
    
    // Resume context при первом взаимодействии (требование браузера)
    const resumeContext = () => {
      if (this.mixingContext && this.mixingContext.state === 'suspended') {
        this.mixingContext.resume().then(() => {
          if (this.debug) {
            console.log('[DionJingles] Mixing context resumed');
          }
        });
      }
      if (!this.audioContext) {
        this.ensureAudioContext();
      }
    };
    document.addEventListener('click', resumeContext, { once: true });
    document.addEventListener('keydown', resumeContext, { once: true });
    
    // Перехватываем getUserMedia для встраивания в WebRTC
    this.interceptGetUserMedia();
    
    // Пытаемся найти существующие потоки (если конференция уже началась)
    this.findAndInterceptExistingStreams();
    
    // Также перехватываем MediaStreamTrack для более глубокого перехвата
    this.interceptMediaStreamTrack();
    
    // КРИТИЧНО: Проверяем все существующие треки СРАЗУ
    // Возможно, треки уже созданы и live
    setTimeout(() => {
      this.checkAllExistingTracks();
    }, 1000);
    
    // Периодически проверяем RTCPeerConnection на наличие потоков
    this.startPeriodicStreamCheck();
    
    // Слушаем сообщения от popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'playSound') {
        this.playSound(request.soundType, request.injectToWebRTC !== false);
        // #region agent log
        fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId:'H11',location:'content.js:onMessage(playSound)',message:'runtime playSound received',data:{soundType:request.soundType,injectToWebRTC:request.injectToWebRTC!==false},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        this.dispatchSoundToPageContext(request.soundType);
        sendResponse({ success: true });
      } else if (request.action === 'toggleWebRTC') {
        this.toggleWebRTCInjection(request.enabled);
        sendResponse({ success: true, enabled: this.isWebRTCEnabled });
      } else if (request.action === 'forceReconnect') {
        // Принудительное переподключение к потоку
        this.findAndInterceptExistingStreams();
        sendResponse({ success: true });
      }
      return true;
    });
  }

  dispatchSoundToPageContext(soundType) {
    const soundUrl = chrome.runtime.getURL(`sounds/${soundType}.mp3`);
    fetch(soundUrl)
      .then((r) => r.arrayBuffer())
      .then((ab) => {
        const bytes = new Uint8Array(ab);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        document.dispatchEvent(new CustomEvent('__dionJinglesPlayWithUrl', {
          detail: { soundDataUrl: `data:audio/mpeg;base64,${btoa(binary)}`, soundType }
        }));
        // #region agent log
        fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId:'H12',location:'content.js:dispatchSoundToPageContext',message:'dispatch __dionJinglesPlayWithUrl',data:{soundType:soundType,bytesLength:bytes.byteLength},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      })
      .catch(() => {
        document.dispatchEvent(new CustomEvent('__dionJinglesPlayGenerated', { detail: { soundType } }));
        // #region agent log
        fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId:'H12',location:'content.js:dispatchSoundToPageContext',message:'dispatch __dionJinglesPlayGenerated fallback',data:{soundType:soundType},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      });
  }
  
  interceptMediaStreamTrack() {
    // Перехватываем создание MediaStreamTrack для более глубокого контроля
    if (window.MediaStreamTrack && window.MediaStreamTrack.prototype) {
      const self = this;
      const debug = this.debug !== false;
      
      // Перехватываем clone
      const originalClone = window.MediaStreamTrack.prototype.clone;
      if (originalClone) {
        window.MediaStreamTrack.prototype.clone = function() {
          const cloned = originalClone.call(this);
          if (this.kind === 'audio' && self.microphoneStream) {
            if (debug) {
              console.log('[DionJingles] Клонирован аудио трек:', cloned.id);
            }
          }
          return cloned;
        };
      }
      
      // КРИТИЧНО: Перехватываем все свойства MediaStreamTrack, чтобы отслеживать изменения
      // Особенно важно отслеживать readyState
      // Используем существующий self из замыкания
      
      // Перехватываем readyState через геттер
      const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(window.MediaStreamTrack.prototype, 'readyState');
      if (originalReadyStateDescriptor && originalReadyStateDescriptor.get) {
        const originalReadyStateGetter = originalReadyStateDescriptor.get;
        const processedTracks = new WeakSet(); // Отслеживаем обработанные треки
        
        Object.defineProperty(window.MediaStreamTrack.prototype, 'readyState', {
          get: function() {
            const state = originalReadyStateGetter.call(this);
            
            // КРИТИЧНО: Когда трек становится 'live', пытаемся найти его использование
            if (this.kind === 'audio' && state === 'live' && !processedTracks.has(this)) {
              processedTracks.add(this);
              const debug = self.debug !== false;
              
              if (debug) {
                console.log('[DionJingles] 🔍 Аудио трек стал live:', this.id, 'label:', this.label, 'enabled:', this.enabled, 'muted:', this.muted);
              }
              
              // Пытаемся найти, где используется этот трек
              setTimeout(() => {
                self.findAndProcessAudioTrack(this);
              }, 100);
            }
            
            return state;
          },
          configurable: true,
          enumerable: true
        });
        
        if (debug) {
          console.log('[DionJingles] ✅ MediaStreamTrack.readyState перехвачен');
        }
      }
      
      // КРИТИЧНО: Также перехватываем события на треках
      // Когда трек становится 'live', может быть вызвано событие
      const originalAddEventListener = window.MediaStreamTrack.prototype.addEventListener;
      if (originalAddEventListener) {
        window.MediaStreamTrack.prototype.addEventListener = function(type, listener, options) {
          // Перехватываем событие 'started' или 'live'
          if (type === 'started' || type === 'live' || type === 'unmute') {
            const self = this;
            const wrappedListener = function(event) {
              if (self.kind === 'audio' && !self.__dionJinglesProcessed) {
                self.__dionJinglesProcessed = true;
                const debug = window.dionJinglesPlayer?.debug !== false;
                if (debug) {
                  console.log('[DionJingles] 🔍 Событие на аудио треке:', type, 'track:', self.id);
                }
                setTimeout(() => {
                  if (window.dionJinglesPlayer) {
                    window.dionJinglesPlayer.findAndProcessAudioTrack(self);
                  }
                }, 100);
              }
              if (listener) listener(event);
            };
            return originalAddEventListener.call(this, type, wrappedListener, options);
          }
          return originalAddEventListener.call(this, type, listener, options);
        };
        
        if (debug) {
          console.log('[DionJingles] ✅ MediaStreamTrack.addEventListener перехвачен');
        }
      }
      
      // КРИТИЧНО: Перехватываем все обращения к трекам через геттеры свойств
      // Это позволит отследить, когда треки используются
      const trackProperties = ['id', 'kind', 'label', 'enabled', 'muted', 'readyState'];
      trackProperties.forEach(prop => {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(window.MediaStreamTrack.prototype, prop);
          if (descriptor && descriptor.get) {
            const originalGetter = descriptor.get;
            Object.defineProperty(window.MediaStreamTrack.prototype, prop, {
              get: function() {
                const value = originalGetter.call(this);
                
                // Если это аудио трек и он live, и мы обращаемся к нему - это может быть микрофон
                if (this.kind === 'audio' && prop === 'readyState' && value === 'live') {
                  if (!this.__dionJinglesChecked) {
                    this.__dionJinglesChecked = true;
                    setTimeout(() => {
                      if (window.dionJinglesPlayer) {
                        window.dionJinglesPlayer.findAndProcessAudioTrack(this);
                      }
                    }, 50);
                  }
                }
                
                return value;
              },
              configurable: true,
              enumerable: true
            });
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      });
      
      // Также перехватываем события на треках
      // Когда трек становится 'live', событие 'started' или 'live' может быть вызвано
      if (debug) {
        console.log('[DionJingles] ✅ MediaStreamTrack перехвачен');
      }
    }
    
    // Также перехватываем MediaStream для отслеживания добавления треков
    if (window.MediaStream && window.MediaStream.prototype) {
      const self = this;
      const debug = this.debug !== false;
      
      const originalAddTrack = window.MediaStream.prototype.addTrack;
      window.MediaStream.prototype.addTrack = function(track) {
        if (track && track.kind === 'audio') {
          if (debug) {
            console.log('[DionJingles] Аудио трек добавлен в MediaStream:', track.id, 'stream:', this.id);
          }
          
          // Пытаемся настроить mixing для этого потока
          if (!self.microphoneStream || self.microphoneStream.id !== this.id) {
            setTimeout(() => {
              self.setupWebRTCMixing(this);
            }, 50);
          }
        }
        
        return originalAddTrack.call(this, track);
      };
      
      if (debug) {
        console.log('[DionJingles] ✅ MediaStream.addTrack перехвачен');
      }
    }
  }

  interceptGetUserMedia() {
    // Сохраняем оригинальный getUserMedia
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      // Проверяем, не перехвачен ли уже
      const currentGetUserMedia = navigator.mediaDevices.getUserMedia;
      if (currentGetUserMedia.toString().includes('__dionJinglesOriginal')) {
        console.log('[DionJingles] getUserMedia уже перехвачен');
        return;
      }
      
      this.originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      
      // Перехватываем вызовы getUserMedia
      const self = this;
      navigator.mediaDevices.getUserMedia = async function(constraints) {
        const debug = self.debug !== false;
        if (debug) {
          console.log('[DionJingles] ✅ getUserMedia перехвачен, constraints:', constraints);
        }
        
        const stream = await self.originalGetUserMedia(constraints);
        
        if (debug) {
          console.log('[DionJingles] Поток получен:', stream.id);
          console.log('[DionJingles] Аудио треки:', stream.getAudioTracks().map(t => ({ id: t.id, enabled: t.enabled, kind: t.kind })));
        }
        
        // Всегда подключаемся к аудио потоку для встраивания звуков
        if (constraints.audio) {
          if (debug) {
            console.log('[DionJingles] Аудио поток получен, настройка mixing...');
          }
          // Небольшая задержка для гарантии, что поток полностью готов
          setTimeout(() => {
            self.setupWebRTCMixing(stream);
          }, 50);
        }
        
        return stream;
      };
      
      // Помечаем функцию для идентификации
      navigator.mediaDevices.getUserMedia.__dionJinglesOriginal = this.originalGetUserMedia;
      
      const debug = this.debug !== false;
      if (debug) {
        console.log('[DionJingles] ✅ getUserMedia перехвачен успешно');
      }
    } else {
      console.warn('[DionJingles] ⚠️ navigator.mediaDevices.getUserMedia не найден');
    }

    // Также перехватываем старый API (для совместимости)
    if (navigator.getUserMedia) {
      const self = this;
      const originalGetUserMedia = navigator.getUserMedia.bind(navigator);
      navigator.getUserMedia = function(constraints, success, error) {
        originalGetUserMedia(constraints, (stream) => {
          // Всегда подключаемся к аудио потоку для встраивания звуков
          if (constraints.audio) {
            self.setupWebRTCMixing(stream);
          }
          if (success) success(stream);
        }, error);
      };
    }

    // Перехватываем RTCPeerConnection для замены треков
    this.interceptRTCPeerConnection();
    
    // Перехватываем replaceTrack на прототипе RTCRtpSender
    this.interceptRTCRtpSender();
    
    // Проверяем существующие RTCPeerConnection (могут быть созданы до загрузки скрипта)
    this.checkExistingPeerConnections();
    
    // НОВОЕ: Ищем RTCPeerConnection через Zustand store (dion.vc хранит его там)
    setTimeout(() => {
      this.findPCInZustandStore();
    }, 1000); // Даем время на создание store
    
    // Периодически проверяем Zustand store
    setInterval(() => {
      this.findPCInZustandStore();
    }, 2000);
    
    // Обрабатываем RTCPeerConnection, сохраненные ранним перехватом
    this.processEarlyInterceptedPCs();
    
    // КРИТИЧНО: Проверяем все существующие треки СРАЗУ
    // Возможно, треки уже созданы и live
    this.checkAllExistingTracks();
    
    // КРИТИЧНО: Агрессивный поиск всех живых аудио треков
    // Выполняем сразу и периодически
    setTimeout(() => {
      this.findAllLiveAudioTracks();
    }, 500);
    
    // Запускаем периодическую проверку
    this.startPeriodicStreamCheck();
  }
  
  // Проверка всех существующих треков в системе
  checkAllExistingTracks() {
    const debug = this.debug !== false;
    
    if (debug) {
      console.log('[DionJingles] Проверка всех существующих треков...');
    }
    
    // Пытаемся найти треки через navigator.mediaDevices.getUserMedia
    // Но это не даст нам существующие треки
    
    // Вместо этого ищем через все RTCPeerConnection
    const allPCs = new Set();
    if (this.allPeerConnections) {
      this.allPeerConnections.forEach(pc => allPCs.add(pc));
    }
    if (window.__dionJinglesPCs) {
      window.__dionJinglesPCs.forEach(pc => allPCs.add(pc));
    }
    
    // Также ищем через Object.keys
    try {
      Object.keys(window).forEach(key => {
        try {
          const obj = window[key];
          if (obj && typeof obj.getTransceivers === 'function' && obj instanceof RTCPeerConnection) {
            allPCs.add(obj);
          }
        } catch (e) {
          // Игнорируем
        }
      });
    } catch (e) {
      // Игнорируем
    }
    
    if (debug) {
      console.log('[DionJingles] Найдено RTCPeerConnection для проверки треков:', allPCs.size);
    }
    
    // Проверяем все PC на наличие треков
    allPCs.forEach(pc => {
      try {
        const transceivers = pc.getTransceivers();
        transceivers.forEach(transceiver => {
          // Проверяем receiver.track
          if (transceiver.receiver && transceiver.receiver.track) {
            const track = transceiver.receiver.track;
            if (track.kind === 'audio' && track.readyState === 'live') {
              if (debug) {
                console.log('[DionJingles] ✅ Найден живой аудио трек в receiver (проверка существующих):', track.id, 'label:', track.label);
              }
              this.findAndProcessAudioTrack(track);
            }
          }
          
          // Проверяем sender.track
          if (transceiver.sender && transceiver.sender.track) {
            const track = transceiver.sender.track;
            if (track.kind === 'audio' && track.readyState === 'live') {
              if (debug) {
                console.log('[DionJingles] ✅ Найден живой аудио трек в sender (проверка существующих):', track.id);
              }
              this.findAndProcessAudioTrack(track);
            }
          }
        });
        
        const senders = pc.getSenders();
        senders.forEach(sender => {
          if (sender.track && sender.track.kind === 'audio' && sender.track.readyState === 'live') {
            if (debug) {
              console.log('[DionJingles] ✅ Найден живой аудио трек в sender (проверка существующих):', sender.track.id);
            }
            this.findAndProcessAudioTrack(sender.track);
          }
        });
      } catch (e) {
        if (debug) {
          console.warn('[DionJingles] Ошибка проверки треков в PC:', e);
        }
      }
    });
  }
  
  processEarlyInterceptedPCs() {
    const debug = this.debug !== false;
    
    // Обрабатываем RTCPeerConnection, сохраненные ранним перехватом
    if (window.__dionJinglesPCs && window.__dionJinglesPCs.length > 0) {
      if (debug) {
        console.log('[DionJingles] Обработка ранне перехваченных RTCPeerConnection:', window.__dionJinglesPCs.length);
      }
      
      window.__dionJinglesPCs.forEach((pc, index) => {
        if (debug) {
          console.log(`[DionJingles] Обработка RTCPeerConnection ${index} из раннего перехвата`);
        }
        
        // Добавляем в наш список
        if (!this.allPeerConnections) {
          this.allPeerConnections = [];
        }
        if (!this.allPeerConnections.includes(pc)) {
          this.allPeerConnections.push(pc);
        }
        
        // Настраиваем перехваты на этом PC
        this.setupInterceptsOnPC(pc);
        
        // Проверяем transceivers
        setTimeout(() => {
          try {
            const transceivers = pc.getTransceivers();
            if (debug && transceivers.length > 0) {
              console.log(`[DionJingles] Найдено transceivers в ранне перехваченном PC:`, transceivers.length);
            }
            
            transceivers.forEach((transceiver, i) => {
              if (transceiver.sender && transceiver.sender.track) {
                const track = transceiver.sender.track;
                if (track.kind === 'audio') {
                  if (debug) {
                    console.log(`[DionJingles] ✅ Найден аудио трек в ранне перехваченном transceiver ${i}:`, track.id);
                  }
                  
                  try {
                    const stream = new MediaStream([track]);
                    this.setupWebRTCMixing(stream);
                  } catch (e) {
                    if (debug) {
                      console.warn('[DionJingles] Ошибка:', e);
                    }
                  }
                }
              }
            });
          } catch (e) {
            if (debug) {
              console.warn('[DionJingles] Ошибка проверки ранне перехваченного PC:', e);
            }
          }
        }, 100);
      });
    }
  }
  
  setupInterceptsOnPC(pc) {
    const self = this;
    const debug = this.debug !== false;
    
    // Настраиваем перехваты на конкретном PC (если еще не настроены)
    // Это дублирует логику из interceptRTCPeerConnection, но для уже созданных PC
    if (!pc.__dionJinglesIntercepted) {
      pc.__dionJinglesIntercepted = true;
      
      // Перехватываем getSenders
      const originalGetSenders = pc.getSenders.bind(pc);
      pc.getSenders = function() {
        const senders = originalGetSenders();
        
        // Ищем аудио треки
        senders.forEach((sender, index) => {
          if (sender.track && sender.track.kind === 'audio') {
            const track = sender.track;
            if (debug && !self.microphoneStream) {
              console.log(`[DionJingles] ✅ Найден аудио трек в sender ${index}:`, track.id);
            }
            
            try {
              const stream = new MediaStream([track]);
              if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                if (debug) {
                  console.log('[DionJingles] Настройка mixing для потока из sender:', stream.id);
                }
                self.setupWebRTCMixing(stream);
              }
            } catch (e) {
              if (debug) {
                console.warn('[DionJingles] Ошибка:', e);
              }
            }
          }
        });
        
        return senders;
      };
      
      if (debug) {
        console.log('[DionJingles] Перехваты настроены на существующем RTCPeerConnection');
      }
    }
  }
  
  // НОВАЯ ФУНКЦИЯ: Поиск RTCPeerConnection через Zustand store (dion.vc хранит его там)
  findPCInZustandStore() {
    // #region agent log
    var _t0 = Date.now();
    // #endregion
    const debug = this.debug !== false;
    
    try {
      // Ищем useWebRTC в window
      const possibleStoreNames = [
        'useWebRTC',
        'webRTCStore',
        'webrtcStore',
        'WebRTCStore'
      ];
      
      for (const storeName of possibleStoreNames) {
        try {
          const store = window[storeName];
          if (store && typeof store.getState === 'function') {
            const state = store.getState();
            if (state && state.peerConnection && state.peerConnection instanceof RTCPeerConnection) {
              const pc = state.peerConnection;
              
              // #region agent log
              fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'14efdd'},body:JSON.stringify({sessionId:'14efdd',location:'content.js:findPCInZustandStore',message:'findPC found (storeName)',data:{durationMs:Date.now()-_t0,storeName:storeName},timestamp:Date.now(),hypothesisId:'H3'})}).catch(function(){});
              // #endregion
              if (debug) {
                console.log(`[DionJingles] ✅ Найден RTCPeerConnection в Zustand store: ${storeName}`);
              }
              
              // Добавляем трек, если его еще нет
              if (this.jinglesTrack) {
                try {
                  const senders = pc.getSenders();
                  const hasJinglesTrack = Array.from(senders).some(s => s.track === this.jinglesTrack);
                  
                  if (!hasJinglesTrack) {
                    if (debug) {
                      console.log('[DionJingles] ✅ Добавляем трек в PC из Zustand store');
                    }
                    pc.addTrack(this.jinglesTrack);
                    this.jinglesPCs.add(pc);
                    
                    // Проверяем через 100мс
                    setTimeout(() => {
                      const newSenders = pc.getSenders();
                      const nowHasTrack = Array.from(newSenders).some(s => s.track === this.jinglesTrack);
                      console.log('[DionJingles] Проверка после добавления трека в PC из Zustand store:', {
                        sendersCount: newSenders.length,
                        hasTrack: nowHasTrack,
                        tracks: Array.from(newSenders).map(s => ({ id: s.track?.id, kind: s.track?.kind }))
                      });
                    }, 100);
                  } else {
                    if (debug) {
                      console.log('[DionJingles] Трек уже добавлен в PC из Zustand store');
                    }
                  }
                } catch (e) {
                  console.error('[DionJingles] ❌ Ошибка при добавлении трека в PC из Zustand store:', e);
                }
              }
              
              return pc;
            }
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      }
      
      // Также пробуем найти через Object.keys
      for (const key in window) {
        try {
          const value = window[key];
          if (value && typeof value.getState === 'function') {
            const state = value.getState();
            if (state && state.peerConnection && state.peerConnection instanceof RTCPeerConnection) {
              const pc = state.peerConnection;
              
              // #region agent log
              fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'14efdd'},body:JSON.stringify({sessionId:'14efdd',location:'content.js:findPCInZustandStore',message:'findPC found (for-in key)',data:{durationMs:Date.now()-_t0,key:key},timestamp:Date.now(),hypothesisId:'H3'})}).catch(function(){});
              // #endregion
              if (debug) {
                console.log(`[DionJingles] ✅ Найден RTCPeerConnection в store: ${key}`);
              }
              
              // Добавляем трек
              if (this.jinglesTrack) {
                try {
                  const senders = pc.getSenders();
                  const hasJinglesTrack = Array.from(senders).some(s => s.track === this.jinglesTrack);
                  
                  if (!hasJinglesTrack) {
                    if (debug) {
                      console.log(`[DionJingles] ✅ Добавляем трек в PC из store: ${key}`);
                    }
                    pc.addTrack(this.jinglesTrack);
                    this.jinglesPCs.add(pc);
                  }
                } catch (e) {
                  console.error('[DionJingles] ❌ Ошибка при добавлении трека:', e);
                }
              }
              
              return pc;
            }
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      }
    } catch (e) {
      if (debug) {
        console.warn('[DionJingles] Ошибка при поиске PC в Zustand store:', e);
      }
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'14efdd'},body:JSON.stringify({sessionId:'14efdd',location:'content.js:findPCInZustandStore',message:'findPCInZustandStore done',data:{durationMs:Date.now()-_t0},timestamp:Date.now(),hypothesisId:'H3'})}).catch(function(){});
    // #endregion
    return null;
  }
  
  checkExistingPeerConnections() {
    const debug = this.debug !== false;
    
    // Ищем все возможные RTCPeerConnection в глобальном контексте
    const possibleNames = ['pc', 'peerConnection', 'rtcPeerConnection', 'webrtc', 'rtc', 'connection'];
    
    for (const name of possibleNames) {
      try {
        const obj = window[name];
        if (obj && obj.getTransceivers && obj instanceof RTCPeerConnection) {
          if (debug) {
            console.log('[DionJingles] Найден существующий RTCPeerConnection в window.' + name);
          }
          
          if (!this.allPeerConnections) {
            this.allPeerConnections = [];
          }
          
          if (!this.allPeerConnections.includes(obj)) {
            this.allPeerConnections.push(obj);
            
            // Проверяем transceivers
            setTimeout(() => {
              try {
                const transceivers = obj.getTransceivers();
                if (debug) {
                  console.log('[DionJingles] Проверка существующего RTCPeerConnection:', transceivers.length, 'transceivers');
                }
                
                transceivers.forEach((transceiver, index) => {
                  if (transceiver.sender && transceiver.sender.track) {
                    const track = transceiver.sender.track;
                    if (track.kind === 'audio') {
                      if (debug) {
                        console.log(`[DionJingles] ✅ Найден аудио трек в существующем transceiver ${index}:`, track.id);
                      }
                      
                      try {
                        const stream = new MediaStream([track]);
                        this.setupWebRTCMixing(stream);
                      } catch (e) {
                        if (debug) {
                          console.warn('[DionJingles] Ошибка:', e);
                        }
                      }
                    }
                  }
                });
              } catch (e) {
                if (debug) {
                  console.warn('[DionJingles] Ошибка проверки существующего RTCPeerConnection:', e);
                }
              }
            }, 100);
          }
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    }
  }
  
  interceptRTCRtpSender() {
    if (!window.RTCRtpSender || !window.RTCRtpSender.prototype) {
      return;
    }
    
    const self = this;
    const OriginalRTCRtpSender = window.RTCRtpSender;
    const originalReplaceTrack = window.RTCRtpSender.prototype.replaceTrack;
    const debug = this.debug !== false;
    
    // КРИТИЧНО: Перехватываем геттер track на RTCRtpSender
    // Это может быть единственный способ перехватить треки, если методы не вызываются
    const trackDescriptor = Object.getOwnPropertyDescriptor(RTCRtpSender.prototype, 'track');
    if (trackDescriptor && trackDescriptor.get) {
      const originalTrackGetter = trackDescriptor.get;
      Object.defineProperty(RTCRtpSender.prototype, 'track', {
        get: function() {
          const track = originalTrackGetter.call(this);
          const debug = self.debug !== false;
          
          if (track && track.kind === 'audio') {
            if (debug && !self.microphoneStream) {
              console.log('[DionJingles] ✅ Доступ к аудио треку через RTCRtpSender.track:', track.id, 'readyState:', track.readyState);
            }
            
            // Пытаемся создать поток из трека
            try {
              const stream = new MediaStream([track]);
              if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                if (debug) {
                  console.log('[DionJingles] Настройка mixing для потока из track getter:', stream.id);
                }
                self.setupWebRTCMixing(stream);
                
                // Заменяем трек на смешанный
                if (self.mixingDestination) {
                  const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                  if (mixedTrack && track !== mixedTrack) {
                    // НЕ можем заменить через геттер, но можем попробовать через replaceTrack
                    // Но это вызовет бесконечный цикл, так что лучше просто логируем
                    if (debug) {
                      console.log('[DionJingles] Трек найден, но замена через геттер невозможна');
                    }
                  }
                }
              }
            } catch (e) {
              if (debug) {
                console.warn('[DionJingles] Ошибка обработки track getter:', e);
              }
            }
          }
          
          return track;
        },
        configurable: true,
        enumerable: true
      });
      
      if (debug) {
        console.log('[DionJingles] ✅ RTCRtpSender.track геттер перехвачен');
      }
    }
    
    if (originalReplaceTrack) {
      window.RTCRtpSender.prototype.replaceTrack = function(track) {
        const debug = self.debug !== false;
        
        // Если заменяют аудио трек, пытаемся перехватить
        if (track && track.kind === 'audio') {
          if (debug) {
            console.log('[DionJingles] replaceTrack вызван на RTCRtpSender для трека:', track.id);
          }
          
          self.ensureMixingContext();
          
          // Пытаемся создать поток из трека
          try {
            const stream = new MediaStream([track]);
            setTimeout(() => {
              self.setupWebRTCMixing(stream);
            }, 50);
          } catch (e) {
            // Игнорируем ошибки
          }
          
          // Если mixing готов, заменяем на смешанный трек
          if (self.mixingDestination) {
            const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
            if (mixedTrack && track !== mixedTrack) {
              if (debug) {
                console.log('[DionJingles] Замена трека через RTCRtpSender.replaceTrack:', track.id, '->', mixedTrack.id);
              }
              return originalReplaceTrack.call(this, mixedTrack);
            }
          }
        }
        
        return originalReplaceTrack.call(this, track);
      };
      
      if (debug) {
        console.log('[DionJingles] ✅ RTCRtpSender.replaceTrack перехвачен');
      }
    }
  }

  interceptRTCPeerConnection() {
    const self = this;
    const debug = this.debug !== false;
    
    // Перехватываем RTCPeerConnection
    if (window.RTCPeerConnection) {
      // КРИТИЧНО: Если RTCPeerConnection уже перехвачен ранним перехватом,
      // мы НЕ должны перехватывать конструктор снова - это вызовет рекурсию
      // Но мы все равно перехватываем методы на прототипе (это безопасно)
      const isAlreadyIntercepted = window.RTCPeerConnection.__dionJinglesIntercepted;
      
      if (isAlreadyIntercepted && debug) {
        console.log('[DionJingles] RTCPeerConnection уже перехвачен ранним перехватом, пропускаем повторный перехват конструктора');
      }
      
      // Сохраняем ссылку на текущий RTCPeerConnection для работы с прототипом
      const CurrentRTCPeerConnection = window.RTCPeerConnection;
      
      this.interceptRTCPeerConnectionMethods(CurrentRTCPeerConnection, 'RTCPeerConnection', isAlreadyIntercepted);
    } else {
      if (debug) {
        console.warn('[DionJingles] RTCPeerConnection не найден');
      }
    }
    
    // КРИТИЧНО: Также перехватываем webkitRTCPeerConnection
    if (window.webkitRTCPeerConnection) {
      const isWebKitIntercepted = window.webkitRTCPeerConnection.__dionJinglesIntercepted;
      
      if (debug) {
        console.log('[DionJingles] Перехватываем методы webkitRTCPeerConnection...');
      }
      
      this.interceptRTCPeerConnectionMethods(window.webkitRTCPeerConnection, 'webkitRTCPeerConnection', isWebKitIntercepted);
    }
  }
  
  interceptRTCPeerConnectionMethods(PeerConnectionClass, className, isAlreadyIntercepted) {
    const self = this;
    const debug = this.debug !== false;
    
    // КРИТИЧНО: Перехватываем sender.track на RTCRtpTransceiver
    // Это позволяет отслеживать, когда треки устанавливаются в transceivers
    if (window.RTCRtpTransceiver && window.RTCRtpTransceiver.prototype) {
      try {
        const originalSenderDescriptor = Object.getOwnPropertyDescriptor(window.RTCRtpTransceiver.prototype, 'sender');
        if (originalSenderDescriptor && originalSenderDescriptor.get) {
          const originalSenderGetter = originalSenderDescriptor.get;
          Object.defineProperty(window.RTCRtpTransceiver.prototype, 'sender', {
            get: function() {
              const sender = originalSenderGetter.call(this);
              
              // Перехватываем track на sender
              if (sender && sender.track) {
                const track = sender.track;
                if (track.kind === 'audio' && track.readyState === 'live') {
                  if (debug && !self.microphoneStream) {
                    console.log('[DionJingles] ✅ Найден аудио трек через RTCRtpTransceiver.sender.track:', track.id);
                  }
                  
                  try {
                    const stream = new MediaStream([track]);
                    if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                      if (debug) {
                        console.log('[DionJingles] Настройка mixing для потока из transceiver.sender:', stream.id);
                      }
                      self.setupWebRTCMixing(stream);
                      
                      // Заменяем трек на смешанный
                      if (self.mixingDestination) {
                        const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                        if (mixedTrack && track !== mixedTrack) {
                          if (debug) {
                            console.log('[DionJingles] Замена трека через transceiver.sender:', track.id, '->', mixedTrack.id);
                          }
                          sender.replaceTrack(mixedTrack).catch(err => {
                            if (debug) {
                              console.warn('[DionJingles] Не удалось заменить трек:', err);
                            }
                          });
                        }
                      }
                    }
                  } catch (e) {
                    if (debug) {
                      console.warn('[DionJingles] Ошибка обработки transceiver.sender.track:', e);
                    }
                  }
                }
              }
              
              return sender;
            },
            configurable: true,
            enumerable: true
          });
          
          if (debug) {
            console.log('[DionJingles] ✅ RTCRtpTransceiver.sender перехвачен');
          }
        }
      } catch (e) {
        if (debug) {
          console.warn('[DionJingles] Не удалось перехватить RTCRtpTransceiver.sender:', e);
        }
      }
      
      // КРИТИЧНО: Также перехватываем receiver.track (dion.vc может использовать его!)
      try {
        const originalReceiverDescriptor = Object.getOwnPropertyDescriptor(window.RTCRtpTransceiver.prototype, 'receiver');
        if (originalReceiverDescriptor && originalReceiverDescriptor.get) {
          const originalReceiverGetter = originalReceiverDescriptor.get;
          Object.defineProperty(window.RTCRtpTransceiver.prototype, 'receiver', {
            get: function() {
              const receiver = originalReceiverGetter.call(this);
              
              // Перехватываем track на receiver
              if (receiver && receiver.track) {
                const track = receiver.track;
                if (track.kind === 'audio' && track.readyState === 'live') {
                  if (debug && !self.microphoneStream) {
                    console.log('[DionJingles] ✅ Найден аудио трек через RTCRtpTransceiver.receiver.track:', track.id, 'label:', track.label);
                  }
                  
                  try {
                    const stream = new MediaStream([track]);
                    if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                      if (debug) {
                        console.log('[DionJingles] Настройка mixing для потока из transceiver.receiver:', stream.id);
                      }
                      self.setupWebRTCMixing(stream);
                      
                      // КРИТИЧНО: Если direction = 'sendonly', то трек в receiver может быть для отправки!
                      // В этом случае нужно заменить через sender
                      if (this.direction === 'sendonly' && this.sender) {
                        if (self.mixingDestination) {
                          const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                          if (mixedTrack && track !== mixedTrack) {
                            if (debug) {
                              console.log('[DionJingles] Замена трека через sender (трек найден в receiver):', track.id, '->', mixedTrack.id);
                            }
                            this.sender.replaceTrack(mixedTrack).catch(err => {
                              if (debug) {
                                console.warn('[DionJingles] Не удалось заменить трек через sender:', err);
                              }
                            });
                          }
                        }
                      }
                    }
                  } catch (e) {
                    if (debug) {
                      console.warn('[DionJingles] Ошибка обработки transceiver.receiver.track:', e);
                    }
                  }
                }
              }
              
              return receiver;
            },
            configurable: true,
            enumerable: true
          });
          
          if (debug) {
            console.log('[DionJingles] ✅ RTCRtpTransceiver.receiver перехвачен');
          }
        }
      } catch (e) {
        if (debug) {
          console.warn('[DionJingles] Не удалось перехватить RTCRtpTransceiver.receiver:', e);
        }
      }
      
      // КРИТИЧНО: Перехватываем setParameters (вызывается при "set parametres for transciever")
      if (window.RTCRtpTransceiver.prototype.setParameters) {
        const originalSetParameters = window.RTCRtpTransceiver.prototype.setParameters;
        window.RTCRtpTransceiver.prototype.setParameters = function(params) {
          const debug = self.debug !== false;
          
          if (debug) {
            console.log('[DionJingles] setParameters вызван для transceiver:', this.mid, 'direction:', this.direction);
          }
          
          // Проверяем треки после установки параметров
          setTimeout(() => {
            try {
              // Проверяем receiver.track
              if (this.receiver && this.receiver.track) {
                const track = this.receiver.track;
                if (track.kind === 'audio' && track.readyState === 'live') {
                  if (debug && !self.microphoneStream) {
                    console.log('[DionJingles] ✅ Найден аудио трек в receiver после setParameters:', track.id);
                  }
                  
                  try {
                    const stream = new MediaStream([track]);
                    if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                      if (debug) {
                        console.log('[DionJingles] Настройка mixing для потока из receiver (setParameters):', stream.id);
                      }
                      self.setupWebRTCMixing(stream);
                      
                      // Если direction = 'sendonly', заменяем через sender
                      if (this.direction === 'sendonly' && this.sender) {
                        if (self.mixingDestination) {
                          const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                          if (mixedTrack && track !== mixedTrack) {
                            if (debug) {
                              console.log('[DionJingles] Замена трека через sender (setParameters):', track.id, '->', mixedTrack.id);
                            }
                            this.sender.replaceTrack(mixedTrack).catch(err => {
                              if (debug) {
                                console.warn('[DionJingles] Не удалось заменить трек:', err);
                              }
                            });
                          }
                        }
                      }
                    }
                  } catch (e) {
                    if (debug) {
                      console.warn('[DionJingles] Ошибка обработки после setParameters:', e);
                    }
                  }
                }
              }
              
              // Также проверяем sender.track
              if (this.sender && this.sender.track) {
                const track = this.sender.track;
                if (track.kind === 'audio' && track.readyState === 'live') {
                  if (debug && !self.microphoneStream) {
                    console.log('[DionJingles] ✅ Найден аудио трек в sender после setParameters:', track.id);
                  }
                  
                  try {
                    const stream = new MediaStream([track]);
                    if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                      if (debug) {
                        console.log('[DionJingles] Настройка mixing для потока из sender (setParameters):', stream.id);
                      }
                      self.setupWebRTCMixing(stream);
                      
                      if (self.mixingDestination) {
                        const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                        if (mixedTrack && track !== mixedTrack) {
                          if (debug) {
                            console.log('[DionJingles] Замена трека через sender (setParameters):', track.id, '->', mixedTrack.id);
                          }
                          this.sender.replaceTrack(mixedTrack).catch(err => {
                            if (debug) {
                              console.warn('[DionJingles] Не удалось заменить трек:', err);
                            }
                          });
                        }
                      }
                    }
                  } catch (e) {
                    if (debug) {
                      console.warn('[DionJingles] Ошибка обработки sender после setParameters:', e);
                    }
                  }
                }
              }
            } catch (e) {
              if (debug) {
                console.warn('[DionJingles] Ошибка проверки треков после setParameters:', e);
              }
            }
          }, 50);
          
          return originalSetParameters.call(this, params);
        };
        
        if (debug) {
          console.log('[DionJingles] ✅ RTCRtpTransceiver.setParameters перехвачен');
        }
      } else {
        if (debug) {
          console.warn('[DionJingles] ⚠️ RTCRtpTransceiver.setParameters не найден на прототипе');
          console.warn('[DionJingles] Попытка найти setParameters другими способами...');
          
          // Проверяем, может быть setParameters добавляется позже
          setTimeout(() => {
            if (window.RTCRtpTransceiver.prototype.setParameters) {
              console.log('[DionJingles] ✅ setParameters найден позже, перехватываем...');
              const originalSetParameters = window.RTCRtpTransceiver.prototype.setParameters;
              window.RTCRtpTransceiver.prototype.setParameters = function(params) {
                const debug = self.debug !== false;
                if (debug) {
                  console.log('[DionJingles] setParameters вызван (поздний перехват):', this.mid);
                }
                const result = originalSetParameters.call(this, params);
                setTimeout(() => {
                  self.checkTransceiverForAudio(this, 'setParameters (поздний)');
                }, 50);
                return result;
              };
            }
          }, 1000);
        }
      }
      
      // КРИТИЧНО: Перехватываем все методы RTCRtpTransceiver через Proxy
      // Это позволит перехватить любые вызовы методов
      try {
        const originalTransceiverMethods = {};
        const methodNames = ['setParameters', 'setCodecPreferences', 'stop'];
        
        methodNames.forEach(methodName => {
          if (window.RTCRtpTransceiver.prototype[methodName]) {
            originalTransceiverMethods[methodName] = window.RTCRtpTransceiver.prototype[methodName];
          }
        });
        
        // Перехватываем через Proxy все методы
        const TransceiverProxy = new Proxy(window.RTCRtpTransceiver.prototype, {
          get: function(target, prop) {
            const original = target[prop];
            
            // Если это метод, который мы хотим перехватить
            if (typeof original === 'function' && (prop === 'setParameters' || prop === 'setCodecPreferences')) {
              return function(...args) {
                const debug = self.debug !== false;
                
                if (debug) {
                  console.log(`[DionJingles] 🔍 RTCRtpTransceiver.${prop} вызван:`, this.mid, 'direction:', this.direction, 'args:', args);
                }
                
                // Вызываем оригинальный метод
                const result = original.apply(this, args);
                
                // После вызова проверяем треки
                setTimeout(() => {
                  try {
                    // Проверяем receiver.track
                    if (this.receiver && this.receiver.track) {
                      const track = this.receiver.track;
                      if (track.kind === 'audio' && track.readyState === 'live') {
                        if (debug && !self.microphoneStream) {
                          console.log(`[DionJingles] ✅ Найден аудио трек в receiver после ${prop}:`, track.id);
                        }
                        
                        try {
                          const stream = new MediaStream([track]);
                          if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                            if (debug) {
                              console.log(`[DionJingles] Настройка mixing для потока из receiver (${prop}):`, stream.id);
                            }
                            self.setupWebRTCMixing(stream);
                            
                            if (this.direction === 'sendonly' && this.sender) {
                              if (self.mixingDestination) {
                                const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                                if (mixedTrack && track !== mixedTrack) {
                                  if (debug) {
                                    console.log(`[DionJingles] Замена трека через sender (${prop}):`, track.id, '->', mixedTrack.id);
                                  }
                                  this.sender.replaceTrack(mixedTrack).catch(err => {
                                    if (debug) {
                                      console.warn('[DionJingles] Не удалось заменить трек:', err);
                                    }
                                  });
                                }
                              }
                            }
                          }
                        } catch (e) {
                          if (debug) {
                            console.warn(`[DionJingles] Ошибка обработки после ${prop}:`, e);
                          }
                        }
                      }
                    }
                  } catch (e) {
                    if (debug) {
                      console.warn(`[DionJingles] Ошибка проверки треков после ${prop}:`, e);
                    }
                  }
                }, 50);
                
                return result;
              };
            }
            
            return original;
          }
        });
        
        // НЕ заменяем прототип - это не сработает
        // Вместо этого перехватываем методы напрямую
        if (debug) {
          console.log('[DionJingles] ✅ RTCRtpTransceiver методы будут перехвачены при вызове');
        }
      } catch (e) {
        if (debug) {
          console.warn('[DionJingles] Не удалось использовать Proxy для RTCRtpTransceiver:', e);
        }
      }
      
      // КРИТИЧНО: Перехватываем setCodecPreferences (может использоваться вместо setParameters)
      if (window.RTCRtpTransceiver.prototype.setCodecPreferences) {
        const originalSetCodecPreferences = window.RTCRtpTransceiver.prototype.setCodecPreferences;
        window.RTCRtpTransceiver.prototype.setCodecPreferences = function(codecs) {
          const debug = self.debug !== false;
          
          if (debug) {
            console.log('[DionJingles] setCodecPreferences вызван для transceiver:', this.mid);
          }
          
          // Проверяем треки после установки codec preferences
          setTimeout(() => {
            self.checkTransceiverForAudio(this, 'setCodecPreferences');
          }, 50);
          
          return originalSetCodecPreferences.call(this, codecs);
        };
        
        if (debug) {
          console.log('[DionJingles] ✅ RTCRtpTransceiver.setCodecPreferences перехвачен');
        }
      }
      
      // Добавляем вспомогательную функцию для проверки transceiver
      self.checkTransceiverForAudio = function(transceiver, source) {
        const debug = self.debug !== false;
        
        try {
          // Проверяем receiver.track
          if (transceiver.receiver && transceiver.receiver.track) {
            const track = transceiver.receiver.track;
            if (track.kind === 'audio' && track.readyState === 'live') {
              if (debug && !self.microphoneStream) {
                console.log(`[DionJingles] ✅ Найден аудио трек в receiver (${source}):`, track.id, 'label:', track.label);
              }
              
              try {
                const stream = new MediaStream([track]);
                if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                  if (debug) {
                    console.log(`[DionJingles] Настройка mixing для потока из receiver (${source}):`, stream.id);
                  }
                  self.setupWebRTCMixing(stream);
                  
                  if (transceiver.direction === 'sendonly' && transceiver.sender) {
                    if (self.mixingDestination) {
                      const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                      if (mixedTrack && track !== mixedTrack) {
                        if (debug) {
                          console.log(`[DionJingles] Замена трека через sender (${source}):`, track.id, '->', mixedTrack.id);
                        }
                        transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                          if (debug) {
                            console.warn('[DionJingles] Не удалось заменить трек:', err);
                          }
                        });
                      }
                    }
                  }
                }
              } catch (e) {
                if (debug) {
                  console.warn(`[DionJingles] Ошибка обработки receiver (${source}):`, e);
                }
              }
            }
          }
          
          // Также проверяем sender.track
          if (transceiver.sender && transceiver.sender.track) {
            const track = transceiver.sender.track;
            if (track.kind === 'audio' && track.readyState === 'live') {
              if (debug && !self.microphoneStream) {
                console.log(`[DionJingles] ✅ Найден аудио трек в sender (${source}):`, track.id);
              }
              
              try {
                const stream = new MediaStream([track]);
                if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                  if (debug) {
                    console.log(`[DionJingles] Настройка mixing для потока из sender (${source}):`, stream.id);
                  }
                  self.setupWebRTCMixing(stream);
                  
                  if (self.mixingDestination) {
                    const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                    if (mixedTrack && track !== mixedTrack) {
                      if (debug) {
                        console.log(`[DionJingles] Замена трека через sender (${source}):`, track.id, '->', mixedTrack.id);
                      }
                      transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                        if (debug) {
                          console.warn('[DionJingles] Не удалось заменить трек:', err);
                        }
                      });
                    }
                  }
                }
              } catch (e) {
                if (debug) {
                  console.warn(`[DionJingles] Ошибка обработки sender (${source}):`, e);
                }
              }
            }
          }
        } catch (e) {
          if (debug) {
            console.warn(`[DionJingles] Ошибка проверки transceiver (${source}):`, e);
          }
        }
      };
    }
    
    // Перехватываем getTransceivers на ПРОТОТИПЕ (чтобы работало для всех экземпляров)
    // КРИТИЧНО: Это должно работать даже для RTCPeerConnection, созданных до загрузки скрипта
    if (PeerConnectionClass.prototype.getTransceivers) {
      const originalGetTransceivers = PeerConnectionClass.prototype.getTransceivers;
      
      // Сохраняем ссылку на self для доступа из перехваченной функции
      const playerInstance = self;
      
      PeerConnectionClass.prototype.getTransceivers = function() {
        const transceivers = originalGetTransceivers.call(this);
        const debug = playerInstance.debug !== false;
        
        // Сохраняем этот PC для последующей обработки
        if (!playerInstance.allPeerConnections) {
          playerInstance.allPeerConnections = [];
        }
        if (!playerInstance.allPeerConnections.includes(this)) {
          playerInstance.allPeerConnections.push(this);
          if (debug) {
            console.log('[DionJingles] ✅ RTCPeerConnection найден через getTransceivers:', this);
          }
        }
        
        if (debug && transceivers.length > 0) {
          console.log('[DionJingles] getTransceivers вызван (прототип), найдено:', transceivers.length);
        }
        
        playerInstance.ensureMixingContext();
        
        // Ищем аудио треки в sender И receiver
        // КРИТИЧНО: dion.vc может использовать receiver.track для отправки аудио!
        transceivers.forEach((transceiver, index) => {
          // Проверяем sender.track
          if (transceiver.sender && transceiver.sender.track) {
            const track = transceiver.sender.track;
            if (track.kind === 'audio') {
              if (debug) {
                console.log(`[DionJingles] 🔍 Аудио трек в transceiver.sender ${index}:`, track.id, 'readyState:', track.readyState, 'label:', track.label, 'enabled:', track.enabled, 'muted:', track.muted);
              }
              
              try {
                const stream = new MediaStream([track]);
                if (!playerInstance.microphoneStream || playerInstance.microphoneStream.id !== stream.id) {
                  if (debug) {
                    console.log('[DionJingles] Настройка mixing для потока из sender:', stream.id);
                  }
                  playerInstance.setupWebRTCMixing(stream);
                  
                  // Заменяем трек на смешанный
                  if (playerInstance.mixingDestination) {
                    const mixedTrack = playerInstance.mixingDestination.stream.getAudioTracks()[0];
                    if (mixedTrack && track !== mixedTrack) {
                      if (debug) {
                        console.log('[DionJingles] Замена трека в transceiver.sender:', track.id, '->', mixedTrack.id);
                      }
                      transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                        if (debug) {
                          console.warn('[DionJingles] Не удалось заменить трек:', err);
                        }
                      });
                    }
                  }
                }
              } catch (e) {
                if (debug) {
                  console.warn('[DionJingles] Ошибка обработки transceiver.sender:', e);
                }
              }
            }
          }
          
          // КРИТИЧНО: Также проверяем receiver.track (dion.vc может использовать его!)
          if (transceiver.receiver && transceiver.receiver.track) {
            const track = transceiver.receiver.track;
            if (track.kind === 'audio') {
              if (debug) {
                console.log(`[DionJingles] 🔍 Аудио трек в transceiver.receiver ${index}:`, track.id, 'readyState:', track.readyState, 'label:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'direction:', transceiver.direction);
              }
              
              // Проверяем даже если readyState еще не 'live' - трек может стать live позже
              if (track.readyState === 'live') {
                try {
                  const stream = new MediaStream([track]);
                  if (!playerInstance.microphoneStream || playerInstance.microphoneStream.id !== stream.id) {
                    if (debug) {
                      console.log('[DionJingles] Настройка mixing для потока из receiver:', stream.id);
                    }
                    playerInstance.setupWebRTCMixing(stream);
                    
                    // КРИТИЧНО: Если direction = 'sendonly', то трек в receiver может быть для отправки!
                    // В этом случае нужно заменить через sender
                    if (transceiver.direction === 'sendonly' && transceiver.sender) {
                      if (playerInstance.mixingDestination) {
                        const mixedTrack = playerInstance.mixingDestination.stream.getAudioTracks()[0];
                        if (mixedTrack && track !== mixedTrack) {
                          if (debug) {
                            console.log('[DionJingles] Замена трека через sender (трек найден в receiver):', track.id, '->', mixedTrack.id);
                          }
                          transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                            if (debug) {
                              console.warn('[DionJingles] Не удалось заменить трек через sender:', err);
                            }
                          });
                        }
                      }
                    }
                  }
                } catch (e) {
                  if (debug) {
                    console.warn('[DionJingles] Ошибка обработки transceiver.receiver:', e);
                  }
                }
              }
            }
          }
        });
        
        return transceivers;
      };
      
      if (debug) {
        console.log(`[DionJingles] ✅ getTransceivers перехвачен на прототипе ${className}`);
      }
    }
    
    // Перехватываем getSenders на прототипе
    if (PeerConnectionClass.prototype.getSenders) {
      const originalGetSenders = PeerConnectionClass.prototype.getSenders;
      const playerInstance = self;
      
      PeerConnectionClass.prototype.getSenders = function() {
        const senders = originalGetSenders.call(this);
        const debug = playerInstance.debug !== false;
        
        // Сохраняем этот PC для последующей обработки
        if (!playerInstance.allPeerConnections) {
          playerInstance.allPeerConnections = [];
        }
        if (!playerInstance.allPeerConnections.includes(this)) {
          playerInstance.allPeerConnections.push(this);
          if (debug) {
            console.log(`[DionJingles] ✅ ${className} найден через getSenders:`, this);
          }
        }
        
        // Ищем аудио треки
        senders.forEach((sender, index) => {
          if (sender.track && sender.track.kind === 'audio') {
            const track = sender.track;
            if (debug && !playerInstance.microphoneStream) {
              console.log(`[DionJingles] ✅ Найден аудио трек в sender ${index} (${className}):`, track.id);
            }
            
            try {
              const stream = new MediaStream([track]);
              if (!playerInstance.microphoneStream || playerInstance.microphoneStream.id !== stream.id) {
                if (debug) {
                  console.log(`[DionJingles] Настройка mixing для потока из sender (${className}):`, stream.id);
                }
                playerInstance.setupWebRTCMixing(stream);
                
                // Заменяем трек на смешанный
                if (playerInstance.mixingDestination) {
                  const mixedTrack = playerInstance.mixingDestination.stream.getAudioTracks()[0];
                  if (mixedTrack && track !== mixedTrack) {
                    if (debug) {
                      console.log(`[DionJingles] Замена трека в sender (${className}):`, track.id, '->', mixedTrack.id);
                    }
                    sender.replaceTrack(mixedTrack).catch(err => {
                      if (debug) {
                        console.warn('[DionJingles] Не удалось заменить трек:', err);
                      }
                    });
                  }
                }
              }
            } catch (e) {
              if (debug) {
                console.warn('[DionJingles] Ошибка обработки sender:', e);
              }
            }
          }
        });
        
        return senders;
      };
      
      if (debug) {
        console.log(`[DionJingles] ✅ getSenders перехвачен на прототипе ${className}`);
      }
    }

    // Перехватываем конструктор ТОЛЬКО если он еще не перехвачен
    // И только для RTCPeerConnection (не для webkitRTCPeerConnection, так как он уже перехвачен)
    if (!isAlreadyIntercepted && className === 'RTCPeerConnection') {
      window.RTCPeerConnection = function(...args) {
        const pc = new PeerConnectionClass(...args);
      
      if (debug) {
        console.log('[DionJingles] RTCPeerConnection создан');
      }
      
      // Сохраняем ссылку на этот PC для периодической проверки
      if (!self.allPeerConnections) {
        self.allPeerConnections = [];
      }
      self.allPeerConnections.push(pc);
      
      // КРИТИЧНО: Перехватываем getSenders - это вызывается чаще, чем getTransceivers
      const originalGetSenders = pc.getSenders.bind(pc);
      pc.getSenders = function() {
        const senders = originalGetSenders();
        const debug = self.debug !== false;
        
        // Ищем аудио треки в senders
        senders.forEach((sender, index) => {
          if (sender.track && sender.track.kind === 'audio') {
            const track = sender.track;
            if (debug && !self.microphoneStream) {
              console.log(`[DionJingles] ✅ Найден аудио трек в sender ${index}:`, track.id, 'readyState:', track.readyState);
            }
            
            try {
              const stream = new MediaStream([track]);
              if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                if (debug) {
                  console.log('[DionJingles] Настройка mixing для потока из sender:', stream.id);
                }
                self.setupWebRTCMixing(stream);
                
                // Заменяем трек на смешанный
                if (self.mixingDestination) {
                  const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                  if (mixedTrack && track !== mixedTrack) {
                    if (debug) {
                      console.log('[DionJingles] Замена трека в sender:', track.id, '->', mixedTrack.id);
                    }
                    sender.replaceTrack(mixedTrack).catch(err => {
                      if (debug) {
                        console.warn('[DionJingles] Не удалось заменить трек:', err);
                      }
                    });
                  }
                }
              }
            } catch (e) {
              if (debug) {
                console.warn('[DionJingles] Ошибка обработки sender:', e);
              }
            }
          }
        });
        
        return senders;
      };
      
      // Агрессивно проверяем transceivers сразу и периодически
      const checkTransceivers = () => {
        try {
          const transceivers = pc.getTransceivers();
          if (debug && transceivers.length > 0) {
            console.log('[DionJingles] Проверка transceivers:', transceivers.length);
          }
          
          // Ищем аудио треки
          transceivers.forEach((transceiver, index) => {
            if (transceiver.sender && transceiver.sender.track) {
              const track = transceiver.sender.track;
              if (track.kind === 'audio') {
                if (debug && !self.microphoneStream) {
                  console.log(`[DionJingles] ✅ Найден аудио трек в transceiver ${index}:`, track.id, 'readyState:', track.readyState);
                }
                
                try {
                  const stream = new MediaStream([track]);
                  if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
                    if (debug) {
                      console.log('[DionJingles] Настройка mixing для потока:', stream.id);
                    }
                    self.setupWebRTCMixing(stream);
                    
                    // Заменяем трек на смешанный
                    if (self.mixingDestination) {
                      const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                      if (mixedTrack && track !== mixedTrack) {
                        if (debug) {
                          console.log('[DionJingles] Замена трека в transceiver:', track.id, '->', mixedTrack.id);
                        }
                        transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                          if (debug) {
                            console.warn('[DionJingles] Не удалось заменить трек:', err);
                          }
                        });
                      }
                    }
                  }
                } catch (e) {
                  if (debug) {
                    console.warn('[DionJingles] Ошибка создания потока:', e);
                  }
                }
              }
            }
          });
        } catch (e) {
          // Игнорируем ошибки
        }
      };
      
      // Проверяем сразу и периодически (более агрессивно)
      checkTransceivers();
      setTimeout(checkTransceivers, 50);
      setTimeout(checkTransceivers, 100);
      setTimeout(checkTransceivers, 200);
      setTimeout(checkTransceivers, 500);
      setTimeout(checkTransceivers, 1000);
      setTimeout(checkTransceivers, 2000);
      
      // Также слушаем события на RTCPeerConnection
      pc.addEventListener('track', (event) => {
        if (debug) {
          console.log('[DionJingles] RTCPeerConnection track event:', event.track.kind, event.track.id, event.track.readyState);
        }
        if (event.track && event.track.kind === 'audio') {
          try {
            const stream = new MediaStream([event.track]);
            if (!self.microphoneStream || self.microphoneStream.id !== stream.id) {
              if (debug) {
                console.log('[DionJingles] Настройка mixing для трека из track event:', stream.id);
              }
              self.setupWebRTCMixing(stream);
            }
          } catch (e) {
            if (debug) {
              console.warn('[DionJingles] Ошибка обработки track event:', e);
            }
          }
        }
      });
      
      // Слушаем событие negotiationneeded - когда настраиваются transceivers
      pc.addEventListener('negotiationneeded', () => {
        if (debug) {
          console.log('[DionJingles] negotiationneeded event - проверяем transceivers');
        }
        setTimeout(checkTransceivers, 100);
      });
      
      // Перехватываем getTransceivers на экземпляре (дополнительно к прототипу)
      // Это нужно для случаев, когда метод переопределен на экземпляре
      const originalGetTransceiversInstance = pc.getTransceivers.bind(pc);
      pc.getTransceivers = function() {
        const transceivers = originalGetTransceiversInstance();
        const debug = self.debug !== false;
        
        if (debug) {
          console.log('[DionJingles] getTransceivers вызван (экземпляр), найдено:', transceivers.length);
        }
        
        // Логика обработки уже в прототипе, но можем добавить дополнительную проверку
        return transceivers;
      };

      // Перехватываем addTrack для замены аудио треков на смешанный поток
      const originalAddTrack = pc.addTrack.bind(pc);
      pc.addTrack = function(track, ...streams) {
        const debug = self.debug !== false;
        
        // Если это аудио трек, пытаемся перехватить поток
        if (track.kind === 'audio') {
          if (debug) {
            console.log('[DionJingles] addTrack вызван для аудио трека:', track.id);
          }
          
          // Убеждаемся, что mixing context создан
          self.ensureMixingContext();
          
          // Пытаемся найти поток, из которого взят трек
          if (streams.length > 0 && streams[0] && typeof streams[0].getAudioTracks === 'function') {
            const stream = streams[0];
            if (debug) {
              console.log('[DionJingles] Найден поток в addTrack:', stream.id, 'треков:', stream.getAudioTracks().length);
            }
            // Настраиваем mixing для этого потока
            setTimeout(() => {
              self.setupWebRTCMixing(stream);
            }, 50);
          } else {
            // Пытаемся найти поток через сам трек (если он еще не отсоединен)
            // Это может не сработать, но попробуем
            if (debug) {
              console.log('[DionJingles] Поток не найден в addTrack, пытаемся найти через другие способы');
            }
            // Запускаем поиск существующих потоков
            setTimeout(() => {
              self.findAndInterceptExistingStreams();
            }, 100);
          }
          
          // Если mixing destination готов, заменяем трек
          if (self.mixingDestination) {
            const mixedStream = self.mixingDestination.stream;
            const mixedTrack = mixedStream.getAudioTracks()[0];
            if (mixedTrack) {
              if (debug) {
                console.log('[DionJingles] Заменяем трек на смешанный:', mixedTrack.id);
              }
              return originalAddTrack(mixedTrack, ...streams);
            }
          }
        }
        return originalAddTrack(track, ...streams);
      };

      // getSenders уже перехвачен выше (строка 462), не перехватываем повторно
      
      // Перехватываем addTransceiver для перехвата потоков
      const originalAddTransceiver = pc.addTransceiver.bind(pc);
      pc.addTransceiver = function(trackOrKind, init) {
        const debug = self.debug !== false;
        
        if (typeof trackOrKind === 'object' && trackOrKind && trackOrKind.kind === 'audio') {
          if (debug) {
            console.log('[DionJingles] addTransceiver вызван для аудио трека:', trackOrKind.id);
          }
          
          // Убеждаемся, что mixing context создан
          self.ensureMixingContext();
          
          // Пытаемся создать поток из трека, если это возможно
          try {
            const stream = new MediaStream([trackOrKind]);
            if (debug) {
              console.log('[DionJingles] Создан поток из трека addTransceiver:', stream.id);
            }
            setTimeout(() => {
              self.setupWebRTCMixing(stream);
            }, 50);
          } catch (e) {
            if (debug) {
              console.log('[DionJingles] Не удалось создать поток из трека, ищем существующие потоки');
            }
            // Если не удалось создать поток, ищем существующие
            setTimeout(() => {
              self.findAndInterceptExistingStreams();
            }, 100);
          }
        } else if (typeof trackOrKind === 'string' && trackOrKind === 'audio') {
          if (debug) {
            console.log('[DionJingles] addTransceiver вызван для аудио kind');
          }
          // В этом случае поток будет создан позже, полагаемся на getUserMedia или addTrack
          self.ensureMixingContext();
        }
        
        const transceiver = originalAddTransceiver(trackOrKind, init);
        
        // Перехватываем replaceTrack на sender этого transceiver
        if (transceiver && transceiver.sender && transceiver.sender.replaceTrack) {
          const originalSenderReplaceTrack = transceiver.sender.replaceTrack.bind(transceiver.sender);
          transceiver.sender.replaceTrack = function(track) {
            const debug = self.debug !== false;
            
            if (track && track.kind === 'audio') {
              if (debug) {
                console.log('[DionJingles] replaceTrack на transceiver sender для трека:', track.id);
              }
              
              self.ensureMixingContext();
              
              try {
                const stream = new MediaStream([track]);
                setTimeout(() => {
                  self.setupWebRTCMixing(stream);
                }, 50);
              } catch (e) {
                // Игнорируем ошибки
              }
              
              if (self.mixingDestination) {
                const mixedTrack = self.mixingDestination.stream.getAudioTracks()[0];
                if (mixedTrack) {
                  if (debug) {
                    console.log('[DionJingles] Замена трека через transceiver replaceTrack:', track.id, '->', mixedTrack.id);
                  }
                  return originalSenderReplaceTrack(mixedTrack);
                }
              }
            }
            
            return originalSenderReplaceTrack(track);
          };
        }
        
        return transceiver;
      };

        return pc;
      };

      // Копируем статические свойства
      Object.setPrototypeOf(window.RTCPeerConnection, PeerConnectionClass);
      Object.setPrototypeOf(window.RTCPeerConnection.prototype, PeerConnectionClass.prototype);
      
      if (debug) {
        console.log('[DionJingles] ✅ RTCPeerConnection перехвачен');
      }
    } else {
      if (debug) {
        console.log('[DionJingles] ✅ RTCPeerConnection уже перехвачен, перехватываем только методы на прототипе');
      }
    }
  }

  setupWebRTCMixing(stream) {
    const debug = this.debug !== false;
    
    if (this.microphoneStream === stream) {
      if (debug) {
        console.log('[DionJingles] Поток уже настроен:', stream.id);
      }
      return; // Уже настроен
    }

    if (debug) {
      console.log('[DionJingles] Настройка WebRTC mixing для потока:', stream.id);
    }

    this.microphoneStream = stream;
    this.ensureMixingContext();

    // Получаем аудио треки из потока
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      if (debug) {
        console.warn('[DionJingles] Нет аудио треков в потоке');
      }
      return;
    }

    if (debug) {
      console.log('[DionJingles] Найдено аудио треков:', audioTracks.length, audioTracks.map(t => t.id));
    }

    // Отключаем предыдущий источник, если есть
    if (this.microphoneSource) {
      try {
        this.microphoneSource.disconnect();
        if (debug) {
          console.log('[DionJingles] Предыдущий источник отключен');
        }
      } catch (e) {
        if (debug) {
          console.warn('[DionJingles] Ошибка отключения предыдущего источника:', e);
        }
      }
    }

    // Создаем источник из микрофона
    try {
      this.microphoneSource = this.mixingContext.createMediaStreamSource(stream);
      
      if (debug) {
        console.log('[DionJingles] Источник создан из потока');
      }
      
      // Смешиваем микрофон с джинглами
      this.microphoneSource.connect(this.mixingDestination);

      if (debug) {
        console.log('[DionJingles] Источник подключен к mixing destination');
      }

      // Заменяем аудио трек в потоке на смешанный
      const mixedStream = this.mixingDestination.stream;
      const mixedAudioTrack = mixedStream.getAudioTracks()[0];

      if (mixedAudioTrack) {
        if (debug) {
          console.log('[DionJingles] Смешанный трек получен:', mixedAudioTrack.id);
        }
        
        // НЕ останавливаем оригинальные треки - они могут использоваться в RTCPeerConnection
        // Вместо этого добавляем смешанный трек в поток
        // Оригинальные треки останутся, но мы также добавим смешанный
        stream.addTrack(mixedAudioTrack);
        
        // Также пытаемся найти все RTCPeerConnection и заменить треки через replaceTrack
        // Это более надежный способ
        setTimeout(() => {
          this.replaceTracksInAllPeerConnections(mixedAudioTrack);
        }, 100);

        if (debug) {
          console.log('[DionJingles] ✅ WebRTC mixing настроен - звуки будут слышны другим участникам', {
            originalTracks: audioTracks.length,
            mixedTrackId: mixedAudioTrack.id,
            streamId: stream.id,
            mixedStreamId: mixedStream.id
          });
        }
      } else {
        console.error('[DionJingles] ❌ Смешанный трек не найден!');
      }
    } catch (error) {
      console.error('[DionJingles] ❌ Ошибка настройки WebRTC mixing:', error);
    }
  }

  ensureAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  ensureMixingContext() {
    if (!this.mixingContext) {
      try {
        this.mixingContext = new (window.AudioContext || window.webkitAudioContext)();
        this.mixingDestination = this.mixingContext.createMediaStreamDestination();
        const debug = this.debug !== false;
        if (debug) {
          console.log('[DionJingles] ✅ Mixing context создан:', {
            state: this.mixingContext.state,
            sampleRate: this.mixingContext.sampleRate,
            destinationStreamId: this.mixingDestination.stream.id,
            audioTracks: this.mixingDestination.stream.getAudioTracks().length
          });
        }
      } catch (error) {
        console.error('[DionJingles] ❌ Ошибка создания mixing context:', error);
      }
    } else {
      const debug = this.debug !== false;
      if (debug) {
        console.log('[DionJingles] Mixing context уже существует:', {
          state: this.mixingContext.state,
          hasDestination: !!this.mixingDestination
        });
      }
    }
    
    // Resume если suspended
    if (this.mixingContext && this.mixingContext.state === 'suspended') {
      this.mixingContext.resume().catch(e => {
        if (this.debug) {
          console.warn('[DionJingles] Не удалось resume mixing context:', e);
        }
      });
    }
  }
  
  replaceTracksInAllPeerConnections(mixedTrack) {
    const debug = this.debug !== false;
    
    // Используем сохраненные RTCPeerConnection
    const allPCs = [...(this.allPeerConnections || [])];
    
    // Также ищем в глобальном контексте
    const possiblePCNames = ['pc', 'peerConnection', 'rtcPeerConnection', 'webrtc', 'rtc'];
    for (const name of possiblePCNames) {
      try {
        const pc = window[name];
        if (pc && (pc.getTransceivers || pc.getSenders) && !allPCs.includes(pc)) {
          allPCs.push(pc);
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    }
    
    // Заменяем треки во всех найденных RTCPeerConnection
    // #region agent log
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H4',location:'content.js:replaceTracksInAllPeerConnections',message:'replaceTracks run',data:{allPeerConnectionsTracked:(this.allPeerConnections||[]).length,totalCandidates:allPCs.length,mixedTrackId:mixedTrack&&mixedTrack.id},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    allPCs.forEach(pc => {
      try {
        // Сначала пробуем через getTransceivers (более надежно для dion.vc)
        if (pc.getTransceivers) {
          const transceivers = pc.getTransceivers();
          transceivers.forEach(transceiver => {
            if (transceiver.sender && transceiver.sender.track && 
                transceiver.sender.track.kind === 'audio' && 
                transceiver.sender.track !== mixedTrack) {
              if (debug) {
                console.log('[DionJingles] Замена трека в transceiver:', transceiver.sender.track.id, '->', mixedTrack.id);
              }
              transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                if (debug) {
                  console.warn('[DionJingles] Не удалось заменить трек в transceiver:', err);
                }
              });
            }
          });
        }
        
        // Также пробуем через getSenders (на всякий случай)
        if (pc.getSenders) {
          const senders = pc.getSenders();
          senders.forEach(sender => {
            if (sender.track && sender.track.kind === 'audio' && sender.track !== mixedTrack) {
              if (debug) {
                console.log('[DionJingles] Замена трека в sender:', sender.track.id, '->', mixedTrack.id);
              }
              sender.replaceTrack(mixedTrack).catch(err => {
                if (debug) {
                  console.warn('[DionJingles] Не удалось заменить трек в sender:', err);
                }
              });
            }
          });
        }
      } catch (e) {
        if (debug) {
          console.warn('[DionJingles] Ошибка при замене треков в RTCPeerConnection:', e);
        }
      }
    });
  }
  
  // Поиск и обработка конкретного аудио трека
  findAndProcessAudioTrack(track) {
    const debug = this.debug !== false;
    
    if (!track || track.kind !== 'audio' || track.readyState !== 'live') {
      return;
    }
    
    if (debug) {
      console.log('[DionJingles] 🔍 Поиск использования трека:', track.id, 'label:', track.label);
    }
    
    // 1. Ищем во всех RTCPeerConnection
    const allPCs = new Set();
    if (this.allPeerConnections) {
      this.allPeerConnections.forEach(pc => allPCs.add(pc));
    }
    if (window.__dionJinglesPCs) {
      window.__dionJinglesPCs.forEach(pc => allPCs.add(pc));
    }
    
    // Также ищем через Object.keys
    try {
      Object.keys(window).forEach(key => {
        try {
          const obj = window[key];
          if (obj && typeof obj.getTransceivers === 'function' && obj instanceof RTCPeerConnection) {
            allPCs.add(obj);
          }
        } catch (e) {
          // Игнорируем
        }
      });
    } catch (e) {
      // Игнорируем
    }
    
    // Проверяем все PC
    allPCs.forEach(pc => {
      try {
        // Проверяем transceivers
        const transceivers = pc.getTransceivers();
        transceivers.forEach(transceiver => {
          // Проверяем sender.track
          if (transceiver.sender && transceiver.sender.track === track) {
            if (debug) {
              console.log('[DionJingles] ✅ Трек найден в transceiver.sender:', track.id);
            }
            
            try {
              const stream = new MediaStream([track]);
              if (!this.microphoneStream || this.microphoneStream.id !== stream.id) {
                if (debug) {
                  console.log('[DionJingles] Настройка mixing для трека из sender:', stream.id);
                }
                this.setupWebRTCMixing(stream);
                
                if (this.mixingDestination) {
                  const mixedTrack = this.mixingDestination.stream.getAudioTracks()[0];
                  if (mixedTrack && track !== mixedTrack) {
                    if (debug) {
                      console.log('[DionJingles] Замена трека через sender:', track.id, '->', mixedTrack.id);
                    }
                    transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                      if (debug) {
                        console.warn('[DionJingles] Не удалось заменить трек:', err);
                      }
                    });
                  }
                }
              }
            } catch (e) {
              if (debug) {
                console.warn('[DionJingles] Ошибка обработки трека из sender:', e);
              }
            }
          }
          
          // Проверяем receiver.track
          if (transceiver.receiver && transceiver.receiver.track === track) {
            if (debug) {
              console.log('[DionJingles] ✅ Трек найден в transceiver.receiver:', track.id, 'direction:', transceiver.direction);
            }
            
            try {
              const stream = new MediaStream([track]);
              if (!this.microphoneStream || this.microphoneStream.id !== stream.id) {
                if (debug) {
                  console.log('[DionJingles] Настройка mixing для трека из receiver:', stream.id);
                }
                this.setupWebRTCMixing(stream);
                
                // Если direction = 'sendonly', заменяем через sender
                if (transceiver.direction === 'sendonly' && transceiver.sender) {
                  if (this.mixingDestination) {
                    const mixedTrack = this.mixingDestination.stream.getAudioTracks()[0];
                    if (mixedTrack && track !== mixedTrack) {
                      if (debug) {
                        console.log('[DionJingles] Замена трека через sender (трек в receiver):', track.id, '->', mixedTrack.id);
                      }
                      transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                        if (debug) {
                          console.warn('[DionJingles] Не удалось заменить трек:', err);
                        }
                      });
                    }
                  }
                }
              }
            } catch (e) {
              if (debug) {
                console.warn('[DionJingles] Ошибка обработки трека из receiver:', e);
              }
            }
          }
        });
        
        // Проверяем senders
        const senders = pc.getSenders();
        senders.forEach(sender => {
          if (sender.track === track) {
            if (debug) {
              console.log('[DionJingles] ✅ Трек найден в sender:', track.id);
            }
            
            try {
              const stream = new MediaStream([track]);
              if (!this.microphoneStream || this.microphoneStream.id !== stream.id) {
                if (debug) {
                  console.log('[DionJingles] Настройка mixing для трека из sender:', stream.id);
                }
                this.setupWebRTCMixing(stream);
                
                if (this.mixingDestination) {
                  const mixedTrack = this.mixingDestination.stream.getAudioTracks()[0];
                  if (mixedTrack && track !== mixedTrack) {
                    if (debug) {
                      console.log('[DionJingles] Замена трека через sender:', track.id, '->', mixedTrack.id);
                    }
                    sender.replaceTrack(mixedTrack).catch(err => {
                      if (debug) {
                        console.warn('[DionJingles] Не удалось заменить трек:', err);
                      }
                    });
                  }
                }
              }
            } catch (e) {
              if (debug) {
                console.warn('[DionJingles] Ошибка обработки трека из sender:', e);
              }
            }
          }
        });
      } catch (e) {
        // Игнорируем ошибки
      }
    });
  }

  // Агрессивный поиск всех живых аудио треков в системе
  findAllLiveAudioTracks() {
    const debug = this.debug !== false;
    const foundTracks = [];
    
    // 1. Ищем через все RTCPeerConnection
    const allPCs = new Set();
    if (this.allPeerConnections) {
      this.allPeerConnections.forEach(pc => allPCs.add(pc));
    }
    if (window.__dionJinglesPCs) {
      window.__dionJinglesPCs.forEach(pc => allPCs.add(pc));
    }
    
    allPCs.forEach(pc => {
      try {
        const transceivers = pc.getTransceivers();
        transceivers.forEach(t => {
          if (t.sender && t.sender.track && t.sender.track.kind === 'audio' && t.sender.track.readyState === 'live') {
            const track = t.sender.track;
            if (!foundTracks.find(ft => ft.track === track)) {
              foundTracks.push({ source: 'rtc_transceiver', pc, transceiver: t, track });
              if (debug) {
                console.log('[DionJingles] 🔍 Найден живой аудио трек в transceiver:', track.id, 'label:', track.label);
              }
            }
          }
        });
        
        const senders = pc.getSenders();
        senders.forEach(s => {
          if (s.track && s.track.kind === 'audio' && s.track.readyState === 'live') {
            const track = s.track;
            if (!foundTracks.find(ft => ft.track === track)) {
              foundTracks.push({ source: 'rtc_sender', pc, sender: s, track });
              if (debug) {
                console.log('[DionJingles] 🔍 Найден живой аудио трек в sender:', track.id, 'label:', track.label);
              }
            }
          }
        });
      } catch (e) {
        // Игнорируем ошибки
      }
    });
    
    // 2. Пытаемся найти треки через MediaDevices (если доступно)
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      // Это не даст нам треки, но может помочь понять, какие устройства используются
    }
    
    // 3. Обрабатываем найденные треки
    foundTracks.forEach(({ source, track, pc, transceiver, sender }) => {
      try {
        if (debug) {
          console.log(`[DionJingles] Обработка трека из ${source}:`, track.id, track.label);
        }
        
        // Создаем поток из трека
        const stream = new MediaStream([track]);
        
        // Настраиваем mixing
        if (!this.microphoneStream || this.microphoneStream.id !== stream.id) {
          if (debug) {
            console.log('[DionJingles] Настройка mixing для найденного трека:', stream.id);
          }
          this.setupWebRTCMixing(stream);
          
          // Заменяем трек на смешанный
          if (this.mixingDestination) {
            const mixedTrack = this.mixingDestination.stream.getAudioTracks()[0];
            if (mixedTrack && track !== mixedTrack) {
              if (debug) {
                console.log('[DionJingles] Замена трека:', track.id, '->', mixedTrack.id);
              }
              
              // Пытаемся заменить через transceiver или sender
              if (transceiver && transceiver.sender) {
                transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                  if (debug) {
                    console.warn('[DionJingles] Не удалось заменить трек через transceiver:', err);
                  }
                });
              } else if (sender) {
                sender.replaceTrack(mixedTrack).catch(err => {
                  if (debug) {
                    console.warn('[DionJingles] Не удалось заменить трек через sender:', err);
                  }
                });
              }
            }
          }
        }
      } catch (e) {
        if (debug) {
          console.warn('[DionJingles] Ошибка обработки найденного трека:', e);
        }
      }
    });
    
    return foundTracks;
  }

  startPeriodicStreamCheck() {
    // Периодически проверяем все RTCPeerConnection на наличие аудио треков
    // КРИТИЧНО: Это должно найти потоки даже если они созданы до загрузки скрипта
    
    // Сначала выполняем агрессивный поиск
    this.findAllLiveAudioTracks();
    
    const checkInterval = setInterval(() => {
      // #region agent log
      var _t0 = Date.now();
      // #endregion
      const debug = this.debug !== false;
      
      // Периодически выполняем агрессивный поиск
      this.findAllLiveAudioTracks();
      
      // Собираем ВСЕ возможные RTCPeerConnection
      const allPCs = new Set();
      
      // Добавляем сохраненные
      if (this.allPeerConnections) {
        this.allPeerConnections.forEach(pc => allPCs.add(pc));
      }
      
      // Добавляем из раннего перехвата
      if (window.__dionJinglesPCs) {
        window.__dionJinglesPCs.forEach(pc => allPCs.add(pc));
      }
      
      // Ищем в глобальном контексте через Object.keys
      try {
        Object.keys(window).forEach(key => {
          try {
            const obj = window[key];
            if (obj && typeof obj.getTransceivers === 'function' && obj instanceof RTCPeerConnection) {
              allPCs.add(obj);
              if (!this.allPeerConnections.includes(obj)) {
                this.allPeerConnections.push(obj);
                if (debug) {
                  console.log('[DionJingles] ✅ Найден RTCPeerConnection в window.' + key);
                }
              }
            }
          } catch (e) {
            // Игнорируем ошибки
          }
        });
      } catch (e) {
        // Игнорируем ошибки
      }
      
      // Проверяем все найденные PC
      allPCs.forEach(pc => {
        try {
          // Проверяем через getTransceivers
          if (pc.getTransceivers) {
            const transceivers = pc.getTransceivers();
            transceivers.forEach(transceiver => {
              if (transceiver.sender && transceiver.sender.track) {
                const track = transceiver.sender.track;
                if (track.kind === 'audio' && track.readyState === 'live') {
                  if (debug && !this.microphoneStream) {
                    console.log('[DionJingles] Периодическая проверка: найден аудио трек в transceiver:', track.id);
                  }
                  try {
                    const stream = new MediaStream([track]);
                    if (!this.microphoneStream || this.microphoneStream.id !== stream.id) {
                      if (debug) {
                        console.log('[DionJingles] Настройка mixing для потока (периодическая проверка):', stream.id);
                      }
                      this.setupWebRTCMixing(stream);
                    }
                    
                    // Заменяем трек на смешанный
                    if (this.mixingDestination) {
                      const mixedTrack = this.mixingDestination.stream.getAudioTracks()[0];
                      if (mixedTrack && track !== mixedTrack) {
                        transceiver.sender.replaceTrack(mixedTrack).catch(err => {
                          if (debug) {
                            console.warn('[DionJingles] Не удалось заменить трек:', err);
                          }
                        });
                      }
                    }
                  } catch (e) {
                    if (debug) {
                      console.warn('[DionJingles] Ошибка при обработке transceiver:', e);
                    }
                  }
                }
              }
            });
          }
          
          // Также проверяем через getSenders
          if (pc.getSenders) {
            const senders = pc.getSenders();
            senders.forEach(sender => {
              if (sender.track && sender.track.kind === 'audio' && sender.track.readyState === 'live') {
                if (debug && !this.microphoneStream) {
                  console.log('[DionJingles] Периодическая проверка: найден аудио трек в sender:', sender.track.id);
                }
                try {
                  const stream = new MediaStream([sender.track]);
                  if (!this.microphoneStream || this.microphoneStream.id !== stream.id) {
                    if (debug) {
                      console.log('[DionJingles] Настройка mixing для потока из sender (периодическая проверка):', stream.id);
                    }
                    this.setupWebRTCMixing(stream);
                    
                    // Заменяем трек на смешанный
                    if (this.mixingDestination) {
                      const mixedTrack = this.mixingDestination.stream.getAudioTracks()[0];
                      if (mixedTrack && sender.track !== mixedTrack) {
                        sender.replaceTrack(mixedTrack).catch(err => {
                          if (debug) {
                            console.warn('[DionJingles] Не удалось заменить трек:', err);
                          }
                        });
                      }
                    }
                  }
                } catch (e) {
                  // Игнорируем ошибки
                }
              }
            });
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      });
      // #region agent log
      fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'14efdd'},body:JSON.stringify({sessionId:'14efdd',location:'content.js:startPeriodicStreamCheck',message:'periodic check done',data:{durationMs:Date.now()-_t0},timestamp:Date.now(),hypothesisId:'H2'})}).catch(function(){});
      // #endregion
    }, 200); // Проверяем каждые 200мс (очень агрессивно)
    
    // Останавливаем проверку через 120 секунд
    setTimeout(() => {
      clearInterval(checkInterval);
      if (this.debug) {
        console.log('[DionJingles] Периодическая проверка остановлена');
      }
    }, 120000);
  }

  toggleWebRTCInjection(enabled) {
    this.isWebRTCEnabled = enabled;
    
    if (enabled) {
      // Пытаемся найти существующие потоки
      this.findAndInterceptExistingStreams();
      
      if (this.microphoneStream) {
        this.setupWebRTCMixing(this.microphoneStream);
      }
    } else {
      // Отключаем mixing
      if (this.microphoneSource) {
        this.microphoneSource.disconnect();
        this.microphoneSource = null;
      }
    }
    
    console.log(`WebRTC injection: ${enabled ? 'включено' : 'выключено'}`);
  }

  findAndInterceptExistingStreams() {
    const debug = this.debug !== false;
    
    // Пытаемся найти существующие MediaStream в глобальном контексте
    // Многие WebRTC приложения хранят потоки в переменных
    const possibleStreamNames = ['localStream', 'localMediaStream', 'mediaStream', 'stream', 'audioStream', 
                                 'userMediaStream', 'micStream', 'audioMediaStream'];
    
    // Также проверяем вложенные объекты
    const possiblePaths = [
      'window.localStream',
      'window.localMediaStream', 
      'window.mediaStream',
      'window.stream',
      'window.audioStream',
      'window.webrtc',
      'window.rtc',
      'window.peerConnection',
      'window.pc'
    ];
    
    for (const name of possibleStreamNames) {
      if (window[name] && typeof window[name].getAudioTracks === 'function') {
        const stream = window[name];
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          if (debug) {
            console.log('[DionJingles] ✅ Найден существующий поток в window.' + name, stream.id);
          }
          this.setupWebRTCMixing(stream);
          return;
        }
      }
    }
    
    // Проверяем вложенные объекты
    for (const path of possiblePaths) {
      try {
        const obj = eval(path);
        if (obj && typeof obj.getAudioTracks === 'function') {
          const audioTracks = obj.getAudioTracks();
          if (audioTracks.length > 0) {
            if (debug) {
              console.log('[DionJingles] ✅ Найден поток в', path, obj.id);
            }
            this.setupWebRTCMixing(obj);
            return;
          }
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    }

    // Также проверяем через таймауты (на случай, если поток создается асинхронно)
    const checkIntervals = [100, 500, 1000, 2000, 5000];
    checkIntervals.forEach(delay => {
      setTimeout(() => {
        if (!this.microphoneStream && this.isWebRTCEnabled) {
          if (debug && delay > 100) {
            console.log('[DionJingles] Повторная проверка существующих потоков через', delay, 'мс');
          }
          
          // Проверяем все возможные места хранения потоков
          for (const name of possibleStreamNames) {
            if (window[name] && typeof window[name].getAudioTracks === 'function') {
              const stream = window[name];
              const audioTracks = stream.getAudioTracks();
              if (audioTracks.length > 0 && stream !== this.microphoneStream) {
                if (debug) {
                  console.log('[DionJingles] ✅ Найден поток в window.' + name, 'после задержки', stream.id);
                }
                this.setupWebRTCMixing(stream);
                return;
              }
            }
          }
        }
      }, delay);
    });
  }

  async playSound(soundType, injectToWebRTC = true) {
    if (this.debug) {
      console.log('[DionJingles] Воспроизведение звука:', soundType, 'injectToWebRTC:', injectToWebRTC);
    }
    
    this.ensureAudioContext();
    this.ensureMixingContext(); // Убеждаемся, что mixing context готов
    
    // Останавливаем предыдущий звук того же типа, если он играет
    if (this.currentSounds.has(soundType)) {
      const oldSound = this.currentSounds.get(soundType);
      oldSound.stop();
      this.currentSounds.delete(soundType);
      if (this.debug) {
        console.log('[DionJingles] Предыдущий звук остановлен');
      }
    }

    // НОВЫЙ ПОДХОД: Используем отдельный трек для звука (независимо от микрофона)
    // Это проще и надежнее, чем смешивание с микрофоном
    const shouldInject = injectToWebRTC && (this.jinglesDestination !== null || this.mixingDestination !== null);
    // #region agent log
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H2',location:'content.js:playSound',message:'playSound decision',data:{soundType:soundType,injectToWebRTC:injectToWebRTC,shouldInject:shouldInject,hasJinglesDestination:!!this.jinglesDestination,hasJinglesTrack:!!this.jinglesTrack,jinglesContextState:this.jinglesContext&&this.jinglesContext.state,mixingContextState:this.mixingContext&&this.mixingContext.state},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    
    if (this.debug) {
      console.log('[DionJingles] Состояние:', {
        shouldInject,
        hasJinglesDestination: !!this.jinglesDestination, // Новый подход
        hasMixingDestination: !!this.mixingDestination, // Старый подход (fallback)
        hasJinglesContext: !!this.jinglesContext,
        hasMixingContext: !!this.mixingContext,
        hasMicrophoneStream: !!this.microphoneStream
      });
    }

    try {
      // Пытаемся загрузить звуковой файл
      const soundUrl = chrome.runtime.getURL(`sounds/${soundType}.mp3`);
      const response = await fetch(soundUrl);
      
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        // Декодируем в правильном контексте
        // НОВЫЙ ПОДХОД: Используем jinglesContext для отдельного трека
        const context = shouldInject 
          ? (this.jinglesContext || this.mixingContext) 
          : this.audioContext;
        const audioBuffer = await context.decodeAudioData(arrayBuffer);
        await this.playAudioBuffer(audioBuffer, soundType, shouldInject);
      } else {
        // Если файл не найден, генерируем звук программно
        await this.generateSound(soundType, shouldInject);
      }
    } catch (error) {
      console.log('Файл звука не найден, генерируем программно:', error);
      await this.generateSound(soundType, shouldInject);
    }
  }

  async playAudioBuffer(audioBuffer, soundType, injectToWebRTC) {
    // Если есть микрофонный поток, приоритетно микшируем в основной аудио sender.
    // Некоторые SFU/конференции не пересылают второй отдельный audio sender.
    const useSeparateTrackMode = injectToWebRTC && this.jinglesDestination && this.jinglesTrack && !this.microphoneStream;
    // #region agent log
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId:'H15',location:'content.js:playAudioBuffer',message:'route decision',data:{soundType:soundType,useSeparateTrackMode:useSeparateTrackMode,hasMicrophoneStream:!!this.microphoneStream,hasJinglesTrack:!!this.jinglesTrack,hasMixingDestination:!!this.mixingDestination},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // НОВЫЙ ПОДХОД: Отправляем звук как отдельный трек (только если нет микрофонного потока)
    if (useSeparateTrackMode) {
      // #region agent log
      fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId:'H14',location:'content.js:playAudioBuffer',message:'using separate jingles track mode',data:{soundType:soundType,microphoneStreamId:this.microphoneStream&&this.microphoneStream.id,jinglesTrackId:this.jinglesTrack&&this.jinglesTrack.id},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (this.debug) {
        console.log('[DionJingles] Воспроизведение звука через отдельный трек (независимо от микрофона)');
      }
      
      // Убеждаемся, что jingles context активен
      if (this.jinglesContext.state === 'suspended') {
        await this.jinglesContext.resume();
      }
      
      // Создаем источник в jingles context
      const jinglesSource = this.jinglesContext.createBufferSource();
      jinglesSource.buffer = audioBuffer;
      jinglesSource.connect(this.jinglesDestination);
      
      jinglesSource.onended = () => {
        this.currentSounds.delete(soundType);
        if (this.debug) {
          console.log('[DionJingles] Звук завершен:', soundType);
        }
      };
      
      this.currentSounds.set(soundType, jinglesSource);
      jinglesSource.start(0);
      // #region agent log
      fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H3',location:'content.js:playAudioBuffer',message:'jingles source started',data:{soundType:soundType,jinglesTrackId:this.jinglesTrack&&this.jinglesTrack.id,jinglesTrackState:this.jinglesTrack&&this.jinglesTrack.readyState,jinglesPCsCount:this.jinglesPCs&&this.jinglesPCs.size},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      
      // Также воспроизводим локально для обратной связи
      const localSource = this.audioContext.createBufferSource();
      localSource.buffer = audioBuffer;
      localSource.connect(this.audioContext.destination);
      localSource.start(0);
      
      if (this.debug) {
        console.log('[DionJingles] ✅ Звук воспроизводится через отдельный трек (WebRTC + локально)');
      }
      
      return; // Используем новый подход, не продолжаем со старым
    }
    
    // СТАРЫЙ ПОДХОД: Смешивание с микрофоном (fallback)
    // Убеждаемся, что mixing context создан перед использованием
    if (injectToWebRTC) {
      this.ensureMixingContext();
      if (this.microphoneStream) {
        this.setupWebRTCMixing(this.microphoneStream);
      }
      // #region agent log
      fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId:'H15',location:'content.js:playAudioBuffer',message:'using mixed microphone sender mode',data:{soundType:soundType,microphoneStreamId:this.microphoneStream&&this.microphoneStream.id,mixingDestinationTrackId:this.mixingDestination&&this.mixingDestination.stream&&this.mixingDestination.stream.getAudioTracks()[0]&&this.mixingDestination.stream.getAudioTracks()[0].id},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
    
    // Приоритет: встраивание в WebRTC поток (чтобы другие участники слышали)
    if (injectToWebRTC && this.mixingDestination) {
      if (this.debug) {
        console.log('[DionJingles] Встраивание звука в WebRTC поток (старый подход - смешивание)');
      }
      
      // Создаем источник в mixing context для встраивания в WebRTC
      const mixingSource = this.mixingContext.createBufferSource();
      mixingSource.buffer = audioBuffer;
      mixingSource.connect(this.mixingDestination);
      
      mixingSource.onended = () => {
        this.currentSounds.delete(soundType);
        if (this.debug) {
          console.log('[DionJingles] Звук завершен:', soundType);
        }
      };
      
      this.currentSounds.set(soundType, mixingSource);
      mixingSource.start(0);
      
      // Также воспроизводим локально для обратной связи
      const localSource = this.audioContext.createBufferSource();
      localSource.buffer = audioBuffer;
      localSource.connect(this.audioContext.destination);
      localSource.start(0);
      
      if (this.debug) {
        console.log('[DionJingles] ✅ Звук воспроизводится (WebRTC + локально)');
      }
    } else {
      // Если mixing context не готов, воспроизводим только локально
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      source.onended = () => {
        this.currentSounds.delete(soundType);
      };
      
      this.currentSounds.set(soundType, source);
      source.start(0);
      
      if (this.debug) {
        console.log('[DionJingles] ⚠️ Звук воспроизводится только локально (mixing не готов)');
      }
    }
  }

  async generateSound(soundType, injectToWebRTC) {
    // НОВЫЙ ПОДХОД: Используем jinglesContext для отдельного трека
    // Старый подход: используем mixingContext для смешивания с микрофоном
    const context = injectToWebRTC 
      ? (this.jinglesContext || this.mixingContext || this.audioContext)
      : this.audioContext;
    
    const duration = 0.5; // секунды
    const sampleRate = context.sampleRate;
    const frameCount = sampleRate * duration;
    const buffer = context.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    switch (soundType) {
      case 'applause':
        // Генерируем аплодисменты (белый шум с затуханием)
        for (let i = 0; i < frameCount; i++) {
          const t = i / sampleRate;
          const decay = Math.exp(-t * 2);
          data[i] = (Math.random() * 2 - 1) * decay * 0.3;
        }
        break;
      
      case 'error':
        // Генерируем звук ошибки (низкий тон с вибрацией)
        for (let i = 0; i < frameCount; i++) {
          const t = i / sampleRate;
          const freq = 200 + Math.sin(t * 20) * 50;
          const decay = Math.exp(-t * 3);
          data[i] = Math.sin(2 * Math.PI * freq * t) * decay * 0.4;
        }
        break;
      
      case 'success':
        // Генерируем звук успеха (восходящая мелодия)
        for (let i = 0; i < frameCount; i++) {
          const t = i / sampleRate;
          const freq = 400 + t * 200;
          const decay = Math.exp(-t * 2);
          data[i] = Math.sin(2 * Math.PI * freq * t) * decay * 0.3;
        }
        break;
      
      case 'notification':
        // Генерируем звук уведомления (короткий бип)
        for (let i = 0; i < frameCount; i++) {
          const t = i / sampleRate;
          const freq = 800;
          const decay = Math.exp(-t * 5);
          data[i] = Math.sin(2 * Math.PI * freq * t) * decay * 0.3;
        }
        break;
      
      default:
        // Простой бип
        for (let i = 0; i < frameCount; i++) {
          const t = i / sampleRate;
          const freq = 440;
          const decay = Math.exp(-t * 3);
          data[i] = Math.sin(2 * Math.PI * freq * t) * decay * 0.3;
        }
    }

    await this.playAudioBuffer(buffer, soundType, injectToWebRTC);
  }
}

// Ранний инлайн-скрипт в контекст страницы — выполняется до скриптов dion.vc (перехват RTCPeerConnection + jingles)
function injectEarlyPageScript() {
  const code = "(function(){if(window.__dionJinglesPagePCWrapped)return;var jCtx=null,jDest=null,jTrack=null;try{var AC=window.AudioContext||window.webkitAudioContext;if(AC){jCtx=new AC();jDest=jCtx.createMediaStreamDestination();var tr=jDest.stream.getAudioTracks();if(tr.length>0)jTrack=tr[0];}}catch(e){}var Orig=window.RTCPeerConnection;if(Orig){window.RTCPeerConnection=function(){var pc=new Orig.apply(this,arguments);if(jTrack)try{pc.addTrack(jTrack);}catch(e){}if(!window.__dionJinglesPCs)window.__dionJinglesPCs=[];window.__dionJinglesPCs.push(pc);return pc;};window.RTCPeerConnection.prototype=Orig.prototype;window.__dionJinglesPagePCWrapped=true;}function genPlay(st){if(!jCtx||!jDest)return;if(jCtx.state==='suspended')jCtx.resume().catch(function(){});var dur=0.5,sr=jCtx.sampleRate,n=sr*dur,buf=jCtx.createBuffer(1,n,sr),d=buf.getChannelData(0),i,t,dec,fr;if(st==='applause'){for(i=0;i<n;i++){t=i/sr;dec=Math.exp(-t*2);d[i]=(Math.random()*2-1)*dec*0.3;}}else if(st==='error'){for(i=0;i<n;i++){t=i/sr;fr=200+Math.sin(t*20)*50;dec=Math.exp(-t*3);d[i]=Math.sin(2*Math.PI*fr*t)*dec*0.4;}}else if(st==='success'){for(i=0;i<n;i++){t=i/sr;fr=400+t*200;dec=Math.exp(-t*2);d[i]=Math.sin(2*Math.PI*fr*t)*dec*0.3;}}else if(st==='notification'){for(i=0;i<n;i++){t=i/sr;dec=Math.exp(-t*5);d[i]=Math.sin(2*Math.PI*800*t)*dec*0.3;}}else{for(i=0;i<n;i++){t=i/sr;dec=Math.exp(-t*3);d[i]=Math.sin(2*Math.PI*440*t)*dec*0.3;}}var src=jCtx.createBufferSource();src.buffer=buf;src.connect(jDest);src.start(0);}document.addEventListener('__dionJinglesPlayWithUrl',function(ev){var det=ev.detail,url=det&&(det.soundDataUrl||det.soundUrl);if(!url||!jCtx||!jDest)return;if(jCtx.state==='suspended')jCtx.resume().catch(function(){});fetch(url).then(function(r){return r.arrayBuffer();}).then(function(b){return jCtx.decodeAudioData(b);}).then(function(buf){var s=jCtx.createBufferSource();s.buffer=buf;s.connect(jDest);s.start(0);}).catch(function(){});});document.addEventListener('__dionJinglesPlayGenerated',function(ev){if(ev.detail&&ev.detail.soundType)genPlay(ev.detail.soundType);});})();";
  const script = document.createElement('script');
  script.textContent = code;
  (document.documentElement || document.head).appendChild(script);
  script.remove();
}

// Инжектируем скрипт в контекст страницы для доступа из консоли
function injectScript() {
  injectEarlyPageScript();
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// Инжектируем скрипт сразу
injectScript();

// Также инжектируем при загрузке DOM (на случай, если head еще не готов)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectScript);
}

// Функция для добавления трека во все сохраненные PC
function addTrackToPendingPCs() {
  const pendingPCs = window.__dionJinglesPendingPCs || [];
  // #region agent log
  fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H1',location:'content.js:addTrackToPendingPCs',message:'process pending PCs',data:{pendingPCsCount:pendingPCs.length,hasPlayer:!!window.dionJinglesPlayer,hasJinglesTrack:!!(window.dionJinglesPlayer&&window.dionJinglesPlayer.jinglesTrack)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  console.log('[DionJingles] 🔍 addTrackToPendingPCs вызвана:', {
    hasPlayer: !!window.dionJinglesPlayer,
    hasJinglesTrack: !!(window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack),
    pendingPCsCount: pendingPCs.length
  });
  
  if (window.dionJinglesPlayer && window.dionJinglesPlayer.jinglesTrack && pendingPCs.length > 0) {
    console.log('[DionJingles] ✅ Добавляем трек в', pendingPCs.length, 'сохраненных RTCPeerConnection');
    pendingPCs.forEach((pc, index) => {
      console.log(`[DionJingles] Обработка PC ${index + 1}/${pendingPCs.length}`);
      try {
        const senders = pc.getSenders();
        const hasJinglesTrack = Array.from(senders).some(s => s.track === window.dionJinglesPlayer.jinglesTrack);
        if (!hasJinglesTrack) {
          pc.addTrack(window.dionJinglesPlayer.jinglesTrack);
          window.dionJinglesPlayer.jinglesPCs.add(pc);
          console.log('[DionJingles] ✅ Трек добавлен в сохраненный RTCPeerConnection');
        }
      } catch (e) {
        console.warn('[DionJingles] Не удалось добавить трек в сохраненный PC:', e);
      }
    });
    window.__dionJinglesPendingPCs.length = 0; // Очищаем массив
  }
}

// Инициализируем плеер при загрузке страницы
(function initDionJingles() {
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        window.dionJinglesPlayer = new DionJinglesPlayer();
        console.log('[DionJingles] ✅ Расширение инициализировано (DOMContentLoaded)');
        // Добавляем трек во все сохраненные PC
        setTimeout(() => {
          addTrackToPendingPCs();
          notifyInjectedScript();
        }, 100);
      });
    } else {
      window.dionJinglesPlayer = new DionJinglesPlayer();
      console.log('[DionJingles] ✅ Расширение инициализировано (DOM ready)');
      // Добавляем трек во все сохраненные PC
      setTimeout(() => {
        addTrackToPendingPCs();
        notifyInjectedScript();
      }, 100);
    }
  } catch (error) {
    console.error('[DionJingles] ❌ Ошибка инициализации:', error);
  }
})();

// Слушаем команды от injection script
document.addEventListener('__dionJinglesCommand', function(event) {
  if (event.detail && event.detail.command === 'playSound' && window.dionJinglesPlayer) {
    const args = event.detail.args || [];
    const soundType = args[0];
    // #region agent log
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'pre-fix',hypothesisId:'H5',location:'content.js:__dionJinglesCommand',message:'play command received',data:{command:event.detail.command,soundType:soundType,hasPlayer:!!window.dionJinglesPlayer},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const debug = window.dionJinglesPlayer.debug !== false;
    if (debug) {
      console.log('[DionJingles] Получена команда playSound:', soundType);
    }
    window.dionJinglesPlayer.playSound(soundType);
    window.dionJinglesPlayer.dispatchSoundToPageContext(soundType);
  }
});

// Слушаем запросы свойств от injection script
document.addEventListener('__dionJinglesGetProperty', function(event) {
  if (event.detail && window.dionJinglesPlayer) {
    const prop = event.detail.property;
    const requestId = event.detail.requestId;
    const debug = window.dionJinglesPlayer.debug !== false;
    
    if (debug) {
      console.log('[DionJingles] Запрос свойства:', prop, 'requestId:', requestId);
    }
    
    let value = window.dionJinglesPlayer[prop];
    
    if (debug) {
      console.log('[DionJingles] Значение свойства', prop, 'до обработки:', value, typeof value);
    }
    
    // Специальная обработка для Map и других несериализуемых объектов
    if (prop === 'currentSounds' && value instanceof Map) {
      value = Array.from(value.keys());
    } else if (value && typeof value === 'object') {
      // Для объектов пытаемся получить простые свойства
      if (value.state !== undefined) {
        value = { state: value.state, type: value.constructor.name };
      } else if (value !== null) {
        // Для других объектов возвращаем true, чтобы показать, что они существуют
        value = true;
      } else {
        value = null;
      }
    } else if (value === null || value === undefined) {
      // Явно передаем null/undefined
      value = null;
    }
    // Для примитивных типов (boolean, number, string) передаем как есть
    
    if (debug) {
      console.log('[DionJingles] Значение свойства', prop, 'после обработки:', value);
    }
    
    if (debug) {
      console.log('[DionJingles] Отправка значения свойства:', prop, '=', value, 'requestId:', requestId);
    }
    
    // Используем setTimeout для гарантии, что событие будет обработано
    setTimeout(() => {
      const resultEvent = new CustomEvent('__dionJinglesPropertyResult', {
        detail: { requestId: requestId, value: value }
      });
      document.dispatchEvent(resultEvent);
      if (debug) {
        console.log('[DionJingles] Событие отправлено:', resultEvent.detail);
      }
    }, 0);
  } else {
    console.warn('[DionJingles] Запрос свойства, но player не найден');
  }
});

// Создаем скрытый элемент для коммуникации между контекстами
function createBridgeElement() {
  let bridge = document.getElementById('__dionJinglesBridge');
  if (!bridge) {
    bridge = document.createElement('div');
    bridge.id = '__dionJinglesBridge';
    bridge.style.display = 'none';
    document.documentElement.appendChild(bridge);
  }
  return bridge;
}

// Уведомляем injection script о наличии player через bridge элемент
function notifyInjectedScript() {
  const bridge = createBridgeElement();
  // Помечаем, что player готов (объект нельзя передать напрямую, но можно использовать события)
  bridge.setAttribute('data-player-ready', 'true');
  bridge.setAttribute('data-timestamp', Date.now().toString());
  
  // Также отправляем событие через document (может сработать)
  const event = new CustomEvent('__dionJinglesPlayerUpdate', {
    detail: { ready: true, timestamp: Date.now() }
  });
  document.dispatchEvent(event);
  
  const debug = window.dionJinglesPlayer && window.dionJinglesPlayer.debug !== false;
  if (debug) {
    console.log('[DionJingles] Player готов, уведомление отправлено');
  }
}

// Слушаем запросы от injection script
document.addEventListener('__dionJinglesGetPlayer', function(event) {
  const bridge = createBridgeElement();
  bridge.setAttribute('data-player-ready', 'true');
  bridge.setAttribute('data-timestamp', Date.now().toString());
  
  // Отправляем событие обратно
  const updateEvent = new CustomEvent('__dionJinglesPlayerUpdate', {
    detail: { ready: true, timestamp: Date.now() }
  });
  document.dispatchEvent(updateEvent);
});

// Слушаем запросы анализа от injection script
document.addEventListener('__dionJinglesAnalyze', function(event) {
  if (window.dionJinglesPlayer) {
    const debug = window.dionJinglesPlayer.debug !== false;
    if (debug) {
      console.log('[DionJingles] Запрос анализа получен');
    }
    
    // Выполняем анализ
    if (window.analyzeDionVC) {
      // Функция уже определена в content script, но она недоступна из inject.js
      // Поэтому выполняем анализ здесь
      const pcs = window.__dionJinglesPCs || [];
      console.log('[DionJingles] Найдено RTCPeerConnection (ранний перехват):', pcs.length);
      
      pcs.forEach((pc, index) => {
        console.log(`\nRTCPeerConnection ${index} (ранний перехват):`);
        try {
          const transceivers = pc.getTransceivers();
          console.log('  Transceivers:', transceivers.length);
          transceivers.forEach((t, i) => {
            if (t.sender && t.sender.track) {
              console.log(`    Transceiver ${i}:`, {
                kind: t.sender.track.kind,
                id: t.sender.track.id,
                readyState: t.sender.track.readyState,
                direction: t.direction
              });
            }
          });
        } catch (e) {
          console.warn('  Ошибка:', e);
        }
      });
      
      // Также проверяем все PC из нашего списка
      if (window.dionJinglesPlayer.allPeerConnections) {
        console.log('\n[DionJingles] Найдено RTCPeerConnection (основной список):', window.dionJinglesPlayer.allPeerConnections.length);
      }
    }
  }
});

// Логируем успешную инициализацию
console.log('[DionJingles] Content script загружен');

