import type { ActionDecision, EvidenceSummary, TurnAnalysis } from '../types/agent.js';

export function decideAction(
  analysis: TurnAnalysis,
  evidence: EvidenceSummary
): ActionDecision {
  if (analysis.plan.mode === 'chat' && !analysis.isAnalyticalFollowUp) {
    return {
      kind: 'answer_local',
      executionMode: 'chat',
      reason: 'turno conversacional sin operación ACC requerida'
    };
  }

  if (analysis.asksForClarificationCandidate && !evidence.currentProjectId && analysis.needsProjectScope) {
    return {
      kind: 'ask_clarification',
      executionMode: 'ask_clarification',
      reason: 'falta proyecto confiable para la operación solicitada',
      message:
        analysis.plan.clarificationQuestion ??
        'Necesito saber qué proyecto quieres usar antes de continuar.'
    };
  }

  if (analysis.needsConstructionAuth && evidence.authReadyForConstructionEndpoints === false) {
    return {
      kind: 'request_auth',
      executionMode: 'request_auth',
      reason: 'la operación requiere auth 3-legged lista para endpoints de construcción',
      message:
        'Necesito autenticación ACC de usuario para esa consulta. Si quieres, ejecuta start_acc_user_login.'
    };
  }

  if (analysis.isAnalyticalFollowUp && evidence.evidenceSufficientForLocalAnswer) {
    return {
      kind: 'answer_local',
      executionMode: 'local_snapshot_query',
      reason: evidence.reason
    };
  }

  if (analysis.executionModeHint === 'fetch_then_analyze') {
    return {
      kind: 'fetch_then_analyze',
      executionMode: 'fetch_then_analyze',
      reason: 'la pregunta compuesta necesita traer datos y luego analizarlos'
    };
  }

  if (analysis.plan.requiresTools) {
    return {
      kind: 'fetch_external',
      executionMode: 'external_fetch',
      reason: 'la evidencia local no alcanza y la tool sigue siendo necesaria'
    };
  }

  if (evidence.evidenceSufficientForLocalAnswer) {
    return {
      kind: 'answer_local',
      executionMode: 'local_snapshot_query',
      reason: evidence.reason
    };
  }

  return {
    kind: 'ask_clarification',
    executionMode: 'ask_clarification',
    reason: 'no hay evidencia suficiente ni una acción externa confiable derivada',
    message:
      analysis.plan.clarificationQuestion ??
      'Necesito una aclaración para responder con confianza.'
  };
}
