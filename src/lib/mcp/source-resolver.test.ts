import { describe, expect, it } from 'vitest';
import { createSourceAdmissionResolver, type CanonicalTaskSource } from './source-resolver';

const sourceRef = '2f25df26-5d80-4ed0-9227-30dbf9e53170';
const canonical: CanonicalTaskSource = {
  sourceRef, actorId: 'airlock-user-2', project: 'alpha', state: 'decision_frozen',
  actorGrantCurrent: true, projectGrantCurrent: true,
  request: {
    tenant: 'airlock-team-1', sourceOwner: 'airlock-user-2', sourceEvent: sourceRef, primaryItem: 'primary',
    sourceRevision: 'sha256:decision', project: 'alpha', title: 'Review intake',
    description: 'Check the submitted source', priority: 'medium', assignees: [],
    classification: 'explicit-task', evidenceRefs: [`source:${sourceRef}:span-2`],
  },
};

describe('canonical source resolver contract', () => {
  it('stays disabled when there is no supported authenticated lookup transport', () => {
    expect(createSourceAdmissionResolver()).toBeUndefined();
  });

  it('accepts only a server UUID and returns the current frozen canonical decision', async () => {
    const lookup = async (ref: string) => ref === sourceRef ? canonical : null;
    const resolver = createSourceAdmissionResolver(lookup)!;
    await expect(resolver(sourceRef)).resolves.toEqual(canonical.request);
    await expect(resolver('eyJzaWduZWQiOiJwYXlsb2FkIn0.signature')).rejects.toThrow(/UUID/);
    await expect(resolver('c29tZS1vdGhlci1wYXlsb2Fk')).rejects.toThrow(/UUID/);
  });

  it('rejects missing, unfrozen, revoked, stale-project, and mismatched canonical results', async () => {
    const lookup = async () => canonical;
    await expect(createSourceAdmissionResolver(async () => null)!(sourceRef)).rejects.toThrow(/not found/);
    await expect(createSourceAdmissionResolver(async () => ({ ...canonical, state: 'unfrozen' }))!(sourceRef)).rejects.toThrow(/not frozen/);
    await expect(createSourceAdmissionResolver(async () => ({ ...canonical, state: 'revoked', actorGrantCurrent: false }))!(sourceRef)).rejects.toThrow(/not frozen/);
    await expect(createSourceAdmissionResolver(async () => ({ ...canonical, actorGrantCurrent: false }))!(sourceRef)).rejects.toThrow(/no longer current/);
    await expect(createSourceAdmissionResolver(async () => ({ ...canonical, projectGrantCurrent: false }))!(sourceRef)).rejects.toThrow(/no longer current/);
    await expect(createSourceAdmissionResolver(async () => ({ ...canonical, request: { ...canonical.request, project: 'other' } }))!(sourceRef)).rejects.toThrow(/does not match/);
    await expect(createSourceAdmissionResolver(async () => ({ ...canonical, request: { ...canonical.request, sourceOwner: 'forged-user' } }))!(sourceRef)).rejects.toThrow(/does not match/);
    await expect(createSourceAdmissionResolver(async () => ({ ...canonical, sourceRef: 'a1111111-1111-4111-8111-111111111111' }))!(sourceRef)).rejects.toThrow(/not found/);
    await expect(createSourceAdmissionResolver(lookup)!(sourceRef)).resolves.toEqual(canonical.request);
  });
});
