ALTER TABLE slides
    ADD COLUMN ingest_source VARCHAR(32) NOT NULL DEFAULT 'UPLOAD';

ALTER TABLE slides
    ADD COLUMN source_filename TEXT NULL;

CREATE INDEX idx_slides_ingest_source ON slides (ingest_source);
