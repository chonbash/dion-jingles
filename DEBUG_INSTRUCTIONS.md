# Инструкция для отладки setParameters

## Когда breakpoint сработает на строке `trs.transceiver.sender.setParameters(parameters);`

### Шаг 1: Проверьте объект sender в консоли

Выполните эти команды **по одной** в консоли (когда выполнение остановлено на breakpoint):

```javascript
// 1. Проверяем, что это за объект
trs.transceiver.sender
```

```javascript
// 2. Проверяем метод setParameters
trs.transceiver.sender.setParameters
```

```javascript
// 3. Проверяем, перехвачен ли метод (должно быть true, если перехват работает)
trs.transceiver.sender.setParameters.__dionResearchIntercepted
```

```javascript
// 4. Проверяем прототип
RTCRtpSender.prototype.setParameters
```

```javascript
// 5. Сравниваем - это ОДИН И ТОТ ЖЕ метод?
trs.transceiver.sender.setParameters === RTCRtpSender.prototype.setParameters
```

```javascript
// 6. Проверяем, обернут ли sender в Proxy
trs.transceiver.sender instanceof Proxy
```

```javascript
// 7. Проверяем наш флаг
trs.transceiver.sender.__dionResearchSenderWrapped
```

### Шаг 2: Что означают результаты

**Если `trs.transceiver.sender.setParameters === RTCRtpSender.prototype.setParameters` вернет `true`:**
- Это означает, что используется метод из прототипа
- Наш перехват ДОЛЖЕН работать
- Если не работает, значит перехват установлен неправильно

**Если вернет `false`:**
- Это означает, что dion.vc сохранил ссылку на оригинальный метод ДО нашего перехвата
- Нужно перехватывать на экземпляре sender, а не на прототипе

**Если `trs.transceiver.sender.setParameters.__dionResearchIntercepted` вернет `undefined`:**
- Перехват не установлен на этом методе
- Нужно проверить, почему перехват не сработал

### Шаг 3: Скопируйте результаты

Скопируйте результаты всех команд и отправьте мне. Это поможет понять, почему перехват не работает.

## Альтернативный способ: Используйте функции отладки

После перезагрузки страницы выполните в консоли:

```javascript
// Проверяет, перехвачен ли setParameters на прототипе
window.__dionResearchDebug.checkInterception()
```

```javascript
// Показывает все senders
window.__dionResearchDebug.showAllSenders()
```

Затем включите микрофон и посмотрите, что выводится в консоль.
