-- ============================================================
-- 048_guard_payout_account_and_fix_rejection_copy.sql
-- Two items from the final whole-branch review of the admin
-- user-management / reports workstream.
--
-- 1. set_payout_account() is the FIFTH money path a suspended host can still
--    reach, and the second one this workstream found after 045/046/047 had
--    already closed create_booking, request_payout and confirm_host_qr_payment.
--
--    Suspension does not revoke a live access token — GoTrue's ban blocks new
--    logins, not an already-issued JWT, which lives up to an hour. Inside that
--    window a suspended host can call this RPC directly (it is granted to
--    `authenticated`) and, because 020:110 uses `on conflict (user_id) do
--    update`, it rewrites the SAME payout_accounts row that
--    payout_requests.payout_account_id already points at. A payout request that
--    was already `pending` at the moment of suspension therefore keeps its
--    request row untouched while the bank/e-wallet details underneath it change
--    — redirecting where an admin sends real money at Mark Paid time.
--
--    request_payout was guarded (046) on the reasoning that "suspension must
--    stop money leaving the platform". Redirecting where that money LANDS is
--    the same class, so it gets the same guard, worded the same way: the caller
--    is the suspended host themselves, so naming the reason discloses nothing
--    they do not already know.
--
--    Note this does NOT retroactively protect a row that was already rewritten
--    before the suspension. The admin-facing defence for that is unchanged:
--    /admin/payouts shows a suspended-host badge on a pending request (added by
--    this workstream's Task 8), and every status transition is still a manual,
--    service_role-only RPC.
--
-- 2. Migration 043's rejection notification concatenates the reviewer's note
--    straight into the following sentence with no punctuation, producing
--    "…declined: Blurry photo You can submit new documents from Settings."
--    043 is already applied to production, so correcting it needs a redefine.
-- ============================================================

-- ── 1. set_payout_account ────────────────────────────────────────
-- Body copied VERBATIM from 020 (the only definition — nothing between 021 and
-- 047 touches this function; confirmed by grep across supabase/migrations).
-- The ONLY change is the guard block marked "048:", inserted immediately after
-- the authentication check, in the same position and with the same shape as
-- 046's guard in request_payout.
create or replace function public.set_payout_account(
  p_method         payout_method,
  p_account_number text,
  p_account_name   text
)
returns public.payout_accounts
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.payout_accounts;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  -- 048: a suspended host must not be able to change where money lands, not
  -- just be blocked from asking for it. `on conflict do update` below mutates
  -- the same row a still-pending payout_request points at.
  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.suspended_at is not null
  ) then
    raise exception 'Your account is suspended. Payout details cannot be changed — contact support.';
  end if;

  if length(trim(p_account_number)) = 0 or length(trim(p_account_name)) = 0 then
    raise exception 'Account number and name are required.';
  end if;

  insert into public.payout_accounts (user_id, method, account_number, account_name, status, reviewer_notes, reviewed_at)
  values (auth.uid(), p_method, trim(p_account_number), trim(p_account_name), 'pending', null, null)
  on conflict (user_id) do update
    set method         = excluded.method,
        account_number = excluded.account_number,
        account_name   = excluded.account_name,
        status         = 'pending',
        reviewer_notes = null,
        reviewed_at    = null
  returning * into v_account;

  return v_account;
end;
$$;

revoke execute on function public.set_payout_account(payout_method, text, text) from public, anon;
grant execute on function public.set_payout_account(payout_method, text, text) to authenticated;

-- ── 2. review_verification_request — rejection copy ──────────────
-- Body copied VERBATIM from 043 (the authoritative version — 037 created the
-- listing auto-publish, 043 added the notifications, nothing after touches it).
-- The ONLY change is the punctuation between the reviewer's note and the
-- following sentence, marked "048:".
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
          -- 048: end the reviewer's note before the next sentence starts.
          -- Admin-authored free text may or may not already be punctuated, so
          -- add a full stop only when it is not — otherwise a note written as
          -- "Blurry photo." would render "Blurry photo.. You can…".
          'Your ID verification was declined: ' || btrim(p_notes) ||
          case when right(btrim(p_notes), 1) in ('.', '!', '?') then ' ' else '. ' end ||
          'You can submit new documents from Settings.'
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
