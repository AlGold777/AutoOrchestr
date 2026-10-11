# Design System · Разработка архитектуры продукта

Спецификация процесса из 30 этапов. Собрана из файла `product_architecture_framework_human.html` по формату Design System создания pipeline. Текст читается человеком и служит единственным источником для модели, которая пишет схему Basic.

**Как читать.** Каждое поле помечено: ✔ взято из исходного файла дословно; ◐ выведено из файла, нужно подтвердить; ❓ в файле нет, вопрос автору (список в разделе 5). Пустое поле этапа означает умолчание Basic (`DEFAULTS` в `disput/basic-schema.js`); значения умолчаний здесь не повторяются.

---

## 1. Pipeline в целом

| Поле | Содержание | |
| --- | --- | --- |
| Назначение | Получить обоснованную концептуальную архитектуру продукта: сначала зафиксировать, что продукт должен делать (WHAT), затем как он устроен (HOW), опираясь на проверенные факты, а не на согласие моделей. | ◐ |
| Решаемая задача | Задаётся при каждом запуске: исходная продуктовая идея (этап S01). Формулировка задачи этого запуска не входит в спецификацию метода. | ❓ Q1 |
| Исходные данные | Исходная продуктовая идея (вход этапа S01). Что в ней обязательно (пользователь, проблема, ожидаемый результат — требует S01) и в какой форме подаётся, файл не определяет. | ◐ Q2 |
| Итоговый результат | **Conceptual Architecture Baseline** (этап S30). Состав: Revised Conceptual Architecture, ADR Set, Traceability Report, Non-blocking Unknowns, история изменений. Форма каждого документа не определена. | ✔ состав, ❓ форма Q4 |
| Применение результата | Не указано в файле. | ❓ Q3 |
| Критерии готовности результата | Gate G4: Нет blocking issues; ADR записаны; Трасса «требование → архитектурное решение → evidence» без разрывов; Опровергнутые assumptions отражены через change events. | ✔ |
| Общие правила и ограничения | 14 правил дисциплины (справочник 4.2). Они действуют на всех этапах, пока этап не задаёт своё. | ✔ |
| Границы | Охват: два последовательных результата — Product Functional Baseline (WHAT) и Conceptual Architecture Baseline (HOW). Принципы (справочник 4.5): Product ≠ Architecture; Divergence ≠ Convergence; Proposal ≠ Decision; Consensus ≠ Evidence; Baseline ≠ Immutable. Чего процесс не гарантирует, файл не формулирует. | ✔ принципы, ❓ негарантии Q5 |
| Участие владельца | Владелец (Owner) источник полномочий. Лесенка A0–A4 (справочник 4.4). Утверждает baselines на S13 и S30, решения класса A2 и выше. Точки по этапам — раздел 3. | ✔ |
| Поведение при сбое | Не пройден gate — возврат (раздел 2.3). Технический сбой модели (нет ответа, превышение времени) — умолчание Basic. | ◐ |
| Объём | 30 этапов в 4 фазах. Независимых этапов 7: S02, S05, S14, S18, S19, S20, S27 (не менее 2 участников на каждом). Число запросов выводится из схемы, автор его не заполняет. | ✔ |

## 2. Схема процесса

### 2.1 Фазы

| Фаза | Этапы | Название | Что фиксируется | Gate |
| --- | --- | --- | --- | --- |
| product | S01–S13 | Product Definition | WHAT the product must do | G1 (S13) |
| discovery | S14–S17 | Architecture Discovery | WHAT candidates may assume | G2 (S17) |
| generation | S18–S23 | Architecture Generation | варианты, проверка, выбор | G3 (S22) |
| evidence | S24–S30 | Evidence Closure | HOW the system is organised | G4 (S30) |

### 2.2 Этапы и порядок

Этапы идут по номеру от S01 к S30. Внутри независимого этапа (∥) участники работают параллельно и не видят ответов друг друга; сведение выполняет этап, указанный в графе «Сведение».

| Этап | Фаза | Название | Роли | ∥ | Сведение | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | product | Product Idea & Decision Policy | Producer + Owner |  |  |  |
| S02 | product | Independent Concept / Functional Expansion | Producer | ∥ | S03 |  |
| S03 | product | Decision Closure Review | Synthesizer + Decision Closer |  |  |  |
| S04 | product | Product Concept Synthesis | Synthesizer |  |  |  |
| S05 | product | Adversarial Concept Review | Reviewer | ∥ | S06 |  |
| S06 | product | Delta Decision Closure | Decision Closer |  |  |  |
| S07 | product | Functional Map Draft | Producer |  |  |  |
| S08 | product | Functional Map Audit | Reviewer + Producer |  |  |  |
| S09 | product | Scenario / Prototype Validation | Reviewer + Verifier |  |  |  |
| S10 | product | Delta Decision Closure | Decision Closer |  |  |  |
| S11 | product | Functional Specification | Producer |  |  |  |
| S12 | product | Functional Specification Audit | Reviewer + Producer |  |  |  |
| S13 | product | Product Functional Baseline | Decision Closer + Owner |  |  | G1 |
| S14 | discovery | Independent Constraint Discovery | Producer | ∥ | S15 |  |
| S15 | discovery | Constraint Synthesis & Normalization | Synthesizer |  |  |  |
| S16 | discovery | Fact Verification / Validation Registry | Verifier |  |  |  |
| S17 | discovery | Architecture Input Package | Synthesizer + Decision Closer |  |  | G2 |
| S18 | generation | Independent Architecture Proposals | Producer | ∥ | S21 |  |
| S19 | generation | Independent Candidate Review | Reviewer | ∥ | S20 |  |
| S20 | generation | Cross-Critique & Candidate Revision | Reviewer + Producer | ∥ | S21 |  |
| S21 | generation | Architecture Comparison | Synthesizer + Reviewer |  |  |  |
| S22 | generation | Architecture Direction Decision | Decision Closer + Owner |  |  | G3 |
| S23 | generation | Preliminary Conceptual Architecture | Synthesizer |  |  |  |
| S24 | evidence | Decision & Verification Backlog | Synthesizer |  |  |  |
| S25 | evidence | Spikes / Platform Verification / Technology Research | Verifier |  |  |  |
| S26 | evidence | Close Architecture-Blocking Decisions | Decision Closer |  |  |  |
| S27 | evidence | Premortem / Missed-Failure Search | Reviewer | ∥ | S28 |  |
| S28 | evidence | Conceptual Architecture Revision | Producer |  |  |  |
| S29 | evidence | ADR + Consistency + Traceability Audit | Reviewer + Verifier |  |  |  |
| S30 | evidence | Conceptual Architecture Baseline | Decision Closer + Owner |  |  | G4 |

### 2.3 Связи

Передача результатов. Условие по умолчанию — «этап завершён». Возвраты и изменения описаны ниже отдельно.

| Откуда | Куда | Что передаётся |
| --- | --- | --- |
| S01 | S02 | Product Idea + Decision Policy |
| S01 | S03 | Decision Policy |
| S02 | S03 | Independent proposal sets |
| S03 | S04 | Decision Register |
| S03 | S05 | Decision Register |
| S04 | S05 | Product Concept |
| S04 | S09 | Product Concept |
| S05 | S06 | Findings + New Open Decisions |
| S06 | S07 | Updated Product Concept |
| S07 | S08 | Functional Map Draft |
| S08 | S09 | Corrected Functional Map |
| S08 | S10 | Audit Findings |
| S09 | S10 | Scenario / Prototype Findings |
| S10 | S11 | Updated Functional Map + Decisions |
| S11 | S12 | Functional Specification |
| S12 | S13 | Corrected Functional Specification |
| S13 | S14 | Product Functional Baseline |
| S13 | S17 | Product Functional Baseline |
| S14 | S15 | Candidate Constraints |
| S15 | S16 | Constraint Registry |
| S16 | S17 | Validation Registry + Verified Facts |
| S16 | S24 | Evidence Gaps |
| S17 | S18 | Architecture Input Package |
| S17 | S19 | Architecture Input Package |
| S17 | S21 | Architecture Input Package |
| S18 | S19 | Independent Architecture Candidates |
| S19 | S20 | Review Report per Candidate |
| S20 | S21 | Revised Candidates + Cross-Critique |
| S21 | S22 | Architecture Comparison |
| S21 | S24 | Evidence-dependent Decisions |
| S22 | S23 | Architecture Direction + Rationale |
| S22 | S24 | Unresolved Blockers |
| S23 | S24 | Architecture Assumptions |
| S23 | S27 | Preliminary Conceptual Architecture |
| S24 | S25 | Decision & Verification Backlog |
| S25 | S26 | Evidence + Measurements |
| S26 | S27 | Closed Blocking Decisions |
| S26 | S28 | Closed Decisions + Required Changes |
| S27 | S28 | Failure Findings |
| S28 | S29 | Revised Conceptual Architecture |
| S29 | S30 | ADR Set + Traceability Report |

**Возвраты** (работа возвращается на более ранний этап):

| Откуда | Куда | Условие |
| --- | --- | --- |
| S12 | S10 | Findings и Remaining Unknowns, влияющие на решения; non-blocking идут в S13 |
| S27 | S24 | Failure findings и risks требуют проверки (по типу находки; остальные в S28) |
| S29 | S26 | Consistency / Traceability findings: исход определяет возврат (S26 / S28 / S30) |
| S29 | S28 | Consistency / Traceability findings: исход определяет возврат (S26 / S28 / S30) |

**Controlled change** (изменение зафиксированного baseline):

| Этап | Условие и действие |
| --- | --- |
| S19 | CHG proposal → Product Functional Baseline; сначала product delta closure + повторный G1 |
| S25 | CHG proposal → Architecture Input Package; сначала re-validation + повторный G2 |
| S26 | Required Change Set · architecture revision; direction invalidation → G3 |
| S28 | Applied change / revision trace · только по закрытым decisions и evidence |
| S30 | После Conceptual Architecture Baseline любое изменение начинается с CHG |

## 3. Этапы

Поля каждого этапа: цель, задание, участники, порядок и независимость, вход, выход, правила и ограничения, критерии качества, участие владельца. Предел длины ответа не задан (умолчание Basic).

### S01 · Product Idea & Decision Policy

- **Фаза:** product
- **Цель:** Фиксирует продуктовую проблему, результат и границы полномочий.
- **Задание:** Зафиксировать пользователя, проблему и ожидаемый результат; Определить классы решений и пороги риска; Явно записать known unknowns.
- **Участники:** Producer (автор) + Owner (владелец). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Исходная продуктовая идея. Источник: исходные данные запуска.
- **Выход:** Product Idea; Decision Policy; Initial Known Unknowns. Создаёт объекты: неизвестное, предположение.
- **Правила и ограничения:** запрещено — Предлагать технические решения; Расширять полномочия моделей без решения владельца. Правила: No Authority Expansion; No Architecture Leakage; No Silent Completion.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** Owner участвует в этапе. Decision Policy создана · A0 → A4. эскалация владельцу: Целевой пользователь не определён; Класс риска решения не определён Decision Policy

### S02 · Independent Concept / Functional Expansion

- **Фаза:** product
- **Цель:** Независимо расширяет пространство сценариев, capabilities и продуктовых вопросов.
- **Задание:** Искать сценарии, capabilities, edge cases и продуктовые риски; Формулировать альтернативные трактовки и открытые вопросы.
- **Участники:** Producer (автор). Количество: не менее 2 независимых.
- **Порядок и независимость:** параллельно. Product Idea + Decision Policy одинаковы; чужие proposals скрыты; proposal содержит source_model; сведение только на этапе 3.
- **Вход:** Product Idea; Decision Policy. Приходит: S01 (Product Idea + Decision Policy).
- **Выход:** Independent proposal sets. Создаёт объекты: предложение модели, риск, неизвестное.
- **Правила и ограничения:** запрещено — Видеть результаты других моделей до закрытия этапа; Проектировать реализацию; Объявлять proposal решением. Правила: No Architecture Leakage; No Authority Expansion.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Предложение выходит за scope Product Idea

### S03 · Decision Closure Review

- **Фаза:** product
- **Цель:** Преобразует proposals в управляемые product decisions с provenance.
- **Задание:** Дедуплицировать семантически; Разделять составные предложения; Проверять класс полномочий и маршрутизировать решение.
- **Участники:** Synthesizer (синтезатор) + Decision Closer (закрывает решения). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Independent proposal sets; Decision Policy. Приходит: S01 (Decision Policy); S02 (Independent proposal sets).
- **Выход:** Decision Register. Создаёт объекты: продуктовое решение, неизвестное. Изменяет: предложение модели.
- **Правила и ограничения:** запрещено — Закрывать решение выше своего класса; Сливать предложения с разными последствиями; Терять ссылки на исходные proposals. Правила: No Hidden Merge; No Authority Expansion; Provenance Preservation.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** Проверка класса решения. эскалация владельцу: Решение класса A2 и выше; Решение зависит от внешнего факта

### S04 · Product Concept Synthesis

- **Фаза:** product
- **Цель:** Собирает принятые решения в целостную продуктовую концепцию.
- **Задание:** Собрать сценарии, capabilities, scope и существенные правила в единое целое.
- **Участники:** Synthesizer (синтезатор). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Decision Register. Приходит: S03 (Decision Register).
- **Выход:** Product Concept. Создаёт объекты: возможность продукта.
- **Правила и ограничения:** запрещено — Принимать новые решения; Заполнять OPEN правдоподобным поведением; Терять deferred scope. Правила: No Silent Completion; No Silent Reinterpretation; No Hidden Deletion.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Closed decisions противоречат друг другу

### S05 · Adversarial Concept Review

- **Фаза:** product
- **Цель:** Независимо ищет противоречия, пропуски и скрытые допущения.
- **Задание:** Находить contradictions, missing scenarios, hidden assumptions и undefined behavior.
- **Участники:** Reviewer (рецензент). Количество: не менее 2 независимых.
- **Порядок и независимость:** параллельно. Product Concept одинаковый; reviewers не видят чужие findings; findings разделены по reviewer; delta closure на этапе 6.
- **Вход:** Product Concept; Decision Register. Приходит: S03 (Decision Register); S04 (Product Concept).
- **Выход:** Findings; New Open Decisions. Создаёт объекты: замечание проверки, неизвестное.
- **Правила и ограничения:** запрещено — Исправлять концепцию; Закрывать решения. Правила: Review Discipline.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Finding затрагивает Decision Policy

### S06 · Delta Decision Closure

- **Фаза:** product
- **Цель:** Закрывает только новые решения из review, не пересматривая остальное.
- **Задание:** Рассматривать только delta из review; Обновлять концепцию по закрытым delta decisions.
- **Участники:** Decision Closer (закрывает решения). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Findings; New Open Decisions; Decision Policy. Приходит: S05 (Findings + New Open Decisions).
- **Выход:** Delta Closed Decisions; Updated Product Concept. Создаёт объекты: продуктовое решение. Изменяет: возможность продукта.
- **Правила и ограничения:** запрещено — Переоткрывать закрытое без основания; Менять смысл закрытого решения без change event. Правила: Delta Discipline; No Silent Reinterpretation; No Authority Expansion.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** Проверка класса для delta. эскалация владельцу: Delta требует класса полномочий выше доступного

### S07 · Functional Map Draft

- **Фаза:** product
- **Цель:** Декомпозирует концепцию в формальную карту того, что продукт должен уметь.
- **Задание:** Декомпозировать продуктовую концепцию в capabilities и функции; Оставлять новую неопределённость видимой.
- **Участники:** Producer (автор). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Updated Product Concept. Приходит: S06 (Updated Product Concept).
- **Выход:** Functional Map Draft; Discovered OPEN items. Создаёт объекты: возможность продукта, неизвестное.
- **Правила и ограничения:** запрещено — Заполнять неопределённость догадкой; Вводить компоненты или технологии. Правила: No Silent Completion; No Architecture Leakage.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Функция не имеет основания в концепции

### S08 · Functional Map Audit

- **Фаза:** product
- **Цель:** Reviewer формирует audit findings; Producer применяет только трассируемые исправления к Functional Map.
- **Задание:** Reviewer проверяет coverage, дубли, missing states и architecture leakage; Producer применяет исправления только по явным findings; Новые продуктовые решения маршрутизируются в delta closure.
- **Участники:** Reviewer (рецензент) + Producer (автор). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Functional Map Draft. Приходит: S07 (Functional Map Draft).
- **Выход:** Corrected Functional Map; Audit Findings. Создаёт объекты: замечание проверки, неизвестное. Изменяет: возможность продукта.
- **Правила и ограничения:** запрещено — Молча править карту; Удалять функции без trace. Правила: Review Discipline; No Hidden Deletion; No Architecture Leakage.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Найдено новое продуктовое решение

### S09 · Scenario / Prototype Validation

- **Фаза:** product
- **Цель:** Прогоняет функциональную модель по реальным сценариям и прототипу.
- **Задание:** Проверять достижимость целей, flows, состояния и transitions; Использовать prototype как проверку продуктовой модели.
- **Участники:** Reviewer (рецензент) + Verifier (проверяющий). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Corrected Functional Map; Product Concept. Приходит: S04 (Product Concept); S08 (Corrected Functional Map).
- **Выход:** Scenario Findings; Prototype Findings. Создаёт объекты: замечание проверки, неизвестное, evidence.
- **Правила и ограничения:** запрещено — Превращать prototype в технический выбор. Правила: No Architecture Leakage; Review Discipline.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Обнаружено undefined behavior или новое продуктовое решение

### S10 · Delta Decision Closure

- **Фаза:** product
- **Цель:** Закрывает новые решения из аудита и сценарной проверки.
- **Задание:** Закрывать только выявленную delta; Обновлять функциональную карту по решениям.
- **Участники:** Decision Closer (закрывает решения). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Audit Findings; Scenario / Prototype Findings; Decision Policy. Приходит: S08 (Audit Findings); S09 (Scenario / Prototype Findings).
- **Выход:** Updated Decisions; Updated Functional Map. Создаёт объекты: продуктовое решение. Изменяет: возможность продукта.
- **Правила и ограничения:** запрещено — Пересматривать ранее закрытое без основания; Выходить за полномочия. Правила: Delta Discipline; No Authority Expansion.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** Проверка класса для delta. эскалация владельцу: Решение требует A2+

### S11 · Functional Specification

- **Фаза:** product
- **Цель:** Формализует наблюдаемое поведение без определения реализации.
- **Задание:** Описать scenarios, states, transitions, pre/postconditions и failure behavior.
- **Участники:** Producer (автор). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Updated Functional Map; Updated Decisions. Приходит: S10 (Updated Functional Map + Decisions).
- **Выход:** Functional Specification. Создаёт объекты: требование к поведению.
- **Правила и ограничения:** запрещено — Определять реализацию; Придумывать недостающие правила. Правила: No Silent Completion; No Architecture Leakage; Traceability Preservation.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Правило поведения не определено продуктовым решением

### S12 · Functional Specification Audit

- **Фаза:** product
- **Цель:** Reviewer формирует findings по спецификации; Producer применяет только трассируемые исправления.
- **Задание:** Reviewer проверяет completeness, consistency, testability и failure paths; Producer применяет исправления только по явным findings; Новое продуктовое решение маршрутизируется обратно в этап 10.
- **Участники:** Reviewer (рецензент) + Producer (автор). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Functional Specification. Приходит: S11 (Functional Specification).
- **Выход:** Corrected Functional Specification; Findings; Remaining Unknowns. Создаёт объекты: замечание проверки, неизвестное. Изменяет: требование к поведению.
- **Правила и ограничения:** запрещено — Молча принимать продуктовые решения; Заполнять undefined states. Правила: Review Discipline; No Silent Completion; No Architecture Leakage.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Новое продуктовое решение → этап 10

### S13 · Product Functional Baseline

- **Фаза:** product; завершается gate G1
- **Цель:** Фиксирует контролируемый WHAT-контракт продукта.
- **Задание:** Зафиксировать версию продуктового baseline после проверки gate.
- **Участники:** Decision Closer (закрывает решения) + Owner (владелец). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Product Idea; Decision Policy; Product Concept; Functional Map; Functional Specification; Closed Product Decisions; Known Unknowns; Deferred Scope. Приходит: S12 (Corrected Functional Specification).
- **Выход:** Product Functional Baseline.
- **Правила и ограничения:** запрещено — Фиксировать при blocking OPEN; Менять после фиксации без change event. Правила: Baseline Discipline.
- **Критерии качества:** Все blocking product decisions закрыты или явно отложены; OPEN помечены non-blocking и видны в Known Unknowns; Deferred scope перечислен явно; Трасса «решение → возможность → требование» полная.
- **Участие владельца:** Owner участвует в этапе. Владелец утверждает Product Functional Baseline. эскалация владельцу: Gate G1 не пройден

### S14 · Independent Constraint Discovery

- **Фаза:** discovery
- **Цель:** Независимо ищет технически значимые ограничения, не объявляя их фактами.
- **Задание:** Искать platform, OS/API, hardware, network, security, privacy и lifecycle constraints.
- **Участники:** Producer (автор). Количество: не менее 2 независимых.
- **Порядок и независимость:** параллельно. Product Functional Baseline одинаковый; чужие candidate constraints скрыты; каждый candidate хранит provenance; нормализация на этапе 15.
- **Вход:** Product Functional Baseline. Приходит: S13 (Product Functional Baseline).
- **Выход:** Candidate Constraints. Создаёт объекты: ограничение, предположение.
- **Правила и ограничения:** запрещено — Объявлять candidate фактом; Предлагать архитектуру. Правила: Assumption Is Not Fact; Provenance Preservation.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Ограничение делает требование невыполнимым

### S15 · Constraint Synthesis & Normalization

- **Фаза:** discovery
- **Цель:** Создаёт единый реестр ограничений с provenance и статусами.
- **Задание:** Дедуплицировать и нормализовать без потери условий; Фиксировать provenance и противоречия.
- **Участники:** Synthesizer (синтезатор). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Candidate Constraints. Приходит: S14 (Candidate Constraints).
- **Выход:** Constraint Registry. Создаёт объекты: ограничение. Изменяет: ограничение.
- **Правила и ограничения:** запрещено — Сливать ограничения с разными условиями; Повышать статус из-за консенсуса моделей; Терять кандидатов. Правила: No Hidden Merge; Consensus Is Not Evidence; Provenance Preservation; No Hidden Deletion.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Обнаружено противоречие, требующее проверки

### S16 · Fact Verification / Validation Registry

- **Фаза:** discovery
- **Цель:** Присваивает epistemic status только на основании evidence.
- **Задание:** Присваивать VERIFIED, FALSIFIED, UNCERTAIN, NEEDS_RESEARCH, NEEDS_EXPERIMENT.
- **Участники:** Verifier (проверяющий). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Constraint Registry. Приходит: S15 (Constraint Registry).
- **Выход:** Validation Registry; Verified Facts; Evidence Gaps. Создаёт объекты: проверенный факт, evidence, неизвестное. Изменяет: ограничение, предположение.
- **Правила и ограничения:** запрещено — Подтверждать мнение модели как факт; Принимать архитектурные решения. Правила: Consensus Is Not Evidence; Assumption Is Not Fact.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Нужен эксперимент → backlog этапа 24

### S17 · Architecture Input Package

- **Фаза:** discovery; завершается gate G2
- **Цель:** Фиксирует единый версионированный вход для всех архитектурных моделей.
- **Задание:** Собрать один пакет одной версии для всех моделей; Зафиксировать decision boundaries и invariants.
- **Участники:** Synthesizer (синтезатор) + Decision Closer (закрывает решения). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Product Functional Baseline; Verified constraints; Validation Registry; Quality attributes; Invariants; Known unknowns; Decision boundaries. Приходит: S13 (Product Functional Baseline); S16 (Validation Registry + Verified Facts).
- **Выход:** Architecture Input Package.
- **Правила и ограничения:** запрещено — Давать разным моделям разные входы; Передавать непроверенное как факт. Правила: Baseline Discipline; Assumption Is Not Fact.
- **Критерии качества:** У каждого ограничения есть verification status; Фактами названы только VERIFIED; Все модели получают идентичный пакет одной версии; Decision boundaries и invariants зафиксированы.
- **Участие владельца:** Границы архитектурных решений. эскалация владельцу: Gate G2 не пройден

### S18 · Independent Architecture Proposals

- **Фаза:** generation
- **Цель:** Независимо формирует проверяемые architecture candidates.
- **Задание:** Формировать независимые candidates с явными assumptions и trade-offs.
- **Участники:** Producer (автор). Количество: не менее 2 независимых.
- **Порядок и независимость:** параллельно. Architecture Input Package одной версии; чужие candidates скрыты; candidate автономно проверяем; сравнение после review/revision.
- **Вход:** Architecture Input Package. Приходит: S17 (Architecture Input Package).
- **Выход:** Independent Architecture Candidates. Создаёт объекты: архитектурное решение, предположение, неизвестное, риск.
- **Правила и ограничения:** запрещено — Менять продуктовый контракт; Смотреть чужие candidates. Правила: No Product Redefinition by Architecture; Assumption Is Not Fact.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Candidate требует изменить Product Functional Baseline

### S19 · Independent Candidate Review

- **Фаза:** generation
- **Цель:** Независимо проверяет каждый candidate; reviewer не является автором.
- **Задание:** Проверять coverage, feasibility, consistency, failure modes и security.
- **Участники:** Reviewer (рецензент). Количество: не менее 2 независимых.
- **Порядок и независимость:** параллельно. candidate + AIP; reviewer не автор candidate; отдельный Review Report; cross-critique на этапе 20.
- **Вход:** Architecture candidates; Architecture Input Package. Приходит: S17 (Architecture Input Package); S18 (Independent Architecture Candidates).
- **Выход:** Review Report per Candidate. Создаёт объекты: замечание проверки, риск, неизвестное.
- **Правила и ограничения:** запрещено — Исправлять candidate; Переопределять продукт. Правила: Review Discipline; No Product Redefinition by Architecture.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Gap в продукте → изменение к Product Functional Baseline

### S20 · Cross-Critique & Candidate Revision

- **Фаза:** generation
- **Цель:** Делает trade-offs явными и разрешает автору ревизовать свой candidate.
- **Задание:** Критиковать любой candidate; Ревизовать candidate только его автору; Фиксировать trade-offs и несовместимые assumptions.
- **Участники:** Reviewer (рецензент) + Producer (автор). Количество: не менее 2 независимых.
- **Порядок и независимость:** параллельно. candidates + review reports; критиковать может любой; ревизует только автор candidate; сведение на этапе 21.
- **Вход:** Architecture candidates; Review Reports. Приходит: S19 (Review Report per Candidate).
- **Выход:** Revised Candidates; Cross-Critique; Remaining Architectural Decisions. Создаёт объекты: замечание проверки, архитектурное решение, неизвестное. Изменяет: архитектурное решение, предположение.
- **Правила и ограничения:** запрещено — Скрыто сливать candidates; Удалять слабые стороны без следа. Правила: No Hidden Deletion; No Hidden Merge; No Product Redefinition by Architecture.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Ревизия требует изменения продуктового baseline

### S21 · Architecture Comparison

- **Фаза:** generation
- **Цель:** Сравнивает candidates по общей основе, рискам и доступному evidence.
- **Задание:** Сравнивать по requirements, constraints, quality attributes и рискам.
- **Участники:** Synthesizer (синтезатор) + Reviewer (рецензент). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Revised Candidates; Architecture Input Package. Приходит: S17 (Architecture Input Package); S20 (Revised Candidates + Cross-Critique).
- **Выход:** Architecture Comparison; Explicit Trade-offs; Evidence-dependent Decisions. Создаёт объекты: неизвестное, риск.
- **Правила и ограничения:** запрещено — Считать голоса моделей evidence; Скрыто объединять несовместимые решения. Правила: Consensus Is Not Evidence; No Hidden Merge.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Решение зависит от отсутствующего evidence

### S22 · Architecture Direction Decision

- **Фаза:** generation; завершается gate G3
- **Цель:** Выбирает направление или совместимую комбинацию решений с rationale.
- **Задание:** Выбрать направление в пределах authority; Зафиксировать rationale и unresolved blockers.
- **Участники:** Decision Closer (закрывает решения) + Owner (владелец). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Architecture Comparison; Decision Policy; Available evidence. Приходит: S21 (Architecture Comparison).
- **Выход:** Architecture Direction; Rationale; Unresolved Blockers. Создаёт объекты: архитектурное решение, неизвестное.
- **Правила и ограничения:** запрещено — Подменять evidence консенсусом; Менять продуктовый baseline. Правила: No Authority Expansion; Consensus Is Not Evidence; No Product Redefinition by Architecture.
- **Критерии качества:** У направления есть явный rationale; Класс полномочий соответствует Decision Policy; Evidence-зависимое вынесено как blockers.
- **Участие владельца:** Owner участвует в этапе. A2+ утверждает владелец. эскалация владельцу: A2+ → владелец; Evidence-dependent blocker

### S23 · Preliminary Conceptual Architecture

- **Фаза:** generation
- **Цель:** Оформляет выбранное направление как единую conceptual architecture.
- **Задание:** Описать части, responsibilities, boundaries, interactions, flows и invariants.
- **Участники:** Synthesizer (синтезатор). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Architecture Direction; Rationale. Приходит: S22 (Architecture Direction + Rationale).
- **Выход:** Preliminary Conceptual Architecture. Создаёт объекты: архитектурное решение, предположение, неизвестное.
- **Правила и ограничения:** запрещено — Скрыто закрывать open decisions; Превращать assumption в факт. Правила: No Silent Completion; Assumption Is Not Fact; No Hidden Deletion.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Нужно evidence для значимого assumption

### S24 · Decision & Verification Backlog

- **Фаза:** evidence
- **Цель:** Превращает архитектурные неизвестные в управляемые verification items.
- **Задание:** Для каждого unknown указать impact, требуемое evidence и blocking status.
- **Участники:** Synthesizer (синтезатор). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Evidence-dependent Decisions; Architecture Assumptions; Evidence Gaps. Приходит: S16 (Evidence Gaps); S21 (Evidence-dependent Decisions); S22 (Unresolved Blockers); S23 (Architecture Assumptions).
- **Выход:** Decision & Verification Backlog. Создаёт объекты: неизвестное. Изменяет: неизвестное.
- **Правила и ограничения:** запрещено — Оставлять архитектурно значимое неизвестное вне backlog. Правила: Traceability Preservation; No Silent Completion.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Blocking unknown не имеет способа проверки

### S25 · Spikes / Platform Verification / Technology Research

- **Фаза:** evidence
- **Цель:** Получает внешнее или экспериментальное evidence на конкретный вопрос.
- **Задание:** Проводить исследование или эксперимент, привязанный к вопросу; Фиксировать воспроизводимый метод и результат.
- **Участники:** Verifier (проверяющий). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Decision & Verification Backlog. Приходит: S24 (Decision & Verification Backlog).
- **Выход:** Evidence; Measurements; Verified/Falsified Assumptions. Создаёт объекты: evidence, проверенный факт. Изменяет: предположение, ограничение, неизвестное.
- **Правила и ограничения:** запрещено — Исследовать без вопроса; Выдавать мнение за измерение. Правила: Assumption Is Not Fact; Consensus Is Not Evidence.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Constraint или assumption опровергнут

### S26 · Close Architecture-Blocking Decisions

- **Фаза:** evidence
- **Цель:** Закрывает blocking decisions на основании полученного evidence.
- **Задание:** Закрывать blocking decisions в пределах authority; Явно инициировать изменение при опровержении assumption.
- **Участники:** Decision Closer (закрывает решения). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Evidence; Measurements; Decision Policy. Приходит: S25 (Evidence + Measurements).
- **Выход:** Closed Blocking Decisions; Remaining Non-blocking Unknowns; Required Changes. Создаёт объекты: архитектурное решение, изменение. Изменяет: архитектурное решение, предположение.
- **Правила и ограничения:** запрещено — Закрывать выше полномочий; Скрыто переинтерпретировать архитектуру. Правила: No Authority Expansion; No Silent Reinterpretation; Delta Discipline.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** Проверка класса blocking-решений. эскалация владельцу: Если сломано направление → этап 22

### S27 · Premortem / Missed-Failure Search

- **Фаза:** evidence
- **Цель:** Независимо ищет существенные классы отказа архитектуры.
- **Задание:** Искать failure classes, blind spots и новые риски.
- **Участники:** Reviewer (рецензент). Количество: не менее 2 независимых.
- **Порядок и независимость:** параллельно. conceptual architecture; поиск failure classes независимо; findings + risks с provenance; revision на этапе 28.
- **Вход:** Preliminary Conceptual Architecture; Closed Blocking Decisions. Приходит: S23 (Preliminary Conceptual Architecture); S26 (Closed Blocking Decisions).
- **Выход:** Failure Findings; Risks; Possible New Decisions. Создаёт объекты: замечание проверки, риск, неизвестное.
- **Правила и ограничения:** запрещено — Исправлять архитектуру или самостоятельно закрывать решения. Правила: Review Discipline.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Новый blocking unknown → backlog

### S28 · Conceptual Architecture Revision

- **Фаза:** evidence
- **Цель:** Обновляет архитектуру по evidence, decisions и premortem findings с trace.
- **Задание:** Вносить только трассируемые изменения по evidence и findings.
- **Участники:** Producer (автор). Количество: 1.
- **Порядок и независимость:** один участник.
- **Вход:** Closed Blocking Decisions; Failure Findings; Evidence. Приходит: S26 (Closed Decisions + Required Changes); S27 (Failure Findings).
- **Выход:** Revised Conceptual Architecture. Создаёт объекты: изменение. Изменяет: архитектурное решение, предположение.
- **Правила и ограничения:** запрещено — Удалять без trace; Менять продуктовый baseline; Скрыто менять смысл решения. Правила: No Hidden Deletion; Traceability Preservation; No Product Redefinition by Architecture; No Silent Reinterpretation.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Изменение затрагивает baseline или direction

### S29 · ADR + Consistency + Traceability Audit

- **Фаза:** evidence
- **Цель:** Фиксирует ADR и проверяет сквозную согласованность requirement → decision → evidence.
- **Задание:** Зафиксировать ключевые ADR; Проверить происхождение и сквозную трассировку.
- **Участники:** Reviewer (рецензент) + Verifier (проверяющий). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Revised Conceptual Architecture. Приходит: S28 (Revised Conceptual Architecture).
- **Выход:** ADR Set; Consistency Report; Traceability Report. Создаёт объекты: архитектурное решение, замечание проверки.
- **Правила и ограничения:** запрещено — Молча исправлять архитектуру; Игнорировать разрывы traceability. Правила: Traceability Preservation; Provenance Preservation; Review Discipline.
- **Критерии качества:** ❓ не заданы (Q6).
- **Участие владельца:** эскалация владельцу: Blocker → этап 26 или 30

### S30 · Conceptual Architecture Baseline

- **Фаза:** evidence; завершается gate G4
- **Цель:** Фиксирует контролируемый HOW-baseline при отсутствии blocking issues.
- **Задание:** Зафиксировать conceptual architecture baseline после G4.
- **Участники:** Decision Closer (закрывает решения) + Owner (владелец). Количество: 1.
- **Порядок и независимость:** один участник в каждой роли, роли по очереди.
- **Вход:** Revised Conceptual Architecture; ADR Set; Traceability Report; Non-blocking Unknowns; Change history. Приходит: S29 (ADR Set + Traceability Report).
- **Выход:** Conceptual Architecture Baseline.
- **Правила и ограничения:** запрещено — Фиксировать при blocking issues; Менять CAB без controlled change. Правила: Baseline Discipline.
- **Критерии качества:** Нет blocking issues; ADR записаны; Трасса «требование → архитектурное решение → evidence» без разрывов; Опровергнутые assumptions отражены через change events.
- **Участие владельца:** Owner участвует в этапе. Владелец утверждает Conceptual Architecture Baseline. эскалация владельцу: Gate G4 не пройден

## 4. Справочники

### 4.1 Роли

| Роль | Может | Не может |
| --- | --- | --- |
| Producer | Создаёт proposals, черновики и ревизии своих артефактов. | Не получает автоматически полномочия принимать решения или подтверждать факты. |
| Reviewer | Находит, классифицирует и маршрутизирует проблемы. | Не исправляет reviewed artifact и не закрывает решения. |
| Synthesizer | Объединяет, нормализует и дедуплицирует с сохранением различий и provenance. | Не принимает решения только потому, что объединяет материалы. |
| Decision Closer | Закрывает решения в пределах Decision Policy и маршрутизирует остальные. | Не выходит за доступный authority class. |
| Verifier | Присваивает epistemic status на основании evidence. | Не принимает проектные решения. |
| Owner | Источник продуктовых полномочий; утверждает решения и baselines, требующие владельца. | Не является ролью модели. |

### 4.2 Правила дисциплины

| Правило | Смысл |
| --- | --- |
| No Silent Completion | Не заполнять отсутствующее правдоподобной догадкой. |
| No Silent Reinterpretation | Не менять смысл принятого решения без change event. |
| No Hidden Deletion | Объект не исчезает без причины и trace. |
| No Hidden Merge | Слияние не уничтожает значимых различий. |
| No Authority Expansion | Модель не расширяет свои полномочия. |
| Consensus Is Not Evidence | Совпадение мнений не меняет epistemic status. |
| Assumption Is Not Fact | Предположение остаётся предположением до evidence. |
| No Architecture Leakage | До архитектуры нельзя подменять проблему техническим решением. |
| No Product Redefinition by Architecture | Архитектура не меняет продуктовый baseline без controlled change. |
| Provenance Preservation | Происхождение каждого значимого объекта сохраняется. |
| Traceability Preservation | Связи сохраняются или явно обновляются. |
| Delta Discipline | Повторный review рассматривает delta, а не пересматривает всё закрытое. |
| Baseline Discipline | Изменение baseline — только через явный механизм. |
| Review Discipline | Обнаружение и исправление — разные операции; reviewer не становится producer или decision maker. |

### 4.3 Объекты (форма выходов)

| Объект | Код | Что это | Поля |
| --- | --- | --- | --- |
| предложение модели | PRP | Предложение модели; ещё не решение. | id, source_model, kind, statement, rationale, open_questions |
| продуктовое решение | PD | Ответ на продуктовый вопрос. | id@v, question, decision, status, authority_class, decided_by, provenance, affects |
| возможность продукта | CAP | Capability продукта. | id@v, name, user_goal, derived_from, scope, open_items |
| требование к поведению | REQ | Наблюдаемое поведение продукта. | id@v, capability, preconditions, rule, postconditions, failure_behavior, acceptance |
| ограничение | CON | Техническое ограничение. | id, statement, domain, verification_status, provenance, contradicts |
| проверенный факт | FCT | Утверждение с доказательством. | id, claim, status, evidence, valid_for |
| предположение | ASM | Принято без доказательства. | id, statement, status, needed_evidence, blocking, relied_on_by |
| неизвестное | UNK | Открытый вопрос. | id, question, impacts, evidence_required, blocking, route |
| риск | RSK | Возможный отказ. | id, failure_class, likelihood, impact, linked_to, mitigation |
| evidence | EVD | Результат проверки. | id, answers, method, result, verifies, falsifies, reproducible |
| архитектурное решение | AD | Выбор с обоснованием. | id@v, context, options, decision, rationale, satisfies, relies_on, authority_class |
| замечание проверки | FND | Finding; обнаруженная проблема, не исправление. | id, target, class, severity, description, proposed_route, fix_applied |
| изменение | CHG | Change event. | id, target, result, reason, trigger, impact_set, authority_class, approved_by, propagated_to |

### 4.4 Лесенка полномочий

| Класс | Кто решает |
| --- | --- |
| A0 | модель закрывает сама: обратимое, низкий риск, внутри scope |
| A1 | только с evidence: решение зависит от внешнего факта |
| A2 | нужно новое продуктовое предпочтение: выбор между ценностями |
| A3 | только владелец: меняет scope, контракт или baseline |
| A4 | запрещено модели: риск выше допустимого |

### 4.5 Принципы

| Принцип | Смысл | Этапы |
| --- | --- | --- |
| Product ≠ Architecture | Продуктовый контракт фиксируется до архитектуры; архитектура не переопределяет WHAT без controlled change. | S13, S14, S17, S18, S19, S20, S28 |
| Divergence ≠ Convergence | Независимая генерация и независимый review отделены от synthesis и decision closure. | S02, S03, S05, S06, S14, S15, S18, S19, S20, S21, S22, S27 |
| Proposal ≠ Decision | Proposal становится decision только через явный closure с проверкой authority. | S02, S03, S18, S22 |
| Consensus ≠ Evidence | Совпадение моделей не подтверждает внешний факт; epistemic status меняет только evidence. | S16, S21, S25, S26 |
| Baseline ≠ Immutable | Baseline — контролируемая версия, а не запрет изменений. Изменения идут через CHG и impact propagation. | S13, S17, S30, S06, S10, S19, S25, S26, S28 |

### 4.6 Gates

**G1**

- Все blocking product decisions закрыты или явно отложены
- OPEN помечены non-blocking и видны в Known Unknowns
- Deferred scope перечислен явно
- Трасса «решение → возможность → требование» полная

**G2**

- У каждого ограничения есть verification status
- Фактами названы только VERIFIED
- Все модели получают идентичный пакет одной версии
- Decision boundaries и invariants зафиксированы

**G3**

- У направления есть явный rationale
- Класс полномочий соответствует Decision Policy
- Evidence-зависимое вынесено как blockers

**G4**

- Нет blocking issues
- ADR записаны
- Трасса «требование → архитектурное решение → evidence» без разрывов
- Опровергнутые assumptions отражены через change events

### 4.7 Baselines

| Baseline | Этапы | Фиксируется на | Состав |
| --- | --- | --- | --- |
| Product Functional Baseline (PFB) | S01–S13 | S13 | Product Idea; Decision Policy; Product Concept; Functional Map; Functional Specification; Closed Product Decisions; Known Unknowns; Deferred Scope |
| Architecture Input Package (AIP) | S14–S17 | S17 | Product Functional Baseline; verified constraints; Validation Registry; quality attributes; invariants; decision boundaries |
| Conceptual Architecture Baseline (CAB) | S18–S30 | S30 | Revised Conceptual Architecture; ADR Set; Traceability Report; Non-blocking Unknowns; история изменений |

## 5. Вопросы к автору и несоответствия

### 5.1 Вопросы (результат применения формата к файлу)

- **Q1.** Решаемая задача: задаётся запуском или есть типовая формулировка?
- **Q2.** Исходные данные: что обязательно в идее продукта и в какой форме она подаётся?
- **Q3.** Применение результата: кто и как использует Conceptual Architecture Baseline?
- **Q4.** Форма итоговых документов (Baseline, ADR Set, Traceability Report): формат и структура.
- **Q5.** Границы: чего процесс не гарантирует (формулировка для читателя).
- **Q6.** Критерии качества этапов, кроме S13, S17, S22, S30 (у остальных 26 этапов критериев нет).
- **Q7.** Сколько участников на независимых этапах (в файле «не менее 2») и какие модели.
- **Q8.** Предел длины ответа по этапам.
- **Q9.** Названия этапов и выходов для людей: в файле английские, русские есть только для S01–S05.
- **Q10.** Условия возвратов: файл описывает их текстом («по типу», «по исходу»); нужны точные признаки.

### 5.2 Несоответствия с Basic (решает автор до формирования схемы)

| Требование спецификации | Что умеет Basic сегодня | Решение |
| --- | --- | --- |
| Возвраты на более ранний этап (раздел 2.3) | Шаги выполняются один раз по порядку, возвратов нет | ❓ |
| Gate: проверка критериев и остановка | Нет проверки критериев готовности; остановку даёт только причина остановки движка | ❓ |
| Вход этапа — конкретные результаты любых прошлых этапов | Режимы входа: нет / предыдущий шаг / все предыдущие | ❓ |
| Участие владельца на конкретных этапах | Политика запуска auto/manual для всего прогона и вопросы владельцу внутри запроса | ❓ |
| Выход заданной формы (объекты с полями, 4.3) | Выход — текст ответа; форму задаёт только текст задания | ❓ |
| Этап из нескольких ролей по очереди (напр. Reviewer + Producer) | Роль задаётся модели в шаге; последовательность ролей одной модели не выражается | ❓ |
| Правила и критерии на уровне этапа | Попадают только в текст задания; не проверяются | ◐ |
| Ветвления и условные переходы | Нет | ❓ |
