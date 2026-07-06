import { OpenAI } from "openai";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const cerebras = new OpenAI({
    apiKey: process.env.CEREBRAS_API_KEY,
    baseURL: process.env.CEREBRAS_BASE_URL
});

async function run() {
    try {
        const response = await cerebras.chat.completions.create({
            model: "llama3.1-70b",
            messages: [{ role: "user", content: "hello" }]
        });
        console.log("llama3.1-70b works!", response.choices[0].message.content);
    } catch (e: any) {
        console.error("llama3.1-70b failed:", e.message);
    }
}
run();
