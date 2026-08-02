-- AlterTable
ALTER TABLE "participants" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "client_id" TEXT;

-- CreateIndex
CREATE INDEX "participants_room_id_client_id_idx" ON "participants"("room_id", "client_id");
