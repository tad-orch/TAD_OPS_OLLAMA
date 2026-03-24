type ConversationRouteResult =
  | {
      kind: 'greeting' | 'thanks' | 'goodbye' | 'small_talk';
      message: string;
    }
  | {
      kind: 'auth_status';
    }
  | {
      kind: 'auth_start';
    };

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.,/¿¡…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function routePureConversation(userText: string): ConversationRouteResult | undefined {
  const normalized = normalize(userText);

  if (/^(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches)$/.test(normalized)) {
    return {
      kind: 'greeting',
      message: 'Hola. Como te ayudo con ACC?'
    };
  }

  if (/^(gracias|muchas gracias|thanks|thank you)$/.test(normalized)) {
    return {
      kind: 'thanks',
      message: 'De nada. Si quieres, seguimos con la siguiente consulta.'
    };
  }

  if (/^(adios|bye|hasta luego|nos vemos)$/.test(normalized)) {
    return {
      kind: 'goodbye',
      message: 'Hasta luego.'
    };
  }

  if (
    /^(como estas(?: hoy)?|como vas|como sigues|que tal|todo bien|relajate|tranquilo|tranquila|calma|con calma)$/.test(normalized)
  ) {
    return {
      kind: 'small_talk',
      message: 'Todo bien por aqui. Vamos con calma y avanzamos paso a paso.'
    };
  }

  if (
    /\b(tenemos token|ya tenemos token|hay auth disponible|ya iniciamos sesion|estado del login|revisa el estado del login|revisa auth|auth disponible)\b/.test(normalized)
  ) {
    return {
      kind: 'auth_status'
    };
  }

  if (
    /\b(vamos a iniciar sesion|haz login|inicia sesion|iniciar sesion|necesito autenticarme|autenticarme|login acc)\b/.test(normalized)
  ) {
    return {
      kind: 'auth_start'
    };
  }

  return undefined;
}
