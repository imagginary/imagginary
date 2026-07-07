import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const FAL_API_KEY = Deno.env.get('FAL_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CREDIT_COSTS: Record<string, number> = {
  panel: 2,
  inpaint: 6,
  ipadapter: 2,
  seedance: 35,
  seedance2: 160,
  video_transfer: 55,
  lora: 275,
  pose: 6,
};

const FAL_ENDPOINTS: Record<string, string> = {
  panel:         'https://fal.run/fal-ai/flux/schnell',
  inpaint:       'https://fal.run/fal-ai/flux/dev/image-to-image/inpainting',
  ipadapter:     'https://fal.run/fal-ai/ipadapter-faceid',
  seedance:      'https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
  seedance2:     'https://queue.fal.run/bytedance/seedance-2.0/fast/image-to-video',
  video_transfer:'https://queue.fal.run/fal-ai/wan-motion',
  pose:          'https://fal.run/fal-ai/controlnet-union-sdxl',
};

const SYNCHRONOUS_FEATURES = ['panel', 'inpaint', 'ipadapter', 'pose'];

async function falStorageUpload(base64Data: string, contentType: string, fileName: string): Promise<string> {
  const imageBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const uploadRes = await fetch('https://storage.fal.ai/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type': contentType,
      'X-Fal-File-Name': fileName,
    },
    body: imageBuffer,
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '<empty>');
    throw new Error(`Fal storage upload failed: ${uploadRes.status} — ${errText}`);
  }
  const uploadData = await uploadRes.json();
  return uploadData.file_url || uploadData.url;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { license_key, feature, payload } = await req.json();

    if (!license_key || !feature || !payload) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Check credits
    const { data: credits } = await supabase
      .from('credits')
      .select('subscription_credits, topup_credits, lora_runs_used, lora_runs_limit')
      .eq('license_key', license_key)
      .single();

    const cost = CREDIT_COSTS[feature] || 0;

    if (!credits) {
      // Not in Supabase yet — provision with defaults (migration period grace)
      await supabase.from('credits').upsert({
        license_key,
        tier: 'pro',
        subscription_credits: 800,
        lora_runs_limit: 0,
        lora_runs_used: 0,
        last_credited_at: Date.now(),
        billing_cycle_start: Date.now(),
      }, { onConflict: 'license_key' });
    } else {
      const total = credits.subscription_credits + credits.topup_credits;
      if (total < cost) {
        return new Response(JSON.stringify({
          error: 'Insufficient credits',
          available: total,
          required: cost,
        }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (feature === 'lora' && credits.lora_runs_used >= credits.lora_runs_limit) {
        return new Response(JSON.stringify({
          error: 'Monthly LoRA training limit reached',
        }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Build Fal payload — upload images from base64 to Fal storage where needed
    let falPayload = { ...payload };

    // Upload main imageData for features that need it (video/pose)
    if (payload.imageData) {
      const base64 = payload.imageData.replace(/^data:image\/[^;]+;base64,/, '');
      falPayload.image_url = await falStorageUpload(base64, 'image/png', 'panel.png');
      delete falPayload.imageData;
    }

    // Upload pose skeleton image for ControlNet
    if (payload.poseImageData) {
      const base64 = payload.poseImageData.replace(/^data:image\/[^;]+;base64,/, '');
      falPayload.control_image_url = await falStorageUpload(base64, 'image/png', 'pose.png');
      falPayload.control_type = 'openpose';
      delete falPayload.poseImageData;
    }

    // Submit to Fal.ai
    const falEndpoint = FAL_ENDPOINTS[feature];
    if (!falEndpoint) {
      return new Response(JSON.stringify({ error: `Unknown feature: ${feature}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const falRes = await fetch(falEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(falPayload),
    });

    if (!falRes.ok) {
      const errText = await falRes.text().catch(() => '<empty>');
      return new Response(JSON.stringify({ error: `Fal.ai failed: ${falRes.status} — ${errText}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const falData = await falRes.json();
    const isSynchronous = SYNCHRONOUS_FEATURES.includes(feature);

    if (isSynchronous) {
      // Deduct immediately for synchronous features
      const { data: current } = await supabase
        .from('credits')
        .select('subscription_credits, topup_credits')
        .eq('license_key', license_key)
        .single();

      if (current) {
        const subDeduct = Math.min(cost, current.subscription_credits);
        const topupDeduct = cost - subDeduct;
        await supabase.rpc('deduct_credits', {
          p_license_key: license_key,
          p_subscription_amount: subDeduct,
          p_topup_amount: topupDeduct,
        });
      }

      await supabase.from('generation_log').insert({
        license_key, feature, credits_used: cost, fal_model: falEndpoint,
      });

      const resultUrl = falData.images?.[0]?.url || falData.image?.url || falData.url;
      return new Response(JSON.stringify({
        success: true,
        result_url: resultUrl,
        synchronous: true,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Async — return job details for client-side polling
    return new Response(JSON.stringify({
      success: true,
      request_id: falData.request_id,
      status_url: falData.status_url,
      response_url: falData.response_url,
      synchronous: false,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[submit-generation] Error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
