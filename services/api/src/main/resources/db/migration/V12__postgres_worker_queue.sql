ALTER TABLE jobs ADD COLUMN worker_result jsonb;
ALTER TABLE jobs ADD COLUMN worker_announced boolean NOT NULL DEFAULT false;
CREATE INDEX jobs_worker_delivery ON jobs (created_at, id) WHERE transport = 'postgres' AND status = 'running'
    AND (worker_result IS NOT NULL OR NOT worker_announced);
CREATE INDEX jobs_running_lease ON jobs (heartbeat_at) WHERE status = 'running' AND worker_result IS NULL;

CREATE FUNCTION queue_claim(worker uuid, requested_pool text, job_types text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, pg_temp AS $$
DECLARE claimed public.jobs%ROWTYPE;
BEGIN
    UPDATE public.jobs SET status = 'running', attempts = attempts + 1, worker_id = worker,
        heartbeat_at = now(), started_at = now(), error = NULL, progress = NULL, worker_announced = false
    WHERE id = (SELECT id FROM public.jobs WHERE status = 'queued' AND transport = 'postgres'
                AND pool = requested_pool AND type = ANY(job_types) AND available_at <= now() AND NOT cancel_requested
                ORDER BY priority, available_at, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING * INTO claimed;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM pg_notify('job_finished', claimed.id::text);
    RETURN jsonb_build_object('jobId', claimed.id, 'type', claimed.type, 'orgId', claimed.org_id,
        'input', claimed.input, 'outputPrefix', rtrim(claimed.output_prefix, '/') || '/attempt-' || claimed.attempts || '/',
        'attempt', claimed.attempts, 'contract', claimed.contract_version);
END
$$;

CREATE FUNCTION queue_renew(worker uuid, job uuid, attempt integer, report jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, pg_temp AS $$
DECLARE cancelled boolean;
BEGIN
    UPDATE public.jobs SET heartbeat_at = now(), progress = coalesce(report, progress)
    WHERE id = job AND transport = 'postgres' AND status = 'running' AND worker_id = worker AND attempts = attempt
      AND worker_result IS NULL
    RETURNING cancel_requested INTO cancelled;
    IF NOT FOUND THEN RETURN 'lost'; END IF;
    IF cancelled THEN RETURN 'cancel'; END IF;
    RETURN 'active';
END
$$;

CREATE FUNCTION queue_finish(worker uuid, job uuid, attempt integer, result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, pg_temp AS $$
BEGIN
    IF result->>'jobId' IS DISTINCT FROM job::text OR coalesce(result->>'status', '') NOT IN ('succeeded','failed','cancelled')
    THEN RETURN false; END IF;
    UPDATE public.jobs SET worker_result = result, heartbeat_at = now()
    WHERE id = job AND transport = 'postgres' AND status = 'running' AND worker_id = worker AND attempts = attempt
      AND worker_result IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    PERFORM pg_notify('job_finished', job::text);
    RETURN true;
END
$$;

REVOKE ALL ON FUNCTION queue_claim(uuid,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION queue_renew(uuid,uuid,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION queue_finish(uuid,uuid,integer,jsonb) FROM PUBLIC;
