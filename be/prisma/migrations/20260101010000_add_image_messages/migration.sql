-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "messages_type_expires_at_idx" ON "messages"("type", "expires_at");
