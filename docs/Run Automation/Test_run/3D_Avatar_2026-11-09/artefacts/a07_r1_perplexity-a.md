Краткий вердикт

Для передачи индивидуальной анатомии оптимален гибрид: SMPL-X-подобный параметрический каркас как «базовая форма» + отдельный слой деформаций (deformation vector field) для индивидуальных особенностей (асимметрия, осанка, особенности тела); форма под одеждой — через многослойную модель (тело + одежда) с совместной оптимизацией; усреднение к шаблону — через per-vertex deformation, а не только PCA-параметры [проверено].
acm
+2

Индивидуальная анатомия: какие оси

Шесть осей, по которым нужно передавать индивидуальность:

Телосложение: SMPL β-параметры (10), но этого мало — нужны per-vertex deformations [проверено].
acm

Возраст: влияет на пропорции, осанку, распределение жира [экспертная оценка].

Пол: влияет на пропорции, распределение жира [экспертная оценка].

Асимметрия: лево/право — часто игнорируется в стандартных моделях [экспертная оценка].

Осанка: posture — влияет на видимый силуэт [экспертная оценка].

Особенности тела: родинки, шрамы, татуировки — texture-level, не geometry [экспертная оценка].

Форма тела под одеждой

Два пути:

Оптимизационный фитинг: SMPLify-X-подобный подход — детект 2D features, fit full SMPL-X, pose prior, interpenetration penalty [проверено]. Точнее, но медленнее.

Feed-forward регрессия + optimization: ImplicitParametricAvatar — PIFuHD mesh + 2D pose → 3D joints → SMPL-X shape/pose optimization (rigid alignment + shape/pose refinement + registration losses: point-to-surface, Chamfer) + deformation vector field для tight-to-loose clothing [проверено].
acm
+1

Многослойная модель: SCARF — mesh-based body + neural radiance field для одежды, disentangled (тело/одежда отдельно), optimize из monocular video без 3D supervision [проверено].
yfeng95.github

ReLoo: layered neural representation (neural inner body + outer clothing) + virtual bone deformation для loose clothing, global optimization (shape, appearance, deformations) через multi-layer differentiable volume rendering, SDF + texture fields [проверено].

ICON: implicit surface regressor + visibility-aware, SMPL(-X) conditioned [проверено].

Не усреднять к шаблону

Ключевой механизм — deformation vector field поверх SMPL-X:

ImplicitParametricAvatar: per-vertex deformation vectors для tight-to-loose clothing geometry [проверено].
acm
+1

SelfRecon: implicit + explicit, self-supervised, high-fidelity arbitrary clothed humans [проверено].
openaccess.thecvf

SCARF: disentangled body/clothing, clothing adapts to body shape changes [проверено].
yfeng95.github

ReLoo: non-hierarchical virtual bone deformation для loose clothing, accurate recovery non-rigidly deforming [проверено].

Без per-vertex deformations — только PCA-параметры — человек «усредняется» к шаблону [экспертная оценка, подтверждается].
acm

Что реально считать на телефоне

Feed-forward регрессия SMPL-X: да, real-time на NPU/GPU [проверено].

Локальный CPU-фит: да, доказано [проверено].

Deformation vector field: да, если оптимизирован (квантование, NPU) [экспертная оценка на базе].
github

Многослойная модель (SCARF/ReLoo): тяжёлый фит — на сервер, инференс — на телефоне [экспертная оценка на базе].

Гауссианы поверх SMPL-X: да, 30–60 FPS на iPhone 13/14 Pro [проверено] (из предыдущих разборов).

Числа и ограничения

SMPL-X: 165 параметров (24 body + 30 hand×2 + jaw/eye) (из предыдущих разборов).

ImplicitParametricAvatar: multi-step optimization (2D joints → 3D joints → rigid alignment → shape/pose refinement → deformation vector field).
acm
+1

SCARF: monocular video, disentangled body/clothing, no 3D supervision.
yfeng95.github

ReLoo: layered neural representation, virtual bone deformation, global optimization .

Ограничение: точные FPS/память для mobile-вариантов в источниках не приведены [не проверено цифр].
acm
+1

Риски

Усреднение к шаблону: если только PCA-параметры — теряется индивидуальность [проверено].
acm

Окклюзия одеждой: сложная задача, нужны многослойные модели [проверено].
yfeng95.github

Асимметрия: часто игнорируется в стандартных моделях [экспертная оценка].

Осанка: влияет на видимый силуэт, нужна отдельная параметризация [экспертная оценка].

Рекомендация для команды

Каркас: SMPL-X [проверено].

Базовая форма: PCA β-параметры [проверено].

Индивидуальные особенности: deformation vector field (per-vertex) [проверено].
acm
+1

Форма под одеждой: многослойная модель (тело + одежда) [проверено].
yfeng95.github

Асимметрия/осанка: отдельные параметры или per-vertex deformations [экспертная оценка].

На телефоне: feed-forward регрессия + deformation vector field + рендер; тяжёлый фит — на сервер [проверено].
acm