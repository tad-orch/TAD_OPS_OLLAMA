import type {
  ApsProject,
  ApsProjectUser,
  ProjectScopedReadToolResult,
  GetProjectUsersToolResult,
  GetProjectsToolResult
} from '../types/aps.js';

const MAX_ITEMS_FOR_MODEL = 20;

export function summarizeProjectsForModel(projects: ApsProject[]): GetProjectsToolResult {
  return {
    count: projects.length,
    projects: projects.slice(0, MAX_ITEMS_FOR_MODEL).map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      type: project.type
    })),
    note:
      projects.length > MAX_ITEMS_FOR_MODEL
        ? `Hay ${projects.length} proyectos totales; se guardaron completos en cache local.`
        : undefined
  };
}

export function summarizeUsersForModel(
  projectId: string,
  users: ApsProjectUser[]
): GetProjectUsersToolResult {
  return {
    count: users.length,
    projectId,
    users: users.slice(0, MAX_ITEMS_FOR_MODEL).map((user) => ({
      id: user.id,
      autodeskId: user.autodeskId,
      email: user.email,
      name: user.name,
      companyName: user.companyName,
      status: user.status,
      products: user.products.slice(0, 5),
      roles: user.roles.slice(0, 5)
    })),
    note:
      users.length > MAX_ITEMS_FOR_MODEL
        ? `Hay ${users.length} usuarios totales; se guardaron completos en cache local.`
        : undefined
  };
}

export function summarizeProjectScopedReadForModel<TItem>(
  projectId: string,
  items: TItem[],
  source: string,
  warning?: string
): ProjectScopedReadToolResult<TItem> {
  const nextWarning =
    items.length > MAX_ITEMS_FOR_MODEL
      ? warning
        ? `${warning} Se muestran ${MAX_ITEMS_FOR_MODEL} de ${items.length} resultados; el snapshot completo reciente queda disponible para follow-ups.`
        : `Se muestran ${MAX_ITEMS_FOR_MODEL} de ${items.length} resultados; el snapshot completo reciente queda disponible para follow-ups.`
      : warning;

  return {
    projectId,
    total: items.length,
    items: items.slice(0, MAX_ITEMS_FOR_MODEL),
    source,
    ...(nextWarning ? { warning: nextWarning } : {})
  };
}

export function summarizeToolResultForStorage(toolName: string, payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return String(payload);
  }

  const maybeCount = Reflect.get(payload, 'count');
  if (typeof maybeCount === 'number') {
    return `${toolName}: ${maybeCount} resultados`;
  }

  const maybeTotal = Reflect.get(payload, 'total');
  if (typeof maybeTotal === 'number') {
    return `${toolName}: ${maybeTotal} resultados`;
  }

  return `${toolName}: resultado registrado`;
}
