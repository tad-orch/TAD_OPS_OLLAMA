import { db } from '../../db/sqlite.js';
import type { StoredUserAuth } from '../../services/apsUserAuth.js';
import { nowIso } from '../../utils/ids.js';

export function getTokenStoreMetadataKey(storePath: string): string {
  return `aps-user-auth:${storePath}`;
}

export async function syncAuthMetadata(
  auth: StoredUserAuth,
  storePath: string
): Promise<void> {
  const profileId = auth.profile?.userId ?? auth.profile?.email ?? 'active-profile';
  const displayName = auth.profile?.name ?? auth.profile?.email ?? null;
  const email = auth.profile?.email ?? null;
  const updatedAt = nowIso();

  db.prepare(
    `
    INSERT INTO auth_profiles (
      profile_id, display_name, email, auth_mode, scopes_json, expires_at, token_store_path, is_active, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      display_name = excluded.display_name,
      email = excluded.email,
      auth_mode = excluded.auth_mode,
      scopes_json = excluded.scopes_json,
      expires_at = excluded.expires_at,
      token_store_path = excluded.token_store_path,
      is_active = 1,
      updated_at = excluded.updated_at
    `
  ).run(
    profileId,
    displayName,
    email,
    '3legged',
    JSON.stringify(auth.scopes),
    new Date(auth.expires_at).toISOString(),
    storePath,
    updatedAt
  );

  db.prepare(
    `
    INSERT INTO token_storage_metadata (
      storage_key, store_path, store_kind, auth_mode, has_refresh_token, scopes_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(storage_key) DO UPDATE SET
      store_path = excluded.store_path,
      store_kind = excluded.store_kind,
      auth_mode = excluded.auth_mode,
      has_refresh_token = excluded.has_refresh_token,
      scopes_json = excluded.scopes_json,
      updated_at = excluded.updated_at
    `
  ).run(
    getTokenStoreMetadataKey(storePath),
    storePath,
    'file_json',
    '3legged',
    auth.refresh_token ? 1 : 0,
    JSON.stringify(auth.scopes),
    updatedAt
  );
}

export async function clearAuthMetadata(storePath: string, storageKey: string): Promise<void> {
  const updatedAt = nowIso();

  db.prepare(
    `
    UPDATE auth_profiles
    SET is_active = 0, updated_at = ?
    WHERE token_store_path = ?
    `
  ).run(updatedAt, storePath);

  db.prepare(
    `
    INSERT INTO token_storage_metadata (
      storage_key, store_path, store_kind, auth_mode, has_refresh_token, scopes_json, updated_at
    )
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(storage_key) DO UPDATE SET
      auth_mode = excluded.auth_mode,
      has_refresh_token = excluded.has_refresh_token,
      scopes_json = excluded.scopes_json,
      updated_at = excluded.updated_at
    `
  ).run(storageKey, storePath, 'file_json', '3legged', JSON.stringify([]), updatedAt);
}
