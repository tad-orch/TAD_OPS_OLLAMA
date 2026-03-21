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

export const env = {
  apsClientId: required('APS_CLIENT_ID'),
  apsClientSecret: required('APS_CLIENT_SECRET'),
  apsAccountId: required('APS_ACCOUNT_ID'),
  apsUserId: required('APS_USER_ID'),
  apsBaseUrl: required('APS_BASE_URL').replace(/\/+$/, ''),
  ollamaModel: optional('OLLAMA_MODEL', 'qwen3:14b'),
  ollamaContextLength: optionalInt('OLLAMA_CONTEXT_LENGTH'),
  ollamaTemperature: optionalFloat('OLLAMA_TEMPERATURE'),
  ollamaRepeatPenalty: optionalFloat('OLLAMA_REPEAT_PENALTY'),
};