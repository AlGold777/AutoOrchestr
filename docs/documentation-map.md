# Карта документации

В корне `docs` находятся эта карта, [обзор проекта](project-overview.md) и
[основной журнал изменений](CHANGELOG.md). Тематические материалы находятся в разделах ниже.

| Раздел | Содержание и точки входа |
| --- | --- |
| [Automation](Automation) | [Стек оркестрации](Automation/orchestration-osi-stack.md), [маркеры](Automation/markers.md) и [комплект Product→Architecture Automation Layer](<Automation/Automation GPT комплект Документов/README.md>): спецификации, контракты, исходные материалы и прототип. Внутренняя структура комплекта сохранена. |
| [Transport](Transport) | [Доставка сообщений](Transport/message-delivery.md), [протокол завершения](Transport/completion-protocol-v2.md), [тайминги](Transport/timings-settings.md), [обзоры проблем и решений](Transport/Reviews), [отчёт восстановления отправки](Transport/Reports/dispatch-recovery-2026-09-05.md). |
| [Telemetry](Telemetry) | [Телеметрия](Telemetry/telemetry.md), [полуавтоматический режим](Telemetry/telemetry-semi-auto-spec.md), [инструкция анализа отчёта](Telemetry/report-analysis-prompt.md), [проверки Transport Extract и сжатия отчётов](Telemetry/Reports). |
| [Architecture](Architecture) | [Архитектура вкладок моделей](Architecture/model-tabs-architecture.md), [концепция Universal Engine](<Architecture/Universal Engine/README.md>) и проекты контрактов/протоколов. |
| [Pipeline](<Pipeline scenarios>) | [Basic: старт здесь](<Pipeline scenarios/basic-start-here.md>), [Basic: как написать схему](<Pipeline scenarios/basic-schema-guide.md>), [Basic: окна настроек](<Pipeline scenarios/basic-windows.md>), [Basic: разработчику](<Pipeline scenarios/basic-developer.md>), [Basic: план доработки 11.10](<Pipeline scenarios/basic_upgrade_oct11.md>), [Basic: ТЗ и задания 7 агентам](<Pipeline scenarios/basic_upgrade_oct11_technical_spec.md>), [карточки A01–A07 (история)](<Pipeline scenarios/basic-upgrade-agents>), [исследование транспорта участников](<Pipeline scenarios/basic-upgrade-agents/A03-research-report.md>), [Basic: проверка реализации 12.10](<Pipeline scenarios/basic_review_oct12.md>), [Basic: ТЗ исправлений и 7 заданий](<Pipeline scenarios/basic_fixes_oct12_technical_spec.md>), [карточки F01–F07](<Pipeline scenarios/basic-fix-agents>), [Basic: проверка выполненных исправлений](<Pipeline scenarios/basic_fixes_review_oct12.md>), [Basic: ревью цепочки Design System → схема → движок на S01–S05 и план изменений](<Pipeline scenarios/basic_review_s01_s05_oct14.md>), (скрипты воспроизведения проверок: `Pipeline scenarios/basic-review-oct12/`, `Pipeline scenarios/basic-fixes-review-oct12/`), [Как разработать сценарий](<Pipeline scenarios/how-to-design-a-scenario.md>), [Design System: формат](<Pipeline scenarios/design-system-format.md>), [Design System: архитектура из 30 этапов](<Pipeline scenarios/design-system-architecture.md>) (схема-фикстура и таблица S01–S30 → ref: `tests/fixtures/basic-architecture-s01-s30.json`, `…map.json`), [Research 1.0 (замещён 2.0)](<Pipeline scenarios/research.md>), [Research 2.0](<Pipeline scenarios/research-2.0.md>), [Шаблон Research в коде](<Pipeline scenarios/research-template.md>), [Pipeline Test: описание реализации и схема для новых сценариев](<Pipeline scenarios/test-pipeline.md>), [Pipeline Polishing: сбор улучшений идеи](<Pipeline scenarios/polishing-pipeline.md>), [Pipeline Delta: игра словами](<Pipeline scenarios/delta-pipeline.md>), [Проект Pipelines universal](<Pipeline scenarios/Pipelines universal/README.md>), [Pre-Dispute](<Pipeline scenarios/Pre-Dispute>): исходный снимок, аудит архитектуры, требования и планы миграции/очистки; сценарии Research. |
| [History](History) | [Прежний журнал Codex](History/change-log-codex.md) и [разбор отката 2.81.576–2.81.577](History/uncommitted-page-cleanup-2.81.576-577-diff.md). |

## Статус и хранение материалов

- `project-overview.md` описывает действующее поведение. Изменения поведения отражаются
  также в соответствующем тематическом документе; история изменений — в `CHANGELOG.md`.
- Завершённый `automation-plan.md` удалён: шаги A–F реализованы в 2.81.529,
  описание поведения сохранено в обзоре проекта, подтверждение — в журнале изменений
  и `tests/automation-markers.test.js`.
- Планы Pre-Dispute сохранены: baseline содержит незакрытую проверку живых провайдеров,
  а полное прохождение ворот миграции и очистки не подтверждено. Снимок исходников
  версии 2.81.444 — материал аудита, его нельзя считать текущим кодом.
- Universal Engine и Pipelines universal — отдельные сохранённые комплекты проектов
  спецификаций. Наличие схем и сценариев проверки не означает завершения реализации.
- Отчёты проверок, архитектурные решения и материалы откатов сохраняются как доказательства,
  даже если связанная работа закончена. Удаляется выполненный план, а не результат проверки.
- Пути в старых записях `CHANGELOG.md`, прежнем журнале Codex и снимке Pre-Dispute
  относятся к состоянию на дату записи. Для навигации по текущей структуре используется эта карта.

Новые документы размещаются в тематическом разделе. План удаляется после подтверждения
выполнения всех его этапов и переноса нужного описания действующего поведения в документацию.
