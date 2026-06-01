import { json, type RequestHandler } from '@sveltejs/kit';
import { submitClockfaceInput } from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown clockface input error';
  return json({ ok: false, message }, { status });
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('value');

      if (!(file instanceof File)) {
        return errorResponse(new Error('Clockface file input is missing.'), 400);
      }

      return json({
        ok: true,
        ...(await submitClockfaceInput(String(form.get('inputId') ?? form.get('id') ?? ''), {
          name: file.name,
          type: file.type,
          size: file.size,
          bytes: new Uint8Array(await file.arrayBuffer())
        }))
      });
    }

    const payload = await request.json();

    return json({
      ok: true,
      ...(await submitClockfaceInput(String(payload.inputId ?? ''), String(payload.value ?? '')))
    });
  } catch (error) {
    return errorResponse(error);
  }
};
