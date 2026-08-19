import { createHash, randomUUID } from "node:crypto";
import {
  DATA_CLASSIFICATIONS,
  DOCUMENT_TYPES,
  PERMISSIONS,
  assertFourEyes,
  buildAuditEvent,
  canTransition
} from "../../domain-contracts/src/index.js";

const MASKED_CLASSIFICATIONS = Object.freeze([
  DATA_CLASSIFICATIONS.restrictedIdentity,
  DATA_CLASSIFICATIONS.restrictedFinancial
]);

export function createDocumentService({
  identity,
  investorService = null,
  documents = [],
  documentVersions = [],
  extractions = [],
  downloadGrants = [],
  accessLog = [],
  clock = () => new Date(),
  newToken = () => randomUUID(),
  auditEvents = []
}) {
  return {
    registerDocument,
    addDocumentVersion,
    withdrawDocument,
    getDocument,
    listDocuments,
    recordExtraction,
    correctExtraction,
    verifyExtraction,
    createDownloadGrant,
    redeemDownloadGrant,
    listAccessLog,
    getAuditEvents: () => auditEvents.slice()
  };

  function registerDocument({
    principal,
    organizationId,
    projectId,
    documentType,
    title,
    documentRef,
    contentHash,
    classification = DATA_CLASSIFICATIONS.confidential,
    investorId,
    commitmentId,
    milestoneId,
    retentionYears = 7,
    correlationId
  }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.documentManage, organizationId, projectId });
    assertDocumentType(documentType);
    assertClassification(classification);
    if (!title || !documentRef || !contentHash) {
      throw problem(400, "document_details_required", "Document title, storage reference, and content hash are required.");
    }
    const document = {
      documentId: `document_${documents.length + 1}`,
      organizationId,
      projectId: projectId ?? null,
      documentType,
      title,
      classification,
      investorId: investorId ?? null,
      commitmentId: commitmentId ?? null,
      milestoneId: milestoneId ?? null,
      retentionYears,
      status: "Draft",
      currentVersion: 0,
      createdByUserId: principal.user.userId,
      createdAt: clock().toISOString()
    };
    documents.push(document);
    const version = appendVersion({ principal, document, documentRef, contentHash, correlationId });
    document.status = "Active";
    audit({ principal, organizationId, projectId, action: "document.register", entityType: "Document", entityId: document.documentId, correlationId });
    return { ...document, currentVersionId: version.documentVersionId };
  }

  function addDocumentVersion({ principal, organizationId, documentId, documentRef, contentHash, reason, correlationId }) {
    const document = findDocumentOrThrow({ organizationId, documentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.documentManage, organizationId, projectId: document.projectId ?? undefined });
    if (document.status !== "Active") {
      throw problem(409, "document_not_active", `A ${document.status} document cannot accept new versions.`);
    }
    if (!reason) {
      throw problem(400, "document_version_reason_required", "A new document version requires a documented reason.");
    }
    const version = appendVersion({ principal, document, documentRef, contentHash, reason, correlationId });
    audit({ principal, organizationId, projectId: document.projectId, action: "document.version.add", entityType: "Document", entityId: documentId, reason, correlationId });
    return { ...document, currentVersionId: version.documentVersionId };
  }

  function withdrawDocument({ principal, organizationId, documentId, reason, correlationId }) {
    const document = findDocumentOrThrow({ organizationId, documentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.documentManage, organizationId, projectId: document.projectId ?? undefined });
    if (!reason) {
      throw problem(400, "document_withdraw_reason_required", "Withdrawing a document requires a documented reason.");
    }
    transitionDocument({ document, to: "Withdrawn" });
    document.withdrawnReason = reason;
    audit({ principal, organizationId, projectId: document.projectId, action: "document.withdraw", entityType: "Document", entityId: documentId, reason, correlationId });
    return { ...document };
  }

  function getDocument({ principal, organizationId, documentId }) {
    const document = findDocumentOrThrow({ organizationId, documentId });
    assertReadable({ principal, organizationId, document });
    return {
      ...document,
      versions: versionsFor(document).map((version) => ({ ...version })),
      extractions: extractions
        .filter((extraction) => extraction.documentId === documentId)
        .map((extraction) => ({ ...extraction, fields: maskExtractionFields(extraction, document) }))
    };
  }

  function listDocuments({ principal, organizationId, projectId, documentType, investorId }) {
    requireReadAccess({ principal, organizationId, projectId });
    const investorScope = resolveInvestorScope({ principal, organizationId });
    return documents
      .filter((document) => document.organizationId === organizationId)
      .filter((document) => !projectId || document.projectId === projectId)
      .filter((document) => !documentType || document.documentType === documentType)
      .filter((document) => !investorId || document.investorId === investorId)
      .filter((document) => !investorScope || document.investorId === investorScope)
      .map((document) => ({ ...document }));
  }

  function recordExtraction({ principal, organizationId, documentId, documentVersionId, fields, engine = "synthetic-ocr", confidence = "0.0000", correlationId }) {
    const document = findDocumentOrThrow({ organizationId, documentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.documentManage, organizationId, projectId: document.projectId ?? undefined });
    const version = versionsFor(document).find((candidate) => candidate.documentVersionId === documentVersionId);
    if (!version) {
      throw problem(404, "document_version_not_found", "Document version not found.");
    }
    const extraction = {
      extractionId: `extraction_${extractions.length + 1}`,
      organizationId,
      documentId,
      documentVersionId,
      engine,
      confidence,
      fields: { ...fields },
      status: "Extracted",
      // Extraction is machine output. It is never authoritative until a human verifies it.
      authoritative: false,
      extractedByUserId: principal.user.userId,
      verifiedByUserId: null,
      verifiedAt: null
    };
    extractions.push(extraction);
    audit({ principal, organizationId, projectId: document.projectId, action: "document.extraction.record", entityType: "DocumentExtraction", entityId: extraction.extractionId, correlationId });
    return { ...extraction, fields: { ...extraction.fields } };
  }

  function correctExtraction({ principal, organizationId, extractionId, fields, reason, correlationId }) {
    const extraction = findExtractionOrThrow({ organizationId, extractionId });
    const document = findDocumentOrThrow({ organizationId, documentId: extraction.documentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.extractionVerify, organizationId, projectId: document.projectId ?? undefined });
    if (!reason) {
      throw problem(400, "extraction_correction_reason_required", "Correcting an extraction requires a documented reason.");
    }
    transitionExtraction({ extraction, to: "Corrected" });
    extraction.fields = { ...extraction.fields, ...fields };
    extraction.correctionReason = reason;
    audit({ principal, organizationId, projectId: document.projectId, action: "document.extraction.correct", entityType: "DocumentExtraction", entityId: extractionId, reason, correlationId });
    return { ...extraction, fields: { ...extraction.fields } };
  }

  function verifyExtraction({ principal, organizationId, extractionId, correlationId }) {
    const extraction = findExtractionOrThrow({ organizationId, extractionId });
    const document = findDocumentOrThrow({ organizationId, documentId: extraction.documentId });
    identity.requirePermission({ principal, permission: PERMISSIONS.extractionVerify, organizationId, projectId: document.projectId ?? undefined });
    assertFourEyes({
      creatorUserId: extraction.extractedByUserId,
      approverUserId: principal.user.userId,
      action: "Document extraction verification"
    });
    transitionExtraction({ extraction, to: "Verified" });
    extraction.authoritative = true;
    extraction.verifiedByUserId = principal.user.userId;
    extraction.verifiedAt = clock().toISOString();
    audit({ principal, organizationId, projectId: document.projectId, action: "document.extraction.verify", entityType: "DocumentExtraction", entityId: extractionId, correlationId });
    return { ...extraction, fields: { ...extraction.fields } };
  }

  function createDownloadGrant({ principal, organizationId, documentId, documentVersionId, expiresInSeconds = 300, purpose, maxDownloads = 1, correlationId }) {
    const document = findDocumentOrThrow({ organizationId, documentId });
    assertReadable({ principal, organizationId, document });
    if (!purpose) {
      throw problem(400, "download_purpose_required", "A download grant requires a stated purpose.");
    }
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > 3600) {
      throw problem(400, "download_expiry_invalid", "Download grants expire between 1 and 3600 seconds after issue.");
    }
    const versions = versionsFor(document);
    const version = documentVersionId
      ? versions.find((candidate) => candidate.documentVersionId === documentVersionId)
      : versions.at(-1);
    if (!version) {
      throw problem(404, "document_version_not_found", "Document version not found.");
    }
    const issuedAt = clock();
    const grant = {
      downloadGrantId: `grant_${downloadGrants.length + 1}`,
      organizationId,
      documentId,
      documentVersionId: version.documentVersionId,
      token: newToken(),
      purpose,
      // Restricted content is always watermarked so a leaked copy is attributable.
      watermark: buildWatermark({ principal, document, issuedAt, purpose }),
      masked: MASKED_CLASSIFICATIONS.includes(document.classification),
      maxDownloads,
      downloadCount: 0,
      issuedToUserId: principal.user.userId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + expiresInSeconds * 1000).toISOString(),
      status: "Issued"
    };
    downloadGrants.push(grant);
    audit({ principal, organizationId, projectId: document.projectId, action: "document.download_grant.issue", entityType: "DownloadGrant", entityId: grant.downloadGrantId, reason: purpose, correlationId });
    return { ...grant };
  }

  function redeemDownloadGrant({ token, actorUserId, correlationId }) {
    const grant = downloadGrants.find((candidate) => candidate.token === token);
    if (!grant) {
      throw problem(404, "download_grant_not_found", "Download grant not found.");
    }
    if (grant.issuedToUserId !== actorUserId) {
      throw problem(403, "download_grant_actor_mismatch", "A download grant can only be redeemed by the user it was issued to.");
    }
    if (new Date(grant.expiresAt) < clock()) {
      grant.status = "Expired";
      recordAccess({ grant, outcome: "Expired", actorUserId, correlationId });
      throw problem(410, "download_grant_expired", "Download grant has expired.");
    }
    if (grant.downloadCount >= grant.maxDownloads) {
      grant.status = "Exhausted";
      recordAccess({ grant, outcome: "Exhausted", actorUserId, correlationId });
      throw problem(409, "download_grant_exhausted", "Download grant has already been used.");
    }
    grant.downloadCount += 1;
    grant.status = grant.downloadCount >= grant.maxDownloads ? "Exhausted" : "Issued";
    const document = findDocumentOrThrow({ organizationId: grant.organizationId, documentId: grant.documentId });
    const version = versionsFor(document).find((candidate) => candidate.documentVersionId === grant.documentVersionId);
    recordAccess({ grant, outcome: "Downloaded", actorUserId, correlationId });
    return {
      documentId: grant.documentId,
      documentVersionId: grant.documentVersionId,
      documentType: document.documentType,
      title: document.title,
      classification: document.classification,
      documentRef: version.documentRef,
      contentHash: version.contentHash,
      watermark: grant.watermark,
      masked: grant.masked,
      downloadCount: grant.downloadCount,
      remainingDownloads: grant.maxDownloads - grant.downloadCount
    };
  }

  function listAccessLog({ principal, organizationId, projectId, documentId }) {
    identity.requirePermission({ principal, permission: PERMISSIONS.auditRead, organizationId, projectId });
    return accessLog
      .filter((entry) => entry.organizationId === organizationId)
      .filter((entry) => !documentId || entry.documentId === documentId)
      .map((entry) => ({ ...entry }));
  }

  function appendVersion({ principal, document, documentRef, contentHash, reason, correlationId }) {
    if (!documentRef || !contentHash) {
      throw problem(400, "document_version_details_required", "A document version requires a storage reference and content hash.");
    }
    for (const existing of versionsFor(document)) {
      existing.status = "Superseded";
    }
    const version = {
      documentVersionId: `document_version_${documentVersions.length + 1}`,
      organizationId: document.organizationId,
      documentId: document.documentId,
      version: document.currentVersion + 1,
      documentRef,
      contentHash,
      reason: reason ?? null,
      status: "Active",
      createdByUserId: principal.user.userId,
      createdAt: clock().toISOString()
    };
    documentVersions.push(version);
    document.currentVersion = version.version;
    document.currentVersionId = version.documentVersionId;
    document.contentHash = contentHash;
    audit({
      principal,
      organizationId: document.organizationId,
      projectId: document.projectId,
      action: "document.version.create",
      entityType: "DocumentVersion",
      entityId: version.documentVersionId,
      correlationId
    });
    return version;
  }

  function versionsFor(document) {
    return documentVersions.filter((version) => version.documentId === document.documentId);
  }

  function recordAccess({ grant, outcome, actorUserId, correlationId }) {
    accessLog.push({
      accessLogId: `document_access_${accessLog.length + 1}`,
      organizationId: grant.organizationId,
      documentId: grant.documentId,
      documentVersionId: grant.documentVersionId,
      downloadGrantId: grant.downloadGrantId,
      actorUserId,
      outcome,
      masked: grant.masked,
      purpose: grant.purpose,
      correlationId: correlationId ?? null,
      occurredAt: clock().toISOString()
    });
  }

  function assertReadable({ principal, organizationId, document }) {
    requireReadAccess({ principal, organizationId, projectId: document.projectId ?? undefined });
    const investorScope = resolveInvestorScope({ principal, organizationId });
    if (investorScope && document.investorId !== investorScope) {
      throw problem(403, "document_investor_scope_denied", "Investors can only read their own documents.");
    }
  }

  /**
   * A role that manages documents can necessarily read them. Requiring an explicit read grant on
   * top of a manage grant would be redundant, so either permission opens the read path.
   */
  function requireReadAccess({ principal, organizationId, projectId }) {
    try {
      return identity.requirePermission({ principal, permission: PERMISSIONS.documentRead, organizationId, projectId });
    } catch (readError) {
      if (readError.status !== 403) {
        throw readError;
      }
      try {
        return identity.requirePermission({ principal, permission: PERMISSIONS.documentManage, organizationId, projectId });
      } catch {
        throw readError;
      }
    }
  }

  /**
   * Investors are scoped to their own documents. Any other role reads within its assignment scope,
   * which `requirePermission` has already checked. The investor identifier is resolved through the
   * investor service rather than derived from the user identifier, which would be brittle.
   */
  function resolveInvestorScope({ principal, organizationId }) {
    const assignment = principal.assignments.find((candidate) => candidate.organizationId === organizationId);
    if (assignment?.role !== "Investor") {
      return null;
    }
    if (!investorService?.getMyInvestorProfile) {
      throw problem(503, "investor_scope_unavailable", "Investor document scoping requires the investor service.");
    }
    return investorService.getMyInvestorProfile({ principal }).investorId;
  }

  function maskExtractionFields(extraction, document) {
    if (!MASKED_CLASSIFICATIONS.includes(document.classification)) {
      return { ...extraction.fields };
    }
    return Object.fromEntries(Object.entries(extraction.fields).map(([key, value]) => [key, maskValue(value)]));
  }

  function buildWatermark({ principal, document, issuedAt, purpose }) {
    return [
      `CrowdFund360 ${document.classification}`,
      `Issued to ${principal.user.userId}`,
      `At ${issuedAt.toISOString()}`,
      `Purpose ${purpose}`
    ].join(" | ");
  }

  function transitionDocument({ document, to }) {
    if (!canTransition("document", document.status, to)) {
      throw problem(409, "invalid_document_transition", `Document cannot transition from ${document.status} to ${to}.`);
    }
    document.status = to;
  }

  function transitionExtraction({ extraction, to }) {
    if (!canTransition("documentExtraction", extraction.status, to)) {
      throw problem(409, "invalid_extraction_transition", `Extraction cannot transition from ${extraction.status} to ${to}.`);
    }
    extraction.status = to;
  }

  function findDocumentOrThrow({ organizationId, documentId }) {
    const document = documents.find((candidate) => (
      candidate.organizationId === organizationId && candidate.documentId === documentId
    ));
    if (!document) {
      throw problem(404, "document_not_found", "Document not found.");
    }
    return document;
  }

  function findExtractionOrThrow({ organizationId, extractionId }) {
    const extraction = extractions.find((candidate) => (
      candidate.organizationId === organizationId && candidate.extractionId === extractionId
    ));
    if (!extraction) {
      throw problem(404, "extraction_not_found", "Document extraction not found.");
    }
    return extraction;
  }

  function audit({ principal, organizationId, projectId, action, entityType, entityId, reason, correlationId }) {
    auditEvents.push(buildAuditEvent({
      organizationId,
      projectId: projectId ?? undefined,
      actorUserId: principal.user.userId,
      action,
      entityType,
      entityId,
      reason,
      correlationId
    }));
  }
}

export function hashContent(content) {
  return createHash("sha256").update(String(content)).digest("hex");
}

export function maskValue(value) {
  const normalized = String(value ?? "");
  if (normalized.length <= 4) {
    return "****";
  }
  return `${"*".repeat(Math.max(normalized.length - 4, 4))}${normalized.slice(-4)}`;
}

function assertDocumentType(documentType) {
  if (!Object.values(DOCUMENT_TYPES).includes(documentType)) {
    throw problem(400, "document_type_invalid", `Unsupported document type: ${documentType}.`);
  }
}

function assertClassification(classification) {
  if (!Object.values(DATA_CLASSIFICATIONS).includes(classification)) {
    throw problem(400, "document_classification_invalid", `Unsupported data classification: ${classification}.`);
  }
}

function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
