-- The indexes beyond db-sync's own on the mainnet server, and the ones seedelf-data-api adds.
--
-- db-sync makes its own indexes as it syncs. Everything here is extra: a
-- resync, or a new server, has none of it until this file runs again.
--
-- List every index there is, with its size (any role that reads the
-- catalog, seedelf_reader included):
--   psql -d <db-sync database> -XAt -F ' | ' -c "select indexname, pg_size_pretty(pg_relation_size(format('%I.%I', schemaname, indexname)::regclass)), indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname"
-- Any a failed build left unusable (drop it, then run this file again):
--   psql -d <db-sync database> -XAt -c "select indexrelid::regclass from pg_index where not indisvalid"
--
-- Run as the role db-sync writes with (an index needs the table's owner),
-- connected to its database, once db-sync has finished its first sync:
--   psql -d <db-sync database> -U <the role db-sync writes with> -f db-sync-indexes.sql
-- `concurrently` builds without holding up db-sync's writes. It can't run
-- inside a transaction, so never pass -1. An index already there is skipped.


-- Found on the server on 2026-10-09, not made by db-sync: about 79 GB in all.
-- Some came from Koios's own set (koios-artifacts, files/grest/rpc/02_indexes);
-- some may be the other project's on this server. Keep them all.

-- 464 MB. Koios's. account_addresses and account_txs: a stake key's addresses.
create index concurrently if not exists idx_address_stake_address_id
  on address (stake_address_id);

-- 660 MB. Koios's.
create index concurrently if not exists idx_collateral_tx_in_tx_in_id
  on collateral_tx_in (tx_in_id);

-- 107 MB.
create index concurrently if not exists idx_delegation_addr_id_tx_id
  on delegation (addr_id, tx_id);

-- 45 GB. Koios's.
create index concurrently if not exists idx_ma_tx_out_ident
  on ma_tx_out (ident) include (tx_out_id, quantity);

-- 428 MB. Koios's.
create index concurrently if not exists idx_redeemer_script_hash
  on redeemer (script_hash);

-- 4 GB.
create index concurrently if not exists idx_redeemer_script_hash_tx_purpose_index
  on redeemer (script_hash, tx_id, purpose, index);

-- 531 MB. Koios's.
create index concurrently if not exists idx_reference_tx_in_tx_in_id
  on reference_tx_in (tx_in_id);

-- 17 GB. account_info's rewards, and a pool's live stake (each delegator's rewards).
create index concurrently if not exists idx_reward_addr_id_spendable_epoch_incl_amount
  on reward (addr_id, spendable_epoch) include (amount);

-- 3 MB. Koios's. account_info, and a pool's live stake.
create index concurrently if not exists idx_reward_rest_addr_id
  on reward_rest (addr_id);

-- 10 GB. account_txs, and the private index: every output at an address, spent or not.
create index concurrently if not exists idx_tx_out_address_id_tx_id
  on tx_out (address_id, tx_id);

-- 198 MB. credential_utxos and address_utxos: an address's unspent outputs.
create index concurrently if not exists idx_tx_out_address_id_unspent
  on tx_out (address_id) where consumed_by_tx_id is null;

-- 169 MB. account_info's balance, and a pool's live stake.
create index concurrently if not exists idx_tx_out_stake_address_id_unspent
  on tx_out (stake_address_id) where consumed_by_tx_id is null;

-- 382 MB. account_info, and a pool's live stake: what an account has withdrawn.
create index concurrently if not exists idx_withdrawal_addr_id_incl_amount
  on withdrawal (addr_id) include (amount);


-- Added for a wallet's first load (2026-10-09). Koios has all three, by
-- these names. Each table is small (under 30 MB), so each takes seconds.

-- account_info read the whole table for an account's DRep: 16 of its 16.3 ms.
-- drep_info reads its delegators the same way.
create index concurrently if not exists delegation_vote_addr_id_idx
  on delegation_vote (addr_id, tx_id);

-- tx_info's certificates read the whole table: 15 ms for a page of Activity.
create index concurrently if not exists idx_delegation_vote_tx_id
  on delegation_vote (tx_id);

-- tx_info's votes read the whole table: 1.7 ms for a page of Activity.
create index concurrently if not exists idx_voting_procedure_tx_id
  on voting_procedure (tx_id desc);
