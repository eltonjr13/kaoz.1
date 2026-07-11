import { NextResponse } from "next/server"; import { orchestratorExecutor } from "@/services/orchestrator/orchestrator.executor"; import { apiError } from "../../../_response";
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){try{return NextResponse.json({run:await orchestratorExecutor.resume((await params).id)});}catch(error){return apiError(error);}}
