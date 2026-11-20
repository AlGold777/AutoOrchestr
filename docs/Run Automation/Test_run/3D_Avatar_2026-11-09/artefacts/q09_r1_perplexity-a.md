## Краткий вердикт

Для мобильного аватара — **двойной формат**: внутренний «мастер» в PLY/SPZ (гауссианы) для фотореализма + экспортный **VRM (glTF 2.0)** для интероперабельности и лёгкой передачи. USD — только если нужен сложный пайплайн с DCC-интеграцией; для чисто мобильного продукта это оверхед [проверено].developer.playcanvas+2

## Форматы: сравнение

| Формат | Роль | Плюсы | Минусы | Статус |
| --- | --- | --- | --- | --- |
| **PLY (3DGS raw)** | Мастер-хранение гауссиан | Lossless, универсальный, стандарт де-факто [developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/) | Огромный размер (до GB, 236 байт/сплат) developer.playcanvas+1 | Проверено |
| **SPZ (Niantic)** | Сжатая передача гауссиан | ~10x меньше PLY, почти без визуальной потери, MIT-лицензия, ZSTD-компрессия | Lossy, не для редактирования | Проверено |
| **SOG (PlayCanvas)** | Web/mobile delivery | 15–20x меньше PLY, LOD-стриминг по чанкам, оптимизирован под CDN [developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/) | Lossy, view-dependent detail [developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/) | Проверено |
| **glTF/GLB** | Универсальный обмен | Стандарт Khronos, PBR, Draco/Meshopt компрессия, поддержка всеми движками | Нет humanoid-семантики по умолчанию [news.viverse](https://news.viverse.com/post/vrm-models-explained) | Проверено |
| **VRM** | Avatar-специализация | Строится на glTF 2.0, встроенный humanoid rig, blendshapes, лицензия, 5–50 MB [news.viverse](https://news.viverse.com/post/vrm-models-explained) | Только humanoid, не для произвольных сцен [news.viverse](https://news.viverse.com/post/vrm-models-explained) | Проверено |
| **USD** | DCC/пайплайн | Слои, ссылки, variants, индустриальный стандарт [экспертная оценка] | Тяжёлый, сложный парсинг на мобиле, избыточен для чистого рендера [экспертная оценка] | Не проверено источниками выше |

## Почему VRM как экспортный формат

VRM — это glTF 2.0 + JSON-расширения: стандартизирует humanoid bone mapping, facial blend shapes, dynamic physics, camera viewpoints, digital persona licensing — всё в одном портативном `.vrm` [проверено]. Ключевое: приложения без VRM-поддержки всё равно распарсят файл как обычный rigged glTF, а VRM-compliant движки получат полный humanoid-инструментарий [проверено]. Это решает проблему «экспортировать в другие приложения» без кастомных конвертеров [проверено]. VRM 1.0 вышел в сентябре 2022, Khronos Group присоединился к VRM Consortium в октябре 2024 для глобальной стандартизации [проверено].[news.viverse](https://news.viverse.com/post/vrm-models-explained)

## Сжатие: два слоя

Для **гауссиан** (фотореализм):

- PLY raw: 236 байт/сплат, 59 чисел по 4 байта [проверено].[ar-go](https://www.ar-go.co/blog/gaussian-splatting-production-workflow/)
- SPZ: ~10x сжатие, ZSTD, параллельная компрессия атрибутов [проверено].
- SOG: 15–20x сжатие, LOD-чанки, стриминг по требованию [проверено].[developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/)
- На практике: PLY 32.9 MB → SPZ 3.6 MB → SOG 4.4 MB (одна и та же сцена, SH 3) [проверено].[ar-go](https://www.ar-go.co/blog/gaussian-splatting-production-workflow/)

Для **мешей/VRM** (интероперабельность):

- Draco: lossy geometry compression, встроен в glTF-спеку [проверено].
- Meshopt (`KHR_meshopt_compression`): компрессия buffer-view'ов, отдельна от текстур и рендера [проверено].
- VRM-файл типично 5–50 MB, существенно меньше эквивалентного GLB [проверено].[news.viverse](https://news.viverse.com/post/vrm-models-explained)

## Экспорт в другие приложения

Стратегия — **двойной экспорт**:

1. **Внутренний мастер**: PLY/SPZ — для собственного рендера и будущего re-training [проверено].[developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/)
2. **Пользовательский экспорт**: VRM (glTF 2.0) — для VRChat, Blender, Unity, Unreal, web-вьюверов [проверено].[news.viverse](https://news.viverse.com/post/vrm-models-explained)
3. **Опционально**: USD — если продукт интегрируется с DCC-пайплайнами (Maya, Houdini, Omniverse) [экспертная оценка, не проверено источниками].

Khronos в 2026 ратифицировал `KHR_gaussian_splatting` расширение для glTF — теперь гауссианы можно класть прямо в glTF-контейнер, но это определяет «где данные», а не «как сжимать»; SPZ-компрессия для glTF ещё в драфте [проверено]. Это открывает путь к «одному файлу» вместо пары PLY+GLB [проверено].[ar-go](https://www.ar-go.co/blog/gaussian-splatting-production-workflow/)

## Числа и ограничения

- PLY raw: 236 байт/сплат, до GB на больших сценах.developer.playcanvas+1
- SPZ: ~10x сжатие, MIT-лицензия .
- SOG: 15–20x сжатие, LOD-стриминг.[developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/)
- VRM: 5–50 MB, glTF 2.0-based, MIT-лицензия спеки.[news.viverse](https://news.viverse.com/post/vrm-models-explained)
- Draco/Meshopt: встроены в glTF-спеку, но не решают проблему гауссиан (это отдельный формат) .
- Ограничение: lossy-компрессия (SPZ/SOG) — детали могут слегка деградировать; для «мастера» нужен lossless PLY.[developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/)

## Риски

- **Фрагментация форматов**: SPZ/SOG/PLY — три разных «мира» гауссиан, конвертация возможна, но не бесплатна.developer.playcanvas+1
- **VRM-ограничения**: только humanoid, не для нестандартных аватаров (роботы, животные).[news.viverse](https://news.viverse.com/post/vrm-models-explained)
- **USD-сложность**: тяжёлый парсинг на мобиле, избыточен если нет DCC-интеграции [экспертная оценка].
- **Лицензии**: SPZ — MIT , VRM-спека — MIT, но PLY-инструментарий и 3DGS-библиотеки — разные лицензии, нужна проверка [не проверено в этих источниках].[news.viverse](https://news.viverse.com/post/vrm-models-explained)

## Рекомендуемый пайплайн

1. **Сервер генерирует** → PLY (мастер, lossless).developer.playcanvas+1
2. **Сервер конвертирует** → SPZ (для передачи на телефон) + SOG (для web/CDN, если нужен стриминг).[developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/)
3. **Сервер конвертирует** → VRM (glTF 2.0) для экспорта юзеру в сторонние приложения.[news.viverse](https://news.viverse.com/post/vrm-models-explained)
4. **Телефон рендерит** SPZ/SOG напрямую (гауссианы), VRM — как fallback/экспорт.[developer.playcanvas](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/)
5. **Опционально**: USD — только если есть DCC-интеграция [экспертная оценка].

[[AO-w2xp9x]]