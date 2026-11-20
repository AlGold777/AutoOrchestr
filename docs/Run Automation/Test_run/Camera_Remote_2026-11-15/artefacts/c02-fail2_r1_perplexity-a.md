## Ответы по замечаниям ведущего

**Подтверждённые пункты:**

1. Пульты шлют Volume Up (0xE9), Камера iPhone снимает — подтверждаю: Nordic Q&A (Fjorden), маппинг AB Shutter 3 (кнопка iOS = Volume Up).devzone.nordicsemi+2
2. `BluetoothHidDevice` API 28, отказ не-foreground-приложению — подтверждаю, но частично опровергаю «в официальной документации этого нет»: фраза «the app will be automatically unregistered if it is not foreground» есть в официальной javadoc.[developer.android](https://developer.android.com/reference/kotlin/android/bluetooth/BluetoothHidDevice)
3. Camera Control и неоднозначность клавиш громкости — не знаю, независимо не проверял.

**Пропущенное/неверное:**

1. BLE HOGP — согласен, главный пропуск. Весь доказанный массив (Fjorden, AB Shutter 3 виден по службе 0x1812 ) — именно BLE. Прямого источника о блокировке службы 0x1812 приложением не найдено: AOSP лишь помечает её отдельно (`isHidSrvcUuid`), а open-source BLE-HID-приложение для Android существует. Статус: не знаю, решается опытом.android.googlesource+3
2. Готовые реализации подтверждаю: 04Alek04/BLE_HID_EXAMPLE, jqssun BT Remote (заявлена iOS).github+1
3. Дескриптор для iOS 17–26: не знаю. У Fjorden рабочий report map существует, но iOS 15 трактовала его как зависший Volume Up; подтверждений на 17+ в источниках нет.[devzone.nordicsemi](https://devzone.nordicsemi.com/f/nordic-q-a/92798/trigger-ios-shutter-via-ble-on-ios-16)

## Ответы на вопросы прохода 2

1. Оба транспорта имеют прецедент на iOS: селфи-пульты classic, BLE-пульты тоже. Bluke прямо помечает Apple как unsupported, другие приложения заявляют iOS — источники конфликтуют, значит нужен оба-путевой бинарный тест.devzone.nordicsemi+2
2. Точных байтов для iOS 17–26 у меня нет.
3. Проверка за час: BLE_HID_EXAMPLE или BT Remote → спарить → Камера в foreground → кнопка.github+1
4. iPhone-контроллер: документированного HOGP через `CBPeripheralManager` нет — согласен с итогом. Любопытный контрпример — darwin-bt-remote заявляет HID-клавиатуру с iOS и описывает ограничение bluetoothd; источник ненадёжный, не знаю.[github](https://github.com/jqssun/darwin-bt-remote)
5. Возврат файла: PhotoKit-помощник (как задумано), fallback — Shared Albums/iCloud.

## Возражения к решению

1. **Неверный приоритет**: classic выбран основным, а BLE, на котором весь доказательный массив, не разобран. Плюс у classic встроенный showstopper — foreground-only регистрация. Дешёвая проверка: час с.developer.android+1
2. **Новый риск для iOS 26 пропущен**: на Nordic DevZone зарегистрированы массовые BLE-дисконнекты именно на iOS 26 — угроза и для BLE-ветки.[devzone.nordicsemi](https://devzone.nordicsemi.com/f/nordic-q-a/124994/ios-26-bluetooth-disconnect-issues/551910)
3. **Контур возврата оборван в тексте** — дописать: PHPhotoLibrary-наблюдатель + передача; фоновая доставка не гарантирована, нужен pull с Android.
4. Формулировка «потенциально воспринимает» точная; итога «работает» выносить нельзя — верно и честно оговорено.

Вердикт: согласен с правками  
[[AO-96vxn2]]