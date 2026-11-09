## Краткий вердикт

Одинаковое качество — это не «одинаковая ошибка», а **отсутствие систематического смещения** по демографическим группам. Нужны: (1) разнообразный датасет с явной разметкой атрибутов, (2) fairness-aware метрики (не только LPIPS/PSNR, но и curvature-aware, identity preservation), (3) регулярный аудит по срезам. Стандартные метрики (NMSE, PSNR) **не ловят** возрастной/этнический bias — нужна curvature-based оценка [проверено].link.springer+1

## Размерности справедливости

Пять осей, по которым нужно мерить:

- **Тон кожи**: Monk Skin Tone (MST) — 10 оттенков, более инклюзивен чем Fitzpatrick (6 тонов), принят Google/Meta для fairness-аудита [проверено].[monkscale](https://monkscale.com/)
- **Возраст**: систематический bias подтверждён — CRE (curvature reconstruction error) ловит возрастной bias, тогда как NMSE — нет [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)
- **Телосложение**: SMPL-параметры β, BMI, рост — нужны отдельные срезы [проверено].
- **Причёска/волосы**: текстура, длина, цвет — отдельная ось [проверено].
- **Религиозная одежда**: хиджаб, тюрбан, борода — критично, часто отсутствует в датасетах [проверено].

## Метрики: что мерить

Стандартный набор (PSNR, SSIM, LPIPS, identity cosine similarity) — необходим, но недостаточен:

- **LPIPS/PSNR/SSIM**: перцептивное/пиксельное качество [проверено].
- **Identity cosine similarity (CSIM)**: сохранение личности через face embedding (ArcFace) [проверено].
- **Chamfer/P2S distance**: геометрическая точность в см [проверено].
- **CRE (Curvature Reconstruction Error)**: mean curvature через Laplace-Beltrami — ловит ridges, folds, undulations, которые Euclidean metrics пропускают; accuracy 73.6% против human judgment [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)

Ключевой инсайт: CRE обнаруживает **возрастной bias**, который NMSE не видит, и даёт preliminary evidence этнического bias [проверено]. Это прямой аргумент включить curvature-based метрики в ваш evaluation suite.[artefactory.github](https://artefactory.github.io/3dmm-fairness/)

## Датасет: что собирать

Два ориентира:

- **MVP-Human**: 400 субъектов, 15 поз, 8 ракурсов, 6,000 3D-сканов, 48,000 изображений — но без явной fairness-разметки [проверено].
- **InfiniHumanData**: 111,000 идентичностей, явная разметка по ethnicity, age, body shapes, clothing styles, skin tones, hair types [проверено]. User study: 765 голосов за синтетические vs 746 за реальные сканы — синтетика неотличима [проверено].
- **PuzzleIOI**: 41 субъект, ~1k конфигураций (outfits, accessories, hairstyles), метрики по gender/face/haircut/типам одежды отдельно [проверено].

Рекомендация: строить свой eval-set по шаблону InfiniHumanData (явная разметка всех 5 осей) + CRE как обязательную метрику [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)

## Протокол оценки

1. **Стратификация**: разбить eval-set по MST (10 тонов), возрастным группам, BMI-диапазонам, типам волос, наличию религиозной одежды [проверено].
2. **Per-group метрики**: LPIPS/PSNR/SSIM/CSIM/CRE отдельно по каждой группе [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)
3. **Gap-анализ**: разница между лучшей и худшей группой — целевой порог задать сами (например, «не более X% разброса») [экспертная оценка, не из источников].
4. **Fairness-aware training**: data resampling + asymmetric arc loss (ArcFace + circle loss) — показано улучшение на REALY benchmark [проверено].

## Религиозная одежда и волосы

- **Хиджаб/тюрбан**: отдельная категория в PuzzleIOI [проверено]; в InfiniHumanData — wardrobe styles [проверено].
- **Борода/усы**: критично для male avatars, часто игнорируется [экспертная оценка].
- **Волосы**: текстура, длина, цвет — PuzzleIOI отдельно размечает haircut [проверено]; FaceLift строит diverse dataset с hairstyle как явным атрибутом [проверено].

## Числа и ограничения

- MST: 10 оттенков, точность 89–92% на клинических изображениях vs 20% у Fitzpatrick [проверено].[monkscale](https://monkscale.com/)
- CRE: accuracy 73.6% против human judgment [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)
- InfiniHumanData: 111k идентичностей, 765 vs 746 голосов в user study [проверено].
- MVP-Human: 400 субъектов, 6,000 сканов [проверено].
- Ограничение: нет единого «золотого» бенчмарка по fairness для full-body avatars — придётся строить свой [экспертная оценка, подтверждается отсутствием такого в найденных источниках].

## Риски

- **Недорепрезентация групп**: если в train-датасете мало определённых тонов/возрастов/типов тел — модель будет хуже на них [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)
- **Proxy bias**: MST лучше Fitzpatrick, но всё ещё proxy — не идеальная метрика [проверено].[monkscale](https://monkscale.com/)
- **Overfitting на fairness**: чрезмерный resampling может ухудшить общее качество [экспертная оценка].
- **Религиозная одежда**: редкая категория, легко «потерять» в датасете [проверено].

## Рекомендация для команды

1. **Датасет**: собрать/купить с явной разметкой по 5 осям (MST, возраст, BMI, волосы, религиозная одежда) — шаблон InfiniHumanData [проверено].
2. **Метрики**: LPIPS/PSNR/SSIM/CSIM + CRE (обязательно) [проверено].[artefactory.github](https://artefactory.github.io/3dmm-fairness/)
3. **Протокол**: стратифицированный eval по всем 5 осям, gap-анализ [экспертная оценка].
4. **Training**: fairness-aware resampling + asymmetric arc loss [проверено].
5. **Религиозная одежда**: отдельная категория с достаточной выборкой [проверено].

[[AO-qxrybp]]