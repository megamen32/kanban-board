export function publicOrigin(request: Request): string {
  const configured = process.env.KANBAN_PUBLIC_ORIGIN?.trim().replace(/\/$/, '');
  if (configured) return configured;

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return new URL(request.url).origin;
}
