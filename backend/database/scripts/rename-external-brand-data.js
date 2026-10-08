#!/usr/bin/env node
/** Inventory and optionally rename brand text in an existing PostgreSQL database.
 * Usage: node database/scripts/rename-external-brand-data.js --from OLD --to NEW
 * Apply: add --apply --confirm; remote targets also need --allow-remote.
 * Counts are printed without exposing row values. All updates share one transaction.
 */
const { Client } = require("pg");
const { assertLocalTarget, sslForUrl } = require("./pg-utils");

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : ""; };
const from = value("--from");
const to = value("--to");
const apply = args.includes("--apply");
const confirm = args.includes("--confirm");
const allowRemote = args.includes("--allow-remote");
if (!from || !to || from === to || !/^[A-Za-z][A-Za-z0-9 -]{1,60}$/.test(from) || !/^[A-Za-z][A-Za-z0-9 -]{1,60}$/.test(to)) {
  throw new Error("Provide distinct brand names with --from and --to (letters, numbers, spaces or dashes).");
}
if (apply && !confirm) throw new Error("Apply requires --confirm after reviewing the dry run.");
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Set MIGRATE_DATABASE_URL or DATABASE_URL.");
if (!allowRemote) assertLocalTarget(url, "MIGRATE_DATABASE_URL");

const quote = (name) => `"${name.replace(/"/g, '""')}"`;
const variants = [...new Map([
  [from, to],
  [from.toUpperCase(), to.toUpperCase()],
  [from[0].toUpperCase() + from.slice(1).toLowerCase(), to[0].toUpperCase() + to.slice(1).toLowerCase()],
  [from.toLowerCase(), to.toLowerCase()],
]).entries()];
const client = new Client({ connectionString: url, ssl: sslForUrl(url) });

async function main() {
  await client.connect();
  const { rows: columns } = await client.query(`SELECT c.table_schema, c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND t.table_type = 'BASE TABLE' AND c.data_type IN ('text', 'character varying', 'character')
      AND c.is_generated = 'NEVER'
      AND c.table_name <> 'schema_migrations'
    ORDER BY c.table_schema, c.table_name, c.ordinal_position`);
  const matches = [];
  for (const c of columns) {
    const table = `${quote(c.table_schema)}.${quote(c.table_name)}`;
    const column = quote(c.column_name);
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} ILIKE '%' || $1 || '%'`, [from]);
    if (rows[0].n) matches.push({ ...c, count: rows[0].n });
  }
  console.log(`Columns with matches: ${matches.length}`);
  for (const m of matches) console.log(`${m.table_schema}.${m.table_name}.${m.column_name}: ${m.count}`);
  if (!apply) return;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    for (const m of matches) {
      const table = `${quote(m.table_schema)}.${quote(m.table_name)}`;
      const column = quote(m.column_name);
      const replacements = variants.reduce((expression, _, index) =>
        `replace(${expression}, $${index * 2 + 1}, $${index * 2 + 2})`, column);
      const sql = `UPDATE ${table} SET ${column} = ${replacements}
        WHERE ${column} ILIKE '%' || $${variants.length * 2 + 1} || '%'`;
      const result = await client.query(sql, [...variants.flat(), from]);
      console.log(`Updated ${table}.${column}: ${result.rowCount}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => client.end());
