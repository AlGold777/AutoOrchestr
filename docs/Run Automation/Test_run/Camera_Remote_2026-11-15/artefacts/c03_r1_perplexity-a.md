## Ответы на замечания ведущего

**1. iOS 17/18/26, спуск через Volume Up.** Частично подтверждаю: Reddit (апрель 2025, эпоха iOS 18) — «Bluetooth shutter в штатной Camera работает и делает снимок»; Apple Discussions (сентябрь 2025) — разработчик подтверждает эмуляцию спуска командой 0xE9 на актуальной iOS; ClickNovaShutter (2026) заявляет работу на iOS с требованием Camera в foreground. Документального подтверждения Apple нет — это эмпирика.reddit+2

**2. Требования iOS к HOGP.** Apple Accessory Design Guidelines: поддержка HID Profile, отчёт ≤22 байт, Peripheral-роль BLE, минимум GATT-запросов. Ключевое: «Bluetooth Low Energy HID Service… must not be published by third party iOS applications» — служба 0x1812 реализована самой iOS и запрещена к публикации сторонними приложениями. Это документально закрывает сценарий «iPhone как контроллер».scribd+2

**3. Подтверждённый дескриптор для iOS 17+.** Прямо: подтверждённого нет. Источник дескриптора GPT не назван, использовать нельзя.

**4. ClickNovaShutter.** Проект существует (tcholewa/ClickNovaShutter, ESP32, BLE HID Consumer Control, 0xE9 с release, требует открытой Camera). Утверждение про iPhone 16 Pro не подтверждаю — репозиторий 2026 года, доверие низкое. **Clak** существует (sryo/clak, клавиатура Mac↔iPhone); деталь про uuidNotAllowed мной не проверена, но запрет ADG на публикацию HID-службы подтверждает суть претензии.github+2

**5. Возврат файла в 2026.** Quick Share ↔ AirDrop официально работает с февраля 2026 (Pixel 8a+, Galaxy S24+ и новее): требуется AirDrop «Всем на 10 минут», Bluetooth/Wi-Fi, ручное принятие на iPhone. Направление iPhone→Android документально не подтверждено — демонстрируется Android→iPhone. iCloud Shared Albums: Android видит альбом по публичной веб-ссылке, добавлять фото не может (обещано в iOS 27).android+3

## Возражения к текущему решению

1. **Неверный приоритет транспорта.** Решение ставит классический BluetoothHidDevice первым, хотя решение ведущего — BLE HOGP первым, и оно правильное: у BLE есть готовые Android-приложения и живой прецедент пультов; классический HID зависит от вендорского стека. Исправление: перевернуть порядок тестов. Проверка: установить BLE_HID_EXAMPLE, служебный тест за час.
2. **«Руководство Apple для iOS 26 подтверждает спуск»** — сформулировано сильнее документации: Apple подтверждает спуск физическими кнопками громкости, эквивалентность Bluetooth-ввода — эмпирическая. Смягчить формулировку.[apple](https://support.apple.com/en-mk/guide/iphone/iph6cfaf98b6/ios)
3. **Пропущен документальный запрет iPhone-контроллера.** Решение осторожно пишет «исключить HOGP нельзя» — ADG прямо запрещает. Усилить до подтверждённого запрета.[scribd](https://www.scribd.com/document/444990642/Accessory-Design-Guidelines-pdf)
4. **Контур возврата устарел.** Не упомянута совместимость Quick Share/AirDrop 2026 — дешёвый путь без своего сервера. Проверка: один файл с Galaxy/Pixel на iPhone.[android](https://www.android.com/intl/en_us/quick-share/with-iphone/)
5. **Пропущено требование bonding/шифрования HOGP** — iOS ждёт зашифрованного сопряжения (см. «Securing» у ClickNovaShutter ); без него возможен «подключено, но молчит».[github](https://github.com/tcholewa/ClickNovaShutter)

Вердикт: согласен с правками

[[AO-aksws2]]