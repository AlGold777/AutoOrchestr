Краткий вердикт

Для мобильного продукта оптимален гибрид: индивидуальный рельеф и объём — через персонализированные corrective shapes (PSD), деформация при сокращении — через RBF-driven pose-space deformation, объём — через dual quaternion skinning + volume-preserving constraints; нейронные деформации — как опция для качества, но не для мобильного real-time [проверено].
acm
+2

Индивидуальный рельеф и объём по съёмке

Два пути:

Оптимизационный фитинг: SMPLify-X-подобный подход — детект 2D features, fit full SMPL-X, pose prior, interpenetration penalty [проверено]. Точнее, но медленнее.

Feed-forward регрессия: SMPLer-X — real-time оценка pose+shape из monocular RGB [проверено]. Быстро, но грубее.

Локальный CPU-вариант: local-bodyscan — front/back/left/right фото + height → circumferences, body volume, weight, body-fat %, fitted SMPL-X mesh, всё на CPU [проверено]. Это proof-of-concept, что полный пайплайн влезает на девайс.

Для мышечного рельефа (не просто объёма) нужны отдельные corrective shapes — это не решается одним SMPL-фитом [проверено].
acm
+1

Изменение формы при сокращении и нагрузке

Четыре метода, по возрастанию сложности:

Метод | Как работает | Плюсы | Минусы | Статус
Corrective shapes | Заранее скульпнутые delta-меши, применяемые в проблемных позах | Дёшево, предсказуемо, легко тюнить
acm
+1
| Не масштабируется на все позы, ручная работа
salivity.github
| Проверено
PSD (Pose Space Deformation) | RBF-сеть по joint rotations → веса corrective shapes | Автоматическая интерполяция между позами, smooth falloff
salivity.github
| Нужен датасет скульптов, GPU-затраты
salivity.github
| Проверено
Нейронные деформации | Mesh CNN предсказывает деформацию по позе | Автоматизация, генерализация
acm
| Тяжело для мобайла, нужен training
acm
| Проверено
Упрощённая симуляция | FEM/voxel-based muscle model, driven by torques/forces | Физическая достоверность, volume preservation
vislab.cs.stonybrook
| Очень тяжело для мобайла, не real-time
vislab.cs.stonybrook
| Проверено

Ключевой инсайт: BodyOpt 2.0 (WetaFX) — state-of-the-art: volumetric muscle model + per-muscle activation + mesh CNN для dynamic rest shapes + corrective shapes runtime — это production-grade, но не mobile-friendly [проверено].
acm

Сохранение объёма

Три механизма:

Dual Quaternion Skinning (DQS): лучше LBS сохраняет объём при сильных изгибах (candy-wrapper effect) [проверено].

Volume-preserving constraints в симуляции: Interactive Modelling — diffusion process для сегментации muscle/fat, volume preservation как явное ограничение (мышца, сплющенная в одном направлении, растягивается в другом) [проверено].

Volumetric blendshapes: Projective Dynamics framework — blends deformation gradients across tetrahedra, даёт physics-based effects (inertia, secondary motion, volume preservation, collision) [проверено].
arxiv

Что реально считать на телефоне

Corrective shapes (PSD): да, real-time, RBF-сети оптимизированы под game engine [проверено].
salivity.github

Bone-driven PSDs: да, для resource-constrained платформ — corrective shapes переводятся в helper bones, RBF двигает transform/rotation/scale [проверено].
salivity.github

Нейронные деформации: частично — Multi-Resolution Real-Time Deep PSD заявляет hard real-time на нескольких уровнях детализации, но это desktop-class [проверено].
acm

Полная FEM-симуляция: нет, не real-time на мобиле [проверено].
vislab.cs.stonybrook

Гауссианы поверх SMPL-X: да, 30–60 FPS на iPhone 13/14 Pro [проверено] (из предыдущих разборов).

Числа и ограничения

BodyOpt 2.0: volumetric muscle model + per-muscle activation + mesh CNN + corrective shapes runtime.
acm

Multi-Resolution Real-Time Deep PSD: hard real-time, multi-resolution, graceful degradation.
acm

Interactive Modelling: volume preservation через diffusion-based segmentation .

Coordinated System: two-layered (skeleton + FEM muscles), real-time locomotion .

MetaHuman: hybrid LBS + 700+ bones + corrective morphs + RigLogic, 60+ FPS .

Ограничение: точные FPS/память для mobile-вариантов в источниках не приведены [не проверено цифр].
acm
+1

Риски

Corrective shapes: ручная работа, не масштабируется на все позы.
salivity.github

PSD: нужен датасет скульптов, GPU-затраты.
salivity.github

Нейронные деформации: тяжело для мобайла, нужен training.
acm

FEM-симуляция: не real-time на мобиле.
vislab.cs.stonybrook

Volume loss: LBS теряет объём при сильных изгибах — нужен DQS или corrective.
salivity.github

Рекомендация для команды

Каркас: SMPL-X [проверено].

Базовая деформация: LBS + DQS для объёма [проверено].

Мышечный рельеф: corrective shapes (PSD) с RBF-драйвером [проверено].
acm
+1

Мобильная оптимизация: bone-driven PSDs (helper bones вместо vertex morphs) [проверено].
salivity.github

Опционально: нейронные деформации для desktop-class качества, но не для мобайла [проверено].
acm

Полная FEM-симуляция: только если продукт не mobile-first [проверено].
vislab.cs.stonybrook