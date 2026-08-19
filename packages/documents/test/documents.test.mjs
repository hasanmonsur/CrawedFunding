import assert from "node:assert/strict";
import { test } from "node:test";
import { createDocumentService, hashContent, maskValue } from "../src/index.js";
import { createIdentityService } from "../../identity/src/index.js";
import { createInvestorService } from "../../investors/src/index.js";

const ORG = "org_demo";
const PROJECT = "project_agro_001";

test("documents are versioned, superseded, and immutable in place", () => {
  const { service, admin } = harness();

  const document = service.registerDocument({
    principal: admin,
    organizationId: ORG,
    projectId: PROJECT,
    documentType: "Agreement",
    title: "Investor subscription agreement",
    documentRef: "object://synthetic/agreement-v1",
    contentHash: hashContent("agreement v1"),
    classification: "Confidential",
    correlationId: "corr_register"
  });
  assert.equal(document.status, "Active");
  assert.equal(document.currentVersion, 1);

  assert.throws(() => service.addDocumentVersion({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    documentRef: "object://synthetic/agreement-v2",
    contentHash: hashContent("agreement v2"),
    correlationId: "corr_version_no_reason"
  }), /requires a documented reason/);

  const updated = service.addDocumentVersion({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    documentRef: "object://synthetic/agreement-v2",
    contentHash: hashContent("agreement v2"),
    reason: "Counsel revised clause 7.",
    correlationId: "corr_version"
  });
  assert.equal(updated.currentVersion, 2);

  const stored = service.getDocument({ principal: admin, organizationId: ORG, documentId: document.documentId });
  assert.equal(stored.versions.length, 2);
  assert.equal(stored.versions[0].status, "Superseded");
  assert.equal(stored.versions[1].status, "Active");
  assert.notEqual(stored.versions[0].contentHash, stored.versions[1].contentHash);
});

test("download grants expire, are single use, and are bound to their issuer", () => {
  let now = new Date("2026-08-20T10:00:00.000Z");
  const { service, admin, auditor } = harness({ clock: () => now });

  const document = service.registerDocument({
    principal: admin,
    organizationId: ORG,
    projectId: PROJECT,
    documentType: "Evidence",
    title: "Milestone completion evidence",
    documentRef: "object://synthetic/evidence",
    contentHash: hashContent("evidence"),
    classification: "Internal",
    correlationId: "corr_evidence"
  });

  assert.throws(() => service.createDownloadGrant({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    expiresInSeconds: 300,
    correlationId: "corr_no_purpose"
  }), /requires a stated purpose/);

  assert.throws(() => service.createDownloadGrant({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    purpose: "audit",
    expiresInSeconds: 99999,
    correlationId: "corr_bad_expiry"
  }), /expire between 1 and 3600 seconds/);

  const grant = service.createDownloadGrant({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    purpose: "Internal audit sample",
    expiresInSeconds: 300,
    correlationId: "corr_grant"
  });
  assert.match(grant.watermark, /Issued to user_admin_001/);
  assert.match(grant.watermark, /Purpose Internal audit sample/);

  assert.throws(() => service.redeemDownloadGrant({
    token: grant.token,
    actorUserId: "user_compliance_001",
    correlationId: "corr_wrong_actor"
  }), /only be redeemed by the user it was issued to/);

  const download = service.redeemDownloadGrant({
    token: grant.token,
    actorUserId: "user_admin_001",
    correlationId: "corr_download"
  });
  assert.equal(download.documentRef, "object://synthetic/evidence");
  assert.equal(download.remainingDownloads, 0);

  assert.throws(() => service.redeemDownloadGrant({
    token: grant.token,
    actorUserId: "user_admin_001",
    correlationId: "corr_download_again"
  }), /already been used/);

  const expiring = service.createDownloadGrant({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    purpose: "Expiry check",
    expiresInSeconds: 60,
    correlationId: "corr_grant_expiry"
  });
  now = new Date("2026-08-20T10:05:00.000Z");
  assert.throws(() => service.redeemDownloadGrant({
    token: expiring.token,
    actorUserId: "user_admin_001",
    correlationId: "corr_expired"
  }), /has expired/);

  const log = service.listAccessLog({ principal: auditor, organizationId: ORG, projectId: PROJECT, documentId: document.documentId });
  assert.deepEqual(log.map((entry) => entry.outcome), ["Downloaded", "Exhausted", "Expired"]);
});

test("restricted documents are watermarked and their extracted fields are masked", () => {
  const { service, admin, compliance } = harness();

  const document = service.registerDocument({
    principal: admin,
    organizationId: ORG,
    projectId: PROJECT,
    documentType: "KYC",
    title: "Synthetic identity document",
    documentRef: "object://synthetic/kyc",
    contentHash: hashContent("kyc"),
    classification: "Restricted Identity",
    investorId: "investor_001",
    correlationId: "corr_kyc"
  });

  const extraction = service.recordExtraction({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    documentVersionId: document.currentVersionId,
    engine: "synthetic-ocr",
    confidence: "0.9100",
    fields: { identityFingerprint: "nid_hash_000123456", fullName: "Synthetic Investor One" },
    correlationId: "corr_extract"
  });
  assert.equal(extraction.status, "Extracted");
  assert.equal(extraction.authoritative, false);

  const read = service.getDocument({ principal: compliance, organizationId: ORG, documentId: document.documentId });
  assert.equal(read.extractions[0].fields.identityFingerprint, maskValue("nid_hash_000123456"));
  assert.match(read.extractions[0].fields.fullName, /^\*+ One$/);

  assert.throws(() => service.verifyExtraction({
    principal: admin,
    organizationId: ORG,
    extractionId: extraction.extractionId,
    correlationId: "corr_self_verify"
  }), /not allowed to perform document-extraction:verify/);

  const corrected = service.correctExtraction({
    principal: compliance,
    organizationId: ORG,
    extractionId: extraction.extractionId,
    fields: { fullName: "Synthetic Investor One Corrected" },
    reason: "OCR misread the surname.",
    correlationId: "corr_correct"
  });
  assert.equal(corrected.status, "Corrected");
  assert.equal(corrected.authoritative, false);

  const verified = service.verifyExtraction({
    principal: compliance,
    organizationId: ORG,
    extractionId: extraction.extractionId,
    correlationId: "corr_verify"
  });
  assert.equal(verified.status, "Verified");
  assert.equal(verified.authoritative, true);
  assert.equal(verified.verifiedByUserId, "user_compliance_001");

  const grant = service.createDownloadGrant({
    principal: compliance,
    organizationId: ORG,
    documentId: document.documentId,
    purpose: "Compliance review",
    correlationId: "corr_restricted_grant"
  });
  assert.equal(grant.masked, true);
  assert.match(grant.watermark, /Restricted Identity/);
});

test("investors can only reach their own documents", () => {
  const { service, admin, investor } = harness();

  const mine = service.registerDocument({
    principal: admin,
    organizationId: ORG,
    documentType: "Statement",
    title: "Investor statement",
    documentRef: "object://synthetic/statement-mine",
    contentHash: hashContent("mine"),
    classification: "Confidential",
    investorId: "investor_approved_001",
    correlationId: "corr_mine"
  });
  const theirs = service.registerDocument({
    principal: admin,
    organizationId: ORG,
    documentType: "Statement",
    title: "Another investor statement",
    documentRef: "object://synthetic/statement-theirs",
    contentHash: hashContent("theirs"),
    classification: "Confidential",
    investorId: "investor_001",
    correlationId: "corr_theirs"
  });

  const visible = service.listDocuments({ principal: investor, organizationId: ORG });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].documentId, mine.documentId);

  assert.throws(() => service.getDocument({
    principal: investor,
    organizationId: ORG,
    documentId: theirs.documentId
  }), /only read their own documents/);

  assert.throws(() => service.registerDocument({
    principal: investor,
    organizationId: ORG,
    documentType: "Statement",
    title: "Self-registered",
    documentRef: "object://synthetic/self",
    contentHash: hashContent("self"),
    correlationId: "corr_investor_register"
  }), /not allowed to perform document:manage/);
});

test("unknown document types, classifications, and withdrawn documents are refused", () => {
  const { service, admin } = harness();

  assert.throws(() => service.registerDocument({
    principal: admin,
    organizationId: ORG,
    documentType: "Poster",
    title: "Bad type",
    documentRef: "object://synthetic/x",
    contentHash: hashContent("x"),
    correlationId: "corr_bad_type"
  }), /Unsupported document type/);

  assert.throws(() => service.registerDocument({
    principal: admin,
    organizationId: ORG,
    documentType: "Invoice",
    title: "Bad classification",
    documentRef: "object://synthetic/x",
    contentHash: hashContent("x"),
    classification: "Top Secret",
    correlationId: "corr_bad_classification"
  }), /Unsupported data classification/);

  const document = service.registerDocument({
    principal: admin,
    organizationId: ORG,
    projectId: PROJECT,
    documentType: "Invoice",
    title: "Vendor invoice",
    documentRef: "object://synthetic/invoice",
    contentHash: hashContent("invoice"),
    correlationId: "corr_invoice"
  });
  service.withdrawDocument({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    reason: "Superseded by a corrected vendor invoice.",
    correlationId: "corr_withdraw"
  });
  assert.throws(() => service.addDocumentVersion({
    principal: admin,
    organizationId: ORG,
    documentId: document.documentId,
    documentRef: "object://synthetic/invoice-2",
    contentHash: hashContent("invoice 2"),
    reason: "Late correction",
    correlationId: "corr_withdrawn_version"
  }), /Withdrawn document cannot accept new versions/);
});

function harness({ clock = () => new Date("2026-08-20T10:00:00.000Z") } = {}) {
  const identity = createIdentityService();
  const investorService = createInvestorService({ identity });
  const service = createDocumentService({ identity, investorService, clock });
  return {
    identity,
    service,
    admin: identity.authenticate("Bearer demo-token-project-admin"),
    compliance: identity.authenticate("Bearer demo-token-compliance"),
    investor: identity.authenticate("Bearer demo-token-investor-approved"),
    auditor: identity.authenticate("Bearer demo-token-auditor")
  };
}
