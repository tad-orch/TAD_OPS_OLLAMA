import type { ChatResponse } from 'ollama';
import { systemPrompt } from '../prompts/systemPrompt.js';
import { buildContextForSession } from './contextBuilder.js';
import { chatWithOllama } from './ollamaClient.js';

type ResponseGenerationProfile = 'chat' | 'operate';

export async function generateFinalResponse(params: {
  sessionId: string;
  profile: ResponseGenerationProfile;
  resolvedContextSummary: string;
  additionalGuidance?: string | undefined;
}): Promise<ChatResponse> {
  const builtContext = buildContextForSession(params.sessionId, {
    includeStructuredContext: params.profile === 'operate',
    maxRecentMessages: params.profile === 'operate' ? 6 : 4
  });

  const stylePrompt =
    params.profile === 'chat'
      ? [
          'Modo respuesta: chat natural.',
          '- Responde en el idioma del usuario.',
          '- Sonido breve, calido y natural.',
          '- No fuerces una operacion ACC si el turno es social o conversacional.',
          '- Evita respuestas secas como "Te escucho".'
        ].join('\n')
      : [
          'Modo respuesta: operativo.',
          '- Responde directo y preciso.',
          '- Usa el contexto resuelto tal cual.',
          '- No pidas aclaracion si el proyecto o evidencia ya esta resuelto arriba.',
          '- No repitas listas completas si basta con una respuesta corta.'
        ].join('\n');

  return chatWithOllama(
    [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: stylePrompt },
      { role: 'system', content: params.resolvedContextSummary },
      ...(params.additionalGuidance ? [{ role: 'system' as const, content: params.additionalGuidance }] : []),
      ...builtContext.messages
    ],
    {
      responseProfile: params.profile
    }
  );
}
