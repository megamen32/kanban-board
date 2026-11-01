import { handleDotCallback } from '../../../../../../lib/kanban/dot-runtime';
import { tasksDirForScope } from '../../../../../../lib/auth/data-scope';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  try { return await handleDotCallback(request,id,tasksDirForScope('work')); }
  catch { return Response.json({error:'recording_unknown',retryable:false},{status:503}); }
}

export const GET=POST;
