const { PrismaClient } = require("../src/generated/prisma");

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Create Roles
  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: { isDeleted: false, isActive: true },
    create: { name: "ADMIN", description: "System Administrator" },
  });

  const teacherRole = await prisma.role.upsert({
    where: { name: "TEACHER" },
    update: { isDeleted: false, isActive: true },
    create: { name: "TEACHER", description: "Teacher / Question Contributor" },
  });

  console.log("Roles upserted successfully.");

  // 2. Create Permissions
  const permissionsData = [
    // User administration permissions
    { name: "USER_CREATE", description: "Allows creating system users" },
    { name: "USER_VIEW", description: "Allows viewing system users" },
    { name: "USER_UPDATE", description: "Allows editing system users" },
    { name: "USER_DELETE", description: "Allows deleting/disabling system users" },
    
    // Core question and subject bank permissions
    { name: "questions:read", description: "View questions" },
    { name: "questions:write", description: "Create, edit, or delete own questions" },
    { name: "questions:approve", description: "Moderate and approve/reject questions" },
    { name: "subjects:read", description: "View subjects, chapters, and concepts" },
    { name: "subjects:write", description: "Create or modify subject taxonomy structures" },
    { name: "uploads:write", description: "Upload media files" },
    { name: "audit:read", description: "View system audit logs" },
  ];

  const permissions = {};
  for (const perm of permissionsData) {
    permissions[perm.name] = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { isDeleted: false, isActive: true },
      create: perm,
    });
  }

  console.log("Permissions upserted successfully.");

  // 3. Map Permissions to Roles (RolePermission)
  const rolePermissionsMap = {
    ADMIN: Object.keys(permissions), // All permissions (including User admin permissions)
    TEACHER: [
      "questions:read",
      "questions:write",
      "subjects:read",
      "uploads:write",
    ],
  };

  // Clear existing mappings to prevent primary key conflicts on reseeds
  await prisma.rolePermission.deleteMany({});

  // Setup Admin Mappings
  for (const permName of rolePermissionsMap.ADMIN) {
    await prisma.rolePermission.create({
      data: {
        roleId: adminRole.id,
        permissionId: permissions[permName].id,
      },
    });
  }

  // Setup Teacher Mappings
  for (const permName of rolePermissionsMap.TEACHER) {
    await prisma.rolePermission.create({
      data: {
        roleId: teacherRole.id,
        permissionId: permissions[permName].id,
      },
    });
  }

  console.log("Role-Permission mappings established.");
  console.log("Database seeding finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
