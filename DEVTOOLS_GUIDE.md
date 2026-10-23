# Инструкция: Как проверить WebRTC в DevTools

## Цель
Убедиться, что звук аплодисментов передается через WebRTC поток в dion.vc.

## Что НЕ нужно делать
❌ Перехватывать `setParameters` - это метод для изменения параметров кодирования, он НЕ нужен для передачи звука.

## Что нужно проверить

### 1. Console - Логи расширения

Откройте консоль (F12) и проверьте:

```
[DionJingles] ✅ getUserMedia перехвачен успешно
[DionJingles] ✅ Mixing context создан сразу
[DionJingles] Аудио поток получен, настройка mixing...
```

**Если видите эти логи** - расширение работает!

### 2. Console - Проверка mixing контекста

В консоли выполните:

```javascript
// Проверить, что player создан
window.dionJinglesPlayer

// Проверить mixing context
window.dionJinglesPlayer?.mixingContext?.state  // должно быть "running"
window.dionJinglesPlayer?.mixingDestination?.stream  // должен быть MediaStream
```

### 3. Sources - Breakpoint на getUserMedia

1. Откройте **Sources** (F12 → Sources)
2. В правой панели найдите **Event Listener Breakpoints**
3. Разверните **Media** → поставьте галочку на **getUserMedia**
4. Включите микрофон в dion.vc
5. Когда сработает breakpoint, посмотрите в **Scope**:
   - `constraints` - должен содержать `{audio: true}`
   - После выполнения - `stream` должен содержать аудио треки

### 4. Console - Проверка треков

После включения микрофона выполните:

```javascript
// Найти все MediaStream с аудио треками
const allStreams = [];
for (const key in window) {
  try {
    const value = window[key];
    if (value instanceof MediaStream) {
      const audioTracks = value.getAudioTracks();
      if (audioTracks.length > 0) {
        allStreams.push({
          id: value.id,
          audioTracks: audioTracks.map(t => ({
            id: t.id,
            label: t.label,
            enabled: t.enabled,
            readyState: t.readyState
          }))
        });
      }
    }
  } catch (e) {}
}
console.log('Все MediaStream с аудио:', allStreams);
```

### 5. Console - Проверка RTCPeerConnection

```javascript
// Найти все RTCPeerConnection
const allPCs = [];
for (const key in window) {
  try {
    const value = window[key];
    if (value instanceof RTCPeerConnection) {
      const senders = value.getSenders();
      const transceivers = value.getTransceivers();
      allPCs.push({
        connectionState: value.connectionState,
        senders: senders.map(s => ({
          track: s.track ? {
            id: s.track.id,
            kind: s.track.kind,
            label: s.track.label,
            readyState: s.track.readyState
          } : null
        })),
        transceivers: transceivers.map(t => ({
          mid: t.mid,
          direction: t.direction,
          senderTrack: t.sender?.track ? {
            id: t.sender.track.id,
            kind: t.sender.track.kind
          } : null
        }))
      });
    }
  } catch (e) {}
}
console.log('Все RTCPeerConnection:', allPCs);
```

### 6. Network - WebRTC события

1. Откройте **Network** (F12 → Network)
2. В фильтре выберите **WebRTC**
3. Включите микрофон в dion.vc
4. Должны появиться события:
   - **ICE candidates** - для установки соединения
   - **SDP offer/answer** - для обмена параметрами

### 7. Проверка работы звука

1. Включите микрофон в dion.vc
2. В консоли выполните:
   ```javascript
   window.dionJingles.play("applause")
   ```
3. Проверьте логи:
   ```
   [DionJingles] Воспроизведение звука: applause
   ```
4. **Попросите другого участника** проверить, слышит ли он аплодисменты

## Что должно работать

✅ **getUserMedia перехвачен** - расширение получает доступ к микрофону  
✅ **Mixing context создан** - Web Audio API готов к смешиванию  
✅ **Аудио треки заменены** - оригинальные треки заменены на смешанный поток  
✅ **Звук передается** - другие участники слышат аплодисменты

## Если что-то не работает

1. **Проверьте логи расширения** в консоли
2. **Проверьте, что mixing context в состоянии "running"**
3. **Проверьте, что треки заменены** (см. пункт 4)
4. **Перезагрузите страницу** и попробуйте снова

## Важно

- Расширение должно быть установлено **ДО** включения микрофона
- Если микрофон уже включен, перезагрузите страницу
- Звук передается только если включен переключатель WebRTC в popup
