CREATE TYPE "public"."activity_source" AS ENUM('web', 'cli', 'mcp', 'api', 'github', 'system');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('human', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."adoption_source" AS ENUM('manual', 'label', 'repo-match', 'path');--> statement-breakpoint
CREATE TYPE "public"."human_or_agent" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."issue_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."metadata_source" AS ENUM('fields', 'labels', 'none');--> statement-breakpoint
CREATE TYPE "public"."principal_kind" AS ENUM('local', 'user', 'token');--> statement-breakpoint
CREATE TYPE "public"."publish_state" AS ENUM('local', 'pending', 'synced', 'error');--> statement-breakpoint
CREATE TYPE "public"."repository_provider" AS ENUM('local', 'github', 'gitlab', 'bitbucket', 'other');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'developer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'ended', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."task_environment_source" AS ENUM('manual', 'label', 'branch', 'namespace');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'ready', 'in_progress', 'review', 'blocked', 'done');--> statement-breakpoint
CREATE TYPE "public"."task_sync_state" AS ENUM('synced', 'pending', 'conflict', 'error');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"reference_id" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"expires_at" timestamp with time zone,
	"last_request" timestamp with time zone,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"rate_limit_enabled" boolean DEFAULT false,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"permissions" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "instance_singleton_check" CHECK ("instance"."singleton"),
	CONSTRAINT "instance_name_check" CHECK (btrim("instance"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_check" CHECK (btrim("settings"."key") <> '')
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"archived" boolean DEFAULT false NOT NULL,
	"relative_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug"),
	CONSTRAINT "projects_slug_check" CHECK (btrim("projects"."slug") <> ''),
	CONSTRAINT "projects_name_check" CHECK (btrim("projects"."name") <> ''),
	CONSTRAINT "projects_relative_path_check" CHECK ("projects"."relative_path" IS NULL OR (btrim("projects"."relative_path") <> '' AND "projects"."relative_path" NOT LIKE '/%' AND "projects"."relative_path" NOT LIKE '%..%' AND "projects"."relative_path" NOT LIKE '%/%'))
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repositories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" bigint NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"local_path" text,
	"relative_path" text,
	"remote_url" text,
	"provider" "repository_provider" DEFAULT 'local' NOT NULL,
	"github_repository_id" bigint,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_github_repository_id_unique" UNIQUE("github_repository_id"),
	CONSTRAINT "repositories_project_id_name_key" UNIQUE("project_id","name"),
	CONSTRAINT "repositories_name_check" CHECK (btrim("repositories"."name") <> ''),
	CONSTRAINT "repositories_local_path_check" CHECK ("repositories"."local_path" IS NULL OR ("repositories"."local_path" LIKE '/%' AND "repositories"."local_path" NOT LIKE '%/../%' AND "repositories"."local_path" NOT LIKE '%/..')),
	CONSTRAINT "repositories_relative_path_check" CHECK ("repositories"."relative_path" IS NULL OR (btrim("repositories"."relative_path") <> '' AND "repositories"."relative_path" NOT LIKE '/%' AND "repositories"."relative_path" NOT LIKE '%..%'))
);
--> statement-breakpoint
CREATE TABLE "environment_settings" (
	"environment_id" bigint NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_settings_environment_id_key_pk" PRIMARY KEY("environment_id","key"),
	CONSTRAINT "environment_settings_key_check" CHECK (btrim("environment_settings"."key") <> '')
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "environments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"compose_project" text NOT NULL,
	"working_dir" text,
	"config_files" text[] DEFAULT '{}' NOT NULL,
	"repo_url" text,
	"repo_subpath" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_compose_project_unique" UNIQUE("compose_project"),
	CONSTRAINT "environments_compose_project_check" CHECK (btrim("environments"."compose_project") <> '')
);
--> statement-breakpoint
CREATE TABLE "project_environments" (
	"project_id" bigint NOT NULL,
	"environment_id" bigint NOT NULL,
	"source" "adoption_source" NOT NULL,
	CONSTRAINT "project_environments_project_id_environment_id_pk" PRIMARY KEY("project_id","environment_id")
);
--> statement-breakpoint
CREATE TABLE "service_settings" (
	"environment_id" bigint NOT NULL,
	"service" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_settings_environment_id_service_key_pk" PRIMARY KEY("environment_id","service","key"),
	CONSTRAINT "service_settings_service_check" CHECK (btrim("service_settings"."service") <> ''),
	CONSTRAINT "service_settings_key_check" CHECK (btrim("service_settings"."key") <> '')
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"task_id" bigint NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content" "bytea" NOT NULL,
	"actor" text,
	"actor_kind" "actor_kind" DEFAULT 'human' NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_attachments_filename_check" CHECK (btrim("task_attachments"."filename") <> '' AND length("task_attachments"."filename") <= 255),
	CONSTRAINT "task_attachments_content_type_check" CHECK (btrim("task_attachments"."content_type") <> '' AND length("task_attachments"."content_type") <= 128),
	CONSTRAINT "task_attachments_size_bytes_check" CHECK ("task_attachments"."size_bytes" > 0 AND "task_attachments"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "task_environments" (
	"task_id" bigint NOT NULL,
	"environment_id" bigint NOT NULL,
	"source" "task_environment_source" NOT NULL,
	"branch" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_environments_task_id_environment_id_pk" PRIMARY KEY("task_id","environment_id")
);
--> statement-breakpoint
CREATE TABLE "task_github_links" (
	"task_id" bigint PRIMARY KEY NOT NULL,
	"github_issue_id" bigint NOT NULL,
	"sync_state" "task_sync_state" DEFAULT 'synced' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"local_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"remote_updated_at" timestamp with time zone,
	CONSTRAINT "task_github_links_github_issue_id_unique" UNIQUE("github_issue_id")
);
--> statement-breakpoint
CREATE TABLE "task_notes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"task_id" bigint NOT NULL,
	"actor" text,
	"actor_kind" "actor_kind" DEFAULT 'human' NOT NULL,
	"user_id" text,
	"body" text NOT NULL,
	"source_key" text,
	"github_comment_id" bigint,
	"github_html_url" text,
	"publish_state" "publish_state" DEFAULT 'local' NOT NULL,
	"publish_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "task_notes_body_check" CHECK (btrim("task_notes"."body") <> '')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" bigint NOT NULL,
	"repository_id" bigint,
	"environment_id" bigint,
	"service" text,
	"parent_id" bigint,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"priority" "task_priority",
	"type" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee" text,
	"agent" text,
	"created_by" text,
	"created_by_user_id" text,
	"position" bigint DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"source_key" text,
	"draft" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "tasks_title_check" CHECK (btrim("tasks"."title") <> ''),
	CONSTRAINT "tasks_parent_check" CHECK ("tasks"."parent_id" IS NULL OR "tasks"."parent_id" <> "tasks"."id")
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"actor" text,
	"actor_kind" "actor_kind",
	"user_id" text,
	"source" "activity_source",
	"project_id" bigint,
	"task_id" bigint,
	"repository_id" bigint,
	"environment_id" bigint,
	"session_id" bigint,
	"summary" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "activity_events_kind_check" CHECK (btrim("activity_events"."kind") <> '')
);
--> statement-breakpoint
CREATE TABLE "work_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" bigint NOT NULL,
	"task_id" bigint,
	"repository_id" bigint,
	"environment_id" bigint,
	"actor" text NOT NULL,
	"actor_kind" "human_or_agent" NOT NULL,
	"user_id" text,
	"agent" text,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"summary" text,
	"head_before" text,
	"head_after" text,
	"commits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "work_sessions_actor_check" CHECK (btrim("work_sessions"."actor") <> '')
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_installations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"target_id" bigint,
	"suspended" boolean DEFAULT false NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id"),
	CONSTRAINT "github_installations_account_login_check" CHECK (btrim("github_installations"."account_login") <> '')
);
--> statement-breakpoint
CREATE TABLE "github_issue_relationships" (
	"parent_id" bigint NOT NULL,
	"child_id" bigint NOT NULL,
	"kind" text DEFAULT 'sub_issue' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "github_issue_relationships_parent_id_child_id_pk" PRIMARY KEY("parent_id","child_id"),
	CONSTRAINT "github_issue_relationships_check" CHECK ("github_issue_relationships"."parent_id" <> "github_issue_relationships"."child_id")
);
--> statement-breakpoint
CREATE TABLE "github_issues" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_issues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"github_id" bigint NOT NULL,
	"node_id" text NOT NULL,
	"repository_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" "issue_state" NOT NULL,
	"state_reason" text,
	"issue_type" text,
	"workflow_status" text,
	"priority" text,
	"metadata_source" "metadata_source" DEFAULT 'none' NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"milestone" jsonb,
	"html_url" text NOT NULL,
	"is_pull_request" boolean DEFAULT false NOT NULL,
	"github_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_issues_github_id_unique" UNIQUE("github_id"),
	CONSTRAINT "github_issues_repository_id_number_key" UNIQUE("repository_id","number")
);
--> statement-breakpoint
CREATE TABLE "github_repositories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_repositories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"github_id" bigint NOT NULL,
	"node_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text,
	"private" boolean NOT NULL,
	"html_url" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_repositories_github_id_unique" UNIQUE("github_id"),
	CONSTRAINT "github_repositories_full_name_unique" UNIQUE("full_name")
);
--> statement-breakpoint
CREATE TABLE "github_sync_state" (
	"scope" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"user_email" text,
	"principal_kind" "principal_kind" NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"resource_name" text,
	"project_id" bigint,
	"ip_address" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_reference_id_users_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_github_repository_id_github_repositories_id_fk" FOREIGN KEY ("github_repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_settings" ADD CONSTRAINT "environment_settings_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_settings" ADD CONSTRAINT "service_settings_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_environments" ADD CONSTRAINT "task_environments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_environments" ADD CONSTRAINT "task_environments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_links" ADD CONSTRAINT "task_github_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_github_links" ADD CONSTRAINT "task_github_links_github_issue_id_github_issues_id_fk" FOREIGN KEY ("github_issue_id") REFERENCES "public"."github_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_session_id_work_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."work_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_relationships" ADD CONSTRAINT "github_issue_relationships_parent_id_github_issues_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."github_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_relationships" ADD CONSTRAINT "github_issue_relationships_child_id_github_issues_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."github_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issues" ADD CONSTRAINT "github_issues_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_installation_id_github_installations_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installations"("installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_issuer_account_id_idx" ON "accounts" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "api_keys_reference_idx" ON "api_keys" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_relative_path_unique" ON "projects" USING btree ("relative_path") WHERE "projects"."relative_path" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_local_path_unique" ON "repositories" USING btree ("local_path") WHERE "repositories"."local_path" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "repositories_project_idx" ON "repositories" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "environments_last_seen_idx" ON "environments" USING btree ("last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "environments_repo_coordinate_idx" ON "environments" USING btree ("repo_url","repo_subpath") WHERE "environments"."repo_url" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_environments_one_project_per_env" ON "project_environments" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "task_attachments_task_idx" ON "task_attachments" USING btree ("task_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "task_environments_one_task_per_env" ON "task_environments" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "task_notes_task_idx" ON "task_notes" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_notes_source_key_present" ON "task_notes" USING btree ("task_id","source_key") WHERE "task_notes"."source_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_id") WHERE "tasks"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_repository_idx" ON "tasks" USING btree ("repository_id") WHERE "tasks"."repository_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_board_order_idx" ON "tasks" USING btree ("project_id","status","position","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_source_key_present" ON "tasks" USING btree ("project_id","source_key") WHERE "tasks"."source_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_draft_reuse" ON "tasks" USING btree ("project_id","created_by","parent_id") WHERE "tasks"."draft";--> statement-breakpoint
CREATE INDEX "activity_events_project_at_idx" ON "activity_events" USING btree ("project_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_at_idx" ON "activity_events" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_task_idx" ON "activity_events" USING btree ("task_id","at" DESC NULLS LAST) WHERE "activity_events"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_sessions_project_status_idx" ON "work_sessions" USING btree ("project_id","status","last_activity_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_sessions_task_idx" ON "work_sessions" USING btree ("task_id") WHERE "work_sessions"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "github_issue_relationships_child_idx" ON "github_issue_relationships" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "github_issues_repo_state_idx" ON "github_issues" USING btree ("repository_id","state");--> statement-breakpoint
CREATE INDEX "github_issues_updated_idx" ON "github_issues" USING btree ("github_updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "github_repositories_installation_idx" ON "github_repositories" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_at_idx" ON "audit_log" USING btree ("user_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_project_at_idx" ON "audit_log" USING btree ("project_id","at" DESC NULLS LAST);