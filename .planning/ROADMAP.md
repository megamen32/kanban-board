# Roadmap: Todo

## Overview

Repair the reported notebook failure on the existing real board without changing
task storage or weakening automation policies.

## Phases

- [x] **Phase 1: Persistent notebook controls** - Repair and verify the reported real path.

## Phase Details

### Phase 1: Persistent notebook controls
**Goal:** Human completion persists after reload and failed saves are visible.
**Mode:** mvp
**Depends on:** Nothing
**Requirements:** TASK-01, TASK-02, TASK-03
**Success Criteria:**
1. Existing logged-in user completes and reopens an isolated card through notebook.
2. Reload preserves both states; audit records the verified human actor.
3. Service/MCP DONE policy and version conflicts remain intact.
**Plans:** 1 plan

Plans:
- [x] 01-01: Reproduce, repair shared-login integration, bounded deploy and UI acceptance.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Persistent notebook controls | 1/1 | Complete | 2026-10-12 |
