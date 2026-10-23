// Popup script для управления звуками

document.addEventListener('DOMContentLoaded', () => {
  const emitDebug = (hypothesisId, location, message, data) => {
    // #region agent log
    fetch('http://127.0.0.1:7251/ingest/5df934a0-d656-4f8e-8cf9-eee01a9d00c5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8ca4bb'},body:JSON.stringify({sessionId:'8ca4bb',runId:'post-fix',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  };
  const buttons = document.querySelectorAll('.sound-button');
  const status = document.getElementById('status');
  const webrtcToggle = document.getElementById('webrtcToggle');
  const webrtcSwitch = document.getElementById('webrtcSwitch');
  const webrtcInfo = document.getElementById('webrtcInfo');

  let webrtcEnabled = true; // По умолчанию включено

  // Проверяем, открыта ли вкладка с dion.vc
  checkActiveTab();
  loadWebRTCState();

  // Переключатель WebRTC
  webrtcToggle.addEventListener('click', async () => {
    webrtcEnabled = !webrtcEnabled;
    await toggleWebRTC(webrtcEnabled);
    updateWebRTCDisplay();
    saveWebRTCState();
  });

  buttons.forEach(button => {
    button.addEventListener('click', async () => {
      const soundType = button.dataset.sound;
      await playSound(soundType);
      
      // Визуальная обратная связь
      button.style.transform = 'scale(0.95)';
      setTimeout(() => {
        button.style.transform = '';
      }, 100);
    });
  });

  async function loadWebRTCState() {
    try {
      const result = await chrome.storage.local.get(['webrtcEnabled']);
      // По умолчанию включено, если не сохранено иное значение
      webrtcEnabled = result.webrtcEnabled !== undefined ? result.webrtcEnabled : true;
      
      // Устанавливаем состояние в content script перед обновлением UI
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('dion.vc')) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'toggleWebRTC',
            enabled: webrtcEnabled
          });
        } catch (e) {
          // Content script может быть еще не загружен
          console.log('Content script еще не готов');
        }
      }
      
      updateWebRTCDisplay();
    } catch (error) {
      console.error('Ошибка загрузки состояния WebRTC:', error);
      // В случае ошибки используем значение по умолчанию
      webrtcEnabled = true;
      updateWebRTCDisplay();
    }
  }

  function saveWebRTCState() {
    chrome.storage.local.set({ webrtcEnabled: webrtcEnabled });
  }

  function updateWebRTCDisplay() {
    if (webrtcEnabled) {
      webrtcSwitch.classList.add('active');
      webrtcInfo.textContent = '✅ Звуки встраиваются в аудио поток';
    } else {
      webrtcSwitch.classList.remove('active');
      webrtcInfo.textContent = '⚠️ Звуки только локально (не слышны другим)';
    }
  }

  async function toggleWebRTC(enabled) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('dion.vc')) {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'toggleWebRTC',
          enabled: enabled
        });
      }
    } catch (error) {
      console.error('Ошибка переключения WebRTC:', error);
    }
  }

  async function checkActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (tab.url && (tab.url.includes('dion.vc'))) {
        status.textContent = 'Готов к использованию';
        status.classList.add('active');
      } else {
        status.textContent = 'Откройте dion.vc для использования';
        status.classList.remove('active');
      }
    } catch (error) {
      console.error('Ошибка проверки вкладки:', error);
    }
  }

  async function playSound(soundType) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      emitDebug('H17','popup.js:playSound','tab query result',{soundType,tabId:tab&&tab.id,url:tab&&tab.url});
      
      if (tab.url && tab.url.includes('dion.vc')) {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'playSound',
          soundType: soundType
        });
        emitDebug('H17','popup.js:playSound','sendMessage success',{soundType,tabId:tab.id});
        
        status.textContent = `Воспроизводится: ${getSoundName(soundType)}`;
        setTimeout(() => {
          status.textContent = 'Готов к использованию';
        }, 1000);
      } else {
        emitDebug('H17','popup.js:playSound','tab not dion',{soundType,url:tab&&tab.url});
        status.textContent = 'Откройте dion.vc для использования';
        status.classList.remove('active');
      }
    } catch (error) {
      emitDebug('H17','popup.js:playSound','sendMessage error',{soundType,error:String(error)});
      console.error('Ошибка воспроизведения звука:', error);
      status.textContent = 'Ошибка: откройте dion.vc';
    }
  }

  function getSoundName(soundType) {
    const names = {
      'applause': 'Аплодисменты',
      'success': 'Успех',
      'error': 'Ошибка',
      'notification': 'Уведомление'
    };
    return names[soundType] || soundType;
  }
});

