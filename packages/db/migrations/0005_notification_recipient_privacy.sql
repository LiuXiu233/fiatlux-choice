DELETE FROM "role_permissions" AS permission
USING "roles" AS role
WHERE permission."org_id" = role."org_id"
  AND permission."role_id" = role."id"
  AND role."system_key" IN ('admin', 'member')
  AND permission."permission" = 'notifications:*';
--> statement-breakpoint
INSERT INTO "role_permissions" ("org_id", "role_id", "permission")
SELECT role."org_id", role."id", permission."name"
FROM "roles" AS role
CROSS JOIN (
  VALUES
    ('notifications:manage'),
    ('notifications:create'),
    ('notifications:read'),
    ('notifications:delete')
) AS permission("name")
WHERE role."system_key" = 'admin'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("org_id", "role_id", "permission")
SELECT role."org_id", role."id", 'notifications:read'
FROM "roles" AS role
WHERE role."system_key" = 'member'
ON CONFLICT DO NOTHING;
