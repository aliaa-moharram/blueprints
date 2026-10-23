// A blueprint's owner: a Lean email (and name), given by the person using the admin page.
import { classify } from './viewer.js';
export function cleanOwner(email, name) {
  if (email === undefined || email === null || email === '') return { email: null, name: null };
  const who = classify(String(email), []);
  if (!who.email) return { error: 'Enter a full email address for the owner.' };
  if (who.kind !== 'lean') return { error: 'The owner must have a Lean email address.' };
  const n = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : who.name;
  return { email: who.email, name: n };
}
