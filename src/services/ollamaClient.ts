import ollama from 'ollama';
import type { ChatResponse, Message, Tool } from 'ollama';
import { env } from '../config/env.js';

export const ollamaClient = ollama;

type ChatWithOllamaOptions = {
  tools?: Tool[] | undefined;
  format?: string | object | undefined;
};

export function getOllamaModel(): string {
  return env.ollamaModel;
}

export async function chatWithOllama(
  messages: Message[],
  options: ChatWithOllamaOptions = {}
): Promise<ChatResponse> {
  const approxCharCount = messages.reduce((total, message) => total + message.content.length, 0);
  console.log(
    `[ollama] messages=${messages.length} approxChars=${approxCharCount}${env.ollamaContextLength ? ` num_ctx=${env.ollamaContextLength}` : ''}`
  );

  return ollamaClient.chat({
    model: getOllamaModel(),
    messages,
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.format ? { format: options.format } : {}),
    ...(env.ollamaContextLength ? { options: { num_ctx: env.ollamaContextLength } } : {}),
    stream: false
  });
}
