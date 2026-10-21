// Vertical presets stored in the database. Seeded from lib/verticals.js the first time they're read.
import { query } from './db.js';
import { DEFAULT_VERTICALS } from './verticals.js';

const toVertical = (r) => ({ id: r.id, name: r.name, painIntro: r.pain_intro, painRows: r.pain_rows, useCases: r.use_cases, updatedBy: r.updated_by, updatedAt: r.updated_at });

export async function listVerticals() {
  let { rows } = await query('SELECT * FROM verticals ORDER BY sort, lower(name)');
  if (!rows.length) {
    let i = 0;
    for (const v of DEFAULT_VERTICALS) {
      await query(
        `INSERT INTO verticals (id, name, pain_intro, pain_rows, use_cases, sort) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [v.id, v.name, v.painIntro, JSON.stringify(v.painRows), JSON.stringify(v.useCases), i++],
      );
    }
    ({ rows } = await query('SELECT * FROM verticals ORDER BY sort, lower(name)'));
  }
  return rows.map(toVertical);
}

export async function getVertical(id) {
  if (typeof id !== 'string') return null;
  await listVerticals(); // seeds on first use
  const { rows } = await query('SELECT * FROM verticals WHERE id = $1', [id]);
  return rows[0] ? toVertical(rows[0]) : null;
}
