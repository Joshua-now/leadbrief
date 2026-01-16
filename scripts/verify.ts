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
const DEBUG_KEY = process.env.DEBUG_KEY || '';

async function runTest(name: string, fn: () => Promise<{ passed: boolean; details?: string }>) {
  try {
    const result = await fn();
    results.push({ name, ...result });
    console.log(result.passed ? `   [PASS] ${name}` : `   [FAIL] ${name}${result.details ? ` - ${result.details}` : ''}`);
  } catch (error: any) {
    results.push({ name, passed: false, details: error.message });
    console.log(`   [FAIL] ${name} - ${error.message}`);
  }
}

async function curlJson(endpoint: string, method = 'GET', body?: any, headers?: Record<string, string>): Promise<{ status: number; data: any }> {
  let cmd = `curl -s -w '\\n%{http_code}' ${BASE_URL}${endpoint}`;
  
  if (method !== 'GET') {
    cmd = `curl -s -w '\\n%{http_code}' -X ${method} ${BASE_URL}${endpoint}`;
  }
  
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      cmd += ` -H "${k}: ${v}"`;
    }
  }
  
  if (body) {
    cmd += ` -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`;
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
  console.log("\n========================================");
  console.log(" LeadBrief API Verification");
  console.log("========================================");
  console.log(`Target: ${BASE_URL}\n`);

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
    return { passed: true, details: `v${data.version}, db=${data.db}, uptime=${data.processor?.healthy}` };
  });

  await runTest('Health includes DB smoke test result', async () => {
    const { data } = await curlJson('/api/health');
    if (typeof data.db !== 'boolean') {
      return { passed: false, details: 'Missing db field' };
    }
    if (typeof data.dbLatencyMs !== 'number') {
      return { passed: false, details: 'Missing dbLatencyMs field' };
    }
    return { passed: true, details: `db=${data.db}, latency=${data.dbLatencyMs}ms` };
  });

  await runTest('Health includes env presence flags', async () => {
    const { data } = await curlJson('/api/health');
    if (!data.env || typeof data.env !== 'object') {
      return { passed: false, details: 'Missing env object' };
    }
    return { passed: true, details: `keys=${Object.keys(data.env).length}` };
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

  // 5. Debug endpoint
  console.log("\n5. Debug Endpoint");
  await runTest('GET /api/debug/lastlog returns 501 without DEBUG_KEY env', async () => {
    const { status, data } = await curlJson('/api/debug/lastlog');
    // Without DEBUG_KEY header, should return 401 or 501
    if (status === 501 || status === 401) {
      return { passed: true, details: `Got ${status}` };
    }
    return { passed: false, details: `Expected 401/501, got ${status}` };
  });

  // 6. Intake endpoint with city field
  console.log("\n6. Intake Endpoint");
  const testEmail = `verify-${Date.now()}@test.example.com`;
  
  await runTest('POST /api/intake creates contact', async () => {
    const { status, data } = await curlJson('/api/intake', 'POST', {
      email: testEmail,
      firstName: 'Verify',
      lastName: 'Test',
      city: 'VerifyCity',
    });
    
    if (status === 200 && data.success && data.contactId) {
      return { passed: true, details: `Created ${data.contactId}` };
    }
    if (status === 401) {
      return { passed: true, details: 'API key required (OK)' };
    }
    return { passed: false, details: `Got ${status}: ${JSON.stringify(data)}` };
  });

  // Print summary
  console.log("\n========================================");
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  if (passed === total) {
    console.log(` PASS: ${passed}/${total} checks passed`);
    console.log("========================================\n");
    process.exit(0);
  } else {
    console.log(` FAIL: ${passed}/${total} checks passed`);
    console.log("========================================");
    const failed = results.filter(r => !r.passed);
    console.log("\nFailed tests:");
    failed.forEach(f => console.log(`   - ${f.name}: ${f.details || 'No details'}`));
    console.log("");
    process.exit(1);
  }
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
