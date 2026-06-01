import { json, type RequestHandler } from '@sveltejs/kit';
import { getPixooPalDiscoveryInfo } from '$lib/server/discovery';

export const GET: RequestHandler = ({ request, url }) => {
  return json(getPixooPalDiscoveryInfo(getRequestOrigin(request, url)));
};

function getRequestOrigin(request: Request, url: URL) {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || url.host;
  const protocol = forwardedProto || 'http';

  return host ? `${protocol}://${host}` : '';
}
