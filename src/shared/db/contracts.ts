import type {
  AuthProfileMetadata,
  ProjectScopedCacheTable,
  ProjectScopedReadItemBase
} from '../../types/aps.js';

export type SupportedStorageBackend = 'sqlite' | 'mysql';

export type ProjectScopedReadCachePort = {
  replace<TItem extends ProjectScopedReadItemBase>(
    table: ProjectScopedCacheTable,
    projectId: string,
    items: TItem[]
  ): void;
  getFresh<TItem extends ProjectScopedReadItemBase>(
    table: ProjectScopedCacheTable,
    projectId: string,
    ttlMs: number
  ): TItem[] | null;
};

export type AuthMetadataPort = {
  upsert(metadata: AuthProfileMetadata): Promise<void>;
  clearByTokenStore(tokenStorePath: string): Promise<void>;
};
