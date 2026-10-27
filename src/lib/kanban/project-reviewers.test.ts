import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAdmittedCard, findCardById } from "./file-store";
import { admitSourceTask } from "./source-operation";
import type { SourceAdmissionRequest } from "./source-operation";
import { decideHumanReview, validateTransition } from "./transition-policy";
import type { KanbanCard } from "./types";

const roots: string[] = [];
const previousCatalogFile = process.env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE;

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-project-reviewers-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  if (previousCatalogFile === undefined) delete process.env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE;
  else process.env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE = previousCatalogFile;
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

/** One relay scope catalog: the forenergo team carries a second Board login. */
function catalogFile(): string {
  const file = path.join(fixture(), "relay-team-scopes.v1.json");
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    catalogVersion: "2026-10-23.1",
    owner: { telegramUserId: "540308572", teamIds: ["forenergo", "tealband"] },
    groupContext: { maxMessages: 24, maxBytes: 16384 },
    teams: [
      {
        id: "forenergo", name: "Forenergo", telegramChatId: "-1004352022764", telegramChatName: "Oleg and Nik",
        kanbanProjects: ["\u041e\u043b\u0435\u0433 \u0438 \u041d\u0438\u043a\u0438\u0442\u0430"],
        memberTelegramUserIds: ["540308572", "188214466"],
        boardLogins: { "188214466": "oleg-test" },
      },
      {
        id: "tealband", name: "tealbandxAirlock", telegramChatId: "-5536412756", telegramChatName: "TealbandxAirlock group",
        kanbanProjects: ["tealbandxAirlock"],
        memberTelegramUserIds: ["540308572", "188214466"],
      },
    ],
  }));
  return file;
}

function request(project: string): SourceAdmissionRequest {
  return {
    tenant: "fixture-tenant", sourceOwner: "fixture-owner", sourceEvent: "event-17", primaryItem: "primary",
    sourceRevision: "rev-1", project, title: "Check supplier quote", description: "Compare two lines",
    priority: "medium", assignees: [], classification: "explicit-task", evidenceRefs: ["fixture:event-17:span-1"],
  };
}

function admit(project: string, dir: string): KanbanCard {
  const result = admitSourceTask(
    request(project), dir, id => findCardById(id, dir), card => createAdmittedCard(card, dir));
  expect(result.status).toBe("committed");
  const card = findCardById(result.cardId, dir);
  expect(card).not.toBeNull();
  return card as KanbanCard;
}

describe("per-project approval list of an admitted integrator card", () => {
  it("adds the project reviewer to the owner list", () => {
    process.env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE = catalogFile();
    const dir = fixture();

    const card = admit("\u041e\u043b\u0435\u0433 \u0438 \u041d\u0438\u043a\u0438\u0442\u0430", dir);

    expect(card.requiresApprovalFrom).toEqual(["nikita", "oleg-test"]);
  });

  it("keeps the owner list for a project without a second reviewer", () => {
    process.env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE = catalogFile();
    const dir = fixture();

    const card = admit("tealbandxAirlock", dir);

    expect(card.requiresApprovalFrom).toEqual(["nikita"]);
  });

  it("keeps the owner list when no scope catalog is configured", () => {
    process.env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE = path.join(fixture(), "absent.json");
    const dir = fixture();

    const card = admit("\u041e\u043b\u0435\u0433 \u0438 \u041d\u0438\u043a\u0438\u0442\u0430", dir);

    expect(card.requiresApprovalFrom).toEqual(["nikita"]);
  });

  it("keeps the approval list when the card is redirected into review", () => {
    process.env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE = catalogFile();
    const dir = fixture();
    const card = admit("\u041e\u043b\u0435\u0433 \u0438 \u041d\u0438\u043a\u0438\u0442\u0430", dir);

    const decision = validateTransition(card, {
      executorResult: { summary: "Result ready", evidenceRefs: ["fixture:event-17:span-2"] },
    }, { origin: "automation", actor: "agent" });

    expect(decision).toMatchObject({
      kind: "redirected",
      patch: { column: "review", needsReview: true, requiresApprovalFrom: ["nikita", "oleg-test"] },
    });
  });

  it("accepts only a member of the approval list", () => {
    process.env.EXMANAGER_RELAY_SCOPE_CATALOG_FILE = catalogFile();
    const dir = fixture();
    const card = admit("\u041e\u043b\u0435\u0433 \u0438 \u041d\u0438\u043a\u0438\u0442\u0430", dir);
    const waiting = { ...card, column: "review" as const, needsReview: true };

    expect(decideHumanReview(waiting, "accept", "oleg-test")).toMatchObject({ kind: "accepted" });
    expect(decideHumanReview(waiting, "accept", "nikita")).toMatchObject({ kind: "accepted" });
    expect(decideHumanReview(waiting, "accept", "stranger")).toMatchObject({
      kind: "rejected", reason: "reviewer_not_authorized",
    });
  });
});
