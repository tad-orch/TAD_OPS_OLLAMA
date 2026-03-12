import type {
  ApsProject,
  ApsProjectUser,
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

export function summarizeToolResultForStorage(toolName: string, payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return String(payload);
  }

  const maybeCount = Reflect.get(payload, 'count');
  if (typeof maybeCount === 'number') {
    return `${toolName}: ${maybeCount} resultados`;
  }

  return `${toolName}: resultado registrado`;
}
