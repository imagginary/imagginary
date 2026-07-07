import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('BACKEND_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;

const PRODUCT_IDS = {
  pro: 'pdt_0NfSlPakjsXHejKSZgxND',
  studio: 'pdt_0NfSlpx2ktThlKQivLq6X',
};

const MONTHLY_CREDITS = { pro: 800, studio: 800 };
const LORA_RUNS = { pro: 0, studio: 5 };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.text();
    const event = JSON.parse(body);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    console.log('[Dodo Webhook] Event:', event.type);

    const getLicenseKey = (data: any) =>
      data?.metadata?.license_key ||
      data?.license_key ||
      data?.items?.[0]?.metadata?.license_key ||
      null;

    const getTier = (data: any): 'pro' | 'studio' => {
      const productId = data?.product_id || data?.items?.[0]?.product_id;
      return productId === PRODUCT_IDS.studio ? 'studio' : 'pro';
    };

    if (event.type === 'subscription.active') {
      const licenseKey = getLicenseKey(event.data);
      const tier = getTier(event.data);

      if (!licenseKey) {
        console.error('[Dodo Webhook] No license key in event data');
        return new Response('Missing license key', { status: 400 });
      }

      await supabase.from('credits').upsert({
        license_key: licenseKey,
        tier,
        subscription_credits: MONTHLY_CREDITS[tier],
        lora_runs_limit: LORA_RUNS[tier],
        lora_runs_used: 0,
        last_credited_at: Date.now(),
        billing_cycle_start: Date.now(),
      }, { onConflict: 'license_key' });

      console.log(`[Dodo Webhook] Provisioned ${MONTHLY_CREDITS[tier]} credits for ${tier}`);
    }

    if (event.type === 'subscription.renewed') {
      const licenseKey = getLicenseKey(event.data);
      const tier = getTier(event.data);

      if (licenseKey) {
        await supabase.from('credits').update({
          subscription_credits: MONTHLY_CREDITS[tier],
          lora_runs_used: 0,
          last_credited_at: Date.now(),
          billing_cycle_start: Date.now(),
          updated_at: new Date().toISOString(),
        }).eq('license_key', licenseKey);

        console.log(`[Dodo Webhook] Renewed credits for ${licenseKey}`);
      }
    }

    if (event.type === 'subscription.cancelled' || event.type === 'subscription.expired') {
      const licenseKey = getLicenseKey(event.data);
      if (licenseKey) {
        await supabase.from('credits').update({
          subscription_credits: 0,
          updated_at: new Date().toISOString(),
        }).eq('license_key', licenseKey);
        console.log(`[Dodo Webhook] Zeroed credits for ${licenseKey}`);
      }
    }

    if (event.type === 'payment.succeeded') {
      const licenseKey = event.data?.metadata?.license_key;
      const credits = parseInt(event.data?.metadata?.credits || '0');
      const type = event.data?.metadata?.type;

      if (licenseKey && credits > 0 && type === 'topup') {
        await supabase.rpc('add_topup_credits', {
          p_license_key: licenseKey,
          p_amount: credits,
        });
        console.log(`[Dodo Webhook] Added ${credits} topup credits to ${licenseKey}`);
      }
    }

    return new Response('OK', { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error('[Dodo Webhook] Error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
