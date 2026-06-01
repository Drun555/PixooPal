import { json, type RequestHandler } from '@sveltejs/kit';
import {
  getClockfacesView,
  setActiveClockface,
  showNotification,
  submitClockfaceInput
} from '$lib/server/clockfaces';

function errorResponse(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : 'Unknown clockface error';
  return json({ ok: false, message }, { status });
}

export const GET: RequestHandler = async () => {
  try {
    return json({
      ok: true,
      ...(await getClockfacesView())
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      const form = await request.formData();
      const action = String(form.get('action') ?? '');

      if (action !== 'submitInput') {
        return errorResponse(new Error('Unsupported clockface form action.'), 400);
      }

      const file = form.get('value');

      if (!(file instanceof File)) {
        return errorResponse(new Error('Clockface file input is missing.'), 400);
      }

      return json({
        ok: true,
        ...(await submitClockfaceInput(String(form.get('id') ?? ''), {
          name: file.name,
          type: file.type,
          size: file.size,
          bytes: new Uint8Array(await file.arrayBuffer())
        }))
      });
    }

    const payload = await request.json();
    const action = typeof payload.action === 'string' ? payload.action : '';

    if (action === 'select') {
      return json({
        ok: true,
        ...(await setActiveClockface(String(payload.id ?? '')))
      });
    }

    if (action === 'submitInput') {
      const file = parseJsonFileInput(payload);

      if (file) {
        return json({
          ok: true,
          ...(await submitClockfaceInput(String(payload.id ?? payload.inputId ?? ''), file))
        });
      }

      return json({
        ok: true,
        ...(await submitClockfaceInput(String(payload.id ?? ''), String(payload.value ?? '')))
      });
    }

    if (action === 'notify') {
      return json({
        ok: true,
        ...(await showNotification(String(payload.text ?? ''), Boolean(payload.beep)))
      });
    }

    return errorResponse(new Error('Unsupported clockface action.'), 400);
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
