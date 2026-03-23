import { getProjectIssuesTool, getProjectIssuesToolDefinition } from '../domains/acc/issues/tool.js';
import { getProjectRfisTool, getProjectRfisToolDefinition } from '../domains/acc/rfis/tool.js';
import {
  getProjectSubmittalsTool,
  getProjectSubmittalsToolDefinition
} from '../domains/acc/submittals/tool.js';
import {
  getProjectTransmittalsTool,
  getProjectTransmittalsToolDefinition
} from '../domains/acc/transmittals/tool.js';
import {
  getProjectUsersTool,
  getProjectUsersToolDefinition
} from '../domains/acc/account-admin/project-users/tool.js';
import {
  getProjectsByAccountTool,
  getProjectsToolDefinition
} from '../domains/acc/account-admin/projects/tool.js';
import {
  getDataManagementProjectsTool,
  getDataManagementProjectsToolDefinition
} from '../domains/data-management/projects/tool.js';
import { startAccUserLoginTool, startAccUserLoginToolDefinition } from './startAccUserLoginTool.js';

export const toolDefinitions = [
  getProjectsToolDefinition,
  getProjectUsersToolDefinition,
  getDataManagementProjectsToolDefinition,
  startAccUserLoginToolDefinition,
  getProjectIssuesToolDefinition,
  getProjectRfisToolDefinition,
  getProjectSubmittalsToolDefinition,
  getProjectTransmittalsToolDefinition
];

export const toolHandlers = {
  get_projects_by_account: getProjectsByAccountTool,
  get_project_users: getProjectUsersTool,
  get_data_management_projects: getDataManagementProjectsTool,
  start_acc_user_login: startAccUserLoginTool,
  get_project_issues: getProjectIssuesTool,
  get_project_rfis: getProjectRfisTool,
  get_project_submittals: getProjectSubmittalsTool,
  get_project_transmittals: getProjectTransmittalsTool
};
