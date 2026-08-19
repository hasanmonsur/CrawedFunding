import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentityService } from "../../identity/src/index.js";
import { createInvestorService } from "../src/index.js";

test("investor profile requires self scope", () => {
  const identity = createIdentityService();
  const investorPrincipal = identity.authenticate("Bearer demo-token-investor");
  const service = createInvestorService({ identity });

  const profile = service.getMyInvestorProfile({ principal: investorPrincipal });
  assert.equal(profile.investorId, "investor_001");
  assert.equal(profile.bankAccounts.length, 0);

  assert.throws(() => service.updateProfile({
    principal: investorPrincipal,
    organizationId: "org_demo",
    investorId: "investor_duplicate_001",
    patch: { fullName: "Not Allowed" },
    correlationId: "corr_profile"
  }), /own profile/);
});

test("kyc submission requires documents, bank account, and consents", () => {
  const identity = createIdentityService();
  const principal = identity.authenticate("Bearer demo-token-investor");
  const service = createInvestorService({ identity });

  assert.throws(() => service.submitKyc({
    principal,
    organizationId: "org_demo",
    investorId: "investor_001",
    correlationId: "corr_submit"
  }), /Missing KYC documents: bank/);

  service.addDocument({
    principal,
    organizationId: "org_demo",
    investorId: "investor_001",
    documentType: "bank",
    documentRef: "object://synthetic/bank",
    correlationId: "corr_doc"
  });

  assert.throws(() => service.submitKyc({
    principal,
    organizationId: "org_demo",
    investorId: "investor_001",
    correlationId: "corr_submit"
  }), /bank account/);

  service.addBankAccount({
    principal,
    organizationId: "org_demo",
    investorId: "investor_001",
    bankName: "Synthetic Bank",
    accountName: "Synthetic Investor One",
    accountFingerprint: "bank_hash_001",
    correlationId: "corr_bank"
  });
  service.recordConsent({ principal, organizationId: "org_demo", investorId: "investor_001", consentType: "privacy_notice", version: "v1", correlationId: "corr_privacy" });
  service.recordConsent({ principal, organizationId: "org_demo", investorId: "investor_001", consentType: "risk_acknowledgement", version: "v1", correlationId: "corr_risk" });

  const profile = service.submitKyc({
    principal,
    organizationId: "org_demo",
    investorId: "investor_001",
    correlationId: "corr_submit"
  });

  assert.equal(profile.kycStatus, "Submitted");
});

test("compliance review blocks approval when duplicate signals exist", () => {
  const identity = createIdentityService();
  const investorPrincipal = identity.authenticate("Bearer demo-token-investor");
  const compliance = identity.authenticate("Bearer demo-token-compliance");
  const service = createInvestorService({ identity });

  service.addDocument({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", documentType: "bank", documentRef: "object://synthetic/bank", correlationId: "corr_doc" });
  service.addBankAccount({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", bankName: "Synthetic Bank", accountName: "Synthetic Investor One", accountFingerprint: "bank_hash_001", correlationId: "corr_bank" });
  service.recordConsent({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", consentType: "privacy_notice", version: "v1", correlationId: "corr_privacy" });
  service.recordConsent({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", consentType: "risk_acknowledgement", version: "v1", correlationId: "corr_risk" });
  service.submitKyc({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", correlationId: "corr_submit" });
  service.startReview({ principal: compliance, organizationId: "org_demo", investorId: "investor_001", correlationId: "corr_review" });

  const duplicates = service.detectDuplicates({ principal: compliance, organizationId: "org_demo", investorId: "investor_001" });
  assert.equal(duplicates[0].type, "identity");
  assert.throws(() => service.approveKyc({
    principal: compliance,
    organizationId: "org_demo",
    investorId: "investor_001",
    correlationId: "corr_approve"
  }), /Duplicate signals/);
});

test("compliance can request information and place account hold", () => {
  const identity = createIdentityService();
  const investorPrincipal = identity.authenticate("Bearer demo-token-investor");
  const compliance = identity.authenticate("Bearer demo-token-compliance");
  const service = createInvestorService({ identity });

  service.addDocument({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", documentType: "bank", documentRef: "object://synthetic/bank", correlationId: "corr_doc" });
  service.addBankAccount({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", bankName: "Synthetic Bank", accountName: "Synthetic Investor One", accountFingerprint: "bank_hash_001", correlationId: "corr_bank" });
  service.recordConsent({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", consentType: "privacy_notice", version: "v1", correlationId: "corr_privacy" });
  service.recordConsent({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", consentType: "risk_acknowledgement", version: "v1", correlationId: "corr_risk" });
  service.submitKyc({ principal: investorPrincipal, organizationId: "org_demo", investorId: "investor_001", correlationId: "corr_submit" });
  service.startReview({ principal: compliance, organizationId: "org_demo", investorId: "investor_001", correlationId: "corr_review" });

  const infoRequired = service.requestInformation({
    principal: compliance,
    organizationId: "org_demo",
    investorId: "investor_001",
    reason: "Synthetic source-of-funds clarification required",
    correlationId: "corr_info"
  });
  assert.equal(infoRequired.status, "Information Required");

  const held = service.placeHold({
    principal: compliance,
    organizationId: "org_demo",
    investorId: "investor_001",
    reason: "Synthetic suspicious signal",
    correlationId: "corr_hold"
  });
  assert.equal(held.holdStatus, "Compliance Hold");
});
