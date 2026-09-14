-- 083: drop the legacy payout functions (spec 2026-09-14 §7.6; plan 2026-09-14).
--
-- 082 redefined these three to raise "Payouts now use statements — reload the
-- page." so an old tab could not create an un-snapshotted draft or issue a paid
-- request with no statement number in the window between applying 082 and
-- deploying the app. The new app is live; the stubs have no remaining purpose.
--
-- Guard: only drop what 082 stubbed. If a body other than the stub is found,
-- something re-created a real implementation and dropping it would destroy it.
do $$
declare v_src text;
begin
  for v_src in
    select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('request_payout', 'mark_payout_paid', 'mark_payout_failed')
  loop
    if position('Payouts now use statements' in v_src) = 0 then
      raise exception '083 aborted: a legacy payout function is not the 082 stub. Read its body before dropping it.';
    end if;
  end loop;
end $$;

drop function if exists public.request_payout();
drop function if exists public.mark_payout_paid(uuid, text);
drop function if exists public.mark_payout_failed(uuid, text);
