import { NextResponse } from "next/server"; import { orchestratorService } from "@/services/orchestrator/orchestrator.service"; import { apiError } from "../../../_response";
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){ try{ return NextResponse.json(await orchestratorService.approvePlan((await params).id)); }catch(error){ return apiError(error); } }
