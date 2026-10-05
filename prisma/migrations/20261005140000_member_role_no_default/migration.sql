-- A member created without an explicit role used to become an ADMIN through the
-- column default. Every create path now sets the role; with no default, a
-- member without one has no permissions. Existing rows keep their role.
ALTER TABLE "Member" ALTER COLUMN "role" DROP DEFAULT;
