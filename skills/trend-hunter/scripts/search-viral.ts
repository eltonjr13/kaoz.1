/// <reference types="node" />
// Script para buscar vídeos virais no DuckDuckGo HTML Lite
// Utiliza a sintaxe 'site:tiktok.com OR site:youtube.com "nicho" viral'

async function fetchDuckDuckGo(query: string) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
        });
        
        if (!response.ok) {
            return { error: `HTTP ${response.status}` };
        }
        
        const html = await response.text();
        const results = [];
        
        // Parsing muito básico usando Regex para evitar dependência do cheerio no script local
        const resultRegex = /<a class="result__url" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        let count = 0;
        
        while ((match = resultRegex.exec(html)) !== null && count < 10) {
            results.push({
                url: match[1].trim(),
                title: match[2].replace(/<[^>]+>/g, '').trim(),
                snippet: match[3].replace(/<[^>]+>/g, '').trim()
            });
            count++;
        }
        
        return results;
    } catch (error: any) {
        return { error: error.message };
    }
}

async function main() {
    try {
        const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
        const args = JSON.parse(rawArgs);
        const niche = args.niche;
        
        if (!niche) {
            throw new Error("O parâmetro 'niche' é obrigatório.");
        }
        
        const query = `(site:tiktok.com OR site:youtube.com OR site:instagram.com) "${niche}" (viral OR trend)`;
        const results = await fetchDuckDuckGo(query);
        
        const responseData = {
            niche: niche,
            queryUsed: query,
            results: results
        };
        
        console.log(JSON.stringify(responseData));
        process.exit(0);
    } catch (e: any) {
        console.error(e.message);
        process.exit(1);
    }
}

main();
