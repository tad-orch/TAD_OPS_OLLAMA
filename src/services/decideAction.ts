import type { ActionDecision, EvidenceSummary, TurnAnalysis } from '../types/agent.js';

export function decideAction(
  analysis: TurnAnalysis,
  evidence: EvidenceSummary
): ActionDecision {
  if (analysis.socialIntent === 'greeting') {
    return {
      kind: 'answer_chat',
      executionMode: 'chat',
      reason: 'saludo simple detectado',
      message: 'Hola. Como te ayudo con ACC?'
    };
  }

  if (analysis.socialIntent === 'thanks') {
    return {
      kind: 'answer_chat',
      executionMode: 'chat',
      reason: 'agradecimiento simple detectado',
      message: 'De nada. Si quieres, seguimos con la siguiente consulta.'
    };
  }

  if (analysis.socialIntent === 'goodbye') {
    return {
      kind: 'answer_chat',
      executionMode: 'chat',
      reason: 'despedida simple detectada',
      message: 'Hasta luego.'
    };
  }

  if (analysis.socialIntent === 'small_talk') {
    return {
      kind: 'answer_chat',
      executionMode: 'chat',
      reason: 'small talk simple detectado',
      message: 'Todo bien por aqui. Vamos con calma y seguimos.'
    };
  }

  if (analysis.authIntent === 'check_auth_status') {
    return {
      kind: 'answer_local',
      executionMode: 'local_snapshot_query',
      reason: 'consulta explicita sobre estado de autenticacion'
    };
  }

  if (analysis.authIntent === 'start_auth') {
    return {
      kind: 'fetch_external',
      executionMode: 'external_fetch',
      reason: 'solicitud explicita de iniciar autenticacion'
    };
  }

  if (analysis.plan.mode === 'chat' && !analysis.isAnalyticalFollowUp) {
    return {
      kind: 'answer_chat',
      executionMode: 'chat',
      reason: 'turno conversacional sin operacion ACC requerida',
      message: 'Estoy aqui. Dime como te ayudo.'
    };
  }

  if (analysis.asksForClarificationCandidate && !evidence.currentProjectId && analysis.needsProjectScope) {
    return {
      kind: 'ask_clarification',
      executionMode: 'ask_clarification',
      reason: 'falta proyecto confiable para la operacion solicitada',
      message:
        analysis.plan.clarificationQuestion ??
        'Necesito saber que proyecto quieres usar antes de continuar.'
    };
  }

  if (analysis.needsConstructionAuth && evidence.authReadyForConstructionEndpoints === false) {
    return {
      kind: 'request_auth',
      executionMode: 'request_auth',
      reason: 'la operacion requiere auth 3-legged lista para endpoints de construccion',
      message:
        'Necesito autenticacion ACC de usuario para esa consulta. Si quieres, ejecuta start_acc_user_login.'
    };
  }

  if (analysis.isAnalyticalFollowUp && evidence.hasWorkingSet) {
    return {
      kind: 'answer_local',
      executionMode: 'local_snapshot_query',
      reason: evidence.reason
    };
  }

  if (analysis.isAnalyticalFollowUp && evidence.hasRawEvidence && !evidence.hasCanonicalEvidence) {
    return {
      kind: 'answer_from_raw',
      executionMode: 'local_snapshot_query',
      reason: evidence.reason
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

  if (evidence.hasRawEvidence) {
    return {
      kind: 'answer_from_raw',
      executionMode: 'local_snapshot_query',
      reason: evidence.reason
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
    reason: 'no hay evidencia suficiente ni una accion externa confiable derivada',
    message:
      analysis.plan.clarificationQuestion ??
      'Necesito una aclaracion para responder con confianza.'
  };
}
