import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_PATH = join(DATA_DIR, 'config.json');

const DEFAULTS = {
  ownerId: '1524480031836078220',
  roles: { verified: null, unverified: null, muted: null, moderator: null },
  whitelist: [],
  verifyPanels: [],
  honeyChannels: [],
};

function load() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return {
      ownerId: raw.ownerId ?? DEFAULTS.ownerId,
      roles: { ...DEFAULTS.roles, ...(raw.roles ?? {}) },
      whitelist: Array.isArray(raw.whitelist) ? raw.whitelist : [],
      verifyPanels: Array.isArray(raw.verifyPanels) ? raw.verifyPanels : [],
      honeyChannels: Array.isArray(raw.honeyChannels) ? raw.honeyChannels : [],
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const config = load();

let timer = null;

function write() {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(config, null, 2));
  renameSync(tmp, CONFIG_PATH);
}

export function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    write();
  }, 500);
}

export function saveNow() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  write();
}