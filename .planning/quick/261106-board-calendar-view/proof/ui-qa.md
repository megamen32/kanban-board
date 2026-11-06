# Browser QA
Actual candidate Next build, loopback http://127.0.0.1:43359, isolated empty task/auth roots. Production and existing QA service were not changed.
Desktop: new Calendar control opens a complete monthly grid; week navigation and reload retain date/period.
Mobile390x844: no horizontal document overflow, agenda view remains usable.
Browser-only synthetic read fixtures: scheduledAt2026-11-14T07:00Z renders plan10:00Europe/Moscow onNovember14; dueAt2026-11-15T18:00Z renders deadline21:00 onNovember15, not an invented duration. All-day personal event stays onNovember14; undated task stays separately accessible.
Clicking the dated task opens existing edit dialog; Escape dismisses without changing calendar URL.
The API in this QA instance has no real credentials. Synthetic personal events do not prove live Google/iCloud integration.
