// Usage: node scripts/make-user.mjs "Name" "password-or-PIN" owner|taker|kitchen
// Prints an SQL statement. Run it with: npx wrangler d1 execute order-book --remote --command "<the SQL>"
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const [name, pin, role] = process.argv.slice(2);
if (!name || !pin || !['owner', 'taker', 'kitchen'].includes(role)) {
  console.error('Usage: node scripts/make-user.mjs "Name" "password" owner|taker|kitchen');
  process.exit(1);
}
if (pin.length < 6) {
  console.error('Use at least 6 characters for the password.');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(pin, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');
const esc = (s) => s.replace(/'/g, "''");
console.log(
  `INSERT INTO users (name, salt, pin_hash, role) VALUES ('${esc(name)}', '${salt}', '${hash}', '${role}');`
);
