import ollama from 'ollama';
import type { ChatResponse, Message, Tool } from 'ollama';
import { env } from '../config/env.js';

export const ollamaClient = ollama;

type ChatWithOllamaOptions = {
  tools?: Tool[];
  format?: string | object;
};

export function getOllamaModel(): string {
  return env.ollamaModel;
}

export async function chatWithOllama(
  messages: Message[],
  options: ChatWithOllamaOptions = {}
): Promise<ChatResponse> {
  if (options.tools !== undefined && !Array.isArray(options.tools)) {
    throw new Error('chatWithOllama recibió tools inválido. Se esperaba un arreglo.');
  }

  const approxCharCount = messages.reduce(
    (total, message) => total + message.content.length,
    0
  );

  const modelOptions: Record<string, number> = {};

  if (env.ollamaContextLength) {
    modelOptions.num_ctx = env.ollamaContextLength;
  }

  if (env.ollamaTemperature !== undefined) {
    modelOptions.temperature = env.ollamaTemperature;
  }

  if (env.ollamaRepeatPenalty !== undefined) {
    modelOptions.repeat_penalty = env.ollamaRepeatPenalty;
  }

  console.log(
    `[ollama] messages=${messages.length} approxChars=${approxCharCount}` +
      `${modelOptions.num_ctx ? ` num_ctx=${modelOptions.num_ctx}` : ''}` +
      `${modelOptions.temperature !== undefined ? ` temp=${modelOptions.temperature}` : ''}` +
      `${modelOptions.repeat_penalty !== undefined ? ` repeat_penalty=${modelOptions.repeat_penalty}` : ''}`
  );

  return ollamaClient.chat({
    model: getOllamaModel(),
    messages,
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.format !== undefined ? { format: options.format } : {}),
    ...(Object.keys(modelOptions).length ? { options: modelOptions } : {}),
    stream: false
  });
}
