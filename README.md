# Order Book

Catering order book for the family and kitchen. Runs on Cloudflare (a Worker plus a D1 database), which is free at this size.

- **Owner** logins can do everything: reports, the CSV download, removing payments and managing logins.
- **Order taker** logins enter and edit orders, enter amounts and payments, and set any status. No reports, no logins page.
- **Kitchen** logins see orders and the prep sheet, and mark orders prepared or delivered. They never see amounts.
- Every saved order shows the same WhatsApp message as before, with Send and Copy buttons.

## Deploy (about 15 minutes, once)

You need Node.js 18+ and a free Cloudflare account.

```bash
npm install
npx wrangler login

# 1. Create the database. Copy the database_id it prints into wrangler.toml
npx wrangler d1 create order-book

# 2. Create the tables
npx wrangler d1 execute order-book --remote --file=schema.sql

# 3. Create the first owner login (prints one SQL line), then run that line
node scripts/make-user.mjs "Dad" "a-long-password" owner
npx wrangler d1 execute order-book --remote --command "PASTE THE PRINTED SQL HERE"

# 4. Set the secret used to sign logins (paste any long random text when asked)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put SESSION_SECRET

# 5. Publish
npx wrangler deploy
```

Wrangler prints the address, like `https://order-book.<your-name>.workers.dev`. Open it on the phone and add it to the home screen. More logins (owner, order taker or kitchen) can be added inside the app, on the Users page.

## Updating an app you already deployed

Replace the files with the new ones, keeping your own `database_id` in `wrangler.toml`. If the app was deployed before the three roles existed (logins were called Family and Staff), run this once to convert the old logins (Family becomes Owner, Staff becomes Kitchen). Your orders and payments are kept:

```bash
npx wrangler d1 execute order-book --remote --file=migrations/001-roles.sql
```

If the app was deployed before the address field was added (Delivery and Serving types didn't have an address), run this once:

```bash
npx wrangler d1 execute order-book --remote --file=migrations/002-delivery-address.sql
```

Then publish the new version:

```bash
npx wrangler deploy
```

## Backups

```bash
npx wrangler d1 export order-book --remote --output=backup.sql
```

Run this now and then and keep the file somewhere safe. The Reports page also has a CSV download for any date range.

## Running it on your own computer to try it

```bash
echo 'SESSION_SECRET=any-long-text' > .dev.vars
npx wrangler d1 execute order-book --local --file=schema.sql
node scripts/make-user.mjs "Test" "password1" owner   # then run the SQL with --local
npx wrangler dev
```

## Notes

- Passwords are stored as salted hashes. Five wrong tries locks that name for 10 minutes.
- The app needs internet to load orders. The screens are cached so it opens fast, but it does not save orders while offline.
- Dates are kept exactly as entered, with no timezone conversion.
