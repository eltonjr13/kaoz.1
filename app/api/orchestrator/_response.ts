import { NextResponse } from "next/server";
import { ValidationError } from "@/services/orchestrator/orchestrator.schemas";
export function apiError(error:unknown){ const message=error instanceof Error?error.message:String(error); const status=error instanceof ValidationError?400:/não encontrad/i.test(message)?404:409; return NextResponse.json({error:message},{status}); }
