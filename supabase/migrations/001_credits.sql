-- Credits table
CREATE TABLE IF NOT EXISTS public.credits (
  license_key TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'pro',
  subscription_credits INTEGER NOT NULL DEFAULT 0,
  topup_credits INTEGER NOT NULL DEFAULT 0,
  lora_runs_used INTEGER NOT NULL DEFAULT 0,
  lora_runs_limit INTEGER NOT NULL DEFAULT 0,
  last_credited_at BIGINT NOT NULL DEFAULT 0,
  billing_cycle_start BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

-- Generation log for analytics
CREATE TABLE IF NOT EXISTS public.generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key TEXT NOT NULL REFERENCES public.credits(license_key),
  feature TEXT NOT NULL,
  credits_used INTEGER NOT NULL,
  fal_model TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.generation_log ENABLE ROW LEVEL SECURITY;

-- Atomic credit deduction function
CREATE OR REPLACE FUNCTION deduct_credits(
  p_license_key TEXT,
  p_subscription_amount INTEGER,
  p_topup_amount INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  current_sub INTEGER;
  current_topup INTEGER;
BEGIN
  SELECT subscription_credits, topup_credits
  INTO current_sub, current_topup
  FROM public.credits
  WHERE license_key = p_license_key
  FOR UPDATE;

  IF current_sub < p_subscription_amount OR
     (current_sub + current_topup) < (p_subscription_amount + p_topup_amount) THEN
    RETURN FALSE;
  END IF;

  UPDATE public.credits SET
    subscription_credits = subscription_credits - p_subscription_amount,
    topup_credits = topup_credits - p_topup_amount,
    updated_at = NOW()
  WHERE license_key = p_license_key;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Add topup credits function
CREATE OR REPLACE FUNCTION add_topup_credits(
  p_license_key TEXT,
  p_amount INTEGER
) RETURNS VOID AS $$
BEGIN
  UPDATE public.credits
  SET topup_credits = topup_credits + p_amount,
      updated_at = NOW()
  WHERE license_key = p_license_key;
END;
$$ LANGUAGE plpgsql;

-- Grant service_role full access (bypasses RLS for Edge Functions)
GRANT ALL ON public.credits TO service_role;
GRANT ALL ON public.generation_log TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- RLS bypass policies for service_role
ALTER TABLE public.credits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.generation_log FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_role_bypass" ON public.credits
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_bypass" ON public.generation_log
  TO service_role USING (true) WITH CHECK (true);
