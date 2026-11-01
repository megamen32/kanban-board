import type { KanbanCard } from './types';
import type { DotTransport } from './dot-execution';

/** Server-owned authenticated channel. Do not construct it from request fields,
 * browser flags, mirrored text, or the existing Herder bearer sent to UserIO.
 * This interface deliberately does not implement or mint credentials. */
export interface AuthenticatedDotChannel {
  peer: { audience: 'userio-dot-board'; roomId: string; ownerActor: string };
  enqueueTrusted(input: { source:'board'; requestId:string; text:string }): Promise<{status:string;echo?:string;cursor?:string}>;
}
export function composeDotTransport(
  binding: {roomId:string;ownerActor:string;ownerAlias:string},
  channel: AuthenticatedDotChannel | undefined,
  authorizeCard: (card:KanbanCard,actor:string)=>Promise<boolean>,
  canonicalActor: (verifiedActor:string)=>Promise<string|null> = async actor=>actor,
): DotTransport | undefined {
  if(!channel || !/^[a-f0-9]{32}$/.test(binding.roomId) || !binding.ownerActor || !binding.ownerAlias
    || channel.peer.audience!=='userio-dot-board' || channel.peer.roomId!==binding.roomId
    || channel.peer.ownerActor!==binding.ownerActor) return undefined;
  return {
    roomId:binding.roomId,
    async authorize(actor,card) {
      if(await canonicalActor(actor)!==binding.ownerActor || ![binding.ownerActor,binding.ownerAlias].includes(card.owner ?? '')) return false;
      // Explicit commissioned owner scope comes from existing verified metadata,
      // never instructions embedded in third-party task descriptions.
      return authorizeCard(card,actor);
    },
    async enqueueTrusted(input) {
      if(input.source!=='board' || !/^board:[a-f0-9]{64}(?::answer:[a-f0-9]{64})?$/.test(input.requestId)
          || !input.text || input.text.length>16000) throw Error('dot_enqueue_out_of_scope');
      return channel.enqueueTrusted(input);
    },
  };
}
