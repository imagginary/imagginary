import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;

const MONTHLY_CREDITS = { pro: 800, studio: 800 };
const LORA_RUNS = { pro: 0, studio: 5 };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { license_key, tier } = await req.json();
    if (!license_key) {
      return new Response(JSON.stringify({ error: 'Missing license_key' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const safeTier = (tier === 'studio' ? 'studio' : 'pro') as 'pro' | 'studio';
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Check if already exists
    const { data: existing } = await supabase
      .from('credits')
      .select('license_key')
      .eq('license_key', license_key)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ success: true, already_exists: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Provision new user
    await supabase.from('credits').insert({
      license_key,
      tier: safeTier,
      subscription_credits: MONTHLY_CREDITS[safeTier],
      lora_runs_limit: LORA_RUNS[safeTier],
      lora_runs_used: 0,
      last_credited_at: Date.now(),
      billing_cycle_start: Date.now(),
    });

    console.log(`[provision-user] Provisioned ${safeTier} user: ${license_key}`);
    return new Response(JSON.stringify({ success: true, provisioned: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[provision-user] Error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
