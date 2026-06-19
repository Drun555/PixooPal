const DIVOOM_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers':
    'DNT,X-Mx-ReqToken,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization'
};

export function divoomJson(body: unknown) {
  const payload = JSON.stringify(body);

  return new Response(payload, {
    headers: {
      server: 'nginx',
      date: new Date().toUTCString(),
      'content-type': 'application/json; charset=UTF-8',
      'content-length': String(Buffer.byteLength(payload)),
      connection: 'keep-alive',
      ...DIVOOM_CORS_HEADERS
    }
  });
}

export function divoomOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      server: 'nginx',
      date: new Date().toUTCString(),
      connection: 'keep-alive',
      ...DIVOOM_CORS_HEADERS
    }
  });
}
