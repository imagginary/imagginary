import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { license_key } = await req.json();
    if (!license_key) {
      return new Response(JSON.stringify({ error: 'Missing license_key' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: credits } = await supabase
      .from('credits')
      .select('subscription_credits, topup_credits, lora_runs_used, lora_runs_limit, tier')
      .eq('license_key', license_key)
      .single();

    if (!credits) {
      // Grace period for existing users not yet in Supabase
      return new Response(JSON.stringify({
        subscription_credits: 800,
        topup_credits: 0,
        lora_runs_used: 0,
        lora_runs_limit: 0,
        tier: 'pro',
        source: 'default',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ...credits, source: 'supabase' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[get-balance] Error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
