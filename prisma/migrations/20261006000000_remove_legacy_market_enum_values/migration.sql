-- Removes the retired enum values (PLOT/HOUSE/APARTMENT/AGRICULTURAL, MARLA/KANAL, PKR, ZAMEEN/SIGNBOARD).
-- Postgres cannot DROP an enum value, so each type is rebuilt. Rows are NEVER remapped or deleted:
-- if any row still uses a legacy value, the migration aborts with a count so a person can decide
-- what those rows mean (e.g. PKR amounts must not be silently relabelled as USD). All-or-nothing: one transaction.

DO $$
DECLARE n bigint; bad text := '';
BEGIN
  SELECT count(*) INTO n FROM "Property" WHERE "propertyType"::text IN ('PLOT','HOUSE','APARTMENT','AGRICULTURAL');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Property', 'propertyType', n); END IF;
  SELECT count(*) INTO n FROM "Lead" WHERE "propertyTypePref"::text IN ('PLOT','HOUSE','APARTMENT','AGRICULTURAL');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Lead', 'propertyTypePref', n); END IF;
  SELECT count(*) INTO n FROM "Property" WHERE "sizeUnit"::text IN ('MARLA','KANAL');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Property', 'sizeUnit', n); END IF;
  SELECT count(*) INTO n FROM "Lead" WHERE "sizeUnitPref"::text IN ('MARLA','KANAL');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Lead', 'sizeUnitPref', n); END IF;
  SELECT count(*) INTO n FROM "Workspace" WHERE "currency"::text IN ('PKR');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Workspace', 'currency', n); END IF;
  SELECT count(*) INTO n FROM "Property" WHERE "currency"::text IN ('PKR');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Property', 'currency', n); END IF;
  SELECT count(*) INTO n FROM "Lead" WHERE "currency"::text IN ('PKR');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Lead', 'currency', n); END IF;
  SELECT count(*) INTO n FROM "Opportunity" WHERE "currency"::text IN ('PKR');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Opportunity', 'currency', n); END IF;
  SELECT count(*) INTO n FROM "Proposal" WHERE "currency"::text IN ('PKR');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Proposal', 'currency', n); END IF;
  SELECT count(*) INTO n FROM "Lead" WHERE "source"::text IN ('ZAMEEN','SIGNBOARD');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Lead', 'source', n); END IF;
  SELECT count(*) INTO n FROM "Opportunity" WHERE "source"::text IN ('ZAMEEN','SIGNBOARD');
  IF n > 0 THEN bad := bad || format('%s.%s=%s ', 'Opportunity', 'source', n); END IF;
  IF bad <> '' THEN RAISE EXCEPTION 'Legacy enum values still in use, migrate or clear these rows first: %', bad; END IF;
END $$;

-- PropertyType
ALTER TYPE "PropertyType" RENAME TO "PropertyType_old";
CREATE TYPE "PropertyType" AS ENUM ('SINGLE_FAMILY','CONDO','TOWNHOUSE','MULTI_FAMILY','LAND','COMMERCIAL');
ALTER TABLE "Property" ALTER COLUMN "propertyType" TYPE "PropertyType" USING "propertyType"::text::"PropertyType";
ALTER TABLE "Lead" ALTER COLUMN "propertyTypePref" TYPE "PropertyType" USING "propertyTypePref"::text::"PropertyType";
DROP TYPE "PropertyType_old";

-- SizeUnit
ALTER TABLE "Property" ALTER COLUMN "sizeUnit" DROP DEFAULT;
ALTER TYPE "SizeUnit" RENAME TO "SizeUnit_old";
CREATE TYPE "SizeUnit" AS ENUM ('SQFT','ACRE','SQM','OTHER');
ALTER TABLE "Property" ALTER COLUMN "sizeUnit" TYPE "SizeUnit" USING "sizeUnit"::text::"SizeUnit";
ALTER TABLE "Property" ALTER COLUMN "sizeUnit" SET DEFAULT 'SQFT';
ALTER TABLE "Lead" ALTER COLUMN "sizeUnitPref" TYPE "SizeUnit" USING "sizeUnitPref"::text::"SizeUnit";
DROP TYPE "SizeUnit_old";

-- Currency
ALTER TABLE "Workspace" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Property" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Opportunity" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Proposal" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TYPE "Currency" RENAME TO "Currency_old";
CREATE TYPE "Currency" AS ENUM ('USD');
ALTER TABLE "Workspace" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::text::"Currency";
ALTER TABLE "Workspace" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Property" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::text::"Currency";
ALTER TABLE "Property" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Lead" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::text::"Currency";
ALTER TABLE "Lead" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Opportunity" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::text::"Currency";
ALTER TABLE "Opportunity" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "Proposal" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::text::"Currency";
ALTER TABLE "Proposal" ALTER COLUMN "currency" SET DEFAULT 'USD';
DROP TYPE "Currency_old";

-- LeadSource
ALTER TABLE "Lead" ALTER COLUMN "source" DROP DEFAULT;
ALTER TYPE "LeadSource" RENAME TO "LeadSource_old";
CREATE TYPE "LeadSource" AS ENUM ('ZILLOW','REALTOR_COM','HOMES_COM','WEB_FORM','OPEN_HOUSE','SIGN_CALL','AGENT_REFERRAL','FACEBOOK_ADS','REFERRAL','WALK_IN','COLD_CALL','EXISTING_CLIENT','WHATSAPP_INBOUND','GOOGLE_ADS','PHONE','MANUAL','OTHER');
ALTER TABLE "Lead" ALTER COLUMN "source" TYPE "LeadSource" USING "source"::text::"LeadSource";
ALTER TABLE "Lead" ALTER COLUMN "source" SET DEFAULT 'WHATSAPP_INBOUND';
ALTER TABLE "Opportunity" ALTER COLUMN "source" TYPE "LeadSource" USING "source"::text::"LeadSource";
DROP TYPE "LeadSource_old";
