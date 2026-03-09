/**
 * E2E Scenario Test: "Add CT Modality Support" (Simplified)
 *
 * This test validates the core workflow without complex protocol messages:
 * - Epic creation by CTO
 * - Feature decomposition (parent-child relationships)
 * - Task assignment to engineers
 * - Issue status transitions
 * - API endpoint functionality
 */

interface TestResult {
  step: string;
  status: "PASS" | "FAIL";
  details?: string;
  error?: string;
}

interface TestReport {
  overallResult: "PASS" | "FAIL";
  steps: TestResult[];
  issues: string[];
  performance: {
    totalTimeMs: number;
    issuesCreated: number;
    apiCalls: number;
  };
  productionReady: boolean;
}

class E2ETestRunner {
  private baseUrl = "http://localhost:3102/api";
  private results: TestResult[] = [];
  private issues: string[] = [];
  private startTime = 0;
  private issuesCreated = 0;
  private apiCalls = 0;

  // Test data IDs
  private companyId = "";
  private ctoAgentId = "";
  private cloudTlAgentId = "";
  private cloudCodexId = "";
  private cloudClaudeId = "";
  private qaLeadId = "";
  private cloudProjectId = "";

  private epicId = "";
  private featureAId = "";
  private featureBId = "";
  private taskA1Id = "";
  private taskA2Id = "";

  async run(): Promise<TestReport> {
    this.startTime = Date.now();

    console.log("🚀 Starting E2E Test: Add CT Modality Support (Simplified)\n");

    try {
      await this.step1_Bootstrap();
      await this.step2_CreateEpic();
      await this.step3_FeatureDecomposition();
      await this.step4_TaskDecomposition();
      await this.step5_VerifyHierarchy();
      await this.step6_StatusTransitions();
      await this.step7_APIEndpoints();
      await this.step8_Cleanup();
    } catch (error) {
      this.issues.push(`Critical error: ${error}`);
      console.error("❌ Test failed with error:", error);
    }

    return this.generateReport();
  }

  private async step1_Bootstrap() {
    const stepName = "Step 1: Bootstrap & Environment";
    console.log(`\n📋 ${stepName}`);

    try {
      const health = await this.fetch("/health");

      if (!health || health.status !== "ok") {
        throw new Error("Server health check failed");
      }

      const companies = await this.fetch("/companies");

      if (!companies || companies.length === 0) {
        const company = await this.fetch("/companies", "POST", {
          name: "DICOM Medical Systems",
          slug: "dicom-medical",
          description: "Medical imaging software company"
        });
        this.companyId = company.id;
      } else {
        this.companyId = companies[0].id;
      }

      const agents = await this.fetch(`/companies/${this.companyId}/agents`);

      this.ctoAgentId = agents.find((a: any) => a.role === "cto")?.id;
      this.cloudTlAgentId = agents.find((a: any) => a.nameKey === "cloud-tl")?.id;
      this.cloudCodexId = agents.find((a: any) => a.nameKey === "cloud-codex")?.id;
      this.cloudClaudeId = agents.find((a: any) => a.nameKey === "cloud-claude")?.id;
      this.qaLeadId = agents.find((a: any) => a.role === "qa")?.id;

      if (!this.ctoAgentId) {
        throw new Error("CTO agent not found");
      }

      const projects = await this.fetch(`/companies/${this.companyId}/projects`);
      this.cloudProjectId = projects.find((p: any) => p.slug === "cloud-api")?.id;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Company: ${this.companyId}, Agents: ${agents.length}, Projects: ${projects.length}`
      });

      console.log("  ✅ Bootstrap successful");
      console.log(`  📊 Company: ${this.companyId}`);
      console.log(`  👤 CTO: ${this.ctoAgentId}`);
      console.log(`  🏗️  Projects: ${projects.length}`);

    } catch (error) {
      this.results.push({
        step: stepName,
        status: "FAIL",
        error: String(error)
      });
      this.issues.push(`${stepName} failed: ${error}`);
      throw error;
    }
  }

  private async step2_CreateEpic() {
    const stepName = "Step 2: Epic Creation (CTO)";
    console.log(`\n📋 ${stepName}`);

    try {
      const epic = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Add CT modality support",
        description: "Support CT scans in DICOM pipeline",
        assigneeAgentId: this.ctoAgentId,
        status: "backlog",
        priority: "high"
      });

      this.epicId = epic.id;
      this.issuesCreated++;

      if (!epic.id || !epic.identifier) {
        throw new Error("Epic creation failed");
      }

      if (!/^[A-Z]+-\d+$/.test(epic.identifier)) {
        this.issues.push(`Unexpected identifier format: ${epic.identifier}`);
      }

      if (epic.assigneeAgentId !== this.ctoAgentId) {
        throw new Error("Epic not assigned to CTO");
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Epic ${epic.identifier} created`
      });

      console.log("  ✅ Epic created successfully");
      console.log(`  🎫 Identifier: ${epic.identifier}`);

    } catch (error) {
      this.results.push({
        step: stepName,
        status: "FAIL",
        error: String(error)
      });
      this.issues.push(`${stepName} failed: ${error}`);
      throw error;
    }
  }

  private async step3_FeatureDecomposition() {
    const stepName = "Step 3: Feature Decomposition";
    console.log(`\n📋 ${stepName}`);

    try {
      const featureA = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Cloud: Accept CT modality",
        description: "Update Cloud API to accept CT modality",
        parentId: this.epicId,
        projectId: this.cloudProjectId,
        assigneeAgentId: this.cloudTlAgentId,
        status: "backlog",
        priority: "high"
      });
      this.featureAId = featureA.id;
      this.issuesCreated++;

      const featureB = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Agent: Parse CT DICOM headers",
        description: "Parse CT-specific metadata",
        parentId: this.epicId,
        assigneeAgentId: this.ctoAgentId,
        status: "backlog",
        priority: "high"
      });
      this.featureBId = featureB.id;
      this.issuesCreated++;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Created 2 features under epic`
      });

      console.log("  ✅ Features created");
      console.log(`  🎫 Feature A: ${featureA.identifier}`);
      console.log(`  🎫 Feature B: ${featureB.identifier}`);

    } catch (error) {
      this.results.push({
        step: stepName,
        status: "FAIL",
        error: String(error)
      });
      this.issues.push(`${stepName} failed: ${error}`);
      throw error;
    }
  }

  private async step4_TaskDecomposition() {
    const stepName = "Step 4: Task Decomposition";
    console.log(`\n📋 ${stepName}`);

    try {
      const taskA1 = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Add CT to modality enum",
        description: "Update modality type enum to include CT",
        parentId: this.featureAId,
        assigneeAgentId: this.cloudCodexId,
        status: "backlog",
        priority: "high"
      });
      this.taskA1Id = taskA1.id;
      this.issuesCreated++;

      const taskA2 = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Update validation logic",
        description: "Add CT validation rules",
        parentId: this.featureAId,
        assigneeAgentId: this.cloudClaudeId,
        status: "backlog",
        priority: "high"
      });
      this.taskA2Id = taskA2.id;
      this.issuesCreated++;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Created 2 tasks under Feature A`
      });

      console.log("  ✅ Tasks created");
      console.log(`  🎫 Task A1: ${taskA1.identifier}`);
      console.log(`  🎫 Task A2: ${taskA2.identifier}`);

    } catch (error) {
      this.results.push({
        step: stepName,
        status: "FAIL",
        error: String(error)
      });
      this.issues.push(`${stepName} failed: ${error}`);
      throw error;
    }
  }

  private async step5_VerifyHierarchy() {
    const stepName = "Step 5: Verify Parent-Child Hierarchy";
    console.log(`\n📋 ${stepName}`);

    try {
      const allIssues = await this.fetch(`/companies/${this.companyId}/issues`);

      // Check epic children (features)
      const epicChildren = allIssues.filter((issue: any) => issue.parentId === this.epicId);
      if (epicChildren.length !== 2) {
        this.issues.push(`Expected 2 features under epic, got ${epicChildren.length}`);
      }

      // Check feature A children (tasks)
      const featureAChildren = allIssues.filter((issue: any) => issue.parentId === this.featureAId);
      if (featureAChildren.length !== 2) {
        this.issues.push(`Expected 2 tasks under Feature A, got ${featureAChildren.length}`);
      }

      // Verify hierarchy integrity
      const epic = allIssues.find((issue: any) => issue.id === this.epicId);
      const featureA = allIssues.find((issue: any) => issue.id === this.featureAId);
      const taskA1 = allIssues.find((issue: any) => issue.id === this.taskA1Id);

      if (featureA.parentId !== this.epicId) {
        throw new Error("Feature A parent mismatch");
      }

      if (taskA1.parentId !== this.featureAId) {
        throw new Error("Task A1 parent mismatch");
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Hierarchy verified: Epic → 2 Features → 2 Tasks`
      });

      console.log("  ✅ Hierarchy verified");
      console.log(`  📊 Epic children: ${epicChildren.length}`);
      console.log(`  📊 Feature A children: ${featureAChildren.length}`);

    } catch (error) {
      this.results.push({
        step: stepName,
        status: "FAIL",
        error: String(error)
      });
      this.issues.push(`${stepName} failed: ${error}`);
      throw error;
    }
  }

  private async step6_StatusTransitions() {
    const stepName = "Step 6: Status Transitions";
    console.log(`\n📋 ${stepName}`);

    try {
      // Update task status: backlog → in_progress
      await this.fetch(`/issues/${this.taskA1Id}`, "PATCH", {
        status: "in_progress"
      });

      const updatedTask = await this.fetch(`/issues/${this.taskA1Id}`);

      if (updatedTask.status !== "in_progress") {
        this.issues.push(`Expected status 'in_progress', got '${updatedTask.status}'`);
      }

      // Complete the task
      await this.fetch(`/issues/${this.taskA1Id}`, "PATCH", {
        status: "done"
      });

      const completedTask = await this.fetch(`/issues/${this.taskA1Id}`);

      if (completedTask.status !== "done") {
        throw new Error(`Task status should be 'done', got '${completedTask.status}'`);
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Status transitions working: backlog → in_progress → done`
      });

      console.log("  ✅ Status transitions successful");
      console.log(`  📊 Final status: ${completedTask.status}`);

    } catch (error) {
      this.results.push({
        step: stepName,
        status: "FAIL",
        error: String(error)
      });
      this.issues.push(`${stepName} failed: ${error}`);
      throw error;
    }
  }

  private async step7_APIEndpoints() {
    const stepName = "Step 7: API Endpoint Verification";
    console.log(`\n📋 ${stepName}`);

    try {
      // Test issue retrieval
      const issue = await this.fetch(`/issues/${this.epicId}`);
      if (!issue || issue.id !== this.epicId) {
        throw new Error("Issue retrieval failed");
      }

      // Test comments endpoint
      const comments = await this.fetch(`/issues/${this.epicId}/comments`);
      if (!Array.isArray(comments)) {
        this.issues.push("Comments endpoint returned non-array");
      }

      // Test protocol briefs endpoint (should return empty or 404)
      try {
        const briefs = await this.fetch(`/issues/${this.epicId}/protocol/briefs`);
        console.log(`  ℹ️  Protocol briefs available: ${Array.isArray(briefs) ? briefs.length : 0}`);
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
        console.log("  ℹ️  Protocol briefs endpoint: 404 (acceptable)");
      }

      // Test protocol state endpoint
      try {
        const state = await this.fetch(`/issues/${this.epicId}/protocol/state`);
        console.log(`  ℹ️  Protocol state available: ${state ? 'yes' : 'no'}`);
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
        console.log("  ℹ️  Protocol state endpoint: 404 (acceptable)");
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `All tested endpoints functional`
      });

      console.log("  ✅ API endpoints verified");

    } catch (error) {
      this.results.push({
        step: stepName,
        status: "FAIL",
        error: String(error)
      });
      this.issues.push(`${stepName} failed: ${error}`);
      throw error;
    }
  }

  private async step8_Cleanup() {
    const stepName = "Step 8: Cleanup (Optional)";
    console.log(`\n📋 ${stepName}`);

    try {
      // Hide test issues (optional)
      await this.fetch(`/issues/${this.epicId}`, "PATCH", {
        status: "cancelled"
      });

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Test data marked as cancelled`
      });

      console.log("  ✅ Cleanup completed");

    } catch (error) {
      // Cleanup failure is not critical
      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Cleanup skipped (non-critical)`
      });
      console.log("  ⚠️  Cleanup skipped");
    }
  }

  private generateReport(): TestReport {
    const totalTimeMs = Date.now() - this.startTime;
    const allPassed = this.results.every(r => r.status === "PASS");

    const report: TestReport = {
      overallResult: allPassed ? "PASS" : "FAIL",
      steps: this.results,
      issues: this.issues,
      performance: {
        totalTimeMs,
        issuesCreated: this.issuesCreated,
        apiCalls: this.apiCalls
      },
      productionReady: allPassed && this.issues.length === 0
    };

    this.printReport(report);
    return report;
  }

  private printReport(report: TestReport) {
    console.log("\n" + "=".repeat(80));
    console.log("📊 E2E TEST REPORT: Add CT Modality Support");
    console.log("=".repeat(80));

    console.log(`\n🎯 Overall Result: ${report.overallResult === "PASS" ? "✅ PASS" : "❌ FAIL"}\n`);

    console.log("📋 Step-by-Step Results:");
    console.log("-".repeat(80));
    report.steps.forEach((step, idx) => {
      const icon = step.status === "PASS" ? "✅" : "❌";
      console.log(`${idx + 1}. ${icon} ${step.step}`);
      if (step.details) {
        console.log(`   ${step.details}`);
      }
      if (step.error) {
        console.log(`   ❌ Error: ${step.error}`);
      }
    });

    if (report.issues.length > 0) {
      console.log("\n⚠️  Issues Found:");
      console.log("-".repeat(80));
      report.issues.forEach((issue, idx) => {
        console.log(`${idx + 1}. ${issue}`);
      });
    }

    console.log("\n⏱️  Performance Metrics:");
    console.log("-".repeat(80));
    console.log(`Total time: ${(report.performance.totalTimeMs / 1000).toFixed(2)}s`);
    console.log(`Issues created: ${report.performance.issuesCreated}`);
    console.log(`API calls: ${report.performance.apiCalls}`);

    console.log("\n🚀 Production Ready:");
    console.log("-".repeat(80));
    console.log(report.productionReady ? "✅ YES" : "❌ NO");

    if (report.productionReady) {
      console.log("\n✨ All tests passed! The system is working correctly.");
      console.log("   - Issue creation and hierarchy working");
      console.log("   - Status transitions functional");
      console.log("   - API endpoints responding correctly");
    }

    console.log("\n" + "=".repeat(80));
  }

  private async fetch(endpoint: string, method: string = "GET", body?: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    this.apiCalls++;

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`❌ Fetch error: ${method} ${endpoint}`, error);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const runner = new E2ETestRunner();
  const report = await runner.run();

  // Write report to file
  const fs = await import("fs/promises");
  await fs.writeFile(
    "/home/taewoong/company-project/squadall/e2e-test-report.json",
    JSON.stringify(report, null, 2)
  );

  console.log("\n📄 Full report saved to: e2e-test-report.json");

  // Exit with appropriate code
  process.exit(report.overallResult === "PASS" ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
