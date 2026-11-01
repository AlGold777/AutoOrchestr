# Отчёт координатора

**Статус:** завершён (все шаги, 7 запросов к моделям, около 40 минут).
**Итоговый документ:** [artefacts/proposal_final.md](../artefacts/proposal_final.md) — «Проект прототипа v2 — Padel Smash Coach».

Задача: проект кликабельного HTML-прототипа «спортсмен снимает смэш в падел, приложение сравнивает с эталоном тренера и показывает ошибки с советом». Решения владельца: кликабельный HTML, имитация анализа на заготовках, смэш, эталон записывает тренер в том же приложении, результат — список ошибок с советами и кадр с разметкой.

## Шаги

| Шаг | Модель | Чат | Результат |
|---|---|---|---|
| r1-gpt-ux | ChatGPT (High) | https://chatgpt.com/c/6ae71e24-1db4-83eb-a530-dba5415055cf | exports/r1_gpt-ux.md (61 тыс. симв., избыточно) |
| r1-deepseek-tech | DeepSeek (DeepThink, без поиска) | https://chat.deepseek.com/a/chat/s/c87e4c0f-50e0-4f34-b7ce-2f394c82b90f | exports/r1_deepseek-tech.md |
| r1-perplexity-method | Perplexity (Kimi K3 Рассуждение) | https://www.perplexity.ai/search/41605fae-56f6-4965-aa88-04dfb9624a0c | exports/r1_perplexity-method.md |
| r2-claude-architect | Claude Sonnet 5.5 | https://claude.ai/chat/104a3da2-c980-4be8-98f3-43b9a4ac1601 | artefacts/proposal_r2.md (v1) |
| r3-gpt-audit | ChatGPT (High) | https://chatgpt.com/c/6ae7223d-d538-83ed-9cdc-61d8b4a7aa3e | 13 замечаний, 5 блокирующих |
| r3-deepseek-audit | DeepSeek (DeepThink, без поиска) | https://chat.deepseek.com/a/chat/s/252f6aed-aa67-4ed7-a4d0-2aa9519f4636 | 5 замечаний, важность низкая/средняя |
| r4-claude-architect | Claude Sonnet 5.5 (тот же чат) | то же, что r2 | artefacts/proposal_final.md (v2) |

## Отступления от схемы и поручения (что изменено → почему)

- mosquito-trap-v4 → новая схема: в v4 есть Gemini (запрещён model-modes.md), задача и результат другие.
- В первом запросе GPT не было предела длины → ответ 3 789 слов вместо 700; для остальных запросов предел добавлен.
- Qwen, Mistral, Z.ai, Grok не использованы (необязательные, не нужны).
- Кнопка «Копировать» на Claude и Perplexity через JS не пишет в буфер; ответы взяты из DOM (Claude — через конвертер в markdown, Perplexity — innerText).

## Допущения моделей (все названы в начале ответов)

- «Смэш (верхняя подача на отбой)» понят как плоский смэш (remate plano), не подача: это просьба владельца, но в падел отбой над головой — не подача. Оба аудитора и итог опираются на это допущение — проверить на владельце.
- Ракурс — сбоку, игрок правша, два удара в подходе; каталог ошибок редакционный, тренер его не проверял.

## Решения шага «Человек»
См. notes/owner_decisions.md.

## Сбои и что не удалось

- Реальных видео и проверки каталога тренером нет.
- Perplexity: ссылки на аналоги (SwingVision, Onform, Padel Coach и др.) модель частично пометила «ссылка не проверена»; в итог не перенесены.
- Прототип HTML не собирался — только проект.
- Claude записал содержимое чата в память аккаунта («Обновлена память»).
