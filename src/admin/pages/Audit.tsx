import { api, waktu } from '../api';
import { Card, Chip, Empty, ErrorBox, Loading, Table, Td, Th, useAsync } from '../ui';

export default function Audit() {
  const { data, loading, error } = useAsync(() => api.audit(), []);

  return (
    <Card
      title="Jejak akses internal"
      subtitle="Siapa dari pihak kami membuka data merchant mana, kapan, dan dengan alasan apa. Termasuk percobaan yang ditolak."
    >
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}

      {data && (data.rows.length === 0 ? (
        <Empty label="Belum ada akses tercatat" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Waktu</Th>
              <Th>Staf internal</Th>
              <Th>Role</Th>
              <Th>Aksi</Th>
              <Th>Merchant</Th>
              <Th>Alasan</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => {
              const denied = String(r.action).startsWith('DENIED_') || String(r.action).startsWith('BLOCKED_');
              return (
                <tr key={r.id}>
                  <Td className="text-xs">{waktu(r.accessed_at)}</Td>
                  <Td className="text-slate-900 dark:text-slate-100">
                    {r.internal_name}
                    <span className="ml-1.5 text-xs text-slate-400">{r.internal_email}</span>
                  </Td>
                  <Td className="text-xs">{r.internal_role.replace('ROLE_', '')}</Td>
                  <Td>
                    <Chip
                      tone={
                        denied
                          ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800'
                          : ''
                      }
                    >
                      {r.action}
                    </Chip>
                  </Td>
                  <Td className="text-xs">{r.merchant_name ?? <span className="text-slate-400">agregat</span>}</Td>
                  <Td className="max-w-xs truncate text-xs text-slate-500">{r.justification ?? '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ))}
    </Card>
  );
}
