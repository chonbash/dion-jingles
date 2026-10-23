# Отладка: Почему RTCPeerConnection не перехватывается

## Проблема
В логах НЕТ сообщений `[DionJingles] 🔍 RTCPeerConnection создан`, значит наш перехват не срабатывает.

## Проверка в консоли

### 1. Проверить, перехвачен ли RTCPeerConnection

```javascript
// Проверить, перехвачен ли конструктор
window.RTCPeerConnection.toString()

// Если видите нашу функцию - перехват работает
// Если видите [native code] - перехват НЕ работает
```

### 2. Найти, как dion.vc создает RTCPeerConnection

```javascript
// Вставьте это в консоль ПЕРЕД загрузкой страницы или перезагрузите страницу
(function() {
  const OriginalRTCPeerConnection = window.RTCPeerConnection;
  
  window.RTCPeerConnection = function(...args) {
    console.log('🔍 RTCPeerConnection создан!');
    console.trace(); // ПОЛНЫЙ СТЕК ВЫЗОВОВ
    return new OriginalRTCPeerConnection(...args);
  };
  
  Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection);
  Object.setPrototypeOf(window.RTCPeerConnection.prototype, OriginalRTCPeerConnection.prototype);
  
  console.log('✅ RTCPeerConnection перехвачен для отладки');
})();
```

### 3. Проверить, есть ли RTCPeerConnection в window

```javascript
// После загрузки страницы и включения микрофона
Object.keys(window).filter(k => {
  try {
    return window[k] instanceof RTCPeerConnection;
  } catch (e) {
    return false;
  }
})
```

### 4. Проверить Zustand store

Из кода видно, что dion.vc хранит RTCPeerConnection в Zustand store:

```javascript
// Попробуйте найти через Zustand
// dion.vc использует useWebRTC store
// peerConnection хранится в store

// В консоли попробуйте:
window.useWebRTC?.getState?.()?.peerConnection
```

### 5. Проверить, создается ли PC в Web Worker

```javascript
// Проверить, есть ли Web Workers
// (но это сложно проверить из основного контекста)
```

## Возможные причины

1. **RTCPeerConnection создается ДО загрузки нашего скрипта**
   - Решение: убедиться, что `run_at: "document_start"` в manifest.json

2. **dion.vc использует кэшированную ссылку на RTCPeerConnection**
   - Решение: перехватить через Object.defineProperty на window

3. **RTCPeerConnection создается через другой глобальный объект**
   - Решение: проверить все возможные пути

4. **RTCPeerConnection создается в замыкании до нашего перехвата**
   - Решение: перехватить на прототипе и в каждом месте создания

## Что проверить прямо сейчас

1. В консоли выполните:
   ```javascript
   window.RTCPeerConnection.toString()
   ```
   Если видите `[native code]` - перехват НЕ работает!

2. Проверьте, есть ли RTCPeerConnection:
   ```javascript
   // После включения микрофона
   const pc = window.useWebRTC?.getState?.()?.peerConnection;
   console.log('PC из store:', pc);
   ```

3. Проверьте senders в PC:
   ```javascript
   const pc = window.useWebRTC?.getState?.()?.peerConnection;
   if (pc) {
     const senders = pc.getSenders();
     console.log('Senders:', senders.map(s => ({
       id: s.track?.id,
       kind: s.track?.kind,
       label: s.track?.label
     })));
   }
   ```
