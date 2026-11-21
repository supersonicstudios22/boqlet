GRANT EXECUTE ON FUNCTION public.queue_claim(uuid, text, text[]),
  public.queue_renew(uuid, uuid, integer, jsonb),
  public.queue_finish(uuid, uuid, integer, jsonb)
TO boqlet_queue;
