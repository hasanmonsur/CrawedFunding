import {
  PERMISSIONS,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

const REQUIRED_KYC_DOCUMENT_TYPES = Object.freeze(["identity", "photo", "address", "bank"]);

export function createInvestorService({
  identity,
  investors = createMutableSyntheticInvestors(),
  kycCases = createMutableSyntheticKycCases(),
  documents = createMutableSyntheticDocuments(),
  bankAccounts = createMutableSyntheticBankAccounts(),
  nominees = createMutableSyntheticNominees(),
  consents = createMutableSyntheticConsents(),
  auditEvents = []
}) {
  return {
    getMyInvestorProfile,
    getInvestorProfileForReview,
    getInvestorSettlementProfile,
    updateProfile,
    addDocument,
    addBankAccount,
    addNominee,
    recordConsent,
    submitKyc,
    startReview,
    requestInformation,
    approveKyc,
    rejectKyc,
    placeHold,
    listReviewQueue,
    detectDuplicates,
    getAuditEvents: () => auditEvents.slice()
  };

  function getMyInvestorProfile({ principal }) {
    const investor = findInvestorByUserOrThrow(principal.user.userId);
    return buildProfile(investor);
  }

  function getInvestorProfileForReview({ principal, organizationId, investorId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorKycReview,
      organizationId
    });
    return buildProfile(findInvestorOrThrow({ organizationId, investorId }));
  }

  function getInvestorSettlementProfile({ organizationId, investorId }) {
    const investor = findInvestorOrThrow({ organizationId, investorId });
    const payoutAccount = bankAccounts.find((account) => account.investorId === investorId);
    return {
      organizationId,
      investorId,
      kycStatus: investor.kycStatus,
      holdStatus: investor.holdStatus,
      hasPayoutAccount: Boolean(payoutAccount),
      payoutAccountRef: payoutAccount ? maskBankAccount(payoutAccount).accountFingerprint : null
    };
  }

  function updateProfile({ principal, organizationId, investorId, patch, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorProfileManage,
      organizationId
    });
    const investor = findInvestorForSelfOrThrow({ principal, organizationId, investorId });
    const allowed = ["fullName", "mobile", "email", "occupation", "incomeBand", "taxIdentifier", "sourceOfFunds"];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        investor[key] = patch[key];
      }
    }
    investor.version += 1;
    audit({ principal, organizationId, action: "investor.profile.update", entityType: "Investor", entityId: investorId, correlationId });
    return buildProfile(investor);
  }

  function addDocument({ principal, organizationId, investorId, documentType, documentRef, expiresAt, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorProfileManage,
      organizationId
    });
    findInvestorForSelfOrThrow({ principal, organizationId, investorId });
    const document = {
      documentId: `doc_inv_${documents.length + 1}`,
      organizationId,
      investorId,
      documentType,
      documentRef,
      status: "Uploaded",
      expiresAt: expiresAt ?? null
    };
    documents.push(document);
    audit({ principal, organizationId, action: "investor.document.upload", entityType: "InvestorDocument", entityId: document.documentId, correlationId });
    return { ...document };
  }

  function addBankAccount({ principal, organizationId, investorId, bankName, accountName, accountFingerprint, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorProfileManage,
      organizationId
    });
    findInvestorForSelfOrThrow({ principal, organizationId, investorId });
    const duplicate = bankAccounts.find((account) => (
      account.organizationId === organizationId &&
      account.accountFingerprint === accountFingerprint &&
      account.investorId !== investorId
    ));
    if (duplicate) {
      throw Object.assign(new Error("Bank account fingerprint is already linked to another investor."), {
        status: 409,
        code: "duplicate_bank_account"
      });
    }
    const bankAccount = {
      bankAccountId: `bank_${bankAccounts.length + 1}`,
      organizationId,
      investorId,
      bankName,
      accountName,
      accountFingerprint,
      status: "Pending Verification"
    };
    bankAccounts.push(bankAccount);
    audit({ principal, organizationId, action: "investor.bank_account.add", entityType: "BankAccount", entityId: bankAccount.bankAccountId, correlationId });
    return { ...bankAccount };
  }

  function addNominee({ principal, organizationId, investorId, fullName, relationship, mobile, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorProfileManage,
      organizationId
    });
    findInvestorForSelfOrThrow({ principal, organizationId, investorId });
    const nominee = {
      nomineeId: `nominee_${nominees.length + 1}`,
      organizationId,
      investorId,
      fullName,
      relationship,
      mobile
    };
    nominees.push(nominee);
    audit({ principal, organizationId, action: "investor.nominee.add", entityType: "Nominee", entityId: nominee.nomineeId, correlationId });
    return { ...nominee };
  }

  function recordConsent({ principal, organizationId, investorId, consentType, version, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorProfileManage,
      organizationId
    });
    findInvestorForSelfOrThrow({ principal, organizationId, investorId });
    const consent = {
      consentId: `consent_${consents.length + 1}`,
      organizationId,
      investorId,
      consentType,
      version,
      status: "Accepted"
    };
    consents.push(consent);
    audit({ principal, organizationId, action: "investor.consent.accept", entityType: "Consent", entityId: consent.consentId, correlationId });
    return { ...consent };
  }

  function submitKyc({ principal, organizationId, investorId, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorKycSubmit,
      organizationId
    });
    const investor = findInvestorForSelfOrThrow({ principal, organizationId, investorId });
    const kycCase = findKycCaseOrThrow({ organizationId, investorId });
    assertKycSubmissionReady({ organizationId, investorId });
    transitionKyc({ principal, kycCase, to: "Submitted", action: "investor.kyc.submit", correlationId });
    investor.kycStatus = kycCase.status;
    return buildProfile(investor);
  }

  function startReview({ principal, organizationId, investorId, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorKycReview,
      organizationId
    });
    const kycCase = findKycCaseOrThrow({ organizationId, investorId });
    return transitionKyc({ principal, kycCase, to: "Under Review", action: "investor.kyc.start_review", correlationId });
  }

  function requestInformation({ principal, organizationId, investorId, reason, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorKycReview,
      organizationId
    });
    const kycCase = findKycCaseOrThrow({ organizationId, investorId });
    kycCase.reviewNotes.push({ reason, reviewerUserId: principal.user.userId });
    return transitionKyc({ principal, kycCase, to: "Information Required", action: "investor.kyc.request_information", correlationId, reason });
  }

  function approveKyc({ principal, organizationId, investorId, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorKycReview,
      organizationId
    });
    const investor = findInvestorOrThrow({ organizationId, investorId });
    const kycCase = findKycCaseOrThrow({ organizationId, investorId });
    const duplicateSignals = detectDuplicates({ principal, organizationId, investorId });
    if (duplicateSignals.length > 0) {
      throw Object.assign(new Error("Duplicate signals must be resolved before KYC approval."), {
        status: 409,
        code: "duplicate_review_required"
      });
    }
    const updated = transitionKyc({ principal, kycCase, to: "Approved", action: "investor.kyc.approve", correlationId });
    investor.kycStatus = updated.status;
    investor.holdStatus = "None";
    return updated;
  }

  function rejectKyc({ principal, organizationId, investorId, reason, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorKycReview,
      organizationId
    });
    const investor = findInvestorOrThrow({ organizationId, investorId });
    const kycCase = findKycCaseOrThrow({ organizationId, investorId });
    const updated = transitionKyc({ principal, kycCase, to: "Rejected", action: "investor.kyc.reject", correlationId, reason });
    investor.kycStatus = updated.status;
    return updated;
  }

  function placeHold({ principal, organizationId, investorId, reason, correlationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorHoldManage,
      organizationId
    });
    const investor = findInvestorOrThrow({ organizationId, investorId });
    investor.holdStatus = "Compliance Hold";
    investor.holdReason = reason;
    audit({ principal, organizationId, action: "investor.hold.place", entityType: "Investor", entityId: investorId, reason, correlationId });
    return buildProfile(investor);
  }

  function listReviewQueue({ principal, organizationId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorKycReview,
      organizationId
    });
    return kycCases
      .filter((kycCase) => kycCase.organizationId === organizationId && ["Submitted", "Under Review", "Information Required"].includes(kycCase.status))
      .map((kycCase) => ({ ...kycCase, reviewNotes: kycCase.reviewNotes.map((note) => ({ ...note })) }));
  }

  function detectDuplicates({ principal, organizationId, investorId }) {
    identity.requirePermission({
      principal,
      permission: PERMISSIONS.investorKycReview,
      organizationId
    });
    const investor = findInvestorOrThrow({ organizationId, investorId });
    const signals = [];
    for (const other of investors) {
      if (other.organizationId !== organizationId || other.investorId === investorId) {
        continue;
      }
      if (other.identityFingerprint === investor.identityFingerprint) {
        signals.push({ type: "identity", matchedInvestorId: other.investorId });
      }
      if (other.mobile === investor.mobile) {
        signals.push({ type: "mobile", matchedInvestorId: other.investorId });
      }
      if (other.email === investor.email) {
        signals.push({ type: "email", matchedInvestorId: other.investorId });
      }
    }
    for (const account of bankAccounts.filter((item) => item.organizationId === organizationId && item.investorId === investorId)) {
      const duplicate = bankAccounts.find((item) => (
        item.organizationId === organizationId &&
        item.investorId !== investorId &&
        item.accountFingerprint === account.accountFingerprint
      ));
      if (duplicate) {
        signals.push({ type: "bank_account", matchedInvestorId: duplicate.investorId });
      }
    }
    return signals;
  }

  function assertKycSubmissionReady({ organizationId, investorId }) {
    const investorDocuments = documents.filter((document) => document.organizationId === organizationId && document.investorId === investorId);
    const missingDocuments = REQUIRED_KYC_DOCUMENT_TYPES.filter((type) => !investorDocuments.some((document) => document.documentType === type));
    if (missingDocuments.length > 0) {
      throw Object.assign(new Error(`Missing KYC documents: ${missingDocuments.join(", ")}.`), {
        status: 409,
        code: "kyc_documents_incomplete"
      });
    }
    if (!bankAccounts.some((account) => account.organizationId === organizationId && account.investorId === investorId)) {
      throw Object.assign(new Error("At least one bank account is required before KYC submission."), {
        status: 409,
        code: "bank_account_required"
      });
    }
    if (!consents.some((consent) => consent.organizationId === organizationId && consent.investorId === investorId && consent.consentType === "privacy_notice")) {
      throw Object.assign(new Error("Privacy notice consent is required before KYC submission."), {
        status: 409,
        code: "privacy_consent_required"
      });
    }
    if (!consents.some((consent) => consent.organizationId === organizationId && consent.investorId === investorId && consent.consentType === "risk_acknowledgement")) {
      throw Object.assign(new Error("Risk acknowledgement is required before KYC submission."), {
        status: 409,
        code: "risk_consent_required"
      });
    }
  }

  function transitionKyc({ principal, kycCase, to, action, correlationId, reason }) {
    if (!canTransition("kyc", kycCase.status, to)) {
      throw Object.assign(new Error(`KYC cannot transition from ${kycCase.status} to ${to}.`), {
        status: 409,
        code: "invalid_kyc_transition"
      });
    }
    kycCase.status = to;
    kycCase.version += 1;
    kycCase.updatedByUserId = principal.user.userId;
    audit({
      principal,
      organizationId: kycCase.organizationId,
      action,
      entityType: "KycCase",
      entityId: kycCase.kycCaseId,
      reason,
      correlationId
    });
    return { ...kycCase, reviewNotes: kycCase.reviewNotes.map((note) => ({ ...note })) };
  }

  function buildProfile(investor) {
    return {
      ...investor,
      documents: documents.filter((document) => document.investorId === investor.investorId).map((document) => ({ ...document })),
      bankAccounts: bankAccounts.filter((account) => account.investorId === investor.investorId).map(maskBankAccount),
      nominees: nominees.filter((nominee) => nominee.investorId === investor.investorId).map((nominee) => ({ ...nominee })),
      consents: consents.filter((consent) => consent.investorId === investor.investorId).map((consent) => ({ ...consent })),
      kycCase: { ...findKycCaseOrThrow({ organizationId: investor.organizationId, investorId: investor.investorId }) }
    };
  }

  function maskBankAccount(account) {
    return {
      ...account,
      accountFingerprint: `masked:${account.accountFingerprint.slice(-4)}`
    };
  }

  function findInvestorByUserOrThrow(userId) {
    const investor = investors.find((candidate) => candidate.userId === userId);
    if (!investor) {
      throw Object.assign(new Error("Investor profile not found for current user."), {
        status: 404,
        code: "investor_profile_not_found"
      });
    }
    return investor;
  }

  function findInvestorForSelfOrThrow({ principal, organizationId, investorId }) {
    const investor = findInvestorOrThrow({ organizationId, investorId });
    if (investor.userId !== principal.user.userId) {
      throw Object.assign(new Error("Investor can only manage their own profile."), {
        status: 403,
        code: "investor_self_scope_denied"
      });
    }
    return investor;
  }

  function findInvestorOrThrow({ organizationId, investorId }) {
    const investor = investors.find((candidate) => candidate.organizationId === organizationId && candidate.investorId === investorId);
    if (!investor) {
      throw Object.assign(new Error("Investor not found."), { status: 404, code: "investor_not_found" });
    }
    return investor;
  }

  function findKycCaseOrThrow({ organizationId, investorId }) {
    const kycCase = kycCases.find((candidate) => candidate.organizationId === organizationId && candidate.investorId === investorId);
    if (!kycCase) {
      throw Object.assign(new Error("KYC case not found."), { status: 404, code: "kyc_case_not_found" });
    }
    return kycCase;
  }

  function audit({ principal, organizationId, action, entityType, entityId, reason, correlationId }) {
    auditEvents.push(buildAuditEvent({
      organizationId,
      actorUserId: principal.user.userId,
      action,
      entityType,
      entityId,
      reason,
      correlationId
    }));
  }
}

export function createMutableSyntheticInvestors() {
  return [
    {
      organizationId: "org_demo",
      investorId: "investor_001",
      userId: "user_investor_001",
      investorType: "Individual",
      fullName: "Synthetic Investor One",
      mobile: "+8801700000001",
      email: "investor1@example.test",
      identityFingerprint: "nid_hash_001",
      occupation: "Business Owner",
      incomeBand: "BDT_100K_250K",
      sourceOfFunds: "Business income",
      kycStatus: "Draft",
      holdStatus: "None",
      version: 1
    },
    {
      organizationId: "org_demo",
      investorId: "investor_duplicate_001",
      userId: "user_investor_duplicate_001",
      investorType: "Individual",
      fullName: "Synthetic Duplicate Investor",
      mobile: "+8801700000002",
      email: "investor2@example.test",
      identityFingerprint: "nid_hash_001",
      occupation: "Service",
      incomeBand: "BDT_50K_100K",
      sourceOfFunds: "Salary",
      kycStatus: "Draft",
      holdStatus: "None",
      version: 1
    },
    {
      organizationId: "org_demo",
      investorId: "investor_approved_001",
      userId: "user_investor_approved_001",
      investorType: "Individual",
      fullName: "Synthetic Approved Investor",
      mobile: "+8801700000003",
      email: "approved-investor@example.test",
      identityFingerprint: "nid_hash_approved_001",
      occupation: "Professional",
      incomeBand: "BDT_250K_500K",
      sourceOfFunds: "Professional income",
      kycStatus: "Approved",
      holdStatus: "None",
      version: 1
    }
  ];
}

export function createMutableSyntheticKycCases() {
  return [
    {
      organizationId: "org_demo",
      investorId: "investor_001",
      kycCaseId: "kyc_001",
      status: "Draft",
      riskRating: "Unrated",
      reviewNotes: [],
      version: 1
    },
    {
      organizationId: "org_demo",
      investorId: "investor_duplicate_001",
      kycCaseId: "kyc_duplicate_001",
      status: "Draft",
      riskRating: "Unrated",
      reviewNotes: [],
      version: 1
    },
    {
      organizationId: "org_demo",
      investorId: "investor_approved_001",
      kycCaseId: "kyc_approved_001",
      status: "Approved",
      riskRating: "Medium",
      reviewNotes: [],
      version: 2
    }
  ];
}

export function createMutableSyntheticDocuments() {
  return [
    { organizationId: "org_demo", investorId: "investor_001", documentId: "doc_identity_001", documentType: "identity", documentRef: "object://synthetic/id", status: "Uploaded", expiresAt: null },
    { organizationId: "org_demo", investorId: "investor_001", documentId: "doc_photo_001", documentType: "photo", documentRef: "object://synthetic/photo", status: "Uploaded", expiresAt: null },
    { organizationId: "org_demo", investorId: "investor_001", documentId: "doc_address_001", documentType: "address", documentRef: "object://synthetic/address", status: "Uploaded", expiresAt: null }
  ];
}

export function createMutableSyntheticBankAccounts() {
  return [
    {
      bankAccountId: "bank_seed_approved_001",
      organizationId: "org_demo",
      investorId: "investor_approved_001",
      bankName: "Synthetic Settlement Bank",
      accountName: "Synthetic Approved Investor",
      accountFingerprint: "bank_hash_approved_9001",
      status: "Verified"
    }
  ];
}

export function createMutableSyntheticNominees() {
  return [];
}

export function createMutableSyntheticConsents() {
  return [];
}
