import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;

const CREDIT_COSTS: Record<string, number> = {
  panel: 2,
  inpaint: 6,
  ipadapter: 2,
  seedance: 35,
  seedance2: 160,
  video_transfer: 55,
  lora: 275,
  pose: 6,
  lipsync: 16,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { license_key, feature } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const cost = CREDIT_COSTS[feature] || 0;

    const { data: current } = await supabase
      .from('credits')
      .select('subscription_credits, topup_credits')
      .eq('license_key', license_key)
      .single();

    if (!current) {
      return new Response(JSON.stringify({ error: 'License not found' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const subDeduct = Math.min(cost, current.subscription_credits);
    const topupDeduct = cost - subDeduct;

    const { data: success } = await supabase.rpc('deduct_credits', {
      p_license_key: license_key,
      p_subscription_amount: subDeduct,
      p_topup_amount: topupDeduct,
    });

    if (!success) {
      return new Response(JSON.stringify({ error: 'Insufficient credits' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await supabase.from('generation_log').insert({
      license_key, feature, credits_used: cost,
    });

    // Increment lora_runs_used for lora feature
    if (feature === 'lora') {
      await supabase.from('credits')
        .update({ lora_runs_used: supabase.raw('lora_runs_used + 1'), updated_at: new Date().toISOString() })
        .eq('license_key', license_key);
    }

    const { data: updated } = await supabase
      .from('credits')
      .select('subscription_credits, topup_credits')
      .eq('license_key', license_key)
      .single();

    return new Response(JSON.stringify({
      success: true,
      new_balance: {
        subscription_credits: updated?.subscription_credits || 0,
        topup_credits: updated?.topup_credits || 0,
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[deduct-credits] Error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
