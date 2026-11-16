\set ON_ERROR_STOP on
\if :{?main_run_id}
\else
 \echo 'An explicitly reviewed existing main_run_id is required; no run is inferred or created.'
 SELECT 1/0;
\endif
BEGIN;
SELECT pg_advisory_xact_lock(724310896145225::bigint);
SELECT count(*)=1 AS existing_main FROM public.ai_spend_budgets WHERE run_id=:'main_run_id' \gset
\if :existing_main
\else
 \echo 'Existing main budget required; budget creation is a separate administrator decision.'
 SELECT 1/0;
\endif
INSERT INTO public.ai_spend_authority(singleton,run_id) VALUES(true,:'main_run_id') ON CONFLICT(singleton) DO NOTHING;
SELECT count(*)=1 AS binding_matches FROM public.ai_spend_authority WHERE singleton AND run_id=:'main_run_id' \gset
\if :binding_matches
\else
 \echo 'Authority already belongs to another run; refusing to replace or reset it.'
 SELECT 1/0;
\endif
COMMIT;
-- Content-free audit: existing costs stay unchanged and continue to count.
SELECT count(*) AS prior_reservations,coalesce(sum(coalesce(charged_micros,reserved_micros)),0) AS accounted_micros
FROM public.ai_spend_ledger WHERE run_id=:'main_run_id';
