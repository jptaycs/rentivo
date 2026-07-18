-- ============================================================
-- Rentivo — Identity verification submissions
-- Uploads land in the existing private `verification-docs` bucket
-- (owner-folder-scoped since 004). Approval is manual, service-role
-- only — there's no automated ID-checking here, just a queue.
-- ============================================================

create type verification_status as enum ('pending', 'approved', 'rejected');

create table public.verification_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  id_doc_path    text not null,
  selfie_path    text not null,
  status         verification_status not null default 'pending',
  reviewer_notes text,
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz
);

create index verification_requests_user_idx on public.verification_requests(user_id, created_at desc);

alter table public.verification_requests enable row level security;

create policy "verification_requests: own read"
  on public.verification_requests for select
  using (auth.uid() = user_id);

create policy "verification_requests: own insert"
  on public.verification_requests for insert
  with check (auth.uid() = user_id);

grant select, insert on public.verification_requests to authenticated;
-- No update/delete grant — status changes only via the review RPC below.

-- ───────────────────────────────────────────────────────────
-- Manual review — run from the SQL editor (or a future admin
-- tool) as service_role: approving flips profiles.is_verified.
-- ───────────────────────────────────────────────────────────

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
  set status         = case when p_approve then 'approved' else 'rejected' end,
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

revoke execute on function public.review_verification_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_verification_request(uuid, boolean, text) to service_role;
