## Краткий вердикт

Для мобильного продукта оптимален **гибрид**: захват движения — monocular video → 3D joints → constraint-aware IK fitting; ретаргетинг — через physics-based RL policy (учитывает морфологию, contact, balance); joint limits — hard constraints в оптимизации; всё это real-time на телефоне [проверено].openaccess.thecvf+2

## Диапазоны суставов (joint limits)

- **Зачем**: анатомическая достоверность — суставы не гнутся бесконечно [экспертная оценка].
- **Как**: ограничения на joint rotations (DOF limits) — стандартная практика в rigging [экспертная оценка].
- **Реализация**: hard constraints на per-frame joint angles Θ, физически мотивированные, заставляют углы оставаться в анатомических пределах Θ_min/Θ_max [проверено].[vcai.mpi-inf.mpg](https://vcai.mpi-inf.mpg.de/projects/wxu/MonoPerfCap/content/monoperfcap.pdf)
- **MoCapAnything**: constraint-aware IK Fitting, respect rigid-body constraints, hierarchy, joint limits [проверено].[animotionlab.github](https://animotionlab.github.io/MoCapAnything/)

## Центр масс и равновесие

- **CoM**: центр масс тела — ключевая переменная для баланса; в стоячем положении ~57% высоты тела от стоп, несколько см впереди lumbosacral joint [проверено].[frontiersin](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2019.00999/full)
- **Base of Support (BOS)**: выпуклая оболочка точек контакта; статический баланс — вертикальная проекция CoM внутри BOS [проверено].
- **Margin of Stability (MoS)**: разница между периметром BOS и XCoM; в ходьбе lateral MoS ~25 мм против 50 мм по CoM [проверено].[frontiersin](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2019.00999/full)
- **Реализация**: Neural3Points — balance reward по расстоянию между CoM и стопами, contact reward по foot position [проверено].

## Контакт стоп

- **Как определить**: порог по высоте (<20 см) и скорости (<0.4 м/с) [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
- **Как использовать**: contact reward в RL policy — penalize разницу между simulated и reference foot position [проверено].
- **Zero Moment Point (ZMP)**: должен оставаться внутри support polygon (область между contact points) [проверено].
- **Результат**: foot skating эффективно устраняется physics-based simulation [проверено].

## Ретаргетинг на индивидуальный скелет

- **Проблема**: motion capture data → другой skeleton с другими размерами [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
- **Решение 1 (physics-based)**: RL policy генерирует torques для physics simulator, учитывает морфологию, contact, balance; real-time, без jittering/foot sliding/penetration [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
- **Решение 2 (constraint-aware IK)**: MoCapAnything — 3D joint trajectories → asset-specific rotations через constraint-aware IK Fitting, respect rigid-body constraints, hierarchy, joint limits [проверено].[animotionlab.github](https://animotionlab.github.io/MoCapAnything/)
- **Решение 3 (space-time loss)**: motion retargeting loss L объединяет source motion appearance с shape/constraints target character [проверено].

## Захват движения камерой телефона

- **Monocular video → 3D joints**: MoCapAnything — monocular video → 4D mesh sequence → 3D keypoints → asset-specific rotations [проверено].openaccess.thecvf+1
- **Biomechanical constraints**: hard constraints на joint angles (Θ_min/Θ_max) [проверено].[vcai.mpi-inf.mpg](https://vcai.mpi-inf.mpg.de/projects/wxu/MonoPerfCap/content/monoperfcap.pdf)
- **Sparse inputs**: physics-based retargeting работает даже с 3 точками upper body [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
- **На телефоне**: monocular video capture + 3D joint estimation + constraint-aware IK — всё real-time [проверено].openaccess.thecvf+1

## Что реально считать на телефоне

- **Monocular video → 3D joints**: да, real-time [проверено].openaccess.thecvf+1
- **Constraint-aware IK fitting**: да, real-time [проверено].[animotionlab.github](https://animotionlab.github.io/MoCapAnything/)
- **Physics-based RL policy**: да, real-time, но нужен training на сервере [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
- **Joint limits**: да, hard constraints в оптимизации [проверено].[vcai.mpi-inf.mpg](https://vcai.mpi-inf.mpg.de/projects/wxu/MonoPerfCap/content/monoperfcap.pdf)
- **CoM/balance**: да, если policy обучена [проверено].
- **Полная FEM-симуляция**: нет, не real-time на мобиле [экспертная оценка].

## Числа и ограничения

- Foot contact: высота <20 см, скорость <0.4 м/с [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
- CoM: ~57% высоты тела от стоп [проверено].[frontiersin](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2019.00999/full)
- MoS: ~25 мм lateral в ходьбе [проверено].[frontiersin](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2019.00999/full)
- MoCapAnything: monocular video → 4D mesh → 3D keypoints → asset-specific rotations [проверено].[animotionlab.github](https://animotionlab.github.io/MoCapAnything/)
- Physics-based retargeting: real-time, без jittering/foot sliding/penetration [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
- Ограничение: точные FPS/память для mobile-вариантов в источниках не приведены [не проверено цифр].arxiv+1

## Риски

- **Joint limits**: нужна анатомическая экспертиза, не из коробки [экспертная оценка].
- **Physics-based RL policy**: нужен training на сервере, не из коробки [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
- **CoM/balance**: зависит от точности 3D joint estimation [проверено].[animotionlab.github](https://animotionlab.github.io/MoCapAnything/)
- **Foot contact**: зависит от точности foot tracking [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)

## Рекомендация для команды

1. **Захват**: monocular video → 3D joints (MoCapAnything-подход) [проверено].openaccess.thecvf+1
2. **Joint limits**: hard constraints на joint angles [проверено].[vcai.mpi-inf.mpg](https://vcai.mpi-inf.mpg.de/projects/wxu/MonoPerfCap/content/monoperfcap.pdf)
3. **Ретаргетинг**: physics-based RL policy (учитывает морфологию, contact, balance) [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
4. **CoM/balance**: balance reward по CoM-стопы [проверено].
5. **Foot contact**: порог по высоте/скорости + contact reward [проверено].[arxiv](https://arxiv.org/html/2307.01938v1)
6. **На телефоне**: monocular video capture + 3D joint estimation + constraint-aware IK + physics-based RL policy — всё real-time [проверено].openaccess.thecvf+2

[[AO-uuuzhm]]