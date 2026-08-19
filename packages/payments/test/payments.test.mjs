import assert from "node:assert/strict";
import { test } from "node:test";
import { readPaymentProviderRegistry } from "../../configuration/src/index.js";
import { createIdentityService } from "../../identity/src/index.js";
import { createInvestorService } from "../../investors/src/index.js";
import { createInvestmentService } from "../../investments/src/index.js";
import { createMutableSyntheticProjects, createProjectService } from "../../projects/src/index.js";
import { createDefaultProjectAccounts, createPaymentService, signProviderCallback } from "../src/index.js";

const ORG = "org_demo";
const PROJECT = "project_energy_001";

test("payment instruction, proof, import, reconciliation, approval, clearing, and receipt are controlled", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, authorizer, investor, commitmentId } = fixture;

  const instruction = paymentService.createPaymentInstruction({
    principal: investor,
    organizationId: ORG,
    commitmentId,
    idempotencyKey: "instruction-1",
    correlationId: "corr_instruction"
  });
  const replay = paymentService.createPaymentInstruction({
    principal: investor,
    organizationId: ORG,
    commitmentId,
    idempotencyKey: "instruction-1",
    correlationId: "corr_instruction_replay"
  });
  assert.equal(replay.instructionId, instruction.instructionId);
  assert.equal(instruction.expectedAmount, "50000.0000");
  assert.equal(instruction.settledAmount, "0.0000");

  const proof = paymentService.submitPaymentProof({
    principal: investor,
    organizationId: ORG,
    commitmentId,
    proofDocumentRef: "object://synthetic/payment-proof",
    paidAmount: "50000.0000",
    correlationId: "corr_proof"
  });
  assert.equal(proof.status, "Submitted");

  const transaction = importTransaction(fixture, {
    transactionRef: "bank-ref-001",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    idempotencyKey: "bank-import-1"
  });
  assert.equal(transaction.accountCode, "ESCROW-ENERGY-001");
  assert.equal(transaction.accountType, "Segregated Project");

  const reconciliation = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: transaction.bankTransactionId,
    correlationId: "corr_reconcile"
  });
  assert.equal(reconciliation.status, "Matched");
  assert.equal(reconciliation.matchType, "Exact");
  assert.equal(reconciliation.settlementKind, "Full");
  assert.equal(reconciliation.appliedAmount, "50000.0000");

  assert.throws(() => paymentService.confirmClearedPayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    correlationId: "corr_clear_early"
  }), /approved reconciliation covering the full expected amount/);

  assert.throws(() => paymentService.approveReconciliation({
    principal: accounts,
    organizationId: ORG,
    reconciliationId: reconciliation.reconciliationId,
    correlationId: "corr_self_approve"
  }), /not allowed to perform reconciliation:approve/);

  const approved = paymentService.approveReconciliation({
    principal: authorizer,
    organizationId: ORG,
    reconciliationId: reconciliation.reconciliationId,
    correlationId: "corr_approve"
  });
  assert.equal(approved.status, "Approved");

  const cleared = paymentService.confirmClearedPayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    correlationId: "corr_clear"
  });
  assert.equal(cleared.instruction.status, "Cleared");
  assert.equal(cleared.commitment.status, "Reconciled");

  const receipt = paymentService.issueReceipt({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    idempotencyKey: "receipt-1",
    correlationId: "corr_receipt"
  });
  const receiptReplay = paymentService.issueReceipt({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    idempotencyKey: "receipt-1",
    correlationId: "corr_receipt_replay"
  });
  assert.equal(receipt.amount, "50000.0000");
  assert.equal(receiptReplay.receiptId, receipt.receiptId);

  const locked = paymentService.lockReconciliation({
    principal: authorizer,
    organizationId: ORG,
    reconciliationId: reconciliation.reconciliationId,
    correlationId: "corr_lock"
  });
  assert.equal(locked.status, "Locked");
  assert.equal(locked.locked, true);
  assert.throws(() => paymentService.reverseReconciliation({
    principal: authorizer,
    organizationId: ORG,
    reconciliationId: reconciliation.reconciliationId,
    reason: "late correction",
    correlationId: "corr_reverse_locked"
  }), /locked reconciliation cannot be reversed/);
});

test("official receipts are refused before a payment clears", () => {
  const fixture = createAwaitingPaymentFixture();
  const instruction = issueInstruction(fixture, "instruction-receipt");
  assert.equal(instruction.status, "Issued");

  assert.throws(() => fixture.paymentService.issueReceipt({
    principal: fixture.accounts,
    organizationId: ORG,
    commitmentId: fixture.commitmentId,
    idempotencyKey: "receipt-early",
    correlationId: "corr_receipt_early"
  }), /only after a payment clears/);
});

test("partial payments accumulate and settle the instruction on top-up", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, authorizer, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-partial");

  const first = importTransaction(fixture, {
    transactionRef: "bank-partial-1",
    paymentReference: instruction.paymentReference,
    amount: "20000.0000",
    idempotencyKey: "bank-partial-1"
  });
  const firstMatch = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: first.bankTransactionId,
    correlationId: "corr_partial_1"
  });
  assert.equal(firstMatch.settlementKind, "Partial");

  let settlement = paymentService.getInstructionSettlement({ principal: accounts, organizationId: ORG, commitmentId });
  assert.equal(settlement.status, "Partially Paid");
  assert.equal(settlement.settledAmount, "20000.0000");
  assert.equal(settlement.remainingAmount, "30000.0000");

  const second = importTransaction(fixture, {
    transactionRef: "bank-partial-2",
    paymentReference: instruction.paymentReference,
    amount: "30000.0000",
    idempotencyKey: "bank-partial-2"
  });
  const secondMatch = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: second.bankTransactionId,
    correlationId: "corr_partial_2"
  });
  assert.equal(secondMatch.settlementKind, "Full");

  settlement = paymentService.getInstructionSettlement({ principal: accounts, organizationId: ORG, commitmentId });
  assert.equal(settlement.status, "Matched");
  assert.equal(settlement.remainingAmount, "0.0000");

  for (const match of [firstMatch, secondMatch]) {
    paymentService.approveReconciliation({
      principal: authorizer,
      organizationId: ORG,
      reconciliationId: match.reconciliationId,
      correlationId: "corr_approve_partial"
    });
  }
  const cleared = paymentService.confirmClearedPayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    correlationId: "corr_clear_partial"
  });
  assert.equal(cleared.instruction.status, "Cleared");
});

test("a short payment can be classified as underpaid and blocks clearing", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, authorizer, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-short");

  const transaction = importTransaction(fixture, {
    transactionRef: "bank-short-1",
    paymentReference: instruction.paymentReference,
    amount: "40000.0000",
    idempotencyKey: "bank-short-1"
  });
  const match = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: transaction.bankTransactionId,
    correlationId: "corr_short"
  });
  assert.equal(match.settlementKind, "Partial");
  paymentService.approveReconciliation({
    principal: authorizer,
    organizationId: ORG,
    reconciliationId: match.reconciliationId,
    correlationId: "corr_approve_short"
  });

  assert.throws(() => paymentService.confirmClearedPayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    correlationId: "corr_clear_short"
  }), /must be fully settled/);

  const underpaid = paymentService.classifyShortPayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    reason: "Investor confirmed no further transfer will be made.",
    correlationId: "corr_underpaid"
  });
  assert.equal(underpaid.status, "Underpaid");
});

test("overpayment is recorded and drives a refund through propose, approve, and execute", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, authorizer, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-over");

  const transaction = importTransaction(fixture, {
    transactionRef: "bank-over-1",
    paymentReference: instruction.paymentReference,
    amount: "60000.0000",
    idempotencyKey: "bank-over-1"
  });
  const match = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: transaction.bankTransactionId,
    correlationId: "corr_over"
  });
  assert.equal(match.settlementKind, "Overpayment");

  const settlement = paymentService.getInstructionSettlement({ principal: accounts, organizationId: ORG, commitmentId });
  assert.equal(settlement.status, "Overpaid");
  assert.equal(settlement.settledAmount, "60000.0000");
  assert.equal(settlement.overpaidAmount, "10000.0000");

  const refund = paymentService.proposeRefund({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    amount: settlement.overpaidAmount,
    reason: "Synthetic overpayment refund",
    correlationId: "corr_refund"
  });
  assert.throws(() => paymentService.approveRefund({
    principal: accounts,
    organizationId: ORG,
    refundId: refund.refundId,
    correlationId: "corr_self_approve"
  }), /not allowed/);
  assert.throws(() => paymentService.executeRefund({
    principal: authorizer,
    organizationId: ORG,
    refundId: refund.refundId,
    idempotencyKey: "refund-exec-early",
    correlationId: "corr_execute_early"
  }), /Only an approved refund can be executed/);

  assert.equal(paymentService.approveRefund({
    principal: authorizer,
    organizationId: ORG,
    refundId: refund.refundId,
    correlationId: "corr_approve_refund"
  }).status, "Approved");

  const executed = paymentService.executeRefund({
    principal: authorizer,
    organizationId: ORG,
    refundId: refund.refundId,
    paymentReference: "refund-out-001",
    executedOn: "2026-08-18",
    idempotencyKey: "refund-exec-1",
    correlationId: "corr_execute"
  });
  const executedReplay = paymentService.executeRefund({
    principal: authorizer,
    organizationId: ORG,
    refundId: refund.refundId,
    paymentReference: "refund-out-001",
    executedOn: "2026-08-18",
    idempotencyKey: "refund-exec-1",
    correlationId: "corr_execute_replay"
  });
  assert.equal(executed.status, "Executed");
  assert.equal(executedReplay.refundId, executed.refundId);
});

test("mismatched currency, reference, and settled instructions raise reconciliation exceptions", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-exception");

  const wrongReference = importTransaction(fixture, {
    transactionRef: "bank-exception-1",
    paymentReference: "CF360-UNKNOWN-REFERENCE",
    amount: "50000.0000",
    idempotencyKey: "bank-exception-1"
  });
  const referenceException = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: wrongReference.bankTransactionId,
    correlationId: "corr_exception_reference"
  });
  assert.equal(referenceException.status, "Exception");
  assert.match(referenceException.reason, /reference did not match/);

  const wrongCurrency = importTransaction(fixture, {
    transactionRef: "bank-exception-2",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    currency: "USD",
    idempotencyKey: "bank-exception-2"
  });
  const currencyException = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: wrongCurrency.bankTransactionId,
    correlationId: "corr_exception_currency"
  });
  assert.equal(currencyException.status, "Exception");
  assert.match(currencyException.reason, /currency did not match/);

  assert.equal(paymentService.listPaymentExceptions({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT
  }).length, 2);

  const manual = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: wrongReference.bankTransactionId,
    matchType: "Manual",
    overrideReason: "Investor supplied the corrected reference with documented evidence.",
    correlationId: "corr_manual_match"
  });
  assert.equal(manual.status, "Matched");
  assert.equal(manual.matchType, "Manual");

  const extra = importTransaction(fixture, {
    transactionRef: "bank-exception-3",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    idempotencyKey: "bank-exception-3"
  });
  const alreadySettled = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: extra.bankTransactionId,
    correlationId: "corr_exception_settled"
  });
  assert.equal(alreadySettled.status, "Exception");
  assert.match(alreadySettled.reason, /already fully settled/);
});

test("duplicate bank references are quarantined and near duplicates are flagged", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-duplicate");

  const original = importTransaction(fixture, {
    transactionRef: "bank-dup-1",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    idempotencyKey: "bank-dup-key-1"
  });
  const duplicate = importTransaction(fixture, {
    transactionRef: "bank-dup-1",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    idempotencyKey: "bank-dup-key-2"
  });
  assert.equal(duplicate.status, "Duplicate");
  assert.equal(duplicate.duplicateOfBankTransactionId, original.bankTransactionId);

  const nearDuplicate = importTransaction(fixture, {
    transactionRef: "bank-dup-2",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    idempotencyKey: "bank-dup-key-3"
  });
  assert.equal(nearDuplicate.status, "Imported");
  assert.equal(nearDuplicate.potentialDuplicateOfBankTransactionId, original.bankTransactionId);

  const quarantined = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: duplicate.bankTransactionId,
    correlationId: "corr_match_duplicate"
  });
  assert.equal(quarantined.status, "Exception");
  assert.match(quarantined.reason, /status Duplicate/);
});

test("signed provider callbacks reject bad signatures, stale timestamps, replayed nonces, and duplicate events", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, provider, now } = fixture;
  const instruction = issueInstruction(fixture, "instruction-callback");
  const timestamp = Math.floor(now.getTime() / 1000);

  const event = {
    providerEventId: "evt_001",
    organizationId: ORG,
    projectId: PROJECT,
    transactionRef: "provider-tx-001",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    currency: "BDT",
    valueDate: "2026-08-17",
    outcome: "Settled"
  };

  assert.throws(() => paymentService.ingestProviderCallback({
    providerId: "unknown-provider",
    event,
    signature: "0".repeat(64),
    timestamp,
    nonce: "n-unknown",
    correlationId: "corr_unknown"
  }), /not registered/);

  assert.throws(() => paymentService.ingestProviderCallback({
    providerId: provider.providerId,
    event,
    signature: sign(fixture, { timestamp, nonce: "n-bad", event }).replace(/^.{4}/, "0000"),
    timestamp,
    nonce: "n-bad",
    correlationId: "corr_bad_signature"
  }), /signature verification failed/);

  const staleTimestamp = timestamp - 3600;
  assert.throws(() => paymentService.ingestProviderCallback({
    providerId: provider.providerId,
    event,
    signature: sign(fixture, { timestamp: staleTimestamp, nonce: "n-stale", event }),
    timestamp: staleTimestamp,
    nonce: "n-stale",
    correlationId: "corr_stale"
  }), /outside the 300 second tolerance/);

  const accepted = paymentService.ingestProviderCallback({
    providerId: provider.providerId,
    event,
    signature: sign(fixture, { timestamp, nonce: "n-1", event }),
    timestamp,
    nonce: "n-1",
    correlationId: "corr_callback_1"
  });
  assert.equal(accepted.status, "Imported");
  assert.equal(accepted.source, "Provider Callback");
  assert.equal(accepted.deduplicated, false);

  const deduplicated = paymentService.ingestProviderCallback({
    providerId: provider.providerId,
    event,
    signature: sign(fixture, { timestamp, nonce: "n-2", event }),
    timestamp,
    nonce: "n-2",
    correlationId: "corr_callback_dedupe"
  });
  assert.equal(deduplicated.deduplicated, true);
  assert.equal(deduplicated.bankTransactionId, accepted.bankTransactionId);

  const replayEvent = { ...event, providerEventId: "evt_002", transactionRef: "provider-tx-002" };
  assert.throws(() => paymentService.ingestProviderCallback({
    providerId: provider.providerId,
    event: replayEvent,
    signature: sign(fixture, { timestamp, nonce: "n-1", event: replayEvent }),
    timestamp,
    nonce: "n-1",
    correlationId: "corr_replay"
  }), /nonce has already been used/);

  const transactions = paymentService.listBankTransactions({
    principal: fixture.accounts,
    organizationId: ORG,
    projectId: PROJECT
  });
  assert.equal(transactions.filter((transaction) => transaction.source === "Provider Callback").length, 1);
});

test("failed provider callbacks are recorded without creating matchable funds", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, provider, now } = fixture;
  const instruction = issueInstruction(fixture, "instruction-failed-callback");
  const timestamp = Math.floor(now.getTime() / 1000);
  const event = {
    providerEventId: "evt_failed_001",
    organizationId: ORG,
    projectId: PROJECT,
    transactionRef: "provider-tx-failed",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    currency: "BDT",
    valueDate: "2026-08-17",
    outcome: "Failed",
    reason: "insufficient_funds"
  };

  const failed = paymentService.ingestProviderCallback({
    providerId: provider.providerId,
    event,
    signature: sign(fixture, { timestamp, nonce: "n-failed", event }),
    timestamp,
    nonce: "n-failed",
    correlationId: "corr_failed"
  });
  assert.equal(failed.status, "Failed");

  const exception = paymentService.reconcilePayment({
    principal: fixture.accounts,
    organizationId: ORG,
    commitmentId: fixture.commitmentId,
    bankTransactionId: failed.bankTransactionId,
    correlationId: "corr_match_failed"
  });
  assert.equal(exception.status, "Exception");
  assert.match(exception.reason, /not available for matching/);
});

test("one bank transaction splits across several commitments", () => {
  const fixture = createAwaitingPaymentFixture({ commitmentAmounts: ["50000.0000", "30000.0000"] });
  const { paymentService, accounts, commitmentIds } = fixture;
  const first = issueInstructionFor(fixture, commitmentIds[0], "instruction-split-1");
  issueInstructionFor(fixture, commitmentIds[1], "instruction-split-2");

  const transaction = importTransaction(fixture, {
    transactionRef: "bank-split-1",
    paymentReference: first.paymentReference,
    amount: "90000.0000",
    idempotencyKey: "bank-split-1"
  });

  assert.throws(() => paymentService.reconcileSplitPayment({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    bankTransactionId: transaction.bankTransactionId,
    allocations: [
      { commitmentId: commitmentIds[0], amount: "50000.0000" },
      { commitmentId: commitmentIds[1], amount: "30000.0000" }
    ],
    correlationId: "corr_split_no_override"
  }), /Split allocation for .* is invalid/);

  assert.throws(() => paymentService.reconcileSplitPayment({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    bankTransactionId: transaction.bankTransactionId,
    allocations: [
      { commitmentId: commitmentIds[0], amount: "50000.0000" },
      { commitmentId: commitmentIds[1], amount: "60000.0000", overrideReason: "single transfer covering two commitments" }
    ],
    correlationId: "corr_split_excess"
  }), /exceed the available transaction amount/);

  const split = paymentService.reconcileSplitPayment({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    bankTransactionId: transaction.bankTransactionId,
    allocations: [
      { commitmentId: commitmentIds[0], amount: "50000.0000" },
      { commitmentId: commitmentIds[1], amount: "30000.0000", overrideReason: "single transfer covering two commitments" }
    ],
    correlationId: "corr_split"
  });
  assert.equal(split.reconciliations.length, 2);
  assert.equal(split.allocatedAmount, "80000.0000");
  assert.equal(split.residualAmount, "10000.0000");
  assert.ok(split.reconciliations.every((reconciliation) => reconciliation.matchType === "Split"));

  const settlementOne = paymentService.getInstructionSettlement({ principal: accounts, organizationId: ORG, commitmentId: commitmentIds[0] });
  const settlementTwo = paymentService.getInstructionSettlement({ principal: accounts, organizationId: ORG, commitmentId: commitmentIds[1] });
  assert.equal(settlementOne.status, "Matched");
  assert.equal(settlementTwo.status, "Matched");
});

test("several bank transactions aggregate onto one commitment", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-aggregate");

  const first = importTransaction(fixture, {
    transactionRef: "bank-agg-1",
    paymentReference: instruction.paymentReference,
    amount: "22000.0000",
    idempotencyKey: "bank-agg-1"
  });
  const second = importTransaction(fixture, {
    transactionRef: "bank-agg-2",
    paymentReference: instruction.paymentReference,
    amount: "28000.0000",
    idempotencyKey: "bank-agg-2"
  });

  const aggregate = paymentService.reconcileAggregatePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionIds: [first.bankTransactionId, second.bankTransactionId],
    correlationId: "corr_aggregate"
  });
  assert.equal(aggregate.matchType, "Aggregate");
  assert.equal(aggregate.settlementKind, "Full");
  assert.equal(aggregate.appliedAmount, "50000.0000");
  assert.equal(aggregate.bankTransactionIds.length, 2);

  const transactions = paymentService.listBankTransactions({ principal: accounts, organizationId: ORG, projectId: PROJECT });
  assert.ok(transactions.every((transaction) => transaction.status === "Aggregate Matched"));
});

test("match candidates are scored, explained, and marked non-authoritative", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-candidates");

  const transaction = importTransaction(fixture, {
    transactionRef: "bank-candidate-1",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    idempotencyKey: "bank-candidate-1"
  });
  const suggestion = paymentService.suggestMatchCandidates({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    bankTransactionId: transaction.bankTransactionId
  });

  assert.equal(suggestion.authoritative, false);
  assert.equal(suggestion.decisionRequiresHuman, true);
  assert.equal(suggestion.candidates[0].commitmentId, commitmentId);
  assert.equal(suggestion.candidates[0].matchType, "Exact");
  assert.equal(suggestion.candidates[0].confidence, 1);
  assert.ok(suggestion.candidates[0].explanation.length >= 2);
});

test("escrow rules prevent co-mingling and operating-account collection", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, admin } = fixture;
  issueInstruction(fixture, "instruction-escrow");

  assert.throws(() => paymentService.importBankTransaction({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    transactionRef: "bank-escrow-1",
    paymentReference: "CF360-X",
    amount: "1000.0000",
    valueDate: "2026-08-17",
    accountCode: "ESCROW-AGRO-001",
    idempotencyKey: "bank-escrow-1",
    correlationId: "corr_escrow_mismatch"
  }), /cannot be booked to another project's account/);

  assert.throws(() => paymentService.importBankTransaction({
    principal: accounts,
    organizationId: ORG,
    projectId: "project_agro_001",
    transactionRef: "bank-escrow-2",
    paymentReference: "CF360-X",
    amount: "1000.0000",
    valueDate: "2026-08-17",
    accountCode: "OPERATING-AGRO-001",
    idempotencyKey: "bank-escrow-2",
    correlationId: "corr_operating_denied"
  }), /escrow or segregated project account/);

  assert.throws(() => paymentService.registerProjectAccount({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    accountCode: "ESCROW-ENERGY-002",
    accountType: "Escrow",
    bankName: "Synthetic Escrow Bank",
    accountFingerprint: "escrow_hash_energy_002",
    correlationId: "corr_account_denied"
  }), /not allowed to perform payment-account:manage/);

  const registered = paymentService.registerProjectAccount({
    principal: admin,
    organizationId: ORG,
    projectId: PROJECT,
    accountCode: "ESCROW-ENERGY-002",
    accountType: "Escrow",
    bankName: "Synthetic Escrow Bank",
    accountFingerprint: "escrow_hash_energy_002",
    correlationId: "corr_account"
  });
  assert.equal(registered.accountType, "Escrow");
  assert.match(registered.accountFingerprint, /^masked:/);

  assert.throws(() => paymentService.registerProjectAccount({
    principal: admin,
    organizationId: ORG,
    projectId: PROJECT,
    accountCode: "ESCROW-ENERGY-003",
    accountType: "Escrow",
    bankName: "Synthetic Escrow Bank",
    accountFingerprint: "escrow_hash_energy_003",
    isPrimaryCollection: true,
    correlationId: "corr_account_primary"
  }), /already has a primary collection account/);
});

test("reversing a reconciliation restores the instruction and returns the transaction", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, authorizer, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-reverse");

  const transaction = importTransaction(fixture, {
    transactionRef: "bank-reverse-1",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    idempotencyKey: "bank-reverse-1"
  });
  const match = paymentService.reconcilePayment({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    bankTransactionId: transaction.bankTransactionId,
    correlationId: "corr_reverse_match"
  });

  const reversed = paymentService.reverseReconciliation({
    principal: authorizer,
    organizationId: ORG,
    reconciliationId: match.reconciliationId,
    reason: "Bank advised the credit was returned.",
    correlationId: "corr_reverse"
  });
  assert.equal(reversed.status, "Reversed");

  const settlement = paymentService.getInstructionSettlement({ principal: accounts, organizationId: ORG, commitmentId });
  assert.equal(settlement.settledAmount, "0.0000");
  assert.equal(settlement.status, "Issued");

  const transactions = paymentService.listBankTransactions({ principal: accounts, organizationId: ORG, projectId: PROJECT });
  assert.equal(transactions[0].status, "Returned");
  assert.equal(transactions[0].allocatedAmount, "0.0000");
});

test("daily cash control enforces opening plus inflow minus outflow equals closing", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts, authorizer, commitmentId } = fixture;
  const instruction = issueInstruction(fixture, "instruction-cash");

  importTransaction(fixture, {
    transactionRef: "bank-cash-1",
    paymentReference: instruction.paymentReference,
    amount: "50000.0000",
    valueDate: "2026-08-18",
    idempotencyKey: "bank-cash-1"
  });

  const refund = paymentService.proposeRefund({
    principal: accounts,
    organizationId: ORG,
    commitmentId,
    amount: "5000.0000",
    reason: "Synthetic partial refund",
    correlationId: "corr_cash_refund"
  });
  paymentService.approveRefund({ principal: authorizer, organizationId: ORG, refundId: refund.refundId, correlationId: "corr_cash_refund_approve" });
  paymentService.executeRefund({
    principal: authorizer,
    organizationId: ORG,
    refundId: refund.refundId,
    paymentReference: "refund-cash-1",
    executedOn: "2026-08-18",
    idempotencyKey: "refund-cash-1",
    correlationId: "corr_cash_refund_execute"
  });

  assert.throws(() => paymentService.recordDailyCashControl({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    controlDate: "2026-08-18",
    openingBalance: "10000.0000",
    closingBalance: "60000.0000",
    correlationId: "corr_cash_unbalanced"
  }), /does not balance/);

  const control = paymentService.recordDailyCashControl({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    controlDate: "2026-08-18",
    openingBalance: "10000.0000",
    closingBalance: "55000.0000",
    correlationId: "corr_cash"
  });
  assert.equal(control.inflowTotal, "50000.0000");
  assert.equal(control.outflowTotal, "5000.0000");
  assert.equal(control.status, "Balanced");

  assert.throws(() => paymentService.recordDailyCashControl({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    controlDate: "2026-08-18",
    openingBalance: "10000.0000",
    closingBalance: "55000.0000",
    correlationId: "corr_cash_duplicate"
  }), /already exists for this date/);
});

test("partner settlement ingestion is idempotent and quarantines repeated references", () => {
  const fixture = createAwaitingPaymentFixture();
  const { paymentService, accounts } = fixture;
  const instruction = issueInstruction(fixture, "instruction-settlement");

  const lines = [
    { transactionRef: "settle-1", paymentReference: instruction.paymentReference, amount: "20000.0000", valueDate: "2026-08-17" },
    { transactionRef: "settle-2", paymentReference: instruction.paymentReference, amount: "30000.0000", valueDate: "2026-08-17" },
    { transactionRef: "settle-1", paymentReference: instruction.paymentReference, amount: "20000.0000", valueDate: "2026-08-17" }
  ];

  const batch = paymentService.importPartnerSettlement({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    settlementRef: "settlement-2026-08-17",
    lines,
    idempotencyKey: "settlement-1",
    correlationId: "corr_settlement"
  });
  assert.equal(batch.lineCount, 3);
  assert.equal(batch.importedCount, 2);
  assert.equal(batch.duplicateCount, 1);
  assert.equal(batch.grossAmount, "50000.0000");

  const replay = paymentService.importPartnerSettlement({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT,
    settlementRef: "settlement-2026-08-17",
    lines,
    idempotencyKey: "settlement-1",
    correlationId: "corr_settlement_replay"
  });
  assert.equal(replay.settlementBatchId, batch.settlementBatchId);
  assert.equal(paymentService.listBankTransactions({
    principal: accounts,
    organizationId: ORG,
    projectId: PROJECT
  }).length, 3);
});

test("settlement conservation holds across randomised payment sequences", () => {
  const random = createRandom(20260806);

  for (let iteration = 0; iteration < 120; iteration += 1) {
    const expected = `${(2 + Math.floor(random() * 70)) * 10000}.0000`;
    const fixture = createAwaitingPaymentFixture({ commitmentAmounts: [expected] });
    const { paymentService, accounts, commitmentId } = fixture;
    const instruction = issueInstruction(fixture, `instruction-prop-${iteration}`);

    const chunks = 1 + Math.floor(random() * 3);
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const amount = `${(1 + Math.floor(random() * 40)) * 10000}.0000`;
      const transaction = importTransaction(fixture, {
        transactionRef: `prop-${iteration}-${chunk}`,
        paymentReference: instruction.paymentReference,
        amount,
        idempotencyKey: `prop-${iteration}-${chunk}`
      });
      paymentService.reconcilePayment({
        principal: accounts,
        organizationId: ORG,
        commitmentId,
        bankTransactionId: transaction.bankTransactionId,
        correlationId: `corr_prop_${iteration}_${chunk}`
      });
    }

    const settlement = paymentService.getInstructionSettlement({ principal: accounts, organizationId: ORG, commitmentId });
    const applied = paymentService
      .listReconciliations({ principal: accounts, organizationId: ORG, projectId: PROJECT })
      .filter((reconciliation) => reconciliation.status === "Matched")
      .reduce((total, reconciliation) => total + Number(reconciliation.appliedAmount), 0);

    assert.equal(
      applied.toFixed(4),
      Number(settlement.settledAmount).toFixed(4),
      `applied reconciliations must equal the settled amount at iteration ${iteration}`
    );

    for (const transaction of paymentService.listBankTransactions({ principal: accounts, organizationId: ORG, projectId: PROJECT })) {
      assert.ok(
        Number(transaction.allocatedAmount) <= Number(transaction.amount),
        `transaction over-allocated at iteration ${iteration}`
      );
    }

    const settled = Number(settlement.settledAmount);
    const expectedTotal = Number(settlement.expectedAmount);
    if (settled === 0) {
      assert.equal(settlement.status, "Issued", `iteration ${iteration}`);
    } else if (settled < expectedTotal) {
      assert.equal(settlement.status, "Partially Paid", `iteration ${iteration}`);
    } else if (settled === expectedTotal) {
      assert.equal(settlement.status, "Matched", `iteration ${iteration}`);
    } else {
      assert.equal(settlement.status, "Overpaid", `iteration ${iteration}`);
      assert.equal(
        Number(settlement.overpaidAmount).toFixed(4),
        (settled - expectedTotal).toFixed(4),
        `iteration ${iteration}`
      );
    }
  }
});

function createAwaitingPaymentFixture({ commitmentAmounts = ["50000.0000"] } = {}) {
  const identity = createIdentityService();
  const projectService = createProjectService({ identity, projects: createMutableSyntheticProjects() });
  const admin = identity.authenticate("Bearer demo-token-project-admin");
  const published = projectService.publishProject({
    principal: admin,
    organizationId: ORG,
    projectId: PROJECT,
    correlationId: "corr_publish"
  });
  const investorService = createInvestorService({ identity });
  const investmentService = createInvestmentService({ identity, investorService, projectService });
  const investor = identity.authenticate("Bearer demo-token-investor-approved");
  investmentService.recordSuitability({
    principal: investor,
    organizationId: ORG,
    projectId: PROJECT,
    offerVersionId: published.publishedOfferVersionId,
    answers: { horizon: "medium" },
    riskAcknowledged: true,
    correlationId: "corr_suitability"
  });

  const commitmentIds = commitmentAmounts.map((amount, index) => {
    const commitment = investmentService.createCommitment({
      principal: investor,
      organizationId: ORG,
      projectId: PROJECT,
      offerVersionId: published.publishedOfferVersionId,
      amount,
      correlationId: `corr_commitment_${index}`
    });
    return investmentService.acceptAgreement({
      principal: investor,
      organizationId: ORG,
      commitmentId: commitment.commitmentId,
      agreementVersion: "agreement_v1",
      correlationId: `corr_agreement_${index}`
    }).commitmentId;
  });

  const now = new Date("2026-08-17T10:00:00.000Z");
  const providerRegistry = readPaymentProviderRegistry({});
  const paymentService = createPaymentService({
    identity,
    investmentService,
    projectAccounts: createDefaultProjectAccounts(),
    providerRegistry,
    clock: () => now
  });

  return {
    identity,
    paymentService,
    provider: providerRegistry[0],
    providerRegistry,
    now,
    commitmentId: commitmentIds[0],
    commitmentIds,
    admin,
    investor,
    accounts: identity.authenticate("Bearer demo-token-account-manager"),
    authorizer: identity.authenticate("Bearer demo-token-voucher-authorizer")
  };
}

function issueInstruction(fixture, idempotencyKey) {
  return issueInstructionFor(fixture, fixture.commitmentId, idempotencyKey);
}

function issueInstructionFor(fixture, commitmentId, idempotencyKey) {
  return fixture.paymentService.createPaymentInstruction({
    principal: fixture.investor,
    organizationId: ORG,
    commitmentId,
    idempotencyKey,
    correlationId: "corr_instruction"
  });
}

function importTransaction(fixture, { transactionRef, paymentReference, amount, currency = "BDT", valueDate = "2026-08-17", accountCode, idempotencyKey }) {
  return fixture.paymentService.importBankTransaction({
    principal: fixture.accounts,
    organizationId: ORG,
    projectId: PROJECT,
    transactionRef,
    paymentReference,
    amount,
    currency,
    valueDate,
    accountCode,
    idempotencyKey,
    correlationId: "corr_bank"
  });
}

function sign(fixture, { timestamp, nonce, event }) {
  return signProviderCallback({
    secret: fixture.provider.secret,
    providerId: fixture.provider.providerId,
    timestamp,
    nonce,
    event
  });
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
