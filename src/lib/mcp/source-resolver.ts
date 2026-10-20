import type { SourceAdmissionRequest } from '../kanban/source-operation';

export type CanonicalSourceState = 'decision_frozen' | 'board_admitted';

/** Result returned by a future existing authenticated ExManager resource
 * lookup. These authorization/state facts must come from that canonical
 * server lookup; they must never be accepted from MCP arguments or a token. */
export interface CanonicalTaskSource {
  sourceRef: string;
  actorId: string;
  project: string;
  state: CanonicalSourceState | 'missing' | 'revoked' | 'unfrozen';
  actorGrantCurrent: boolean;
  projectGrantCurrent: boolean;
  request: SourceAdmissionRequest;
}

export type CanonicalTaskSourceLookup = (sourceRef: string) => Promise<CanonicalTaskSource | null>;

const SOURCE_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** No default transport is invented here. Without an existing authenticated
 * app/resource lookup, the caller gets no resolver and must leave source
 * admission unregistered. */
export function createSourceAdmissionResolver(lookup?: CanonicalTaskSourceLookup) {
  if (!lookup) return undefined;
  return async (sourceRef: string): Promise<SourceAdmissionRequest> => {
    if (!SOURCE_REF.test(sourceRef)) throw new Error('sourceRef must be a server-issued UUID');
    const source = await lookup(sourceRef);
    if (!source || source.sourceRef !== sourceRef) throw new Error('canonical source not found');
    if (source.state !== 'decision_frozen' && source.state !== 'board_admitted') throw new Error('canonical source decision is not frozen');
    if (!source.actorGrantCurrent || !source.projectGrantCurrent) throw new Error('canonical source grant is no longer current');
    if (source.request.sourceEvent !== sourceRef || source.request.sourceOwner !== source.actorId
      || source.request.project !== source.project || source.request.classification !== 'explicit-task') {
      throw new Error('canonical source request does not match its current identity and project');
    }
    return source.request;
  };
}
