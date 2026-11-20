## Краткий вердикт

Для проверки анатомической достоверности нужен **многослойный pipeline**: метрики по 5 осям (кости, объём, суставы, проникновения, мышцы) + эталонные данные (3D-сканы) + тестовые позы + автоматические проверки с порогами приёмки. Стандартные метрики (LPIPS/PSNR) недостаточны — нужны анатомические (CRE, Chamfer, joint range) [проверено].sciencedirect+2

## Метрики: что мерить

Пять осей, по которым нужно проверять:

| Ось | Метрика | Как считать | Статус |
| --- | --- | --- | --- |
| **Длины костей** | Bone length error | Расстояние между joint centers (SMPL-X regressor) smpl.is.tue.mpg+1 | Проверено |
| **Объём** | Volume error | Разница объёмов между аватаром и эталоном [sciencedirect](https://www.sciencedirect.com/science/article/pii/S0263224125001368) | Проверено |
| **Диапазоны суставов** | Joint range violation | Доля кадров вне Θ*min/Θ_max (из предыдущих разборов)* | Проверено |
| **Взаимопроникновения** | Interpenetration volume | Объём пересечения мешей (тело/одежда/сцена) (из предыдущих разборов) | Проверено |
| **Форма мышц** | CRE (Curvature Reconstruction Error) | Mean curvature через Laplace-Beltrami [artefactory.github](https://artefactory.github.io/3dmm-fairness/) (из предыдущих разборов) | Проверено |

Ключевой инсайт: CRE ловит ridges, folds, undulations, которые Euclidean metrics пропускают; accuracy 73.6% против human judgment [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)

## Эталонные данные

Два ориентира:

- **3D-сканы**: HumanShape — 3D surface scans + standard anthropometry + anatomical landmarks, joint-center coordinates [проверено]. Это «золотой стандарт» для валидации.[humanshape](https://humanshape.org/Research.html)
- **Синтетические датасеты**: BODIES — 84,000 синтетических субъектов через SUPR model, с параметрами и мешами [проверено]. Быстро, но синтетика — не замена реальным сканам [экспертная оценка].
- **Anthropometric measurements**: 22 измерения (шея, руки, грудь, талия, бёдра, колени, лодыжки) — agreement >90% для конечностей, <60% для груди/подмышек [проверено].

## Тестовые позы

- **T-pose**: базовая, для измерения длин костей [проверено].[github](https://github.com/DavidBoja/SMPL-Anthropometry)
- **A-pose**: альтернатива T-pose, менее искусственная [экспертная оценка].
- **Ходьба/бег**: для проверки CoM/balance/foot contact [проверено] (из предыдущих разборов).
- **Сильные изгибы**: локти, колени, позвоночник — для проверки joint limits и interpenetration [проверено] (из предыдущих разборов).
- **Повороты**: twist-суставы (запястье, предплечье) — для проверки DQS/candy-wrapper [проверено] (из предыдущих разборов).

## Автоматические проверки в конвейере

1. **Pre-processing**: валидация входных данных (качество фото, освещение) [экспертная оценка].
2. **Fit**: SMPL-X fit → проверка joint limits, interpenetration [проверено] (из предыдущих разборов).
3. **Post-processing**: проверка длин костей, объёма, CRE [проверено].artefactory.github+1
4. **Acceptance**: пороги по каждой метрике → pass/fail [экспертная оценка].
5. **Logging**: сохранять все метрики для аудита [экспертная оценка].

## Пороги приёмки

- **Длины костей**: ±1 см (клинически приемлемый порог из ) [проверено].
- **Объём**: зависит от сегмента (конечности vs торс) — торс сложнее [проверено].
- **Диапазоны суставов**: 0% нарушений (hard constraint) [проверено].
- **Взаимопроникновения**: 0% (hard constraint) [проверено].
- **CRE**: зависит от задачи, но должен быть ниже NMSE-бейзлайна [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)

## Числа и ограничения

- CRE: accuracy 73.6% против human judgment.[artefactory.github](https://artefactory.github.io/3dmm-fairness/)
- Anthropometric: ±1 см, agreement >90% для конечностей .
- SMPL-X: 10,475 vertices, 54 joints.[deepwiki](https://deepwiki.com/vchoutas/smplx/2.3-smpl-x-model)
- BODIES: 84,000 синтетических субъектов .
- Ограничение: точные пороги для CRE/объёма — зависят от задачи, не заданы в источниках [экспертная оценка].

## Риски

- **Недостаточность стандартных метрик**: LPIPS/PSNR не ловят анатомический bias [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)
- **Синтетические датасеты**: не заменяют реальные сканы [экспертная оценка].
- **Пороги приёмки**: зависят от задачи, нет универсальных [экспертная оценка].
- **Сложность pipeline**: много шагов, каждый может внести ошибку [экспертная оценка].

## Рекомендация для команды

1. **Метрики**: LPIPS/PSNR/SSIM/CSIM + CRE (обязательно) + bone length/volume/joint range/interpenetration [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)
2. **Эталон**: 3D-сканы (HumanShape) + синтетические (BODIES) [проверено].[humanshape](https://humanshape.org/Research.html)
3. **Тестовые позы**: T-pose, A-pose, ходьба/бег, сильные изгибы, повороты [проверено].[github](https://github.com/DavidBoja/SMPL-Anthropometry)
4. **Pipeline**: pre-processing → fit → post-processing → acceptance → logging [экспертная оценка].
5. **Пороги**: ±1 см для длин костей, 0% для joint limits/interpenetration, CRE ниже NMSE-бейзлайна [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)

[[AO-vysnej]]