import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }

  throw new Error(`La variable de entorno ${name} debe ser booleana`);
}

function optionalEnum<TValue extends string>(
  name: string,
  allowed: readonly TValue[],
  fallback: TValue
): TValue {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  if (allowed.includes(raw as TValue)) {
    return raw as TValue;
  }

  throw new Error(`La variable de entorno ${name} debe ser una de: ${allowed.join(', ')}`);
}

function optionalInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`La variable de entorno ${name} debe ser numérica`);
  }
  return parsed;
}

function optionalFloat(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`La variable de entorno ${name} debe ser numérica`);
  }
  return parsed;
}

function optionalList(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const values = raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? [...new Set(values)] : fallback;
}

const DEFAULT_THREE_LEGGED_CALLBACK_URL = 'http://localhost:3000/auth/three-legged';
const apsThreeLeggedCallbackUrl = optional(
  'APS_THREE_LEGGED_CALLBACK_URL',
  DEFAULT_THREE_LEGGED_CALLBACK_URL
);

export const env = {
  apsClientId: required('APS_CLIENT_ID'),
  apsClientSecret: required('APS_CLIENT_SECRET'),
  apsAccountId: required('APS_ACCOUNT_ID'),
  apsUserId: required('APS_USER_ID'),
  apsBaseUrl: required('APS_BASE_URL').replace(/\/+$/, ''),
  apsHubId: process.env.APS_HUB_ID?.trim() || undefined,
  apsThreeLeggedCallbackUrl,
  apsThreeLeggedScopes: optionalList('APS_THREE_LEGGED_SCOPES', ['data:read', 'account:read']),
  storageBackend: optionalEnum(
    'STORAGE_BACKEND',
    ['sqlite', 'mysql'],
    process.env.MYSQL_HOST?.trim() ? 'mysql' : 'sqlite'
  ),
  mysqlHost: process.env.MYSQL_HOST?.trim() || undefined,
  mysqlPort: optionalInt('MYSQL_PORT') ?? 3306,
  mysqlDatabase: process.env.MYSQL_DATABASE?.trim() || undefined,
  mysqlUser: process.env.MYSQL_USER?.trim() || undefined,
  mysqlPassword: process.env.MYSQL_PASSWORD?.trim() || undefined,
  mysqlSsl: optionalBoolean('MYSQL_SSL', false),
  mysqlPoolMin: optionalInt('MYSQL_POOL_MIN') ?? 1,
  mysqlPoolMax: optionalInt('MYSQL_POOL_MAX') ?? 10,
  ollamaModel: optional('OLLAMA_MODEL', 'qwen3:14b'),
  ollamaContextLength: optionalInt('OLLAMA_CONTEXT_LENGTH'),
  ollamaTemperature: optionalFloat('OLLAMA_TEMPERATURE'),
  ollamaRepeatPenalty: optionalFloat('OLLAMA_REPEAT_PENALTY'),
};
