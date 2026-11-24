
PRAGMA foreign_keys = ON;

-- =========================================
-- CHEMICAL REGISTER
-- Initial Database Migration
-- Cloudflare D1 / SQLite
-- =========================================

-- 1. SECTIONS
CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  section_code TEXT NOT NULL UNIQUE,
  section_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. USERS
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  section_id TEXT REFERENCES sections(id),
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 1
    CHECK (must_change_password IN (0,1)),
  password_changed_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

-- 3. ROLES
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  role_code TEXT NOT NULL UNIQUE,
  role_name TEXT NOT NULL
);

-- 4. USER ROLES
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  assigned_by TEXT REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id)
);

-- 5. SESSIONS
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE INDEX idx_sessions_user
ON sessions(user_id);

-- 6. LOGIN ATTEMPTS
CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  ip_hash TEXT
);

CREATE INDEX idx_login_attempts_username_time
ON login_attempts(username, attempted_at);

-- 7. RUNNING SEQUENCES
CREATE TABLE running_sequences (
  sequence_key TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0
    CHECK (last_value >= 0)
);

INSERT INTO running_sequences (sequence_key, last_value)
VALUES ('chemical_request', 0);

-- 8. CHEMICAL REQUESTS
CREATE TABLE chemical_requests (
  id TEXT PRIMARY KEY,
  running_number TEXT NOT NULL UNIQUE,
  running_year INTEGER NOT NULL,
  running_sequence INTEGER NOT NULL UNIQUE,

  section_id TEXT NOT NULL REFERENCES sections(id),
  requestor_id TEXT NOT NULL REFERENCES users(id),

  item_no TEXT NOT NULL,
  item_description TEXT NOT NULL,
  chemical_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  request_quantity REAL NOT NULL
    CHECK (request_quantity > 0),
  unit TEXT NOT NULL,

  declared_type TEXT NOT NULL
    CHECK (declared_type IN ('EXISTING','NEW')),

  safety_classification TEXT
    CHECK (
      safety_classification IS NULL OR
      safety_classification IN (
        'EXISTING',
        'NEW_GENERAL',
        'NEW_HAZARDOUS',
        'OTHER'
      )
    ),

  status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN (
      'SUBMITTED',
      'PENDING_STORE_REVIEW',
      'PENDING_SAFETY_REVIEW',
      'RETURNED_FOR_DOCUMENTS',
      'PENDING_CUSTOMER_APPROVAL',
      'APPROVED_FOR_PURCHASE',
      'REJECTED',
      'CANCELLED'
    )),

  store_review_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (store_review_status IN (
      'NOT_REQUIRED',
      'PENDING_REVIEW',
      'WITHIN_LIMIT',
      'EXCEEDS_LIMIT'
    )),

  safety_review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (safety_review_status IN (
      'PENDING_REVIEW',
      'RETURNED',
      'APPROVED',
      'REJECTED'
    )),

  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT,
  cancellation_reason TEXT
);

CREATE INDEX idx_requests_section
ON chemical_requests(section_id);

CREATE INDEX idx_requests_status
ON chemical_requests(status);

CREATE INDEX idx_requests_requestor
ON chemical_requests(requestor_id);

CREATE INDEX idx_requests_submitted
ON chemical_requests(submitted_at);

CREATE INDEX idx_requests_classification
ON chemical_requests(safety_classification);

-- 9. REQUEST DOCUMENTS
CREATE TABLE request_documents (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES chemical_requests(id),
  drive_file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  document_type TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0,1))
);

CREATE INDEX idx_documents_request
ON request_documents(request_id);

-- 10. STORE REVIEWS
CREATE TABLE store_reviews (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES chemical_requests(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),

  current_stock REAL NOT NULL
    CHECK (current_stock >= 0),

  request_quantity REAL NOT NULL
    CHECK (request_quantity > 0),

  maximum_stock REAL GENERATED ALWAYS AS
    (current_stock + request_quantity) STORED,

  result TEXT NOT NULL
    CHECK (result IN ('WITHIN_LIMIT','EXCEEDS_LIMIT')),

  remark TEXT,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_store_reviews_request
ON store_reviews(request_id);

-- 11. SAFETY REVIEWS
CREATE TABLE safety_reviews (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES chemical_requests(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),

  classification TEXT
    CHECK (
      classification IS NULL OR
      classification IN (
        'EXISTING',
        'NEW_GENERAL',
        'NEW_HAZARDOUS',
        'OTHER'
      )
    ),

  action TEXT NOT NULL
    CHECK (action IN (
      'REVIEW',
      'RETURN_FOR_DOCUMENTS',
      'APPROVE',
      'REJECT'
    )),

  comment TEXT,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_safety_reviews_request
ON safety_reviews(request_id);

-- 12. CUSTOMER APPROVALS
CREATE TABLE customer_approvals (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES chemical_requests(id),
  handled_by TEXT NOT NULL REFERENCES users(id),

  result TEXT NOT NULL
    CHECK (result IN ('PENDING','APPROVED','REJECTED')),

  customer_reference TEXT,
  comment TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customer_approvals_request
ON customer_approvals(request_id);

-- 13. AUDIT LOGS
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES chemical_requests(id),
  actor_id TEXT REFERENCES users(id),

  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_values TEXT,
  new_values TEXT,
  reason TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_request_time
ON audit_logs(request_id, created_at);

CREATE INDEX idx_audit_actor_time
ON audit_logs(actor_id, created_at);

-- 14. NOTIFICATIONS
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT REFERENCES chemical_requests(id),

  channel TEXT NOT NULL
    CHECK (channel IN ('IN_APP','EMAIL')),

  title TEXT NOT NULL,
  message TEXT NOT NULL,

  is_read INTEGER NOT NULL DEFAULT 0
    CHECK (is_read IN (0,1)),

  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user
ON notifications(user_id, is_read, created_at);
