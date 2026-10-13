-- Generated from pinned Better Auth 1.7.7; isolated child branch only.
CREATE SCHEMA newhope_auth;
create schema if not exists "newhope_auth";

create table "newhope_auth"."user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean, "isActive" boolean not null);

create table "newhope_auth"."session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "newhope_auth"."user" ("id") on delete cascade);

create table "newhope_auth"."account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "newhope_auth"."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "newhope_auth"."verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "newhope_auth"."twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "newhope_auth"."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

create table "newhope_auth"."rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "newhope_auth"."session" ("userId");

create index "account_userId_idx" on "newhope_auth"."account" ("userId");

create index "verification_identifier_idx" on "newhope_auth"."verification" ("identifier");

create index "twoFactor_secret_idx" on "newhope_auth"."twoFactor" ("secret");

create index "twoFactor_userId_idx" on "newhope_auth"."twoFactor" ("userId");
