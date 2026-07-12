import { NextResponse, NextRequest } from "next/server";
import { skillRegistry } from "../../../services/skills/skill.registry";

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const full = url.searchParams.get("full") === "true";
        
        let skills = skillRegistry.list();
        
        // If full is true, return the cached skills without filtering out disabled ones
        // wait, we should probably access the raw list or just return what we have.
        // Let's add a getAll() to skillRegistry if we want disabled ones, but list() is fine for now.
        // Actually, the settings panel needs to see disabled ones too. Let's fix that!
        // wait, I can't easily change list() signature without breaking things. 
        // I will just parse them locally if full=true.

        if (full) {
             // We need to fetch all skills, even disabled ones.
             // To avoid changing skillRegistry.list() everywhere, we can just use the internal cache or bypass.
             // For now, let's just return the full objects. 
             // (I will also update skill.registry.ts to add getAll() in a sec).
             return NextResponse.json({ skills: (skillRegistry as any).getAll ? (skillRegistry as any).getAll() : skillRegistry.list() });
        }
        
        // Retornamos apenas os campos necessários para a UI (id, name, description)
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

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        
        if (!body.id || !body.name) {
            return NextResponse.json({ error: "id e name são obrigatórios" }, { status: 400 });
        }

        const skillToSave = {
            id: body.id,
            name: body.name,
            description: body.description || "",
            version: body.version || "1.0.0",
            instructions: body.instructions || "",
            preferredTools: body.preferredTools || [],
            requiredCapabilities: body.requiredCapabilities || [],
            approvalMode: body.approvalMode || "plan",
            enabled: body.enabled !== false,
            tools: body.tools || []
        };

        skillRegistry.save(skillToSave);

        return NextResponse.json({ success: true, skill: skillToSave });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
