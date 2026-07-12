import { NextResponse } from "next/server";
import { skillRegistry } from "../../../services/skills/skill.registry";

export async function GET() {
    try {
        const skills = skillRegistry.list();
        
        // Retornamos apenas os campos necessários para a UI (id, name, description)
        // Ocultamos as intruções para economizar payload na API, se desejar.
        const uiSkills = skills.map(s => ({
            id: s.id,
            name: s.name,
            description: s.description
        }));
        
        return NextResponse.json({ skills: uiSkills });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
