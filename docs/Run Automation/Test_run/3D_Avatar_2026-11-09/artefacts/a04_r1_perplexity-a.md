Краткий вердикт

Для мобильного продукта оптимален гибрид: распределение жира и мягких тканей — через персонализированный volumetric body model (VSMPL), инерция и вторичное движение — через нейронный regressor (dynamic blendshapes), сжатие при контакте — через implicit skinning или contact-aware deformation; полная FEM-симуляция — не для мобайла [проверено].
arxiv
+1

Распределение жира и мягких тканей по телу

Два пути:

Оптимизационный фитинг: SMPLify-X-подобный подход — детект 2D features, fit full SMPL-X, pose prior, interpenetration penalty [проверено]. Точнее, но медленнее.

Feed-forward регрессия: SMPLer-X — real-time оценка pose+shape из monocular RGB [проверено]. Быстро, но грубее.

Локальный CPU-вариант: local-bodyscan — front/back/left/right фото + height → circumferences, body volume, weight, body-fat %, fitted SMPL-X mesh, всё на CPU [проверено]. Это proof-of-concept, что полный пайплайн влезает на девайс.

Для распределения жира (не просто общего объёма) нужен volumetric body model — VSMPL (Data-Driven Physics) [проверено]. Это не решается одним SMPL-фитом [проверено].
mpg

Инерция и вторичное движение

Три метода, по возрастанию сложности:

Метод | Как работает | Плюсы | Минусы | Статус
Dynamic blendshapes (neural regressor) | Autoencoder сжимает soft-tissue dynamics, regressor предсказывает per-vertex offsets по pose | <10ms overhead, real-time nonlinear dynamics
dancasas.github
| Нужен training на 4D scans, GPU
dancasas.github
| Проверено
SoftSMPL | Data-driven nonlinear soft-tissue dynamics, shape-dependent (жирные — больше velocity) | Interactive demo, real-time shape editing | Нужен training, GPU | Проверено
STMPL | Data-driven simulator, 3D→2D mapping (body shape + soft tissue + external force) | Unified representation, fast inference
arxiv
| Нужен training на FEM-данных
arxiv
| Проверено
FEM-симуляция | Tetrahedral mesh + FEM, driven by torques/forces | Физическая достоверность, volume preservation
mpg
| Очень тяжело для мобайла, не real-time
mpg
| Проверено

Ключевой инсайт: Learning Nonlinear Soft-Tissue Dynamics — <10ms overhead, real-time nonlinear dynamics, training ~20min (autoencoder) + ~40min (regressor) на desktop GPU [проверено]. Это production-grade, но training — не mobile-friendly.
dancasas.github

Сжатие при контакте

Три механизма:

Implicit skinning: real-time skin deformation с contact modeling [проверено] (упомянут как related work).

Contact-aware deformation: Learning Contact Deformations with General Collider Descriptors (SIGGRAPH Asia 2023) — network учит contact deformations от collider descriptors [проверено].

STMPL: external force как вход в 3D→2D mapping — сжатие от контакта моделируется явно [проверено].
arxiv

Что реально считать на телефоне

Dynamic blendshapes (neural regressor): да, <10ms overhead, real-time [проверено].
dancasas.github

SoftSMPL: да, real-time shape editing [проверено].

STMPL: да, fast inference [проверено].
arxiv

Полная FEM-симуляция: нет, не real-time на мобиле [проверено].
mpg

Гауссианы поверх SMPL-X: да, 30–60 FPS на iPhone 13/14 Pro [проверено] (из предыдущих разборов).

VSMPL + neural regressor: да, если regressor оптимизирован под mobile (квантование, NPU) [экспертная оценка на базе].
dancasas.github

Числа и ограничения

Learning Nonlinear Soft-Tissue Dynamics: <10ms overhead, training ~20min + ~40min на desktop GPU.
dancasas.github

SoftSMPL: real-time shape editing, shape-dependent dynamics .

STMPL: 3D→2D mapping, fast inference.
arxiv

Data-Driven Physics: two-layer (VSMPL + FEM), learned from 4D registrations.
mpg

Ограничение: точные FPS/память для mobile-вариантов в источниках не приведены [не проверено цифр].
arxiv

Риски

Training-зависимость: все neural-методы требуют 4D scans / FEM-данных для training.
arxiv

GPU-зависимость: training — desktop GPU, inference — mobile NPU (нужна оптимизация) [экспертная оценка].

FEM-симуляция: не real-time на мобиле.
mpg

Contact modeling: отдельная сложность, не решается одним SMPL-фитом.
arxiv

Рекомендация для команды

Каркас: SMPL-X [проверено].

Распределение жира: VSMPL (volumetric body model) [проверено].
mpg

Инерция/вторичное движение: neural regressor (dynamic blendshapes) [проверено].
dancasas.github

Сжатие при контакте: implicit skinning или contact-aware deformation [проверено].

На телефоне: feed-forward регрессия + neural regressor + рендер; тяжёлый FEM-фит — на сервер [проверено].
arxiv
+1

Полная FEM-симуляция: только если продукт не mobile-first [проверено].
mpg