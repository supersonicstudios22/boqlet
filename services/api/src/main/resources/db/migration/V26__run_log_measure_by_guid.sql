-- Review C-10: a line's detail lists how its elements were measured, the measure-stage log entries of
-- its elements, which carry a GlobalId and no line key (run_log_by_line does not find them).
CREATE INDEX run_log_measure_by_guid ON run_log_entries (run_id, (entry->>'guid')) WHERE entry->>'stage' = 'measure';
