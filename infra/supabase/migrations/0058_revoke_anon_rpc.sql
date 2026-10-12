-- 0058_revoke_anon_rpc.sql
-- Security advisor: SECURITY DEFINER functions that require a signed-in user were executable by `anon` over /rest/v1/rpc.
-- They already check auth.uid(), so anonymous calls fail, but there is no reason to expose them. validate_handle is a
-- trigger function and must not be an RPC at all. join_waitlist / submit_feedback stay open to anon by design.
revoke execute on function public.delete_user_preset(uuid) from public, anon;
revoke execute on function public.publish_song_batch(uuid[], text) from public, anon;
revoke execute on function public.record_preference_pair(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.save_user_preset(text, jsonb) from public, anon;
revoke execute on function public.validate_handle() from public, anon, authenticated;
grant execute on function public.delete_user_preset(uuid) to authenticated;
grant execute on function public.publish_song_batch(uuid[], text) to authenticated;
grant execute on function public.record_preference_pair(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.save_user_preset(text, jsonb) to authenticated;
