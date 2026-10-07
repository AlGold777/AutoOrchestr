# Карта документации

В корне `docs` находятся эта карта, [обзор проекта](project-overview.md) и
[основной журнал изменений](CHANGELOG.md). Тематические материалы находятся в разделах ниже.

| Раздел | Содержание и точки входа |
| --- | --- |
| [Automation](Automation) | [Стек оркестрации](Automation/orchestration-osi-stack.md), [маркеры](Automation/markers.md) и [комплект Product→Architecture Automation Layer](<Automation/Automation GPT комплект Документов/README.md>): спецификации, контракты, исходные материалы и прототип. Внутренняя структура комплекта сохранена. |
| [Transport](Transport) | [Доставка сообщений](Transport/message-delivery.md), [протокол завершения](Transport/completion-protocol-v2.md), [тайминги](Transport/timings-settings.md), [обзоры проблем и решений](Transport/Reviews), [отчёт восстановления отправки](Transport/Reports/dispatch-recovery-2026-09-05.md). |
| [Telemetry](Telemetry) | [Телеметрия](Telemetry/telemetry.md), [полуавтоматический режим](Telemetry/telemetry-semi-auto-spec.md), [инструкция анализа отчёта](Telemetry/report-analysis-prompt.md), [проверки Transport Extract и сжатия отчётов](Telemetry/Reports). |
| [Architecture](Architecture) | [Архитектура вкладок моделей](Architecture/model-tabs-architecture.md), [концепция Universal Engine](<Architecture/Universal Engine/README.md>) и проекты контрактов/протоколов. |
| [Pipeline](<Pipeline scenarios>) | [Pipeline Test: описание реализации и схема для новых сценариев](<Pipeline scenarios/test-pipeline.md>), [Pipeline Custom и общий движок](<Pipeline scenarios/custom-pipeline.md>), [Pipeline Polishing: сбор улучшений идеи](<Pipeline scenarios/polishing-pipeline.md>), [Pipeline Delta: игра словами](<Pipeline scenarios/delta-pipeline.md>), [Проект Pipelines universal](<Pipeline scenarios/Pipelines universal/README.md>), [Pre-Dispute](<Pipeline scenarios/Pre-Dispute>): исходный снимок, аудит архитектуры, требования и планы миграции/очистки; сценарии Research. |
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
