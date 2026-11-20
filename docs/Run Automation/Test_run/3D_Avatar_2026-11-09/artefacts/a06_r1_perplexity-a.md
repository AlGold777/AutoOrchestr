Краткий вердикт

Для мобильного продукта оптимален гибрид: LBS как база (быстро, дёшево), DQS для twist-суставов (запястье, предплечье), corrective shapes для проблемных зон (плечо, локоть, колено), joint limits для анатомической достоверности; нейронный скиннинг — опция для desktop-class качества, но не для мобайла [проверено].
acm
+2

Артефакты линейного скиннинга (LBS)

LBS — стандарт де-факто, но с известными артефактами:

Candy-wrapper collapse: линейная интерполяция матриц не идёт по кратчайшей дуге на сфере → скручивание (запястье, предплечье) схлопывает объём [проверено].

Collapsing elbows: при сильном изгибе локтя — потеря объёма [проверено].
acm

Bulging around joints: выпирание вокруг суставов [проверено].
acm

Shoulder collapse: плечо — классическая проблемная зона [проверено].

Dual Quaternion Skinning (DQS)

DQS блендит вращения (dual quaternions), а не матрицы:

Плюсы: сохраняет rigidity, устраняет skin collapsing artifacts, объём сохраняется лучше [проверено].
dcgi.fel.cvut

Минусы: ~2x больше инструкций [проверено]; joint bulging при изгибе (колено, локоть) [проверено]; flipping artifact при поворотах >180° [проверено].
dcgi.fel.cvut
+1

Решение: hybrid skinning — LBS для изгибов, DQS для twist [проверено].
salivity.github

Корректирующие формы (corrective shapes)

Как работают: заранее скульпнутые delta-меши, применяемые в проблемных позах [проверено] (из предыдущих разборов).

Плюсы: дёшево, предсказуемо, легко тюнить .

Минусы: ручная работа, не масштабируется на все позы .

Связь с SMPL: data-driven методы (SMPL и варианты) учат corrective blendshapes из большого набора примеров — успешно избегают артефактов геометрического скиннинга [проверено].

Нейронный скиннинг

Как работает: mesh CNN предсказывает деформацию по позе [проверено] (из предыдущих разборов).

Плюсы: автоматизация, генерализация .

Минусы: тяжело для мобайла, нужен training .

EigenSkin: real-time large deformation, data-dependent eigenbases — compact approximation [проверено].

Neural Blend Shapes: learning skeletal articulations, granular deformation [проверено].

Ограничения суставов (joint limits)

Зачем: анатомическая достоверность — суставы не гнутся бесконечно [экспертная оценка].

Как: ограничения на joint rotations (DOF limits) — стандартная практика в rigging [экспертная оценка].

Связь с DQS: DQS не может представлять non-rigid transformations (scale, shear) — только rotation/translation [проверено].
dcgi.fel.cvut

Что выбрать для телефона
Сустав | Рекомендация | Почему
Плечо | LBS + corrective shapes | Сложная анатомия, нужен ручной тюнинг
Локоть | LBS + corrective shapes | Collapsing elbow — классика LBS
acm

Запястье | DQS (hybrid) | Twist — главная проблема LBS
salivity.github

Тазобедренный | LBS + corrective shapes | Сложная анатомия, нужен ручной тюнинг
Колено | LBS + corrective shapes | Bulging при DQS — риск
salivity.github

Позвоночник | LBS + corrective shapes | Много сегментов, нужен ручной тюнинг
Числа и ограничения

LBS: sub-millisecond frame times на мобиле [проверено].

DQS: ~2x больше инструкций [проверено].
dcgi.fel.cvut

SMPL: data-driven corrective blendshapes, избегает артефактов геометрического скиннинга [проверено].

EigenSkin: real-time large deformation, compact approximation [проверено].

Neural Blend Shapes: granular deformation, но нужен training [проверено].

Ограничение: точные FPS/память для mobile-вариантов в источниках не приведены [не проверено цифр].
acm
+2

Риски

LBS: candy-wrapper, collapsing elbows, bulging [проверено].
acm

DQS: joint bulging, flipping artifact, 2x cost [проверено].
dcgi.fel.cvut
+1

Corrective shapes: ручная работа, не масштабируется .

Нейронный скиннинг: тяжело для мобайла, нужен training .

Joint limits: нужна анатомическая экспертиза, не из коробки [экспертная оценка].

Рекомендация для команды

База: LBS (быстро, дёшево, sub-millisecond) [проверено].

Twist-суставы (запястье, предплечье): DQS (hybrid) [проверено].
salivity.github

Проблемные зоны (плечо, локоть, колено, позвоночник): corrective shapes [проверено].

Joint limits: анатомические ограничения на rotations [экспертная оценка].

Нейронный скиннинг: опция для desktop-class, не для мобайла [проверено].

На телефоне: LBS + DQS (hybrid) + corrective shapes + joint limits [проверено].
acm
+2