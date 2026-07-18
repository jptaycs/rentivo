-- ============================================================
-- Fix review_verification_request: the CASE expression's branches
-- were untyped text literals, which Postgres won't implicitly cast
-- to the verification_status enum column (unlike a bare literal
-- assignment, a CASE expression needs each branch cast explicitly).
-- ============================================================

create or replace function public.review_verification_request(
  p_request_id uuid,
  p_approve    boolean,
  p_notes      text default null
)
returns public.verification_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_request public.verification_requests;
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
  end if;

  return v_request;
end;
$$;
