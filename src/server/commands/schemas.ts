import { z } from "zod";

import { EVIDENCE_STATUSES, KEY_DATE_KINDS, QUALIFICATION_STATUSES } from "@/domain/statuses";

// Shared input schemas. Money and metric values travel as decimal strings.
export const uuid = z.uuid();
export const isoDate = z.iso.date();
export const moneyString = z.string().regex(/^-?\d{1,16}(\.\d{1,2})?$/, "money: decimal string, max 2dp");
export const metricString = z.string().regex(/^-?\d{1,14}(\.\d{1,6})?$/, "metric: decimal string, max 6dp");
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 currency code");
export const nonBlank = z.string().trim().min(1);
export const optionalText = z.string().trim().min(1).optional();

// `undefined` leaves a field unchanged; `null` clears it. Form parsing turns a
// blank input into null so consultants can empty a field they filled earlier.
export const clearableText = z.string().trim().min(1).nullable().optional();
export const clearableDate = isoDate.nullable().optional();
export const clearableMoney = moneyString.nullable().optional();
export const clearableMetric = metricString.nullable().optional();
export const clearableUuid = uuid.nullable().optional();

export const qualificationStatus = z.enum(QUALIFICATION_STATUSES);
export const evidenceStatus = z.enum(EVIDENCE_STATUSES);
export const keyDateKind = z.enum(KEY_DATE_KINDS);
