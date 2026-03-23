import type { StoredUserAuth } from '../../services/apsUserAuth.js';
import { nowIso } from '../../utils/ids.js';
import { ensureMysqlSchema, getMysqlPool, isMysqlConfigured, toMysqlDateTime } from '../db/mysql.js';

export function getTokenStoreMetadataKey(storePath: string): string {
  return `aps-user-auth:${storePath}`;
}

export async function syncAuthMetadata(
  auth: StoredUserAuth,
  storePath: string
): Promise<void> {
  if (!isMysqlConfigured()) {
    return;
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  const profileId = auth.profile?.userId ?? auth.profile?.email ?? 'active-profile';
  const displayName = auth.profile?.name ?? auth.profile?.email ?? null;
  const email = auth.profile?.email ?? null;
  const updatedAt = toMysqlDateTime(nowIso());

  await pool.execute(
    `
    INSERT INTO auth_profiles (
      profile_id, display_name, email, auth_mode, scopes_json, expires_at, token_store_path, is_active, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON DUPLICATE KEY UPDATE
      display_name = VALUES(display_name),
      email = VALUES(email),
      auth_mode = VALUES(auth_mode),
      scopes_json = VALUES(scopes_json),
      expires_at = VALUES(expires_at),
      token_store_path = VALUES(token_store_path),
      is_active = 1,
      updated_at = VALUES(updated_at)
    `,
    [
      profileId,
      displayName,
      email,
      '3legged',
      JSON.stringify(auth.scopes),
      toMysqlDateTime(auth.expires_at),
      storePath,
      updatedAt
    ]
  );

  await pool.execute(
    `
    INSERT INTO token_storage_metadata (
      storage_key, store_path, store_kind, auth_mode, has_refresh_token, scopes_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      store_path = VALUES(store_path),
      store_kind = VALUES(store_kind),
      auth_mode = VALUES(auth_mode),
      has_refresh_token = VALUES(has_refresh_token),
      scopes_json = VALUES(scopes_json),
      updated_at = VALUES(updated_at)
    `,
    [
      getTokenStoreMetadataKey(storePath),
      storePath,
      'file_json',
      '3legged',
      auth.refresh_token ? 1 : 0,
      JSON.stringify(auth.scopes),
      updatedAt
    ]
  );
}

export async function clearAuthMetadata(storePath: string, storageKey: string): Promise<void> {
  if (!isMysqlConfigured()) {
    return;
  }

  await ensureMysqlSchema();
  const pool = await getMysqlPool();
  const updatedAt = toMysqlDateTime(nowIso());

  await pool.execute(
    `
    UPDATE auth_profiles
    SET is_active = 0, updated_at = ?
    WHERE token_store_path = ?
    `,
    [updatedAt, storePath]
  );

  await pool.execute(
    `
    INSERT INTO token_storage_metadata (
      storage_key, store_path, store_kind, auth_mode, has_refresh_token, scopes_json, updated_at
    )
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON DUPLICATE KEY UPDATE
      auth_mode = VALUES(auth_mode),
      has_refresh_token = VALUES(has_refresh_token),
      scopes_json = VALUES(scopes_json),
      updated_at = VALUES(updated_at)
    `,
    [storageKey, storePath, 'file_json', '3legged', JSON.stringify([]), updatedAt]
  );
}
