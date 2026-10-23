# Руководство по отладке Dion Jingles

## 🚀 Быстрая отладка - Шпаргалка

### ⚠️ Важно: Всегда проверяйте наличие расширения!

#### Безопасный способ проверки (РЕКОМЕНДУЕТСЯ):

```javascript
// Используйте window.dionJingles API (работает из консоли страницы)
// Все методы асинхронные, так как используют коммуникацию между контекстами

// Способ 1: Проверка загрузки
await window.dionJingles.check()

// Способ 2: Получить player
const player = await window.dionJingles.getPlayer();
if (player) {
  // Ваш код здесь
  console.log('WebRTC:', player.isWebRTCEnabled);
}

// Способ 3: Прямая ссылка (может быть null, если еще не загружено)
if (window.dionJinglesPlayer) {
  const player = window.dionJinglesPlayer;
  // Ваш код здесь
}
```

**Важно:** Content scripts работают в изолированном контексте, поэтому для доступа из консоли страницы используется injection script через `window.dionJingles`.

#### Частые команды для отладки:

**1. Проверка загрузки расширения:**
```javascript
// Используйте window.dionJingles API (работает из консоли)
const isLoaded = await window.dionJingles.check();
if (isLoaded) {
  const player = await window.dionJingles.getPlayer();
  console.log('✅ Расширение загружено');
  console.log('WebRTC:', player.isWebRTCEnabled);
  console.log('Mixing Context:', !!player.mixingContext);
  console.log('Mixing Destination:', !!player.mixingDestination);
} else {
  console.error('❌ Расширение не загружено');
}

// Или используйте прямую ссылку (если доступна)
if (window.dionJinglesPlayer) {
  const player = window.dionJinglesPlayer;
  console.log('✅ Расширение загружено');
}
```

**2. Проверка mixing контекста (БЕЗОПАСНАЯ ВЕРСИЯ):**
```javascript
// Рекомендуемый способ
if (typeof window.dionJinglesPlayer !== 'undefined') {
  const player = window.dionJinglesPlayer;
  
  if (player.mixingContext) {
    console.log('✅ Mixing context:', {
      state: player.mixingContext.state,
      sampleRate: player.mixingContext.sampleRate
    });
  } else {
    console.warn('⚠️ Mixing context не создан');
  }
  
  if (player.mixingDestination) {
    const mixedStream = player.mixingDestination.stream;
    console.log('✅ Mixed stream:', {
      streamId: mixedStream.id,
      tracks: mixedStream.getAudioTracks().length
    });
  } else {
    console.warn('⚠️ Mixing destination не создан');
  }
} else {
  console.error('❌ Расширение не загружено');
}
```

**3. Проверка микрофонного потока:**
```javascript
if (typeof window.dionJinglesPlayer !== 'undefined') {
  const player = window.dionJinglesPlayer;
  
  if (player.microphoneStream) {
    console.log('✅ Microphone stream:', {
      id: player.microphoneStream.id,
      tracks: player.microphoneStream.getAudioTracks().length,
      enabled: player.microphoneStream.getAudioTracks()[0]?.enabled
    });
  } else {
    console.warn('⚠️ Microphone stream не подключен');
  }
} else {
  console.error('❌ Расширение не загружено');
}
```

**4. Тест воспроизведения звука:**
```javascript
if (typeof window.dionJinglesPlayer !== 'undefined') {
  const player = window.dionJinglesPlayer;
  
  // Воспроизвести звук
  player.playSound('applause');
  
  // Проверить активные звуки
  console.log('Active sounds:', Array.from(player.currentSounds.keys()));
} else {
  console.error('❌ Расширение не загружено');
}
```

**5. Полная диагностика (одна команда):**
```javascript
// Копируйте и вставьте в консоль (асинхронная версия)
(async function() {
  await window.dionJingles.diagnose();
})();

// Или синхронная версия (если player уже загружен)
(function() {
  if (!window.dionJinglesPlayer) {
    console.error('❌ Расширение не загружено');
    console.warn('Попробуйте: await window.dionJingles.diagnose()');
    return;
  }
  
  const p = window.dionJinglesPlayer;
  console.log('=== ДИАГНОСТИКА ===');
  console.log('WebRTC:', p.isWebRTCEnabled ? '✅' : '❌');
  console.log('AudioContext:', p.audioContext ? `✅ ${p.audioContext.state}` : '❌');
  console.log('MixingContext:', p.mixingContext ? `✅ ${p.mixingContext.state}` : '❌');
  console.log('MixingDestination:', p.mixingDestination ? '✅' : '❌');
  console.log('MicrophoneStream:', p.microphoneStream ? '✅' : '❌');
  console.log('MicrophoneSource:', p.microphoneSource ? '✅' : '❌');
  console.log('Active sounds:', Array.from(p.currentSounds.keys()));
})();
```

**6. Быстрая проверка всех компонентов:**
```javascript
// Вставьте в консоль на странице dion.vc
setTimeout(() => {
  if (typeof window.dionJinglesPlayer !== 'undefined') {
    const p = window.dionJinglesPlayer;
    const checks = {
      'Расширение загружено': true,
      'WebRTC включен': p.isWebRTCEnabled,
      'AudioContext': !!p.audioContext,
      'MixingContext': !!p.mixingContext,
      'MixingDestination': !!p.mixingDestination,
      'MicrophoneStream': !!p.microphoneStream,
      'MicrophoneSource': !!p.microphoneSource
    };
    
    console.table(checks);
  } else {
    console.error('❌ Расширение не загружено');
  }
}, 2000);
```

#### Что делать, если расширение не загружено?

1. **Проверьте URL** - вы должны быть на `https://dion.vc/*`
2. **Проверьте расширение** - откройте `chrome://extensions/` и убедитесь, что оно включено
3. **Перезагрузите страницу** - нажмите F5
4. **Подождите** - content script загружается с задержкой
5. **Проверьте консоль** - могут быть ошибки загрузки

---

## Быстрый старт

### 1. Установка расширения для разработки

1. Откройте `chrome://extensions/` (или `edge://extensions/`)
2. Включите **"Режим разработчика"** (Developer mode)
3. Нажмите **"Загрузить распакованное расширение"** (Load unpacked)
4. Выберите папку проекта `dion-jingles`

### 2. Перезагрузка расширения после изменений

После изменения кода:
- Нажмите кнопку **"Обновить"** (↻) на карточке расширения
- Или перезагрузите страницу dion.vc (F5)

## Отладка компонентов

### Content Script (content.js)

**Content script** выполняется на странице dion.vc и отвечает за встраивание звуков в WebRTC поток.

#### Как открыть DevTools для content script:

1. Откройте страницу **dion.vc** в браузере
2. Нажмите **F12** или **Правой кнопкой → Inspect**
3. В DevTools перейдите на вкладку **Console**
4. Логи из `content.js` будут видны здесь

#### Полезные команды в консоли:

```javascript
// ⚠️ ВАЖНО: Сначала проверьте, загружен ли content script!
// Безопасная проверка:
if (typeof window.dionJinglesPlayer !== 'undefined') {
  const player = window.dionJinglesPlayer;
  
  // Проверить состояние WebRTC
  player.isWebRTCEnabled
  
  // Проверить mixing context
  player.mixingContext
  player.mixingDestination
  
  // Проверить микрофонный поток
  player.microphoneStream
  
  // Вручную воспроизвести звук
  player.playSound('applause')
  
  // Проверить активные звуки
  player.currentSounds
} else {
  console.error('Расширение не загружено! Используйте window.checkDionJingles() для диагностики');
}

// Или используйте встроенную функцию проверки:
window.checkDionJingles() // вернет true/false и выведет подсказки
```

#### Если получаете ошибку "Cannot read properties of undefined":

**Причина:** Content script еще не загрузился или расширение не активно.

**Решение:**
1. Убедитесь, что вы на странице `https://dion.vc/*`
2. Проверьте, что расширение установлено и включено в `chrome://extensions/`
3. Перезагрузите страницу (F5)
4. Подождите 1-2 секунды после загрузки страницы
5. Используйте безопасную проверку:
   ```javascript
   // Безопасный способ:
   const player = window.dionJinglesPlayer;
   if (player) {
     // ваш код
   } else {
     console.error('Расширение не загружено');
   }
   
   // Или используйте функцию-хелпер:
   if (window.checkDionJingles()) {
     const player = window.dionJinglesPlayer;
     // ваш код
   }
   ```

#### Отладка перехвата getUserMedia:

```javascript
// Проверить, перехвачен ли getUserMedia
navigator.mediaDevices.getUserMedia.toString()

// Проверить оригинальный метод
window.dionJinglesPlayer.originalGetUserMedia
```

### Popup (popup.html/popup.js)

**Popup** - это интерфейс, который открывается при клике на иконку расширения.

#### Как открыть DevTools для popup:

1. **Способ 1**: Правой кнопкой на иконке расширения → **"Проверить всплывающее окно"** (Inspect popup)
2. **Способ 2**: 
   - Откройте `chrome://extensions/`
   - Найдите расширение Dion Jingles
   - Нажмите **"service worker"** или **"Проверить представления: popup.html"**

#### Отладка popup:

```javascript
// В консоли popup можно проверить:
chrome.storage.local.get(['webrtcEnabled'], console.log)

// Проверить активную вкладку
chrome.tabs.query({active: true, currentWindow: true}, console.log)
```

### Background Script (background.js)

**Background script** (service worker) работает в фоне.

#### Как открыть DevTools для background:

1. Откройте `chrome://extensions/`
2. Найдите расширение Dion Jingles
3. Нажмите **"service worker"** или **"Проверить представления: background.js"**

## Проверка работы WebRTC

### 1. Проверка перехвата getUserMedia

Откройте консоль на странице dion.vc и выполните:

```javascript
// Попробуйте получить доступ к микрофону
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('Поток получен:', stream);
    console.log('Аудио треки:', stream.getAudioTracks());
    
    // Проверьте, является ли это смешанным потоком
    const track = stream.getAudioTracks()[0];
    console.log('Трек:', track);
    console.log('ID трека:', track.id);
    
    // Остановите поток
    stream.getTracks().forEach(t => t.stop());
  })
  .catch(err => console.error('Ошибка:', err));
```

### 2. Проверка mixing контекста

```javascript
// ⚠️ ВАЖНО: Сначала проверьте наличие player!
if (typeof window.dionJinglesPlayer === 'undefined') {
  console.error('Расширение не загружено! Используйте window.checkDionJingles()');
} else {
  const player = window.dionJinglesPlayer;
  
  // Проверить mixing context
  if (player.mixingContext) {
    console.log('Mixing context:', player.mixingContext);
    console.log('State:', player.mixingContext.state);
    console.log('Sample rate:', player.mixingContext.sampleRate);
  } else {
    console.warn('Mixing context не создан. Возможно, микрофон еще не активирован.');
  }
  
  // Проверить mixing destination
  if (player.mixingDestination) {
    console.log('Mixing destination:', player.mixingDestination);
    const mixedStream = player.mixingDestination.stream;
    console.log('Mixed stream:', mixedStream);
    console.log('Audio tracks:', mixedStream.getAudioTracks());
  } else {
    console.warn('Mixing destination не создан.');
  }
}
```

**Безопасная версия с проверками:**

```javascript
// Используйте функцию-хелпер
if (window.checkDionJingles && window.checkDionJingles()) {
  const player = window.dionJinglesPlayer;
  
  // Проверить mixing context
  if (player.mixingContext) {
    console.log('✅ Mixing context:', {
      state: player.mixingContext.state,
      sampleRate: player.mixingContext.sampleRate
    });
  } else {
    console.warn('⚠️ Mixing context не создан');
  }
  
  // Проверить mixing destination
  if (player.mixingDestination) {
    const mixedStream = player.mixingDestination.stream;
    console.log('✅ Mixing destination:', {
      streamId: mixedStream.id,
      audioTracks: mixedStream.getAudioTracks().length
    });
  } else {
    console.warn('⚠️ Mixing destination не создан');
  }
}
```

### 3. Проверка микрофонного потока

```javascript
// Безопасная проверка
if (typeof window.dionJinglesPlayer !== 'undefined') {
  const player = window.dionJinglesPlayer;
  
  if (player.microphoneStream) {
    console.log('✅ Microphone stream:', player.microphoneStream);
    console.log('Audio tracks:', player.microphoneStream.getAudioTracks());
    console.log('Track enabled:', player.microphoneStream.getAudioTracks()[0]?.enabled);
  } else {
    console.warn('⚠️ Microphone stream не подключен. Включите микрофон в конференции.');
  }
} else {
  console.error('❌ Расширение не загружено');
}
```

### 4. Тестирование воспроизведения звука

```javascript
// Безопасное воспроизведение звука
if (window.checkDionJingles && window.checkDionJingles()) {
  const player = window.dionJinglesPlayer;
  
  // Воспроизвести звук программно
  player.playSound('applause');
  
  // Проверить активные звуки
  console.log('Active sounds:', Array.from(player.currentSounds.keys()));
  
  // Остановить все звуки
  player.currentSounds.forEach((source, type) => {
    source.stop();
  });
  player.currentSounds.clear();
} else {
  console.error('Не удалось воспроизвести звук: расширение не загружено');
}
```

## Отладка проблем

### Проблема: Звуки не слышны другим участникам

**Проверьте:**

1. **WebRTC включен?**
   ```javascript
   window.dionJinglesPlayer.isWebRTCEnabled // должно быть true
   ```

2. **Mixing context создан?**
   ```javascript
   window.dionJinglesPlayer.mixingContext // не должен быть null
   window.dionJinglesPlayer.mixingDestination // не должен быть null
   ```

3. **Микрофонный поток подключен?**
   ```javascript
   window.dionJinglesPlayer.microphoneStream // не должен быть null
   window.dionJinglesPlayer.microphoneSource // не должен быть null
   ```

4. **Проверьте консоль на ошибки:**
   - Откройте DevTools (F12)
   - Проверьте вкладку Console на наличие ошибок

### Проблема: getUserMedia не перехватывается

**Возможные причины:**

1. Content script загрузился после того, как приложение уже получило доступ к микрофону
2. Приложение использует другой способ получения доступа к микрофону

**Решение:**

```javascript
// Проверить, перехвачен ли getUserMedia
console.log('getUserMedia:', navigator.mediaDevices.getUserMedia.toString());

// Если нужно, перехватить вручную
// (но это должно работать автоматически)
```

### Проблема: Звуки не воспроизводятся

**Проверьте:**

1. **AudioContext создан?**
   ```javascript
   window.dionJinglesPlayer.audioContext // не должен быть null
   window.dionJinglesPlayer.audioContext.state // должно быть 'running'
   ```

2. **Проверьте ошибки в консоли**

3. **Попробуйте воспроизвести звук вручную:**
   ```javascript
   window.dionJinglesPlayer.playSound('applause');
   ```

### Проблема: RTCPeerConnection не перехватывается

**Проверьте:**

```javascript
// Проверить, перехвачен ли RTCPeerConnection
console.log('RTCPeerConnection:', window.RTCPeerConnection.toString());

// Проверить существующие соединения (если доступно)
// Это зависит от реализации приложения
```

## Логирование

### Добавление дополнительных логов

В `content.js` уже есть базовое логирование. Для более детальной отладки можно добавить:

```javascript
// В начале методов добавляйте:
console.log('[DionJingles] Method name', arguments);

// Для важных событий:
console.log('[DionJingles] WebRTC mixing настроен', {
  stream: this.microphoneStream,
  mixingContext: this.mixingContext,
  destination: this.mixingDestination
});
```

### Включение verbose режима

Можно добавить флаг для детального логирования:

```javascript
// В constructor
this.debug = true;

// В методах
if (this.debug) {
  console.log('[DEBUG]', ...args);
}
```

## Тестирование на реальной конференции

### Пошаговая проверка:

1. **Откройте dion.vc**
2. **Откройте консоль** (F12)
3. **Проверьте инициализацию:**
   ```javascript
   window.dionJinglesPlayer
   ```
4. **Начните конференцию** (включите микрофон)
5. **Проверьте mixing:**
   ```javascript
   window.dionJinglesPlayer.mixingDestination
   ```
6. **Воспроизведите звук через popup**
7. **Попросите другого участника подтвердить**, что звук слышен

## Полезные инструменты

### Chrome DevTools

- **Console** - для логов и выполнения команд
- **Network** - для проверки загрузки звуковых файлов
- **Application → Storage** - для проверки сохраненных настроек

### Расширения для отладки

- **WebRTC Internals**: `chrome://webrtc-internals/` - для детальной информации о WebRTC соединениях
- **Media Stream Inspector** - для визуализации аудио потоков

### Проверка WebRTC соединений

Откройте `chrome://webrtc-internals/` во время конференции, чтобы увидеть:
- Активные соединения
- Статистику потоков
- Аудио треки

## Частые ошибки и решения

### Ошибка: "AudioContext was not allowed to start"

**Причина:** Браузер требует пользовательского взаимодействия перед созданием AudioContext.

**Решение:** Уже реализовано - AudioContext создается при первом клике/нажатии клавиши.

### Ошибка: "Failed to execute 'createMediaStreamSource'"

**Причина:** Поток уже используется другим источником или недействителен.

**Решение:** Проверьте, что поток активен и не был остановлен.

### Ошибка: "Cannot read property 'stream' of null"

**Причина:** `mixingDestination` не создан.

**Решение:** Убедитесь, что `ensureMixingContext()` вызывается перед использованием.

## Чеклист для отладки

- [ ] Content script загружен (`window.dionJinglesPlayer` существует)
- [ ] WebRTC включен (`isWebRTCEnabled === true`)
- [ ] Mixing context создан (`mixingContext !== null`)
- [ ] Mixing destination создан (`mixingDestination !== null`)
- [ ] Микрофонный поток подключен (`microphoneStream !== null`)
- [ ] Микрофонный источник подключен (`microphoneSource !== null`)
- [ ] getUserMedia перехвачен (проверить через `toString()`)
- [ ] RTCPeerConnection перехвачен (проверить через `toString()`)
- [ ] Звуки воспроизводятся (проверить `currentSounds`)
- [ ] Нет ошибок в консоли

## Получение помощи

Если проблема не решается:

1. **Соберите информацию:**
   - Скриншоты консоли с ошибками
   - Версия браузера
   - Версия расширения
   - Шаги для воспроизведения проблемы

2. **Проверьте логи:**
   - Console на странице dion.vc
   - Console в popup
   - Console в background script

3. **Проверьте WebRTC internals:**
   - Откройте `chrome://webrtc-internals/`
   - Найдите активные соединения
   - Проверьте статистику потоков

