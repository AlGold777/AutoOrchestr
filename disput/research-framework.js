// Stage catalogue of the "Research" pipeline template, written by hand from
// docs/scenarios/research-2.0.md (the Architecture catalogue is generated; this one is the source).
// Same shape as disput/architecture-framework.js, reached through disput/stage-templates.js.
//
// What the template does and does not do (see docs/scenarios/research-template.md):
//   - the prompts below carry the stage contracts of the scenario;
//   - the steps that need code around the models (fetching source pages, a mechanical quote
//     check, orchestrator-assigned claim ids, request counters) are not part of this catalogue.
(function initResearchFramework(root) {
  'use strict';

  const PHASES = {
    frame: 'Постановка',
    questions: 'Вопросы и план',
    material: 'Материал',
    check: 'Проверка',
    result: 'Итог'
  };

  const list = (items) => (Array.isArray(items) ? items : []).map(String).filter(Boolean);
  const bullets = (items) => list(items).map((item) => `- ${item}`).join('\n');

  function buildInstruction(stage) {
    const parts = [`Этап ${stage.n}. ${stage.titleRu} (${stage.title}).`];
    if (stage.who === 'gate') {
      parts.push(stage.gateNote || 'Это ворота: модель не запускается. Модератор проверяет результат предыдущих этапов и решает, идти ли дальше.');
    }
    if (list(stage.inputs).length) parts.push(`Входы:\n${bullets(stage.inputs)}`);
    if (list(stage.allowed).length) parts.push(`Что нужно сделать:\n${bullets(stage.allowed)}`);
    if (list(stage.forbidden).length) parts.push(`Чего делать нельзя:\n${bullets(stage.forbidden)}`);
    if (list(stage.rules).length) parts.push(`Правила: ${list(stage.rules).join('; ')}.`);
    if (stage.independent) parts.push('Этап независимый: не опирайся на ответы других моделей этого этапа.');
    return parts.join('\n\n');
  }

  const RULE_AGREEMENT = 'Согласие моделей не подтверждение: подтверждает проверенный источник';
  const RULE_NO_INVENTED = 'Источники и цитаты не выдумывать; нет данных — так и написать';
  const RULE_SPEC = 'Утверждённая спецификация неизменна; сужение объёма записывается';

  const SOURCE = [
    { n: 1, title: 'Research Specification', titleRu: 'Спецификация исследования', phase: 'frame',
      roles: ['Постановщик'], purpose: 'position', who: 'lead',
      inputs: ['Вопрос пользователя'],
      allowed: [
        'Записать вопрос пользователя дословно и отдельно — что в исследование не входит',
        'Пометить противоречия во входе, не разрешая их',
        'Описать главный вопрос своими словами: для кого и зачем нужен ответ',
        'Задать границы (период, регион, область), глубину и что считается хорошим источником',
        'Для каждой части отчёта (ответ коротко; что установлено; спорные места; непроверенное и отвергнутое; что не выяснено; ограничения; источники) записать критерий готовности и допустимую неопределённость',
        'Отдельно перечислить допущения, сделанные тобой',
        'Если нужен ответ владельца — оформить вопрос с вариантами ответа маркером ASK'
      ],
      forbidden: ['Отвечать на вопрос по существу', 'Добавлять свои цели', 'Молча сужать вопрос'],
      rules: [RULE_SPEC], creates: ['Спецификация исследования'], modifies: [] },
    { n: 2, title: 'Specification Review', titleRu: 'Проверка спецификации', phase: 'frame',
      roles: ['Критик'], purpose: 'critique', who: 'review',
      inputs: ['Вопрос пользователя', 'Спецификация исследования'],
      allowed: [
        'Найти двусмысленности, слишком широкие места и допущения, которые меняют смысл вопроса',
        'Сверить спецификацию с дословным вопросом пользователя',
        'Каждое замечание пометить «существенное» или «мелкое» и предложить правку'
      ],
      forbidden: ['Переписывать спецификацию целиком', 'Исследовать тему'],
      rules: [RULE_SPEC], creates: ['Замечания к спецификации'], modifies: [] },
    { n: 3, gate: 'G1', title: 'Specification Approval', titleRu: 'Утверждение спецификации', phase: 'frame',
      roles: [], purpose: 'human_judgment', who: 'gate',
      inputs: ['Спецификация исследования', 'Замечания к спецификации', 'Ответы владельца на вопросы'],
      allowed: ['Утвердить спецификацию или вернуть её на доработку (этап 1)'],
      forbidden: ['Менять утверждённую спецификацию без записи изменения объёма'],
      rules: [RULE_SPEC], creates: ['Утверждённая спецификация'], modifies: [] },
    { n: 4, title: 'Independent Question Splits', titleRu: 'Независимые разбиения вопроса', phase: 'questions',
      roles: ['Исследователь'], independent: true, purpose: 'position', who: 'all',
      inputs: ['Утверждённая спецификация'],
      allowed: [
        'Разбить главный вопрос на вопросы (до 8) так, чтобы ответы на них вместе давали результат',
        'Для каждого вопроса записать: что установить; тип ответа (факт, число, список, механизм, оценка); от каких вопросов он зависит; критерий «ответ получен»',
        'Не ставить вопросов, на которые нельзя ответить ни из источников, ни из согласия моделей'
      ],
      forbidden: ['Искать и отвечать на вопросы', 'Выходить за границы спецификации', 'Смотреть чужие разбиения'],
      rules: [RULE_SPEC], creates: ['Разбиение вопроса'], modifies: [] },
    { n: 5, title: 'Question Tree', titleRu: 'Дерево вопросов', phase: 'questions',
      roles: ['Сводчик'], purpose: 'synthesis', who: 'lead',
      inputs: ['Утверждённая спецификация', 'Разбиения вопроса от всех моделей'],
      allowed: [
        'Свести разбиения в одно дерево: слить повторы; вопрос, предложенный одной моделью, сохранить, если он в границах',
        'Расставить зависимости и важность вопросов',
        'Оставить не больше 8 вопросов; всё, что не вошло, записать отдельным списком с причиной (это сокращение объёма)',
        'Проверить, что дерево покрывает каждую часть спецификации'
      ],
      forbidden: ['Молча выбросить вопрос', 'Менять спецификацию', 'Добавлять вопросы вне спецификации'],
      rules: [RULE_SPEC], creates: ['Дерево вопросов', 'Список сокращений объёма'], modifies: [] },
    { n: 6, title: 'Evidence Plan', titleRu: 'План доказательств', phase: 'questions',
      roles: ['Проектировщик доказательств'], purpose: 'position', who: 'lead',
      inputs: ['Дерево вопросов', 'Утверждённая спецификация'],
      allowed: [
        'Для каждого вопроса записать источник истины: внешние источники; документы пользователя; владелец; только согласие независимых моделей',
        'Записать, что считается достаточным: типы источников, приоритет первоисточников, свежесть, сколько независимых подтверждений нужно',
        'Записать ракурсы поиска; один из них обязательно «опровержения и критика»',
        'Записать поисковые запросы',
        'Вопросы, ответ на которые может дать только владелец, оформить маркером ASK с вариантами'
      ],
      forbidden: ['Делать выводы по существу темы'],
      rules: [RULE_AGREEMENT], creates: ['План доказательств'], modifies: [] },
    { n: 7, title: 'Evidence Collection', titleRu: 'Сбор материалов', phase: 'material',
      roles: ['Исследователь'], independent: true, purpose: 'position', who: 'all',
      inputs: ['Утверждённая спецификация', 'Дерево вопросов', 'План доказательств'],
      allowed: [
        'По каждому вопросу найти материалы; искать и подтверждения, и опровержения',
        'Для каждого материала записать: источник (название, автор или организация, дата, тип, ссылка); цитату дословно; точное место (раздел, страница, абзац); к какому вопросу относится и подтверждает он или опровергает; ограничения доверия',
        'Брать факты, даты, числа и цитаты; оценочные суждения источника не брать',
        'Если данных нет — писать «нет данных»'
      ],
      forbidden: ['Придумывать ссылки и цитаты', 'Выдавать память за источник', 'Делать общие выводы', 'Пропускать вопрос молча', 'Смотреть чужие материалы'],
      rules: [RULE_NO_INVENTED, RULE_AGREEMENT], creates: ['Материалы'], modifies: [] },
    { n: 8, title: 'Claim Extraction', titleRu: 'Извлечение и сведение утверждений', phase: 'material',
      roles: ['Сводчик'], purpose: 'synthesis', who: 'lead',
      inputs: ['Материалы от всех моделей', 'Дерево вопросов'],
      allowed: [
        'Выделить из материалов отдельные утверждения, по одному факту в каждом; каждому дать номер',
        'Для каждого утверждения записать: точное место в источнике; «прямое свидетельство» или «толкование»; кто нашёл',
        'Слить одинаковые утверждения, сохранив номера исходных и всех нашедших',
        'Составить таблицу противоречий: что с чем и в чём расходится',
        'Составить список источников без повторов; источник, пересказывающий другой, независимым не считать'
      ],
      forbidden: ['Терять утверждения', 'Разрешать противоречия', 'Менять смысл утверждений при пересказе'],
      rules: [RULE_NO_INVENTED], creates: ['Список утверждений', 'Таблица противоречий', 'Список источников'], modifies: [] },
    { n: 9, title: 'Claim Verification', titleRu: 'Проверка утверждений', phase: 'check',
      roles: ['Проверяющий'], purpose: 'verification', who: 'review',
      inputs: ['Список утверждений', 'Список источников', 'План доказательств'],
      allowed: [
        'По источнику каждого утверждения проверить: существует ли источник; говорит ли он то, что ему приписано (привести цитату или точное место); верны ли дата и автор; подходит ли источник под требование плана',
        'Поставить отметку: «принято» (есть цитата и выполнено требование плана); «пробел» (указать вид нехватки: нет факта, нет доверия, нет независимости, источник не открыт, нужен ответ владельца, проверить нельзя); «противоречие»; «отклонено»',
        'Битая ссылка опровергает доказательство, а не факт: утверждение без подтверждения получает «пробел», а не «отклонено»',
        'Если источник не удалось открыть — написать «не удалось открыть»'
      ],
      forbidden: ['Ставить «принято» без цитаты или точного места', 'Опираться на то, что «так принято считать»', 'Проверять собственные утверждения'],
      rules: [RULE_AGREEMENT, RULE_NO_INVENTED], creates: ['Отметки проверки'], modifies: [] },
    { n: 10, title: 'Contradiction Resolution', titleRu: 'Разбор противоречий', phase: 'check',
      roles: ['Судья'], purpose: 'evidence_review', who: 'review',
      inputs: ['Таблица противоречий', 'Отметки проверки', 'Список утверждений'],
      allowed: [
        'По каждому противоречию сопоставить версии: качество и первичность источников, даты, определения, область применимости',
        'Вынести решение: версия А; версия Б; обе верны при условиях (каких); нужно больше данных (каких); не решено — с основанием и ссылками на утверждения',
        'Разобрать не больше 4 противоречий, самые важные первыми; остальные пометить «не решено, не разбиралось»'
      ],
      forbidden: ['Решать по большинству моделей', 'Усреднять несовместимое', 'Выбирать версию без ссылки на источник'],
      rules: [RULE_AGREEMENT], creates: ['Решения по противоречиям'], modifies: [] },
    { n: 11, gate: 'G2', title: 'Sufficiency Gate', titleRu: 'Достаточность материала', phase: 'check',
      roles: [], purpose: 'human_judgment', who: 'gate',
      inputs: ['Отметки проверки', 'Решения по противоречиям', 'Дерево вопросов', 'План доказательств'],
      allowed: [
        'По каждому важному вопросу посмотреть, закрыт ли он проверенными утверждениями',
        'Идти к отчёту или вернуться к сбору (этапы 7–10) только по проблемным вопросам, не больше 2 раз',
        'Дополнительный круг назначать, только если предыдущий добавил проверенное утверждение или закрыл пробел'
      ],
      forbidden: ['Назначать круг, который ничего не добавит'],
      rules: [RULE_AGREEMENT], creates: [], modifies: [] },
    { n: 12, title: 'Report', titleRu: 'Отчёт', phase: 'result',
      roles: ['Составитель'], purpose: 'synthesis', who: 'lead',
      inputs: ['Утверждённая спецификация', 'Список утверждений', 'Отметки проверки', 'Решения по противоречиям', 'Список сокращений объёма'],
      allowed: [
        'Написать отчёт из семи частей: 1 Ответ коротко (3–7 предложений); 2 Что установлено; 3 Спорные места и решения; 4 Непроверенное и отвергнутое; 5 Что не удалось выяснить (в том числе сокращения объёма); 6 Ограничения и остаточный риск; 7 Источники со статусом проверки',
        'В части 2 у каждого утверждения указать номер, источник, место и степень уверенности',
        'Степень уверенности: «надёжно» — принято по двум и более независимым источникам; «вероятно» — принято по одному; «согласовано» — только если планом источник истины «согласие моделей»; «слабо» — подтверждённого источника нет, но два исследователя независимо назвали то же; «спорно» — противоречие не решено',
        'Установленное отделять от толкования; причинные связи — только где они обоснованы'
      ],
      forbidden: ['Писать утверждение без номера', 'Повышать степень уверенности', 'Добавлять факты вне списка утверждений', 'Помещать отклонённое, спорное и непроверенное в часть 2', 'Менять спецификацию'],
      rules: [RULE_AGREEMENT, RULE_SPEC], creates: ['Отчёт'], modifies: [] },
    { n: 13, title: 'Report Critique', titleRu: 'Критика отчёта', phase: 'result',
      roles: ['Критик'], purpose: 'critique', who: 'review',
      inputs: ['Отчёт', 'Утверждённая спецификация'],
      allowed: [
        'Ты не участвовал в написании отчёта. Найти: выводы без опоры; перепутанную причинность; пропущенные контрсвидетельства; чрезмерную уверенность; односторонность источников; части спецификации, которые не покрыты',
        'Каждое замечание записать с местом в отчёте и видом: «исправить текст» или «не хватает доказательства», и пояснением'
      ],
      forbidden: ['Добавлять новые факты', 'Переписывать отчёт'],
      rules: [RULE_AGREEMENT], creates: ['Замечания критика'], modifies: [] },
    { n: 14, title: 'Report Acceptance', titleRu: 'Приёмка отчёта', phase: 'result',
      roles: ['Проверяющий'], purpose: 'verification', who: 'review',
      inputs: ['Отчёт', 'Утверждённая спецификация', 'Список утверждений', 'Замечания критика'],
      allowed: [
        'Сверить отчёт с утверждённой спецификацией по каждой части отчёта и критерию готовности: «выполнено», «не выполнено» или «ограничено»',
        'Проверить: у каждого утверждения есть номер, источник и место; степень уверенности соответствует правилам; в части 2 нет отклонённого, спорного и непроверенного; все решения по противоречиям попали в часть 3; каждое замечание критика исправлено или отклонено с основанием',
        'Сверить смысл: утверждения отчёта не искажены и не усилены относительно списка утверждений',
        'При отказе назвать самый ранний этап, где возник дефект'
      ],
      forbidden: ['Исправлять отчёт', 'Принимать при невыполненных критериях без пометки «ограничено»'],
      rules: [RULE_AGREEMENT, RULE_SPEC], creates: ['Заключение о приёмке'], modifies: [] },
    { n: 15, gate: 'G3', title: 'Result Acceptance', titleRu: 'Приёмка результата', phase: 'result',
      roles: [], purpose: 'human_judgment', who: 'gate',
      inputs: ['Отчёт', 'Заключение о приёмке', 'Замечания критика'],
      allowed: ['Принять отчёт, вернуть к правке (этап 12) или вернуть к добору материала (этапы 7–10)'],
      forbidden: ['Принимать отчёт, не прошедший приёмку, без пометки в части 6'],
      rules: [RULE_SPEC], creates: [], modifies: [] }
  ];

  const STAGES = SOURCE.map((stage) => ({
    n: stage.n,
    title: stage.title,
    titleRu: stage.titleRu,
    phase: stage.phase,
    phaseRu: PHASES[stage.phase] || stage.phase,
    roles: list(stage.roles),
    independent: stage.independent === true,
    gate: stage.gate || null,
    purpose: stage.purpose,
    who: stage.who,
    inputs: list(stage.inputs),
    allowed: list(stage.allowed),
    forbidden: list(stage.forbidden),
    rules: list(stage.rules),
    creates: list(stage.creates),
    modifies: list(stage.modifies),
    // The gate that follows this stage (the next stage is a gate): the run stops there for the moderator.
    gateAfter: (SOURCE.find((item) => item.n === stage.n + 1) || {}).gate || null,
    instruction: buildInstruction(stage)
  }));

  const freezeDeep = (value) => {
    if (value && typeof value === 'object') Object.values(value).forEach(freezeDeep);
    return Object.freeze(value);
  };
  freezeDeep(STAGES);

  const byNumber = (n) => STAGES.find((stage) => stage.n === Number(n)) || null;

  // Which of the selected models work at a stage. Order of `models` matters: the first one leads,
  // the next one reviews, so the reviewer is never the author when there are two or more.
  function participantsFor(stage, models = []) {
    const list = Array.isArray(models) ? models.filter(Boolean) : [];
    if (!stage || !list.length || stage.who === 'gate') return [];
    if (stage.who === 'all') return list.slice();
    if (stage.who === 'review') return [list[1 % list.length]];
    return [list[0]];
  }

  const api = Object.freeze({ VERSION: 1, STAGES, PHASES, byNumber, participantsFor });
  root.ResearchFramework = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
