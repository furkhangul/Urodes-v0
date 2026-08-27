CREATE TABLE slides (
    id UUID PRIMARY KEY,
    original_name VARCHAR(512) NOT NULL,
    stored_filename VARCHAR(512) NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    extension VARCHAR(32) NOT NULL,
    format VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
