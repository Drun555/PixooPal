import { error, type RequestHandler } from '@sveltejs/kit';
import { getInstalledCommunityClockfacePicture } from '$lib/server/communityClockfaces';

export const GET: RequestHandler = async ({ params }) => {
  const picture = await getInstalledCommunityClockfacePicture(params.id ?? '');

  if (!picture) {
    throw error(404, 'Community clockface picture was not found.');
  }

  return new Response(picture.bytes, {
    headers: {
      'content-type': picture.contentType,
      'cache-control': 'public, max-age=3600'
    }
  });
};
