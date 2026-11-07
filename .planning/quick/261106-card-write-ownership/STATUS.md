# Проверенный статус на 6 ноября 2026, 23:25 UTC
Пользователь снова может читать исходную карточку от обычного пользователя; данные документа проверены по неизменному SHA-256. После реального MCP-обновления старый runtime воспроизвёл root:root0600, владелец повторно восстановлен только у этого файла.
Source: исправление и доказательства опубликованы в fix/card-write-ownership-20261106. Main остаётся eeb10add87060beb925461afb7ee3ec6f0a3ba83. Deployment не выполнялся.
Проверки:61 targeted passed;29 baseline failed и867 passed; failing names точно равны чистому baseline. Build/typecheck/focused lint прошли. Отдельный reviewer одобрил diff.
LHC: pr_stage off, delivery published_without_pr; bug_check красный.33 записи,1fixed,2blocked,30open. Нет заявления Done или полного завершённого цикла.
Следующий шаг: восстановить native child schema/lease через владельца соответствующего компонента. Не обходить safety denial слияния. После снятия gate требуется20–30 минут на merge, release и реальный consumer check; ETA восстановления transport неизвестен.
