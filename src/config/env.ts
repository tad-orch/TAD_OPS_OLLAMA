import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno: ${name}`);
  }
  return value;
}

export const env = {
  apsClientId: required('APS_CLIENT_ID'),
  apsClientSecret: required('APS_CLIENT_SECRET'),
  apsAccountId: required('APS_ACCOUNT_ID'),
  apsUserId: required('APS_USER_ID'),
  apsBaseUrl: (process.env.APS_BASE_URL || 'https://developer.api.autodesk.com').replace(/\/+$/, ''),
};
