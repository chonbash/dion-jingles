# Как найти, как dion.vc создает RTCPeerConnection

## Способ 1: Breakpoint на конструкторе RTCPeerConnection (САМЫЙ ПРОСТОЙ)

1. Откройте **DevTools** (F12)
2. Перейдите в **Sources** (F12 → Sources)
3. В правой панели найдите **Event Listener Breakpoints**
4. Разверните **Script** → поставьте галочку на **Script First Statement**
5. **ИЛИ** используйте Console:

```javascript
// Сохраняем оригинальный конструктор
const OriginalRTCPeerConnection = window.RTCPeerConnection;

// Перехватываем конструктор с breakpoint
window.RTCPeerConnection = function(...args) {
  debugger; // BREAKPOINT ЗДЕСЬ!
  console.log('RTCPeerConnection создан!', args);
  console.trace(); // Покажет стек вызовов
  return new OriginalRTCPeerConnection(...args);
};
```

6. Перезагрузите страницу или включите микрофон
7. Когда сработает breakpoint, в **Call Stack** (справа) увидите, откуда вызывается конструктор

## Способ 2: Поиск в коде dion.vc

1. Откройте **DevTools** → **Sources**
2. В левой панели найдите **Page** → разверните `dion.vc`
3. Используйте **Ctrl+Shift+F** (или Cmd+Shift+F на Mac) для поиска по всем файлам
4. Ищите:
   - `new RTCPeerConnection`
   - `RTCPeerConnection(`
   - `new window.RTCPeerConnection`
   - `webkitRTCPeerConnection`

## Способ 3: Console - перехват с логированием

```javascript
// Вставьте это в консоль ПЕРЕД загрузкой страницы или перезагрузите страницу
(function() {
  const OriginalRTCPeerConnection = window.RTCPeerConnection;
  
  window.RTCPeerConnection = function(...args) {
    console.log('🔍 RTCPeerConnection создан!');
    console.log('Args:', args);
    console.trace(); // Полный стек вызовов
    console.log('Caller:', arguments.callee.caller);
    
    const pc = new OriginalRTCPeerConnection(...args);
    
    // Сохраняем в глобальную переменную для анализа
    if (!window.__allPCs) window.__allPCs = [];
    window.__allPCs.push(pc);
    
    return pc;
  };
  
  // Копируем прототип
  Object.setPrototypeOf(window.RTCPeerConnection, OriginalRTCPeerConnection);
  Object.setPrototypeOf(window.RTCPeerConnection.prototype, OriginalRTCPeerConnection.prototype);
  
  console.log('✅ RTCPeerConnection перехвачен для отладки');
})();
```

После этого перезагрузите страницу и смотрите логи в консоли.

## Способ 4: Performance Profiler

1. Откройте **DevTools** → **Performance** (или **Performance Monitor**)
2. Нажмите **Record** (круглая кнопка)
3. Включите микрофон в dion.vc
4. Остановите запись
5. В **Timeline** найдите вызовы `RTCPeerConnection`

## Способ 5: Network - WebRTC события

1. Откройте **DevTools** → **Network**
2. В фильтре выберите **WebRTC**
3. Включите микрофон
4. Должны появиться события WebRTC
5. Кликните на событие → в **Headers** или **Preview** может быть информация о создании PC

## Способ 6: Поиск через Object.defineProperty

```javascript
// В консоли - перехватываем через defineProperty
const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'RTCPeerConnection');
const originalValue = originalDescriptor ? originalDescriptor.value : window.RTCPeerConnection;

Object.defineProperty(window, 'RTCPeerConnection', {
  get: function() {
    console.log('🔍 Доступ к RTCPeerConnection через getter');
    console.trace();
    return originalValue;
  },
  configurable: true
});
```

## Способ 7: Поиск в минифицированном коде

Если код минифицирован:

1. Откройте **Sources**
2. Найдите файл с кодом dion.vc (обычно большой bundle.js)
3. Нажмите **{}** (Pretty print) внизу для форматирования
4. Используйте **Ctrl+F** для поиска `RTCPeerConnection`

## Что искать в стеке вызовов

Когда сработает breakpoint, в **Call Stack** ищите:

- Файлы dion.vc (не chrome-extension://)
- Функции с названиями типа:
  - `createConnection`
  - `initWebRTC`
  - `setupPeerConnection`
  - `startCall`
  - Или что-то связанное с WebRTC/Media

## Пример: что должно быть в логах

После перехвата вы должны увидеть что-то вроде:

```
🔍 RTCPeerConnection создан!
Args: [{iceServers: [...]}]
Call Stack:
  at createPeerConnection (dion.vc/bundle.js:12345:67)
  at initWebRTC (dion.vc/bundle.js:12300:12)
  at startCall (dion.vc/bundle.js:12200:5)
  ...
```

## Важно

- Перехват должен быть установлен **ДО** загрузки страницы
- Или перезагрузите страницу после установки перехвата
- Если используете наш content.js, он уже перехватывает, но может быть слишком поздно

## Проверка: работает ли наш перехват

В консоли выполните:

```javascript
// Проверить, перехвачен ли RTCPeerConnection
window.RTCPeerConnection.toString()

// Если видите нашу функцию - перехват работает
// Если видите [native code] - перехват не работает
```
