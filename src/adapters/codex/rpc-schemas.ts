import { z } from 'zod';

const nonEmptyString = z.string().min(1);
const unknownRecordSchema = z.record(z.string(), z.unknown());

export const codexRpcInitializeResultSchema = z
  .object({
    userAgent: z.string().optional(),
  })
  .optional();

export type CodexRpcInitializeResult = z.infer<
  typeof codexRpcInitializeResultSchema
>;

export const codexRpcThreadStartResultSchema = z.object({
  thread: z.object({
    id: nonEmptyString,
  }),
});

export type CodexRpcThreadStartResult = z.infer<
  typeof codexRpcThreadStartResultSchema
>;

export const codexTurnItemSchema = unknownRecordSchema;

export const codexTurnSchema = z.object({
  error: z.unknown().optional(),
  id: z.string(),
  items: z.array(codexTurnItemSchema).optional(),
  status: nonEmptyString,
});

export type CodexTurn = z.infer<typeof codexTurnSchema>;

export const codexNestedTurnResultSchema = z.object({
  turn: codexTurnSchema,
});

export const codexLegacyTurnResultSchema = z.object({
  output: z.array(codexTurnItemSchema).optional(),
  status: nonEmptyString,
  turnId: z.string().optional(),
});

export const codexTurnCompletedParamsSchema = z
  .object({
    threadId: z.string().optional(),
    turn: codexTurnSchema.optional(),
    turnId: z.string().optional(),
  })
  .passthrough();

export type CodexTurnCompletedParams = z.infer<
  typeof codexTurnCompletedParamsSchema
>;
