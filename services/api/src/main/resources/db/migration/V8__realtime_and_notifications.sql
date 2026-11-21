CREATE TABLE realtime_events (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id uuid,
    project_id uuid,
    user_id uuid,
    session_id uuid,
    event_type text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (org_id IS NOT NULL OR project_id IS NOT NULL OR user_id IS NOT NULL OR session_id IS NOT NULL)
);
CREATE INDEX realtime_events_retention ON realtime_events(created_at);

CREATE FUNCTION boq_event(org uuid, project uuid, recipient uuid, session uuid, name text, body jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    -- Commit ordering matters because clients resume using a maximum sequence.
    PERFORM pg_advisory_xact_lock(384214905);
    INSERT INTO public.realtime_events (org_id, project_id, user_id, session_id, event_type, data)
        VALUES (org, project, recipient, session, name, body);
    PERFORM pg_notify('boqlet_events', 'ready');
END
$$;

CREATE TABLE notifications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id uuid REFERENCES orgs(id) ON DELETE CASCADE,
    project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
    kind text NOT NULL,
    params jsonb NOT NULL,
    entity_type text,
    entity_id uuid,
    url text NOT NULL,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_by_user ON notifications(user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE FUNCTION on_job_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE message jsonb;
BEGIN
    message := jsonb_strip_nulls(jsonb_build_object('jobId', NEW.id, 'type', NEW.type,
        'subjectType', NEW.subject_type, 'subjectId', NEW.subject_id, 'projectId', NEW.project_id));
    IF NEW.status IN ('succeeded','failed','cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.boq_event(NEW.org_id, NEW.project_id, NULL, NULL, 'job.finished',
            message || jsonb_strip_nulls(jsonb_build_object('status', NEW.status, 'error', NEW.error)));
        PERFORM pg_notify('job_finished', NEW.id::text);
    ELSIF NEW.progress IS NOT NULL AND OLD.progress IS DISTINCT FROM NEW.progress THEN
        PERFORM public.boq_event(NEW.org_id, NEW.project_id, NULL, NULL, 'job.progress', message || NEW.progress);
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER jobs_publish_event AFTER UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION on_job_event();

CREATE FUNCTION on_session_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'active' AND NEW.status <> 'active' THEN
        PERFORM boq_event(NULL, NULL, NEW.user_id, NEW.id, 'session.revoked', jsonb_build_object('sessionId', NEW.id));
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER sessions_publish_event AFTER UPDATE ON sessions FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION on_session_event();

CREATE FUNCTION on_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_type text;
DECLARE verb text;
BEGIN
    IF NEW.org_id IS NULL OR NEW.entity_id IS NULL OR
        (NEW.actor_kind <> 'user' AND NEW.actor_kind <> 'system') THEN RETURN NEW;
    END IF;
    action_type := CASE
        WHEN NEW.action LIKE 'member.%' AND NEW.entity_type = 'user' THEN 'membership'
        WHEN NEW.action LIKE 'line.%' THEN 'override'
        WHEN NEW.action LIKE 'manual_line.%' THEN 'manualItem'
        ELSE NEW.entity_type END;
    verb := CASE WHEN NEW.action LIKE '%.created' OR NEW.action IN ('member.joined','member.invited','project.member_added') THEN 'created'
                 WHEN NEW.action LIKE '%.deleted' OR NEW.action = 'member.removed' THEN 'deleted'
                 ELSE 'updated' END;
    PERFORM boq_event(NEW.org_id, NEW.project_id, NULL, NULL, 'entity.changed',
        jsonb_strip_nulls(jsonb_build_object('entityType', action_type, 'entityId', NEW.entity_id,
                                          'projectId', NEW.project_id, 'change', verb)));
    IF NEW.action = 'member.removed' THEN
        PERFORM boq_event(NULL, NULL, NEW.entity_id, NULL, 'entity.changed',
            jsonb_build_object('entityType', 'membership', 'entityId', NEW.entity_id, 'change', 'deleted'));
    END IF;
    IF NEW.data ? 'lineKeys' THEN
        PERFORM boq_event(NEW.org_id, NEW.project_id, NULL, NULL, 'boq.line_edited',
            jsonb_build_object('boqId', NEW.entity_id, 'lineKeys', NEW.data->'lineKeys',
                'by', (SELECT jsonb_build_object('id', u.id, 'name', u.name) FROM users u WHERE u.id = NEW.actor_id),
                'at', NEW.created_at));
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER audit_publish_event AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION on_audit_event();

CREATE FUNCTION on_notification_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM boq_event(NEW.org_id, NEW.project_id, NEW.user_id, NULL, 'notification.created',
        jsonb_strip_nulls(jsonb_build_object('id', NEW.id, 'orgId', NEW.org_id, 'kind', NEW.kind, 'params', NEW.params,
            'url', NEW.url, 'entityType', NEW.entity_type, 'entityId', NEW.entity_id, 'createdAt', NEW.created_at)));
    RETURN NEW;
END
$$;
CREATE TRIGGER notification_publish_event AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION on_notification_event();
