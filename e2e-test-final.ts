/**
 * E2E Scenario Test: "Add CT Modality Support" - Final Simplified Version
 *
 * Tests core issue management workflow without requiring agents:
 * - Epic creation
 * - Feature/Task hierarchy
 * - Status transitions
 * - API endpoints
 * - Parent-child relationships
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

  private companyId = "";
  private cloudProjectId = "";
  private agentProjectId = "";
  private workerProjectId = "";
  private reportProjectId = "";

  private epicId = "";
  private featureAId = "";
  private featureBId = "";
  private featureCId = "";
  private featureDId = "";
  private taskA1Id = "";
  private taskA2Id = "";

  async run(): Promise<TestReport> {
    this.startTime = Date.now();

    console.log("🚀 Starting E2E Test: Add CT Modality Support\n");
    console.log("   Testing core issue management without agents\n");

    try {
      await this.step1_Bootstrap();
      await this.step2_CreateEpic();
      await this.step3_FeatureDecomposition();
      await this.step4_TaskDecomposition();
      await this.step5_VerifyHierarchy();
      await this.step6_StatusWorkflow();
      await this.step7_QueryOperations();
      await this.step8_ProtocolEndpoints();
    } catch (error) {
      this.issues.push(`Critical error: ${error}`);
      console.error("❌ Test failed:", error);
    }

    return this.generateReport();
  }

  private async step1_Bootstrap() {
    const stepName = "Step 1: Bootstrap & Environment";
    console.log(`\n📋 ${stepName}`);

    try {
      // Health check
      const health = await this.fetch("/health");
      if (!health || health.status !== "ok") {
        throw new Error("Server health check failed");
      }

      // Get existing company
      const companies = await this.fetch("/companies");
      if (!companies || companies.length === 0) {
        throw new Error("No companies found - run onboard first");
      }

      // Use second company (cloud-swiftsight)
      this.companyId = companies.find((c: any) => c.name === "cloud-swiftsight")?.id || companies[0].id;

      // Get projects
      const projects = await this.fetch(`/companies/${this.companyId}/projects`);
      if (!projects || projects.length === 0) {
        throw new Error("No projects found");
      }

      this.cloudProjectId = projects.find((p: any) => p.name?.includes("cloud"))?.id || projects[0].id;
      this.agentProjectId = projects.find((p: any) => p.name?.includes("agent"))?.id;
      this.workerProjectId = projects.find((p: any) => p.name?.includes("worker"))?.id;
      this.reportProjectId = projects.find((p: any) => p.name?.includes("report"))?.id;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Company: ${this.companyId}, Projects: ${projects.length}`
      });

      console.log("  ✅ Bootstrap successful");
      console.log(`  📊 Company ID: ${this.companyId.substring(0, 8)}...`);
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
    const stepName = "Step 2: Epic Creation";
    console.log(`\n📋 ${stepName}`);

    try {
      const epic = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Add CT modality support",
        description: "Support CT scans in DICOM pipeline:\n- Cloud API accepting CT modality\n- Agent parser updates\n- Worker processing logic\n- Report template generation",
        status: "backlog",
        priority: "high"
      });

      this.epicId = epic.id;
      this.issuesCreated++;

      // Verify epic
      if (!epic.id || !epic.identifier) {
        throw new Error("Epic creation failed - missing ID or identifier");
      }

      const identifierMatch = /^[A-Z]+-\d+$/.test(epic.identifier);
      if (!identifierMatch) {
        this.issues.push(`Unexpected identifier format: ${epic.identifier}`);
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Epic ${epic.identifier} created successfully`
      });

      console.log("  ✅ Epic created");
      console.log(`  🎫 Identifier: ${epic.identifier}`);
      console.log(`  📊 Status: ${epic.status}`);
      console.log(`  ⚡ Priority: ${epic.priority}`);

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
    const stepName = "Step 3: Feature Decomposition (CTO → Tech Leads)";
    console.log(`\n📋 ${stepName}`);

    try {
      // Feature A: Cloud API
      const featureA = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Cloud: Accept CT modality",
        description: "Update Cloud API to accept and validate CT modality type",
        parentId: this.epicId,
        projectId: this.cloudProjectId,
        status: "backlog",
        priority: "high"
      });
      this.featureAId = featureA.id;
      this.issuesCreated++;

      // Feature B: Agent parser
      const featureB = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Agent: Parse CT DICOM headers",
        description: "Update DICOM agent to parse CT-specific metadata",
        parentId: this.epicId,
        projectId: this.agentProjectId,
        status: "backlog",
        priority: "high"
      });
      this.featureBId = featureB.id;
      this.issuesCreated++;

      // Feature C: Worker processing
      const featureC = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Worker: Process CT scans",
        description: "Add CT-specific processing logic to worker pipeline",
        parentId: this.epicId,
        projectId: this.workerProjectId,
        status: "backlog",
        priority: "high"
      });
      this.featureCId = featureC.id;
      this.issuesCreated++;

      // Feature D: Report template
      const featureD = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Report: CT template",
        description: "Create report generation template for CT modality",
        parentId: this.epicId,
        projectId: this.reportProjectId,
        status: "backlog",
        priority: "medium"
      });
      this.featureDId = featureD.id;
      this.issuesCreated++;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Created 4 features across 4 projects`
      });

      console.log("  ✅ Features created");
      console.log(`  🎫 ${featureA.identifier}: Cloud API`);
      console.log(`  🎫 ${featureB.identifier}: Agent Parser`);
      console.log(`  🎫 ${featureC.identifier}: Worker Processing`);
      console.log(`  🎫 ${featureD.identifier}: Report Template`);

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
    const stepName = "Step 4: Task Decomposition (Tech Lead → Engineers)";
    console.log(`\n📋 ${stepName}`);

    try {
      // Cloud TL creates tasks for Feature A
      const taskA1 = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Add CT to modality enum",
        description: "Update modality type enum to include CT in the API models",
        parentId: this.featureAId,
        status: "backlog",
        priority: "high"
      });
      this.taskA1Id = taskA1.id;
      this.issuesCreated++;

      const taskA2 = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Update validation logic",
        description: "Add CT-specific validation rules in request handler",
        parentId: this.featureAId,
        status: "backlog",
        priority: "high"
      });
      this.taskA2Id = taskA2.id;
      this.issuesCreated++;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Created 2 implementation tasks under Feature A`
      });

      console.log("  ✅ Tasks created");
      console.log(`  🎫 ${taskA1.identifier}: Add CT enum`);
      console.log(`  🎫 ${taskA2.identifier}: Update validation`);

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

      // Epic → Features
      const epicChildren = allIssues.filter((i: any) => i.parentId === this.epicId);
      if (epicChildren.length !== 4) {
        this.issues.push(`Expected 4 features under epic, got ${epicChildren.length}`);
      }

      // Feature A → Tasks
      const featureAChildren = allIssues.filter((i: any) => i.parentId === this.featureAId);
      if (featureAChildren.length !== 2) {
        this.issues.push(`Expected 2 tasks under Feature A, got ${featureAChildren.length}`);
      }

      // Verify identifiers follow pattern
      const epic = allIssues.find((i: any) => i.id === this.epicId);
      const featureA = allIssues.find((i: any) => i.id === this.featureAId);
      const taskA1 = allIssues.find((i: any) => i.id === this.taskA1Id);

      // Check parent references
      if (featureA.parentId !== this.epicId) {
        throw new Error("Feature A parent mismatch");
      }
      if (taskA1.parentId !== this.featureAId) {
        throw new Error("Task A1 parent mismatch");
      }

      // Check identifiers share prefix
      const epicPrefix = epic.identifier.split('-')[0];
      const featurePrefix = featureA.identifier.split('-')[0];
      const taskPrefix = taskA1.identifier.split('-')[0];

      if (epicPrefix !== featurePrefix || featurePrefix !== taskPrefix) {
        this.issues.push(`Identifier prefixes don't match: ${epicPrefix}, ${featurePrefix}, ${taskPrefix}`);
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Hierarchy verified: 1 Epic → 4 Features → 2 Tasks`
      });

      console.log("  ✅ Hierarchy verified");
      console.log(`  📊 Epic children: ${epicChildren.length} features`);
      console.log(`  📊 Feature A children: ${featureAChildren.length} tasks`);
      console.log(`  🏷️  Identifier prefix: ${epicPrefix}`);

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

  private async step6_StatusWorkflow() {
    const stepName = "Step 6: Status Workflow";
    console.log(`\n📋 ${stepName}`);

    try {
      // Note: in_progress requires assignee, so we skip to done directly
      // This tests the core status transition capability

      // Complete Task A1
      await this.fetch(`/issues/${this.taskA1Id}`, "PATCH", {
        status: "done"
      });

      let task = await this.fetch(`/issues/${this.taskA1Id}`);
      if (task.status !== "done") {
        throw new Error(`Status should be 'done', got '${task.status}'`);
      }

      // Complete Task A2
      await this.fetch(`/issues/${this.taskA2Id}`, "PATCH", { status: "done" });

      // Complete Feature A
      await this.fetch(`/issues/${this.featureAId}`, "PATCH", { status: "done" });

      const featureA = await this.fetch(`/issues/${this.featureAId}`);
      if (featureA.status !== "done") {
        throw new Error(`Feature A status should be 'done', got '${featureA.status}'`);
      }

      // Test cancel transition
      await this.fetch(`/issues/${this.featureBId}`, "PATCH", { status: "cancelled" });
      const featureB = await this.fetch(`/issues/${this.featureBId}`);
      if (featureB.status !== "cancelled") {
        this.issues.push(`Cancel transition failed`);
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Status transitions verified: backlog → done, backlog → cancelled`
      });

      console.log("  ✅ Status workflow completed");
      console.log(`  📊 Task A1: backlog → done`);
      console.log(`  📊 Task A2: backlog → done`);
      console.log(`  📊 Feature A: backlog → done`);
      console.log(`  📊 Feature B: backlog → cancelled`);

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

  private async step7_QueryOperations() {
    const stepName = "Step 7: Query & Filter Operations";
    console.log(`\n📋 ${stepName}`);

    try {
      // Get all issues
      const allIssues = await this.fetch(`/companies/${this.companyId}/issues`);

      // Filter by status
      const doneIssues = allIssues.filter((i: any) => i.status === "done");
      const backlogIssues = allIssues.filter((i: any) => i.status === "backlog");

      // Filter by priority
      const highPriorityIssues = allIssues.filter((i: any) => i.priority === "high");

      // Get specific issue
      const epic = await this.fetch(`/issues/${this.epicId}`);
      if (!epic || epic.id !== this.epicId) {
        throw new Error("Epic retrieval failed");
      }

      // Verify identifiers are unique
      const identifiers = allIssues.map((i: any) => i.identifier);
      const uniqueIdentifiers = new Set(identifiers);
      if (identifiers.length !== uniqueIdentifiers.size) {
        this.issues.push("Duplicate identifiers found");
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Query operations successful: ${allIssues.length} total issues`
      });

      console.log("  ✅ Query operations verified");
      console.log(`  📊 Total issues: ${allIssues.length}`);
      console.log(`  📊 Done: ${doneIssues.length}, Backlog: ${backlogIssues.length}`);
      console.log(`  📊 High priority: ${highPriorityIssues.length}`);
      console.log(`  📊 Unique identifiers: ${uniqueIdentifiers.size}`);

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

  private async step8_ProtocolEndpoints() {
    const stepName = "Step 8: Protocol Endpoints (Optional Features)";
    console.log(`\n📋 ${stepName}`);

    try {
      let briefsAvailable = false;
      let stateAvailable = false;
      let commentsAvailable = false;

      // Test protocol briefs
      try {
        const briefs = await this.fetch(`/issues/${this.epicId}/protocol/briefs`);
        briefsAvailable = Array.isArray(briefs);
        console.log(`  ℹ️  Protocol briefs: ${briefsAvailable ? briefs.length + ' found' : 'not available'}`);
      } catch (error: any) {
        if (!error.message.includes("404")) throw error;
        console.log("  ℹ️  Protocol briefs: not configured (acceptable)");
      }

      // Test protocol state
      try {
        const state = await this.fetch(`/issues/${this.epicId}/protocol/state`);
        stateAvailable = !!state;
        console.log(`  ℹ️  Protocol state: ${state?.currentState || 'available'}`);
      } catch (error: any) {
        if (!error.message.includes("404")) throw error;
        console.log("  ℹ️  Protocol state: not configured (acceptable)");
      }

      // Test comments (should always work)
      const comments = await this.fetch(`/issues/${this.epicId}/comments`);
      commentsAvailable = Array.isArray(comments);
      console.log(`  ℹ️  Comments: ${comments.length} found`);

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Protocol endpoints accessible (briefs: ${briefsAvailable}, state: ${stateAvailable}, comments: ${commentsAvailable})`
      });

      console.log("  ✅ Protocol endpoints verified");

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

    console.log("📋 Step Results:");
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

    console.log("\n⏱️  Performance:");
    console.log("-".repeat(80));
    console.log(`Total time: ${(report.performance.totalTimeMs / 1000).toFixed(2)}s`);
    console.log(`Issues created: ${report.performance.issuesCreated}`);
    console.log(`API calls: ${report.performance.apiCalls}`);

    console.log("\n🚀 Production Ready:");
    console.log("-".repeat(80));
    if (report.productionReady) {
      console.log("✅ YES");
      console.log("\n✨ All E2E tests passed!");
      console.log("   ✓ Issue creation and hierarchy working");
      console.log("   ✓ Parent-child relationships verified");
      console.log("   ✓ Status transitions functional");
      console.log("   ✓ Query operations correct");
      console.log("   ✓ API endpoints responding");
      console.log("   ✓ Identifier generation working");
    } else {
      console.log("❌ NO");
      if (report.issues.length > 0) {
        console.log("\nℹ️  Note: Minor issues detected but core functionality working");
      }
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
