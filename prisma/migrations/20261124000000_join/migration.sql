-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "paper_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "asset_id" TEXT NOT NULL,
    "article_id" TEXT,
    "parent_id" UUID,
    "kind" TEXT NOT NULL DEFAULT 'photo',
    "src_url" TEXT,
    "orig_key" TEXT,
    "w" INTEGER,
    "h" INTEGER,
    "focal" JSONB,
    "derivatives" JSONB,
    "caption" TEXT,
    "credit" TEXT,
    "hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "template_set" TEXT NOT NULL DEFAULT 'broadsheet-en',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rev" INTEGER NOT NULL DEFAULT 1,
    "plan" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "no" INTEGER NOT NULL,
    "template_id" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "fit_pct" INTEGER,
    "fit_report" JSONB,
    "fit_rev" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "locked_by" UUID,
    "lock_expires_at" TIMESTAMP(3),
    "rev" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "rev" INTEGER NOT NULL,
    "doc" JSONB NOT NULL,
    "snapshot" JSONB,
    "fit_pct" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'save',
    "user_id" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_articles" (
    "page_id" UUID NOT NULL,
    "paper_id" UUID NOT NULL,
    "article_id" TEXT NOT NULL,
    "article_rev" INTEGER NOT NULL,

    CONSTRAINT "page_articles_pkey" PRIMARY KEY ("page_id","article_id")
);

-- CreateTable
CREATE TABLE "exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "file_key" TEXT,
    "snapshot_key" TEXT,
    "file_name" TEXT,
    "log" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ep_editions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "export_id" UUID,
    "edition_id" UUID,
    "pdf_key" TEXT,
    "pdf_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'building',
    "error" TEXT,
    "publish_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "misses" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ep_editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ep_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "ep_edition_id" UUID NOT NULL,
    "no" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rolled_back" BOOLEAN NOT NULL DEFAULT false,
    "pdf_key" TEXT,
    "img_keys" JSONB NOT NULL,
    "img_w" INTEGER NOT NULL,
    "img_h" INTEGER NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "corrected" BOOLEAN NOT NULL DEFAULT false,
    "zoned_by" TEXT,
    "src_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ep_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ep_zones" (
    "pk" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "ep_page_id" UUID NOT NULL,
    "zone_id" TEXT NOT NULL,
    "article_id" TEXT,
    "rects" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "ep_zones_pkey" PRIMARY KEY ("pk")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "paper_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "ep_page_id" UUID,
    "zone_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" JSONB NOT NULL DEFAULT '["edition.published"]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paper_id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "articles_paper_id_published_at_idx" ON "articles"("paper_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "articles_paper_id_source_id_external_id_key" ON "articles"("paper_id", "source_id", "external_id");

-- CreateIndex
CREATE INDEX "assets_article_id_idx" ON "assets"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_paper_id_asset_id_key" ON "assets"("paper_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "editions_paper_id_date_name_key" ON "editions"("paper_id", "date", "name");

-- CreateIndex
CREATE INDEX "pages_paper_id_idx" ON "pages"("paper_id");

-- CreateIndex
CREATE UNIQUE INDEX "pages_edition_id_no_key" ON "pages"("edition_id", "no");

-- CreateIndex
CREATE UNIQUE INDEX "page_versions_page_id_rev_key" ON "page_versions"("page_id", "rev");

-- CreateIndex
CREATE INDEX "page_articles_article_id_idx" ON "page_articles"("article_id");

-- CreateIndex
CREATE INDEX "exports_paper_id_edition_id_idx" ON "exports"("paper_id", "edition_id");

-- CreateIndex
CREATE INDEX "ep_editions_paper_id_date_idx" ON "ep_editions"("paper_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ep_pages_ep_edition_id_no_version_key" ON "ep_pages"("ep_edition_id", "no", "version");

-- CreateIndex
CREATE INDEX "ep_zones_ep_page_id_idx" ON "ep_zones"("ep_page_id");

-- CreateIndex
CREATE INDEX "events_paper_id_at_idx" ON "events"("paper_id", "at");

-- CreateIndex
CREATE INDEX "webhooks_paper_id_idx" ON "webhooks"("paper_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_paper_id_webhook_id_idx" ON "webhook_deliveries"("paper_id", "webhook_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editions" ADD CONSTRAINT "editions_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ep_editions" ADD CONSTRAINT "ep_editions_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ep_pages" ADD CONSTRAINT "ep_pages_ep_edition_id_fkey" FOREIGN KEY ("ep_edition_id") REFERENCES "ep_editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ep_zones" ADD CONSTRAINT "ep_zones_ep_page_id_fkey" FOREIGN KEY ("ep_page_id") REFERENCES "ep_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

