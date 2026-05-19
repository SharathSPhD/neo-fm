-- 0046_developer_tier_functions.sql
--
-- Depends on 0045_developer_tier_enum.sql (enum value must be committed first).
--
-- Updates the two tier-quota functions to handle the new `developer` enum value,
-- then promotes the operator account to developer tier.
--
-- developer quota:  999 999 songs/month (effectively unlimited)
-- developer storage: 1 TB (effectively unlimited)

CREATE OR REPLACE FUNCTION public.user_tier_quota(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE COALESCE(u.tier, 'free'::public.tier_enum)
    WHEN 'free'      THEN 3
    WHEN 'creator'   THEN 100
    WHEN 'pro'       THEN 1000
    WHEN 'developer' THEN 999999
  END
  FROM public.users u WHERE u.id = p_user_id;
$$;

COMMENT ON FUNCTION public.user_tier_quota(uuid) IS
  'ADR 0009 / 0045: songs-per-month cap by tier. developer=999999 (effectively unlimited).';

CREATE OR REPLACE FUNCTION public.user_tier_storage_bytes_cap(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE COALESCE(u.tier, 'free'::public.tier_enum)
    WHEN 'free'      THEN 524288000::bigint       -- 500 MB
    WHEN 'creator'   THEN 5368709120::bigint       -- 5 GB
    WHEN 'pro'       THEN 53687091200::bigint      -- 50 GB
    WHEN 'developer' THEN 1099511627776::bigint    -- 1 TB
  END
  FROM public.users u WHERE u.id = p_user_id;
$$;

COMMENT ON FUNCTION public.user_tier_storage_bytes_cap(uuid) IS
  'ADR 0005 / ADR 0045: per-tier storage byte cap. developer=1 TB.';

-- Promote the operator/developer account.
-- This UPDATE is idempotent (re-running sets developer→developer).
UPDATE public.users
SET tier = 'developer'
WHERE email = 'sharath.ai.colab@gmail.com';
