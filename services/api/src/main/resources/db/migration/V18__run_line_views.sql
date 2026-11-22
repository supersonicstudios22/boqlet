-- TF-179: each run line as the API writes it (`RunLine` without its place in the run), made once when
-- the run is indexed, so a lines page sends stored text instead of parsing and writing every line on
-- every read. NULL (rows indexed by an earlier image, or a line the contract can't hold) is read the
-- old way. The previous image keeps working: it never reads the column and leaves it NULL.
ALTER TABLE run_lines ADD COLUMN view text;
