import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PERMISSIONS,
  PROJECT_ACCOUNT_TYPES,
  RECONCILIATION_MATCH_TYPES,
  SETTLEMENT_KINDS,
  assertFourEyes,
  assertMoney,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";
import { readPaymentProviderRegistry } from "../../configuration/src/index.js";

const UNIT_SCALE = 10000n;
const COLLECTION_ACCOUNT_TYPES = Object.freeze([
  PROJECT_ACCOUNT_TYPES.escrow,
  PROJECT_ACCOUNT_TYPES.segregatedProject
]);

export function createPaymentService({
  identity,
  investmentService,
  accountingService = null,
  paymentInstructions = [],
  paymentProofs = [],
  bankTransactions = [],
  reconciliations = [],
  refunds = [],
  receipts = [],
  projectAccounts = createDefaultProjectAccounts(),
  providerRegistry = readPaymentProviderRegistry(),
  callbackEvents = [],
  callbackNonces = new Set(),
  settlementBatches = [],
  cashControls = [],
  idempotencyRecords = new Map(),
  clock = () => new Date(),
  auditEvents = []
}) {
  return {
    createPaymentInstruction,
    submitPaymentProof,
    registerProjectAccount,
    listProjectAccounts,
    importBankTransaction,
    importPartnerSettlement,
    ingestProviderCallback,
    listProviders,
    suggestMatchCandidates,
    reconcilePayment,
    reconcileSplitPayment,
    reconcileAggregatePayment,
    reverseReconciliation,
    approveReconciliation,
    rejectReconciliation,
    lockReconciliation,
    classifyShortPayment,
    markBankTransactionUnmatched,
    confirmClearedPayment,
    issueReceipt,
    proposeRefund,
    approveRefund,
    executeRefund,
    recordDailyCashControl,
    listDailyCashControls,
    listPaymentExceptions,
    listBankTransactions,
    listReconciliations,
    getInstructionSettlement,
    getAuditEvents: () => auditEvents.slice()
  };

  // ---------------------------------------------------------------- instructions

  function createPaymentInstruction({ principal, organizationId, commitmentId, idempotencyKey, correlationId }) {
    return once({ scope: `instruction:${organizationId}:${commitmentId}`, idempotencyKey }, () => {
      const commitment = investmentService.getCommitmentForPayment({ organizationId, commitmentId });
      if (commitment.status !== "Awaiting Payment") {
        throw problem(409, "commitment_not_awaiting_payment", "Commitment must be awaiting payment before instruction.");
      }
      const issuedAt = clock();
      const instruction = {
        instructionId: `payref_${paymentInstructions.length + 1}`,
        organizationId,
        projectId: commitment.projectId,
        investorId: commitment.investorId,
        commitmentId,
        paymentReference: `CF360-${commitment.projectId}-${commitment.investorId}-${commitmentId}`.toUpperCase(),
        amount: commitment.amount,
        expectedAmount: commitment.amount,
        settledAmount: "0.0000",
        overpaidAmount: "0.0000",
        currency: commitment.currency,
        status: "Issued",
        settlementKind: null,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
      };
      paymentInstructions.push(instruction);
      audit({ principal, organizationId, projectId: commitment.projectId, action: "payment.instruction.issue", entityType: "PaymentInstruction", entityId: instruction.instructionId, correlationId });
      return { ...instruction };
    });
  }

  function submitPaymentProof({ principal, organizationId, commitmentId, proofDocumentRef, paidAmount, currency = "BDT", correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentProofSubmit, organizationId });
    const instruction = findInstructionOrThrow({ organizationId, commitmentId });
    const money = assertMoney(paidAmount, currency);
    const proof = {
      proofId: `proof_${paymentProofs.length + 1}`,
      organizationId,
      projectId: instruction.projectId,
      investorId: instruction.investorId,
      commitmentId,
      instructionId: instruction.instructionId,
      proofDocumentRef,
      paidAmount: money.amount,
      currency: money.currency,
      status: "Submitted"
    };
    paymentProofs.push(proof);
    audit({ principal, organizationId, projectId: instruction.projectId, action: "payment.proof.submit", entityType: "PaymentProof", entityId: proof.proofId, correlationId });
    return { ...proof };
  }

  function getInstructionSettlement({ principal, organizationId, commitmentId }) {
    const instruction = findInstructionOrThrow({ organizationId, commitmentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId: instruction.projectId });
    return {
      ...instruction,
      remainingAmount: fromUnits(remainingUnits(instruction)),
      approvedSettledAmount: fromUnits(approvedAppliedUnits({ organizationId, commitmentId }))
    };
  }

  // ------------------------------------------------------------ project accounts

  function registerProjectAccount({ principal, organizationId, projectId, accountCode, accountType, bankName, accountFingerprint, isPrimaryCollection = false, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentAccountManage, organizationId, projectId });
    if (!Object.values(PROJECT_ACCOUNT_TYPES).includes(accountType)) {
      throw problem(400, "project_account_type_invalid", `Unsupported project account type: ${accountType}.`);
    }
    if (!accountCode || !accountFingerprint) {
      throw problem(400, "project_account_details_required", "Account code and account fingerprint are required.");
    }
    if (projectAccounts.some((account) => account.organizationId === organizationId && account.accountCode === accountCode)) {
      throw problem(409, "project_account_exists", "Project account code is already registered.");
    }
    if (isPrimaryCollection) {
      if (!COLLECTION_ACCOUNT_TYPES.includes(accountType)) {
        throw problem(409, "primary_collection_account_type_invalid", "Only escrow or segregated project accounts can collect investor funds.");
      }
      if (findPrimaryCollectionAccount({ organizationId, projectId })) {
        throw problem(409, "primary_collection_account_exists", "Project already has a primary collection account.");
      }
    }
    const account = {
      projectAccountId: `project_account_${projectAccounts.length + 1}`,
      organizationId,
      projectId,
      accountCode,
      accountType,
      bankName,
      accountFingerprint,
      isPrimaryCollection,
      status: "Active"
    };
    projectAccounts.push(account);
    audit({ principal, organizationId, projectId, action: "payment.project_account.register", entityType: "ProjectAccount", entityId: account.projectAccountId, correlationId });
    return maskAccount(account);
  }

  function listProjectAccounts({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    return projectAccounts
      .filter((account) => account.organizationId === organizationId && account.projectId === projectId)
      .map(maskAccount);
  }

  // ------------------------------------------------------------ bank transactions

  function importBankTransaction({ principal, organizationId, projectId, transactionRef, paymentReference, amount, currency = "BDT", valueDate, accountCode, idempotencyKey, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    return once({ scope: `bank-transaction:${organizationId}:${transactionRef}`, idempotencyKey }, () => (
      recordBankTransaction({
        principal,
        organizationId,
        projectId,
        transactionRef,
        paymentReference,
        amount,
        currency,
        valueDate,
        accountCode,
        source: "Manual Import",
        correlationId
      })
    ));
  }

  function importPartnerSettlement({ principal, organizationId, projectId, settlementRef, lines, idempotencyKey, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentSettlementImport, organizationId, projectId });
    return once({ scope: `settlement:${organizationId}:${settlementRef}`, idempotencyKey }, () => {
      if (!Array.isArray(lines) || lines.length === 0) {
        throw problem(400, "settlement_lines_required", "A partner settlement requires at least one line.");
      }
      const imported = [];
      for (const line of lines) {
        imported.push(recordBankTransaction({
          principal,
          organizationId,
          projectId,
          transactionRef: line.transactionRef,
          paymentReference: line.paymentReference,
          amount: line.amount,
          currency: line.currency ?? "BDT",
          valueDate: line.valueDate,
          accountCode: line.accountCode,
          source: "Partner Settlement",
          settlementRef,
          correlationId
        }));
      }
      const batch = {
        settlementBatchId: `settlement_${settlementBatches.length + 1}`,
        organizationId,
        projectId,
        settlementRef,
        lineCount: imported.length,
        importedCount: imported.filter((transaction) => transaction.status === "Imported").length,
        duplicateCount: imported.filter((transaction) => transaction.status === "Duplicate").length,
        grossAmount: fromUnits(imported
          .filter((transaction) => transaction.status !== "Duplicate")
          .reduce((total, transaction) => total + toUnits(transaction.amount), 0n)),
        importedByUserId: principal.user.userId
      };
      settlementBatches.push(batch);
      audit({ principal, organizationId, projectId, action: "payment.settlement.import", entityType: "SettlementBatch", entityId: batch.settlementBatchId, correlationId });
      return { ...batch, transactions: imported };
    });
  }

  function markBankTransactionUnmatched({ principal, organizationId, projectId, bankTransactionId, reason, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    const transaction = findBankTransactionOrThrow({ organizationId, bankTransactionId });
    if (!reason) {
      throw problem(400, "unmatched_reason_required", "Marking a transaction unmatched requires a reason.");
    }
    transitionBankTransaction({ transaction, to: "Unmatched" });
    transaction.unmatchedReason = reason;
    audit({ principal, organizationId, projectId, action: "payment.bank_transaction.unmatched", entityType: "BankTransaction", entityId: bankTransactionId, reason, correlationId });
    return { ...transaction };
  }

  function listBankTransactions({ principal, organizationId, projectId, status }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    return bankTransactions
      .filter((transaction) => transaction.organizationId === organizationId && transaction.projectId === projectId)
      .filter((transaction) => !status || transaction.status === status)
      .map((transaction) => ({ ...transaction }));
  }

  // --------------------------------------------------------- provider callbacks

  function listProviders() {
    return providerRegistry.map((provider) => ({
      providerId: provider.providerId,
      displayName: provider.displayName,
      channel: provider.channel,
      signatureAlgorithm: provider.signatureAlgorithm,
      timestampToleranceSeconds: provider.timestampToleranceSeconds,
      syntheticSecret: provider.syntheticSecret,
      liveMoneyMovementEnabled: provider.liveMoneyMovementEnabled
    }));
  }

  function ingestProviderCallback({ providerId, event, signature, timestamp, nonce, correlationId }) {
    const provider = providerRegistry.find((candidate) => candidate.providerId === providerId);
    if (!provider) {
      throw problem(404, "provider_not_registered", `Payment provider is not registered: ${providerId}.`);
    }
    if (!event || typeof event !== "object") {
      throw problem(400, "callback_event_required", "Callback event payload is required.");
    }
    if (!nonce) {
      throw problem(400, "callback_nonce_required", "Callback nonce is required.");
    }
    const numericTimestamp = Number(timestamp);
    if (!Number.isInteger(numericTimestamp)) {
      throw problem(400, "callback_timestamp_invalid", "Callback timestamp must be epoch seconds.");
    }
    const skewSeconds = Math.abs(Math.floor(clock().getTime() / 1000) - numericTimestamp);
    if (skewSeconds > provider.timestampToleranceSeconds) {
      throw problem(401, "callback_timestamp_expired", `Callback timestamp is outside the ${provider.timestampToleranceSeconds} second tolerance.`);
    }
    if (!verifySignature({ provider, timestamp: numericTimestamp, nonce, event, signature })) {
      throw problem(401, "callback_signature_invalid", "Callback signature verification failed.");
    }

    const existing = callbackEvents.find((candidate) => (
      candidate.providerId === providerId && candidate.providerEventId === event.providerEventId
    ));
    if (existing) {
      return { ...existing.result, deduplicated: true, providerEventId: event.providerEventId };
    }

    const nonceKey = `${providerId}:${nonce}`;
    if (callbackNonces.has(nonceKey)) {
      throw problem(409, "callback_nonce_replayed", "Callback nonce has already been used.");
    }
    callbackNonces.add(nonceKey);

    if (!event.providerEventId) {
      throw problem(400, "callback_event_id_required", "Callback providerEventId is required for deduplication.");
    }

    const systemPrincipal = { user: { userId: `provider:${providerId}` } };
    let result;
    if (event.outcome === "Settled") {
      result = recordBankTransaction({
        principal: systemPrincipal,
        organizationId: event.organizationId,
        projectId: event.projectId,
        transactionRef: event.transactionRef,
        paymentReference: event.paymentReference,
        amount: event.amount,
        currency: event.currency ?? "BDT",
        valueDate: event.valueDate,
        accountCode: event.accountCode,
        source: "Provider Callback",
        providerId,
        providerEventId: event.providerEventId,
        correlationId
      });
    } else if (event.outcome === "Failed" || event.outcome === "Returned") {
      result = recordFailedProviderEvent({
        principal: systemPrincipal,
        providerId,
        event,
        correlationId
      });
    } else {
      throw problem(400, "callback_outcome_invalid", `Unsupported callback outcome: ${event.outcome}.`);
    }

    callbackEvents.push({
      callbackEventId: `callback_${callbackEvents.length + 1}`,
      providerId,
      providerEventId: event.providerEventId,
      nonce,
      timestamp: numericTimestamp,
      outcome: event.outcome,
      receivedAt: clock().toISOString(),
      result
    });
    return { ...result, deduplicated: false, providerEventId: event.providerEventId };
  }

  // ------------------------------------------------------------- match candidates

  function suggestMatchCandidates({ principal, organizationId, projectId, bankTransactionId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    const transaction = findBankTransactionOrThrow({ organizationId, bankTransactionId });
    const available = availableUnits(transaction);
    const candidates = paymentInstructions
      .filter((instruction) => (
        instruction.organizationId === organizationId &&
        instruction.projectId === projectId &&
        remainingUnits(instruction) > 0n &&
        !["Cleared", "Cancelled", "Reversed"].includes(instruction.status)
      ))
      .map((instruction) => scoreCandidate({ instruction, transaction, available }))
      .filter((candidate) => candidate.confidence > 0)
      .sort((left, right) => (right.confidence - left.confidence) || left.commitmentId.localeCompare(right.commitmentId))
      .slice(0, 5);

    return {
      bankTransactionId,
      organizationId,
      projectId,
      availableAmount: fromUnits(available),
      authoritative: false,
      decisionRequiresHuman: true,
      candidates
    };
  }

  function scoreCandidate({ instruction, transaction, available }) {
    const explanation = [];
    let confidence = 0;
    const remaining = remainingUnits(instruction);
    const referenceExact = transaction.paymentReference === instruction.paymentReference;
    const currencyMatch = transaction.currency === instruction.currency;

    if (referenceExact) {
      confidence += 0.6;
      explanation.push("Payment reference matches exactly.");
    } else {
      const overlap = referenceOverlap(transaction.paymentReference, instruction.paymentReference);
      if (overlap > 0) {
        confidence += 0.3 * overlap;
        explanation.push(`Payment reference shares ${Math.round(overlap * 100)} percent of its identifying tokens.`);
      }
    }

    if (!currencyMatch) {
      explanation.push("Currency does not match the instruction.");
      return {
        commitmentId: instruction.commitmentId,
        instructionId: instruction.instructionId,
        matchType: RECONCILIATION_MATCH_TYPES.manual,
        confidence: 0,
        remainingAmount: fromUnits(remaining),
        explanation
      };
    }
    confidence += 0.1;

    if (available === remaining) {
      confidence += 0.3;
      explanation.push("Available amount settles the instruction exactly.");
    } else if (available < remaining) {
      confidence += 0.15;
      explanation.push("Available amount partially settles the instruction.");
    } else {
      confidence += 0.05;
      explanation.push("Available amount exceeds the outstanding balance and would be an overpayment.");
    }

    const matchType = referenceExact && available === remaining
      ? RECONCILIATION_MATCH_TYPES.exact
      : RECONCILIATION_MATCH_TYPES.probable;

    return {
      commitmentId: instruction.commitmentId,
      instructionId: instruction.instructionId,
      matchType,
      confidence: Math.min(Number(confidence.toFixed(4)), 1),
      remainingAmount: fromUnits(remaining),
      explanation
    };
  }

  // ---------------------------------------------------------------- reconciliation

  function reconcilePayment({ principal, organizationId, commitmentId, bankTransactionId, matchType = RECONCILIATION_MATCH_TYPES.exact, overrideReason, correlationId }) {
    const instruction = findInstructionOrThrow({ organizationId, commitmentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId: instruction.projectId });
    const transaction = findBankTransactionOrThrow({ organizationId, bankTransactionId });

    const mismatch = detectMismatch({ instruction, transaction, matchType, overrideReason });
    if (mismatch) {
      return recordException({ principal, instruction, transaction, reason: mismatch, correlationId });
    }

    const available = availableUnits(transaction);
    const remaining = remainingUnits(instruction);
    const applied = available;
    const settlementKind = classifySettlement({ applied, remaining });

    applyToInstruction({ instruction, applied, settlementKind });
    transaction.allocatedAmount = fromUnits(toUnits(transaction.allocatedAmount) + applied);
    transitionBankTransaction({ transaction, to: "Matched" });

    const reconciliation = pushReconciliation({
      principal,
      instruction,
      bankTransactionIds: [bankTransactionId],
      matchType,
      settlementKind,
      applied,
      overrideReason
    });
    audit({ principal, organizationId, projectId: instruction.projectId, action: "payment.reconcile.match", entityType: "Reconciliation", entityId: reconciliation.reconciliationId, correlationId });
    return { ...reconciliation };
  }

  function reconcileSplitPayment({ principal, organizationId, projectId, bankTransactionId, allocations, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    const transaction = findBankTransactionOrThrow({ organizationId, bankTransactionId });
    if (!Array.isArray(allocations) || allocations.length < 2) {
      throw problem(400, "split_allocations_required", "A split match requires at least two allocations.");
    }
    const available = availableUnits(transaction);
    let requested = 0n;
    const prepared = [];
    for (const allocation of allocations) {
      const instruction = findInstructionOrThrow({ organizationId, commitmentId: allocation.commitmentId });
      if (instruction.projectId !== projectId) {
        throw problem(403, "instruction_project_mismatch", "Split allocation targets another project.");
      }
      const mismatch = detectMismatch({
        instruction,
        transaction,
        matchType: RECONCILIATION_MATCH_TYPES.split,
        overrideReason: allocation.overrideReason
      });
      if (mismatch) {
        throw problem(409, "split_allocation_invalid", `Split allocation for ${allocation.commitmentId} is invalid: ${mismatch}`);
      }
      const amount = toUnits(assertMoney(allocation.amount, instruction.currency).amount);
      if (amount <= 0n) {
        throw problem(400, "split_allocation_amount_invalid", "Split allocation amounts must be positive.");
      }
      requested += amount;
      prepared.push({ instruction, amount });
    }
    if (requested > available) {
      throw problem(409, "split_allocation_exceeds_transaction", "Split allocations exceed the available transaction amount.");
    }

    const created = [];
    for (const { instruction, amount } of prepared) {
      const settlementKind = classifySettlement({ applied: amount, remaining: remainingUnits(instruction) });
      applyToInstruction({ instruction, applied: amount, settlementKind });
      created.push(pushReconciliation({
        principal,
        instruction,
        bankTransactionIds: [bankTransactionId],
        matchType: RECONCILIATION_MATCH_TYPES.split,
        settlementKind,
        applied: amount,
        overrideReason: allocations.find((allocation) => allocation.commitmentId === instruction.commitmentId)?.overrideReason
      }));
    }
    transaction.allocatedAmount = fromUnits(toUnits(transaction.allocatedAmount) + requested);
    transitionBankTransaction({ transaction, to: "Split Matched" });
    audit({ principal, organizationId, projectId, action: "payment.reconcile.split", entityType: "BankTransaction", entityId: bankTransactionId, correlationId });
    return {
      bankTransactionId,
      allocatedAmount: fromUnits(requested),
      residualAmount: fromUnits(available - requested),
      reconciliations: created
    };
  }

  function reconcileAggregatePayment({ principal, organizationId, commitmentId, bankTransactionIds, correlationId }) {
    const instruction = findInstructionOrThrow({ organizationId, commitmentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId: instruction.projectId });
    if (!Array.isArray(bankTransactionIds) || bankTransactionIds.length < 2) {
      throw problem(400, "aggregate_transactions_required", "An aggregate match requires at least two bank transactions.");
    }
    const transactions = bankTransactionIds.map((bankTransactionId) => {
      const transaction = findBankTransactionOrThrow({ organizationId, bankTransactionId });
      const mismatch = detectMismatch({ instruction, transaction, matchType: RECONCILIATION_MATCH_TYPES.aggregate });
      if (mismatch) {
        throw problem(409, "aggregate_transaction_invalid", `Bank transaction ${bankTransactionId} is invalid for aggregation: ${mismatch}`);
      }
      return transaction;
    });

    const applied = transactions.reduce((total, transaction) => total + availableUnits(transaction), 0n);
    if (applied <= 0n) {
      throw problem(409, "aggregate_amount_invalid", "Aggregated transactions carry no unallocated amount.");
    }
    const settlementKind = classifySettlement({ applied, remaining: remainingUnits(instruction) });
    applyToInstruction({ instruction, applied, settlementKind });
    for (const transaction of transactions) {
      transaction.allocatedAmount = transaction.amount;
      transitionBankTransaction({ transaction, to: "Aggregate Matched" });
    }
    const reconciliation = pushReconciliation({
      principal,
      instruction,
      bankTransactionIds,
      matchType: RECONCILIATION_MATCH_TYPES.aggregate,
      settlementKind,
      applied
    });
    audit({ principal, organizationId, projectId: instruction.projectId, action: "payment.reconcile.aggregate", entityType: "Reconciliation", entityId: reconciliation.reconciliationId, correlationId });
    return { ...reconciliation };
  }

  function approveReconciliation({ principal, organizationId, reconciliationId, correlationId }) {
    const reconciliation = findReconciliationOrThrow({ organizationId, reconciliationId });
    identity.requirePermission({ principal, permission: PERMISSIONS.reconciliationApprove, organizationId, projectId: reconciliation.projectId });
    assertFourEyes({
      creatorUserId: reconciliation.matchedByUserId,
      approverUserId: principal.user.userId,
      action: "Reconciliation approval"
    });
    transitionReconciliation({ reconciliation, to: "Approved" });
    reconciliation.approvedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId: reconciliation.projectId, action: "payment.reconcile.approve", entityType: "Reconciliation", entityId: reconciliationId, correlationId });
    return { ...reconciliation };
  }

  function rejectReconciliation({ principal, organizationId, reconciliationId, reason, correlationId }) {
    const reconciliation = findReconciliationOrThrow({ organizationId, reconciliationId });
    identity.requirePermission({ principal, permission: PERMISSIONS.reconciliationApprove, organizationId, projectId: reconciliation.projectId });
    if (!reason) {
      throw problem(400, "reconciliation_reject_reason_required", "Rejecting a reconciliation requires a reason.");
    }
    if (reconciliation.status === "Matched") {
      unapplyReconciliation({ reconciliation });
    }
    transitionReconciliation({ reconciliation, to: "Rejected" });
    reconciliation.reason = reason;
    audit({ principal, organizationId, projectId: reconciliation.projectId, action: "payment.reconcile.reject", entityType: "Reconciliation", entityId: reconciliationId, reason, correlationId });
    return { ...reconciliation };
  }

  function lockReconciliation({ principal, organizationId, reconciliationId, correlationId }) {
    const reconciliation = findReconciliationOrThrow({ organizationId, reconciliationId });
    identity.requirePermission({ principal, permission: PERMISSIONS.reconciliationLock, organizationId, projectId: reconciliation.projectId });
    if (reconciliation.status !== "Approved") {
      throw problem(409, "reconciliation_not_approved", "Only an approved reconciliation can be locked.");
    }
    transitionReconciliation({ reconciliation, to: "Locked" });
    reconciliation.locked = true;
    reconciliation.lockedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId: reconciliation.projectId, action: "payment.reconcile.lock", entityType: "Reconciliation", entityId: reconciliationId, correlationId });
    return { ...reconciliation };
  }

  function reverseReconciliation({ principal, organizationId, reconciliationId, reason, correlationId }) {
    const reconciliation = findReconciliationOrThrow({ organizationId, reconciliationId });
    identity.requirePermission({ principal, permission: PERMISSIONS.reconciliationApprove, organizationId, projectId: reconciliation.projectId });
    if (!reason) {
      throw problem(400, "reconciliation_reverse_reason_required", "Reversing a reconciliation requires a reason.");
    }
    if (reconciliation.locked) {
      throw problem(409, "reconciliation_locked", "A locked reconciliation cannot be reversed.");
    }
    unapplyReconciliation({ reconciliation });
    transitionReconciliation({ reconciliation, to: "Reversed" });
    reconciliation.reason = reason;
    for (const bankTransactionId of reconciliation.bankTransactionIds) {
      const transaction = findBankTransactionOrThrow({ organizationId, bankTransactionId });
      transitionBankTransaction({ transaction, to: "Returned" });
    }
    audit({ principal, organizationId, projectId: reconciliation.projectId, action: "payment.reconcile.reverse", entityType: "Reconciliation", entityId: reconciliationId, reason, correlationId });
    return { ...reconciliation };
  }

  function classifyShortPayment({ principal, organizationId, commitmentId, reason, correlationId }) {
    const instruction = findInstructionOrThrow({ organizationId, commitmentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId: instruction.projectId });
    if (!reason) {
      throw problem(400, "short_payment_reason_required", "Classifying a short payment requires a reason.");
    }
    if (remainingUnits(instruction) <= 0n) {
      throw problem(409, "instruction_not_short", "Instruction is not short paid.");
    }
    transitionInstruction({ instruction, to: "Underpaid" });
    instruction.shortPaymentReason = reason;
    audit({ principal, organizationId, projectId: instruction.projectId, action: "payment.instruction.underpaid", entityType: "PaymentInstruction", entityId: instruction.instructionId, reason, correlationId });
    return { ...instruction };
  }

  function listReconciliations({ principal, organizationId, projectId, status }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    return reconciliations
      .filter((reconciliation) => reconciliation.organizationId === organizationId && reconciliation.projectId === projectId)
      .filter((reconciliation) => !status || reconciliation.status === status)
      .map((reconciliation) => ({ ...reconciliation }));
  }

  function listPaymentExceptions({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    return reconciliations
      .filter((reconciliation) => reconciliation.organizationId === organizationId && reconciliation.projectId === projectId && reconciliation.status === "Exception")
      .map((reconciliation) => ({ ...reconciliation }));
  }

  // ------------------------------------------------------------- clearing/receipt

  function confirmClearedPayment({ principal, organizationId, commitmentId, correlationId }) {
    const instruction = findInstructionOrThrow({ organizationId, commitmentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId: instruction.projectId });
    if (!["Matched", "Overpaid"].includes(instruction.status)) {
      throw problem(409, "instruction_not_fully_settled", `Instruction must be fully settled before clearing. Current status: ${instruction.status}.`);
    }
    const approved = approvedAppliedUnits({ organizationId, commitmentId });
    if (approved < toUnits(instruction.expectedAmount)) {
      throw problem(409, "reconciliation_approval_required", "An approved reconciliation covering the full expected amount is required before clearing.");
    }
    transitionInstruction({ instruction, to: "Cleared" });
    const paid = investmentService.markCommitmentPaid({
      organizationId,
      commitmentId,
      actorUserId: principal.user.userId,
      correlationId
    });
    const reconciled = investmentService.markCommitmentReconciled({
      organizationId,
      commitmentId,
      actorUserId: principal.user.userId,
      correlationId
    });
    // Accounting owns posted truth. A cleared payment only drafts a receipt voucher;
    // a human still checks, authorizes, and posts it through the accounting workflow.
    let draftVoucher = null;
    if (accountingService?.draftReceiptForClearedPayment) {
      draftVoucher = accountingService.draftReceiptForClearedPayment({
        organizationId,
        projectId: instruction.projectId,
        commitmentId,
        investorId: instruction.investorId,
        amount: instruction.expectedAmount,
        currency: instruction.currency,
        paymentReference: instruction.paymentReference,
        actorUserId: principal.user.userId,
        correlationId
      });
    }

    audit({ principal, organizationId, projectId: instruction.projectId, action: "payment.confirm_cleared", entityType: "PaymentInstruction", entityId: instruction.instructionId, correlationId });
    return {
      instruction: { ...instruction },
      commitment: reconciled,
      previousCommitmentState: paid.status,
      draftVoucher
    };
  }

  function issueReceipt({ principal, organizationId, commitmentId, idempotencyKey, correlationId }) {
    const instruction = findInstructionOrThrow({ organizationId, commitmentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReceiptIssue, organizationId, projectId: instruction.projectId });
    if (instruction.status !== "Cleared") {
      throw problem(409, "receipt_requires_cleared_payment", "An official receipt is issued only after a payment clears.");
    }
    return once({ scope: `receipt:${organizationId}:${commitmentId}`, idempotencyKey }, () => {
      const receipt = {
        receiptId: `receipt_${receipts.length + 1}`,
        receiptNo: `RCPT-${instruction.projectId}-${receipts.length + 1}`.toUpperCase(),
        organizationId,
        projectId: instruction.projectId,
        investorId: instruction.investorId,
        commitmentId,
        instructionId: instruction.instructionId,
        paymentReference: instruction.paymentReference,
        amount: instruction.settledAmount,
        currency: instruction.currency,
        issuedByUserId: principal.user.userId,
        issuedAt: clock().toISOString()
      };
      receipts.push(receipt);
      audit({ principal, organizationId, projectId: instruction.projectId, action: "payment.receipt.issue", entityType: "PaymentReceipt", entityId: receipt.receiptId, correlationId });
      return { ...receipt };
    });
  }

  // ------------------------------------------------------------------- refunds

  function proposeRefund({ principal, organizationId, commitmentId, amount, currency = "BDT", reason, correlationId }) {
    const instruction = findInstructionOrThrow({ organizationId, commitmentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId: instruction.projectId });
    const money = assertMoney(amount, currency);
    const refund = {
      refundId: `refund_${refunds.length + 1}`,
      organizationId,
      projectId: instruction.projectId,
      commitmentId,
      amount: money.amount,
      currency: money.currency,
      reason,
      status: "Proposed",
      proposedByUserId: principal.user.userId,
      approvedByUserId: null,
      executedByUserId: null,
      executedOn: null,
      paymentReference: null
    };
    refunds.push(refund);
    audit({ principal, organizationId, projectId: instruction.projectId, action: "payment.refund.propose", entityType: "Refund", entityId: refund.refundId, correlationId });
    return { ...refund };
  }

  function approveRefund({ principal, organizationId, refundId, correlationId }) {
    const refund = findRefundOrThrow({ organizationId, refundId });
    identity.requirePermission({ principal, permission: PERMISSIONS.refundApprove, organizationId, projectId: refund.projectId });
    assertFourEyes({
      creatorUserId: refund.proposedByUserId,
      approverUserId: principal.user.userId,
      action: "Refund approval"
    });
    transitionRefund({ refund, to: "Approved" });
    refund.approvedByUserId = principal.user.userId;
    audit({ principal, organizationId, projectId: refund.projectId, action: "payment.refund.approve", entityType: "Refund", entityId: refundId, correlationId });
    return { ...refund };
  }

  function executeRefund({ principal, organizationId, refundId, paymentReference, executedOn, idempotencyKey, correlationId }) {
    const refund = findRefundOrThrow({ organizationId, refundId });
    identity.requirePermission({ principal, permission: PERMISSIONS.refundExecute, organizationId, projectId: refund.projectId });
    return once({ scope: `refund-execution:${organizationId}:${refundId}`, idempotencyKey }, () => {
      if (refund.status !== "Approved") {
        throw problem(409, "refund_not_approved", "Only an approved refund can be executed.");
      }
      transitionRefund({ refund, to: "Executed" });
      refund.executedByUserId = principal.user.userId;
      refund.executedOn = executedOn ?? clock().toISOString().slice(0, 10);
      refund.paymentReference = paymentReference ?? null;
      audit({ principal, organizationId, projectId: refund.projectId, action: "payment.refund.execute", entityType: "Refund", entityId: refundId, correlationId });
      return { ...refund };
    });
  }

  // -------------------------------------------------------------- cash controls

  function recordDailyCashControl({ principal, organizationId, projectId, controlDate, openingBalance, closingBalance, correlationId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.cashControlRecord, organizationId, projectId });
    if (!controlDate) {
      throw problem(400, "cash_control_date_required", "A control date is required.");
    }
    if (cashControls.some((control) => (
      control.organizationId === organizationId && control.projectId === projectId && control.controlDate === controlDate
    ))) {
      throw problem(409, "cash_control_exists", "A cash control already exists for this date.");
    }
    const opening = toUnits(assertMoney(openingBalance).amount);
    const closing = toUnits(assertMoney(closingBalance).amount);
    const inflow = bankTransactions
      .filter((transaction) => (
        transaction.organizationId === organizationId &&
        transaction.projectId === projectId &&
        transaction.valueDate === controlDate &&
        transaction.direction === "Credit" &&
        !["Duplicate", "Failed", "Returned"].includes(transaction.status)
      ))
      .reduce((total, transaction) => total + toUnits(transaction.amount), 0n);
    const outflow = refunds
      .filter((refund) => (
        refund.organizationId === organizationId &&
        refund.projectId === projectId &&
        refund.status === "Executed" &&
        refund.executedOn === controlDate
      ))
      .reduce((total, refund) => total + toUnits(refund.amount), 0n);

    const expectedClosing = opening + inflow - outflow;
    if (expectedClosing !== closing) {
      throw Object.assign(
        new Error(`Daily cash control does not balance. Expected closing ${fromUnits(expectedClosing)} but received ${fromUnits(closing)}.`),
        {
          status: 409,
          code: "cash_control_unbalanced",
          difference: fromUnits(closing - expectedClosing)
        }
      );
    }

    const control = {
      cashControlId: `cash_control_${cashControls.length + 1}`,
      organizationId,
      projectId,
      controlDate,
      openingBalance: fromUnits(opening),
      inflowTotal: fromUnits(inflow),
      outflowTotal: fromUnits(outflow),
      closingBalance: fromUnits(closing),
      status: "Balanced",
      recordedByUserId: principal.user.userId
    };
    cashControls.push(control);
    audit({ principal, organizationId, projectId, action: "payment.cash_control.record", entityType: "CashControl", entityId: control.cashControlId, correlationId });
    return { ...control };
  }

  function listDailyCashControls({ principal, organizationId, projectId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.paymentReconcile, organizationId, projectId });
    return cashControls
      .filter((control) => control.organizationId === organizationId && control.projectId === projectId)
      .map((control) => ({ ...control }));
  }

  // ------------------------------------------------------------------- internals

  function recordBankTransaction({ principal, organizationId, projectId, transactionRef, paymentReference, amount, currency, valueDate, accountCode, source, providerId, providerEventId, settlementRef, correlationId }) {
    if (!transactionRef) {
      throw problem(400, "bank_transaction_ref_required", "A bank transaction reference is required.");
    }
    const account = resolveCollectionAccount({ organizationId, projectId, accountCode });
    const money = assertMoney(amount, currency);
    const existing = bankTransactions.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.transactionRef === transactionRef &&
      candidate.status !== "Duplicate"
    ));
    const nearDuplicate = bankTransactions.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.projectId === projectId &&
      candidate.paymentReference === paymentReference &&
      candidate.amount === money.amount &&
      candidate.valueDate === valueDate &&
      candidate.status !== "Duplicate"
    ));

    const transaction = {
      bankTransactionId: `banktx_${bankTransactions.length + 1}`,
      organizationId,
      projectId,
      accountCode: account.accountCode,
      accountType: account.accountType,
      transactionRef,
      paymentReference,
      amount: money.amount,
      allocatedAmount: "0.0000",
      currency: money.currency,
      valueDate,
      direction: "Credit",
      status: existing ? "Duplicate" : "Imported",
      source: source ?? "Manual Import",
      providerId: providerId ?? null,
      providerEventId: providerEventId ?? null,
      settlementRef: settlementRef ?? null,
      duplicateOfBankTransactionId: existing?.bankTransactionId ?? null,
      potentialDuplicateOfBankTransactionId: !existing && nearDuplicate ? nearDuplicate.bankTransactionId : null,
      unmatchedReason: null
    };
    bankTransactions.push(transaction);
    audit({
      principal,
      organizationId,
      projectId,
      action: existing ? "payment.bank_transaction.duplicate" : "payment.bank_transaction.import",
      entityType: "BankTransaction",
      entityId: transaction.bankTransactionId,
      reason: existing ? `Duplicate of ${existing.bankTransactionId}` : null,
      correlationId
    });
    return { ...transaction };
  }

  function recordFailedProviderEvent({ principal, providerId, event, correlationId }) {
    const account = resolveCollectionAccount({
      organizationId: event.organizationId,
      projectId: event.projectId,
      accountCode: event.accountCode
    });
    const transaction = {
      bankTransactionId: `banktx_${bankTransactions.length + 1}`,
      organizationId: event.organizationId,
      projectId: event.projectId,
      accountCode: account.accountCode,
      accountType: account.accountType,
      transactionRef: event.transactionRef,
      paymentReference: event.paymentReference,
      amount: assertMoney(event.amount ?? "0.0000", event.currency ?? "BDT").amount,
      allocatedAmount: "0.0000",
      currency: event.currency ?? "BDT",
      valueDate: event.valueDate,
      direction: "Credit",
      status: event.outcome,
      source: "Provider Callback",
      providerId,
      providerEventId: event.providerEventId,
      settlementRef: null,
      duplicateOfBankTransactionId: null,
      potentialDuplicateOfBankTransactionId: null,
      unmatchedReason: event.reason ?? null
    };
    bankTransactions.push(transaction);
    audit({
      principal,
      organizationId: event.organizationId,
      projectId: event.projectId,
      action: `payment.bank_transaction.${event.outcome.toLowerCase()}`,
      entityType: "BankTransaction",
      entityId: transaction.bankTransactionId,
      reason: event.reason ?? null,
      correlationId
    });
    return { ...transaction };
  }

  function detectMismatch({ instruction, transaction, matchType, overrideReason }) {
    if (transaction.projectId !== instruction.projectId) {
      return "Bank transaction belongs to a different project.";
    }
    if (!["Imported", "Unmatched"].includes(transaction.status)) {
      return `Bank transaction is not available for matching (status ${transaction.status}).`;
    }
    if (transaction.currency !== instruction.currency) {
      return "Payment currency did not match the instruction.";
    }
    if (availableUnits(transaction) <= 0n) {
      return "Bank transaction has no unallocated amount remaining.";
    }
    if (remainingUnits(instruction) <= 0n) {
      return "Payment instruction is already fully settled.";
    }
    if (transaction.paymentReference !== instruction.paymentReference) {
      const overridable = [
        RECONCILIATION_MATCH_TYPES.manual,
        RECONCILIATION_MATCH_TYPES.split,
        RECONCILIATION_MATCH_TYPES.aggregate
      ].includes(matchType);
      if (overridable && overrideReason) {
        return null;
      }
      return "Payment reference did not match the instruction.";
    }
    return null;
  }

  function classifySettlement({ applied, remaining }) {
    if (applied === remaining) {
      return SETTLEMENT_KINDS.full;
    }
    return applied < remaining ? SETTLEMENT_KINDS.partial : SETTLEMENT_KINDS.overpayment;
  }

  function applyToInstruction({ instruction, applied, settlementKind }) {
    instruction.settledAmount = fromUnits(toUnits(instruction.settledAmount) + applied);
    instruction.settlementKind = settlementKind;
    const overpaid = toUnits(instruction.settledAmount) - toUnits(instruction.expectedAmount);
    instruction.overpaidAmount = fromUnits(overpaid > 0n ? overpaid : 0n);
    const nextStatus = settlementKind === SETTLEMENT_KINDS.full
      ? "Matched"
      : settlementKind === SETTLEMENT_KINDS.partial
        ? "Partially Paid"
        : "Overpaid";
    transitionInstruction({ instruction, to: nextStatus });
  }

  function unapplyReconciliation({ reconciliation }) {
    const instruction = findInstructionOrThrow({
      organizationId: reconciliation.organizationId,
      commitmentId: reconciliation.commitmentId
    });
    const applied = toUnits(reconciliation.appliedAmount);
    instruction.settledAmount = fromUnits(toUnits(instruction.settledAmount) - applied);
    const overpaid = toUnits(instruction.settledAmount) - toUnits(instruction.expectedAmount);
    instruction.overpaidAmount = fromUnits(overpaid > 0n ? overpaid : 0n);
    for (const bankTransactionId of reconciliation.bankTransactionIds) {
      const transaction = findBankTransactionOrThrow({ organizationId: reconciliation.organizationId, bankTransactionId });
      transaction.allocatedAmount = fromUnits(maxUnits(toUnits(transaction.allocatedAmount) - applied, 0n));
    }
    transitionInstruction({ instruction, to: "Returned" });
    if (toUnits(instruction.settledAmount) > 0n) {
      instruction.settlementKind = SETTLEMENT_KINDS.partial;
      transitionInstruction({ instruction, to: "Partially Paid" });
    } else {
      instruction.settlementKind = null;
      transitionInstruction({ instruction, to: "Issued" });
    }
  }

  function pushReconciliation({ principal, instruction, bankTransactionIds, matchType, settlementKind, applied, overrideReason }) {
    const reconciliation = {
      reconciliationId: `recon_${reconciliations.length + 1}`,
      organizationId: instruction.organizationId,
      projectId: instruction.projectId,
      commitmentId: instruction.commitmentId,
      instructionId: instruction.instructionId,
      bankTransactionId: bankTransactionIds[0],
      bankTransactionIds: [...bankTransactionIds],
      matchType,
      settlementKind,
      appliedAmount: fromUnits(applied),
      currency: instruction.currency,
      status: "Matched",
      reason: overrideReason ?? null,
      matchedByUserId: principal.user.userId,
      approvedByUserId: null,
      lockedByUserId: null,
      locked: false
    };
    reconciliations.push(reconciliation);
    return reconciliation;
  }

  function recordException({ principal, instruction, transaction, reason, correlationId }) {
    const exception = {
      reconciliationId: `recon_${reconciliations.length + 1}`,
      organizationId: instruction.organizationId,
      projectId: instruction.projectId,
      commitmentId: instruction.commitmentId,
      instructionId: instruction.instructionId,
      bankTransactionId: transaction.bankTransactionId,
      bankTransactionIds: [transaction.bankTransactionId],
      matchType: RECONCILIATION_MATCH_TYPES.manual,
      settlementKind: null,
      appliedAmount: "0.0000",
      currency: instruction.currency,
      status: "Exception",
      reason,
      matchedByUserId: principal.user.userId,
      approvedByUserId: null,
      lockedByUserId: null,
      locked: false
    };
    reconciliations.push(exception);
    audit({
      principal,
      organizationId: instruction.organizationId,
      projectId: instruction.projectId,
      action: "payment.reconcile.exception",
      entityType: "Reconciliation",
      entityId: exception.reconciliationId,
      reason,
      correlationId
    });
    return { ...exception };
  }

  function approvedAppliedUnits({ organizationId, commitmentId }) {
    return reconciliations
      .filter((reconciliation) => (
        reconciliation.organizationId === organizationId &&
        reconciliation.commitmentId === commitmentId &&
        ["Approved", "Locked"].includes(reconciliation.status)
      ))
      .reduce((total, reconciliation) => total + toUnits(reconciliation.appliedAmount), 0n);
  }

  function resolveCollectionAccount({ organizationId, projectId, accountCode }) {
    if (accountCode) {
      const account = projectAccounts.find((candidate) => (
        candidate.organizationId === organizationId && candidate.accountCode === accountCode
      ));
      if (!account) {
        throw problem(404, "project_account_not_found", `Project account not found: ${accountCode}.`);
      }
      if (account.projectId !== projectId) {
        throw problem(409, "escrow_account_project_mismatch", "Project funds cannot be booked to another project's account.");
      }
      if (!COLLECTION_ACCOUNT_TYPES.includes(account.accountType)) {
        throw problem(409, "operating_account_collection_denied", "Investor collections must settle into an escrow or segregated project account.");
      }
      return account;
    }
    const primary = findPrimaryCollectionAccount({ organizationId, projectId });
    if (!primary) {
      throw problem(409, "primary_collection_account_missing", "Project has no primary escrow or segregated collection account.");
    }
    return primary;
  }

  function findPrimaryCollectionAccount({ organizationId, projectId }) {
    return projectAccounts.find((account) => (
      account.organizationId === organizationId &&
      account.projectId === projectId &&
      account.isPrimaryCollection &&
      account.status === "Active"
    ));
  }

  function transitionInstruction({ instruction, to }) {
    if (instruction.status === to) {
      return instruction;
    }
    if (!canTransition("paymentInstruction", instruction.status, to)) {
      throw problem(409, "invalid_instruction_transition", `Payment instruction cannot transition from ${instruction.status} to ${to}.`);
    }
    instruction.status = to;
    return instruction;
  }

  function transitionBankTransaction({ transaction, to }) {
    if (transaction.status === to) {
      return transaction;
    }
    if (!canTransition("bankTransaction", transaction.status, to)) {
      throw problem(409, "invalid_bank_transaction_transition", `Bank transaction cannot transition from ${transaction.status} to ${to}.`);
    }
    transaction.status = to;
    return transaction;
  }

  function transitionReconciliation({ reconciliation, to }) {
    if (!canTransition("reconciliation", reconciliation.status, to)) {
      throw problem(409, "invalid_reconciliation_transition", `Reconciliation cannot transition from ${reconciliation.status} to ${to}.`);
    }
    reconciliation.status = to;
    return reconciliation;
  }

  function transitionRefund({ refund, to }) {
    if (!canTransition("refund", refund.status, to)) {
      throw problem(409, "invalid_refund_transition", `Refund cannot transition from ${refund.status} to ${to}.`);
    }
    refund.status = to;
    return refund;
  }

  function findInstructionOrThrow({ organizationId, commitmentId }) {
    const instruction = paymentInstructions.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.commitmentId === commitmentId
    ));
    if (!instruction) {
      throw problem(404, "payment_instruction_not_found", "Payment instruction not found.");
    }
    return instruction;
  }

  function findBankTransactionOrThrow({ organizationId, bankTransactionId }) {
    const transaction = bankTransactions.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.bankTransactionId === bankTransactionId
    ));
    if (!transaction) {
      throw problem(404, "bank_transaction_not_found", "Bank transaction not found.");
    }
    return transaction;
  }

  function findReconciliationOrThrow({ organizationId, reconciliationId }) {
    const reconciliation = reconciliations.find((candidate) => (
      candidate.organizationId === organizationId &&
      candidate.reconciliationId === reconciliationId
    ));
    if (!reconciliation) {
      throw problem(404, "reconciliation_not_found", "Reconciliation not found.");
    }
    return reconciliation;
  }

  function findRefundOrThrow({ organizationId, refundId }) {
    const refund = refunds.find((candidate) => candidate.organizationId === organizationId && candidate.refundId === refundId);
    if (!refund) {
      throw problem(404, "refund_not_found", "Refund not found.");
    }
    return refund;
  }

  function once({ scope, idempotencyKey }, producer) {
    if (!idempotencyKey) {
      throw problem(400, "idempotency_key_required", "Idempotency key is required.");
    }
    const key = `${scope}:${idempotencyKey}`;
    if (idempotencyRecords.has(key)) {
      return idempotencyRecords.get(key);
    }
    const result = producer();
    idempotencyRecords.set(key, result);
    return result;
  }

  function audit({ principal, organizationId, projectId, action, entityType, entityId, reason, correlationId }) {
    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId,
      actorUserId: principal.user.userId,
      action,
      entityType,
      entityId,
      reason,
      correlationId
    }));
  }
}

export function signProviderCallback({ secret, providerId, timestamp, nonce, event, algorithm = "sha256" }) {
  return createHmac(algorithm, secret)
    .update(canonicalPayload({ providerId, timestamp, nonce, event }))
    .digest("hex");
}

export function createDefaultProjectAccounts() {
  return [
    {
      projectAccountId: "project_account_agro_escrow",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      accountCode: "ESCROW-AGRO-001",
      accountType: PROJECT_ACCOUNT_TYPES.escrow,
      bankName: "Synthetic Escrow Bank",
      accountFingerprint: "escrow_hash_agro_001",
      isPrimaryCollection: true,
      status: "Active"
    },
    {
      projectAccountId: "project_account_energy_escrow",
      organizationId: "org_demo",
      projectId: "project_energy_001",
      accountCode: "ESCROW-ENERGY-001",
      accountType: PROJECT_ACCOUNT_TYPES.segregatedProject,
      bankName: "Synthetic Escrow Bank",
      accountFingerprint: "escrow_hash_energy_001",
      isPrimaryCollection: true,
      status: "Active"
    },
    {
      projectAccountId: "project_account_agro_operating",
      organizationId: "org_demo",
      projectId: "project_agro_001",
      accountCode: "OPERATING-AGRO-001",
      accountType: PROJECT_ACCOUNT_TYPES.operating,
      bankName: "Synthetic Operating Bank",
      accountFingerprint: "operating_hash_agro_001",
      isPrimaryCollection: false,
      status: "Active"
    }
  ];
}

function verifySignature({ provider, timestamp, nonce, event, signature }) {
  if (typeof signature !== "string" || signature.length === 0) {
    return false;
  }
  const expected = signProviderCallback({
    secret: provider.secret,
    providerId: provider.providerId,
    timestamp,
    nonce,
    event,
    algorithm: provider.signatureAlgorithm
  });
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function canonicalPayload({ providerId, timestamp, nonce, event }) {
  return `${providerId}.${timestamp}.${nonce}.${canonicalJson(event)}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function maskAccount(account) {
  return {
    ...account,
    accountFingerprint: `masked:${account.accountFingerprint.slice(-4)}`
  };
}

function referenceOverlap(left, right) {
  if (!left || !right) {
    return 0;
  }
  const tokenise = (value) => new Set(String(value).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const leftTokens = tokenise(left);
  const rightTokens = tokenise(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function availableUnits(transaction) {
  return toUnits(transaction.amount) - toUnits(transaction.allocatedAmount);
}

function remainingUnits(instruction) {
  return toUnits(instruction.expectedAmount) - toUnits(instruction.settledAmount);
}

function maxUnits(left, right) {
  return left >= right ? left : right;
}

function toUnits(value) {
  const normalized = String(value ?? "0");
  const negative = normalized.startsWith("-");
  const [whole, fraction = ""] = (negative ? normalized.slice(1) : normalized).split(".");
  const units = BigInt(whole || "0") * UNIT_SCALE + BigInt((`${fraction}0000`).slice(0, 4));
  return negative ? units * -1n : units;
}

function fromUnits(units) {
  const negative = units < 0n;
  const absolute = negative ? units * -1n : units;
  const whole = absolute / UNIT_SCALE;
  const fraction = absolute % UNIT_SCALE;
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(4, "0")}`;
}

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
