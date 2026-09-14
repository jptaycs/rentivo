-- 084: payout statement follow-ups from the Phase C whole-branch review
-- (plan 2026-09-14 Task C10).
--
-- 1. reverse_payout_statement clears statement_emailed_at. One column records
--    both statement emails; before this, a reversal whose email failed still
--    showed the ISSUE email's date, so the admin page never offered "Email not
--    sent — Resend" and the host could silently never learn the payout was
--    reversed.
-- 2. issue_payout_statement's idempotent same-reference return refuses a
--    different transfer date instead of silently ignoring it.
--
-- Both bodies were captured from the live database with pg_get_functiondef and
-- changed by exactly the hunks above. CREATE OR REPLACE with the unchanged
-- signature keeps each function's oid and ACL (service_role only). The guard
-- aborts if either live body differs from what was captured.
do $$
begin
  if (select md5(pg_get_functiondef('public.issue_payout_statement(uuid, text, date, text)'::regprocedure))) <> 'b530dc5a2357d3b8768aa15d025dc1b8' then
    raise exception '084 aborted: issue_payout_statement is not the body this migration was written against.';
  end if;
  if (select md5(pg_get_functiondef('public.reverse_payout_statement(uuid, text, text)'::regprocedure))) <> '4089c48214406ffc23ba10bee5ca5de2' then
    raise exception '084 aborted: reverse_payout_statement is not the body this migration was written against.';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.issue_payout_statement(p_request_id uuid, p_reference text, p_transferred_on date, p_admin_email text)
 RETURNS payout_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.payout_requests;
  v_ref     text    := nullif(btrim(coalesce(p_reference, '')), '');
  v_email   text    := nullif(btrim(coalesce(p_admin_email, '')), '');
  v_year    integer := extract(year from (now() at time zone 'Asia/Manila'))::integer;
  v_today   date    := (now() at time zone 'Asia/Manila')::date;
  v_n       integer;
begin
  if v_email is null then
    raise exception 'An admin email is required.';
  end if;
  if v_ref is null then
    raise exception 'A transfer reference is required.';
  end if;
  if length(v_ref) > 100 then
    raise exception 'The transfer reference must be 100 characters or fewer.';
  end if;

  select * into v_request from public.payout_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payout statement not found.';
  end if;

  -- Idempotent on the SAME reference; refuses a different one, because that
  -- would silently rewrite the money trail of a transfer already recorded.
  if v_request.status = 'paid' then
    if v_request.reference = v_ref then
      -- 084: a retry with the same reference but a different date is not the
      -- same transfer; refuse it rather than silently ignore the new date.
      if p_transferred_on is not null and p_transferred_on is distinct from v_request.transferred_on then
        raise exception 'This statement was already issued with reference % on %.', v_request.reference, v_request.transferred_on;
      end if;
      return v_request;
    end if;
    raise exception 'This statement was already issued with reference %.', v_request.reference;
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a draft can be issued.';
  end if;

  if p_transferred_on is null then
    raise exception 'A transfer date is required.';
  end if;
  if p_transferred_on > v_today then
    raise exception 'The transfer date cannot be in the future.';
  end if;
  if p_transferred_on < (v_request.requested_at at time zone 'Asia/Manila')::date then
    raise exception 'The transfer date cannot be before the draft was prepared.';
  end if;

  -- Gapless: the upsert's row lock serializes concurrent issues, and a
  -- rollback undoes the increment.
  insert into public.payout_statement_counters (year, last_number)
  values (v_year, 1)
  on conflict (year) do update
    set last_number = public.payout_statement_counters.last_number + 1
  returning last_number into v_n;

  update public.payout_requests
     set status           = 'paid',
         statement_number = 'PS-' || v_year::text || '-' || lpad(v_n::text, 6, '0'),
         reference        = v_ref,
         transferred_on   = p_transferred_on,
         processed_at     = now()
   where id = p_request_id
  returning * into v_request;

  insert into public.admin_actions (admin_email, action, target_user_id, detail)
  values (v_email, 'payout_statement_issue', v_request.host_id,
    jsonb_build_object(
      'payout_request_id', v_request.id,
      'statement_number',  v_request.statement_number,
      'amount',            v_request.amount,
      'reference',         v_ref,
      'transferred_on',    p_transferred_on
    ));

  return v_request;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_payout_statement(p_request_id uuid, p_reason text, p_admin_email text)
 RETURNS payout_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.payout_requests;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_email   text := nullif(btrim(coalesce(p_admin_email, '')), '');
begin
  if v_email is null then
    raise exception 'An admin email is required.';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to reverse a statement.';
  end if;

  select * into v_request from public.payout_requests where id = p_request_id for update;
  if not found then
    raise exception 'Payout statement not found.';
  end if;

  if v_request.reversed_at is not null then
    return v_request;   -- already reversed
  end if;
  if v_request.statement_number is null then
    raise exception 'This is a draft, not an issued statement — cancel it instead.';
  end if;
  if v_request.status <> 'paid' then
    raise exception 'Only an issued statement can be reversed.';
  end if;

  update public.payout_requests
     set status          = 'failed',
         reversed_at     = now(),
         reversal_reason = v_reason,
         -- 084: this column now records the email for the row's CURRENT state.
         -- The issue email having gone out says nothing about the reversal
         -- email, so clear it; emailStatement() stamps it again only when the
         -- reversal email is actually accepted.
         statement_emailed_at = null
   where id = p_request_id
  returning * into v_request;

  insert into public.admin_actions (admin_email, action, target_user_id, detail)
  values (v_email, 'payout_statement_reverse', v_request.host_id,
    jsonb_build_object(
      'payout_request_id', v_request.id,
      'statement_number',  v_request.statement_number,
      'amount',            v_request.amount,
      'reason',            v_reason
    ));

  return v_request;
end;
$function$;
