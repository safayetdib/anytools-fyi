// Page orders are lists of page numbers from the result file, counted from 1.

export function movePage(order: number[], index: number, step: -1 | 1): number[] {
  const target = index + step;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Moves the page at an index to a position counted from 1, clamped to the list.
export function movePageTo(order: number[], index: number, position: number): number[] {
  const next = [...order];
  const [page] = next.splice(index, 1);
  const target = Math.min(Math.max(Math.round(position) - 1, 0), next.length);
  next.splice(target, 0, page);
  return next;
}

// A PDF needs at least one page, so the last page stays.
export function removePage(order: number[], index: number): number[] {
  if (order.length <= 1) return order;
  return order.filter((_, i) => i !== index);
}

export function isChanged(order: number[], pageCount: number): boolean {
  return order.length !== pageCount || order.some((page, index) => page !== index + 1);
}

// Moves the selected pages, as one block in their current order, so the first lands at a position counted from 1.
export function moveSelectedTo(order: number[], selected: Set<number>, position: number): number[] {
  const picked = order.filter((page) => selected.has(page));
  const rest = order.filter((page) => !selected.has(page));
  const target = Math.min(Math.max(Math.round(position) - 1, 0), rest.length);
  return [...rest.slice(0, target), ...picked, ...rest.slice(target)];
}
