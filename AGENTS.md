<!-- bmad:context -->
<!-- Verified 2026-10-23 against 4a781b0. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## dion-jingles

Расширение Chrome (Manifest V3, чистый JS без сборки) для ведущего встреч на dion.vc: по кнопке в popup подмешивает джинглы в исходящий аудиопоток, чтобы их слышали все участники. Сейчас участники звук не слышат — починка подмешивания главная задача. Бриф и планирование BMAD — в `_bmad-output/planning-artifacts/` (локально, в git не входит).

## Where things are

- Расширение целиком в `extension/` — эту папку грузят в Chrome; в неё не клади ничего с именем на `_`, Chrome откажется загружать расширение.
- Код в мире страницы: `extension/inject.js` и строка `injectEarlyPageScript()` в `extension/content.js`; изолированный мир: остальной `content.js`; UI: `extension/popup.js`.
- Связь мир страницы ↔ content script — только `CustomEvent` на `document` (`__dionJinglesPlayWithUrl`, `__dionJinglesPlayGenerated` и др.); popup → content script — `chrome.tabs.sendMessage`.
- Отлаживаешь перехват — сначала `DEBUG_RTCPEERCONNECTION.md` и `DEBUG.md` (консольный API `window.dionJingles`).

## Running and verifying

- Сборки и тестов нет: после правки перезагрузи расширение в `chrome://extensions` и перезагрузи вкладку dion (content script стартует на `document_start`).
- Итоговая проверка — только на слух: https://dion.vc/event/dvzhdanov-1 в двух вкладках или на двух устройствах, нажать звук, слушать во второй. Ты её выполнить не можешь — попроси пользователя и дождись результата; не объявляй исправление рабочим без него.

## Conventions that differ from defaults

- Патчи `RTCPeerConnection`, `getUserMedia`, `RTCRtpSender` делай только в мире страницы (`extension/inject.js` / ранний инлайн-скрипт); в `content.js` у content script своя копия `window`, и подмена там на dion не действует.
- Комментарии и логи — на русском; логи с префиксом `[DionJingles]`.

## Known pitfalls

- Агенты считали сессию перехваченной, когда она не была. Не делай вывод о перехвате по логам `content.js` — проверь в консоли страницы (контекст `top`), что `RTCPeerConnection.toString()` не `[native code]` и что аудио-sender в `pc.getSenders()` отправляет смешанный трек.

<!-- /bmad:context -->
