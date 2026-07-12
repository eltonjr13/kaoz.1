// Script executado pelo Skill Adapter
// O adapter passa os argumentos na variável de ambiente KAOZ_SKILL_ARGS como uma string JSON.

function main() {
    try {
        const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
        const args = JSON.parse(rawArgs);
        
        const valorConta = parseFloat(args.valorConta);
        const porcentagem = parseFloat(args.porcentagem);
        
        if (isNaN(valorConta) || isNaN(porcentagem)) {
            throw new Error("Parâmetros inválidos. Esperado { valorConta: number, porcentagem: number }");
        }
        
        const valorGorjeta = valorConta * (porcentagem / 100);
        const total = valorConta + valorGorjeta;
        
        // Retornando os dados estruturados via STDOUT (como o adapter espera)
        const resultado = {
            sucesso: true,
            valorOriginal: valorConta,
            gorjetaCalculada: valorGorjeta,
            totalAPagar: total
        };
        
        console.log(JSON.stringify(resultado));
        process.exit(0);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}

main();
