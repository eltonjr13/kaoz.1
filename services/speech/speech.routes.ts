import { getSpeechConfig, transcribeSpeech, updateSpeechConfig } from "./speech.controller";

export const GET = getSpeechConfig;
export const POST = transcribeSpeech;
export const POST_CONFIG = updateSpeechConfig;
