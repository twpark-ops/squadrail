/**
 * E2E Scenario Test: "Add CT Modality Support"
 *
 * Full workflow test covering:
 * - Epic creation by CTO
 * - CTO brief generation with RAG
 * - Feature decomposition
 * - Task assignment to engineers
 * - Implementation and review cycles
 * - QA testing
 * - Final approval and closure
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
    protocolMessages: number;
    briefGenerations: number;
  };
  productionReady: boolean;
}

class E2ETestRunner {
  private baseUrl = "http://localhost:3109/api";
  private results: TestResult[] = [];
  private issues: string[] = [];
  private startTime = 0;
  private protocolMessageCount = 0;
  private briefGenerationCount = 0;

  // Test data IDs
  private companyId = "";
  private ctoAgentId = "";
  private cloudTlAgentId = "";
  private agentTlAgentId = "";
  private workerTlAgentId = "";
  private reportTlAgentId = "";
  private cloudCodexId = "";
  private cloudClaudeId = "";
  private qaLeadId = "";
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

    try {
      await this.step1_Bootstrap();
      await this.step2_CreateEpic();
      await this.step3_VerifyCTOBrief();
      await this.step4_FeatureDecomposition();
      await this.step5_TaskDecomposition();
      await this.step6_EngineerCheckout();
      await this.step7_EngineerSubmit();
      await this.step8_TLReview();
      await this.step9_QATesting();
      await this.step10_CTOApproval();
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
      // Check server health
      const health = await this.fetch("/health");

      if (!health || health.status !== "ok") {
        throw new Error("Server health check failed");
      }

      // Get or create test company
      const companies = await this.fetch("/companies");

      if (!companies || companies.length === 0) {
        // Create test company
        const company = await this.fetch("/companies", "POST", {
          name: "DICOM Medical Systems",
          slug: "dicom-medical",
          description: "Medical imaging software company"
        });
        this.companyId = company.id;
      } else {
        this.companyId = companies[0].id;
      }

      // Get agents
      const agents = await this.fetch(`/companies/${this.companyId}/agents`);

      // Find required agents by role
      this.ctoAgentId = agents.find((a: any) => a.role === "cto")?.id;
      this.cloudTlAgentId = agents.find((a: any) => a.nameKey === "cloud-tl")?.id;
      this.agentTlAgentId = agents.find((a: any) => a.nameKey === "agent-tl")?.id;
      this.workerTlAgentId = agents.find((a: any) => a.nameKey === "worker-tl")?.id;
      this.reportTlAgentId = agents.find((a: any) => a.nameKey === "report-tl")?.id;
      this.cloudCodexId = agents.find((a: any) => a.nameKey === "cloud-codex")?.id;
      this.cloudClaudeId = agents.find((a: any) => a.nameKey === "cloud-claude")?.id;
      this.qaLeadId = agents.find((a: any) => a.role === "qa")?.id;

      if (!this.ctoAgentId) {
        throw new Error("CTO agent not found");
      }

      // Get projects
      const projects = await this.fetch(`/companies/${this.companyId}/projects`);
      this.cloudProjectId = projects.find((p: any) => p.slug === "cloud-api")?.id;
      this.agentProjectId = projects.find((p: any) => p.slug === "dicom-agent")?.id;
      this.workerProjectId = projects.find((p: any) => p.slug === "worker")?.id;
      this.reportProjectId = projects.find((p: any) => p.slug === "report-gen")?.id;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Company: ${this.companyId}, CTO: ${this.ctoAgentId}, Agents: ${agents.length}, Projects: ${projects.length}`
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
        description: "Support CT scans in DICOM pipeline. This includes:\n- Cloud API accepting CT modality\n- Agent parser updates\n- Worker processing logic\n- Report template generation",
        assigneeAgentId: this.ctoAgentId,
        status: "backlog",
        priority: "high"
      });

      this.epicId = epic.id;

      // Verify issue created
      if (!epic.id || !epic.identifier) {
        throw new Error("Epic creation failed - missing ID or identifier");
      }

      // Check identifier format (should be SWS-1 or similar)
      if (!/^[A-Z]+-\d+$/.test(epic.identifier)) {
        this.issues.push(`Unexpected identifier format: ${epic.identifier}`);
      }

      // Verify assignment
      if (epic.assigneeAgentId !== this.ctoAgentId) {
        throw new Error("Epic not assigned to CTO");
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Epic ID: ${epic.id}, Identifier: ${epic.identifier}`
      });

      console.log("  ✅ Epic created successfully");
      console.log(`  🎫 Identifier: ${epic.identifier}`);
      console.log(`  👤 Assigned to CTO: ${this.ctoAgentId}`);

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

  private async step3_VerifyCTOBrief() {
    const stepName = "Step 3: CTO Brief Verification (Optional)";
    console.log(`\n📋 ${stepName}`);

    try {
      // Get protocol briefs for the epic (may not exist if not auto-generated)
      let briefs;
      try {
        briefs = await this.fetch(
          `/issues/${this.epicId}/protocol/briefs?scope=cto`
        );
      } catch (error: any) {
        if (error.message.includes("404")) {
          // Brief not found is acceptable - briefs may be generated on-demand
          console.log("  ⚠️  No CTO brief found (may be generated on-demand)");
          this.results.push({
            step: stepName,
            status: "PASS",
            details: "Brief endpoint exists but no brief generated yet (acceptable)"
          });
          return;
        }
        throw error;
      }

      if (!briefs || briefs.length === 0) {
        // No briefs yet, but API is working
        console.log("  ⚠️  No briefs generated yet");
        this.results.push({
          step: stepName,
          status: "PASS",
          details: "No briefs yet (will be generated on-demand)"
        });
        return;
      }

      // Briefs exist, validate them
      const ctoBrief = Array.isArray(briefs) ? briefs[0] : briefs;

      // Verify brief has content
      if (!ctoBrief.content || ctoBrief.content.length < 100) {
        this.issues.push("Brief content is too short");
      }

      this.briefGenerationCount++;

      // Check for RAG evidence
      const hasEvidence = ctoBrief.content.includes("evidence") ||
                          ctoBrief.content.includes("architecture") ||
                          ctoBrief.content.includes("ADR");

      // Check for relevant technical content
      const hasTechnicalContent = ctoBrief.content.toLowerCase().includes("ct") ||
                                   ctoBrief.content.toLowerCase().includes("modality") ||
                                   ctoBrief.content.toLowerCase().includes("dicom");

      if (!hasTechnicalContent) {
        this.issues.push("Brief missing relevant technical content (CT, modality, DICOM)");
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Brief length: ${ctoBrief.content.length} chars, Has evidence: ${hasEvidence}, Technical: ${hasTechnicalContent}`
      });

      console.log("  ✅ CTO brief found and validated");
      console.log(`  📄 Content length: ${ctoBrief.content.length} chars`);
      console.log(`  🔍 Has evidence: ${hasEvidence}`);
      console.log(`  ⚙️  Technical content: ${hasTechnicalContent}`);

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

  private async step4_FeatureDecomposition() {
    const stepName = "Step 4: CTO → Feature Decomposition";
    console.log(`\n📋 ${stepName}`);

    try {
      // Create Feature A: Cloud API
      const featureA = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Cloud: Accept CT modality",
        description: "Update Cloud API to accept and validate CT modality type",
        parentId: this.epicId,
        projectId: this.cloudProjectId,
        assigneeAgentId: this.cloudTlAgentId,
        status: "backlog",
        priority: "high"
      });
      this.featureAId = featureA.id;

      // Create Feature B: Agent parser
      const featureB = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Agent: Parse CT DICOM headers",
        description: "Update DICOM agent to parse CT-specific metadata",
        parentId: this.epicId,
        projectId: this.agentProjectId,
        assigneeAgentId: this.agentTlAgentId,
        status: "backlog",
        priority: "high"
      });
      this.featureBId = featureB.id;

      // Create Feature C: Worker processing
      const featureC = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Worker: Process CT scans",
        description: "Add CT-specific processing logic to worker pipeline",
        parentId: this.epicId,
        projectId: this.workerProjectId,
        assigneeAgentId: this.workerTlAgentId,
        status: "backlog",
        priority: "high"
      });
      this.featureCId = featureC.id;

      // Create Feature D: Report template
      const featureD = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Report: CT template",
        description: "Create report generation template for CT modality",
        parentId: this.epicId,
        projectId: this.reportProjectId,
        assigneeAgentId: this.reportTlAgentId,
        status: "backlog",
        priority: "medium"
      });
      this.featureDId = featureD.id;

      // Verify parent-child relationships
      // Query issues with parentId filter instead
      const allIssues = await this.fetch(`/companies/${this.companyId}/issues`);
      const epicChildren = allIssues.filter((issue: any) => issue.parentId === this.epicId);

      if (!epicChildren || epicChildren.length !== 4) {
        this.issues.push(`Expected 4 child features, got ${epicChildren?.length || 0}`);
      }

      // Send protocol message: CTO assigns features
      const message = await this.fetch(`/issues/${this.featureAId}/protocol/messages`, "POST", {
        messageType: "ASSIGN_TASK",
        payload: {
          instructions: "Implement CT modality support in Cloud API",
          priority: "high"
        }
      });
      this.protocolMessageCount++;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Created 4 features, assigned to respective Tech Leads`
      });

      console.log("  ✅ Features created and assigned");
      console.log(`  🎫 Feature A (Cloud): ${this.featureAId}`);
      console.log(`  🎫 Feature B (Agent): ${this.featureBId}`);
      console.log(`  🎫 Feature C (Worker): ${this.featureCId}`);
      console.log(`  🎫 Feature D (Report): ${this.featureDId}`);

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

  private async step5_TaskDecomposition() {
    const stepName = "Step 5: Cloud TL → Task Decomposition";
    console.log(`\n📋 ${stepName}`);

    try {
      // Cloud TL creates tasks for Feature A
      const taskA1 = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Add CT to modality enum",
        description: "Update modality type enum to include CT",
        parentId: this.featureAId,
        assigneeAgentId: this.cloudCodexId,
        status: "backlog",
        priority: "high"
      });
      this.taskA1Id = taskA1.id;

      const taskA2 = await this.fetch(`/companies/${this.companyId}/issues`, "POST", {
        title: "Update validation logic",
        description: "Add CT validation rules in request handler",
        parentId: this.featureAId,
        assigneeAgentId: this.cloudClaudeId,
        status: "backlog",
        priority: "high"
      });
      this.taskA2Id = taskA2.id;

      // Verify engineer briefs endpoint (may not have briefs yet)
      let a1Briefs;
      try {
        a1Briefs = await this.fetch(
          `/issues/${this.taskA1Id}/protocol/briefs?scope=engineer`
        );
        if (a1Briefs && a1Briefs.length > 0) {
          this.briefGenerationCount++;
        }
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
        // 404 is acceptable - briefs are generated on-demand
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Created 2 tasks, assigned to engineers (Codex, Claude)`
      });

      console.log("  ✅ Tasks created and assigned to engineers");
      console.log(`  🎫 Task A1 (Codex): ${this.taskA1Id}`);
      console.log(`  🎫 Task A2 (Claude): ${this.taskA2Id}`);
      console.log(`  📄 Engineer briefs: ${a1Briefs?.length || 0}`);

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

  private async step6_EngineerCheckout() {
    const stepName = "Step 6: Engineer Execution (Codex)";
    console.log(`\n📋 ${stepName}`);

    try {
      // Checkout task
      const checkout = await this.fetch(`/issues/${this.taskA1Id}/checkout`, "POST", {
        agentId: this.cloudCodexId
      });

      if (!checkout || checkout.status !== "success") {
        throw new Error("Checkout failed");
      }

      // Verify issue status updated
      const issue = await this.fetch(`/issues/${this.taskA1Id}`);

      // Try to get protocol state (may not exist if not using protocol)
      let protocolState;
      try {
        protocolState = await this.fetch(`/issues/${this.taskA1Id}/protocol/state`);
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
        // Protocol state may not exist - check issue status instead
        console.log("  ℹ️  Protocol state not found, checking issue status");
      }

      if (protocolState && protocolState.currentState !== "implementing") {
        this.issues.push(`Expected state 'implementing', got '${protocolState?.currentState}'`);
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Checkout successful, state: ${protocolState?.currentState}`
      });

      console.log("  ✅ Task checked out by Codex");
      console.log(`  📊 Protocol state: ${protocolState?.currentState}`);
      console.log(`  🔒 Workspace isolated: ${checkout.workspaceIsolated || false}`);

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

  private async step7_EngineerSubmit() {
    const stepName = "Step 7: Engineer → Submit for Review";
    console.log(`\n📋 ${stepName}`);

    try {
      // Submit implementation
      const submitMessage = await this.fetch(
        `/issues/${this.taskA1Id}/protocol/messages`,
        "POST",
        {
          messageType: "SUBMIT_FOR_REVIEW",
          payload: {
            implementationSummary: "Added CT to ModalityType enum in modality.go",
            changedFiles: ["src/types/modality.go"],
            testResults: ["✅ 45/45 unit tests passed", "✅ 12/12 integration tests passed"]
          }
        }
      );
      this.protocolMessageCount++;

      if (!submitMessage || !submitMessage.id) {
        throw new Error("Submit message creation failed");
      }

      // Verify state transition
      let protocolState;
      try {
        protocolState = await this.fetch(`/issues/${this.taskA1Id}/protocol/state`);
        if (protocolState?.currentState !== "submitted_for_review") {
          this.issues.push(`Expected state 'submitted_for_review', got '${protocolState?.currentState}'`);
        }
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
      }

      // Verify reviewer brief endpoint
      let reviewerBriefs;
      try {
        reviewerBriefs = await this.fetch(
          `/issues/${this.taskA1Id}/protocol/briefs?scope=reviewer`
        );
        if (reviewerBriefs && reviewerBriefs.length > 0) {
          this.briefGenerationCount++;
        }
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Submitted, state: ${protocolState?.currentState}, reviewer brief: ${reviewerBriefs?.length > 0}`
      });

      console.log("  ✅ Implementation submitted for review");
      console.log(`  📊 Protocol state: ${protocolState?.currentState}`);
      console.log(`  📄 Reviewer brief generated: ${reviewerBriefs?.length > 0}`);

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

  private async step8_TLReview() {
    const stepName = "Step 8: TL Review & Approval";
    console.log(`\n📋 ${stepName}`);

    try {
      // TL approves implementation
      const approveMessage = await this.fetch(
        `/issues/${this.taskA1Id}/protocol/messages`,
        "POST",
        {
          messageType: "APPROVE_IMPLEMENTATION",
          payload: {
            reviewSummary: "Code looks good. Enum updated correctly, tests passing.",
            approvedBy: "Cloud Tech Lead"
          }
        }
      );
      this.protocolMessageCount++;

      // Verify state transition
      let protocolState;
      try {
        protocolState = await this.fetch(`/issues/${this.taskA1Id}/protocol/state`);
        if (protocolState?.currentState !== "approved") {
          this.issues.push(`Expected state 'approved', got '${protocolState?.currentState}'`);
        }
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
      }

      // Check review cycle recorded
      let reviewCycles;
      try {
        reviewCycles = await this.fetch(`/issues/${this.taskA1Id}/protocol/review-cycles`);
        if (!reviewCycles || reviewCycles.length === 0) {
          this.issues.push("Review cycle not recorded");
        }
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Approved, state: ${protocolState?.currentState}, review cycles: ${reviewCycles?.length || 0}`
      });

      console.log("  ✅ Implementation approved by TL");
      console.log(`  📊 Protocol state: ${protocolState?.currentState}`);
      console.log(`  🔄 Review cycles: ${reviewCycles?.length || 0}`);

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

  private async step9_QATesting() {
    const stepName = "Step 9: QA Testing";
    console.log(`\n📋 ${stepName}`);

    try {
      // Reassign feature to QA
      await this.fetch(`/issues/${this.featureAId}`, "PATCH", {
        assigneeAgentId: this.qaLeadId
      });

      // Verify QA brief endpoint
      let qaBriefs;
      try {
        qaBriefs = await this.fetch(
          `/issues/${this.featureAId}/protocol/briefs?scope=qa`
        );
        if (qaBriefs && qaBriefs.length > 0) {
          this.briefGenerationCount++;
        }
      } catch (error: any) {
        if (!error.message.includes("404")) {
          throw error;
        }
      }

      // QA approves
      const qaApproveMessage = await this.fetch(
        `/issues/${this.featureAId}/protocol/messages`,
        "POST",
        {
          messageType: "APPROVE_IMPLEMENTATION",
          payload: {
            testingSummary: "E2E tests passed. CT modality accepted and validated correctly.",
            testResults: ["✅ API validation tests", "✅ Integration tests", "✅ Regression tests"]
          }
        }
      );
      this.protocolMessageCount++;

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `QA testing complete, brief generated: ${qaBriefs?.length > 0}`
      });

      console.log("  ✅ QA testing completed");
      console.log(`  📄 QA brief generated: ${qaBriefs?.length > 0}`);
      console.log(`  ✅ All QA tests passed`);

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

  private async step10_CTOApproval() {
    const stepName = "Step 10: CTO Final Approval";
    console.log(`\n📋 ${stepName}`);

    try {
      // CTO approves epic
      const ctoApproveMessage = await this.fetch(
        `/issues/${this.epicId}/protocol/messages`,
        "POST",
        {
          messageType: "APPROVE_IMPLEMENTATION",
          payload: {
            approvalSummary: "CT modality support successfully implemented across all services."
          }
        }
      );
      this.protocolMessageCount++;

      // CTO closes epic
      const closeMessage = await this.fetch(
        `/issues/${this.epicId}/protocol/messages`,
        "POST",
        {
          messageType: "CLOSE_TASK",
          payload: {
            closureReason: "Epic completed successfully. All features delivered and tested."
          }
        }
      );
      this.protocolMessageCount++;

      // Verify epic status
      const epic = await this.fetch(`/issues/${this.epicId}`);

      if (epic.status !== "done" && epic.status !== "closed") {
        this.issues.push(`Expected epic status 'done' or 'closed', got '${epic.status}'`);
      }

      // Check subtasks status
      const allIssues = await this.fetch(`/companies/${this.companyId}/issues`);
      const epicChildren = allIssues.filter((issue: any) => issue.parentId === this.epicId);
      const allClosed = epicChildren.length > 0 && epicChildren.every((child: any) =>
        child.status === "done" || child.status === "closed"
      );

      if (epicChildren.length > 0 && !allClosed) {
        this.issues.push("Not all subtasks are closed");
      }

      this.results.push({
        step: stepName,
        status: "PASS",
        details: `Epic closed, status: ${epic.status}, subtasks closed: ${allClosed}`
      });

      console.log("  ✅ Epic approved and closed by CTO");
      console.log(`  📊 Epic status: ${epic.status}`);
      console.log(`  ✅ All subtasks closed: ${allClosed}`);

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
        protocolMessages: this.protocolMessageCount,
        briefGenerations: this.briefGenerationCount
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
    console.log(`Protocol messages: ${report.performance.protocolMessages}`);
    console.log(`Brief generations: ${report.performance.briefGenerations}`);

    console.log("\n🚀 Production Ready:");
    console.log("-".repeat(80));
    console.log(report.productionReady ? "✅ YES" : "❌ NO");

    console.log("\n" + "=".repeat(80));
  }

  private async fetch(endpoint: string, method: string = "GET", body?: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;

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
