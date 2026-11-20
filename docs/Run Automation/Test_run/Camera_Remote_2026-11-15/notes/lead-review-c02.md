Проход c02 дал ответы четырёх моделей (GPT получен вне прогона). Все пишут «согласен с правками». Вот что я проверил сам.

Подтверждено:
- Android-приложения с BLE HID уже есть: Aleksander-Drewnicki/BLE_HID_EXAMPLE и его форк rkissell/BLE_HID_EXAMPLE (режим «только consumer control»), ww24/remote-shutter (BLE HID пульт спуска). Значит Android-приложение может публиковать HOGP через GATT-сервер. Утверждение «Android запрещает службу 0x1812 для обычного приложения» (Perplexity) не подтверждено: в AOSP для GattServer названы запрещёнными FIDO, Android TV Remote, LE Audio, Headtracker, HID не назван.
- У rkissell нет готовых релизов, нужна сборка из исходников.
- Nordic DevZone: BLE-пульт со Volume Up работал на iOS 15, с iOS 16 перестал (менялся дескриптор). Для iOS 17–26 свидетельств нет.

Не подтверждено (не используй как факт): «ClickNovaShutter сообщает о спуске на iPhone 16 Pro», «APK v2.7.0 у оригинала», «Clak: iPhone → Mac HID, uuidNotAllowed для 0x1812». Приведённый GPT дескриптор 05 0C 09 01 A1 01 85 01 15 00 26 FF 03 19 00 2A FF 03 75 10 95 01 81 00 C0 с отчётами E9 00 и 00 00 — источник не назван.

Решение по спору: BLE HOGP и классический BluetoothHidDevice — два отдельных теста, BLE первым (прецедент у реальных пультов, готовые приложения). Классический HID остаётся вторым.

Вопросы следующему проходу, с источниками:
1. Есть ли свидетельства, что BLE HID Consumer Control Volume Up снимает штатную Камеру именно на iOS 17, 18 и 26 (даты, версии)?
2. Что iOS требует от BLE HID-устройства, чтобы принять его как пульт: обязательные службы и характеристики HOGP (HID Information, Report Map, Protocol Mode, Report Reference, Device Information), сопряжение и шифрование? Ссылка на Apple Accessory Design Guidelines или другой источник.
3. Какой дескриптор Consumer Control с кнопкой громкости подтверждённо работает на iOS 17+? Если подтверждённого нет, сказать прямо.
4. Существуют ли проекты «ClickNovaShutter» и «Clak», и подтверждают ли они то, что о них сказано?
5. Как вернуть файл на Android в 2026: совместимость AirDrop и Quick Share, общий альбом iCloud; что подтверждено источниками?
