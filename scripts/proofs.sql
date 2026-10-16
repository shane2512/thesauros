-- Read-only: every on-chain execution and the counts behind docs/PROOFS.md.
-- psql -A -F ' | ' -f scripts/proofs.sql -d "<NEON_DATABASE_URL>"
select e.created_at::timestamp(0) as at, e.kind, e.status, e.tx_hash, w.agent_wallet_address as agent_wallet
from executions e join wallets w on w.id = e.wallet_id
order by e.created_at;

select 'users' as metric, count(*)::text as value from users
union all select 'agent wallets', count(*)::text from wallets
union all select 'mandates written', count(*)::text from mandates
union all select 'policies signed', count(*)::text from policies where signature is not null
union all select 'wallets with a signed policy', count(distinct wallet_id)::text from policies where signature is not null
union all select 'recipients', count(*)::text from recipients
union all select 'agent decisions', count(*)::text from agent_decisions
union all select 'verdict ' || decision, count(*)::text from verdicts group by decision
union all select 'audit_log rows', count(*)::text from audit_log
union all select 'first user / last activity', min(u.created_at)::date || ' / ' || (select max(created_at)::date from audit_log) from users u;
