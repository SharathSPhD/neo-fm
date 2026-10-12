-- 0062: toggle_favorite raised 42702 (ambiguous "is_favorite": OUT column vs jobs column). Qualify the column explicitly.
create or replace function public.toggle_favorite(p_job_id uuid)
returns table(id uuid, is_favorite boolean)
language plpgsql
security definer
set search_path to ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_new boolean;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select j.user_id into v_owner from public.jobs j where j.id = p_job_id;
  if v_owner is null then
    raise exception 'job_not_found' using errcode = '42501';
  end if;
  if v_owner <> v_user then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.jobs as jj
     set is_favorite = not jj.is_favorite
   where jj.id = p_job_id
     and jj.user_id = v_user
   returning jj.is_favorite into v_new;

  if v_new is null then
    raise exception 'job_not_found' using errcode = '42501';
  end if;

  return query select p_job_id, v_new;
end;
$$;
