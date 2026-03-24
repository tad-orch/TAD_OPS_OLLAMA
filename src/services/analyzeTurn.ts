import { getSessionContext } from '../db/repositories/contextRepo.js';
import type { SnapshotDomain, StructuredTurnPlan, TurnAnalysis } from '../types/agent.js';
import { routePureConversation } from './conversationRoute.js';
import { determineExecutionMode, inferDomainFromPlan, isAnalyticalQuestion } from './localSnapshotQuery.js';

const CONSTRUCTION_DOMAINS = new Set<SnapshotDomain>(['issues', 'rfis', 'submittals', 'transmittals']);

export function analyzeTurn(
  sessionId: string,
  userText: string,
  plan: StructuredTurnPlan
): TurnAnalysis {
  const loweredText = userText.toLowerCase();
  const domain = inferDomainFromPlan(sessionId, plan, loweredText);
  const sessionContext = getSessionContext(sessionId);
  const fastRoute = routePureConversation(userText);
  const needsProjectScope =
    plan.intent === 'get_project_users' ||
    plan.intent === 'list_issues' ||
    plan.intent === 'list_rfis' ||
    plan.intent === 'list_submittals' ||
    plan.intent === 'list_transmittals';
  const needsConstructionAuth = Boolean(domain && CONSTRUCTION_DOMAINS.has(domain));
  const hasProjectHint = Boolean(
    plan.entities.projectId ||
      plan.entities.projectName ||
      plan.entities.useCurrentProject ||
      sessionContext?.current_project_id
  );

  return {
    userText,
    plan,
    executionModeHint: determineExecutionMode(sessionId, userText, plan),
    isAnalyticalFollowUp: isAnalyticalQuestion(loweredText),
    ...(domain ? { domain } : {}),
    ...(fastRoute?.kind === 'auth_status' ? { authIntent: 'check_auth_status' as const } : {}),
    ...(fastRoute?.kind === 'auth_start' ? { authIntent: 'start_auth' as const } : {}),
    ...(fastRoute?.kind === 'greeting' || fastRoute?.kind === 'thanks' || fastRoute?.kind === 'goodbye' || fastRoute?.kind === 'small_talk'
      ? { socialIntent: fastRoute.kind }
      : {}),
    needsProjectScope,
    needsConstructionAuth,
    asksForClarificationCandidate:
      plan.needsClarification || (needsProjectScope && !hasProjectHint)
  };
}
