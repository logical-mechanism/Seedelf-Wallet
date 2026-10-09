-- The home server has had this role since 2026-10-08; this is how to make it again.
--
-- The role seedelf-data-api reads db-sync with: SELECT only, read-only
-- transactions, a 60 s cap on any statement, 10 connections (the API holds 9).
-- Run as a superuser, connected to db-sync's database:
--   psql -d <db-sync database> -f seedelf_reader.sql
-- then set its password by prompt, so it never sits in a file or the history:
--   \password seedelf_reader

create role seedelf_reader login connection limit 10;
alter role seedelf_reader set default_transaction_read_only = on;
alter role seedelf_reader set statement_timeout = '60s';

do $$ begin
  execute format('grant connect on database %I to seedelf_reader', current_database());
end $$;
grant usage on schema public to seedelf_reader;
grant select on all tables in schema public to seedelf_reader;

-- Before Postgres 15, anyone may create objects in schema public: a
-- function that shadows one db-sync calls, or a table that fills the disk.
-- Only db-sync's own role (the schema's owner) should.
revoke create on schema public from public;

-- db-sync makes new tables when it migrates: let the role read those too.
-- Default privileges follow the role that creates the tables: db-sync's writer.
alter default privileges for role <the role db-sync writes with> in schema public
  grant select on tables to seedelf_reader;
