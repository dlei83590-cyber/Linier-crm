CREATE TABLE "infrastructure_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "infrastructure_settings_pkey" PRIMARY KEY ("key")
);
