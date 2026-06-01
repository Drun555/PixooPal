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
    const file = parseJsonFileInput(payload);

    if (file) {
      return json({
        ok: true,
        ...(await submitClockfaceInput(String(payload.inputId ?? payload.id ?? ''), file))
      });
    }

    return json({
      ok: true,
      ...(await submitClockfaceInput(String(payload.inputId ?? ''), String(payload.value ?? '')))
    });
  } catch (error) {
    return errorResponse(error);
  }
};

function parseJsonFileInput(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.file)) {
    return undefined;
  }

  const { file } = payload;
  const bytesBase64 = typeof file.bytesBase64 === 'string' ? file.bytesBase64 : '';

  if (!bytesBase64) {
    return undefined;
  }

  return {
    name: typeof file.name === 'string' ? file.name : 'upload',
    type: typeof file.type === 'string' ? file.type : '',
    size: typeof file.size === 'number' ? file.size : 0,
    bytes: new Uint8Array(Buffer.from(bytesBase64, 'base64'))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
