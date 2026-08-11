import { getSpeechConfig, getSpeechModels, transcribeSpeech, updateSpeechConfig, updateSpeechModel } from "./speech.controller";

export const GET = getSpeechConfig;
export const POST = transcribeSpeech;
export const POST_CONFIG = updateSpeechConfig;
export const GET_MODELS = getSpeechModels;
export const POST_MODELS = updateSpeechModel;
