**Ответы на замечания ведущего**

1. **Подтверждаю итог c03** как протокол эксперимента, не как готовое решение. ClickNovaShutter существует, и в его tasks-документе прямо указаны iPhone 16 Pro, iOS 26.5.2, штатная Camera и серия 10 фото из 10 команд интервалометра — так что «версия iOS не названа» неверно, а в решении статус «подтверждено отчётом разработчика» сформулирован корректно. Android-ветку BLE_HID_EXAMPLE тоже подтверждаю: репозиторий реален, Consumer Control (Volume, Camera Snapshot) есть, APK существуют.github+2
2. Протокол первой проверки — см. возражение 3 и готовый план в файле; он валиден, но требует правок по идентификации APK.
3. Цитата по BLE HID для iOS-приложений **найдена** (текст Accessory Design Guidelines, раздел о GATT-сервере iOS): службы «shall not be published by third-party iOS applications», включая «Bluetooth Low Energy HID Service», Battery Service, ANCS и др. — то есть запрет реален, но точная ревизия «R18 (2022)» у меня не подтверждена. Само поведение согласуется с тем, что HID-over-GATT полностью управляется системой и невидим для приложений.developer.apple+2
4. Quick Share ↔ AirDrop: официально с 20.11.2025 (Pixel 10), с 17.02.2026 — Pixel 9/9 Pro/9 Pro XL/9 Pro Fold (кроме 9a), плюс Pixel 8a и новее и ряд моделей Samsung, Oppo, OnePlus, Vivo, Xiaomi, Honor, Motorola. Обмен двусторонний, требуется AirDrop «Всем на 10 минут».blog+3
5. После первого теста остаются: переносимость на другие Android-стеки, устойчивость после смены сборки iOS 26, конфликт с режимом burst при длинном удержании, автовозврат оригинала. Тест сузит это до конкретной пары устройств и дескриптора.

**Возражения к решению**

1. **Спекулятивная спецификация.** «HOGP 1.2 от 21.04.2026» не существует: действующая версия — HOGP 1.0, принята 27.12.2011; именно она требует Battery Service, Device Information Service и bonding. Исправление: ссылаться на HOGP 1.0. Проверка: открыть страницу спецификации на bluetooth.com.[bluetooth](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HOGP_v1.0/out/en/index-en.html)
2. **PHBackgroundResourceUploadExtension** действительно есть с iOS 26.1, но уже помечен Deprecated (iOS 26.1–27.0) и заменён на PHBackgroundResourceUploadJobExtension; к тому же это механизм загрузки в облако, а не per-command передача оригинала. Исправление: удалить как аргумент или пометить deprecated. Проверка: страница Apple Developer.[developer.apple](https://www.developer.apple.com/documentation/photos/phbackgroundresourceuploadextension)
3. **Неверная атрибуция APK.** Репозиторий BLE_HID_EXAMPLE принадлежит 04Alek04, а не «Aleksander-Drewnicki»; я подтверждаю v2.6.0 от 28.10.2026, а v2.7.0 из файла не подтверждаю. Исправление: сверить владельца/версию/хеш перед тестом. Проверка: страница Releases.github+1
4. **Clak** — не подтверждаю (поиск не даёт надёжного источника, согласен с ведущим). Исправление: убрать как прецедент до появления ссылки.
5. **Пропущен экран заблокированного iPhone:** HID-спуск работает только при foreground Camera на разблокированном устройстве — сам ClickNova это прямо фиксирует; в решении есть, но критерий успеха стоит записать как «без автовозврата при foreground».github+1

В остальном — статусная модель, разделение BLE/Classic, контроль закрытой Camera и журнал отклонённых замечаний корректны.

Вердикт: согласен с правками

[[AO-7am8c9]]