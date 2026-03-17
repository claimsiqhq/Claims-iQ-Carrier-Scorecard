import { db, pool } from "@workspace/db";
import { claims } from "@workspace/db";

async function seed() {
  console.log("Seeding database...");

  const existingClaims = await db.select().from(claims);
  if (existingClaims.length > 0) {
    console.log("Database already has data, skipping seed.");
    process.exit(0);
  }

  console.log("No claims found. Database is clean — add claims via the application.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
