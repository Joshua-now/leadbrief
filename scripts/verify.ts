import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function verify() {
  console.log("Running verification checks...\n");

  try {
    console.log("1. TypeScript type check...");
    await execAsync("npx tsc --noEmit");
    console.log("   TypeScript: PASSED\n");
  } catch (error: any) {
    console.error("   TypeScript: FAILED");
    console.error(error.stdout || error.message);
    process.exit(1);
  }

  try {
    console.log("2. Health endpoint check...");
    const { stdout } = await execAsync("curl -sf http://localhost:5000/api/health");
    const health = JSON.parse(stdout);
    if (health.status === "healthy") {
      console.log("   Health: PASSED\n");
      console.log("   Processor status:", JSON.stringify(health.processor));
      console.log("   Limits:", JSON.stringify(health.limits));
      console.log("");
    } else {
      throw new Error("Health check failed");
    }
  } catch (error: any) {
    console.error("   Health: FAILED - Server may not be running");
    console.error(error.message);
    process.exit(1);
  }

  try {
    console.log("3. Auth endpoint check...");
    const { stdout } = await execAsync("curl -s -w '%{http_code}' http://localhost:5000/api/auth/user");
    // Accept either 401 (unauthorized) or 501 (auth not configured) - both are valid
    if (stdout.includes("401") || stdout.includes("Unauthorized") || stdout.includes("501") || stdout.includes("not configured")) {
      const status = stdout.includes("501") ? "501 (auth not configured)" : "401 (unauthorized)";
      console.log(`   Auth protection: PASSED (correctly returns ${status})\n`);
    } else {
      throw new Error("Auth endpoint not protected");
    }
  } catch (error: any) {
    console.error("   Auth: FAILED");
    console.error(error.message);
    process.exit(1);
  }

  try {
    console.log("4. Intake endpoint with city field...");
    const testEmail = `verify-${Date.now()}@test.com`;
    const payload = JSON.stringify({
      email: testEmail,
      firstName: "Verify",
      lastName: "Test",
      city: "VerifyCity"
    });
    const { stdout } = await execAsync(`curl -sf -X POST http://localhost:5000/api/intake -H "Content-Type: application/json" -d '${payload}'`);
    const result = JSON.parse(stdout);
    if (result.success && result.contactId) {
      console.log("   Intake: PASSED");
      console.log("   Created contact:", result.contactId);
      console.log("");
      
      console.log("5. Verify contact has city field...");
      const { stdout: contactData } = await execAsync(`curl -sf http://localhost:5000/api/contacts/${result.contactId}`);
      const contact = JSON.parse(contactData);
      if (contact.city === "VerifyCity") {
        console.log("   City field: PASSED");
        console.log("   Contact data:", JSON.stringify(contact, null, 2));
        console.log("");
      } else {
        throw new Error(`City field not saved correctly. Expected 'VerifyCity', got '${contact.city}'`);
      }
    } else {
      throw new Error("Intake endpoint failed");
    }
  } catch (error: any) {
    console.error("   Intake/City: FAILED");
    console.error(error.message);
    process.exit(1);
  }

  try {
    console.log("6. Jobs endpoint check...");
    const { stdout } = await execAsync("curl -sf http://localhost:5000/api/jobs?limit=5");
    const jobs = JSON.parse(stdout);
    if (Array.isArray(jobs)) {
      console.log(`   Jobs: PASSED (${jobs.length} jobs found)\n`);
    } else {
      throw new Error("Jobs endpoint returned invalid data");
    }
  } catch (error: any) {
    console.error("   Jobs: FAILED");
    console.error(error.message);
    process.exit(1);
  }

  try {
    console.log("7. Contacts endpoint check...");
    const { stdout } = await execAsync("curl -sf http://localhost:5000/api/contacts?limit=5");
    const contacts = JSON.parse(stdout);
    if (Array.isArray(contacts)) {
      console.log(`   Contacts: PASSED (${contacts.length} contacts found)\n`);
    } else {
      throw new Error("Contacts endpoint returned invalid data");
    }
  } catch (error: any) {
    console.error("   Contacts: FAILED");
    console.error(error.message);
    process.exit(1);
  }

  console.log("========================================");
  console.log("All verification checks passed!");
  console.log("========================================");
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
