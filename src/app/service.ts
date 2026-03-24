import { closeMysqlPool } from '../shared/db/mysql.js';
import { executeServiceOperation } from '../service/operations.js';
import type { ServiceOperationRequest } from '../service/types.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function loadRequest(): Promise<ServiceOperationRequest> {
  const [, , operationArg, inputArg] = process.argv;
  if (operationArg) {
    return {
      operation: operationArg,
      ...(inputArg ? { input: JSON.parse(inputArg) as Record<string, unknown> } : {})
    };
  }

  const stdinPayload = await readStdin();
  if (!stdinPayload) {
    throw new Error('Service mode requiere un operation por argv o JSON por stdin.');
  }

  return JSON.parse(stdinPayload) as ServiceOperationRequest;
}

async function main(): Promise<void> {
  try {
    const request = await loadRequest();
    const result = await executeServiceOperation(request.operation, request.input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await closeMysqlPool();
  }
}

main().catch((error) => {
  const payload = {
    ok: false,
    operation: 'service_bootstrap',
    meta: {
      source: 'service_resource'
    },
    error: {
      code: 'SERVICE_BOOTSTRAP_FAILED',
      message: error instanceof Error ? error.message : 'No se pudo iniciar service mode'
    }
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
});
