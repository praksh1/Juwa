\set ON_ERROR_STOP off
\timing off
-- A player to move money around with.
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111');
insert into profiles (id, username) values ('11111111-1111-1111-1111-111111111111', 'alex');
insert into accounts (owner_id, kind, currency)
  values ('11111111-1111-1111-1111-111111111111', 'player', 'GC');

\echo '--- 1. promo grants the welcome bonus (should succeed) ---'
select post_transfer('bonus',
  (select id from accounts where kind='promo' and currency='GC'),
  (select id from accounts where owner_id='11111111-1111-1111-1111-111111111111'),
  100000, 'GC', 'welcome-alex') is not null as granted;
select balance from account_balance_cache
  where account_id = (select id from accounts where owner_id='11111111-1111-1111-1111-111111111111');

\echo '--- 2. replaying the same idempotency key must NOT double-credit ---'
select post_transfer('bonus',
  (select id from accounts where kind='promo' and currency='GC'),
  (select id from accounts where owner_id='11111111-1111-1111-1111-111111111111'),
  100000, 'GC', 'welcome-alex') is not null as replayed;
select balance as balance_after_replay from account_balance_cache
  where account_id = (select id from accounts where owner_id='11111111-1111-1111-1111-111111111111');

\echo '--- 3. betting more than the balance must be REFUSED ---'
select post_transfer('bet',
  (select id from accounts where owner_id='11111111-1111-1111-1111-111111111111'),
  (select id from accounts where kind='house' and currency='GC'),
  999999, 'GC', 'overdraw-attempt');

\echo '--- 4. an unbalanced transaction must be REFUSED ---'
begin;
  insert into transactions (id, type) values ('22222222-2222-2222-2222-222222222222', 'adjustment');
  insert into ledger_entries (transaction_id, account_id, amount, currency)
    values ('22222222-2222-2222-2222-222222222222',
            (select id from accounts where owner_id='11111111-1111-1111-1111-111111111111'),
            50000, 'GC');
commit;

\echo '--- 5. the ledger is append-only: updates and deletes do nothing ---'
update ledger_entries set amount = 999999;
delete from ledger_entries;
select count(*) as entries_still_present from ledger_entries;

\echo '--- 6. withdrawals are blocked by the social-model guard ---'
insert into payment_intents (player_id, provider, direction, amount, currency)
  values ('11111111-1111-1111-1111-111111111111', 'stripe', 'withdrawal', 5000, 'USD');

\echo '--- 7. deposits still work ---'
insert into payment_intents (player_id, provider, direction, amount, currency)
  values ('11111111-1111-1111-1111-111111111111', 'stripe', 'deposit', 999, 'USD')
  returning direction, amount;

\echo '--- 8. only one daily bonus per player per day ---'
insert into bonus_grants (player_id, kind, coins, streak_day, grant_date)
  values ('11111111-1111-1111-1111-111111111111', 'daily', 5000, 1, '2026-08-03');
insert into bonus_grants (player_id, kind, coins, streak_day, grant_date)
  values ('11111111-1111-1111-1111-111111111111', 'daily', 5000, 1, '2026-08-03');

\echo '--- 9. the cached balance matches the derived ledger (must be empty) ---'
select * from reconcile_balances();

\echo '--- 10. every transaction in the system nets to zero ---'
select currency, sum(amount) as must_be_zero from ledger_entries group by currency;
