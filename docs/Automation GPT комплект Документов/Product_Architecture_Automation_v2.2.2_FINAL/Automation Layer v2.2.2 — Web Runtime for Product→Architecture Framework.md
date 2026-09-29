Automation Layer v2.2.2 — Web Runtime for Product→Architecture Framework

Статус: Final
Версия: 2.2.2
Назначение: надёжное автоматизированное исполнение полного Product→Architecture Framework через обычные веб-интерфейсы LLM с DOM-управлением, без зависимости от model API, structured output API, function calling или finish_reason.

Профиль v2.2.2: consolidated patch release поверх v2.2; четыре implementation blockers закрыты непосредственно в нормативном контракте. Все неизменённые trust boundaries, browser-runtime правила, authority/evidence model, transactional StateCommit, recovery, gates и baselines сохраняются. Изменения v2.2 сосредоточены в структурном semantic response protocol, сборке контекста, snapshot integrity и машинной проверяемости межмодельного обмена.

Нормативный semantic contract: AL-STRUCT-1.
Принцип совместимости: v2.2 не удаляет элементы v2.1 без явной замены; новое поведение добавляется поверх существующей архитектуры.

1. Назначение системы

Automation Layer v2.2.2 превращает декларативный Product→Architecture Framework в исполняемую систему, способную:

-
принять свободную продуктовую идею;

-
автоматически провести model stages;

-
сформировать закрытый questionnaire для Owner;

-
детерминированно скомпилировать ответы;

-
выполнить 30-stage Product→Architecture process;

-
запускать независимые модели через web interfaces;

-
проверять evidence;

-
управлять fan-out / fan-in;

-
поддерживать immutable baselines;

-
отслеживать provenance и изменения;

-
восстанавливаться после browser/process crashes;

-
завершаться либо корректным результатом, либо формальным terminal state.

Web UI модели не является частью доверенной архитектуры.

2. Главный архитектурный принцип

Система разделена на независимые trust domains:

Product→Architecture Framework
│
▼
Deterministic Orchestrator
│
▼
Browser Runtime
│
▼
Provider Adapter
│
▼
Untrusted Web UI
│
▼
LLM

Обратный путь:

LLM response
│
▼
Untrusted DOM
│
▼
Transport verification
│
▼
Semantic response
│
▼
Schema / authority / evidence /
provenance / coverage validation
│
▼
Trusted ResponseEnvelope
│
▼
Atomic StateCommit
│
▼
Ledger + Registry + Baselines

3. Trust Model

3.1. LLM

LLM считается недетерминированным semantic producer.

Она может:

-
анализировать переданный snapshot;

-
создавать semantic proposals;

-
создавать findings;

-
предлагать mutations;

-
формировать routes;

-
формировать dispositions;

-
предлагать questions;

-
интерпретировать domain content.

Она не может:

-
создавать canonical object IDs;

-
определять object versions;

-
создавать run_id;

-
определять transport completion;

-
вычислять authoritative hashes;

-
утверждать gate;

-
создавать baseline;

-
расширять собственные полномочия;

-
выдавать себя за Owner;

-
выдавать себя за Human Tester;

-
самостоятельно превращать model analysis в VERIFIED evidence;

-
коммитить состояние.

3.2. Web UI

Web UI считается ненадёжным транспортом.

Допускаются:

-
DOM drift;

-
A/B variants;

-
markdown rendering;

-
streaming;

-
временные паузы;

-
partial rendering;

-
virtualized message lists;

-
delayed updates;

-
login expiry;

-
CAPTCHA;

-
rate limits;

-
provider-side model switching;

-
hidden account memory;

-
failed tabs;

-
browser crashes.

Ни одно такое событие не должно само по себе изменять project state.

3.3. Orchestrator

Orchestrator является единственным execution authority.

Он отвечает за:

-
stage scheduling;

-
snapshots;

-
prompt compilation;

-
run identity;

-
attempt identity;

-
browser execution;

-
validation;

-
ID allocation;

-
policy enforcement;

-
atomic state commit;

-
recovery;

-
routing;

-
stale propagation;

-
baseline construction.

3.4. Ledger

Append-only Ledger является единственным durable source of truth.

Registry, Gate State, Baselines, queues и прочие views являются projections, восстанавливаемыми из Ledger.

4. Слои системы

L0  FRAMEWORK
stages · objects · roles · gates · baselines

L1  STATE
Ledger · Registry · Snapshots · Baselines

L2  CONTROL FLOW
Scheduler · FSM · loops · waits · queues

L3  POLICY
DPL · authority · evidence · risk

L4  EXECUTION CORE
Prompt Compiler · Validators · StateCommitter

L5  SEMANTIC PROTOCOL
result · operations · routes · dispositions

L6  TRANSPORT PROTOCOL
CALL_TOKEN · ATTEMPT_TOKEN · response frame

L7  BROWSER RUNTIME
tabs · conversations · adapters · health

L8  RECOVERY
replay · idempotency · crash recovery

L9  OBSERVABILITY
telemetry · diagnostics · adapter health

5. Browser Adapter Contract

Каждый provider имеет отдельный adapter:

ChatGPTWebAdapter
ClaudeWebAdapter
GeminiWebAdapter
GrokWebAdapter
QwenWebAdapter
...

Adapter обязан реализовывать:

preflight()
openFreshConversation()
identifyConversation()
locatePromptInput()
insertPrompt()
verifyPromptDraft()
submitPrompt()
extractSubmittedUserMessage()
verifySubmittedPrompt()
locateAssistantMessage()
observeGenerationState()
observeTerminalState()
extractAssistantRawText()
detectRateLimit()
detectAuthenticationRequired()
detectCaptcha()
detectUiAmbiguity()
closeConversation()

6. Adapter Pre-flight

До любого рабочего вызова adapter обязан доказать:

AUTH_OK
NEW_CHAT_OK
INPUT_FOUND
SUBMIT_OK
USER_MESSAGE_READABLE
ASSISTANT_MESSAGE_READABLE
GENERATION_STATE_OBSERVABLE
TERMINAL_STATE_OBSERVABLE

Если хотя бы одно critical capability отсутствует:

ADAPTER_UNSAFE

и production auto-commit через этот provider запрещён.

7. UI drift

Один selector failure не означает автоматически WEB_UI_CHANGED.

Выполняется bounded health sequence:

1. page-ready check
2. primary selectors
3. alternate selectors текущего profile
4. structural/accessibility lookup
5. reload
6. fresh tab
7. canary interaction
8. repeat up to health_retry_limit

Только после устойчивой неоднозначности:

WEB_UI_CHANGED
adapter = QUARANTINED

Система предпочитает false-stop ложному успешному исполнению.

8. Conversation Isolation

8.1. Default

Каждый independent semantic run:

FRESH_CONVERSATION

Model run не получает:

-
sibling outputs;

-
предыдущие attempts других runs;

-
ненужную историю проекта;

-
предыдущие architecture candidates;

-
результаты review, которые не входят в snapshot.

8.2. Уровни isolation assurance

Fresh conversation доказывает только:

CONVERSATION_ISOLATED

Она не доказывает автоматически:

PROVIDER_MEMORY_ISOLATED

Поэтому runtime хранит:

isolation_assurance:
CONVERSATION_ONLY
PROVIDER_MEMORY_CONTROLLED
FULL_PROFILE_ISOLATED

Если provider имеет недоступную для контроля account memory:

PROVIDER_MEMORY_ISOLATED = UNKNOWN

Система не выдаёт это за доказанную независимость.

9. Run Identity

Каждый semantic run имеет machine-owned:

run_id
stage_id
input_snapshot_id
input_snapshot_hash

Каждый отдельный web call имеет:

call_id
attempt_id
CALL_TOKEN
ATTEMPT_TOKEN

Пример:

run_id             = RUN-0193
attempt_id         = ATT-02
input_snapshot_id  = SNAP-0193-S11
input_snapshot_hash = <64 lowercase hex>
CALL_TOKEN         = W7K9-Q2F4
ATTEMPT_TOKEN      = A02-X71P

Tokens не являются domain data.

input_snapshot_hash вычисляется Runtime из стабильной сериализации frozen input snapshot. Модель не вычисляет hash и не изменяет его: она только копирует значение, переданное в ACTIVE/passport. Несовпадение означает, что ответ относится не к тому snapshot, и response отклоняется.

10. Prompt Frame

Внешний transport frame v2.1 сохраняется:

<<<PAF_CALL W7K9-Q2F4 A02-X71P>>>

[compiled prompt]

<<<END_PAF_CALL W7K9-Q2F4 A02-X71P>>>

Внутри compiled prompt v2.2 использует детерминированную layered assembly:

RULES
↓
STATE
↓
ACTIVE
↓
DELTA
↓
TASK

RULES содержит immutable stage/contract/policy instructions.

STATE содержит machine-owned project state и компактную Registry projection.

ACTIVE содержит exact input_refs текущего вызова, input_snapshot_id, input_snapshot_hash и только те prior outputs, которые разрешены stage contract.

DELTA содержит новые/изменённые refs относительно уже известного состояния. Наличие слоя DELTA не означает введение полного delta-only mutation protocol.

TASK содержит конкретную задачу текущего вызова.

Исторические chat transcripts не являются нормативным способом построения prompt.

11. Data / Instruction Separation

Prompt Compiler обязан структурно разделять:

SYSTEM INSTRUCTIONS
STAGE CONTRACT
POLICY
UNTRUSTED INPUT DATA
OUTPUT CONTRACT

В v2.2 это физически выражается через layered prompt:

RULES → STATE → ACTIVE → DELTA → TASK.

Любой Registry payload, imported text, IDEA, model-generated object или external content рассматривается как:

UNTRUSTED_DATA

и никогда не интерполируется в instructional section.

Payload не может:

-
менять role;

-
менять schema;

-
менять authority;

-
включать tool permission;

-
менять route policy;

-
расширять DPL.

Registry внутри STATE передаётся reference-first. Для существующих объектов предпочтительны ObjectRef + content_hash + source_refs; полный повтор canonical content допускается только если он действительно нужен stage contract.

Модель не должна повторно цитировать существующий объект только ради ссылки на него. Для ссылки используется canonical ID/version, доступный во входном snapshot.

Это обеспечивает control-plane containment, но не заявляет абсолютную immunity от semantic prompt injection.

Residual semantic influence считается отдельным риском и покрывается review/evidence/traceability.

12. Проверка доставленного prompt

Проверка prompt delivery обязательна.

После submit adapter обязан извлечь фактически отображённый user-message.

Перед сравнением выполняется deterministic transport-text canonicalization: нормализация line endings, удаление BOM/zero-width transport noise, outer whitespace и избыточных пустых строк в пределах явно заданной policy.

Runner сравнивает:

canonicalize(rendered_user_message)
==
canonicalize(compiled_prompt)

или их cryptographic hash.

При этом различаются:

input_snapshot_hash — hash frozen semantic input state;

prompt_hash — hash фактически compiled prompt.

Они не взаимозаменяемы.

Если exact reconstruction невозможно:

INPUT_TRANSPORT_UNVERIFIABLE

Такой вызов не допускается к production commit.

Наличие только CALL_TOKEN не доказывает полноту prompt.

13. Assistant Message Correlation

До submit фиксируется:

assistant_nodes_before
conversation_id
tab_id
call_id
attempt_id

Допустим только assistant node:

-
созданный после submit;

-
принадлежащий текущей conversation;

-
содержащий текущий CALL_TOKEN;

-
содержащий текущий ATTEMPT_TOKEN.

Нельзя использовать правило:

take last assistant message

14. Response Frame

Transport frame v2.1 сохраняется. Внутри него v2.2 требует один JSON-object по AL-STRUCT-1:

<<<PAF_RESPONSE W7K9-Q2F4 A02-X71P>>>
{
  "passport": {
    "contract": "AL-STRUCT-1",
    "stage": "SXX",
    "input_snapshot_id": "SNAP-...",
    "input_snapshot_hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "input_refs": []
  },
  "outputs": [],
  "annotations": [],
  "trace": [],
  "input_fate": [],
  "changes": [],
  "completion": {
    "status": "COMPLETE",
    "output_ids": [],
    "output_count": 0,
    "empty_by_design": false,
    "anomalies": []
  }
}
<<<END_PAF_RESPONSE W7K9-Q2F4 A02-X71P>>>

Разрешена ровно одна response frame и ровно один AL-STRUCT-1 response-object.

Транспортные CALL_TOKEN/ATTEMPT_TOKEN остаются transport-owned и не переносятся в model-controlled semantic payload.

15. Transport Parser

Parser выполняет:

1. find exact opening marker
2. validate CALL_TOKEN
3. validate ATTEMPT_TOKEN
4. find exact closing marker
5. require exactly one frame
6. extract interior
7. optionally strip one outer JSON markdown fence
8. parse exactly one JSON object
9. verify no meaningful trailing assistant content

Если после END_PAF_RESPONSE имеется meaningful assistant text:

FRAME_TRAILING_CONTENT

Response invalid.

16. Generation Completion

DOM_stable не является доказательством завершения.

Нормативная формула:

transport_complete =
response_frame_complete
AND provider_terminal_state_observed
AND assistant_message_finalized

DOM_stable используется только как debounce:

finalized
→ wait stability window
→ extract

Если provider-specific terminal state нельзя надёжно наблюдать:

TERMINAL_STATE_UNVERIFIABLE

Adapter не допускается к autonomous commit.

17. Truncated Response

Если frame не завершена:

WEB_RESPONSE_TRUNCATED

Response не salvage'ится.

Запрещено:

fragment 1
+ Continue
+ fragment 2

в рамках одной semantic transaction.

18. Stage Decomposition

Запрет continuation не означает запрет decomposition. Decomposition является runtime-owned механизмом и задаётся детерминированной политикой до вызова модели.

Stage, потенциально превышающий безопасный output/context budget, обязан объявлять:

decomposable: true
partition_selector
ordering
max_items_per_partition
coverage_obligation
fan_in_mode

Нормативные политики v2.2.2:

Stage 7 — Functional Map Draft
selector: PCON.scenarios
ordering: canonical ObjectRef ascending, затем stable source order
max_items_per_partition: 6
coverage: каждый selected scenario должен попасть ровно в одну partition
fan_in: deterministic union + duplicate/ref coverage validation

Stage 11 — Functional Specification
selector: CAP
ordering: canonical ObjectRef ascending
max_items_per_partition: 4
coverage: каждый CAP должен быть покрыт хотя бы одним REQ-set и ровно одной partition execution
fan_in: deterministic append by partition ordinal + requirement/reference validation

Stage 12 — Functional Specification Audit
selector: REQ
ordering: canonical ObjectRef ascending
max_items_per_partition: 6
coverage: каждый accountable REQ должен быть reviewed ровно один раз
fan_in: deterministic FND/UNK merge with source-ref preservation

Stage 15 — Constraint Synthesis
selector: CON
ordering: canonical ObjectRef ascending
max_items_per_partition: 6
coverage: каждый accountable CON должен получить derived domain disposition
fan_in: deterministic canonicalization + CoverageDeriver validation

Если required material не помещается даже после разрешённой context compaction, Runner не удаляет его молча, а запускает declared decomposition.

Каждый sub-run является отдельной законченной semantic transaction с собственными run_id, snapshot binding и audit entry.

19. Partition Invariants

До model call Runner вычисляет полное source set S и partitions P1...Pn.

Обязательные проверки:

UNION(P1...Pn) == S
INTERSECTION(Pi,Pj) == ∅

если stage contract явно не разрешает overlap.

Stage закрывается только после успешного coverage всех partitions и deterministic fan-in. Модель не определяет partition membership и не может исключать элементы из accountable set.

20. ModelSemanticResponse — AL-STRUCT-1

v2.2 фиксирует единый компактный semantic response contract:

passport
outputs
annotations
trace
input_fate
changes
completion

Модель должна вернуть только один JSON-object; markdown и prose вне объекта запрещены.

20.1. passport

Обязательные поля:

contract = "AL-STRUCT-1"
stage
input_snapshot_id
input_snapshot_hash
input_refs[]

input_refs содержит только реально переданные модели refs.

input_snapshot_hash копируется без изменений из ACTIVE. Модель не вычисляет и не исправляет hash.

20.2. outputs

Каждый response-local output имеет:

id
type
version
content

Допустимые output.type:

ANSWER
QUESTION
REJECT

OUT-* является response-local identity и не является canonical domain object ID.

20.3. annotations

annotations — diagnostic-only typed layer.

Допустимые type:

FACT
ASSUMPTION
CONSTRAINT
DECISION
RISK
EVIDENCE
FINDING
CONFLICT
OPEN
DEFERRED
CHANGE
BASELINE
VERIFIED
REJECTED
SUPERSEDED

Annotation не имеет target semantics и не является authority/evidence signal. Она может храниться в RAW/audit representation и отображаться в UI, но запрещено использовать annotations для:

- mutation normalization;
- status transition;
- authority decision;
- evidence verification;
- gate predicate;
- StateCommit.

Если authoritative решение требуется downstream, оно должно быть выражено через outputs/changes/input_fate и пройти соответствующий validator/policy.

20.4. trace

trace связывает каждый output с source_ids, из которых он получен.

Trace является lineage/provenance signal, но не заменяет canonical provenance, которую Runtime добавляет при commit.

20.5. input_fate

Каждый релевантный input может получить disposition:

CONSUMED
PRESERVED
TRANSFORMED
REJECTED
SUPERSEDED
NOT_USED

Критическая семантика:

CONSUMED означает только «вход обработан».

CONSUMED НЕ означает:

-
«вопрос решён»;

-
«объект проверен»;

-
«claim закрыт»;

-
«gate пройден».

input_fate — response bookkeeping и lineage. Domain disposition/coverage rules v2.1 остаются отдельным механизмом.

20.6. changes

Response-level operations:

CREATE
UPDATE
SUPERSEDE
MERGE

Каждый change содержит domain payload отдельно от proposed Registry state.

`payload` содержит только domain content.

Опциональный `state_patch` содержит только:

status
blocking
authority_class

Registry state запрещено прятать в domain payload.

Новый domain object создаётся через response-local temp_id, например:

tmp-pd-1
tmp-rsk-1

Canonical ID назначает только Orchestrator/StateCommitter.

Существующие IDEA/PD/REQ/CON/FCT/ASM/UNK/RSK/EVD/AD/FND/CHG IDs и версии модель может использовать только из passport.input_refs.

`state_patch` является только proposal. Его применение требует schema/reference/authority/evidence/status-transition validation.

20.7. completion

Допустимые status:

COMPLETE
PARTIAL
FAILED

completion содержит:

status
output_ids
output_count
empty_by_design
anomalies[]

Для разрешённых stage contract может присутствовать:

reason = "NO_MATERIAL_DELTA"

Глобального NO_CHANGE нет.

20.8. schema example

Prompt Compiler обязан инлайнить не только имя AL-STRUCT-1, но и его обязательные поля, enums и корректный пример.

Пример маркируется как:

role = "schema_example"

и не должен интерпретироваться как prior model output.

Предыдущий результат, если он передаётся модели, маркируется отдельно:

role = "prior_output"

Таким образом schema example и входные данные не смешиваются.

21. Strict Schemas

Все control structures:

additionalProperties = false

AL-STRUCT-1 имеет closed vocabulary для критических enum-полей:

output.type
annotations[].type
input_fate[].disposition
changes[].op
completion.status
completion.reason

Неструктурированный prose вместо JSON-object:

STRUCTURE_INVALID

Неверный input_snapshot_hash:

STRUCTURE_BAD_SNAPSHOT_HASH

Reserved field names запрещены в model-controlled structural payload.

Примеры reserved namespace:

run_id
response_id
object_id
snapshot_id
content_hash
prompt_hash
stage_contract_hash
transport_complete

Canonical object version нельзя изобретать. Версии существующих domain objects копируются только из input_refs.

Нарушение:

RESERVED_FIELD_VIOLATION

и отклоняется весь response.

Валидатор также проверяет внутреннюю согласованность:

-
completion.output_count == фактическому количеству outputs;

-
completion.output_ids ссылается только на существующие response-local outputs;

-
trace.output_id существует;

-
trace.source_ids существуют во входном snapshot либо явно разрешены contract;

-
input_fate.input_id относится к переданным input_refs;

-
changes source_output_id, если используется, ссылается на существующий output.

22. Mutation Protocol

Внутренний canonical mutation protocol:

CREATE
REVISE
SET_STATUS
SUPERSEDE
MERGE

Hard delete отсутствует.

Model-facing AL-STRUCT-1 vocabulary остаётся компактным:

CREATE
UPDATE
SUPERSEDE
MERGE

Между ними работает deterministic MutationNormalizer. Нормативное отображение:

- model CREATE → internal CREATE;
- model UPDATE без status change → internal REVISE;
- model UPDATE + state_patch.status → internal REVISE + SET_STATUS;
- model UPDATE + state_patch.blocking/authority_class → policy-checked REVISE metadata mutation;
- model SUPERSEDE → internal SUPERSEDE;
- model MERGE → internal MERGE с полным source_refs/provenance.

Если один model change нормализуется в несколько internal mutations, они входят в одну StateCommit transaction. Частичный commit запрещён.

Наличие changes не означает commit. Любой model result сначала проходит schema/reference/authority/evidence/provenance/coverage validation.

23. Temporary References

Новый объект использует response-local temp_id:

tmp-pd-1
tmp-req-1
tmp-rsk-1
...

Temp refs действуют только внутри одного semantic response.

Они не переживают response boundary.

Модель не создаёт canonical ID «на будущее» и не переименовывает temp_id в canonical самостоятельно.

24. Canonical Identity

Persisted identity:

CODE-NNNNNN@vN

Правила:

-
canonical IDs создаёт только StateCommitter;

-
ID никогда не переиспользуется;

-
version monotonic;

-
revision создаёт новую immutable version;

-
все refs version-specific;

-
модель может ссылаться на существующий canonical object только если соответствующий id/version присутствует в passport.input_refs;

-
повтор полного текста существующего объекта не заменяет canonical reference.

Reference-first behavior является частью v2.2 context discipline.

25. ID Allocation

До atomic commit canonical ID не считается выделенным.

Во время validation разрешено только tentative mapping:

tmp-1 → pending

В durable transaction одновременно записываются:

ID counter advance
tmp→canonical mapping
RegistryEntry
domain events
STAGE_RUN_COMMITTED

Crash до transaction:

no durable ID allocation

Crash после transaction:

mapping restored from Ledger

26. RegistryEntry

{
"code": "REQ",
"object_id": "REQ-000047",
"version": 3,
"status": "CLOSED",
"blocking": false,
"authority_class": null,
"created_stage": 11,
"created_by_run": "RUN-0193",
"payload": {},
"provenance": {
"input_refs": [],
"authority_refs": [],
"evidence_refs": [],
"stage_run_id": "RUN-0193"
},
"supersedes": {
"code": "REQ",
"object_id": "REQ-000047",
"version": 2
},
"stale": false,
"content_hash": "..."
}

27. Provenance

Для semantic mutation v2.1 сохраняются:

derived_from
authority_refs
evidence_refs

AL-STRUCT-1 добавляет response-level lineage:

trace[]
input_fate[]

Для committed object Runtime добавляет:

stage_run_id
input_snapshot_id
input_snapshot_hash
executor_ref

trace/input_fate не заменяют committed provenance; они являются входом для её проверки и построения.

Provenance используется для:

-
traceability;

-
stale propagation;

-
impact analysis;

-
audit;

-
replay;

-
minimal rerun.

28. Coverage Obligation

Для set-transformation stage contract обязан определить:

coverage_obligation:
selector
cardinality

Runner до вызова модели разрешает selector в immutable:

accountable_set

Модель не определяет это множество.

29. Transformation Coverage / Derived Dispositions

Domain transformation dispositions:

PRESERVE
MERGE
SPLIT
SUPERSEDE
DEFER
REJECT

AL-STRUCT-1 не получает отдельное model-authored поле `dispositions`. Domain disposition вычисляется Runtime-компонентом CoverageDeriver из:

- frozen accountable_set;
- input_fate;
- changes;
- validated target/source refs;
- разрешённых status transitions.

Это исключает два конкурирующих словаря, написанных моделью.

Базовые правила derivation:

- PRESERVED без transforming change → PRESERVE;
- TRANSFORMED + один UPDATE/REVISE target для того же accountable input → PRESERVE semantic identity с revision;
- несколько accountable source_refs → один MERGE temp/output → MERGE для каждого source;
- один accountable source → несколько CREATE outputs с явной trace/source linkage → SPLIT;
- SUPERSEDED + validated SUPERSEDE change → SUPERSEDE;
- policy-valid transition status→DEFERRED → DEFER;
- REJECTED + разрешённый contract rejection → REJECT.

`CONSUMED` означает только «обработан» и никогда не удовлетворяет transformation coverage сам по себе.

Для stages 3 и 15 каждый accountable input обязан получить ровно один derived domain disposition.

Runner вычисляет:

expected = accountable_set
received = derived_disposition.input_refs

unaccounted = expected - received
foreign = received - expected
duplicates = refs with count != 1

Commit разрешён только если:

unaccounted = ∅
foreign = ∅
duplicates = ∅

30. Empty Review / Empty Output

v2.1 правило сохраняется: пустой semantic result не является автоматически доказательством coverage.

v2.2 запрещает глобальный NO_CHANGE.

Каждый stage contract определяет material-output policy:

requires_material_output
allows_empty_by_design
allowed_empty_reason_codes

Если empty-by-design разрешён, AL-STRUCT-1 использует:

completion.empty_by_design = true
completion.reason = "NO_MATERIAL_DELTA"
outputs = []

Такой response допустим только при выполнении всех stage-specific postconditions и coverage requirements.

В test surface v2.2:

ROUND_1 — material output required
ROUND_2 — material output required
DELTA — empty-by-design allowed

Для 30-stage Product→Architecture Framework эти значения задаются соответствующим stage contract, а не глобально.

31. Decision Policy — DPL

DPL является versioned machine-readable object.

Минимальная rule:

rule_id
decision_selector
authority_class
scope_selector
allowed_actions
risk_ceiling
required_evidence
conditions
effect
valid_from
valid_until

32. DPL Semantics

Policy Engine работает:

DENY BY DEFAULT

Если ни одно active rule не matches:

NOT_AUTHORIZED

Модель может предложить DPL rule.

Модель не может активировать DPL rule.

Activation требует Owner Authority Event.

33. DPL Lint

Обязательные проверки:

overlapping rules
contradictory rules
undefined fallthrough
unbounded wildcard
authority escalation
missing default
invalid scope selector
invalid risk ceiling

34. Authority Classes

A0 — reversible low-risk inside committed scope
A1 — evidence-dependent
A2 — value/preference decision
A3 — scope/contract/baseline change
A4 — prohibited

Authority class, предложенный моделью, не считается автоматически правильным.

Для decision objects validator проверяет classification against:

-
stage;

-
decision semantics;

-
DPL;

-
affected baseline;

-
scope impact.

Если classification не может быть уверенно разрешена:

AUTHORITY_CLASS_UNCERTAIN

и autonomous closure запрещён.

35. Questionnaire

После свободной IDEA Owner работает через QST.

QST:

question_id
decision_ref
authority_class
blocking
input_type
options[]
branch_condition

Каждый option содержит deterministic effect.

36. Questionnaire Safety

Модель может предложить candidate options, но questionnaire compiler обязан проверять:

-
варианты не дублируются;

-
варианты не перекрываются недопустимо;

-
question не объединяет разные decisions;

-
есть допустимый defer/not-applicable route, если разрешено;

-
effects соответствуют authority class;

-
Owner не подписывает wildcard delegation через обычный product question.

37. Answer Compilation

Owner возвращает только option IDs.

Runner применяет только заранее объявленные effects.

LLM не переинтерпретирует Owner answer.

38. Product Intake Loop

До G1:

IDEA
↓
decision discovery
↓
QST
↓
Owner selection
↓
product synthesis
↓
audit
↓
new blocking A2/A3?
├─ yes → delta QST
└─ no  → continue

Loop bounded.

39. Evidence Model

Необходимо различать:

ARTIFACT_AUTHENTIC
CLAIM_SUPPORTED
CLAIM_VERIFIED

Это разные predicates.

40. Artifact Authenticity

Evidence Collector может удостоверить:

-
источник реально получен;

-
URL/doc identity;

-
captured bytes/text;

-
source span;

-
timestamp;

-
artifact hash;

-
executed command;

-
actual measured result.

Это ещё не означает, что artifact подтверждает конкретный semantic claim.

41. Semantic Claim Verification

Если relation:

artifact → claim

требует содержательной LLM-интерпретации, результат остаётся:

MODEL_ANALYSIS

и сам по себе не даёт VERIFIED.

42. VERIFIED

Claim может стать VERIFIED, когда relation устанавливается:

-
deterministic assertion;

-
structured external data;

-
executable experiment;

-
static analysis;

-
deterministic parser;

-
explicitly scoped human observation.

LLM interpretation может помогать найти evidence, но не является последним authority перехода в VERIFIED.

43. Web Search inside Provider UI

Текст модели:

"I searched and found..."

не является evidence.

Evidence материализуется только из реально доступного и сохранённого runtime artifact. Минимальный Evidence Collector обязан сохранять source identity/URL, captured bytes or deterministic extracted text, timestamp и SHA-256 artifact hash. Текст модели «я поискал» без такого artifact не может повысить claim до VERIFIED.

44. Human Test

HTSK создаётся системой.

Human Tester выполняет task и возвращает HRES:

PASS
FAIL
BLOCKED

Runner создаёт EVD:

method_kind = HUMAN_TEST

LLM не может создать HRES.

45. Independent Fan-Out

Runner замораживает один InputSnapshot и запускает отдельные executions:

Snapshot S
├─ provider A / fresh conversation
├─ provider B / fresh conversation
└─ provider C / fresh conversation

Sibling outputs скрыты.

46. Diversity Assurance

Система не заявляет невидимую «разность underlying models».

Различаются:

PROVIDER_DIVERSITY
DECLARED_MODEL_DIVERSITY
PROFILE_DIVERSITY

Runner может доказать только наблюдаемые properties.

Если underlying identity скрыта provider'ом:

underlying_model_identity = UNKNOWN

47. Fan-In

Fan-in является отдельным run.

Он получает:

-
exact committed sibling ObjectRefs;

-
source snapshot;

-
required transformation coverage.

Синтезатор не получает transcript history.

В v2.2 prior model output передаётся как явно типизированные данные:

role = "prior_output"
source_ref
model
contract
response

Это отделяет prior output от schema_example и от instruction layer.

Fan-in prompt строится через:

RULES → STATE → ACTIVE → DELTA → TASK

и использует exact input_refs + input_snapshot_hash.

48. Repair Classification

Ошибки делятся на:

TRANSPORT
REPRESENTATION
SCHEMA
REFERENCE
SEMANTIC
AUTHORITY
EVIDENCE
CONCURRENCY

49. Same-conversation Repair

Same-chat bounded repair разрешён только для representation-level ошибок:

malformed JSON
missing required field
invalid enum
incorrect reference syntax
unexpected property

Repair должен вернуть полный replacement response.

Никакого partial merge attempts.

50. Semantic Repair

Ошибки типа:

unsupported conclusion
authority violation
semantic contradiction
wrong evidence interpretation
scope change

требуют:

fresh conversation
new attempt
same or refreshed snapshot as applicable

Отклонённый semantic response не становится контекстом нового решения.

51. Attempts

Каждый attempt immutable.

ATT-01 = INVALID
ATT-02 = VALID

Commit может использовать только один complete validated attempt.

Запрещено:

part ATT-01 + part ATT-02

52. Version Conflicts

Если mutation validated against snapshot N сталкивается с current version N+1:

VERSION_CONFLICT

Старая semantic mutation автоматически не rebase'ится.

По умолчанию:

discard candidate
resolve new snapshot
rerun necessary computation

Только explicitly-declared commutative deterministic operation может быть повторно применена после полной проверки новых preconditions.

53. Validation Pipeline

1. ADAPTER HEALTH
2. INPUT DELIVERY
3. MESSAGE CORRELATION
4. RESPONSE FRAME
5. TERMINAL STATE
6. TRANSPORT TEXT CANONICALIZATION
7. JSON PARSE
8. AL-STRUCT-1 RESPONSE SCHEMA
9. INPUT SNAPSHOT ID/HASH CHECK
10. RESERVED FIELD CHECK
11. OUTPUT / TRACE / INPUT_FATE INTERNAL INTEGRITY
12. OBJECT SCHEMA
13. REFERENCE INTEGRITY
14. ROLE PERMISSIONS
15. AUTHORITY
16. EVIDENCE
17. PROVENANCE
18. COVERAGE
19. DOMAIN DISPOSITIONS
20. STAGE POSTCONDITIONS
21. GATE PREDICATES
22. OPTIMISTIC VERSION CHECK
23. INTEGRITY HASHES
24. SOURCE-MESSAGE IDEMPOTENCY CHECK
25. ATOMIC COMMIT

Любой structural failure блокирует semantic acceptance.

Partial commit запрещён.

54. StateCommitter

StateCommitter — единственный компонент, имеющий write access к canonical state.

В одной transaction записываются:

canonical ID allocations
new RegistryEntry versions
status transitions
domain events
baseline changes
project revision
STAGE_RUN_COMMITTED

55. Durable Stage Completion

Каждый successful run завершается durable event:

STAGE_RUN_COMMITTED

Содержит:

run_id
stage
attempt_id
input_snapshot_id
project_revision
mutation_refs
allocated_refs
semantic_result_hash

Это не telemetry.

Это часть canonical Ledger.

56. Crash Recovery

Если crash до commit:

no domain change

Если crash после commit, но до routing:

Runner видит:

STAGE_RUN_COMMITTED

и не вызывает LLM повторно.

Routing повторно вычисляется из committed state.

57. Idempotency

run_id уникален.

Повтор commit с уже committed run:

NO_OP + return committed result

а не новая transaction.

v2.2 добавляет source-message idempotency.

Каждый принятый provider message получает transport-owned identity. Повторный scrape, storage replay или recovery одного и того же сообщения не должен создать второй semantic response, второй набор changes или вторую запись accepted output.

Идемпотентность действует на двух уровнях:

-
message acceptance;

-
canonical run commit.

58. Ledger Durability Contract

Production Web/MV3 profile использует IndexedDB как authoritative persistent store для Registry, Ledger, run/stage state, accepted-message IDs и baseline metadata.

`chrome.storage.local` может использоваться только для non-authoritative UI/preferences/cache/checkpoint hints и не является commit database.

Каждый StateCommit выполняется одной IndexedDB `readwrite` transaction и обязан атомарно включать:

- optimistic project revision check;
- unique run_id check;
- source-message dedup check;
- canonical ID allocation;
- Registry mutations;
- Ledger append;
- baseline/gate materialization, если применимо;
- increment project revision.

Deployment не считается production-capable без:

atomicity
durability
unique run constraint
monotonic project revision
transactional ID allocation
replay-safe idempotency

Controller не полагается на lifetime `automation.html` или service worker. После page close/suspension FSM должен восстанавливаться из authoritative IndexedDB state.

59. Project State Machine

NEW
RUNNING

WAITING_FOR_SELECTION
WAITING_FOR_EVIDENCE
WAITING_FOR_HUMAN_TEST
WAITING_FOR_OPERATOR

SCOPE_CHANGE_REQUIRED

WEB_RATE_LIMITED
WEB_AUTH_REQUIRED
WEB_CAPTCHA
WEB_UI_CHANGED
WEB_UNAVAILABLE
INPUT_TRANSPORT_UNVERIFIABLE

UNRESOLVABLE
EXECUTION_FAILED

COMPLETED

60. Waiting State Deadlines

Каждый WAITING state обязан иметь:

entered_at
reason
required_action
expiry_policy
resume_condition

Бесконечное молчаливое ожидание запрещено.

Expiry не обязательно означает failure; но transition должен быть определён.

61. Runtime Limits

Hard limits допускаются только для наблюдаемых ресурсов:

max_attempts
max_repair_attempts
max_loop_iterations
max_fanout_runs
max_active_tabs
max_stage_wall_time
max_project_wall_time

Token count и monetary cost через web UI не считаются hard enforceable, если provider не предоставляет авторитетного значения.

62. Control Flow

Control Flow является явной FSM.

from
event
condition
action
to

Graph dependency не заменяет workflow state machine.

63. Loops

Каждый back-edge содержит:

loop_id
max_iterations
progress_condition
on_exceed

max_iterations предотвращает бесконечность, но сам по себе не доказывает progress.

64. Dependency Graph

Graph строится только из typed references:

derived_from
satisfies
relies_on
evidence_refs
authority_refs

Narrative parsing для dependency reconstruction запрещён.

65. Change Propagation

Новая source version:

vN → vN+1

запускает:

impact analysis
→ transitive dependency set
→ stale marking
→ CHG when semantic effect exists
→ minimal rerun set

66. Baselines

Canonical baselines:

PFB
AIP
CAB

Baseline — immutable snapshot:

baseline_id
version
included_refs
gate_result
manifest_version
content_hash
created_at

Gate pass и baseline commit являются одной StateCommit transaction.

67. Gates

Gate — deterministic predicate over frozen state.

Он не читает:

checkbox
human prose
model claim "gate passed"

Он вычисляет predicates.

68. Semantic Review

No Architecture Leakage, No Silent Reinterpretation, No Product Redefinition и аналогичные semantic properties не проверяются regex.

Dedicated Reviewer создаёт:

FND
UNK
RSK

Reviewer не модифицирует reviewed artifact.

69. Positive Review Result

Положительный результат review не означает абсолютную правильность.

Он означает только:

declared review scope processed
coverage obligations satisfied
no finding emitted under this review contract

Нельзя интерпретировать CLEAN как доказательство объективного отсутствия дефекта.

70. Manifest Lint

До запуска проекта:

MANIFEST_LINT

Проверяет:

-
stages;

-
object codes;

-
schemas;

-
status transitions;

-
validators;

-
roles;

-
authority refs;

-
gates;

-
graph;

-
control flow;

-
loop policies;

-
response contracts;

-
coverage obligations;

-
decomposition contracts;

-
DPL schema;

-
adapter capabilities.

Failure блокирует project start.

71. Prompt Size Pre-flight / Context Budget

До отправки web-call Runner обязан оценить фактический rendered prompt size.

v2.2 вводит centralized context policy.

Текущий implementation profile:

maxPromptChars = 60000
maxOutputContentChars = 8000

Политика применяется к context representation, а не к canonical archive.

Runtime хранит отдельно:

1. raw provider response;
2. normalized/canonical accepted response;
3. compact context representation.

Raw/canonical content не перезаписывается сокращённой версией.

Для context-only representation разрешено deterministic safe truncation по безопасной границе с явным marker:

[OBJ:TRUNC]

Accountable current-stage refs и обязательные contract fields защищены от silent eviction.

Если required context после разрешённой compaction/truncation всё равно не помещается:

PROMPT_TOO_LARGE

и stage должен использовать предусмотренную decomposition/representation policy.

Молчаливое удаление required material запрещено.

71.1. Hash Canonicalization

Canonical runtime hash format v2.2.2: lowercase bare SHA-256 hex, ровно 64 символа `[0-9a-f]`. Префикс `sha256:` запрещён в persisted/runtime contracts.

Модель не вычисляет snapshot hash; она копирует его из ACTIVE/passport. Для snapshot-hash mismatch разрешён один bounded structural repair с тем же frozen snapshot. Повторное несовпадение завершает attempt ошибкой.

71.2. MV3 Schema Validation Profile

Для Chrome MV3 JSON Schema validators компилируются на build-time как Ajv standalone (`strict:false`, `allErrors:true`) либо эквивалентным CSP-safe способом. Runtime `new Function`/`eval` запрещён. Custom `x-*` metadata не должно ломать validator compilation.

71.3. DOM JSON Extraction

Structured response извлекается из correlated assistant message/code block через DOM `textContent`. Reconstruction из rendered markdown/`innerHTML` запрещена как authoritative parser input. Provider adapter matrix обязан тестировать это поведение для каждого поддерживаемого Web UI.

72. Provider Failure

Provider-specific operational failures никогда не превращаются автоматически в domain UNK/FND.

Это execution states:

WEB_RATE_LIMITED
WEB_AUTH_REQUIRED
WEB_CAPTCHA
WEB_UI_CHANGED
WEB_UNAVAILABLE

73. Failover

Failover разрешён только если replacement provider удовлетворяет stage capabilities.

Если contract требует два независимых providers, а остался один:

stage requirement unsatisfied

Гарантия не ослабляется молча.

74. Browser Tab Lifecycle

CREATED
READY
PROMPT_INSERTED
PROMPT_VERIFIED
SUBMITTED
INPUT_VERIFIED
GENERATING
TERMINAL
EXTRACTED
VALIDATED
COMMITTED
DONE
FAILED

State transitions журналируются.

75. Raw Responses and Representations

v2.2 различает три представления одного provider result:

RAW
CANONICAL
CONTEXT

RAW — исходный извлечённый provider text/DOM representation для diagnostics/audit.

CANONICAL — нормализованный и валидированный accepted response.

CONTEXT — компактное представление, которое разрешено передавать следующим model calls.

Compaction/truncation CONTEXT никогда не перезаписывает RAW или CANONICAL.

Raw DOM/model responses не являются:

Registry
Evidence
Baseline
Project State
Authority Event

Canonical accepted response также не становится domain state до StateCommit.

76. Observability

Telemetry содержит:

run_id
attempt_id
stage
provider
declared_model
adapter_version
tab_id
conversation_id
input_snapshot_id
input_snapshot_hash
prompt_hash
call_token_hash
attempt_token_hash
started_at
submitted_at
terminal_at
extracted_at
validation_result
commit_result
failure_code
isolation_assurance

v2.2 добавляет context-assembly audit.

Для каждого model call сохраняется deterministic recipe:

layers
included_refs
omitted_refs
truncated_refs
context_policy_version
budget.limit_chars
budget.used_chars
snapshot_hash
prompt_hash

Audit позволяет ответить:

-
какие объекты реально увидела модель;

-
какие были исключены;

-
что было сокращено;

-
какой snapshot был источником;

-
какой prompt фактически был собран.

Telemetry и context audit не являются canonical project state.

77. Canonical Stage Lifecycle

SELECT READY STAGE
↓
RESOLVE INPUT SELECTORS
↓
FREEZE INPUT SNAPSHOT
↓
STABLE SERIALIZE SNAPSHOT
↓
COMPUTE INPUT_SNAPSHOT_HASH
↓
RESOLVE COVERAGE SET
↓
CHECK DECOMPOSITION NEED
↓
BUILD SUB-RUNS IF REQUIRED
↓
BUILD REFERENCE-FIRST REGISTRY VIEW
↓
ASSEMBLE RULES / STATE / ACTIVE / DELTA / TASK
↓
APPLY CONTEXT POLICY + BUDGET
↓
WRITE CONTEXT-ASSEMBLY AUDIT
↓
COMPILE PROMPT
↓
COMPUTE PROMPT_HASH
↓
ALLOCATE RUN / ATTEMPT / CALL TOKENS
↓
ADAPTER PREFLIGHT
↓
OPEN FRESH CONVERSATION
↓
INSERT PROMPT
↓
VERIFY DRAFT
↓
SUBMIT
↓
VERIFY ACTUAL USER MESSAGE
↓
CORRELATE ASSISTANT MESSAGE
↓
OBSERVE PROVIDER TERMINAL STATE
↓
EXTRACT FRAME
↓
REJECT TRAILING CONTENT
↓
CANONICALIZE TRANSPORT TEXT
↓
PARSE JSON
↓
AL-STRUCT-1 VALIDATION
↓
VERIFY INPUT_SNAPSHOT_HASH ACK
↓
AUTHORITY / EVIDENCE / PROVENANCE
↓
COVERAGE / DOMAIN DISPOSITIONS
↓
POSTCONDITIONS
↓
VERSION CHECK
↓
NORMALIZE
↓
SOURCE-MESSAGE IDEMPOTENCY CHECK
↓
ATOMIC STATE COMMIT
↓
STAGE_RUN_COMMITTED
↓
STALE PROPAGATION
↓
CONTROL-FLOW ROUTE

78. Failure Handling Matrix

Failure

Result

Prompt too large

Decompose or fail stage

Prompt insertion differs

No submit

Submitted prompt differs

Abort attempt

Input cannot be verified

Adapter unsafe

Wrong assistant node

Reject

CALL_TOKEN mismatch

Reject

ATTEMPT_TOKEN mismatch

Reject

No terminal state

Transport failure

Missing closing frame

Truncated

Trailing assistant content

Reject

Invalid JSON

Representation repair

Schema violation

Representation repair

Reserved machine field

Reject

Reference invalid

Repair/re-run

Authority violation

Semantic re-run/route

Evidence insufficient

Evidence route

Coverage missing

Reject

Version conflict

New snapshot + rerun

Rate limit

Wait/failover

Authentication expired

WAITING_FOR_OPERATOR

CAPTCHA

WAITING_FOR_OPERATOR

DOM ambiguous

Adapter quarantine

Crash before commit

Zero state change

Crash after commit

Resume from STAGE_RUN_COMMITTED

Loop exhausted

Defined on_exceed

Human wait expires

Defined expiry transition

79. Contract Tests

Минимальный production suite v2.1 сохраняется:

HAPPY_PATH

INPUT_TRUNCATION_DETECTED
INPUT_HASH_MISMATCH
INPUT_UNVERIFIABLE_REJECTED

WRONG_MESSAGE_REJECTED
STALE_ATTEMPT_REJECTED
CALL_TOKEN_MISMATCH
ATTEMPT_TOKEN_MISMATCH

FALSE_DOM_STABILITY_NOT_COMPLETE
TERMINAL_STATE_REQUIRED
TRAILING_CONTENT_REJECTED
TRUNCATED_RESPONSE_REJECTED

OVERSIZED_STAGE_DECOMPOSED
PARTITION_UNION_COMPLETE
PARTITION_OVERLAP_REJECTED

INVALID_JSON_REPAIRED
SEMANTIC_ERROR_REQUIRES_FRESH_RUN
ATTEMPTS_NEVER_MERGED

MODEL_MACHINE_FIELDS_REJECTED
MODEL_CANNOT_ALLOCATE_ID

ACCOUNTABLE_SET_RUNTIME_OWNED
DISPOSITION_GAP_REJECTED
FOREIGN_DISPOSITION_REJECTED

DPL_DENY_BY_DEFAULT
DPL_WILDCARD_REVIEWED
UNAUTHORIZED_DECISION_REJECTED

ARTIFACT_AUTHENTIC_NOT_EQUAL_CLAIM_VERIFIED
MODEL_ANALYSIS_CANNOT_VERIFY

CONVERSATION_ISOLATION_RECORDED
PROVIDER_MEMORY_UNKNOWN_NOT_CLAIMED
DIVERSITY_ASSURANCE_NOT_OVERSTATED

VERSION_CONFLICT_INVALIDATES_CANDIDATE

ATOMIC_ID_ALLOCATION
ATOMIC_STAGE_COMMIT
CRASH_BEFORE_COMMIT
CRASH_AFTER_COMMIT_BEFORE_ROUTE
IDEMPOTENT_RUN_REPLAY

WAITING_STATE_HAS_EXPIRY_POLICY
MANIFEST_LINT_FAILURE_BLOCKS_START
UI_DRIFT_QUARANTINES_ADAPTER
FAILOVER_PRESERVES_STAGE_CONTRACT

BASELINE_COMMIT_ATOMIC
EVENT_REPLAY_REBUILDS_PROJECT

v2.2 добавляет обязательные tests:

AL_STRUCT_REQUIRED_FIELDS
AL_STRUCT_PROSE_OUTSIDE_JSON_REJECTED
AL_STRUCT_ENUM_CLOSED
AL_STRUCT_OUTPUT_COUNT_MATCH
AL_STRUCT_TRACE_REFS_VALID
AL_STRUCT_INPUT_FATE_REFS_VALID

SNAPSHOT_HASH_ACK_ACCEPTED
SNAPSHOT_HASH_MISMATCH_REJECTED
STABLE_SNAPSHOT_SERIALIZATION

SCHEMA_EXAMPLE_NOT_PRIOR_OUTPUT
PRIOR_OUTPUT_TYPED_AS_DATA
REFERENCE_FIRST_EXISTING_OBJECTS
CANONICAL_ID_INVENTION_REJECTED
TEMP_ID_RESPONSE_LOCAL

CONSUMED_NOT_EQUAL_CLOSED
NO_GLOBAL_NO_CHANGE
EMPTY_BY_DESIGN_STAGE_POLICY

RAW_CANONICAL_CONTEXT_SEPARATED
CONTEXT_TRUNCATION_DOES_NOT_MUTATE_ARCHIVE
OBJ_TRUNC_MARKER_PRESERVED
REQUIRED_CONTEXT_FAILS_CLOSED
CONTEXT_BUDGET_ENFORCED

SOURCE_MESSAGE_DUPLICATE_SUPPRESSED
CONTEXT_ASSEMBLY_AUDIT_REPRODUCIBLE
ROLE_DOES_NOT_GRANT_ARBITRATION

80. Canonical File Structure

manifest.json

objects/
object-schemas.json
registry-entry.schema.json
semantic-response.schema.json
al-struct-1.schema.json
response-envelope.schema.json
event.schema.json
dpl.schema.json

process/
stages.json
gates.json
baselines.json
dependency-graph.json
control-flow.json
status-enums.json

policy/
authority-ladder.json
evidence-policy.json
risk-policy.json
model-policy.json
tool-policy.json
context-policy.json

interaction/
questionnaire-contract.json
human-test-contract.json

execution/
prompt-builder.json
validators.json
decomposition-policy.json
coverage-contracts.json
repair-policy.json
transaction-contract.json
context-assembly.json

browser/
browser-runtime.json
adapter-contract.json
adapter-profiles/
chatgpt.json
claude.json
gemini.json
grok.json
qwen.json

runtime/
project-state.schema.json
telemetry-schema.json
context-audit.schema.json
contract-tests.json
schema-migrations.json

81. Граница гарантии v2.2.2

Automation Layer v2.2.2 гарантирует, если underlying storage и browser adapter удовлетворяют их контрактам:

-
invalid transport не меняет project state;

-
model response не меняет project state напрямую;

-
machine identity не доверяется модели;

-
canonical IDs не теряются и не дублируются после crash;

-
partial commit невозможен;

-
committed run идемпотентен;

-
повторный scrape одного source message не создаёт второй accepted result;

-
stage coverage машинно проверяется там, где она объявлена;

-
unsupported evidence не превращается в VERIFIED;

-
authority не расширяется только по заявлению LLM;

-
version conflict не переносит старое решение автоматически на новое состояние;

-
большие stages могут завершаться через заранее определённую decomposition;

-
recovery не требует доверять chat history;

-
baseline воспроизводим из committed state;

-
failure provider/UI не маскируется под domain success;

-
каждый accepted structural response привязан к конкретному input_snapshot_id + input_snapshot_hash;

-
schema example отличим от prior output;

-
CONSUMED не интерпретируется как «решено/проверено/закрыто»;

-
модель не создаёт canonical domain IDs;

-
контекст собирается детерминированно через RULES → STATE → ACTIVE → DELTA → TASK;

-
сокращённое context representation не разрушает raw/canonical archive;

-
context overflow required material приводит к fail-closed, а не silent deletion;

-
можно воспроизвести, какие refs вошли в каждый prompt и какие были omitted/truncated.

82. Что v2.2.2 сознательно не обещает

Система не заявляет, что способна доказать:

-
внутреннюю истинность любого рассуждения LLM;

-
отсутствие всех hallucinations;

-
абсолютную защиту от semantic prompt injection;

-
настоящий underlying model identity, если provider его скрывает;

-
отсутствие account-level memory, если provider не позволяет её контролировать;

-
exact token usage, если web UI его не раскрывает;

-
истинность произвольного natural-language claim только потому, что найдена ссылка;

-
объективную независимость моделей сверх реально наблюдаемых isolation properties.

Кроме того, v2.2 сознательно не вводит как обязательные механизмы:

-
полный delta-only mutation protocol;

-
RESET detection;

-
salience ranking;

-
address-based routing;

-
lazy retrieval;

-
similarity/embedding deduplication;

-
challenge-token economics;

-
numeric voting;

-
отдельный evidence registry;

-
rotating protocolist;

-
дополнительные model calls для компрессии/арбитража;

-
line-based semantic fallback protocol.

Наличие слоя DELTA, compact context и deterministic truncation не следует трактовать как внедрение этих более широких механизмов.

Эти ограничения являются частью correctness model, а не скрытыми предположениями.

83. Итоговая модель

Untrusted models
│
Untrusted provider Web UIs
│
Provider-specific adapters
│
Verified prompt delivery
│
Attempt-correlated response frame
│
Positive provider terminal state
│
Deterministic transport canonicalization
│
AL-STRUCT-1 strict semantic JSON
│
Snapshot ID + snapshot hash binding
│
Reference-first Registry context
│
RULES → STATE → ACTIVE → DELTA → TASK
│
Context budget + auditable compaction
│
Independent validators
│
Authority + Evidence + Coverage
│
Version check
│
Source-message idempotency
│
Transactional StateCommitter
│
Append-only canonical Ledger
│
Versioned Registry
│
Computed Gates
│
Immutable Baselines

Automation Layer v2.2 строится не на предположении, что web LLM будет вести себя правильно.

Он строится на другом принципе:

LLM разрешено ошибаться, Web UI разрешено ломаться, browser разрешено падать, а context representation разрешено быть компактным. Ни одно из этих событий не получает права молча превратиться в корректное canonical состояние проекта.

Надёжность достигается точным разделением:

-
недоверенного semantic computation;

-
ненадёжного web transport;

-
структурированного response protocol;

-
детерминированного context assembly;

-
transactional canonical runtime.

84. Delta v2.2.2 относительно v2.2

v2.2.2 является consolidated patch release. Все изменения уже встроены в настоящий документ и не требуют ручного применения patch-файла.

Исправлено:

1. Transformation coverage больше не зависит от отсутствующего model-authored `dispositions`: CoverageDeriver детерминированно выводит PRESERVE/MERGE/SPLIT/SUPERSEDE/DEFER/REJECT из frozen accountable set + input_fate + changes.

2. Model-facing changes получили `state_patch` для status/blocking/authority_class; MutationNormalizer детерминированно переводит CREATE/UPDATE/SUPERSEDE/MERGE во внутренние CREATE/REVISE/SET_STATUS/SUPERSEDE/MERGE.

3. annotations закреплены как diagnostic-only и не участвуют в authoritative validation/gates/commit.

4. Для stages 7/11/12/15 заданы конкретные deterministic decomposition policies и max_items_per_partition.

5. Production persistence закреплена за IndexedDB; StateCommit выполняется одной readwrite transaction, `chrome.storage.local` не является authoritative store.

6. MV3 schema validation использует build-time Ajv standalone или эквивалентный CSP-safe validator.

7. Canonical hash format унифицирован: lowercase bare SHA-256 hex без `sha256:`.

8. DOM structured response извлекается через correlated node `textContent`, а не rendered markdown/innerHTML.

9. Evidence Collector обязан материализовать сохраняемый artifact; model-reported search не является evidence.

10. Snapshot-hash mismatch получает максимум один bounded repair на том же frozen snapshot.

Все остальные механизмы v2.2 сохраняются.


## 85. Provider Matrix Contract (v2.2.2)

Automation Layer не владеет provider-specific DOM selectors: они остаются в существующих адаптерах MyOrchestrator. Однако Automation Layer обязан явно знать набор Web-провайдеров, которые разрешено использовать в production run.

Для текущей ветки `automation-gpt` канонический provider set: **ChatGPT, Claude, Gemini, Grok, Le Chat, Qwen, DeepSeek, Perplexity, Z.ai, Kimi**. Источник — существующие `popup.html` и `manifest.json` MyOrchestrator.

Для каждого enabled provider обязательны:

- binding к существующему MyOrchestrator content script / adapter;
- prompt delivery correlation;
- terminal assistant-message correlation;
- extraction structured response только из correlated DOM node/code block через `textContent`/raw text;
- запрет authoritative reconstruction из `innerHTML`/rendered markdown;
- стабильный `source_message_id` для idempotency;
- fixture test и хотя бы один live M1 smoke test.

Provider, не прошедший эти проверки, переводится в `QUARANTINED`/disabled для Automation runs. Наличие профиля само по себе не означает health. M1 считается зелёным только для явно enabled provider set, у которого каждый provider имеет PASS по fixture + live smoke.

Каноническая machine-спецификация: `browser/provider-matrix.json`.
