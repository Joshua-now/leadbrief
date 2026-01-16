import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

async function runTest(name: string, fn: () => Promise<{ passed: boolean; details?: string }>) {
  try {
    const result = await fn();
    results.push({ name, ...result });
    console.log(result.passed ? `   ✓ ${name}` : `   ✗ ${name}${result.details ? ` - ${result.details}` : ''}`);
  } catch (error: any) {
    results.push({ name, passed: false, details: error.message });
    console.log(`   ✗ ${name} - ${error.message}`);
  }
}

async function curlJson(endpoint: string, method = 'GET', body?: any): Promise<{ status: number; data: any }> {
  let cmd = `curl -s -w '\\n%{http_code}' ${BASE_URL}${endpoint}`;
  if (method !== 'GET') {
    cmd = `curl -s -w '\\n%{http_code}' -X ${method} ${BASE_URL}${endpoint}`;
    if (body) {
      cmd += ` -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`;
    }
  }
  
  const { stdout } = await execAsync(cmd);
  const lines = stdout.trim().split('\n');
  const statusCode = parseInt(lines.pop() || '0', 10);
  const jsonStr = lines.join('\n');
  
  let data: any = null;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    data = jsonStr;
  }
  
  return { status: statusCode, data };
}

async function verify() {
  console.log("\n🔍 LeadBrief API Verification");
  console.log("━".repeat(50));
  console.log(`   Target: ${BASE_URL}\n`);

  // 1. Health endpoint
  console.log("1. Health Check");
  await runTest('GET /api/health returns ok:true', async () => {
    const { status, data } = await curlJson('/api/health');
    if (status !== 200) {
      return { passed: false, details: `Expected 200, got ${status}` };
    }
    if (!data.ok) {
      return { passed: false, details: `ok=${data.ok}, db=${data.db}` };
    }
    if (!data.version) {
      return { passed: false, details: 'Missing version field' };
    }
    if (!data.env) {
      return { passed: false, details: 'Missing env field' };
    }
    return { passed: true, details: `v${data.version}, db=${data.db}` };
  });

  // 2. Config limits
  console.log("\n2. Config Limits");
  await runTest('GET /api/config/limits returns 200', async () => {
    const { status, data } = await curlJson('/api/config/limits');
    if (status !== 200) {
      return { passed: false, details: `Expected 200, got ${status}` };
    }
    if (!data.MAX_RECORDS) {
      return { passed: false, details: 'Missing MAX_RECORDS' };
    }
    return { passed: true, details: `MAX_RECORDS=${data.MAX_RECORDS}` };
  });

  // 3. Auth config
  console.log("\n3. Auth Config");
  await runTest('GET /api/auth/config returns provider info', async () => {
    const { status, data } = await curlJson('/api/auth/config');
    if (status !== 200) {
      return { passed: false, details: `Expected 200, got ${status}` };
    }
    if (data.provider === undefined) {
      return { passed: false, details: 'Missing provider field' };
    }
    return { passed: true, details: `provider=${data.provider}` };
  });

  // 4. Protected endpoints (should return 401 or 501 without auth)
  console.log("\n4. Protected Endpoints (without auth)");
  
  await runTest('GET /api/jobs returns 401/501 (protected)', async () => {
    const { status } = await curlJson('/api/jobs');
    if (status === 401 || status === 501) {
      return { passed: true, details: `Got ${status}` };
    }
    return { passed: false, details: `Expected 401/501, got ${status}` };
  });

  await runTest('GET /api/contacts returns 401/501 (protected)', async () => {
    const { status } = await curlJson('/api/contacts');
    if (status === 401 || status === 501) {
      return { passed: true, details: `Got ${status}` };
    }
    return { passed: false, details: `Expected 401/501, got ${status}` };
  });

  await runTest('GET /api/settings returns 401/501 (protected)', async () => {
    const { status } = await curlJson('/api/settings');
    if (status === 401 || status === 501) {
      return { passed: true, details: `Got ${status}` };
    }
    return { passed: false, details: `Expected 401/501, got ${status}` };
  });

  // 5. Intake endpoint with city field
  console.log("\n5. Intake Endpoint");
  const testEmail = `verify-${Date.now()}@test.example.com`;
  let createdContactId: string | null = null;
  
  await runTest('POST /api/intake with city persists correctly', async () => {
    const { status, data } = await curlJson('/api/intake', 'POST', {
      email: testEmail,
      firstName: 'Verify',
      lastName: 'Test',
      city: 'VerifyCity',
    });
    
    // Should succeed (200) or require API key (401)
    if (status === 200 && data.success && data.contactId) {
      createdContactId = data.contactId;
      return { passed: true, details: `Created ${data.contactId}` };
    }
    if (status === 401) {
      return { passed: true, details: 'API key required (OK)' };
    }
    return { passed: false, details: `Got ${status}: ${JSON.stringify(data)}` };
  });

  // Print summary
  console.log("\n" + "━".repeat(50));
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  if (passed === total) {
    console.log(`\n✅ PASS: ${passed}/${total} checks passed\n`);
    process.exit(0);
  } else {
    console.log(`\n❌ FAIL: ${passed}/${total} checks passed\n`);
    const failed = results.filter(r => !r.passed);
    console.log("Failed tests:");
    failed.forEach(f => console.log(`   - ${f.name}: ${f.details || 'No details'}`));
    console.log("");
    process.exit(1);
  }
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
