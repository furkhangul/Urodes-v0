CREATE TABLE app_users (
    id UUID PRIMARY KEY,
    keycloak_id TEXT NOT NULL UNIQUE,
    username TEXT NULL,
    email TEXT NULL,
    role VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_app_users_role ON app_users (role);

ALTER TABLE slides
    ADD COLUMN assigned_user_id UUID NULL REFERENCES app_users(id),
    ADD COLUMN assigned_by_user_id UUID NULL REFERENCES app_users(id),
    ADD COLUMN assigned_at TIMESTAMPTZ NULL;

CREATE INDEX idx_slides_assigned_user_id ON slides (assigned_user_id);

CREATE TABLE inbox_items (
    id UUID PRIMARY KEY,
    original_name TEXT NOT NULL,
    inbox_path TEXT NOT NULL UNIQUE,
    size_bytes BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    assigned_user_id UUID NULL REFERENCES app_users(id),
    assigned_by_user_id UUID NULL REFERENCES app_users(id),
    slide_id UUID NULL REFERENCES slides(id),
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    assigned_at TIMESTAMPTZ NULL,
    processed_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_inbox_items_status ON inbox_items (status);
CREATE INDEX idx_inbox_items_assigned_user_id ON inbox_items (assigned_user_id);
