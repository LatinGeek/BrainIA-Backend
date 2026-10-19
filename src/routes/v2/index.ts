import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z, ZodError } from "zod";
import { AuthzError, createV2AuthHook, type AuthConfig } from "../../auth.js";
import { ApiError, parseEnvelope, batchSchema, policySchema, correctionSchema, querySchema, financialListSchema, financialSummarySchema, exportSchema, episodeListSchema, pageSchema, idSchema } from "../../domain/v2/contracts.js";
import { withOwnerTransaction } from "../../storage/postgres.js";
import { capture, getObservation, revisions, missing } from "../../storage/v2/observations.js";
import { eventDto, financialPage, financialSummary } from "../../storage/v2/reads.js";
import { correct, deletionState, updatePolicy } from "../../storage/v2/controls.js";
import { exportPage, createQuery, queryResult } from "../../storage/v2/discovery.js";
import { decodeCursor } from "../../storage/v2/cursors.js";

function parse<T>(schema: z.ZodType<T, any, any>, value: unknown): T { return schema.parse(value); }
// Missing/unsupported media types and empty JSON bodies are client errors. The
// sealed enum has no 415, so they share the non-retryable 400 invalid_request.
const BODY_SHAPE_ERRORS = new Set(["FST_ERR_CTP_INVALID_MEDIA_TYPE", "FST_ERR_CTP_EMPTY_JSON_BODY", "FST_ERR_CTP_INVALID_JSON_BODY"]);
function isBodyShapeError(error: unknown) {
  const { code, statusCode } = (error ?? {}) as { code?: string; statusCode?: number };
  return (code !== undefined && BODY_SHAPE_ERRORS.has(code)) || statusCode === 400 || statusCode === 415;
}
function errorObject(error: unknown, requestId: string) {
  if (error instanceof ApiError) return { code: ["feature_disabled","insufficient_scope"].includes(error.code)?"forbidden":error.code, message: error.message, requestId, retryable: error.statusCode === 503 || error.statusCode === 429 };
  if (error instanceof AuthzError) return { code: error.statusCode===403?"forbidden":"unauthenticated", message: error.message, requestId, retryable: false };
  if (error instanceof ZodError) return { code: "invalid_request", message: "Request does not match the published contract", requestId, retryable: false };
  const code = (error as { code?: string })?.code;
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE") return { code: "payload_too_large", message: "Payload exceeds the published limit", requestId, retryable: false };
  if (isBodyShapeError(error)) return { code: "invalid_request", message: "Invalid JSON request", requestId, retryable: false };
  return { code: "unavailable", message: "Operation is temporarily unavailable", requestId, retryable: true };
}
function statusFor(error: unknown) {
  if (error instanceof ApiError || error instanceof AuthzError) return error.statusCode;
  if (error instanceof ZodError) return 400;
  if ((error as { code?: string })?.code === "FST_ERR_CTP_BODY_TOO_LARGE") return 413;
  if (isBodyShapeError(error)) return 400;
  return 503;
}
export function registerV2Routes(options: { authConfig: AuthConfig }): FastifyPluginAsync {
  return async app => {
    app.addHook("onRequest", async (request, reply) => { reply.header("cache-control", "no-store").header("x-request-id", request.id); });
    app.setErrorHandler(async (error, request, reply) => {
      const status = statusFor(error);
      if (status === 503 || status === 429) reply.header("retry-after", "5");
      // Log metadata only: driver errors can embed SQL values/source text.
      if (status === 503) request.log.error({ requestId: request.id, errorType: error instanceof Error ? error.name : "unknown" }, "v2_request_failed");
      return reply.status(status).send({ error: errorObject(error, request.id) });
    });
    app.setNotFoundHandler(async (request, reply) => reply.status(404).send({ error: errorObject(missing(), request.id) }));
    app.addHook("preHandler", createV2AuthHook(options.authConfig));
    const scoped = <T>(owner: string, fn: Parameters<typeof withOwnerTransaction<T>>[1]) => withOwnerTransaction(owner, fn);
    const owner = (request: { principal?: { ownerId: string | null } }) => {
      if (!request.principal?.ownerId) throw new AuthzError("insufficient_scope",403);
      return request.principal.ownerId;
    };
    const pathId = (params: unknown) => parse(z.object({ id: idSchema }).strict(),params).id;
    const route = (scope: string) => ({ config: { v2Scope: scope } });
    app.get("/capabilities",route("capture:read"),async request => {
      const policyVersion = await scoped(owner(request),async db => Number((await db.query(`select coalesce(max(policy_version),1) as version from source_processing_policies where owner_id=$1`,[owner(request)])).rows[0].version));
      return { apiVersion:"2.0.0",captureVersions:[1,2],maxBatchItems:100,maxItemBytes:65536,maxBatchBytes:1048576,currencyRegistryVersion:"ISO4217-CLDR-45",features:{observationRevisions:true,decimalFinance:true,email:false,activity:false,location:false,episodes:false,connectors:false},policyVersion };
    });
    app.post("/observations", { ...route("capture:write"),bodyLimit:1048576 }, async (request,reply) => {
      const result = await capture(owner(request),parseEnvelope(request.body));
      return reply.status(result.status).send(result.receipt);
    });
    app.post("/observations/batch", { ...route("capture:write"),bodyLimit:1048576 }, async request => {
      const input = parse(batchSchema,request.body);
      const results = [];
      for (let index=0;index<input.items.length;index++) {
        const item = input.items[index];
        try { const result = await capture(owner(request),parseEnvelope(item)); results.push({index,deliveryId:result.receipt.deliveryId,status:result.status,receipt:result.receipt}); }
        catch (error) {
          const parsedId = z.string().uuid().safeParse((item as { deliveryId?: unknown })?.deliveryId);
          const status = statusFor(error);
          // Published BatchItem permits 400 rather than 413 for an invalid
          // individual item; the whole-request byte limit still returns 413.
          const failure = status === 413 ? new ApiError(400,"invalid_request","Batch item exceeds its byte limit") : status === 404 ? new ApiError(403,"forbidden","Source is not available to this owner") : error;
          results.push({index,deliveryId:parsedId.success?parsedId.data:null,status:[400,403,409,422,503].includes(status)?status:status===413?400:status===404?403:503,error:errorObject(failure,request.id)});
        }
      }
      return { results };
    });
    app.get("/observations/:id",route("capture:read"),async request => scoped(owner(request),db=>getObservation(db,owner(request),pathId(request.params))));
    app.get("/observations/:id/revisions",route("evidence:read"),async request => scoped(owner(request),db=>revisions(db,owner(request),pathId(request.params),parse(pageSchema,request.query))));
    app.get("/events/:id",route("evidence:read"),async request => scoped(owner(request),db=>eventDto(db,owner(request),pathId(request.params))));
    app.get("/episodes",route("evidence:read"),async request => { const {cursor,limit,...filters}=parse(episodeListSchema,request.query); decodeCursor(cursor,owner(request),"episodes",filters); return {items:[],nextCursor:null}; });
    app.get("/episodes/:id",route("evidence:read"),async request => {pathId(request.params);throw missing();});
    app.get("/financial/transactions",route("finance:read"),async request => scoped(owner(request),db=>financialPage(db,owner(request),parse(financialListSchema,request.query))));
    app.get("/financial/summary",route("finance:read"),async request => scoped(owner(request),db=>financialSummary(db,owner(request),parse(financialSummarySchema,request.query))));
    app.post("/corrections",route("corrections:write"),async(request,reply)=>{const result=await scoped(owner(request),db=>correct(db,owner(request),parse(correctionSchema,request.body)));return reply.status(result.status).send(result.body);});
    app.put("/sources/:id/policy",route("privacy:write"),async request=>scoped(owner(request),db=>updatePolicy(db,owner(request),pathId(request.params),parse(policySchema,request.body))));
    app.get("/deletions/:id",route("privacy:read"),async request=>scoped(owner(request),db=>deletionState(db,owner(request),pathId(request.params))));
    app.get("/export",route("privacy:export"),async request=>scoped(owner(request),db=>exportPage(db,owner(request),parse(exportSchema,request.query))));
    app.post("/queries",route("intelligence:read"),async request=>scoped(owner(request),db=>createQuery(db,owner(request),parse(querySchema,request.body))));
    app.get("/queries/:id",route("intelligence:read"),async request=>scoped(owner(request),db=>queryResult(db,owner(request),pathId(request.params))));
    app.post("/connectors/email/authorize",route("connectors:write"),async()=>{throw new ApiError(403,"feature_disabled","Email connectors are disabled");});
    app.get("/connectors/email/callback",{logLevel:"silent"},async(_request,reply)=>reply.redirect(`brainia://connectors/email/callback?error=${randomUUID()}`,302));
    app.post("/connectors/:id/revoke",route("connectors:write"),async request=>{pathId(request.params);throw new ApiError(403,"feature_disabled","Connectors are disabled");});
  };
}
