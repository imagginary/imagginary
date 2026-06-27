/**
 * write-config.js — run by CI before npm run dist.
 *
 * Reads DODO_API_KEY, DODO_PRO_CHECKOUT_URL, DODO_STUDIO_CHECKOUT_URL
 * from environment (GitHub Actions secrets) and writes resources/config.json,
 * which electron.mjs reads at app startup.
 *
 * The file is gitignored so the real key is never committed.
 * Local dev falls back to process.env directly (e.g. via a local .env loader).
 */

const fs   = require('fs');
const path = require('path');

const cfg = {
  LICENSE_HMAC_SECRET:          process.env.LICENSE_HMAC_SECRET          || '',
  DEEPSEEK_API_KEY:             process.env.DEEPSEEK_API_KEY             || '',
  DODO_API_KEY:                 process.env.DODO_API_KEY                 || '',
  DODO_API_BASE:                process.env.DODO_API_BASE                || 'https://live.dodopayments.com',
  DODO_PRO_CHECKOUT_URL:        process.env.DODO_PRO_CHECKOUT_URL        || 'https://checkout.dodopayments.com/buy/pdt_0NfSlPakjsXHejKSZgxND',
  DODO_STUDIO_CHECKOUT_URL:     process.env.DODO_STUDIO_CHECKOUT_URL     || 'https://checkout.dodopayments.com/buy/pdt_0NfSlpx2ktThlKQivLq6X',
  DODO_PRO_ANNUAL_CHECKOUT_URL:     process.env.DODO_PRO_ANNUAL_CHECKOUT_URL     || '',
  DODO_STUDIO_ANNUAL_CHECKOUT_URL:  process.env.DODO_STUDIO_ANNUAL_CHECKOUT_URL  || '',
  DODO_STARTER_CREDITS_URL:     process.env.DODO_STARTER_CREDITS_URL     || '',
  DODO_STANDARD_CREDITS_URL:    process.env.DODO_STANDARD_CREDITS_URL    || '',
  DODO_POWER_CREDITS_URL:       process.env.DODO_POWER_CREDITS_URL       || '',
  DODO_CUSTOMER_PORTAL_URL:    process.env.DODO_CUSTOMER_PORTAL_URL    || 'https://customer.dodopayments.com',
};

const outPath = path.join(__dirname, '..', 'resources', 'config.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2), 'utf8');

console.log(`[write-config] wrote ${outPath}`);
if (!cfg.DODO_API_KEY) {
  console.warn('[write-config] WARNING: DODO_API_KEY is empty — license validation will be disabled in this build');
}
console.log(`[write-config] DODO_API_KEY present: ${!!cfg.DODO_API_KEY}`);
if (!cfg.LICENSE_HMAC_SECRET) {
  console.warn('[write-config] WARNING: LICENSE_HMAC_SECRET is empty — license HMAC will use insecure dev fallback');
}
