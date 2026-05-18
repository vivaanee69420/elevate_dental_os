// Money is integer pence everywhere. Display as £ with en-GB grouping.
export function formatPence(pence: number | null | undefined): string {
  return `£${((pence || 0) / 100).toLocaleString('en-GB')}`;
}

export function formatNumber(n: number | null | undefined): string {
  return (n || 0).toLocaleString('en-GB');
}

export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString('en-GB');
}
