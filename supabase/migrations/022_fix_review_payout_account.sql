-- ============================================================
-- Fix review_payout_account: same bug class as 018's fix for
-- review_verification_request — the CASE expression's branches
-- were untyped text literals, which Postgres won't implicitly
-- cast to the payout_account_status enum column (a CASE
-- expression needs each branch cast explicitly, unlike a bare
-- literal assignment). Caught live while verifying 020/021:
-- calling review_payout_account raised 42804 "column status is
-- of type payout_account_status but expression is of type text".
-- ============================================================

create or replace function public.review_payout_account(
  p_account_id uuid,
  p_approve    boolean,
  p_notes      text default null
)
returns public.payout_accounts
language plpgsql security definer set search_path = public
as $$
declare
  v_account public.payout_accounts;
begin
  update public.payout_accounts
  set status         = case when p_approve then 'verified'::payout_account_status else 'rejected'::payout_account_status end,
      reviewer_notes = p_notes,
      reviewed_at    = now()
  where id = p_account_id
  returning * into v_account;

  if not found then
    raise exception 'Payout account not found.';
  end if;

  return v_account;
end;
$$;
