-- Reverses 20261003000000_account_setup_tokens. Pending invitation links stop working (admins re-invite). The MEMBER_INVITE_ACCEPTED enum value cannot be removed and is harmless.
DROP TABLE IF EXISTS "AccountSetupToken";
