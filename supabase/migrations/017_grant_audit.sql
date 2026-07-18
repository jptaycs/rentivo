-- Diagnostic: the previous migration found `authenticated` silently has
-- UPDATE on a table that only ever had `grant select, insert` written for
-- it — meaning something broader than this repo's migrations is granting
-- privileges. Audit every public table for both authenticated and anon
-- across insert/update/delete so we know the true blast radius before
-- deciding what needs an explicit revoke.
do $$
declare
  r record;
  roles text[] := array['anon', 'authenticated'];
  role_name text;
  privs text[] := array['INSERT', 'UPDATE', 'DELETE'];
  priv text;
begin
  for r in
    select tablename from pg_tables where schemaname = 'public' order by tablename
  loop
    foreach role_name in array roles loop
      foreach priv in array privs loop
        if has_table_privilege(role_name, 'public.' || r.tablename, priv) then
          raise notice '% HAS % on %', role_name, priv, r.tablename;
        end if;
      end loop;
    end loop;
  end loop;
end $$;
