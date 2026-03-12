export type OffsetPagination = {
  limit?: number;
  offset?: number;
  totalResults?: number;
};

type FetchAllPagesOptions<TResponse, TItem> = {
  initialLimit?: number;
  fetchPage: (page: { limit: number; offset: number }) => Promise<TResponse>;
  getItems: (response: TResponse) => TItem[];
  getPagination?: (response: TResponse) => OffsetPagination | undefined;
};

export async function fetchAllOffsetPages<TResponse, TItem>(
  options: FetchAllPagesOptions<TResponse, TItem>
): Promise<TItem[]> {
  const limit = options.initialLimit ?? 100;
  let currentOffset = 0;
  const allItems: TItem[] = [];

  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const response = await options.fetchPage({
      limit,
      offset: currentOffset
    });

    const items = options.getItems(response);
    allItems.push(...items);

    const pagination = options.getPagination?.(response);
    if (!pagination) {
      break;
    }

    const pageLimit = pagination.limit ?? limit;
    const pageOffset = pagination.offset ?? currentOffset;
    const totalResults = pagination.totalResults ?? allItems.length;
    const nextOffset = pageOffset + pageLimit;

    if (nextOffset >= totalResults || items.length === 0) {
      break;
    }

    currentOffset = nextOffset;
  }

  return allItems;
}
