## Краткий вердикт

Для мобильного продукта оптимален **двухслойный подход**: SMPL-X-подобный параметрический каркас как «скелет + форма» + отдельный слой мягких тканей/деталей (нейронный или гауссиановый) для фотореализма. Полностью неявные модели (SDF/NeRF) дают лучшее качество, но слишком тяжёлые для телефона; полностью параметрические (SMPL) — быстрые, но анатомически грубые [проверено].sciencedirect+1

## Варианты модели тела

Три класса, с разным trade-off:

| Класс | Представление | Плюсы | Минусы | Статус |
| --- | --- | --- | --- | --- |
| **Параметрическая поверхность** (SMPL/SMPL-X) | PCA blendshapes + LBS | Быстро, компактно (10 shape / 72 pose параметров для SMPL), battle-tested [inferensys](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/3d-body-mesh-reconstruction-apis/smpl-vs-smpl-x-body-model-fidelity) | Грубая анатомия: переоценивает key dimensions, не ловит fat layers/curvature | Проверено |
| **Слои скелет-мышцы-жир-кожа** (ATLAS, MHR, SKEL) | Отдельные bases для skeleton и soft tissue | Анатомическая точность: bone protrusions, subcutaneous fat, curvatures — лучше по shape similarity | Сложнее, больше параметров, тяжелее фитинг | Проверено |
| **Неявные/нейронные** (SDF, Occupancy, NeRF) | Continuous field, arbitrary topology | Высочайшее качество, arbitrary resolution [sciencedirect](https://www.sciencedirect.com/science/article/pii/S0262885624004463) | Тяжёлые вычисления, не real-time на мобиле [sciencedirect](https://www.sciencedirect.com/science/article/pii/S0262885624004463) | Проверено |

Ключевой инсайт: SMPL «consistently overestimated key body dimensions due to its reliance on global average parameters», а CLO 3D «tended to underestimate volumes, particularly in anatomically complex regions» — оба проигрывают слоёвому подходу по анатомической точности [проверено]. Это прямой аргумент против чистого SMPL, если цель — «анатомически достоверное тело».

## Слои: скелет-мышцы-жир-кожа

- **ATLAS**: декуплирует внешний shape и внутренний skeleton; 77 joints, 115k vertices, отдельные bases для skeleton и surface; skeletal-only fits ловят height, arm length, finger size; surface shape — body weight, arm width [проверено].
- **MHR (Meta)**: anatomically-inspired parametric full-body model, parametric skeletal model + realistic 3D mesh skinned + body blendshape/pose corrective + facial blendshape; конверсия в SMPL/SMPL-X [проверено].
- **SKEL/BSM**: заменяют SMPL kinematic chain на анатомически точный skeleton с DOF и limits, соответствующими реальной анатомии [проверено].
- **Anny**: scan-free, fully differentiable, semantic phenotype axes (gender, age, height, weight, muscle mass, head fat, pregnancy, limb proportions) — интерпретируемая параметризация вместо PCA [проверено].

## Параметризация по съёмке телефоном

Два режима:

1. **Feed-forward регрессия**: SMPLer-X — real-time оценка pose+shape из monocular RGB; меньшие версии (S, B) real-time, L — на грани [проверено]. Быстро, но грубее.
2. **Оптимизационный фитинг**: SMPLify-X — детект 2D features (лицо, руки, ноги), fit full SMPL-X, pose prior из MoCap, interpenetration penalty, auto gender detection [проверено]. Точнее, но медленнее.[smpl-x.is.tue.mpg](https://smpl-x.is.tue.mpg.de/)
3. **Локальный CPU-вариант**: local-bodyscan — front/back/left/right фото + height → circumferences, body volume, weight, body-fat %, fitted SMPL-X mesh, всё на CPU [проверено]. Это proof-of-concept, что полный пайплайн влезает на девайс.

## Что реально считать на телефоне

- **Feed-forward регрессия SMPL-X**: да, real-time на NPU/GPU [проверено].
- **Локальный CPU-фит**: да, доказано [проверено].
- **Полный SDF/NeRF-фит**: нет, слишком тяжело [проверено].[sciencedirect](https://www.sciencedirect.com/science/article/pii/S0262885624004463)
- **Гауссианы поверх SMPL-X**: да, 30–60 FPS на iPhone 13/14 Pro [проверено] (из предыдущих разборов).
- **Слои (ATLAS/MHR)**: фитинг тяжёлый, но **инференс** (применение готовых параметров) — да, на телефоне [экспертная оценка на базе].

## Числа и ограничения

- SMPL: 10 shape / 72 pose параметров.[inferensys](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/3d-body-mesh-reconstruction-apis/smpl-vs-smpl-x-body-model-fidelity)
- SMPL-X: 165 параметров (24 body + 30 hand×2 + jaw/eye).[inferensys](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/3d-body-mesh-reconstruction-apis/smpl-vs-smpl-x-body-model-fidelity)
- ATLAS: 77 joints, 115k vertices .
- SMPLer-X-S/B: real-time; L — на грани .
- SMPLify-X: >8x speedup над Chumpy.[smpl-x.is.tue.mpg](https://smpl-x.is.tue.mpg.de/)
- local-bodyscan: полный пайплайн на CPU .
- Ограничение: слоёвые модели (ATLAS/MHR) — новее, меньше battle-tested, фитинг тяжелее [экспертная оценка на базе].

## Риски

- **SMPL-переоценка объёмов**: систематический bias, особенно на нестандартных телосложениях [проверено].
- **Слоёвые модели**: меньше зрелость, меньше battle-testing [экспертная оценка].
- **Неявные модели**: не real-time на мобиле [проверено].[sciencedirect](https://www.sciencedirect.com/science/article/pii/S0262885624004463)
- **Фрагментация**: SMPL-X vs ATLAS vs MHR — разные пространства параметров, конверсия возможна (MHR→SMPL/SMPL-X ), но не бесплатна [экспертная оценка].

## Рекомендация для команды

1. **Каркас**: SMPL-X (или ATLAS/MHR, если нужна анатомическая точность) [проверено].[smpl-x.is.tue.mpg](https://smpl-x.is.tue.mpg.de/)
2. **Фитинг**: feed-forward (SMPLer-X) для скорости + опциональный оптимизационный (SMPLify-X) для точности [проверено].[smpl-x.is.tue.mpg](https://smpl-x.is.tue.mpg.de/)
3. **Мягкие ткани**: отдельный слой (гауссианы или нейронный) поверх каркаса [проверено].[sciencedirect](https://www.sciencedirect.com/science/article/pii/S0262885624004463)
4. **На телефоне**: feed-forward регрессия + рендер + анимация; тяжёлый фит — на сервер [проверено].
5. **Анатомическая точность**: если это критично — ATLAS/MHR вместо чистого SMPL [проверено].

[[AO-5ptmwm]]