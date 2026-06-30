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
  LICENSE_HMAC_SECRET:             process.env.LICENSE_HMAC_SECRET             || '',
  DEEPSEEK_API_KEY:                process.env.DEEPSEEK_API_KEY                || '',
  FAL_API_KEY:                     process.env.FAL_API_KEY                     || '',
  SYNCSO_API_KEY:                  process.env.SYNCSO_API_KEY                  || '',
  CARTESIA_API_KEY:                process.env.CARTESIA_API_KEY                || '',
  ELEVENLABS_API_KEY:              process.env.ELEVENLABS_API_KEY              || '',
  UMAMI_WEBSITE_ID:                process.env.UMAMI_WEBSITE_ID                || '',
  DODO_API_KEY:                    process.env.DODO_API_KEY                    || '',
  DODO_API_BASE:                   process.env.DODO_API_BASE                   || 'https://live.dodopayments.com',
  DODO_PRO_CHECKOUT_URL:           process.env.DODO_PRO_CHECKOUT_URL           || 'https://checkout.dodopayments.com/buy/pdt_0NfSlPakjsXHejKSZgxND',
  DODO_STUDIO_CHECKOUT_URL:        process.env.DODO_STUDIO_CHECKOUT_URL        || 'https://checkout.dodopayments.com/buy/pdt_0NfSlpx2ktThlKQivLq6X',
  DODO_PRO_ANNUAL_CHECKOUT_URL:    process.env.DODO_PRO_ANNUAL_CHECKOUT_URL    || '',
  DODO_STUDIO_ANNUAL_CHECKOUT_URL: process.env.DODO_STUDIO_ANNUAL_CHECKOUT_URL || '',
  DODO_STARTER_CREDITS_URL:        process.env.DODO_STARTER_CREDITS_URL        || '',
  DODO_STANDARD_CREDITS_URL:       process.env.DODO_STANDARD_CREDITS_URL       || '',
  DODO_POWER_CREDITS_URL:          process.env.DODO_POWER_CREDITS_URL          || '',
  DODO_CUSTOMER_PORTAL_URL:        process.env.DODO_CUSTOMER_PORTAL_URL        || 'https://customer.dodopayments.com',
};

const outPath = path.join(__dirname, '..', 'resources', 'config.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2), 'utf8');

console.log(`[write-config] wrote ${outPath}`);
Object.entries(cfg).forEach(([key, value]) => {
  if (!value) console.warn(`[write-config] WARNING: ${key} is empty — check GitHub secrets`);
});
console.log('[write-config] keys present:', Object.entries(cfg).filter(([, v]) => !!v).map(([k]) => k).join(', '));
