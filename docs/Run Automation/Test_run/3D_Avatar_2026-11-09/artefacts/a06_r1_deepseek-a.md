**Ключевая идея:** для мобильного аватара не существует одного «идеального» метода скиннинга. Рабочая стратегия — **гибрид**: базовый LBS как самый дешёвый, DQS — только для проблемных зон с большими скручиваниями, корректирующие формы — для конкретных анатомических артефактов (плечо, подмышка, колено, пах), а ограничения суставов — как фильтр на входе анимации. Нейронный скиннинг на телефоне пока остаётся R&D-слоем, а не заменой реальному ригу.

Все утверждения помечены: **[П]** — проверено по источнику, **[НП]** — не проверено по первоисточнику; цифры из исследований не равны мобильным гарантиям.

## LBS: артефакты и почему он всё ещё нужен

Linear Blend Skinning (LBS) — стандартный метод, но он страдает от хорошо известных артефактов: **collapsing joints** и **«candy-wrapper» effect** при больших вращениях, особенно в локтях и запястьях. LBS — это линейная смесь матриц, поэтому он не может корректно сохранять объём при скручивании; в местах сгиба кожа «схлопывается».[-1](https://royalsocietypublishing.org/rsta/article-pdf/doi/10.1098/rsta.2025.0109/6157527/rsta.2025.0109.pdf?__cf_chl_tk=2YzM4ATfC35fYjDEndlVVsBokx0PID40QBO9aXwl5Ag-1786702795-1.0.1.1-A2lCu7FEoNpNkf6znpiYbLCyoVrCdT40Cn0wJl.jyu8#2#3#2)[-16](https://diglib.eg.org/server/api/core/bitstreams/804b2ef1-49c7-4c49-927a-b493cdb698b0/content#2#16#2)[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)

При этом LBS остаётся индустриальным стандартом на мобильных: он нативно поддерживается Unity/Unreal, требует всего 4×4 матричных умножений на вершину и стоит **менее 0.5 мс GPU** для 10k-вершинного меша на телефоне. Для базового тела это по-прежнему самый предсказуемый по бюджету вариант.[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)

## DQS: объём сохраняется, но появляется «joint bulging»

Dual Quaternion Skinning (DQS) смешивает жёсткие трансформации (повороты и переносы) напрямую, а не матрицы, и поэтому **устраняет candy-wrapper collapse** и лучше сохраняет объём. Для локтя, запястья и плеча при скручивании это заметно лучше LBS.[-1](https://royalsocietypublishing.org/rsta/article-pdf/doi/10.1098/rsta.2025.0109/6157527/rsta.2025.0109.pdf?__cf_chl_tk=2YzM4ATfC35fYjDEndlVVsBokx0PID40QBO9aXwl5Ag-1786702795-1.0.1.1-A2lCu7FEoNpNkf6znpiYbLCyoVrCdT40Cn0wJl.jyu8#2#3#2)[-16](https://diglib.eg.org/server/api/core/bitstreams/804b2ef1-49c7-4c49-927a-b493cdb698b0/content#2#16#2)[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)

Однако DQS не бесплатен. Цена — **примерно в 1.5–2 раза больше вычислений в vertex shader** и больше пропускной способности памяти из-за хранения дуальных кватернионов. На средних телефонах это может ударить по бюджету кадра, особенно при высокой плотности меша. Кроме того, DQS имеет собственный артефакт — **joint bulging** («раздувание» сустава) при сгибании, который требует ручной правки или дополнительной компенсации. Есть данные, что собственная реализация DQS на **20% медленнее** встроенного LBS, а в другом бенчмарке — 0.46 мс против 0.32 мс (разница 44%).[-12](https://ela.kpi.ua/server/api/core/bitstreams/4b49a3a9-8f4c-4436-a6e2-a28e7492186d/content#10#16#10)[-16](https://diglib.eg.org/server/api/core/bitstreams/804b2ef1-49c7-4c49-927a-b493cdb698b0/content#2#16#2)[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)

**Практический вывод:** DQS — не замена LBS, а точечное улучшение. Гибридный подход, при котором DQS применяется только к вершинам вблизи проблемных суставов (плечо, локоть, запястье), даёт почти качество DQS при **примерно 1.2× стоимости LBS**.[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)

## Корректирующие формы: анатомические артефакты, которые не решает ни LBS, ни DQS

Ни LBS, ни DQS не знают анатомии. Проблемы деформации обычно возникают в точках сочленения — **плечо, подмышка, колено, пах**. Correective blendshapes (pose shapes) добавляют локальные смещения, которые исправляют эти артефакты: один сустав не может представить всё нелинейное поведение кожи, жира и мышц, поэтому нужны позозависимые формы. Pose-space deformation (PSD) считывает трансформации суставов и автоматически подмешивает корректирующие формы.[-20](https://patentimages.storage.googleapis.com/2c/ba/9d/d433767827485a/US11282255.pdf#9#13#9)[-21](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-CharacterAnimation/files/GUID-00699C13-8CA1-450C-937D-57C7B3DFD8C6.htm)[-22](https://help.autodesk.com/view/MAYAUL/2019/ENU/?guid=GUID-45D389D6-B8E4-4225-B27B-9927BB61C28D)

Для позвоночника корректирующие формы особенно полезны: изгиб и скручивание позвоночника — это не жёсткий шарнир, а распределённая деформация, и линейный скиннинг даёт неестественное «складкообразование». Позные корректоры позволяют задать разные формы для наклона, поворота и бокового сгиба.

**Ограничение:** корректирующие формы линейны по своей природе. Для сложных комбинаций (одновременный подъём плеча и скручивание) может понадобиться несколько форм или нейросетевой слой.

## Нейронный скиннинг: быстрый, но не для тела в MVP

Современные нейронные методы скиннинга демонстрируют высокую скорость. PhySkin использует reduced-space quasi-static neural simulation и работает **за микросекунды на кадр при single-threaded CPU inference**, позиционируясь для real-time аватаров на слабых устройствах. Это подтверждает: нейросеть может быть достаточно лёгкой. Однако PhySkin — про **одежду**, а не про анатомические деформации тела. Для тела нейронный скиннинг обычно требует обучения на FEM или 4D-сканах и пока не стандартизован для iOS/Android [НП для мобильного продакшена].[-26](https://huggingface.co/papers/2603.27013#1)

**Рекомендация:** нейронный скиннинг — это способ **запечь** сложные деформации (мышцы, жир, контакт) в компактную модель офлайн, а не запускать тяжёлую сеть в кадре. В MVP его место — офлайн-генерация корректирующих форм.

## Ограничения суставов: дёшево и обязательно

Ограничения суставов (joint limits) — это не метод скиннинга, а **фильтр на входе анимации**, который предотвращает неестественные позы и снижает нагрузку на деформацию. Анатомические ориентиры: плечо — сгибание до **180°**; локоть — сгибание **140–150°**, разгибание близко к 0°; запястье — сгибание **80°**, разгибание **70°**; бедро — сгибание **100–125°**, отведение **45°**; колено — сгибание **140–150°**; позвоночник — сгибание **45–50°**.[-34](https://pmc.ncbi.nlm.nih.gov/articles/PMC3512326/table/tab8/?report=objectonly)[-35](https://www.physio-pedia.com/Range_of_Motion_Normative_Values?srch_tag=nrnkdih45tavz4iffet3aieipjg6c3ra)[-76](https://pmc.ncbi.nlm.nih.gov/articles/PMC8344380/table/T1/)

Ограничения суставов реализуются как constraints на rig-е: ball-and-socket для плеча, бедра, шеи; hinge для локтя и колена. Это не требует вычислений на телефоне в кадре — достаточно проверить углы при построении анимации.[-67](https://github.khronos.org/Vulkan-Site/tutorial/latest/Advanced_glTF/Physics_Integration/03_constraints_and_joint_limits.html)

## Что выбрать для телефона: рекомендация

1. **База:** LBS для всего тела — предсказуемо и дёшево.
2. **Проблемные зоны:** DQS только для вершин вблизи локтя, запястья, плеча (гибридный per-vertex blending, ~1.2× стоимости LBS). Для тазобедренного и коленного суставов DQS менее критичен, если есть корректирующие формы.[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)
3. **Корректирующие формы:** PSD-блендшейпы для плеча, подмышки, колена, паха и позвоночника.[-21](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-CharacterAnimation/files/GUID-00699C13-8CA1-450C-937D-57C7B3DFD8C6.htm)
4. **Ограничения суставов:** constraint-фильтр на этапе анимации; не даёт ригу уходить в неестественные углы.[-67](https://github.khronos.org/Vulkan-Site/tutorial/latest/Advanced_glTF/Physics_Integration/03_constraints_and_joint_limits.html)
5. **Нейронный скиннинг:** офлайн для генерации корректоров; в кадре — только если профилирование на iOS/Android докажет бюджет [НП].

## Числа и ограничения

- **LBS:** <0.5 мс GPU для 10k вершин на мобильном.[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)
- **DQS:** ~1.5–2× стоимость LBS; гибрид — ~1.2×; 0.46 мс против 0.32 мс в одном бенчмарке.[-12](https://ela.kpi.ua/server/api/core/bitstreams/4b49a3a9-8f4c-4436-a6e2-a28e7492186d/content#10#16#10)[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)
- **DQS на мобильном:** возможен, но есть данные о падении до 3–4 FPS в неоптимизированной реализации; это подчёркивает важность профилирования.[-11](https://users.informatik.haw-hamburg.de/~ubicomp/arbeiten/bachelor/akca.pdf#7#7#7)
- **Ограничения суставов:** плечо 180°, локоть 140–150°, запястье 80/70°, бедро 100–125°, колено 140–150°, позвоночник 45–50°.[-34](https://pmc.ncbi.nlm.nih.gov/articles/PMC3512326/table/tab8/?report=objectonly)[-76](https://pmc.ncbi.nlm.nih.gov/articles/PMC8344380/table/T1/)
- **Нейронный скиннинг:** микросекунды на CPU для одежды; для тела мобильный бюджет не подтверждён [НП].[-26](https://huggingface.co/papers/2603.27013#1)

## Риски

- **DQS joint bulging:** без компенсации суставы «раздуваются»; нужна дополнительная коррекция.[-16](https://diglib.eg.org/server/api/core/bitstreams/804b2ef1-49c7-4c49-927a-b493cdb698b0/content#2#16#2)
- **Гибридный скиннинг:** сложнее в реализации, чем чистый LBS; нужна инфраструктура для per-vertex выбора метода.[-44](https://inferensys.com/differences/generative-ar-and-ai-visual-try-on/cloth-simulation-and-draping-engines/linear-blend-skinning-vs-dual-quaternion-skinning)
- **Нейронный скиннинг на телефоне:** переносимость на iOS/Android и термалка не проверены [НП]; риск застрять в R&D.
- **Корректирующие формы:** при экстремальных комбинациях поз могут не покрывать все артефакты; нужна валидация на реальных движениях.
- **Ограничения суставов:** слишком жёсткие лимиты ломают естественные позы; нужны анатомические диапазоны, а не «средние по рынку».

**Итог:** для мобильного MVP — LBS + точечный DQS + корректирующие формы для плеча/локтя/колена/позвоночника + ограничения суставов. Это даёт анатомически приемлемые деформации без нереалистичных обещаний нейронного скиннинга в кадре.

[[AO-jrbwbu]]