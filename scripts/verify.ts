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
    if (stdout.includes("401") || stdout.includes("Unauthorized")) {
      console.log("   Auth protection: PASSED (correctly returns 401 for unauthenticated)\n");
    } else {
      throw new Error("Auth endpoint not protected");
    }
  } catch (error: any) {
    console.error("   Auth: FAILED");
    console.error(error.message);
    process.exit(1);
  }

  console.log("All verification checks passed!");
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
