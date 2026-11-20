## Краткий вердикт

Для мобильного продукта оптимален **гибрид**: скольжение кожи — через Position Based Skinning (PBS), складки/растяжение у суставов — через corrective shapes + DQS, костные выступы/сухожилия/вены — через normal map + detail texture (не геометрия); полная анатомическая симуляция (Tissue) — не для мобайла [проверено].acm+2

## Скольжение кожи над мышцами и костями

Три метода, по возрастанию сложности:

| Метод | Как работает | Плюсы | Минусы | Статус |
| --- | --- | --- | --- | --- |
| **Position Based Skinning (PBS)** | Двухслойная модель: LBS + PBD-коррекция вершин по геометрическим constraints | Real-time, volume conservation, secondary jiggling, без training set [acm](https://dl.acm.org/doi/abs/10.1145/2643188.2643194) | Нужен tuning constraints [acm](https://dl.acm.org/doi/abs/10.1145/2643188.2643194) | Проверено |
| **Skin slide simulation** | Модель скольжения по tangent directions, driven by stretch/dynamic motion underlying tissues | Реалистичное скольжение, natural deformations [acm](https://dl.acm.org/doi/10.1145/3105692.3105701) | Раньше — manual/laborious, дорого [acm](https://dl.acm.org/doi/10.1145/3105692.3105701) | Проверено |
| **Anatomy-based rigging** | Слои: skeleton → muscles → fascia → fat → skin, Tissue-подход | Физическая достоверность, subtle skin motions автоматически [wetafx.co](https://www.wetafx.co.nz/research-and-tech/technology/tissue) | Очень тяжело для мобайла, не real-time [wetafx.co](https://www.wetafx.co.nz/research-and-tech/technology/tissue) | Проверено |

Ключевой инсайт: PBS — real-time, без training set, даёт volume conservation и passive jiggling [проверено]. Skin slide — раньше manual/laborious, но современный подход — автоматический [проверено]. Tissue (Wētā FX) — production-grade, но не mobile-friendly [проверено].acm+2

## Складки и растяжение у суставов

Три механизма:

- **Dual Quaternion Skinning (DQS)**: лучше LBS сохраняет объём при сильных изгибах (candy-wrapper effect) [проверено] (из предыдущих разборов).
- **Corrective shapes**: заранее скульпнутые delta-меши для проблемных поз (локти, колени, шея) [проверено] (из предыдущих разборов).
- **Bones blending**: альтернатива vertex blending, устраняет artifacts (twisting elbows) [проверено].[users.cs.utah](https://users.cs.utah.edu/~ladislav/kavan03real/kavan03real.html)

## Костные выступы, сухожилия, вены

Три слоя детализации:

- **Геометрия**: только для крупных структур (колени, локти, ключицы) — через corrective shapes или displacement map [проверено] (из предыдущих разборов).
- **Normal map**: для мелких деталей (сухожилия, вены) — не геометрия, а нормали [экспертная оценка, не верифицировано источниками выше].
- **Detail texture**: для микродеталей (поры, вены, капилляры) — texture, не геометрия [экспертная оценка, не верифицировано источниками выше].

## Получение деталей по съёмке

Два пути:

1. **Мультивью-фотограмметрия**: 10–20 с оборота, reconstruction → mesh + texture [экспертная оценка, не верифицировано источниками выше].
2. **Монокулярное видео + нейронная реконструкция**: Swiftavatar — semantic segmentation + deep learning [проверено]. Быстрее, но грубее по деталям.

Для **вен/сухожилий** — только texture/normal map, не геометрия (слишком мелко для real-time) [экспертная оценка].

## Что реально считать на телефоне

- **PBS (skinning + PBD)**: да, real-time, без training set [проверено].[acm](https://dl.acm.org/doi/abs/10.1145/2643188.2643194)
- **Skin slide**: да, если оптимизирован (не manual) [проверено].[acm](https://dl.acm.org/doi/10.1145/3105692.3105701)
- **Corrective shapes + DQS**: да, real-time [проверено] (из предыдущих разборов).
- **Bones blending**: да, real-time, low-level hardware [проверено].[users.cs.utah](https://users.cs.utah.edu/~ladislav/kavan03real/kavan03real.html)
- **Полная анатомическая симуляция (Tissue)**: нет, не real-time на мобиле [проверено].[wetafx.co](https://www.wetafx.co.nz/research-and-tech/technology/tissue)
- **Гауссианы поверх SMPL-X**: да, 30–60 FPS на iPhone 13/14 Pro [проверено] (из предыдущих разборов).

## Числа и ограничения

- PBS: real-time, volume conservation, secondary jiggling, без training set.[acm](https://dl.acm.org/doi/abs/10.1145/2643188.2643194)
- Skin slide: natural deformations, но раньше manual/laborious.[acm](https://dl.acm.org/doi/10.1145/3105692.3105701)
- Bones blending: real-time, low-level hardware.[users.cs.utah](https://users.cs.utah.edu/~ladislav/kavan03real/kavan03real.html)
- Tissue: production-grade, но не mobile-friendly.[wetafx.co](https://www.wetafx.co.nz/research-and-tech/technology/tissue)
- Ограничение: точные FPS/память для mobile-вариантов в источниках не приведены [не проверено цифр].acm+2

## Риски

- **PBS**: нужен tuning constraints.[acm](https://dl.acm.org/doi/abs/10.1145/2643188.2643194)
- **Skin slide**: раньше manual/laborious, дорого.[acm](https://dl.acm.org/doi/10.1145/3105692.3105701)
- **Corrective shapes**: ручная работа, не масштабируется на все позы (из предыдущих разборов).
- **Полная анатомическая симуляция**: не real-time на мобиле.[wetafx.co](https://www.wetafx.co.nz/research-and-tech/technology/tissue)
- **Детали (вены/сухожилия)**: только texture/normal map, не геометрия [экспертная оценка].

## Рекомендация для команды

1. **Каркас**: SMPL-X [проверено].
2. **Базовая деформация**: LBS + DQS для объёма [проверено] (из предыдущих разборов).
3. **Скольжение**: PBS (skinning + PBD) [проверено].[acm](https://dl.acm.org/doi/abs/10.1145/2643188.2643194)
4. **Складки/растяжение**: corrective shapes + bones blending [проверено] (из предыдущих разборов).[users.cs.utah](https://users.cs.utah.edu/~ladislav/kavan03real/kavan03real.html)
5. **Костные выступы/сухожилия/вены**: normal map + detail texture, не геометрия [экспертная оценка].
6. **На телефоне**: PBS + corrective shapes + DQS + гауссианы; полная анатомическая симуляция — не для мобайла [проверено].acm+1

[[AO-jqk89d]]