-- Temporary diagnostic: report current UPDATE privilege for authenticated
-- on verification_requests, then lock it down explicitly either way.
do $$
begin
  raise notice 'authenticated has UPDATE on verification_requests: %',
    has_table_privilege('authenticated', 'public.verification_requests', 'UPDATE');
end $$;

revoke update, delete on public.verification_requests from authenticated, anon;
