# Execution request budget

The initial dashboard effect depended on the cards array identity. Every board refresh started a new scan of all open cards. Cleanup only suppressed state updates; it did not stop the old scan's remaining HTTP batches. The browser network buffer filled with execution-status GETs and upstream errors.

This change removes automatic bulk execution GETs entirely. Local operation recovery loads only local storage when the set of card IDs changes. The owner explicitly checks one card's executor availability; choosing a native route also checks only that card. A per-view reader deduplicates same-card requests, allows at most two simultaneous reads, caches success for30seconds, backs off failures10..120seconds, aborts after10seconds and cancels on unmount. It never automatically retries. A changed card version invalidates launch availability.

Existing result reconciliation is retained only for active attempts visible in the viewport and a visible document, with single-flight and bounded error backoff. Terminal attempts and human-decision waits do not auto-sync. This does not change dispatch, authorization, CAS, credentials or task acceptance.

Checks cover request counts with fake clocks, duplicate clicks, slow reads, error cooldown, visibility/terminal eligibility and existing dashboard/model rendering. Live browser request-rate acceptance is required after deployment. No new tasks or sessions may be launched to test the request budget.
