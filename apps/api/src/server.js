import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  createApiEnvelope,
  createProblem,
  PERMISSIONS,
  PRODUCT_BOUNDARIES,
  ROLE_PERMISSION_MATRIX,
  ROLES
} from "../../../packages/domain-contracts/src/index.js";
import { createAccountingService } from "../../../packages/accounting/src/index.js";
import { createDistributionService } from "../../../packages/distributions/src/index.js";
import { createAuditPortalService } from "../../../packages/audit-portal/src/index.js";
import { createCaseService } from "../../../packages/cases/src/index.js";
import { createDocumentService } from "../../../packages/documents/src/index.js";
import { createNotificationService } from "../../../packages/notifications/src/index.js";
import { createReportingService } from "../../../packages/reporting/src/index.js";
import { createIdentityService } from "../../../packages/identity/src/index.js";
import { createInvestorService } from "../../../packages/investors/src/index.js";
import { createInvestmentService } from "../../../packages/investments/src/index.js";
import { createOperationsService } from "../../../packages/operations/src/index.js";
import { createPaymentService } from "../../../packages/payments/src/index.js";
import { createMutableSyntheticProjects, createProjectService } from "../../../packages/projects/src/index.js";

const startedAt = new Date();

export function createServer() {
  const identity = createIdentityService();
  const projectService = createProjectService({
    identity,
    projects: createMutableSyntheticProjects()
  });
  const investorService = createInvestorService({ identity });
  const investmentService = createInvestmentService({ identity, investorService, projectService });
  const accountingService = createAccountingService({ identity });
  const paymentService = createPaymentService({ identity, investmentService, accountingService });
  const operationsService = createOperationsService({ identity, accountingService });
  const distributionService = createDistributionService({
    identity,
    accountingService,
    investmentService,
    investorService
  });
  const documentService = createDocumentService({ identity, investorService });
  const caseService = createCaseService({ identity, investorService });
  const notificationService = createNotificationService({ identity });
  const reportingService = createReportingService({
    identity,
    accountingService,
    investmentService,
    investorService,
    paymentService,
    operationsService,
    projectService,
    distributionService,
    documentService
  });
  const auditPortalService = createAuditPortalService({
    identity,
    auditSources: {
      accounting: accountingService,
      cases: caseService,
      distributions: distributionService,
      documents: documentService,
      investments: investmentService,
      investors: investorService,
      notifications: notificationService,
      operations: operationsService,
      payments: paymentService,
      projects: projectService,
      reporting: reportingService
    },
    documentService,
    reportingService,
    caseService,
    accountingService,
    paymentService,
    investorService,
    projectService
  });

  return http.createServer((request, response) => {
    const correlationId = request.headers["x-correlation-id"] || randomUUID();
    const url = new URL(request.url, "http://localhost");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("x-correlation-id", correlationId);
    response.setHeader("cache-control", "no-store");

    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, createApiEnvelope({
        correlationId,
        data: {
          status: "ok",
          service: "crowdfund360-api",
          startedAt: startedAt.toISOString()
        }
      }));
    }

    if (request.method === "GET" && url.pathname === "/ready") {
      return send(response, 200, createApiEnvelope({
        correlationId,
        data: {
          status: "ready",
          dependencies: {
            database: "not-connected-foundation-mode",
            redis: "not-connected-foundation-mode",
            objectStorage: "not-connected-foundation-mode"
          }
        }
      }));
    }

    if (request.method === "GET" && url.pathname === "/api/v1/platform/context") {
      return send(response, 200, createApiEnvelope({
        correlationId,
        data: {
          product: "CrowdFund360",
          boundaries: PRODUCT_BOUNDARIES,
          roles: Object.values(ROLES)
        }
      }));
    }

    if (request.method === "GET" && url.pathname === "/api/v1/access-control/roles") {
      return send(response, 200, createApiEnvelope({
        correlationId,
        data: {
          roles: Object.entries(ROLE_PERMISSION_MATRIX).map(([role, permissions]) => ({
            role,
            permissions
          }))
        }
      }));
    }

    if (request.method === "GET" && url.pathname === "/api/v1/me") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => send(response, 200, createApiEnvelope({
        correlationId,
        data: {
          user: {
            userId: principal.user.userId,
            displayName: principal.user.displayName,
            organizationId: principal.user.organizationId,
            status: principal.user.status
          },
          assignments: identity.listAssignments(principal)
        }
      })));
    }

    if (request.method === "GET" && url.pathname === "/api/v1/projects/scope-check") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const organizationId = url.searchParams.get("organizationId");
        const projectId = url.searchParams.get("projectId");

        if (!organizationId || !projectId) {
          return send(response, 400, createProblem({
            status: 400,
            code: "scope_required",
            title: "Scope is required",
            detail: "organizationId and projectId query parameters are required.",
            correlationId
          }));
        }

        const project = identity.findProject({ organizationId, projectId });
        if (!project) {
          return send(response, 404, createProblem({
            status: 404,
            code: "project_not_found",
            title: "Project not found",
            detail: "The requested project does not exist in the current foundation store.",
            correlationId
          }));
        }

        const assignment = identity.requirePermission({
          principal,
          permission: PERMISSIONS.projectCreate,
          organizationId,
          projectId
        });

        return send(response, 200, createApiEnvelope({
          correlationId,
          data: {
            project,
            authorizedBy: {
              userId: principal.user.userId,
              role: assignment.role
            }
          }
        }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/investors/me") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const profile = investorService.getMyInvestorProfile({ principal });
        return send(response, 200, createApiEnvelope({ correlationId, data: { profile } }));
      });
    }

    if (request.method === "PATCH" && url.pathname === "/api/v1/investors/me") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const profile = investorService.updateProfile({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          patch: body.patch ?? {},
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { profile } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investors/documents") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const document = investorService.addDocument({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          documentType: body.documentType,
          documentRef: body.documentRef,
          expiresAt: body.expiresAt,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { document } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investors/bank-accounts") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const bankAccount = investorService.addBankAccount({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          bankName: body.bankName,
          accountName: body.accountName,
          accountFingerprint: body.accountFingerprint,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { bankAccount } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investors/nominees") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const nominee = investorService.addNominee({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          fullName: body.fullName,
          relationship: body.relationship,
          mobile: body.mobile,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { nominee } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investors/consents") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const consent = investorService.recordConsent({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          consentType: body.consentType,
          version: body.version,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { consent } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investors/kyc/submit") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const profile = investorService.submitKyc({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { profile } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/kyc-cases/queue") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const cases = investorService.listReviewQueue({
          principal,
          organizationId: url.searchParams.get("organizationId") ?? principal.user.organizationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { cases } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/kyc-cases/investor") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const profile = investorService.getInvestorProfileForReview({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          investorId: url.searchParams.get("investorId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { profile } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/kyc-cases/start-review") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const kycCase = investorService.startReview({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { kycCase } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/kyc-cases/request-information") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const kycCase = investorService.requestInformation({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { kycCase } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/kyc-cases/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const kycCase = investorService.approveKyc({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { kycCase } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/kyc-cases/reject") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const kycCase = investorService.rejectKyc({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { kycCase } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investors/holds") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const profile = investorService.placeHold({
          principal,
          organizationId: body.organizationId,
          investorId: body.investorId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { profile } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/investors/duplicates") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const signals = investorService.detectDuplicates({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          investorId: url.searchParams.get("investorId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { signals } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/marketplace/projects") {
      const organizationId = url.searchParams.get("organizationId") ?? "org_demo";
      return send(response, 200, createApiEnvelope({
        correlationId,
        data: {
          projects: investmentService.listMarketplaceProjects({ organizationId })
        }
      }));
    }

    if (request.method === "GET" && url.pathname === "/api/v1/marketplace/offers") {
      const disclosure = investmentService.getOfferDisclosure({
        organizationId: url.searchParams.get("organizationId") ?? "org_demo",
        projectId: url.searchParams.get("projectId"),
        offerVersionId: url.searchParams.get("offerVersionId")
      });
      return send(response, 200, createApiEnvelope({ correlationId, data: disclosure }));
    }

    if (request.method === "POST" && url.pathname === "/api/v1/marketplace/watchlist") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const watchlistItem = investmentService.addToWatchlist({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          offerVersionId: body.offerVersionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { watchlistItem } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investments/suitability") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const suitability = investmentService.recordSuitability({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          offerVersionId: body.offerVersionId,
          answers: body.answers ?? {},
          riskAcknowledged: body.riskAcknowledged,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { suitability } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investments/commitments") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const commitment = investmentService.createCommitment({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          offerVersionId: body.offerVersionId,
          amount: body.amount,
          currency: body.currency,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { commitment } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investments/agreements/accept") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const commitment = investmentService.acceptAgreement({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          agreementVersion: body.agreementVersion,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { commitment } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/investments/portfolio") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const commitments = investmentService.getPortfolio({
          principal,
          organizationId: url.searchParams.get("organizationId") ?? principal.user.organizationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { commitments } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/instructions") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const instruction = paymentService.createPaymentInstruction({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          idempotencyKey: request.headers["idempotency-key"],
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { instruction } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/proofs") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const proof = paymentService.submitPaymentProof({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          proofDocumentRef: body.proofDocumentRef,
          paidAmount: body.paidAmount,
          currency: body.currency,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { proof } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/bank-transactions") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const bankTransaction = paymentService.importBankTransaction({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          transactionRef: body.transactionRef,
          paymentReference: body.paymentReference,
          amount: body.amount,
          currency: body.currency,
          valueDate: body.valueDate,
          accountCode: body.accountCode,
          idempotencyKey: request.headers["idempotency-key"],
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { bankTransaction } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/reconciliations") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const reconciliation = paymentService.reconcilePayment({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          bankTransactionId: body.bankTransactionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { reconciliation } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/confirm-cleared") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const result = paymentService.confirmClearedPayment({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: result }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payments/providers") {
      return send(response, 200, createApiEnvelope({
        correlationId,
        data: { providers: paymentService.listProviders() }
      }));
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/provider-callbacks") {
      return (async () => {
        try {
          const body = await readJsonBody(request);
          const result = paymentService.ingestProviderCallback({
            providerId: request.headers["x-provider-id"],
            signature: request.headers["x-provider-signature"],
            timestamp: Number(request.headers["x-provider-timestamp"]),
            nonce: request.headers["x-provider-nonce"],
            event: body,
            correlationId
          });
          return send(response, 202, createApiEnvelope({ correlationId, data: { callback: result } }));
        } catch (error) {
          return send(response, error.status ?? 500, createProblem({
            status: error.status ?? 500,
            code: error.code ?? "internal_error",
            title: "Provider callback rejected",
            detail: error.message,
            correlationId
          }));
        }
      })();
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payments/project-accounts") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const accounts = paymentService.listProjectAccounts({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { accounts } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/project-accounts") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const account = paymentService.registerProjectAccount({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          accountCode: body.accountCode,
          accountType: body.accountType,
          bankName: body.bankName,
          accountFingerprint: body.accountFingerprint,
          isPrimaryCollection: body.isPrimaryCollection,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { account } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/settlements") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const batch = paymentService.importPartnerSettlement({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          settlementRef: body.settlementRef,
          lines: body.lines,
          idempotencyKey: request.headers["idempotency-key"],
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { batch } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payments/bank-transactions") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const transactions = paymentService.listBankTransactions({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          status: url.searchParams.get("status") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { transactions } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payments/match-candidates") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const suggestion = paymentService.suggestMatchCandidates({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          bankTransactionId: url.searchParams.get("bankTransactionId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { suggestion } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payments/settlement-status") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const settlement = paymentService.getInstructionSettlement({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          commitmentId: url.searchParams.get("commitmentId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { settlement } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payments/reconciliations") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const records = paymentService.listReconciliations({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          status: url.searchParams.get("status") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { reconciliations: records } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/reconciliations/split") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const split = paymentService.reconcileSplitPayment({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          bankTransactionId: body.bankTransactionId,
          allocations: body.allocations,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { split } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/reconciliations/aggregate") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const reconciliation = paymentService.reconcileAggregatePayment({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          bankTransactionIds: body.bankTransactionIds,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { reconciliation } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/reconciliations/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const reconciliation = paymentService.approveReconciliation({
          principal,
          organizationId: body.organizationId,
          reconciliationId: body.reconciliationId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { reconciliation } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/reconciliations/reject") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const reconciliation = paymentService.rejectReconciliation({
          principal,
          organizationId: body.organizationId,
          reconciliationId: body.reconciliationId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { reconciliation } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/reconciliations/lock") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const reconciliation = paymentService.lockReconciliation({
          principal,
          organizationId: body.organizationId,
          reconciliationId: body.reconciliationId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { reconciliation } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/reconciliations/reverse") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const reconciliation = paymentService.reverseReconciliation({
          principal,
          organizationId: body.organizationId,
          reconciliationId: body.reconciliationId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { reconciliation } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/instructions/classify-short") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const instruction = paymentService.classifyShortPayment({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { instruction } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/receipts") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const receipt = paymentService.issueReceipt({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          idempotencyKey: request.headers["idempotency-key"],
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { receipt } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/payments/cash-controls") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const control = paymentService.recordDailyCashControl({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          controlDate: body.controlDate,
          openingBalance: body.openingBalance,
          closingBalance: body.closingBalance,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { control } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payments/cash-controls") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const controls = paymentService.listDailyCashControls({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { controls } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/refunds/execute") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const refund = paymentService.executeRefund({
          principal,
          organizationId: body.organizationId,
          refundId: body.refundId,
          paymentReference: body.paymentReference,
          executedOn: body.executedOn,
          idempotencyKey: request.headers["idempotency-key"],
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { refund } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/payments/exceptions") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const exceptions = paymentService.listPaymentExceptions({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { exceptions } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/operations/budgets") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const budgets = operationsService.listBudgets({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { budgets } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/budgets") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const budget = operationsService.createBudgetRevision({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          budgetCode: body.budgetCode,
          category: body.category,
          amount: body.amount,
          currency: body.currency,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { budget } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/budgets/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const budget = operationsService.approveBudgetRevision({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          budgetId: body.budgetId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { budget } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/operations/budget-variance") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const variance = operationsService.getBudgetVariance({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { variance } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/procurements") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const procurement = operationsService.createProcurementRequest({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          budgetCode: body.budgetCode,
          vendorName: body.vendorName,
          amount: body.amount,
          currency: body.currency,
          description: body.description,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { procurement } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/procurements/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const procurement = operationsService.approveProcurementRequest({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          procurementId: body.procurementId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { procurement } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/expenses") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const expense = operationsService.createExpenseClaim({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          budgetCode: body.budgetCode,
          procurementId: body.procurementId,
          amount: body.amount,
          currency: body.currency,
          invoiceRef: body.invoiceRef,
          description: body.description,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { expense } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/expenses/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const expense = operationsService.approveExpenseClaim({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          expenseId: body.expenseId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { expense } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/assets") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const asset = operationsService.registerAsset({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          expenseId: body.expenseId,
          assetTag: body.assetTag,
          assetType: body.assetType,
          custodyUserId: body.custodyUserId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { asset } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/milestones") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const milestone = operationsService.createMilestonePlan({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          title: body.title,
          dueDate: body.dueDate,
          targetAmount: body.targetAmount,
          currency: body.currency,
          deliverables: body.deliverables ?? [],
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { milestone } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/milestones/evidence") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const milestone = operationsService.submitMilestoneEvidence({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          milestoneId: body.milestoneId,
          evidenceRef: body.evidenceRef,
          progressPercent: body.progressPercent,
          comment: body.comment,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { milestone } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/milestones/verify") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const milestone = operationsService.verifyMilestone({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          milestoneId: body.milestoneId,
          comment: body.comment,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { milestone } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/fund-releases") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const release = operationsService.requestFundRelease({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          milestoneId: body.milestoneId,
          amount: body.amount,
          currency: body.currency,
          purpose: body.purpose,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { release } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/fund-releases/finance-approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const release = operationsService.approveFundReleaseFinance({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          releaseId: body.releaseId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { release } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/fund-releases/compliance-approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const release = operationsService.approveFundReleaseCompliance({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          releaseId: body.releaseId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { release } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/fund-releases/release") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const release = operationsService.releaseFunds({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          releaseId: body.releaseId,
          postedVoucherId: body.postedVoucherId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { release } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/project-updates") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const update = operationsService.publishProjectUpdate({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          title: body.title,
          body: body.body,
          visibility: body.visibility,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { update } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/operations/timeline") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const timeline = operationsService.getProjectTimeline({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { timeline } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/operations/health") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const health = operationsService.getProjectHealth({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          asOfDate: url.searchParams.get("asOfDate") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { health } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/operations/milestone-alerts") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const alerts = operationsService.listMilestoneAlerts({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          asOfDate: url.searchParams.get("asOfDate") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { alerts } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/accounts") {
      return send(response, 200, createApiEnvelope({
        correlationId,
        data: { accounts: accountingService.listChartOfAccounts() }
      }));
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/periods") {
      return send(response, 200, createApiEnvelope({
        correlationId,
        data: { periods: accountingService.listFiscalPeriods() }
      }));
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/vouchers") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const voucher = accountingService.createVoucher({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          voucherType: body.voucherType,
          attachments: body.attachments,
          postingDate: body.postingDate,
          references: body.references,
          narration: body.narration,
          lines: body.lines,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { voucher } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/vouchers/submit") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const voucher = accountingService.submitVoucher({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          voucherId: body.voucherId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { voucher } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/vouchers/check") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const voucher = accountingService.checkVoucher({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          voucherId: body.voucherId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { voucher } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/vouchers/authorize") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const voucher = accountingService.authorizeVoucher({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          voucherId: body.voucherId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { voucher } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/vouchers/post") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const voucher = accountingService.postVoucher({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          voucherId: body.voucherId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { voucher } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/vouchers/reverse") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const voucher = accountingService.reverseVoucher({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          voucherId: body.voucherId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { voucher } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/general-ledger") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const entries = accountingService.getGeneralLedger({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          accountCode: url.searchParams.get("accountCode")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { entries } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/trial-balance") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const balances = accountingService.getTrialBalance({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { balances } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/complaints") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const complaints = caseService.listComplaints({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          category: url.searchParams.get("category") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaints } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.registerComplaint({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          category: body.category,
          severity: body.severity,
          subject: body.subject,
          description: body.description,
          investorId: body.investorId,
          evidenceDocumentIds: body.evidenceDocumentIds,
          channel: body.channel,
          anonymous: body.anonymous,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/complaints/detail") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const complaint = caseService.getComplaint({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          complaintId: url.searchParams.get("complaintId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/triage") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.triageComplaint({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          severity: body.severity,
          category: body.category,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/assign") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.assignComplaint({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          assignedToUserId: body.assignedToUserId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/start") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.startComplaintWork({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/escalate") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.escalateComplaint({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/resolve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.resolveComplaint({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          resolution: body.resolution,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/close") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.closeComplaint({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/appeal") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.appealComplaint({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/withdraw") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.withdrawComplaint({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/complaints/sla-breaches") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const breaches = caseService.listSlaBreaches({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { breaches } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/complaints/classification") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const classification = caseService.classifyComplaint({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          complaintId: url.searchParams.get("complaintId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { classification } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/complaints/draft-response") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const draft = caseService.draftComplaintResponse({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          complaintId: url.searchParams.get("complaintId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { draft } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/complaints/classification") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complaint = caseService.applyClassification({
          principal,
          organizationId: body.organizationId,
          complaintId: body.complaintId,
          category: body.category,
          severity: body.severity,
          rationale: body.rationale,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complaint } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/compliance-cases") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const cases = caseService.listComplianceCases({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          source: url.searchParams.get("source") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { cases } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/compliance-cases") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complianceCase = caseService.openComplianceCase({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          source: body.source,
          severity: body.severity,
          summary: body.summary,
          links: body.links,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { complianceCase } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/compliance-cases/advance") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complianceCase = caseService.advanceComplianceCase({
          principal,
          organizationId: body.organizationId,
          caseId: body.caseId,
          to: body.to,
          note: body.note,
          assignedToUserId: body.assignedToUserId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complianceCase } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/compliance-cases/resolve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const complianceCase = caseService.resolveComplianceCase({
          principal,
          organizationId: body.organizationId,
          caseId: body.caseId,
          resolution: body.resolution,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { complianceCase } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/compliance-cases/links") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const link = caseService.linkCase({
          principal,
          organizationId: body.organizationId,
          caseId: body.caseId,
          entityType: body.entityType,
          entityId: body.entityId,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { link } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/compliance-cases/links") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const links = caseService.listCaseLinks({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          caseId: url.searchParams.get("caseId") ?? undefined,
          entityType: url.searchParams.get("entityType") ?? undefined,
          entityId: url.searchParams.get("entityId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { links } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/governance/holds") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const holds = caseService.listHolds({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          subjectType: url.searchParams.get("subjectType") ?? undefined,
          status: url.searchParams.get("status") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { holds } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/governance/holds") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const hold = caseService.placeHold({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          reason: body.reason,
          caseId: body.caseId,
          expiresAt: body.expiresAt,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { hold } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/governance/holds/release") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const hold = caseService.releaseHold({
          principal,
          organizationId: body.organizationId,
          holdId: body.holdId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { hold } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/compliance-rules") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const rules = caseService.listRules({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          status: url.searchParams.get("status") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { rules } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/compliance-rules") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const rule = caseService.draftRule({
          principal,
          organizationId: body.organizationId,
          name: body.name,
          source: body.source,
          severity: body.severity,
          match: body.match,
          conditions: body.conditions,
          action: body.action,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { rule } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/compliance-rules/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const rule = caseService.approveRule({
          principal,
          organizationId: body.organizationId,
          ruleId: body.ruleId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { rule } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/compliance-rules/suspend") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const rule = caseService.suspendRule({
          principal,
          organizationId: body.organizationId,
          ruleId: body.ruleId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { rule } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/compliance-signals") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const signal = caseService.evaluateSignal({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          signalType: body.signalType,
          payload: body.payload,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { signal } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/compliance-signals") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const signals = caseService.listSignals({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          signalType: url.searchParams.get("signalType") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { signals } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audit-portal/trail") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const trail = auditPortalService.searchAuditTrail({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          entityType: url.searchParams.get("entityType") ?? undefined,
          entityId: url.searchParams.get("entityId") ?? undefined,
          actorUserId: url.searchParams.get("actorUserId") ?? undefined,
          actionPrefix: url.searchParams.get("actionPrefix") ?? undefined,
          correlationIdFilter: url.searchParams.get("correlationId") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { trail } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audit-portal/entity-history") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const history = auditPortalService.getEntityHistory({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          entityType: url.searchParams.get("entityType"),
          entityId: url.searchParams.get("entityId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { history } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audit-portal/security-events") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const security = auditPortalService.listSecurityEvents({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { security } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audit-portal/evidence-packages") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const evidencePackages = auditPortalService.listEvidencePackages({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { evidencePackages } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/audit-portal/evidence-packages") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const evidencePackage = auditPortalService.buildEvidencePackage({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          title: body.title,
          purpose: body.purpose,
          caseId: body.caseId,
          entityRefs: body.entityRefs,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { evidencePackage } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/audit-portal/evidence-packages/seal") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const evidencePackage = auditPortalService.sealEvidencePackage({
          principal,
          organizationId: body.organizationId,
          evidencePackageId: body.evidencePackageId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { evidencePackage } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audit-portal/evidence-packages/verify") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const verification = auditPortalService.verifyEvidencePackage({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          evidencePackageId: url.searchParams.get("evidencePackageId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { verification } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/governance/report") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = auditPortalService.getGovernanceReport({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/governance/regulatory-templates") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const templates = auditPortalService.listRegulatoryTemplates({
          principal,
          organizationId: url.searchParams.get("organizationId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { templates } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/governance/regulatory-report") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = auditPortalService.getRegulatoryReport({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          templateKey: url.searchParams.get("templateKey")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/dashboards/investor") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const dashboard = reportingService.getInvestorDashboard({
          principal,
          organizationId: url.searchParams.get("organizationId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { dashboard } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/dashboards/project") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const dashboard = reportingService.getProjectDashboard({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { dashboard } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/dashboards/administrator") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const dashboard = reportingService.getAdministratorDashboard({
          principal,
          organizationId: url.searchParams.get("organizationId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { dashboard } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/reports") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const reports = reportingService.listReports({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { reports } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/reports/run") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = reportingService.runReport({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          reportKey: url.searchParams.get("reportKey"),
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/reports/narrative") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const narrative = reportingService.draftReportNarrative({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          reportKey: url.searchParams.get("reportKey"),
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { narrative } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/exports") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const exportRequests = reportingService.listExportRequests({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { exportRequests } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/exports") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const exportRequest = reportingService.requestExport({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          reportKey: body.reportKey,
          format: body.format,
          masking: body.masking,
          periodId: body.periodId,
          purpose: body.purpose,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { exportRequest } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/exports/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const exportRequest = reportingService.approveExport({
          principal,
          organizationId: body.organizationId,
          exportRequestId: body.exportRequestId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { exportRequest } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/exports/reject") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const exportRequest = reportingService.rejectExport({
          principal,
          organizationId: body.organizationId,
          exportRequestId: body.exportRequestId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { exportRequest } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/exports/generate") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const generated = reportingService.generateExport({
          principal,
          organizationId: body.organizationId,
          exportRequestId: body.exportRequestId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { generated } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/documents") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const documents = documentService.listDocuments({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          documentType: url.searchParams.get("documentType") ?? undefined,
          investorId: url.searchParams.get("investorId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { documents } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/documents") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const document = documentService.registerDocument({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          documentType: body.documentType,
          title: body.title,
          documentRef: body.documentRef,
          contentHash: body.contentHash,
          classification: body.classification,
          investorId: body.investorId,
          commitmentId: body.commitmentId,
          milestoneId: body.milestoneId,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { document } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/documents/detail") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const document = documentService.getDocument({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          documentId: url.searchParams.get("documentId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { document } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/documents/versions") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const document = documentService.addDocumentVersion({
          principal,
          organizationId: body.organizationId,
          documentId: body.documentId,
          documentRef: body.documentRef,
          contentHash: body.contentHash,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { document } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/documents/extractions") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const extraction = documentService.recordExtraction({
          principal,
          organizationId: body.organizationId,
          documentId: body.documentId,
          documentVersionId: body.documentVersionId,
          fields: body.fields,
          engine: body.engine,
          confidence: body.confidence,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { extraction } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/documents/extractions/verify") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const extraction = documentService.verifyExtraction({
          principal,
          organizationId: body.organizationId,
          extractionId: body.extractionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { extraction } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/documents/download-grants") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const grant = documentService.createDownloadGrant({
          principal,
          organizationId: body.organizationId,
          documentId: body.documentId,
          documentVersionId: body.documentVersionId,
          expiresInSeconds: body.expiresInSeconds,
          purpose: body.purpose,
          maxDownloads: body.maxDownloads,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { grant } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/documents/downloads") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const download = documentService.redeemDownloadGrant({
          token: body.token,
          actorUserId: principal.user.userId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { download } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/documents/access-log") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const accessLog = documentService.listAccessLog({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          documentId: url.searchParams.get("documentId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { accessLog } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/notifications/templates") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const templates = notificationService.listTemplates({
          principal,
          organizationId: url.searchParams.get("organizationId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { templates } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/notifications/templates") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const template = notificationService.draftTemplate({
          principal,
          organizationId: body.organizationId,
          templateKey: body.templateKey,
          channel: body.channel,
          locale: body.locale,
          subject: body.subject,
          body: body.body,
          category: body.category,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { template } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/notifications/templates/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const template = notificationService.approveTemplate({
          principal,
          organizationId: body.organizationId,
          templateId: body.templateId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { template } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/notifications/preferences") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const preferences = notificationService.getPreferences({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          userId: url.searchParams.get("userId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { preferences } }));
      });
    }

    if (request.method === "PATCH" && url.pathname === "/api/v1/notifications/preferences") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const preferences = notificationService.updatePreferences({
          principal,
          organizationId: body.organizationId,
          userId: body.userId,
          channels: body.channels,
          locale: body.locale,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { preferences } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/notifications") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const notifications = notificationService.listNotifications({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { notifications } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/notifications") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const notification = notificationService.queueNotification({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          templateKey: body.templateKey,
          channel: body.channel,
          recipientUserId: body.recipientUserId,
          recipientAddress: body.recipientAddress,
          data: body.data,
          dedupeKey: body.dedupeKey,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { notification } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/notifications/process-queue") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const run = notificationService.processDeliveryQueue({
          principal,
          organizationId: body.organizationId,
          now: body.now,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { run } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/notifications/delivery-attempts") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const attempts = notificationService.listDeliveryAttempts({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          notificationId: url.searchParams.get("notificationId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { attempts } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/posting-matrix") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const scope = {
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        };
        return send(response, 200, createApiEnvelope({
          correlationId,
          data: {
            active: accountingService.getActivePostingMatrix({ principal, ...scope }),
            versions: accountingService.listPostingMatrixVersions({ principal, ...scope })
          }
        }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/posting-matrix") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const postingMatrixVersion = accountingService.draftPostingMatrixVersion({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          rules: body.rules,
          notes: body.notes,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { postingMatrixVersion } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/posting-matrix/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const postingMatrixVersion = accountingService.approvePostingMatrixVersion({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          postingMatrixVersionId: body.postingMatrixVersionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { postingMatrixVersion } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/opening-balances") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const voucher = accountingService.postOpeningBalance({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          lines: body.lines,
          attachments: body.attachments,
          narration: body.narration,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { voucher } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/vouchers/approve-backdate") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const voucher = accountingService.approveBackdatedEntry({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          voucherId: body.voucherId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { voucher } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/sub-ledger") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = accountingService.getSubLedger({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          subLedger: url.searchParams.get("subLedger"),
          dimensionValue: url.searchParams.get("dimensionValue") ?? undefined,
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/sub-ledger-reconciliation") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = accountingService.getSubLedgerReconciliation({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/cash-book") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = accountingService.getCashBook({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/bank-book") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = accountingService.getBankBook({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/balance-sheet") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = accountingService.getBalanceSheet({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/cash-flow") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = accountingService.getCashFlowStatement({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/fund-utilization") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const report = accountingService.getFundUtilization({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          periodId: url.searchParams.get("periodId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { report } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/periods/close-checklist") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const checklist = accountingService.getPeriodCloseChecklist({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          periodId: url.searchParams.get("periodId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { checklist } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/periods/start-close") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const period = accountingService.startPeriodClose({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          periodId: body.periodId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { period } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/periods/checklist-items") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const period = accountingService.completeCloseChecklistItem({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          periodId: body.periodId,
          itemId: body.itemId,
          evidenceRef: body.evidenceRef,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { period } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/periods/reopen") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const period = accountingService.reopenPeriodForAdjustment({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          periodId: body.periodId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { period } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/periods/close") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const period = accountingService.closePeriod({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          periodId: body.periodId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { period } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/accounting/periods/lock") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const period = accountingService.lockPeriod({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          periodId: body.periodId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { period } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/profit-and-loss") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const profitAndLoss = accountingService.getProfitAndLoss({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId"),
          periodId: url.searchParams.get("periodId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { profitAndLoss } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/accounting/reports/loss-carry-forward") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const carryForward = accountingService.getLossCarryForward({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { carryForward } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investments/allocations") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const commitment = investmentService.allocateCommitment({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          commitmentId: body.commitmentId,
          allocatedAt: body.allocatedAt,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { commitment } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/investments/activations") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const commitment = investmentService.activateCommitment({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          commitmentId: body.commitmentId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { commitment } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/distributions/formula-versions") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const formulaVersions = distributionService.listFormulaVersions({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { formulaVersions } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/formula-versions") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const formulaVersion = distributionService.createFormulaVersion({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          basis: body.basis,
          minimumHoldingDays: body.minimumHoldingDays,
          lossCarryForwardEnabled: body.lossCarryForwardEnabled,
          residualPolicy: body.residualPolicy,
          withholdingRatePercent: body.withholdingRatePercent,
          reserveRatePercent: body.reserveRatePercent,
          notes: body.notes,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { formulaVersion } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/formula-versions/publish") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const formulaVersion = distributionService.publishFormulaVersion({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          formulaVersionId: body.formulaVersionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { formulaVersion } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/distributions") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const distributionsList = distributionService.listDistributions({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distributions: distributionsList } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.createDistributionProposal({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          periodId: body.periodId,
          formulaVersionId: body.formulaVersionId,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/calculate") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.calculateDistribution({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/review") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.reviewDistribution({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.approveDistribution({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/post-payable") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.postDistributionPayable({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          postedVoucherId: body.postedVoucherId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/payment-batches") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const batch = distributionService.createPaymentBatch({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          correlationId
        });
        return send(response, 201, createApiEnvelope({ correlationId, data: { batch } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/payment-results") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.recordPaymentResults({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          results: body.results,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/entitlements/reissue") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.reissueEntitlement({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          entitlementId: body.entitlementId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/entitlements/hold") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.holdEntitlement({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          entitlementId: body.entitlementId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/entitlements/release-hold") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.releaseEntitlementHold({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          entitlementId: body.entitlementId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/entitlements/cancel") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.cancelEntitlement({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          entitlementId: body.entitlementId,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/reconcile") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.reconcileDistribution({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/distributions/complete") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const distribution = distributionService.completeDistribution({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          distributionId: body.distributionId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { distribution } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/distributions/statements/me") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const statement = distributionService.getInvestorStatement({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId") ?? undefined
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { statement } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/settlement/close") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const settlement = distributionService.closeProjectSettlement({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { settlement } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/settlement/archive") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const settlement = distributionService.archiveProjectSettlement({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { settlement } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/refunds/proposals") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const refund = paymentService.proposeRefund({
          principal,
          organizationId: body.organizationId,
          commitmentId: body.commitmentId,
          amount: body.amount,
          currency: body.currency,
          reason: body.reason,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { refund } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/refunds/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const refund = paymentService.approveRefund({
          principal,
          organizationId: body.organizationId,
          refundId: body.refundId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { refund } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/projects") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const organizationId = url.searchParams.get("organizationId") ?? principal.user.organizationId;
        return send(response, 200, createApiEnvelope({
          correlationId,
          data: {
            projects: projectService.listProjects({ principal, organizationId })
          }
        }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/submit-due-diligence") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const project = projectService.submitForDueDiligence({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { project } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/projects/detail") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const detail = projectService.getProjectDetail({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { project: detail } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/due-diligence/complete-item") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const item = projectService.completeDueDiligenceItem({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          itemId: body.itemId,
          evidenceDocumentId: body.evidenceDocumentId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { item } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/due-diligence/findings") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const item = projectService.recordDueDiligenceFinding({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          itemId: body.itemId,
          severity: body.severity,
          note: body.note,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { item } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/risk-assessments") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const riskAssessment = projectService.calculateRiskAssessment({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          scores: body.scores,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { riskAssessment } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/submit-review") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const project = projectService.submitForReview({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { project } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/approve") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const project = projectService.approveProject({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { project } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/projects/publish") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const project = projectService.publishProject({
          principal,
          organizationId: body.organizationId,
          projectId: body.projectId,
          correlationId
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { project } }));
      });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/projects/offer-versions") {
      return withPrincipal({ request, response, correlationId, identity }, (principal) => {
        const offerVersions = projectService.listOfferVersions({
          principal,
          organizationId: url.searchParams.get("organizationId"),
          projectId: url.searchParams.get("projectId")
        });
        return send(response, 200, createApiEnvelope({ correlationId, data: { offerVersions } }));
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/vouchers/authorization-preview") {
      return withPrincipal({ request, response, correlationId, identity }, async (principal) => {
        const body = await readJsonBody(request);
        const { organizationId, projectId, amount, currency = "BDT", creatorUserId } = body;

        if (!organizationId || !projectId || !amount || !creatorUserId) {
          return send(response, 400, createProblem({
            status: 400,
            code: "voucher_preview_invalid",
            title: "Voucher preview is invalid",
            detail: "organizationId, projectId, amount, and creatorUserId are required.",
            correlationId
          }));
        }

        const assignment = identity.requirePermission({
          principal,
          permission: PERMISSIONS.voucherAuthorize,
          organizationId,
          projectId
        });
        identity.authorizeAmount({
          principal,
          permission: PERMISSIONS.voucherAuthorize,
          organizationId,
          projectId,
          amount,
          currency
        });

        if (creatorUserId === principal.user.userId) {
          return send(response, 403, createProblem({
            status: 403,
            code: "four_eyes_required",
            title: "Independent approval required",
            detail: "The voucher creator cannot authorize the same controlled action.",
            correlationId
          }));
        }

        return send(response, 200, createApiEnvelope({
          correlationId,
          data: {
            status: "authorization-preview-approved",
            amount,
            currency,
            authorizedBy: {
              userId: principal.user.userId,
              role: assignment.role
            }
          }
        }));
      });
    }

    return send(response, 404, createProblem({
      status: 404,
      code: "route_not_found",
      title: "Route not found",
      detail: `${request.method} ${url.pathname} is not implemented in this foundation slice.`,
      correlationId
    }));
  });
}

function send(response, status, payload) {
  response.statusCode = status;
  response.end(JSON.stringify(payload, null, 2));
}

function withPrincipal({ request, response, correlationId, identity }, handler) {
  try {
    const principal = identity.authenticate(request.headers.authorization);
    return Promise.resolve(handler(principal)).catch((error) => {
      send(response, error.status ?? 500, createProblem({
        status: error.status ?? 500,
        code: error.code ?? "internal_error",
        title: error.status === 401 ? "Authentication required" : "Access denied",
        detail: error.message,
        correlationId
      }));
    });
  } catch (error) {
    return send(response, error.status ?? 500, createProblem({
      status: error.status ?? 500,
      code: error.code ?? "internal_error",
      title: error.status === 401 ? "Authentication required" : "Access denied",
      detail: error.message,
      correlationId
    }));
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(JSON.stringify({ level: "info", message: "CrowdFund360 API started", port }));
  });
}
