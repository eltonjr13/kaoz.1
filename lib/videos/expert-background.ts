import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

type RenderWithFfmpeg = (args: string[]) => Promise<void>;

type PrepareExpertCutoutInput = {
  mediaPath: string;
  workDir: string;
  isImage: boolean;
  fps: number;
  renderWithFfmpeg: RenderWithFfmpeg;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

function getPythonCommand() {
  return process.env.REMBG_PYTHON_PATH || process.env.PYTHON_PATH || "python";
}

function isMissingCommandError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      const chunkStr = chunk.toString();
      stdout.push(chunkStr);
      process.stdout.write(chunkStr);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const chunkStr = chunk.toString();
      stderr.push(chunkStr);
      process.stderr.write(chunkStr);
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const result = {
        stdout: stdout.join(""),
        stderr: stderr.join("")
      };

      if (code === 0) {
        resolve(result);
        return;
      }

      reject(new Error(`${command} falhou com codigo ${code ?? "desconhecido"}.\n${result.stderr}`));
    });
  });
}

async function runRembg(args: string[]) {
  const scriptPath = path.join(process.cwd(), "scripts", "remove-background.py");

  try {
    await runCommand(getPythonCommand(), [scriptPath, ...args]);
  } catch (error) {
    if (isMissingCommandError(error)) {
      throw new Error("Python nao encontrado. Configure REMBG_PYTHON_PATH ou PYTHON_PATH para remover o fundo do expert.");
    }

    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Nao foi possivel remover o fundo do expert. Instale as dependencias com " +
        "`python -m pip install rembg pillow onnxruntime`.\n" +
        details
    );
  }
}

async function cleanDir(dirPath: string) {
  await rm(dirPath, { recursive: true, force: true });
  await mkdir(dirPath, { recursive: true });
}

async function assertGeneratedFrames(dirPath: string) {
  const files = await readdir(dirPath);
  if (!files.some((file) => file.toLowerCase().endsWith(".png"))) {
    throw new Error("A remocao de fundo nao gerou frames PNG.");
  }
}

export async function prepareExpertCutout({
  mediaPath,
  workDir,
  isImage,
  fps,
  renderWithFfmpeg
}: PrepareExpertCutoutInput) {
  const cutoutRoot = path.join(workDir, "expert-cutout");
  await mkdir(cutoutRoot, { recursive: true });

  if (isImage) {
    const cutoutImagePath = path.join(cutoutRoot, "expert-cutout.png");
    await runRembg(["--input", mediaPath, "--output", cutoutImagePath]);
    return cutoutImagePath;
  }

  const framesDir = path.join(cutoutRoot, "frames");
  const cutoutFramesDir = path.join(cutoutRoot, "frames-alpha");
  const cutoutVideoPath = path.join(cutoutRoot, "expert-cutout.mov");

  await cleanDir(framesDir);
  await cleanDir(cutoutFramesDir);

  await renderWithFfmpeg([
    "-y",
    "-i",
    mediaPath,
    "-vf",
    `fps=${fps}`,
    path.join(framesDir, "frame-%06d.png")
  ]);

  await runRembg(["--input-dir", framesDir, "--output-dir", cutoutFramesDir]);
  await assertGeneratedFrames(cutoutFramesDir);

  await renderWithFfmpeg([
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(cutoutFramesDir, "frame-%06d.png"),
    "-c:v",
    "qtrle",
    "-pix_fmt",
    "argb",
    cutoutVideoPath
  ]);

  return cutoutVideoPath;
}
