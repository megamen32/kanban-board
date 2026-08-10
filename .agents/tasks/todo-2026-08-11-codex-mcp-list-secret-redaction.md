# Observed defect: Codex MCP list output can expose a bearer token

Status: todo
Date: 2026-08-11

## Symptom

`codex mcp list` printed a configured remote MCP Authorization bearer value in the command/args table while inspecting MCP connectivity.

## Smallest evidence

The output for an existing remote server included `Authorization: Bearer ...` rather than a masked value. The token value is intentionally not recorded here.

## Blocker / exclusion

This is outside the selected excode board/README delivery scope. Do not rotate or edit credentials in this task. Requires a separately authorized Codex CLI/configuration security fix.
