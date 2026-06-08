import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { codeToHtml } from 'shiki';
import { getDataDir, getDataPath } from './dataDir';

export type CommunityClockfaceCatalogItem = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  module: string;
  picture?: string;
  pictureUrl?: string;
  source?: string;
  sourceFiles?: string[];
  tags: string[];
  installed: boolean;
  outdated: boolean;
};

export type CommunityClockfaceSourceFile = {
  path: string;
  name: string;
  kind: 'code' | 'image' | 'asset';
  url: string;
  language?: string;
  sourceCode?: string;
  highlightedSource?: string;
};

export type CommunityClockfaceDetail = CommunityClockfaceCatalogItem & {
  files: CommunityClockfaceSourceFile[];
};

export type InstalledCommunityClockface = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  modulePath: string;
  picturePath?: string;
  pictureUrl?: string;
};

type CommunityManifest = {
  clockfaces?: unknown;
};

type CommunityManifestClockface = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  author?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  module?: unknown;
  picture?: unknown;
  source?: unknown;
  sourceFiles?: unknown;
  tags?: unknown;
};

type InstalledManifest = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  author?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  module?: unknown;
  picture?: unknown;
};

type SourceManifest = {
  entry?: unknown;
};

const COMMUNITY_MANIFEST_URL =
  'https://raw.githubusercontent.com/Drun555/PixooPal-Community/refs/heads/master/manifest.json';
const COMMUNITY_RAW_BASE_URL =
  'https://raw.githubusercontent.com/Drun555/PixooPal-Community/refs/heads/master/';

export async function getCommunityClockfacesCatalog() {
  const [manifest, installedClockfaces] = await Promise.all([
    fetchCommunityManifest(),
    getInstalledCommunityClockfaceMap()
  ]);

  return manifest.map((clockface) => ({
    ...clockface,
    pictureUrl: clockface.picture ? resolveCommunityUrl(clockface.picture) : undefined,
    installed: installedClockfaces.has(clockface.id),
    outdated: isCommunityClockfaceOutdated(clockface, installedClockfaces.get(clockface.id))
  })).sort((left, right) => getTimestamp(right.createdAt) - getTimestamp(left.createdAt));
}

export async function getCommunityClockfaceDetail(id: string): Promise<CommunityClockfaceDetail> {
  const safeId = normalizeClockfaceId(id);
  const catalog = await getCommunityClockfacesCatalog();
  const clockface = catalog.find((item) => item.id === safeId);

  if (!clockface) {
    throw new Error(`Community clockface "${id}" was not found.`);
  }

  const files = await getCommunityClockfaceSourceFiles(clockface);
  const primaryCodeFile = files.find((file) => file.kind === 'code') ?? files[0];

  return {
    ...clockface,
    files
  };
}

export async function installCommunityClockface(id: string) {
  const safeId = normalizeClockfaceId(id);
  const clockface = (await fetchCommunityManifest()).find((item) => item.id === safeId);

  if (!clockface) {
    throw new Error(`Community clockface "${id}" was not found.`);
  }

  const targetDirectory = getCommunityClockfaceDirectory(clockface.id);
  await rm(targetDirectory, { force: true, recursive: true });
  await mkdir(targetDirectory, { recursive: true });

  const moduleFileName = `${clockface.id}.mjs`;
  const modulePath = join(targetDirectory, moduleFileName);
  await writeFile(modulePath, await downloadBytes(resolveCommunityUrl(clockface.module)));

  let pictureFileName: string | undefined;

  if (clockface.picture) {
    const extension = normalizePictureExtension(extname(clockface.picture));
    pictureFileName = `picture${extension}`;
    await writeFile(
      join(targetDirectory, pictureFileName),
      await downloadBytes(resolveCommunityUrl(clockface.picture))
    );
  }

  await writeFile(
    join(targetDirectory, 'manifest.json'),
    `${JSON.stringify(
      {
        id: clockface.id,
        name: clockface.name,
        description: clockface.description,
        author: clockface.author,
        createdAt: clockface.createdAt,
        updatedAt: clockface.updatedAt,
        module: `./${moduleFileName}`,
        picture: pictureFileName ? `./${pictureFileName}` : undefined
      },
      null,
      2
    )}\n`,
    'utf-8'
  );

  return clockface;
}

export async function deleteCommunityClockface(id: string) {
  const safeId = normalizeClockfaceId(id);

  if (!safeId) {
    throw new Error('Community clockface id cannot be empty.');
  }

  await rm(getCommunityClockfaceDirectory(safeId), { force: true, recursive: true });
}

export async function getInstalledCommunityClockfaces(): Promise<InstalledCommunityClockface[]> {
  const communityClockfacesDir = getCommunityClockfacesDir();

  if (!existsSync(communityClockfacesDir)) {
    return [];
  }

  const directories = await readdir(communityClockfacesDir, { withFileTypes: true });
  const clockfaces = await Promise.all(
    directories
      .filter((entry) => entry.isDirectory())
      .map((entry) => readInstalledCommunityClockface(entry.name))
  );

  return clockfaces.filter((clockface): clockface is InstalledCommunityClockface => Boolean(clockface));
}

export async function getInstalledCommunityClockfacePicture(id: string) {
  const safeId = normalizeClockfaceId(id);
  const clockface = (await getInstalledCommunityClockfaces()).find((item) => item.id === safeId);

  if (!clockface?.picturePath) {
    return undefined;
  }

  return {
    bytes: await readFile(clockface.picturePath),
    contentType: getPictureContentType(clockface.picturePath)
  };
}

async function fetchCommunityManifest(): Promise<CommunityClockfaceCatalogItem[]> {
  const response = await fetch(COMMUNITY_MANIFEST_URL);

  if (!response.ok) {
    throw new Error(`Community manifest request failed: ${response.status}`);
  }

  const manifest = (await response.json()) as CommunityManifest;
  const clockfaces = Array.isArray(manifest.clockfaces) ? manifest.clockfaces : [];

  return clockfaces
    .map(parseCommunityClockface)
    .filter((clockface): clockface is CommunityClockfaceCatalogItem => Boolean(clockface));
}

async function readInstalledCommunityClockface(
  directoryName: string
): Promise<InstalledCommunityClockface | undefined> {
  const targetDirectory = getCommunityClockfaceDirectory(directoryName);
  const manifestPath = join(targetDirectory, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return undefined;
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as InstalledManifest;
  const id = normalizeClockfaceId(stringValue(manifest.id) ?? directoryName);
  const module = normalizeRelativePath(stringValue(manifest.module));

  if (!module) {
    return undefined;
  }

  const modulePath = resolveCommunityFile(targetDirectory, module);

  if (!existsSync(modulePath)) {
    return undefined;
  }

  const picture = normalizeRelativePath(stringValue(manifest.picture));
  const picturePath = picture ? resolveCommunityFile(targetDirectory, picture) : undefined;

  return {
    id,
    name: stringValue(manifest.name) ?? splitCamelCase(id),
    description: stringValue(manifest.description),
    author: stringValue(manifest.author),
    createdAt: stringValue(manifest.createdAt),
    updatedAt: stringValue(manifest.updatedAt),
    modulePath,
    picturePath: picturePath && existsSync(picturePath) ? picturePath : undefined,
    pictureUrl: `/api/v1/community-clockfaces/${encodeURIComponent(id)}/picture`
  };
}

async function getInstalledCommunityClockfaceMap() {
  return new Map((await getInstalledCommunityClockfaces()).map((clockface) => [clockface.id, clockface]));
}

function parseCommunityClockface(value: unknown): CommunityClockfaceCatalogItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const clockface = value as CommunityManifestClockface;
  const id = normalizeClockfaceId(stringValue(clockface.id) ?? '');
  const module = normalizeRelativePath(stringValue(clockface.module));

  if (!id || !module) {
    return undefined;
  }

  return {
    id,
    name: stringValue(clockface.name) ?? splitCamelCase(id),
    description: stringValue(clockface.description),
    author: stringValue(clockface.author),
    createdAt: stringValue(clockface.createdAt),
    updatedAt: stringValue(clockface.updatedAt),
    module,
    picture: normalizeRelativePath(stringValue(clockface.picture)),
    source: normalizeRelativePath(stringValue(clockface.source)),
    sourceFiles: normalizeSourceFiles(clockface.sourceFiles, id),
    tags: normalizeTags(clockface.tags),
    installed: false,
    outdated: false
  };
}

async function downloadBytes(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Community asset request failed: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function downloadText(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Community source request failed: ${response.status}`);
  }

  return response.text();
}

async function getCommunityClockfaceSourceFiles(
  clockface: CommunityClockfaceCatalogItem
): Promise<CommunityClockfaceSourceFile[]> {
  const paths = clockface.sourceFiles?.length
    ? clockface.sourceFiles
    : await getFallbackSourceFiles(clockface);

  return Promise.all(paths.map((path) => getCommunityClockfaceSourceFile(path)));
}

async function getFallbackSourceFiles(clockface: CommunityClockfaceCatalogItem) {
  if (!clockface.source) {
    throw new Error(`Community clockface "${clockface.id}" does not provide source information.`);
  }

  const sourceManifest = JSON.parse(await downloadText(resolveCommunityUrl(clockface.source))) as SourceManifest;
  const entry = normalizeRelativePath(stringValue(sourceManifest.entry));

  if (!entry) {
    throw new Error(`Community source manifest "${clockface.source}" does not provide a valid entry.`);
  }

  return [join(dirname(clockface.source), entry).replaceAll('\\', '/')];
}

async function getCommunityClockfaceSourceFile(path: string): Promise<CommunityClockfaceSourceFile> {
  const extension = extname(path).toLowerCase();
  const url = resolveCommunityUrl(path);
  const base = {
    path,
    name: basename(path),
    url
  };

  if (isSourceImageExtension(extension)) {
    return {
      ...base,
      kind: 'image'
    };
  }

  const language = getSourceLanguage(extension);

  if (!language) {
    return {
      ...base,
      kind: 'asset'
    };
  }

  const sourceCode = await downloadText(url);
  const highlightedSource = await codeToHtml(sourceCode, {
    lang: language,
    theme: 'github-dark'
  });

  return {
    ...base,
    kind: 'code',
    language,
    sourceCode,
    highlightedSource
  };
}

function resolveCommunityUrl(path: string) {
  return new URL(path.replace(/^\.\/+/, ''), COMMUNITY_RAW_BASE_URL).toString();
}

function resolveCommunityFile(directory: string, path: string) {
  const resolvedPath = resolve(directory, path.replace(/^\.\/+/, ''));

  if (!resolvedPath.startsWith(directory)) {
    throw new Error(`Community clockface path "${path}" is outside of its directory.`);
  }

  return resolvedPath;
}

function getCommunityClockfaceDirectory(id: string) {
  return join(getCommunityClockfacesDir(), normalizeClockfaceId(id));
}

function getCommunityClockfacesDir() {
  return getDataPath('CommunityClockfaces');
}

export function getCommunityClockfacesDebugInfo() {
  return {
    dataDir: getDataDir(),
    communityClockfacesDir: getCommunityClockfacesDir()
  };
}

function isCommunityClockfaceOutdated(
  remote: CommunityClockfaceCatalogItem,
  installed: InstalledCommunityClockface | undefined
) {
  if (!installed || !remote.updatedAt) {
    return false;
  }

  if (!installed.updatedAt) {
    return true;
  }

  return Date.parse(remote.updatedAt) > Date.parse(installed.updatedAt);
}

function getTimestamp(value: string | undefined) {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : Number.MIN_SAFE_INTEGER;
}

function normalizeClockfaceId(id: string) {
  return id.trim().replace(/[^\w-]/g, '');
}

function normalizeRelativePath(path: string | undefined) {
  if (!path) {
    return undefined;
  }

  const normalized = path.trim();

  if (!normalized || normalized.includes('..') || normalized.startsWith('/') || /^[a-z]+:/i.test(normalized)) {
    return undefined;
  }

  return normalized.replaceAll('\\', '/');
}

function normalizeSourceFiles(value: unknown, id: string) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sourcePrefix = `src/${id}/`;
  const files = value
    .map((item) => normalizeRelativePath(stringValue(item)))
    .filter((item): item is string => Boolean(item))
    .filter((item) => item.startsWith(sourcePrefix));

  return files.length > 0 ? [...new Set(files)] : undefined;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags = value
    .map((item) => stringValue(item))
    .filter((item): item is string => Boolean(item));

  return [...new Set(tags)];
}

function getSourceLanguage(extension: string) {
  if (extension === '.ts' || extension === '.tsx') {
    return 'ts';
  }

  if (extension === '.js' || extension === '.jsx' || extension === '.mjs') {
    return 'js';
  }

  if (extension === '.json') {
    return 'json';
  }

  if (extension === '.css') {
    return 'css';
  }

  if (extension === '.html' || extension === '.svg') {
    return 'html';
  }

  if (extension === '.md') {
    return 'md';
  }

  return undefined;
}

function isSourceImageExtension(extension: string) {
  return ['.gif', '.jpg', '.jpeg', '.png', '.webp'].includes(extension);
}

function normalizePictureExtension(extension: string) {
  const normalized = extension.toLowerCase();
  return ['.gif', '.jpg', '.jpeg', '.png', '.webp'].includes(normalized) ? normalized : '.png';
}

function getPictureContentType(path: string) {
  const extension = extname(path).toLowerCase();

  if (extension === '.gif') {
    return 'image/gif';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  return 'image/png';
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function splitCamelCase(value: string) {
  return basename(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
