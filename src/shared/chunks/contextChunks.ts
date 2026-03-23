export type StructuredChunk<TItem> = {
  index: number;
  start: number;
  end: number;
  items: TItem[];
};

export function chunkStructuredItems<TItem>(
  items: TItem[],
  chunkSize: number
): StructuredChunk<TItem>[] {
  if (chunkSize <= 0) {
    throw new Error('chunkSize debe ser mayor a 0');
  }

  const chunks: StructuredChunk<TItem>[] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, items.length);
    chunks.push({
      index: chunks.length,
      start,
      end,
      items: items.slice(start, end)
    });
  }

  return chunks;
}

export function describeChunkWindow(totalItems: number, chunkSize: number): string {
  const chunkCount = Math.max(1, Math.ceil(totalItems / chunkSize));
  return `${chunkCount} chunk(s) lógicos de hasta ${chunkSize} elementos`;
}
