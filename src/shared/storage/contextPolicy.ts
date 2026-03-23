export type StorageDecision = {
  storeRawDocument: boolean;
  storeCanonicalRows: boolean;
  storeFullStructuredCache: boolean;
  summarizeForPrompt: boolean;
  chunkLargeResults: boolean;
  maxPromptItems: number;
  refetchWhen: string[];
};

export const endpointStoragePolicy: Record<string, StorageDecision> = {
  'acc.account-admin.projects': {
    storeRawDocument: true,
    storeCanonicalRows: true,
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'filter_not_available_locally']
  },
  'acc.account-admin.project-users': {
    storeRawDocument: true,
    storeCanonicalRows: true,
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'company_filter_requires_fresh_source']
  },
  'acc.issues': {
    storeRawDocument: true,
    storeCanonicalRows: true,
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'status_or_search_not_satisfied_locally']
  },
  'acc.rfis': {
    storeRawDocument: true,
    storeCanonicalRows: true,
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'status_or_search_not_satisfied_locally']
  },
  'acc.submittals': {
    storeRawDocument: true,
    storeCanonicalRows: true,
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'status_or_search_not_satisfied_locally']
  },
  'acc.transmittals': {
    storeRawDocument: true,
    storeCanonicalRows: true,
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'status_or_search_not_satisfied_locally']
  },
  'data-management.projects': {
    storeRawDocument: true,
    storeCanonicalRows: true,
    storeFullStructuredCache: false,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['hub_changed', 'cache_expired']
  }
};
