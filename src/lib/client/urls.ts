const CLIENT_ROUTES = ['benchmark', 'clockfaces'];

function trimLeadingSlash(path: string) {
  return path.replace(/^\/+/, '');
}

function ensureTrailingSlash(pathname: string) {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function getAppBasePath(pathname: string) {
  const normalizedPathname = ensureTrailingSlash(pathname || '/');

  for (const route of CLIENT_ROUTES) {
    const routeSuffix = `/${route}/`;

    if (normalizedPathname.endsWith(routeSuffix)) {
      const basePath = normalizedPathname.slice(0, -routeSuffix.length + 1);
      return basePath || '/';
    }
  }

  return normalizedPathname;
}

function getBrowserBaseUrl() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return `${window.location.origin}${getAppBasePath(window.location.pathname)}`;
}

export function appPath(path: string) {
  if (typeof window === 'undefined') {
    return path;
  }

  const url = new URL(trimLeadingSlash(path), getBrowserBaseUrl());
  return `${url.pathname}${url.search}${url.hash}`;
}

export function appRoutePath(pathname: string) {
  const basePath = getAppBasePath(pathname);
  const relativePath = pathname.slice(basePath.length).replace(/^\/+/, '');
  return relativePath ? `/${relativePath}` : '/';
}

export function apiUrl(path: string) {
  if (typeof window === 'undefined') {
    return path;
  }

  return new URL(trimLeadingSlash(path), getBrowserBaseUrl()).toString();
}

export function apiWebSocketUrl(path: string) {
  if (typeof window === 'undefined') {
    return path;
  }

  const url = new URL(apiUrl(path));
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
