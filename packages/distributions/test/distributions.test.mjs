import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountingService } from "../../accounting/src/index.js";
import { createDistributionService, fromUnits, toUnits } from "../src/index.js";
import { createIdentityService } from "../../identity/src/index.js";
import { createInvestmentService } from "../../investments/src/index.js";
import { createInvestorService } from "../../investors/src/index.js";

const ORG = "org_demo";
const PROJECT = "project_agro_001";
const PERIOD = "period_agro_2026_08";
const MINOR = 100n;

test("published formula, calculation, approval chain, payment, and reconciliation complete a distribution", () => {
  const harness = buildHarness({
    investors: [
      { investorId: "investor_a" },
      { investorId: "investor_b" }
    ],
    holdings: [
      { investorId: "investor_a", amount: "300000.0000" },
      { investorId: "investor_b", amount: "100000.0000" }
    ],
    distributableProfit: "40000.0000"
  });

  const formula = publishFormula(harness, { withholdingRatePercent: "10.0000" });
  const proposal = harness.distributions.createDistributionProposal({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    periodId: PERIOD,
    formulaVersionId: formula.formulaVersionId,
    correlationId: "corr_proposal"
  });
  assert.equal(proposal.status, "Draft");
  assert.equal(proposal.distributableAmount, "40000.0000");

  const calculated = harness.distributions.calculateDistribution({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_calc"
  });

  assert.equal(calculated.status, "Calculated");
  assert.equal(calculated.grossTotal, "40000.0000");
  assert.equal(calculated.withholdingTotal, "4000.0000");
  assert.equal(calculated.netTotal, "36000.0000");
  assert.equal(calculated.residualAmount, "0.0000");
  assert.equal(entitlementFor(calculated, "investor_a").grossAmount, "30000.0000");
  assert.equal(entitlementFor(calculated, "investor_b").grossAmount, "10000.0000");
  assert.equal(entitlementFor(calculated, "investor_b").netAmount, "9000.0000");

  const reviewed = harness.distributions.reviewDistribution({
    principal: harness.secondAccountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_review"
  });
  assert.equal(reviewed.status, "Reviewed");

  const approved = harness.distributions.approveDistribution({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_approve"
  });
  assert.equal(approved.status, "Approved");

  harness.postedVoucher.amount = approved.grossTotal;
  const payable = harness.distributions.postDistributionPayable({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    postedVoucherId: "voucher_payable",
    correlationId: "corr_payable"
  });
  assert.equal(payable.status, "Payable Posted");
  assert.ok(payable.entitlements.every((entitlement) => entitlement.status === "Payable"));

  const batch = harness.distributions.createPaymentBatch({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_batch"
  });
  assert.equal(batch.lines.length, 2);
  assert.equal(sum(batch.lines.map((line) => line.netAmount)), "36000.0000");

  harness.distributions.recordPaymentResults({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_results",
    results: batch.lines.map((line) => ({
      entitlementId: line.entitlementId,
      outcome: "Paid",
      paymentReference: `ref_${line.entitlementId}`
    }))
  });

  const reconciled = harness.distributions.reconcileDistribution({
    principal: harness.secondAccountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_reconcile"
  });
  assert.equal(reconciled.status, "Reconciled");
  assert.equal(reconciled.reconciledNetTotal, "36000.0000");

  const completed = harness.distributions.completeDistribution({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_complete"
  });
  assert.equal(completed.status, "Completed");
  assert.ok(completed.entitlements.every((entitlement) => entitlement.status === "Completed"));
});

test("unlocked periods, loss periods, draft formulas, and duplicate periods block distribution", () => {
  const harness = buildHarness({
    investors: [{ investorId: "investor_a" }],
    holdings: [{ investorId: "investor_a", amount: "100000.0000" }],
    distributableProfit: "10000.0000",
    periodStatus: "Closed"
  });

  const draftFormula = harness.distributions.createFormulaVersion({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    correlationId: "corr_formula"
  });

  assert.throws(() => harness.distributions.createDistributionProposal({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    periodId: PERIOD,
    formulaVersionId: draftFormula.formulaVersionId,
    correlationId: "corr_locked"
  }), /locked accounting period/);

  harness.periodResult.periodStatus = "Locked";

  assert.throws(() => harness.distributions.createDistributionProposal({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    periodId: PERIOD,
    formulaVersionId: draftFormula.formulaVersionId,
    correlationId: "corr_draft_formula"
  }), /published formula version/);

  harness.distributions.publishFormulaVersion({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    formulaVersionId: draftFormula.formulaVersionId,
    correlationId: "corr_publish"
  });

  const proposal = harness.distributions.createDistributionProposal({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    periodId: PERIOD,
    formulaVersionId: draftFormula.formulaVersionId,
    correlationId: "corr_first"
  });
  assert.equal(proposal.status, "Draft");

  assert.throws(() => harness.distributions.createDistributionProposal({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    periodId: PERIOD,
    formulaVersionId: draftFormula.formulaVersionId,
    correlationId: "corr_duplicate"
  }), /already exists for this period/);

  const lossHarness = buildHarness({
    investors: [{ investorId: "investor_a" }],
    holdings: [{ investorId: "investor_a", amount: "100000.0000" }],
    distributableProfit: "0.0000",
    netResult: "-25000.0000",
    lossCarryForwardOut: "25000.0000",
    resultType: "Loss"
  });
  const lossFormula = publishFormula(lossHarness);
  assert.throws(() => lossHarness.distributions.createDistributionProposal({
    principal: lossHarness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    periodId: PERIOD,
    formulaVersionId: lossFormula.formulaVersionId,
    correlationId: "corr_loss"
  }), /no distributable profit/);
});

test("published formula versions are immutable and self-approval is blocked", () => {
  const harness = buildHarness({
    investors: [{ investorId: "investor_a" }],
    holdings: [{ investorId: "investor_a", amount: "100000.0000" }],
    distributableProfit: "10000.0000"
  });

  const formula = harness.distributions.createFormulaVersion({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    correlationId: "corr_formula_self"
  });
  assert.throws(() => harness.distributions.publishFormulaVersion({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    formulaVersionId: formula.formulaVersionId,
    correlationId: "corr_self_publish"
  }), /requires independent approval/);

  const published = publishFormula(harness);
  assert.throws(() => harness.distributions.publishFormulaVersion({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    formulaVersionId: published.formulaVersionId,
    correlationId: "corr_republish"
  }), /immutable once published/);

  const next = harness.distributions.createFormulaVersion({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    withholdingRatePercent: "5.0000",
    correlationId: "corr_formula_v3"
  });
  harness.distributions.publishFormulaVersion({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    formulaVersionId: next.formulaVersionId,
    correlationId: "corr_publish_v3"
  });
  const versions = harness.distributions.listFormulaVersions({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT
  });
  assert.equal(versions.filter((version) => version.status === "Published").length, 1);
  assert.equal(versions.filter((version) => version.status === "Retired").length, 1);
});

test("investor holds keep entitlements out of the payment batch until released", () => {
  const harness = buildHarness({
    investors: [
      { investorId: "investor_a" },
      { investorId: "investor_suspended", holdStatus: "Compliance Hold" },
      { investorId: "investor_expired", kycStatus: "Expired" },
      { investorId: "investor_nobank", hasPayoutAccount: false }
    ],
    holdings: [
      { investorId: "investor_a", amount: "100000.0000" },
      { investorId: "investor_suspended", amount: "100000.0000" },
      { investorId: "investor_expired", amount: "100000.0000" },
      { investorId: "investor_nobank", amount: "100000.0000" }
    ],
    distributableProfit: "40000.0000"
  });

  const distribution = runToPayable(harness);
  const held = distribution.entitlements.filter((entitlement) => entitlement.status === "Held");
  assert.equal(held.length, 3);
  assert.deepEqual(held.map((entitlement) => entitlement.holdReason).sort(), [
    "investor_hold_compliance_hold",
    "investor_kyc_expired",
    "investor_payout_account_missing"
  ]);
  assert.ok(held.every((entitlement) => entitlement.grossAmount === "10000.0000"));

  const batch = harness.distributions.createPaymentBatch({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_batch_hold"
  });
  assert.equal(batch.lines.length, 1);
  assert.equal(batch.heldEntitlements.length, 3);

  const stillHeld = held.find((entitlement) => entitlement.holdReason === "investor_kyc_expired");
  assert.throws(() => harness.distributions.releaseEntitlementHold({
    principal: harness.compliance,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    entitlementId: stillHeld.entitlementId,
    correlationId: "corr_release_blocked"
  }), /hold cannot be released/);

  harness.setInvestorState("investor_expired", { kycStatus: "Approved" });
  const released = harness.distributions.releaseEntitlementHold({
    principal: harness.compliance,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    entitlementId: stillHeld.entitlementId,
    correlationId: "corr_release"
  });
  assert.equal(entitlementFor(released, "investor_expired").status, "Payable");

  const supplementary = harness.distributions.createPaymentBatch({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_batch_supplementary"
  });
  assert.equal(supplementary.lines.length, 1);
  assert.equal(supplementary.lines[0].investorId, "investor_expired");
});

test("failed payments block reconciliation until reissued or cancelled", () => {
  const harness = buildHarness({
    investors: [{ investorId: "investor_a" }, { investorId: "investor_b" }],
    holdings: [
      { investorId: "investor_a", amount: "100000.0000" },
      { investorId: "investor_b", amount: "100000.0000" }
    ],
    distributableProfit: "20000.0000"
  });

  const distribution = runToPayable(harness);
  const batch = harness.distributions.createPaymentBatch({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_batch_fail"
  });

  assert.throws(() => harness.distributions.recordPaymentResults({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_missing_reason",
    results: [{ entitlementId: batch.lines[0].entitlementId, outcome: "Failed" }]
  }), /require a reason/);

  const afterResults = harness.distributions.recordPaymentResults({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_results_mixed",
    results: [
      { entitlementId: batch.lines[0].entitlementId, outcome: "Paid", paymentReference: "ref_1" },
      { entitlementId: batch.lines[1].entitlementId, outcome: "Returned", reason: "bank_account_closed" }
    ]
  });
  assert.equal(afterResults.status, "Partially Paid");

  assert.throws(() => harness.distributions.reconcileDistribution({
    principal: harness.secondAccountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_reconcile_blocked"
  }), /unsettled payment/);

  harness.distributions.reissueEntitlement({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    entitlementId: batch.lines[1].entitlementId,
    reason: "investor supplied a corrected payout account",
    correlationId: "corr_reissue"
  });
  harness.distributions.recordPaymentResults({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_results_final",
    results: [{ entitlementId: batch.lines[1].entitlementId, outcome: "Paid", paymentReference: "ref_2" }]
  });

  const reconciled = harness.distributions.reconcileDistribution({
    principal: harness.secondAccountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_reconcile_ok"
  });
  assert.equal(reconciled.status, "Reconciled");
  assert.equal(reconciled.reconciledNetTotal, "20000.0000");
});

test("holding-period basis excludes short holdings and weights eligible days", () => {
  const harness = buildHarness({
    investors: [{ investorId: "investor_long" }, { investorId: "investor_short" }],
    holdings: [
      { investorId: "investor_long", amount: "100000.0000", allocatedAt: "2026-08-01T00:00:00.000Z" },
      { investorId: "investor_short", amount: "100000.0000", allocatedAt: "2026-08-29T00:00:00.000Z" }
    ],
    distributableProfit: "31000.0000"
  });

  const formula = publishFormula(harness, {
    basis: "capital-holding-period",
    minimumHoldingDays: 10
  });
  const calculated = calculate(harness, formula);
  const long = entitlementFor(calculated, "investor_long");
  const short = entitlementFor(calculated, "investor_short");

  assert.equal(long.eligibleDays, 31);
  assert.equal(long.status, "Eligible");
  assert.equal(short.eligibleDays, 3);
  assert.equal(short.status, "Excluded");
  assert.equal(short.exclusionReason, "minimum_holding_period_not_met");
  assert.equal(short.grossAmount, "0.0000");
  assert.equal(long.grossAmount, "31000.0000");
});

test("payable posting requires an approved distribution and a matching posted voucher", () => {
  const harness = buildHarness({
    investors: [{ investorId: "investor_a" }],
    holdings: [{ investorId: "investor_a", amount: "100000.0000" }],
    distributableProfit: "10000.0000"
  });
  const formula = publishFormula(harness);
  const calculated = calculate(harness, formula);

  assert.throws(() => harness.distributions.postDistributionPayable({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    postedVoucherId: "voucher_payable",
    correlationId: "corr_early_payable"
  }), /requires an approved distribution/);

  harness.distributions.reviewDistribution({
    principal: harness.secondAccountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    correlationId: "corr_review"
  });
  harness.distributions.approveDistribution({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    correlationId: "corr_approve"
  });

  harness.postedVoucher.amount = "9000.0000";
  assert.throws(() => harness.distributions.postDistributionPayable({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    postedVoucherId: "voucher_payable",
    correlationId: "corr_mismatch"
  }), /does not match the approved distribution total/);
});

test("distribution approval enforces four-eyes and approval limits", () => {
  const harness = buildHarness({
    investors: [{ investorId: "investor_a" }],
    holdings: [{ investorId: "investor_a", amount: "5000000.0000" }],
    distributableProfit: "2500000.0000"
  });
  const formula = publishFormula(harness);
  const calculated = calculate(harness, formula);

  assert.throws(() => harness.distributions.approveDistribution({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    correlationId: "corr_before_review"
  }), /independently reviewed before approval/);

  harness.distributions.reviewDistribution({
    principal: harness.secondAccountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    correlationId: "corr_review"
  });

  assert.throws(() => harness.distributions.approveDistribution({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    correlationId: "corr_over_limit"
  }), /exceeds approval limit/);
});

test("investor statement reports gross, withholding, net, and paid totals", () => {
  const harness = buildHarness({
    investors: [{ investorId: "investor_approved_001", userId: "user_investor_approved_001" }],
    holdings: [{ investorId: "investor_approved_001", amount: "100000.0000" }],
    distributableProfit: "20000.0000"
  });
  const distribution = runToPayable(harness, { withholdingRatePercent: "10.0000" });
  const batch = harness.distributions.createPaymentBatch({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_batch_statement"
  });
  harness.distributions.recordPaymentResults({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_results_statement",
    results: [{ entitlementId: batch.lines[0].entitlementId, outcome: "Paid", paymentReference: "ref" }]
  });

  const statement = harness.distributions.getInvestorStatement({
    principal: harness.investor,
    organizationId: ORG,
    projectId: PROJECT
  });
  assert.equal(statement.investorId, "investor_approved_001");
  assert.equal(statement.totals.grossAmount, "20000.0000");
  assert.equal(statement.totals.withholdingAmount, "2000.0000");
  assert.equal(statement.totals.netAmount, "18000.0000");
  assert.equal(statement.totals.paidAmount, "18000.0000");
  assert.equal(statement.lines.length, 1);
});

test("project settlement requires completed distributions and archives under four-eyes", () => {
  const harness = buildHarness({
    investors: [{ investorId: "investor_a" }],
    holdings: [{ investorId: "investor_a", amount: "100000.0000" }],
    distributableProfit: "10000.0000"
  });
  const distribution = runToPayable(harness);

  assert.throws(() => harness.distributions.closeProjectSettlement({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    correlationId: "corr_settle_early"
  }), /not completed/);

  const batch = harness.distributions.createPaymentBatch({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_batch_settle"
  });
  harness.distributions.recordPaymentResults({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_results_settle",
    results: [{ entitlementId: batch.lines[0].entitlementId, outcome: "Paid", paymentReference: "ref" }]
  });
  harness.distributions.reconcileDistribution({
    principal: harness.secondAccountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_reconcile_settle"
  });
  harness.distributions.completeDistribution({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: distribution.distributionId,
    correlationId: "corr_complete_settle"
  });

  const settlement = harness.distributions.closeProjectSettlement({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    correlationId: "corr_settle"
  });
  assert.equal(settlement.status, "Settled");
  assert.equal(settlement.lifetimeGrossDistributed, "10000.0000");
  assert.equal(settlement.settledHoldings, 1);

  assert.throws(() => harness.distributions.archiveProjectSettlement({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    correlationId: "corr_archive_self"
  }), /requires independent approval/);
});

test("distribution invariants hold across randomised scenarios", () => {
  const random = createRandom(20260817);

  for (let iteration = 0; iteration < 250; iteration += 1) {
    const investorCount = 1 + Math.floor(random() * 7);
    const investors = [];
    const holdings = [];
    for (let index = 0; index < investorCount; index += 1) {
      const investorId = `investor_p${index}`;
      const roll = random();
      investors.push({
        investorId,
        kycStatus: roll < 0.1 ? "Expired" : "Approved",
        holdStatus: roll >= 0.1 && roll < 0.2 ? "Compliance Hold" : "None",
        hasPayoutAccount: !(roll >= 0.2 && roll < 0.3)
      });
      holdings.push({
        investorId,
        amount: fromUnits(BigInt(1 + Math.floor(random() * 900000)) * MINOR),
        allocatedAt: `2026-08-${String(1 + Math.floor(random() * 20)).padStart(2, "0")}T00:00:00.000Z`
      });
    }

    const distributableProfit = fromUnits(BigInt(1 + Math.floor(random() * 90000000)));
    const withholdingRatePercent = fromUnits(BigInt(Math.floor(random() * 300000)));
    const reserveRatePercent = fromUnits(BigInt(Math.floor(random() * 150000)));
    const residualPolicy = random() < 0.5 ? "largest-remainder" : "retain-reserve";
    const basis = random() < 0.5 ? "capital" : "capital-holding-period";

    const harness = buildHarness({ investors, holdings, distributableProfit });
    const formula = publishFormula(harness, {
      basis,
      minimumHoldingDays: basis === "capital-holding-period" ? Math.floor(random() * 12) : 0,
      residualPolicy,
      withholdingRatePercent,
      reserveRatePercent
    });

    let calculated;
    try {
      calculated = calculate(harness, formula);
    } catch (error) {
      assert.equal(error.code, "no_eligible_holdings", `unexpected failure: ${error.message}`);
      continue;
    }

    const context = `iteration ${iteration}`;
    const grossSum = sumUnits(calculated.entitlements.map((entitlement) => entitlement.grossAmount));
    const withholdingSum = sumUnits(calculated.entitlements.map((entitlement) => entitlement.withholdingAmount));
    const netSum = sumUnits(calculated.entitlements.map((entitlement) => entitlement.netAmount));

    assert.equal(
      fromUnits(grossSum + toUnits(calculated.residualAmount)),
      calculated.distributableAmount,
      `conservation of value failed: ${context}`
    );
    assert.equal(fromUnits(grossSum), calculated.grossTotal, `gross total mismatch: ${context}`);
    assert.equal(fromUnits(withholdingSum), calculated.withholdingTotal, `withholding total mismatch: ${context}`);
    assert.equal(fromUnits(netSum), calculated.netTotal, `net total mismatch: ${context}`);
    assert.ok(toUnits(calculated.residualAmount) >= 0n, `negative residual: ${context}`);

    for (const entitlement of calculated.entitlements) {
      assert.equal(
        fromUnits(toUnits(entitlement.withholdingAmount) + toUnits(entitlement.netAmount)),
        entitlement.grossAmount,
        `gross decomposition failed for ${entitlement.entitlementId}: ${context}`
      );
      assert.ok(toUnits(entitlement.grossAmount) >= 0n, `negative gross: ${context}`);
      assert.ok(toUnits(entitlement.netAmount) >= 0n, `negative net: ${context}`);
      assert.match(entitlement.grossAmount, /\.\d{2}00$/, `gross not rounded to minor unit: ${context}`);
      assert.match(entitlement.netAmount, /\.\d{2}00$/, `net not rounded to minor unit: ${context}`);
      assert.match(entitlement.withholdingAmount, /\.\d{2}00$/, `withholding not rounded to minor unit: ${context}`);

      if (entitlement.status === "Excluded") {
        assert.equal(entitlement.grossAmount, "0.0000", `excluded entitlement funded: ${context}`);
        assert.ok(entitlement.exclusionReason, `missing exclusion reason: ${context}`);
      }
      if (entitlement.status === "Held") {
        assert.ok(entitlement.holdReason, `missing hold reason: ${context}`);
      }
      if (entitlement.status === "Eligible") {
        assert.equal(entitlement.holdReason, null, `eligible entitlement carries a hold: ${context}`);
        assert.ok(entitlement.payoutAccountRef, `eligible entitlement lacks payout account: ${context}`);
      }
    }

    const eligibleCount = calculated.entitlements.filter((entitlement) => entitlement.status !== "Excluded").length;
    if (formula.residualPolicy === "largest-remainder") {
      const reserveAndSubUnit = toUnits(calculated.reserveAmount) + (toUnits(calculated.distributableAmount) % MINOR);
      assert.equal(
        calculated.roundingResidualAmount,
        "0.0000",
        `largest-remainder left rounding residual: ${context}`
      );
      assert.equal(
        calculated.residualAmount,
        fromUnits(reserveAndSubUnit),
        `residual should equal reserve plus sub-unit remainder: ${context}`
      );
    } else {
      assert.ok(
        toUnits(calculated.roundingResidualAmount) < BigInt(Math.max(eligibleCount, 1)) * MINOR,
        `retained rounding residual exceeds one minor unit per participant: ${context}`
      );
    }
  }
});

test("calculation is deterministic for identical inputs", () => {
  const build = () => {
    const harness = buildHarness({
      investors: [
        { investorId: "investor_a" },
        { investorId: "investor_b" },
        { investorId: "investor_c" }
      ],
      holdings: [
        { investorId: "investor_a", amount: "33333.3300" },
        { investorId: "investor_b", amount: "33333.3300" },
        { investorId: "investor_c", amount: "33333.3400" }
      ],
      distributableProfit: "10000.0100"
    });
    return calculate(harness, publishFormula(harness, { withholdingRatePercent: "7.5000" }));
  };

  const first = build();
  const second = build();
  assert.deepEqual(
    first.entitlements.map((entitlement) => [entitlement.investorId, entitlement.grossAmount, entitlement.netAmount]),
    second.entitlements.map((entitlement) => [entitlement.investorId, entitlement.grossAmount, entitlement.netAmount])
  );
  assert.equal(first.residualAmount, second.residualAmount);
  assert.equal(
    fromUnits(sumUnits(first.entitlements.map((entitlement) => entitlement.grossAmount)) + toUnits(first.residualAmount)),
    "10000.0100"
  );
});

test("real accounting close and lock feed a distribution proposal", () => {
  const identity = createIdentityService();
  const pm = identity.authenticate("Bearer demo-token-project-manager");
  const accountManager = identity.authenticate("Bearer demo-token-account-manager");
  const authorizer = identity.authenticate("Bearer demo-token-voucher-authorizer");
  const administrator = identity.authenticate("Bearer demo-token-project-admin");
  const accounting = createAccountingService({ identity });

  postVoucher(accounting, { pm, accountManager, authorizer, lines: [
    { accountCode: "1000", debit: "80000.0000", credit: "0.0000" },
    { accountCode: "4000", debit: "0.0000", credit: "80000.0000" }
  ] });
  postVoucher(accounting, { pm, accountManager, authorizer, lines: [
    { accountCode: "5000", debit: "30000.0000", credit: "0.0000" },
    { accountCode: "1000", debit: "0.0000", credit: "30000.0000" }
  ] });

  closeAndLockPeriod(accounting, { accountManager, authorizer, periodId: "period_agro_2026_08" });
  const result = accounting.getPeriodResult({ organizationId: ORG, projectId: PROJECT, periodId: "period_agro_2026_08" });
  assert.equal(result.netResult, "50000.0000");
  assert.equal(result.distributableProfit, "50000.0000");
  assert.equal(result.periodStatus, "Locked");

  const investorService = createInvestorService({ identity });
  const investmentService = createInvestmentService({
    identity,
    investorService,
    projectService: { listPublishedProjects: () => [] },
    commitments: [{
      commitmentId: "commitment_seed_1",
      organizationId: ORG,
      investorId: "investor_approved_001",
      projectId: PROJECT,
      amount: "100000.0000",
      capitalAmount: "100000.0000",
      currency: "BDT",
      status: "Active",
      allocatedAt: "2026-08-02T00:00:00.000Z"
    }]
  });
  const distributions = createDistributionService({
    identity,
    accountingService: accounting,
    investmentService,
    investorService
  });

  const formula = distributions.createFormulaVersion({
    principal: accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    correlationId: "corr_formula_real"
  });
  distributions.publishFormulaVersion({
    principal: administrator,
    organizationId: ORG,
    projectId: PROJECT,
    formulaVersionId: formula.formulaVersionId,
    correlationId: "corr_publish_real"
  });
  const proposal = distributions.createDistributionProposal({
    principal: accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    periodId: "period_agro_2026_08",
    formulaVersionId: formula.formulaVersionId,
    correlationId: "corr_proposal_real"
  });
  const calculated = distributions.calculateDistribution({
    principal: accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_calc_real"
  });
  assert.equal(calculated.grossTotal, "50000.0000");
  assert.equal(calculated.entitlements[0].status, "Eligible");
});

function buildHarness({
  investors = [],
  holdings = [],
  distributableProfit = "0.0000",
  netResult = distributableProfit,
  lossCarryForwardOut = "0.0000",
  resultType = "Profit",
  periodStatus = "Locked"
} = {}) {
  const identity = createIdentityService();
  const investorRecords = investors.map((investor, index) => ({
    organizationId: ORG,
    investorId: investor.investorId,
    userId: investor.userId ?? `user_${investor.investorId}`,
    investorType: "Individual",
    fullName: `Synthetic Investor ${index + 1}`,
    kycStatus: investor.kycStatus ?? "Approved",
    holdStatus: investor.holdStatus ?? "None",
    version: 1
  }));
  const bankAccounts = investors
    .filter((investor) => investor.hasPayoutAccount !== false)
    .map((investor) => ({
      bankAccountId: `bank_${investor.investorId}`,
      organizationId: ORG,
      investorId: investor.investorId,
      bankName: "Synthetic Settlement Bank",
      accountName: `Synthetic ${investor.investorId}`,
      accountFingerprint: `bank_hash_${investor.investorId}`,
      status: "Verified"
    }));

  const investorService = createInvestorService({
    identity,
    investors: investorRecords,
    kycCases: investorRecords.map((investor) => ({
      organizationId: ORG,
      investorId: investor.investorId,
      kycCaseId: `kyc_${investor.investorId}`,
      status: investor.kycStatus,
      reviewerUserId: null,
      decisionReason: null
    })),
    documents: [],
    bankAccounts,
    nominees: [],
    consents: []
  });

  const investmentService = createInvestmentService({
    identity,
    investorService,
    projectService: { listPublishedProjects: () => [] },
    commitments: holdings.map((holding, index) => ({
      commitmentId: `commitment_${String(index + 1).padStart(3, "0")}`,
      organizationId: ORG,
      investorId: holding.investorId,
      projectId: PROJECT,
      amount: holding.amount,
      capitalAmount: holding.amount,
      currency: holding.currency ?? "BDT",
      status: "Active",
      allocatedAt: holding.allocatedAt ?? "2026-08-01T00:00:00.000Z"
    }))
  });

  const periodResult = {
    organizationId: ORG,
    projectId: PROJECT,
    periodId: PERIOD,
    periodCode: "2026-08",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-31T23:59:59.999Z",
    sequence: 1,
    currency: "BDT",
    revenueTotal: netResult,
    expenseTotal: "0.0000",
    netResult,
    resultType,
    lossCarryForwardIn: "0.0000",
    lossCarryForwardApplied: "0.0000",
    lossCarryForwardOut,
    distributableProfit,
    periodStatus,
    accounts: []
  };
  const postedVoucher = {
    voucherId: "voucher_payable",
    voucherNo: "V-PAYABLE",
    organizationId: ORG,
    projectId: PROJECT,
    amount: null,
    currency: "BDT",
    status: "Posted"
  };

  const accountingService = {
    getPeriodResult: () => ({ ...periodResult }),
    getPostedVoucherSummary: ({ voucherId }) => ({ ...postedVoucher, voucherId }),
    getProjectLossCarryForward: () => ({ lossCarryForward: periodResult.lossCarryForwardOut })
  };

  const distributions = createDistributionService({
    identity,
    accountingService,
    investmentService,
    investorService
  });

  return {
    identity,
    investorService,
    investmentService,
    distributions,
    periodResult,
    postedVoucher,
    accountManager: identity.authenticate("Bearer demo-token-account-manager"),
    secondAccountManager: identity.authenticate("Bearer demo-token-account-manager-two"),
    administrator: identity.authenticate("Bearer demo-token-project-admin"),
    authorizer: identity.authenticate("Bearer demo-token-voucher-authorizer"),
    compliance: identity.authenticate("Bearer demo-token-compliance"),
    investor: identity.authenticate("Bearer demo-token-investor-approved"),
    setInvestorState(investorId, patch) {
      const record = investorRecords.find((candidate) => candidate.investorId === investorId);
      Object.assign(record, patch);
    }
  };
}

function publishFormula(harness, options = {}) {
  const formula = harness.distributions.createFormulaVersion({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    correlationId: "corr_formula_create",
    ...options
  });
  return harness.distributions.publishFormulaVersion({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    formulaVersionId: formula.formulaVersionId,
    correlationId: "corr_formula_publish"
  });
}

function calculate(harness, formula) {
  const proposal = harness.distributions.createDistributionProposal({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    periodId: PERIOD,
    formulaVersionId: formula.formulaVersionId,
    correlationId: "corr_proposal_helper"
  });
  return harness.distributions.calculateDistribution({
    principal: harness.accountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: proposal.distributionId,
    correlationId: "corr_calc_helper"
  });
}

function runToPayable(harness, formulaOptions = {}) {
  const formula = publishFormula(harness, formulaOptions);
  const calculated = calculate(harness, formula);
  harness.distributions.reviewDistribution({
    principal: harness.secondAccountManager,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    correlationId: "corr_review_helper"
  });
  harness.distributions.approveDistribution({
    principal: harness.administrator,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    correlationId: "corr_approve_helper"
  });
  harness.postedVoucher.amount = calculated.grossTotal;
  return harness.distributions.postDistributionPayable({
    principal: harness.authorizer,
    organizationId: ORG,
    projectId: PROJECT,
    distributionId: calculated.distributionId,
    postedVoucherId: "voucher_payable",
    correlationId: "corr_payable_helper"
  });
}

function postVoucher(accounting, { pm, accountManager, authorizer, lines }) {
  const voucher = accounting.createVoucher({
    principal: pm,
    organizationId: ORG,
    projectId: PROJECT,
    voucherType: "Journal",
    narration: "Synthetic period activity",
    lines,
    correlationId: "corr_seed_voucher"
  });
  accounting.submitVoucher({ principal: pm, organizationId: ORG, projectId: PROJECT, voucherId: voucher.voucherId, correlationId: "corr_seed_submit" });
  accounting.checkVoucher({ principal: accountManager, organizationId: ORG, projectId: PROJECT, voucherId: voucher.voucherId, correlationId: "corr_seed_check" });
  accounting.authorizeVoucher({ principal: authorizer, organizationId: ORG, projectId: PROJECT, voucherId: voucher.voucherId, correlationId: "corr_seed_authorize" });
  return accounting.postVoucher({ principal: authorizer, organizationId: ORG, projectId: PROJECT, voucherId: voucher.voucherId, correlationId: "corr_seed_post" });
}

function closeAndLockPeriod(accounting, { accountManager, authorizer, periodId }) {
  accounting.startPeriodClose({ principal: accountManager, organizationId: ORG, projectId: PROJECT, periodId, correlationId: "corr_start_close" });
  const checklist = accounting.getPeriodCloseChecklist({ principal: accountManager, organizationId: ORG, projectId: PROJECT, periodId });
  for (const item of checklist.items.filter((entry) => !entry.automated)) {
    accounting.completeCloseChecklistItem({
      principal: accountManager,
      organizationId: ORG,
      projectId: PROJECT,
      periodId,
      itemId: item.itemId,
      evidenceRef: `object://synthetic/close/${item.itemId}`,
      correlationId: "corr_checklist"
    });
  }
  accounting.closePeriod({ principal: accountManager, organizationId: ORG, projectId: PROJECT, periodId, correlationId: "corr_close" });
  return accounting.lockPeriod({ principal: authorizer, organizationId: ORG, projectId: PROJECT, periodId, correlationId: "corr_lock" });
}

function entitlementFor(distribution, investorId) {
  return distribution.entitlements.find((entitlement) => entitlement.investorId === investorId);
}

function sum(values) {
  return fromUnits(sumUnits(values));
}

function sumUnits(values) {
  return values.reduce((total, value) => total + toUnits(value), 0n);
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
