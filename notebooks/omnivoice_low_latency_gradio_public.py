"""
OmniVoice low-latency Gradio server with a public URL for MrChicken.

This preserves the current MrChicken contract:
  - predict(0): Voice Clone
  - predict(1): Voice Design

Run in Kaggle/Jupyter after installing deps:
    import sys
    !{sys.executable} -m pip install -q "transformers>=5.3" omnivoice gradio==6.11.0 pydub numpy

Then execute this file/cell. Copy the printed OMNIVOICE_API_URL into MrChicken.
"""

from __future__ import annotations

import os
import time
from functools import lru_cache

import gradio as gr
import numpy as np
import torch
from omnivoice import OmniVoice, OmniVoiceGenerationConfig


os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

# Latency-first CUDA settings. These are safe to leave enabled on modern NVIDIA
# GPUs and help internal float32 matmul/convolution paths.
torch.backends.cudnn.benchmark = True
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True
try:
    torch.set_float32_matmul_precision("high")
except Exception:
    pass


CHECKPOINT = os.getenv("OMNIVOICE_CHECKPOINT", "k2-fsa/OmniVoice")
DEVICE_MAP = os.getenv("OMNIVOICE_DEVICE_MAP", "cuda")
LOAD_ASR = os.getenv("OMNIVOICE_LOAD_ASR", "0").lower() in {"1", "true", "yes"}
ENABLE_COMPILE = os.getenv("OMNIVOICE_COMPILE", "0").lower() in {"1", "true", "yes"}

# Aggressive defaults for conversation latency. Increase steps to 10-12 only if
# quality is not acceptable.
DEFAULT_STEPS = int(os.getenv("OMNIVOICE_DEFAULT_STEPS", "8"))
DEFAULT_GUIDANCE = float(os.getenv("OMNIVOICE_DEFAULT_GUIDANCE", "1.5"))
DEFAULT_DENOISE = os.getenv("OMNIVOICE_DEFAULT_DENOISE", "0").lower() in {"1", "true", "yes"}
DEFAULT_SPEED = float(os.getenv("OMNIVOICE_DEFAULT_SPEED", "1.08"))
DEFAULT_DURATION = float(os.getenv("OMNIVOICE_DEFAULT_DURATION", "0"))
DEFAULT_PREPROCESS = os.getenv("OMNIVOICE_DEFAULT_PREPROCESS", "0").lower() in {"1", "true", "yes"}
DEFAULT_POSTPROCESS = os.getenv("OMNIVOICE_DEFAULT_POSTPROCESS", "0").lower() in {"1", "true", "yes"}


print(f"Loading OmniVoice from {CHECKPOINT} ...")
model = OmniVoice.from_pretrained(
    CHECKPOINT,
    device_map=DEVICE_MAP,
    dtype=torch.float16,
    load_asr=LOAD_ASR,
    token=False,
)
model.eval()
sampling_rate = int(model.sampling_rate)

if ENABLE_COMPILE:
    try:
        model = torch.compile(model, mode="reduce-overhead", fullgraph=False)
        print("torch.compile enabled.")
    except Exception as exc:
        print(f"torch.compile disabled after failure: {type(exc).__name__}: {exc}")

print(f"Model ready. Sampling rate: {sampling_rate} Hz. LOAD_ASR={LOAD_ASR}")


LANGUAGES = [
    "Auto", "English (en)", "Chinese (zh)", "Japanese (ja)", "Korean (ko)",
    "French (fr)", "German (de)", "Spanish (es)", "Portuguese (pt)",
    "Russian (ru)", "Arabic (ar)", "Hindi (hi)", "Italian (it)",
    "Dutch (nl)", "Turkish (tr)", "Polish (pl)", "Swedish (sv)",
    "Thai (th)", "Vietnamese (vi)", "Indonesian (id)", "Malay (ms)",
]


def _language_code(language: str | None) -> str | None:
    if not language or language == "Auto":
        return None
    if "(" in language and ")" in language:
        return language.split("(")[-1].rstrip(")").strip()
    return language.strip()


def _to_numpy_audio(audio: object) -> tuple[int, np.ndarray]:
    waveform = audio[0].squeeze()
    if hasattr(waveform, "detach"):
        waveform = waveform.detach().float().cpu().numpy()
    elif hasattr(waveform, "numpy"):
        waveform = waveform.numpy()
    waveform = np.clip(waveform, -1.0, 1.0)
    return sampling_rate, (waveform * 32767).astype(np.int16)


@lru_cache(maxsize=32)
def _cached_voice_clone_prompt(ref_audio: str, ref_text: str | None) -> object:
    return model.create_voice_clone_prompt(
        ref_audio=ref_audio,
        ref_text=ref_text or None,
    )


def generate_speech(
    text,
    language,
    ref_audio,
    instruct,
    num_step,
    guidance_scale,
    denoise,
    speed,
    duration,
    preprocess_prompt,
    postprocess_output,
    mode="clone",
    ref_text=None,
):
    text = (text or "").strip()
    if not text:
        return None, "Texto obrigatorio."

    generation_config = OmniVoiceGenerationConfig(
        num_step=int(num_step or DEFAULT_STEPS),
        guidance_scale=float(guidance_scale if guidance_scale is not None else DEFAULT_GUIDANCE),
        denoise=bool(denoise),
        preprocess_prompt=bool(preprocess_prompt),
        postprocess_output=bool(postprocess_output),
    )

    kwargs = {
        "text": text,
        "language": _language_code(language),
        "generation_config": generation_config,
    }

    if speed is not None and float(speed) != 1.0:
        kwargs["speed"] = float(speed)
    if duration is not None and float(duration) > 0:
        kwargs["duration"] = float(duration)

    if mode == "clone":
        if not ref_audio:
            return None, "Envie um audio de referencia para clonagem."
        kwargs["voice_clone_prompt"] = _cached_voice_clone_prompt(ref_audio, ref_text or None)
    elif instruct and str(instruct).strip():
        kwargs["instruct"] = str(instruct).strip()

    if torch.cuda.is_available():
        torch.cuda.synchronize()
    start = time.perf_counter()
    try:
        with torch.inference_mode():
            audio = model.generate(**kwargs)
    except Exception as exc:
        return None, f"Erro: {type(exc).__name__}: {exc}"
    if torch.cuda.is_available():
        torch.cuda.synchronize()

    sr, waveform = _to_numpy_audio(audio)
    elapsed = time.perf_counter() - start
    seconds = waveform.shape[-1] / sr
    return (sr, waveform), f"Gerado em {elapsed:.2f}s | audio {seconds:.1f}s | steps={int(num_step or DEFAULT_STEPS)}"


def lang_dropdown():
    return gr.Dropdown(label="Language", choices=LANGUAGES, value="Portuguese (pt)")


def gen_settings():
    with gr.Accordion("Advanced Settings", open=False):
        ns = gr.Slider(4, 32, value=DEFAULT_STEPS, step=1, label="Inference Steps")
        gs = gr.Slider(0.0, 6.0, value=DEFAULT_GUIDANCE, step=0.1, label="Guidance Scale")
        dn = gr.Checkbox(value=DEFAULT_DENOISE, label="Denoise")
        sp = gr.Slider(0.7, 1.5, value=DEFAULT_SPEED, step=0.01, label="Speed")
        du = gr.Slider(0, 30, value=DEFAULT_DURATION, step=0.5, label="Duration (0 = auto)")
        pp = gr.Checkbox(value=DEFAULT_PREPROCESS, label="Preprocess Prompt")
        po = gr.Checkbox(value=DEFAULT_POSTPROCESS, label="Postprocess Output")
    return ns, gs, dn, sp, du, pp, po


def build_instruct(groups):
    selected = [g for g in groups if g and g != "Auto"]
    return ", ".join(selected) if selected else "female, young adult, portuguese accent"


CATEGORIES = {
    "Gender": ["male", "female"],
    "Age": ["child", "teenager", "young adult", "middle-aged", "elderly"],
    "Pitch": ["very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch"],
    "Style": ["whisper"],
    "English Accent": [
        "american accent", "british accent", "australian accent", "canadian accent",
        "indian accent", "chinese accent", "japanese accent", "korean accent",
        "portuguese accent", "russian accent",
    ],
    "Chinese Dialect": ["四川话", "陕西话", "广东话", "东北话", "河南话", "云南话", "贵州话", "桂林话", "济南话"],
}


with gr.Blocks(title="OmniVoice Low Latency") as demo:
    gr.Markdown("# OmniVoice Low Latency")

    with gr.Tabs():
        # Keep this tab first: MrChicken calls predict(0) for clone mode.
        with gr.TabItem("Voice Clone"):
            vc_text = gr.Textbox(label="Text to Synthesize", lines=4)
            vc_lang = lang_dropdown()
            vc_ref_audio = gr.Audio(label="Reference Audio", type="filepath")
            vc_ref_text = gr.Textbox(label="Reference Text (optional)", lines=2)
            vc_ns, vc_gs, vc_dn, vc_sp, vc_du, vc_pp, vc_po = gen_settings()
            vc_btn = gr.Button("Generate", variant="primary")
            vc_audio = gr.Audio(label="Output Audio", type="numpy")
            vc_status = gr.Textbox(label="Status", lines=2)

            def clone_fn(text, lang, ref_audio, ref_text, ns, gs, dn, sp, du, pp, po):
                return generate_speech(
                    text, lang, ref_audio, None, ns, gs, dn, sp, du, pp, po,
                    mode="clone", ref_text=ref_text or None,
                )

            vc_btn.click(
                clone_fn,
                inputs=[vc_text, vc_lang, vc_ref_audio, vc_ref_text, vc_ns, vc_gs, vc_dn, vc_sp, vc_du, vc_pp, vc_po],
                outputs=[vc_audio, vc_status],
            )

        # Keep this tab second: MrChicken calls predict(1) for design mode.
        with gr.TabItem("Voice Design"):
            vd_text = gr.Textbox(label="Text to Synthesize", lines=4)
            vd_lang = lang_dropdown()
            vd_groups = [
                gr.Dropdown(label=cat, choices=["Auto"] + choices, value="Auto")
                for cat, choices in CATEGORIES.items()
            ]
            vd_ns, vd_gs, vd_dn, vd_sp, vd_du, vd_pp, vd_po = gen_settings()
            vd_btn = gr.Button("Generate", variant="primary")
            vd_audio = gr.Audio(label="Output Audio", type="numpy")
            vd_status = gr.Textbox(label="Status", lines=2)

            def design_fn(text, lang, ns, gs, dn, sp, du, pp, po, *groups):
                return generate_speech(
                    text, lang, None, build_instruct(groups), ns, gs, dn, sp, du, pp, po,
                    mode="design",
                )

            vd_btn.click(
                design_fn,
                inputs=[vd_text, vd_lang, vd_ns, vd_gs, vd_dn, vd_sp, vd_du, vd_pp, vd_po] + vd_groups,
                outputs=[vd_audio, vd_status],
            )


launch_info = demo.queue(default_concurrency_limit=1).launch(
    share=True,
    debug=False,
    server_name="0.0.0.0",
    server_port=int(os.getenv("GRADIO_SERVER_PORT", "7861")),
)

public_url = getattr(launch_info, "share_url", None) or getattr(launch_info, "local_url", None)
if public_url:
    print(f"OMNIVOICE_API_URL={public_url.rstrip('/')}")
    print("Cole essa URL no MrChicken em Settings > OmniVoice ou no .env.local.")
