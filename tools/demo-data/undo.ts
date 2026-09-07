/**
 * Removes everything the demo dataset wrote — every row whose id starts with
 * `demo_` — and nothing else, so a dev database can be re-seeded from scratch.
 * The app has its own removal (`POST /api/demo/clear`); this is the same delete
 * without a running backend.
 */
import { Pool } from 'pg';
// The table list and the prefix are the product's, imported rather than
// retyped: a copy here would quietly stop deleting whatever the dataset starts
// writing next.
import {
  DEMO_ID_PREFIX,
  DEMO_TABLES,
} from '../../apps/backend/src/app/demo/demo-dataset';

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgrespassword@localhost:5432/diy_inspector?schema=public';
const pool = new Pool({ connectionString });

(async () => {
  for (const table of DEMO_TABLES) {
    const r = await pool.query(
      `delete from "${table}" where id like '${DEMO_ID_PREFIX.replace('_', '\\_')}%'`,
    );
    if (r.rowCount) console.log(`${table}: ${r.rowCount}`);
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
