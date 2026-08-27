ALTER TABLE slides
    ADD COLUMN bioformats_status VARCHAR(32) NOT NULL DEFAULT 'FAILED',
    ADD COLUMN bioformats_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN bioformats_error TEXT NULL,
    ADD COLUMN openslide_status VARCHAR(32) NOT NULL DEFAULT 'FAILED',
    ADD COLUMN openslide_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN openslide_error TEXT NULL,
    ADD COLUMN openslide_vendor TEXT NULL;

UPDATE slides
SET bioformats_status = status,
    bioformats_metadata = metadata;

CREATE INDEX idx_slides_bioformats_status ON slides (bioformats_status);
CREATE INDEX idx_slides_openslide_status ON slides (openslide_status);
