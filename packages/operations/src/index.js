import {
  PERMISSIONS,
  assertFourEyes,
  assertMoney,
  buildAuditEvent
} from "../../domain-contracts/src/index.js";

export function createOperationsService({
  identity,
  accountingService,
  budgets = createMutableSyntheticBudgets(),
  procurements = [],
  expenses = [],
  assets = [],
  milestones = [],
  fundReleases = [],
  projectUpdates = [],
  auditEvents = []
}) {
  return {
    listBudgets,
    createBudgetRevision,
    approveBudgetRevision,
    createProcurementRequest,
    approveProcurementRequest,
    createExpenseClaim,
    approveExpenseClaim,
    registerAsset,
    getBudgetVariance,
    createMilestonePlan,
    submitMilestoneEvidence,
    verifyMilestone,
    requestFundRelease,
    approveFundReleaseFinance,
    approveFundReleaseCompliance,
    releaseFunds,
    publishProjectUpdate,
    getProjectTimeline,
    getProjectHealth,
    listMilestoneAlerts,
    getAuditEvents: () => auditEvents.slice()
  };

  function listBudgets({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.budgetManage, organizationId, projectId });
    return budgets
      .filter((budget) => budget.organizationId === organizationId && budget.projectId === projectId)
      .map(cloneBudget);
  }

  function createBudgetRevision({ principal, organizationId, projectId, budgetCode, category, amount, currency = "BDT", reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.budgetManage, organizationId, projectId });
    const money = assertMoney(amount, currency);
    const previous = findLatestBudget({ organizationId, projectId, budgetCode });
    const budget = {
      budgetId: `budget_${budgets.length + 1}`,
      organizationId,
      projectId,
      budgetCode,
      category,
      revision: previous ? previous.revision + 1 : 1,
      amount: money.amount,
      currency: money.currency,
      status: "Draft",
      reason,
      createdByUserId: principal.user.userId,
      approvedByUserId: null
    };
    budgets.push(budget);
    audit({ principal, organizationId, projectId, action: "operations.budget.create_revision", entityType: "Budget", entityId: budget.budgetId, correlationId });
    return cloneBudget(budget);
  }

  function approveBudgetRevision({ principal, organizationId, projectId, budgetId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.budgetApprove, organizationId, projectId });
    const budget = findBudgetOrThrow({ organizationId, projectId, budgetId });
    assertFourEyes({
      creatorUserId: budget.createdByUserId,
      approverUserId: principal.user.userId,
      action: "Budget approval"
    });
    budget.status = "Approved";
    budget.approvedByUserId = principal.user.userId;
    retireOlderApprovedBudgets(budget);
    audit({ principal, organizationId, projectId, action: "operations.budget.approve_revision", entityType: "Budget", entityId: budget.budgetId, correlationId });
    return cloneBudget(budget);
  }

  function createProcurementRequest({ principal, organizationId, projectId, budgetCode, vendorName, amount, currency = "BDT", description, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.procurementCreate, organizationId, projectId });
    const money = assertMoney(amount, currency);
    assertBudgetAvailable({ organizationId, projectId, budgetCode, amount: money.amount, currency: money.currency });
    const procurement = {
      procurementId: `procurement_${procurements.length + 1}`,
      organizationId,
      projectId,
      budgetCode,
      vendorName,
      amount: money.amount,
      currency: money.currency,
      description,
      status: "Requested",
      requestedByUserId: principal.user.userId,
      approvedByUserId: null
    };
    procurements.push(procurement);
    audit({ principal, organizationId, projectId, action: "operations.procurement.request", entityType: "ProcurementRequest", entityId: procurement.procurementId, correlationId });
    return clone(procurement);
  }

  function approveProcurementRequest({ principal, organizationId, projectId, procurementId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.procurementApprove, organizationId, projectId });
    const procurement = findProcurementOrThrow({ organizationId, projectId, procurementId });
    assertFourEyes({
      creatorUserId: procurement.requestedByUserId,
      approverUserId: principal.user.userId,
      action: "Procurement approval"
    });
    assertBudgetAvailable({
      organizationId,
      projectId,
      budgetCode: procurement.budgetCode,
      amount: procurement.amount,
      currency: procurement.currency,
      excludeProcurementId: procurement.procurementId
    });
    procurement.status = "Approved";
    procurement.approvedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId, action: "operations.procurement.approve", entityType: "ProcurementRequest", entityId: procurement.procurementId, correlationId });
    return clone(procurement);
  }

  function createExpenseClaim({ principal, organizationId, projectId, budgetCode, procurementId, amount, currency = "BDT", invoiceRef, description, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.expenseCreate, organizationId, projectId });
    const money = assertMoney(amount, currency);
    if (procurementId) {
      const procurement = findProcurementOrThrow({ organizationId, projectId, procurementId });
      if (procurement.status !== "Approved") {
        throw Object.assign(new Error("Expense-linked procurement must be approved."), {
          status: 409,
          code: "procurement_not_approved"
        });
      }
      if (Number(money.amount) > Number(procurement.amount)) {
        throw Object.assign(new Error("Expense amount cannot exceed approved procurement."), {
          status: 409,
          code: "expense_exceeds_procurement"
        });
      }
    }
    assertBudgetAvailable({ organizationId, projectId, budgetCode, amount: money.amount, currency: money.currency });
    const expense = {
      expenseId: `expense_${expenses.length + 1}`,
      organizationId,
      projectId,
      budgetCode,
      procurementId: procurementId ?? null,
      amount: money.amount,
      currency: money.currency,
      invoiceRef,
      description,
      status: "Submitted",
      submittedByUserId: principal.user.userId,
      approvedByUserId: null
    };
    expenses.push(expense);
    audit({ principal, organizationId, projectId, action: "operations.expense.submit", entityType: "ExpenseClaim", entityId: expense.expenseId, correlationId });
    return clone(expense);
  }

  function approveExpenseClaim({ principal, organizationId, projectId, expenseId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.expenseApprove, organizationId, projectId });
    const expense = findExpenseOrThrow({ organizationId, projectId, expenseId });
    assertFourEyes({
      creatorUserId: expense.submittedByUserId,
      approverUserId: principal.user.userId,
      action: "Expense approval"
    });
    assertBudgetAvailable({
      organizationId,
      projectId,
      budgetCode: expense.budgetCode,
      amount: expense.amount,
      currency: expense.currency,
      excludeExpenseId: expense.expenseId
    });
    expense.status = "Approved";
    expense.approvedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId, action: "operations.expense.approve", entityType: "ExpenseClaim", entityId: expense.expenseId, correlationId });
    return clone(expense);
  }

  function registerAsset({ principal, organizationId, projectId, expenseId, assetTag, assetType, custodyUserId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.assetManage, organizationId, projectId });
    const expense = findExpenseOrThrow({ organizationId, projectId, expenseId });
    if (expense.status !== "Approved") {
      throw Object.assign(new Error("Only approved expenses can be capitalized as assets."), {
        status: 409,
        code: "expense_not_approved"
      });
    }
    if (assets.some((asset) => asset.organizationId === organizationId && asset.assetTag === assetTag)) {
      throw Object.assign(new Error("Asset tag already exists."), { status: 409, code: "asset_tag_duplicate" });
    }
    const asset = {
      assetId: `asset_${assets.length + 1}`,
      organizationId,
      projectId,
      expenseId,
      assetTag,
      assetType,
      acquisitionCost: expense.amount,
      currency: expense.currency,
      custodyUserId,
      status: "In Service",
      registeredByUserId: principal.user.userId
    };
    assets.push(asset);
    audit({ principal, organizationId, projectId, action: "operations.asset.register", entityType: "Asset", entityId: asset.assetId, correlationId });
    return clone(asset);
  }

  function getBudgetVariance({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.budgetManage, organizationId, projectId });
    return approvedBudgets({ organizationId, projectId }).map((budget) => {
      const committed = sumMoney(procurements.filter((item) => (
        item.organizationId === organizationId &&
        item.projectId === projectId &&
        item.budgetCode === budget.budgetCode &&
        item.status === "Approved"
      )));
      const actual = sumMoney(expenses.filter((item) => (
        item.organizationId === organizationId &&
        item.projectId === projectId &&
        item.budgetCode === budget.budgetCode &&
        item.status === "Approved"
      )));
      return {
        organizationId,
        projectId,
        budgetCode: budget.budgetCode,
        category: budget.category,
        budgetAmount: budget.amount,
        committed: committed.toFixed(4),
        actual: actual.toFixed(4),
        available: (Number(budget.amount) - committed - actual).toFixed(4),
        currency: budget.currency
      };
    });
  }

  function createMilestonePlan({ principal, organizationId, projectId, title, dueDate, targetAmount, currency = "BDT", deliverables = [], correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.milestoneManage, organizationId, projectId });
    const money = assertMoney(targetAmount, currency);
    const milestone = {
      milestoneId: `milestone_${milestones.length + 1}`,
      organizationId,
      projectId,
      title,
      dueDate,
      targetAmount: money.amount,
      currency: money.currency,
      deliverables: deliverables.map((deliverable, index) => ({
        deliverableId: `deliverable_${milestones.length + 1}_${index + 1}`,
        title: deliverable.title,
        evidenceRequired: deliverable.evidenceRequired !== false
      })),
      evidence: [],
      reviewComments: [],
      progressPercent: 0,
      status: "Planned",
      createdByUserId: principal.user.userId,
      verifiedByUserId: null
    };
    milestones.push(milestone);
    audit({ principal, organizationId, projectId, action: "operations.milestone.create", entityType: "Milestone", entityId: milestone.milestoneId, correlationId });
    return cloneMilestone(milestone);
  }

  function submitMilestoneEvidence({ principal, organizationId, projectId, milestoneId, evidenceRef, progressPercent, comment, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.milestoneManage, organizationId, projectId });
    const milestone = findMilestoneOrThrow({ organizationId, projectId, milestoneId });
    if (!["Planned", "Evidence Submitted", "Information Required"].includes(milestone.status)) {
      throw Object.assign(new Error("Milestone is not open for evidence submission."), {
        status: 409,
        code: "milestone_not_open"
      });
    }
    milestone.evidence.push({
      evidenceId: `evidence_${milestone.evidence.length + 1}`,
      evidenceRef,
      submittedByUserId: principal.user.userId
    });
    milestone.progressPercent = normalizeProgress(progressPercent);
    milestone.status = "Evidence Submitted";
    if (comment) {
      milestone.reviewComments.push({ comment, recordedByUserId: principal.user.userId });
    }
    audit({ principal, organizationId, projectId, action: "operations.milestone.submit_evidence", entityType: "Milestone", entityId: milestoneId, correlationId });
    return cloneMilestone(milestone);
  }

  function verifyMilestone({ principal, organizationId, projectId, milestoneId, comment, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.milestoneVerify, organizationId, projectId });
    const milestone = findMilestoneOrThrow({ organizationId, projectId, milestoneId });
    assertFourEyes({
      creatorUserId: milestone.createdByUserId,
      approverUserId: principal.user.userId,
      action: "Milestone verification"
    });
    if (milestone.status !== "Evidence Submitted" || milestone.evidence.length === 0 || milestone.progressPercent < 100) {
      throw Object.assign(new Error("Milestone requires complete evidence and progress before verification."), {
        status: 409,
        code: "milestone_evidence_incomplete"
      });
    }
    milestone.status = "Verified";
    milestone.verifiedByUserId = principal.user.userId;
    if (comment) {
      milestone.reviewComments.push({ comment, recordedByUserId: principal.user.userId });
    }
    audit({ principal, organizationId, projectId, action: "operations.milestone.verify", entityType: "Milestone", entityId: milestoneId, correlationId });
    return cloneMilestone(milestone);
  }

  function requestFundRelease({ principal, organizationId, projectId, milestoneId, amount, currency = "BDT", purpose, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.milestoneManage, organizationId, projectId });
    const milestone = findMilestoneOrThrow({ organizationId, projectId, milestoneId });
    if (milestone.status !== "Verified") {
      throw Object.assign(new Error("Fund release requires verified milestone."), {
        status: 409,
        code: "milestone_not_verified"
      });
    }
    const money = assertMoney(amount, currency);
    if (money.currency !== milestone.currency || Number(money.amount) > Number(milestone.targetAmount)) {
      throw Object.assign(new Error("Fund release amount must fit verified milestone amount and currency."), {
        status: 409,
        code: "release_amount_invalid"
      });
    }
    const release = {
      releaseId: `release_${fundReleases.length + 1}`,
      organizationId,
      projectId,
      milestoneId,
      amount: money.amount,
      currency: money.currency,
      purpose,
      status: "Requested",
      requestedByUserId: principal.user.userId,
      financeApprovedByUserId: null,
      complianceApprovedByUserId: null,
      releasedByUserId: null,
      postedVoucherId: null
    };
    fundReleases.push(release);
    audit({ principal, organizationId, projectId, action: "operations.fund_release.request", entityType: "FundRelease", entityId: release.releaseId, correlationId });
    return clone(release);
  }

  function approveFundReleaseFinance({ principal, organizationId, projectId, releaseId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.fundReleaseFinanceApprove, organizationId, projectId });
    const release = findFundReleaseOrThrow({ organizationId, projectId, releaseId });
    assertFourEyes({
      creatorUserId: release.requestedByUserId,
      approverUserId: principal.user.userId,
      action: "Fund release finance approval"
    });
    if (release.status !== "Requested") {
      throw Object.assign(new Error("Fund release must be requested before finance approval."), {
        status: 409,
        code: "release_not_requested"
      });
    }
    release.status = "Finance Approved";
    release.financeApprovedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId, action: "operations.fund_release.finance_approve", entityType: "FundRelease", entityId: releaseId, correlationId });
    return clone(release);
  }

  function approveFundReleaseCompliance({ principal, organizationId, projectId, releaseId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.fundReleaseComplianceApprove, organizationId, projectId });
    const release = findFundReleaseOrThrow({ organizationId, projectId, releaseId });
    assertFourEyes({
      creatorUserId: release.requestedByUserId,
      approverUserId: principal.user.userId,
      action: "Fund release compliance approval"
    });
    if (release.status !== "Finance Approved") {
      throw Object.assign(new Error("Fund release must have finance approval before compliance approval."), {
        status: 409,
        code: "release_finance_approval_required"
      });
    }
    release.status = "Compliance Approved";
    release.complianceApprovedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId, action: "operations.fund_release.compliance_approve", entityType: "FundRelease", entityId: releaseId, correlationId });
    return clone(release);
  }

  function releaseFunds({ principal, organizationId, projectId, releaseId, postedVoucherId, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.fundReleasePost, organizationId, projectId });
    const release = findFundReleaseOrThrow({ organizationId, projectId, releaseId });
    if (release.status !== "Compliance Approved") {
      throw Object.assign(new Error("Fund release requires finance and compliance approval."), {
        status: 409,
        code: "release_approval_incomplete"
      });
    }
    if (!accountingService?.getPostedVoucherSummary) {
      throw Object.assign(new Error("Accounting voucher verification is unavailable."), {
        status: 500,
        code: "accounting_verification_unavailable"
      });
    }
    const voucher = accountingService.getPostedVoucherSummary({ organizationId, projectId, voucherId: postedVoucherId });
    if (voucher.amount !== release.amount || voucher.currency !== release.currency) {
      throw Object.assign(new Error("Posted voucher amount does not match fund release."), {
        status: 409,
        code: "release_voucher_mismatch"
      });
    }
    release.status = "Released";
    release.releasedByUserId = principal.user.userId;
    release.postedVoucherId = postedVoucherId;
    audit({ principal, organizationId, projectId, action: "operations.fund_release.release", entityType: "FundRelease", entityId: releaseId, correlationId });
    return { ...clone(release), voucher };
  }

  function publishProjectUpdate({ principal, organizationId, projectId, title, body, visibility = "Investors", correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.milestoneManage, organizationId, projectId });
    const update = {
      updateId: `update_${projectUpdates.length + 1}`,
      organizationId,
      projectId,
      title,
      body,
      visibility,
      publishedByUserId: principal.user.userId
    };
    projectUpdates.push(update);
    audit({ principal, organizationId, projectId, action: "operations.project_update.publish", entityType: "ProjectUpdate", entityId: update.updateId, correlationId });
    return clone(update);
  }

  function getProjectTimeline({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.milestoneManage, organizationId, projectId });
    return {
      milestones: milestones
        .filter((milestone) => milestone.organizationId === organizationId && milestone.projectId === projectId)
        .map(cloneMilestone),
      releases: fundReleases
        .filter((release) => release.organizationId === organizationId && release.projectId === projectId)
        .map(clone),
      updates: projectUpdates
        .filter((update) => update.organizationId === organizationId && update.projectId === projectId)
        .map(clone)
    };
  }

  function getProjectHealth({ principal, organizationId, projectId, asOfDate = new Date().toISOString().slice(0, 10) }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.milestoneManage, organizationId, projectId });
    const scopedMilestones = milestones.filter((milestone) => milestone.organizationId === organizationId && milestone.projectId === projectId);
    const alerts = buildMilestoneAlerts({ organizationId, projectId, asOfDate });
    const verified = scopedMilestones.filter((milestone) => milestone.status === "Verified").length;
    const released = fundReleases.filter((release) => release.organizationId === organizationId && release.projectId === projectId && release.status === "Released").length;
    const score = Math.max(0, 100 - alerts.length * 15 + verified * 5 + released * 5);
    return {
      organizationId,
      projectId,
      score: Math.min(score, 100),
      rating: score >= 85 ? "Healthy" : score >= 60 ? "Watch" : "At Risk",
      signals: {
        milestones: scopedMilestones.length,
        verified,
        released,
        delayedAlerts: alerts.length
      },
      explanations: alerts.map((alert) => alert.message)
    };
  }

  function listMilestoneAlerts({ principal, organizationId, projectId, asOfDate = new Date().toISOString().slice(0, 10) }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.milestoneManage, organizationId, projectId });
    return buildMilestoneAlerts({ organizationId, projectId, asOfDate });
  }

  function assertBudgetAvailable({ organizationId, projectId, budgetCode, amount, currency, excludeProcurementId, excludeExpenseId }) {
    const budget = findApprovedBudgetOrThrow({ organizationId, projectId, budgetCode });
    if (budget.currency !== currency) {
      throw Object.assign(new Error("Operational spend currency must match budget currency."), {
        status: 409,
        code: "budget_currency_mismatch"
      });
    }
    const committed = sumMoney(procurements.filter((item) => (
      item.organizationId === organizationId &&
      item.projectId === projectId &&
      item.budgetCode === budgetCode &&
      item.status === "Approved" &&
      item.procurementId !== excludeProcurementId
    )));
    const actual = sumMoney(expenses.filter((item) => (
      item.organizationId === organizationId &&
      item.projectId === projectId &&
      item.budgetCode === budgetCode &&
      item.status === "Approved" &&
      item.expenseId !== excludeExpenseId
    )));
    if (Number(amount) + committed + actual > Number(budget.amount)) {
      throw Object.assign(new Error("Budget available amount is insufficient."), {
        status: 409,
        code: "budget_insufficient"
      });
    }
  }

  function findLatestBudget({ organizationId, projectId, budgetCode }) {
    return budgets
      .filter((budget) => budget.organizationId === organizationId && budget.projectId === projectId && budget.budgetCode === budgetCode)
      .sort((left, right) => right.revision - left.revision)[0] ?? null;
  }

  function findApprovedBudgetOrThrow({ organizationId, projectId, budgetCode }) {
    const budget = approvedBudgets({ organizationId, projectId }).find((item) => item.budgetCode === budgetCode);
    if (!budget) {
      throw Object.assign(new Error("Approved budget not found."), { status: 404, code: "approved_budget_not_found" });
    }
    return budget;
  }

  function approvedBudgets({ organizationId, projectId }) {
    return budgets.filter((budget) => budget.organizationId === organizationId && budget.projectId === projectId && budget.status === "Approved");
  }

  function findBudgetOrThrow({ organizationId, projectId, budgetId }) {
    const budget = budgets.find((item) => item.organizationId === organizationId && item.projectId === projectId && item.budgetId === budgetId);
    if (!budget) {
      throw Object.assign(new Error("Budget not found."), { status: 404, code: "budget_not_found" });
    }
    return budget;
  }

  function findProcurementOrThrow({ organizationId, projectId, procurementId }) {
    const procurement = procurements.find((item) => item.organizationId === organizationId && item.projectId === projectId && item.procurementId === procurementId);
    if (!procurement) {
      throw Object.assign(new Error("Procurement request not found."), { status: 404, code: "procurement_not_found" });
    }
    return procurement;
  }

  function findExpenseOrThrow({ organizationId, projectId, expenseId }) {
    const expense = expenses.find((item) => item.organizationId === organizationId && item.projectId === projectId && item.expenseId === expenseId);
    if (!expense) {
      throw Object.assign(new Error("Expense claim not found."), { status: 404, code: "expense_not_found" });
    }
    return expense;
  }

  function findMilestoneOrThrow({ organizationId, projectId, milestoneId }) {
    const milestone = milestones.find((item) => item.organizationId === organizationId && item.projectId === projectId && item.milestoneId === milestoneId);
    if (!milestone) {
      throw Object.assign(new Error("Milestone not found."), { status: 404, code: "milestone_not_found" });
    }
    return milestone;
  }

  function findFundReleaseOrThrow({ organizationId, projectId, releaseId }) {
    const release = fundReleases.find((item) => item.organizationId === organizationId && item.projectId === projectId && item.releaseId === releaseId);
    if (!release) {
      throw Object.assign(new Error("Fund release not found."), { status: 404, code: "fund_release_not_found" });
    }
    return release;
  }

  function normalizeProgress(progressPercent) {
    const value = Number(progressPercent);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw Object.assign(new Error("Milestone progress must be an integer from 0 to 100."), {
        status: 400,
        code: "milestone_progress_invalid"
      });
    }
    return value;
  }

  function buildMilestoneAlerts({ organizationId, projectId, asOfDate }) {
    const asOf = new Date(`${asOfDate}T00:00:00.000Z`);
    return milestones
      .filter((milestone) => milestone.organizationId === organizationId && milestone.projectId === projectId)
      .filter((milestone) => new Date(`${milestone.dueDate}T00:00:00.000Z`) < asOf && !["Verified", "Released"].includes(milestone.status))
      .map((milestone) => ({
        alertId: `alert_${milestone.milestoneId}`,
        organizationId,
        projectId,
        milestoneId: milestone.milestoneId,
        severity: milestone.progressPercent >= 75 ? "Medium" : "High",
        message: `${milestone.title} is delayed past ${milestone.dueDate}.`,
        status: "Open"
      }));
  }

  function retireOlderApprovedBudgets(approvedBudget) {
    for (const budget of budgets) {
      if (
        budget.organizationId === approvedBudget.organizationId &&
        budget.projectId === approvedBudget.projectId &&
        budget.budgetCode === approvedBudget.budgetCode &&
        budget.budgetId !== approvedBudget.budgetId &&
        budget.status === "Approved"
      ) {
        budget.status = "Superseded";
      }
    }
  }

  function sumMoney(lines) {
    return lines.reduce((sum, line) => sum + Number(line.amount), 0);
  }

  function cloneBudget(budget) {
    return { ...budget };
  }

  function cloneMilestone(milestone) {
    return {
      ...milestone,
      deliverables: milestone.deliverables.map((deliverable) => ({ ...deliverable })),
      evidence: milestone.evidence.map((evidence) => ({ ...evidence })),
      reviewComments: milestone.reviewComments.map((comment) => ({ ...comment }))
    };
  }

  function clone(record) {
    return { ...record };
  }

  function audit({ principal, organizationId, projectId, action, entityType, entityId, correlationId }) {
    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      action,
      entityType,
      entityId,
      correlationId
    }));
  }
}

export function createMutableSyntheticBudgets() {
  return [
    {
      budgetId: "budget_agro_capex_1",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      budgetCode: "CAPEX-EQUIPMENT",
      category: "Equipment",
      revision: 1,
      amount: "100000.0000",
      currency: "BDT",
      status: "Approved",
      reason: "Synthetic foundation budget",
      createdByUserId: "system",
      approvedByUserId: "system"
    }
  ].map((budget) => ({ ...budget }));
}
