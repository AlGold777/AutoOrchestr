# Проверка сжатия Extract 3.1.0 — 2026-10-03

Исходный файл: `Disput Flow 20261003_15-24 (1).json`. Размер существующего MD: 1 226 110 байт. Новый MD: **135 189 байт**, уменьшение **88,97%**. Измерение UTF-8; это байты, не оценка токенов.

| Раздел | До, байт | После, байт |
|---|---:|---:|
| Transport extract | 2289 | 2345 |
| 1. Data availability and integrity | 2338 | 2338 |
| 2. Stages | 809 | 809 |
| 3. Identity map | 2873 | 2873 |
| 4. All requests | 4251 | 4251 |
| 5. Shared stage timeline and request transitions | 104226 | 47761 |
| 6. Length observations | 584 | 584 |
| 7. Terminal registry and answer representations | 116477 | 5153 |
| 8. Manual actions | 865 | 865 |
| 9. Start refusals | 83941 | 935 |
| 10. Focus | 482 | 482 |
| 11. Outside the run window | 264 | 264 |
| 12. Stored prompt fragment checks | 176 | 177 |
| 13. Diagnoses grouped | 1389 | 1198 |
| 14. Same-name comparisons and count units | 316 | 316 |
| 15. Delivery batches and problems | 2717 | 2717 |
| Appendix. Individual diagnoses | 1498 | 1498 |
| Collection counter samples | — | 6652 |
| Event label aliases | 619 | 619 |
| Grouping evidence dictionary | 895275 | 43809 |
| Source registry | 4721 | 9543 |

Проверка фактов против генератора из HEAD до правки:

- Не изменились counters, stages, lengths, manual, focus, comparisons, integrity.
- Для каждого из 13 запросов совпали identity, times, counts, terminalGroups, collected, stableToTerminalMs.
- В MD доступны пути ко всем 1450 событиям и 1248 записям журнала; диапазоны и шаги развёрнуты программно.
- Сохранились 25 терминальных записей / 17 групп и 750 отказов старта.
- Для каждого запроса развёрнута последовательность состояний фона: совпали количество групп и сумма исходных записей.
- Исходный JSON не изменился. Транспорт и поведение моделей не диагностировались.
- 26 тестов в трёх наборах пройдены; среди них девять моделей × четыре раунда с 2880 записями опроса (порог MD <80 000 байт), повторные циклы, пустые объекты, null и отсутствие поля.

Ограничения представления: MD хранит первые/последние точки фоновых состояний и порядок начала групп. Точные времена промежуточных опросов и изменений счётчиков коллектора доступны по путям в исходном JSON. Нет ограничения строк или скрытого усечения событий. Полная общая шкала dispatch/focus/tab/navigation и значимые переходы запроса остаются в MD.

Сгенерированный файл: `/Users/restart/Downloads/extract_transport_20261003_15-24_compact.md`.
