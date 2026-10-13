-- Local date (YYYY-MM-DD in the company timezone) of the last digest run
ALTER TABLE "Company" ADD COLUMN "lastDigestOn" TEXT;
