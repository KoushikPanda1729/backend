/*
  Warnings:

  - Added the required column `updatedAt` to the `Note` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "NoteTarget" ADD VALUE 'GENERAL';

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "title" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
