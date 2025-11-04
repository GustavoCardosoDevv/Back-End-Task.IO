/*
  Warnings:

  - You are about to drop the column `revokedAt` on the `refreshtoken` table. All the data in the column will be lost.
  - Added the required column `expiresAt` to the `refreshtoken` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `refreshtoken` DROP FOREIGN KEY `RefreshToken_userId_fkey`;

-- DropIndex
DROP INDEX `RefreshToken_token_key` ON `refreshtoken`;

-- DropIndex
DROP INDEX `RefreshToken_userId_idx` ON `refreshtoken`;

-- AlterTable
ALTER TABLE `refreshtoken` DROP COLUMN `revokedAt`,
    ADD COLUMN `expiresAt` DATETIME(3) NOT NULL,
    MODIFY `token` VARCHAR(512) NOT NULL;

-- AddForeignKey
ALTER TABLE `refreshtoken` ADD CONSTRAINT `refreshtoken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
