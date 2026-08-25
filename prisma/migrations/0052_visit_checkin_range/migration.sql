-- Migration 0052 - Visit Check-in Range (Visit weekly/month view + check-in rules MVP)
-- 1) BusinessPartner check-in range config: latitude/longitude/allowedRadiusMeters
--    (server computes distance at check-in; within range = success, out of range = explicit message)
-- 2) CustomerActivity adds checkoutAt (check-out) + visitPlanId (CHECK_IN -> VISIT_PLAN completion feedback)
-- Red line: ADD COLUMN / CREATE INDEX only (aligned with hand-written migration conventions 0044/0050)
-- Reuses project-visit RBAC (no new permission module); HOLD: GIS/map/GeoFence engine/push/check-in background stats

-- 1) BusinessPartner check-in range
ALTER TABLE "BusinessPartner" ADD COLUMN "latitude" DECIMAL(10,7);
ALTER TABLE "BusinessPartner" ADD COLUMN "longitude" DECIMAL(10,7);
ALTER TABLE "BusinessPartner" ADD COLUMN "allowedRadiusMeters" INTEGER;

-- 2) CustomerActivity check-in/check-out/completion feedback
ALTER TABLE "CustomerActivity" ADD COLUMN "checkoutAt" TIMESTAMP(3);
ALTER TABLE "CustomerActivity" ADD COLUMN "visitPlanId" TEXT;
CREATE INDEX "CustomerActivity_visitPlanId_idx" ON "CustomerActivity"("visitPlanId");
