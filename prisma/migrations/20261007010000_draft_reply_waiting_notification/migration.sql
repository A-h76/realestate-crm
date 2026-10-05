-- Draft-waiting notification: the default DRAFT mode saves the AI reply for a human; this tells the owner it is waiting.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DRAFT_REPLY_WAITING';
