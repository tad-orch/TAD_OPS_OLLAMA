import { getProjectUsersTool, getProjectUsersToolDefinition } from './getProjectUsersTool.js';
import { getProjectsByAccountTool, getProjectsToolDefinition } from './getProjectsTool.js';

export const toolDefinitions = [
  getProjectsToolDefinition,
  getProjectUsersToolDefinition
];

export const toolHandlers = {
  get_projects_by_account: getProjectsByAccountTool,
  get_project_users: getProjectUsersTool
};
