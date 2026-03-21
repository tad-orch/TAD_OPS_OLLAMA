import { getProjectIssuesTool, getProjectIssuesToolDefinition } from '../domains/issues/tool.js';
import { getProjectRfisTool, getProjectRfisToolDefinition } from '../domains/rfis/tool.js';
import {
  getProjectSubmittalsTool,
  getProjectSubmittalsToolDefinition
} from '../domains/submittals/tool.js';
import {
  getProjectTransmittalsTool,
  getProjectTransmittalsToolDefinition
} from '../domains/transmittals/tool.js';
import { getProjectUsersTool, getProjectUsersToolDefinition } from './getProjectUsersTool.js';
import { getProjectsByAccountTool, getProjectsToolDefinition } from './getProjectsTool.js';

export const toolDefinitions = [
  getProjectsToolDefinition,
  getProjectUsersToolDefinition,
  getProjectIssuesToolDefinition,
  getProjectRfisToolDefinition,
  getProjectSubmittalsToolDefinition,
  getProjectTransmittalsToolDefinition
];

export const toolHandlers = {
  get_projects_by_account: getProjectsByAccountTool,
  get_project_users: getProjectUsersTool,
  get_project_issues: getProjectIssuesTool,
  get_project_rfis: getProjectRfisTool,
  get_project_submittals: getProjectSubmittalsTool,
  get_project_transmittals: getProjectTransmittalsTool
};
