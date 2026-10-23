<!-- bmad:context -->
<!-- Verified 2026-10-23 against working tree (page.js scheme). Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## dion-jingles

Расширение Chrome (Manifest V3, чистый JS без сборки) для ведущего встреч на dion.vc: по кнопке в popup подмешивает джинглы в исходящий аудиопоток, чтобы их слышали все участники. Бриф и планирование BMAD — в `_bmad-output/planning-artifacts/` (локально, в git не входит).

## Where things are

- Расширение целиком в `extension/` — эту папку грузят в Chrome; в неё не клади ничего с именем на `_`, Chrome откажется загружать расширение.
- Мир страницы: `extension/page.js` (`content_scripts` с `"world": "MAIN"`, `document_start`). Он оборачивает только `MediaDevices.prototype.getUserMedia`: аудиотрек микрофона и шина джинглов (`GainNode`) сводятся в общем `AudioContext` в `MediaStreamDestination`, и dion получает смешанный трек (`label`/`getSettings`/`getConstraints`/`applyConstraints` проксируются к микрофону, `stop()` останавливает микрофон). Не удалось смешать (нет аудио, `AudioContext` не `running` за ~300 мс, ошибка) — отдаётся исходный поток.
- Изолированный мир: `extension/content.js` — сообщения popup (`playSound`, `toggleWebRTC`), локальное воспроизведение (ведущий слышит всегда), отправка звука в `page.js`, проброс `webrtcEnabled`. UI: `extension/popup.js`.
- Связь мир страницы ↔ content script — только `CustomEvent` на `document`: в страницу `__dionJinglesPlayWithUrl` (base64 data-URL mp3), `__dionJinglesPlayGenerated`, `__dionJinglesSetEnabled`; из страницы `__dionJinglesHello`, `__dionJinglesRequestPlay`. Состояние эфира: `__dionJinglesQueryAir` → `__dionJinglesAirState` (`{id, air}`). popup → content script — `chrome.tabs.sendMessage`; на `playSound` ответ асинхронный `{success, air}` (нет ответа от `page.js` за ~300 мс → `air: 'unknown'`), popup по `air` показывает предупреждение.
- `DEBUG*.md`, `HOW_TO_FIND_RTCPEERCONNECTION.md`, `DEVTOOLS_GUIDE.md`, README/INSTALL описывают старую схему (перехват `RTCPeerConnection`) и устарели — не опирайся на них.

## Running and verifying

- Сборки и тестов нет: после правки перезагрузи расширение в `chrome://extensions` и перезагрузи вкладку dion (content scripts стартуют на `document_start`, микшер создаётся только при `getUserMedia` после этого).
- Проверка в консоли страницы (контекст `top`): `dionJingles.status()` — `intercepted: true`, `contextState: 'running'`, `liveMixers` ≥ 1; `dionJingles.play('applause')` — тот же путь, что кнопка popup. Слышимость у участника: во второй вкладке `AnalyserNode` на `srcObject` входящего аудиоэлемента — уровень растёт при `play()` с включённым микрофоном и не растёт с выключенным.
- Итоговая проверка — только на слух: https://dion.vc/event/dvzhdanov-1 в двух вкладках или на двух устройствах, нажать звук, слушать во второй. Ты её выполнить не можешь — попроси пользователя и дождись результата; не объявляй исправление рабочим без него.

## Conventions that differ from defaults

- Патчи браузерных API делай только в `extension/page.js`; в `content.js` у content script своя копия `window`, и подмена там на dion не действует. Инлайн-`<script>` и `<script src>` не используй.
- Соединения dion только наблюдай, не управляй ими. Сам не вызывай `addTrack`/`addTransceiver`/`replaceTrack`/`setParameters` и не меняй SDP: лишний отправитель ломает SDP, сервер отвечает `sdp_answer error` и вход в комнату падает. Пассивные обёртки `RTCRtpSender.prototype.replaceTrack`, `RTCPeerConnection.prototype.addTrack`/`addTransceiver` в `page.js` допустимы только для наблюдения: аргументы и результат без изменений, исключения наблюдателя глотаются.
- Мьют dion: в звонке — `sender.replaceTrack(null)`, включение — `track.enabled = true` + `replaceTrack(смешанный трек)`; в превью — `track.enabled = false`. Поэтому `mixedEnabled` в `status()` не индикатор мьюта — смотри `status().air` (`disabled` / `no-mixer` / `muted` / `on-air`). Микрофон за пользователя не включай.
- Комментарии и логи — на русском; логи с префиксом `[DionJingles]`.

## Known pitfalls

- Агенты считали сессию перехваченной, когда она не была. Не делай вывод о перехвате по логам `content.js` — проверь `dionJingles.status()` в консоли страницы (контекст `top`).

<!-- /bmad:context -->
