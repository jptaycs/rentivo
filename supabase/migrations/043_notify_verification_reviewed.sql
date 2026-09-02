-- 043_notify_verification_reviewed.sql
-- Write an in-app notification when an admin approves or declines an identity
-- verification request. Uses the enum values added in 042.
--
-- Body is a full copy of 037's version (the authoritative one) with only the
-- notification inserts added — this project's convention for redefining a
-- security-definer RPC, rather than patching it in place.
--
-- The insert sits inside the RPC, not in a trigger on verification_requests,
-- because the approval branch needs the *result* of the listing auto-publish
-- (how many listings actually went live) to write an honest message. It also
-- keeps notifications written only by security-definer code, never a client —
-- the model 012 established, which is why the RLS policies only scope reads and
-- is_read updates.

create or replace function public.review_verification_request(
  p_request_id uuid,
  p_approve    boolean,
  p_notes      text default null
)
returns public.verification_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_request   public.verification_requests;
  v_published integer := 0;
begin
  update public.verification_requests
  set status         = case when p_approve then 'approved'::verification_status else 'rejected'::verification_status end,
      reviewer_notes = p_notes,
      reviewed_at    = now()
  where id = p_request_id
  returning * into v_request;

  if not found then
    raise exception 'Verification request not found.';
  end if;

  if p_approve then
    update public.profiles set is_verified = true where id = v_request.user_id;

    update public.listings
    set is_draft = false
    where host_id = v_request.user_id and is_draft = true;

    get diagnostics v_published = row_count;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_request.user_id,
      'verification_approved',
      'Identity verified',
      case
        when v_published > 0 then
          'Your ID was approved. ' || v_published ||
          case when v_published = 1 then ' listing is' else ' listings are' end ||
          ' now live on Rentivo.'
        else
          'Your ID was approved. You can now publish listings on Rentivo.'
      end,
      case when v_published > 0 then '/dashboard/listings' else '/host/new' end
    );
  else
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_request.user_id,
      'verification_rejected',
      'Verification declined',
      case
        when p_notes is not null and btrim(p_notes) <> '' then
          'Your ID verification was declined: ' || btrim(p_notes) ||
          ' You can submit new documents from Settings.'
        else
          'Your ID verification was declined. You can submit new documents from Settings.'
      end,
      '/dashboard/settings'
    );
  end if;

  return v_request;
end;
$$;

revoke execute on function public.review_verification_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_verification_request(uuid, boolean, text) to service_role;
