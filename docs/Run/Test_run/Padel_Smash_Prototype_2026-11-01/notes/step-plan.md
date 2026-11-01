# План шагов (из schema/schema.json)

Старт: 2026-11-01. Бюджет: шаг ≤ 20 мин, прогон ≤ 3 ч. Wake-lock: `caffeinate -dimsu -t 10800`.

| ID шага | Роль | Модель | Входные материалы | Ожидаемый артефакт | Сессия | Обязательный |
|---|---|---|---|---|---|---|
| r1-gpt-ux | Сценарий и экраны | GPT (High) | task.txt | exports/r1_gpt-ux.md | fresh | да |
| r1-deepseek-tech | Техника смэша, каталог ошибок | DeepSeek (DeepThink, без поиска) | task.txt | exports/r1_deepseek-tech.md | fresh | да |
| r1-perplexity-method | Сравнение с эталоном, аналоги | Perplexity (Kimi K3 Рассуждение) | task.txt | exports/r1_perplexity-method.md | fresh | нет |
| r2-claude-architect | Архитектор, свод | Claude (Sonnet 5.5) | r1 (три ответа) | artefacts/proposal_r2.md (Проект прототипа v1) | fresh | да |
| r3-gpt-audit | Аудит сценария | GPT (High) | проект v1 | exports/r3_gpt-audit.md | fresh | нет |
| r3-deepseek-audit | Аудит техники | DeepSeek (DeepThink) | проект v1 | exports/r3_deepseek-audit.md | fresh | нет |
| r4-claude-architect | Итог | Claude (Sonnet 5.5) | проект v1 + замечания | artefacts/proposal_final.md | reuse (чат r2) | да |

Шаг «Человек» (owner:ok) в схеме нет: решения координатора — в notes/owner_decisions.md. Порядок строго последовательный (вкладка с генерацией — активная).

Отступления от поручения: вместо mosquito-trap-v4 собрана новая схема по его устройству — в v4 участвует Gemini (запрещён в model-modes.md), а задача и результат другие. Решение координатора.
