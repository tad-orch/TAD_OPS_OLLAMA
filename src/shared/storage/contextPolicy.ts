export type StorageDecision = {
  storeFullStructuredCache: boolean;
  summarizeForPrompt: boolean;
  chunkLargeResults: boolean;
  maxPromptItems: number;
  refetchWhen: string[];
};

export const endpointStoragePolicy: Record<string, StorageDecision> = {
  'acc.account-admin.projects': {
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'filter_not_available_locally']
  },
  'acc.account-admin.project-users': {
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'company_filter_requires_fresh_source']
  },
  'acc.issues': {
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'status_or_search_not_satisfied_locally']
  },
  'acc.rfis': {
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'status_or_search_not_satisfied_locally']
  },
  'acc.submittals': {
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'status_or_search_not_satisfied_locally']
  },
  'acc.transmittals': {
    storeFullStructuredCache: true,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['cache_expired', 'status_or_search_not_satisfied_locally']
  },
  'data-management.projects': {
    storeFullStructuredCache: false,
    summarizeForPrompt: true,
    chunkLargeResults: true,
    maxPromptItems: 20,
    refetchWhen: ['hub_changed', 'cache_expired']
  }
};
