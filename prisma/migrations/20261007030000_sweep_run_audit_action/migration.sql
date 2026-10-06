-- Heartbeat / first-pass marker for the custody sweeper (one SYSTEM audit row per workspace per run).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CUSTODY_SWEEP_RUN';
