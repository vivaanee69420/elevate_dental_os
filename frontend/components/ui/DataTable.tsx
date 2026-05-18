import { ReactNode } from 'react';

export type Column<T> = {
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
};

// Mirrors the table markup previously inlined in leads/contacts/payments.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  empty?: ReactNode;
}) {
  const isEmpty = !rows || rows.length === 0;
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-bg border-b border-border">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                className={`${c.align === 'right' ? 'text-right' : 'text-left'} p-3 font-semibold`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows?.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border hover:bg-bg">
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={`${c.align === 'right' ? 'text-right' : ''} p-3`.trim()}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {isEmpty && empty}
    </div>
  );
}
