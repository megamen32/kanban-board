# Проверенный статус на 7 ноября 2026, 02:37 UTC
Исправление исходников уже включено в main: PR8, a38ec14c; свежий origin/main d5ceef143c6ae9beacea135bdb5eb3afafbf57f1 также включает PR9 с журналом. Дерево собственного worktree совпадает с main. Канонический checkout eeb10ad содержит чужой WIP и не менялся.

Production не обновлён: образ aa1a16be, старт 06.11 18:43 UTC. Перезапуск, rollout и повтор ранее отклонённого main push не выполнялись.

Найден и проверен штатный agent-herder-release-admin, использующий ту же подтверждённую live authority и существующий canonical ledger. Status: lease=null, deploymentInProgress=false, nextFence=11. Значит, прежний child transport больше не является единственным возможным путём проверки. Acquire не выполнялся: native self identity возвращает caller_session_unavailable, а correlation ID не является зарегистрированным владельцем. Нужен подтверждённый текущий owner либо существующая валидированная binding; чужой или выдуманный ID недопустим. После acquire остаются обязательные check/fence и финальный expected-revision CAS.

Существующие доказательства для того же дерева кода: build/typecheck/focused lint прошли, 61 targeted test passed. Полная применимая suite ранее: 29 baseline failures, 867 passed; ошибки остаются открытыми, полный зелёный цикл не заявляется. Повторные общие проверки не запускались.

Реестр: RELEASE-GATE-001 и CARD-OWNER-001 обновлены штатным CAS CLI и остаются blocked. Квитанция: release-authority-recheck-20261107.json. После подтверждённого owner и выдачи lease ориентир на выпуск и адресный consumer check 20–30 минут; срок восстановления identity неизвестен.

## История
# Проверенный статус на 6 ноября 2026, 23:25 UTC
Пользователь снова может читать исходную карточку от обычного пользователя; данные документа проверены по неизменному SHA-256. После реального MCP-обновления старый runtime воспроизвёл root:root0600, владелец повторно восстановлен только у этого файла.
Source: исправление и доказательства опубликованы в fix/card-write-ownership-20261106. Main остаётся eeb10add87060beb925461afb7ee3ec6f0a3ba83. Deployment не выполнялся.
Проверки:61 targeted passed;29 baseline failed и867 passed; failing names точно равны чистому baseline. Build/typecheck/focused lint прошли. Отдельный reviewer одобрил diff.
LHC: pr_stage off, delivery published_without_pr; bug_check красный.33 записи,1fixed,2blocked,30open. Нет заявления Done или полного завершённого цикла.
Следующий шаг: восстановить native child schema/lease через владельца соответствующего компонента. Не обходить safety denial слияния. После снятия gate требуется20–30 минут на merge, release и реальный consumer check; ETA восстановления transport неизвестен.
