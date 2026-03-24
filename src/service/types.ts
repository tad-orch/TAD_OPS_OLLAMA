export type ServiceMeta = {
  source: 'working_set' | 'snapshot' | 'canonical_mysql' | 'raw_json' | 'acc_api_fresh' | 'auth_local' | 'service_resource';
  domain?: string | undefined;
  projectId?: string | undefined;
  freshness?: string | undefined;
  confidence?: number | undefined;
};

export type ServiceError = {
  code: string;
  message: string;
};

export type ServiceResponse<TData = unknown> = {
  ok: boolean;
  operation: string;
  data?: TData | undefined;
  meta: ServiceMeta;
  error?: ServiceError | undefined;
};

export type ServiceOperationRequest = {
  operation: string;
  input?: Record<string, unknown> | undefined;
};
