-- Reverses 20260927000000_auth_sessions. Code from before that migration ignores the table. Dropping it signs everybody out.
DROP TABLE IF EXISTS "AuthSession";
