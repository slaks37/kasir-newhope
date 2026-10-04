/** Standalone maintenance artifacts have an outer BEGIN/COMMIT. The runner
 * must own that transaction so schema changes and migration history commit
 * together. This intentionally supports only our reviewed, line-based SQL
 * artifact format, not arbitrary user SQL or procedural transaction control. */
export function migrationBody(sql: string): string {
  const boundaries = [...sql.matchAll(/^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\s*;[ \t]*$/gmi)];
  if (!boundaries.length) return sql;
  const commentsOnly = (value: string) => !value.replace(/--[^\n]*(?:\n|$)/g, '').trim();
  const [first, last] = boundaries;
  if (boundaries.length !== 2 || first[1].toUpperCase() !== 'BEGIN' || last[1].toUpperCase() !== 'COMMIT' ||
      !commentsOnly(sql.slice(0, first.index)) || !commentsOnly(sql.slice(last.index! + last[0].length))) {
    throw new Error('MIGRATION_TRANSACTION_FORMAT_UNSUPPORTED');
  }
  return sql.slice(first.index! + first[0].length, last.index);
}

export async function applyAtomicMigration(
  client: {query: (sql: string, params?: string[]) => Promise<unknown>}, filename: string, sql: string,
): Promise<void> {
  const body = migrationBody(sql); // Validate before opening any transaction.
  await client.query('BEGIN');
  try {
    await client.query(body);
    await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
