create table if not exists issue_protocol_dispatch_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  issue_id uuid not null references issues(id) on delete cascade,
  protocol_message_id uuid not null references issue_protocol_messages(id) on delete cascade,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  not_before timestamptz not null default now(),
  last_attempt_at timestamptz,
  dispatched_at timestamptz,
  settled_at timestamptz,
  last_error text,
  dispatch_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists issue_protocol_dispatch_outbox_message_idx
  on issue_protocol_dispatch_outbox (protocol_message_id);

create index if not exists issue_protocol_dispatch_outbox_company_status_not_before_idx
  on issue_protocol_dispatch_outbox (company_id, status, not_before);

create index if not exists issue_protocol_dispatch_outbox_issue_status_idx
  on issue_protocol_dispatch_outbox (company_id, issue_id, status);
