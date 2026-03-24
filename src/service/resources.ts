import { getSessionContext } from '../db/repositories/contextRepo.js';
import { getSnapshotRegistry } from '../db/repositories/snapshotRegistryRepo.js';
import { getCurrentWorkingSet } from '../db/repositories/workingSetRepo.js';
import { getConstructionAuthStatus } from '../services/apsUserAuth.js';

export async function readServiceResource(input: {
  resource: 'auth_status' | 'working_set' | 'snapshot_registry' | 'session_context';
  sessionId?: string | undefined;
}): Promise<unknown> {
  if (input.resource === 'auth_status') {
    return getConstructionAuthStatus();
  }

  if (!input.sessionId) {
    return null;
  }

  if (input.resource === 'working_set') {
    return getCurrentWorkingSet(input.sessionId) ?? null;
  }

  if (input.resource === 'snapshot_registry') {
    return getSnapshotRegistry(input.sessionId);
  }

  return getSessionContext(input.sessionId) ?? null;
}
