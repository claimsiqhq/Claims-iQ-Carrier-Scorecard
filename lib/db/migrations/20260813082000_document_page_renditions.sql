-- Persisted JPEG page renditions support an in-page document viewer while
-- preserving the original tenant-scoped PDF as the source of record.

BEGIN;

ALTER TYPE public.processing_job_type
  ADD VALUE IF NOT EXISTS 'rendition';

CREATE OR REPLACE FUNCTION private.claim_document_path_is_authorized(
  object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  claims jsonb;
  path_segments text[];
  expires_at numeric;
  page_number integer;
BEGIN
  claims := auth.jwt();
  path_segments := pg_catalog.string_to_array(object_name, '/');

  IF claims IS NULL
     OR pg_catalog.jsonb_typeof(claims) <> 'object'
     OR claims ->> 'role' <> 'authenticated'
     OR NULLIF(claims ->> 'sub', '') IS NULL
     OR claims ->> 'user_id' <> claims ->> 'sub'
     OR NULLIF(claims ->> 'session_id', '') IS NULL
     OR pg_catalog.length(claims ->> 'session_id') > 512
     OR (claims ->> 'organization_id') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (claims ->> 'exp') !~ '^[0-9]{1,12}$' THEN
    RETURN false;
  END IF;

  expires_at := (claims ->> 'exp')::numeric;
  IF expires_at <= EXTRACT(
       EPOCH FROM pg_catalog.statement_timestamp()
     ) THEN
    RETURN false;
  END IF;

  IF object_name IS NULL
     OR pg_catalog.length(object_name) > 1024
     OR object_name ~ '[[:cntrl:]]'
     OR pg_catalog.strpos(object_name, E'\\') <> 0
     OR object_name ~ '%[0-9A-Fa-f]{2}'
     OR path_segments[1] <> 'organizations'
     OR path_segments[2] <> claims ->> 'organization_id'
     OR path_segments[3] <> 'claims'
     OR path_segments[4] !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR path_segments[5] <> 'documents'
     OR path_segments[6] !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  IF pg_catalog.array_length(path_segments, 1) = 7 THEN
    RETURN path_segments[7] ~
      '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
      AND path_segments[7] NOT IN ('.', '..');
  END IF;

  IF pg_catalog.array_length(path_segments, 1) = 9
     AND path_segments[7] = 'renditions'
     AND path_segments[8] = 'page-jpeg-v1'
     AND path_segments[9] ~ '^page-[0-9]{6}\.jpg$' THEN
    page_number := pg_catalog.substr(path_segments[9], 6, 6)::integer;
    RETURN page_number BETWEEN 1 AND 999999;
  END IF;

  RETURN false;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END
$function$;

COMMIT;
