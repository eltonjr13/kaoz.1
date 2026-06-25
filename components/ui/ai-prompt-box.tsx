import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUp, Paperclip, Square, X, SlidersHorizontal, BrainCog, FolderCode, Mic } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Utility function for className merging
const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ");

// Embedded CSS for minimal custom styles
const styles = `
  *:focus-visible {
    outline-offset: 0 !important;
    --ring-offset: 0 !important;
  }
  textarea::-webkit-scrollbar {
    width: 6px;
  }
  textarea::-webkit-scrollbar-track {
    background: transparent;
  }
  textarea::-webkit-scrollbar-thumb {
    background-color: #444444;
    border-radius: 3px;
  }
  textarea::-webkit-scrollbar-thumb:hover {
    background-color: #555555;
  }
`;

// Inject styles into document
if (typeof document !== "undefined") {
  const styleSheet = document.createElement("style");
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);
}

// Textarea Component
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex w-full rounded-md border-none bg-transparent px-3 py-2.5 text-base text-gray-100 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] resize-none scrollbar-thin scrollbar-thumb-[#444444] scrollbar-track-transparent hover:scrollbar-thumb-[#555555]",
      className
    )}
    ref={ref}
    rows={1}
    {...props}
  />
));
Textarea.displayName = "Textarea";

// Tooltip Components
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border border-[#333333] bg-[#1F2023] px-3 py-1.5 text-sm text-white shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// Dialog Components
const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-[90vw] md:max-w-[800px] translate-x-[-50%] translate-y-[-50%] gap-4 border border-[#333333] bg-[#1F2023] p-0 shadow-xl duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-2xl",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-full bg-[#2E3033]/80 p-2 hover:bg-[#2E3033] transition-all">
        <X className="h-5 w-5 text-gray-200 hover:text-white" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight text-gray-100", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

// Button Component
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variantClasses = {
      default: "bg-white hover:bg-white/80 text-black",
      outline: "border border-[#444444] bg-transparent hover:bg-[#3A3A40]",
      ghost: "bg-transparent hover:bg-[#3A3A40]",
    };
    const sizeClasses = {
      default: "h-10 px-4 py-2",
      sm: "h-8 px-3 text-sm",
      lg: "h-12 px-6",
      icon: "h-8 w-8 rounded-full aspect-[1/1]",
    };
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

// VoiceRecorder Component
const VOICE_BAR_COUNT = 32;
const SILENCE_LEVELS = Array.from({ length: VOICE_BAR_COUNT }, () => 0.08);
const VOICE_ACTIVITY_THRESHOLD = 0.035;

interface VoiceRecorderProps {
  elapsedSeconds: number;
  isVoiceActive: boolean;
  levels: number[];
  onStopRecording: () => void;
}
const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  elapsedSeconds,
  isVoiceActive,
  levels,
  onStopRecording,
}) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className="relative flex min-h-[150px] w-full flex-col items-center justify-center rounded-[22px] bg-[#1F2023] px-6 py-6 transition-all duration-300 md:min-h-[170px]"
    >
      <div className="absolute top-5 flex items-center gap-2">
        <div className={cn("h-2 w-2 rounded-full bg-red-500", isVoiceActive && "animate-pulse")} />
        <span className="font-mono text-[12px] font-semibold leading-none text-white/85">{formatTime(elapsedSeconds)}</span>
      </div>
      <div className="flex h-20 w-full max-w-[320px] items-center justify-center gap-[3px] px-4">
        {levels.map((level, i) => (
          <div
            key={i}
            className={cn(
              "w-[2.5px] rounded-full transition-all duration-75",
              isVoiceActive ? "bg-white/75" : "bg-white/32"
            )}
            style={{
              height: `${isVoiceActive ? Math.max(20, Math.min(100, level * 100)) : Math.max(8, Math.min(18, level * 100))}%`,
            }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onStopRecording}
        className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-red-500 shadow-[0_8px_22px_rgba(0,0,0,0.28)] transition-transform hover:scale-105"
        aria-label="Parar gravacao"
        title="Parar gravacao"
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-red-500">
          <Square className="h-2.5 w-2.5 fill-current" />
        </span>
      </button>
    </div>
  );
};

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: BrowserSpeechRecognitionResult;
  };
}

interface BrowserSpeechRecognitionErrorEvent {
  error?: string;
  message?: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

interface VoiceAnalysisFrame {
  isVoiceActive: boolean;
  levels: number[];
}

type BrowserAudioContextConstructor = new () => AudioContext;

const createSilenceLevels = () => [...SILENCE_LEVELS];

const createBrowserAudioContext = () => {
  if (typeof window === "undefined") return null;
  const browserWindow = window as typeof window & {
    webkitAudioContext?: BrowserAudioContextConstructor;
  };
  const AudioContextConstructor = window.AudioContext || browserWindow.webkitAudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : null;
};

const analyzeVoiceFrame = (data: Uint8Array): VoiceAnalysisFrame => {
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const centered = (data[i] - 128) / 128;
    sumSquares += centered * centered;
  }

  const rms = Math.sqrt(sumSquares / data.length);
  const isVoiceActive = rms > VOICE_ACTIVITY_THRESHOLD;
  if (!isVoiceActive) {
    return { isVoiceActive, levels: createSilenceLevels() };
  }

  const bucketSize = Math.max(1, Math.floor(data.length / VOICE_BAR_COUNT));
  const levels = Array.from({ length: VOICE_BAR_COUNT }, (_, index) => {
    let bucketPeak = 0;
    const start = index * bucketSize;
    const end = Math.min(data.length, start + bucketSize);

    for (let i = start; i < end; i++) {
      bucketPeak = Math.max(bucketPeak, Math.abs(data[i] - 128) / 128);
    }

    return Math.min(1, Math.max(0.12, bucketPeak * 3.2));
  });

  return { isVoiceActive, levels };
};

const getNativeSpeechRecognition = () => {
  if (typeof window === "undefined") return null;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
};

const createNativeSpeechRecognition = () => {
  const Recognition = getNativeSpeechRecognition();
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "pt-BR";
  return recognition;
};

// ImageViewDialog Component
interface ImageViewDialogProps {
  imageUrl: string | null;
  onClose: () => void;
}
const ImageViewDialog: React.FC<ImageViewDialogProps> = ({ imageUrl, onClose }) => {
  if (!imageUrl) return null;
  return (
    <Dialog open={!!imageUrl} onOpenChange={onClose}>
      <DialogContent className="p-0 border-none bg-transparent shadow-none max-w-[90vw] md:max-w-[800px]">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative bg-[#1F2023] rounded-2xl overflow-hidden shadow-2xl"
        >
          <img
            src={imageUrl}
            alt="Full preview"
            className="w-full max-h-[80vh] object-contain rounded-2xl"
          />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};

// PromptInput Context and Components
interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
}
const PromptInputContext = React.createContext<PromptInputContextType>({
  isLoading: false,
  value: "",
  setValue: () => {},
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
});
function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context) throw new Error("usePromptInput must be used within a PromptInput");
  return context;
}

interface PromptInputProps {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}
const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      className,
      isLoading = false,
      maxHeight = 240,
      value,
      onValueChange,
      onSubmit,
      children,
      disabled = false,
      onDragOver,
      onDragLeave,
      onDrop,
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = React.useState(value || "");
    const handleChange = (newValue: string) => {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    };
    return (
      <TooltipProvider>
        <PromptInputContext.Provider
          value={{
            isLoading,
            value: value ?? internalValue,
            setValue: onValueChange ?? handleChange,
            maxHeight,
            onSubmit,
            disabled,
          }}
        >
          <div
            ref={ref}
            className={cn(
              "rounded-3xl border border-[#444444] bg-[#1F2023] p-2 shadow-[0_8px_30px_rgba(0,0,0,0.24)] transition-all duration-300",
              isLoading && "border-red-500/70",
              className
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {children}
          </div>
        </PromptInputContext.Provider>
      </TooltipProvider>
    );
  }
);
PromptInput.displayName = "PromptInput";

interface PromptInputTextareaProps {
  disableAutosize?: boolean;
  placeholder?: string;
}
const PromptInputTextarea: React.FC<PromptInputTextareaProps & React.ComponentProps<typeof Textarea>> = ({
  className,
  onKeyDown,
  disableAutosize = false,
  placeholder,
  ...props
}) => {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height =
      typeof maxHeight === "number"
        ? `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
        : `min(${textareaRef.current.scrollHeight}px, ${maxHeight})`;
  }, [value, maxHeight, disableAutosize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(e);
  };

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn("text-base", className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
};

type PromptInputActionsProps = React.HTMLAttributes<HTMLDivElement>;
const PromptInputActions: React.FC<PromptInputActionsProps> = ({ children, className, ...props }) => (
  <div className={cn("flex items-center gap-2", className)} {...props}>
    {children}
  </div>
);

interface PromptInputActionProps extends React.ComponentProps<typeof Tooltip> {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}
const PromptInputAction: React.FC<PromptInputActionProps> = ({
  tooltip,
  children,
  className,
  side = "top",
  ...props
}) => {
  const { disabled } = usePromptInput();
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

// Custom Divider Component
const CustomDivider: React.FC = () => (
  <div className="relative h-6 w-[1.5px] mx-1">
    <div
      className="absolute inset-0 bg-gradient-to-t from-transparent via-[#9b87f5]/70 to-transparent rounded-full"
      style={{
        clipPath: "polygon(0% 0%, 100% 0%, 100% 40%, 140% 50%, 100% 60%, 100% 100%, 0% 100%, 0% 60%, -40% 50%, 0% 40%)",
      }}
    />
  </div>
);

// Main PromptInputBox Component
interface PromptInputBoxProps {
  onSend?: (message: string, files?: File[]) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  onOptionsClick?: () => void;
  showOptions?: boolean;
  useCortexMemory?: boolean;
  onCortexMemoryChange?: (value: boolean) => void;
}
export const PromptInputBox = React.forwardRef((props: PromptInputBoxProps, ref: React.Ref<HTMLDivElement>) => {
  const {
    onSend = () => {},
    isLoading = false,
    placeholder = "Type your message here...",
    className,
    onOptionsClick,
    showOptions = false,
    useCortexMemory = true,
    onCortexMemoryChange
  } = props;
  const [input, setInput] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [filePreviews, setFilePreviews] = React.useState<{ [key: string]: string }>({});
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [isVoiceActive, setIsVoiceActive] = React.useState(false);
  const [voiceLevels, setVoiceLevels] = React.useState(createSilenceLevels);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const [interimTranscript, setInterimTranscript] = React.useState("");
  const [recordingError, setRecordingError] = React.useState("");
  const [showCanvas, setShowCanvas] = React.useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const promptBoxRef = React.useRef<HTMLDivElement>(null);
  const speechRecognitionRef = React.useRef<BrowserSpeechRecognition | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const audioSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const micStreamRef = React.useRef<MediaStream | null>(null);
  const voiceFrameRef = React.useRef<number | null>(null);
  const voiceActiveRef = React.useRef(false);
  const recordingTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const handleToggleChange = (value: string) => {
    if (value === "cortex") {
      onCortexMemoryChange?.(!useCortexMemory);
    }
  };

  const handleCanvasToggle = () => setShowCanvas((prev) => !prev);

  const isImageFile = (file: File) => file.type.startsWith("image/");

  const processFile = React.useCallback((file: File) => {
    if (!isImageFile(file)) {
      console.log("Only image files are allowed");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      console.log("File too large (max 10MB)");
      return;
    }
    setFiles([file]);
    const reader = new FileReader();
    reader.onload = (e) => setFilePreviews({ [file.name]: e.target?.result as string });
    reader.readAsDataURL(file);
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFiles = Array.from(e.dataTransfer.files);
    const imageFiles = droppedFiles.filter((file) => isImageFile(file));
    if (imageFiles.length > 0) processFile(imageFiles[0]);
  }, [processFile]);

  const handleRemoveFile = (index: number) => {
    const fileToRemove = files[index];
    if (fileToRemove && filePreviews[fileToRemove.name]) setFilePreviews({});
    setFiles([]);
  };

  const openImageModal = (imageUrl: string) => setSelectedImage(imageUrl);

  const resetVoiceMeter = React.useCallback(() => {
    voiceActiveRef.current = false;
    setIsVoiceActive(false);
    setVoiceLevels(createSilenceLevels());
  }, []);

  const stopRecordingTimer = React.useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const startRecordingTimer = React.useCallback(() => {
    stopRecordingTimer();
    setRecordingSeconds(0);
    recordingTimerRef.current = setInterval(() => {
      if (voiceActiveRef.current) {
        setRecordingSeconds((seconds) => seconds + 1);
      }
    }, 1000);
  }, [stopRecordingTimer]);

  const stopVoiceMeter = React.useCallback(() => {
    if (voiceFrameRef.current !== null) {
      cancelAnimationFrame(voiceFrameRef.current);
      voiceFrameRef.current = null;
    }

    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    analyserRef.current = null;

    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close();
    }

    resetVoiceMeter();
  }, [resetVoiceMeter]);

  const startVoiceMeter = React.useCallback(async () => {
    const audioContext = createBrowserAudioContext();
    if (!audioContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Medidor de voz nativo nao esta disponivel neste navegador.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.74;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = audioContext;
    audioSourceRef.current = source;
    analyserRef.current = analyser;
    micStreamRef.current = stream;

    const data = new Uint8Array(analyser.fftSize);
    const readVoiceFrame = () => {
      analyser.getByteTimeDomainData(data);
      const frame = analyzeVoiceFrame(data);
      voiceActiveRef.current = frame.isVoiceActive;
      setIsVoiceActive(frame.isVoiceActive);
      setVoiceLevels(frame.levels);
      voiceFrameRef.current = requestAnimationFrame(readVoiceFrame);
    };

    readVoiceFrame();
  }, []);

  const appendTranscription = React.useCallback((text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    setInput((current) => (current.trim() ? `${current.trimEnd()} ${cleanText}` : cleanText));
  }, []);

  const handleSpeechResult = React.useCallback((event: BrowserSpeechRecognitionEvent) => {
    let finalText = "";
    let interimText = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0]?.transcript || "";
      if (result.isFinal) finalText += transcript;
      else interimText += transcript;
    }

    appendTranscription(finalText);
    setInterimTranscript(interimText.trim());
  }, [appendTranscription]);

  const handleSpeechEnd = React.useCallback(() => {
    speechRecognitionRef.current = null;
    setIsRecording(false);
    setInterimTranscript("");
    stopRecordingTimer();
    stopVoiceMeter();
  }, [stopRecordingTimer, stopVoiceMeter]);

  const handleSpeechError = React.useCallback((event: BrowserSpeechRecognitionErrorEvent) => {
    const message = event.error === "no-speech"
      ? "Nenhuma voz detectada."
      : event.message || event.error || "Falha ao reconhecer audio pelo navegador.";
    setRecordingError(message);
    setIsRecording(false);
    setInterimTranscript("");
    stopRecordingTimer();
    stopVoiceMeter();
  }, [stopRecordingTimer, stopVoiceMeter]);

  const handleStartRecording = React.useCallback(async () => {
    if (isLoading || isRecording) return;
    setRecordingError("");
    setInterimTranscript("");
    resetVoiceMeter();

    const recognition = createNativeSpeechRecognition();
    if (!recognition) {
      setRecordingError("Transcricao nativa nao esta disponivel neste navegador.");
      return;
    }

    try {
      recognition.onresult = handleSpeechResult;
      recognition.onerror = handleSpeechError;
      recognition.onend = handleSpeechEnd;
      speechRecognitionRef.current = recognition;
      await startVoiceMeter();
      recognition.start();
      setIsRecording(true);
      startRecordingTimer();
    } catch (error) {
      speechRecognitionRef.current = null;
      stopRecordingTimer();
      stopVoiceMeter();
      setRecordingError(error instanceof Error ? error.message : "Nao foi possivel iniciar a transcricao nativa.");
    }
  }, [
    handleSpeechEnd,
    handleSpeechError,
    handleSpeechResult,
    isLoading,
    isRecording,
    resetVoiceMeter,
    startRecordingTimer,
    startVoiceMeter,
    stopRecordingTimer,
    stopVoiceMeter,
  ]);

  const handleStopRecording = React.useCallback(() => {
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    setIsRecording(false);
    setInterimTranscript("");
    stopRecordingTimer();
    stopVoiceMeter();
  }, [stopRecordingTimer, stopVoiceMeter]);

  React.useEffect(() => {
    return () => {
      const recognition = speechRecognitionRef.current;
      if (recognition) {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        recognition.abort();
      }
      stopRecordingTimer();
      stopVoiceMeter();
    };
  }, [stopRecordingTimer, stopVoiceMeter]);

  const handlePaste = React.useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
          break;
        }
      }
    }
  }, [processFile]);

  React.useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleSubmit = () => {
    if (input.trim() || files.length > 0) {
      let messagePrefix = "";
      if (showCanvas) messagePrefix = "[Canvas: ";
      const formattedInput = messagePrefix ? `${messagePrefix}${input}]` : input;
      onSend(formattedInput, files);
      setInput("");
      setFiles([]);
      setFilePreviews({});
    }
  };

  const hasContent = input.trim() !== "" || files.length > 0;
  const visibleTranscript = [input.trim(), interimTranscript.trim()].filter(Boolean).join(" ");

  return (
    <>
      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className={cn(
          "w-full bg-[#1F2023] border-[#444444] shadow-[0_8px_30px_rgba(0,0,0,0.24)] transition-all duration-300 ease-in-out",
          isRecording && "min-h-[170px] rounded-[24px] border-red-500/90 p-0 shadow-[0_0_0_1px_rgba(239,68,68,0.28),0_18px_42px_rgba(0,0,0,0.34)] md:min-h-[190px]",
          className
        )}
        disabled={isLoading}
        ref={ref || promptBoxRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {files.length > 0 && !isRecording && (
          <div className="flex flex-wrap gap-2 p-0 pb-1 transition-all duration-300">
            {files.map((file, index) => (
              <div key={index} className="relative group">
                {file.type.startsWith("image/") && filePreviews[file.name] && (
                  <div
                    className="w-16 h-16 rounded-xl overflow-hidden cursor-pointer transition-all duration-300"
                    onClick={() => openImageModal(filePreviews[file.name])}
                  >
                    <img
                      src={filePreviews[file.name]}
                      alt={file.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(index);
                      }}
                      className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            "transition-all duration-300",
            isRecording ? "h-0 overflow-hidden opacity-0" : "opacity-100"
          )}
        >
          <PromptInputTextarea
            placeholder={
              showCanvas
                ? "Create on canvas..."
                : placeholder
            }
            className="text-base"
          />
        </div>

        {isRecording && (
          <>
            <VoiceRecorder
              elapsedSeconds={recordingSeconds}
              isVoiceActive={isVoiceActive}
              levels={voiceLevels}
              onStopRecording={handleStopRecording}
            />
            <div
              className="min-h-[22px] w-full whitespace-pre-wrap break-words px-5 pb-4 pt-1 text-left text-[13px] leading-relaxed text-white/80"
              aria-live="polite"
            >
              {visibleTranscript || (isVoiceActive ? "Voz detectada..." : "Aguardando voz...")}
            </div>
          </>
        )}

        {recordingError && !isRecording && (
          <div className={cn("px-3 pb-1 text-xs", recordingError ? "text-red-300" : "text-white/50")}>
            {recordingError}
          </div>
        )}

        {!isRecording && (
          <PromptInputActions className="flex items-center justify-between gap-2 p-0 pt-2">
            <div
              className={cn(
                "flex items-center gap-1 transition-opacity duration-300",
                isRecording ? "opacity-0 invisible h-0" : "opacity-100 visible"
              )}
            >
              <PromptInputAction tooltip="Upload image">
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="flex h-8 w-8 text-[#9CA3AF] cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-gray-600/30 hover:text-[#D1D5DB]"
                  disabled={isRecording}
                >
                  <Paperclip className="h-5 w-5 transition-colors" />
                  <input
                    ref={uploadInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) processFile(e.target.files[0]);
                      if (e.target) e.target.value = "";
                    }}
                    accept="image/*"
                  />
                </button>
              </PromptInputAction>

            <div className="flex items-center">
              <button
                type="button"
                onClick={onOptionsClick}
                className={cn(
                  "rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8",
                  showOptions
                    ? "bg-[#9D7CFF]/15 border-[#9D7CFF] text-[#9D7CFF]"
                    : "bg-transparent border-transparent text-[#9CA3AF] hover:text-[#D1D5DB]"
                )}
              >
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  <motion.div
                    animate={{ rotate: showOptions ? 90 : 0, scale: showOptions ? 1.1 : 1 }}
                    whileHover={{ rotate: showOptions ? 90 : 15, scale: 1.1, transition: { type: "spring", stiffness: 300, damping: 10 } }}
                    transition={{ type: "spring", stiffness: 260, damping: 25 }}
                  >
                    <SlidersHorizontal className={cn("w-4 h-4", showOptions ? "text-[#9D7CFF]" : "text-inherit")} />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {showOptions && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "auto", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-[#9D7CFF] flex-shrink-0"
                    >
                      Options
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              <CustomDivider />

              <button
                type="button"
                onClick={() => handleToggleChange("cortex")}
                className={cn(
                  "rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8",
                  useCortexMemory
                    ? "bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#8B5CF6]"
                    : "bg-transparent border-transparent text-[#9CA3AF] hover:text-[#D1D5DB]"
                )}
                title={useCortexMemory ? "Cortex ligado: usa e grava memoria" : "Cortex desligado: nao usa nem grava memoria"}
              >
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  <motion.div
                    animate={{ rotate: useCortexMemory ? 360 : 0, scale: useCortexMemory ? 1.1 : 1 }}
                    whileHover={{ rotate: useCortexMemory ? 360 : 15, scale: 1.1, transition: { type: "spring", stiffness: 300, damping: 10 } }}
                    transition={{ type: "spring", stiffness: 260, damping: 25 }}
                  >
                    <BrainCog className={cn("w-4 h-4", useCortexMemory ? "text-[#8B5CF6]" : "text-inherit")} />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {useCortexMemory && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "auto", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-[#8B5CF6] flex-shrink-0"
                    >
                      Cortex
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              <CustomDivider />

              <button
                type="button"
                onClick={handleCanvasToggle}
                className={cn(
                  "rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8",
                  showCanvas
                    ? "bg-[#F97316]/15 border-[#F97316] text-[#F97316]"
                    : "bg-transparent border-transparent text-[#9CA3AF] hover:text-[#D1D5DB]"
                )}
              >
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                  <motion.div
                    animate={{ rotate: showCanvas ? 360 : 0, scale: showCanvas ? 1.1 : 1 }}
                    whileHover={{ rotate: showCanvas ? 360 : 15, scale: 1.1, transition: { type: "spring", stiffness: 300, damping: 10 } }}
                    transition={{ type: "spring", stiffness: 260, damping: 25 }}
                  >
                    <FolderCode className={cn("w-4 h-4", showCanvas ? "text-[#F97316]" : "text-inherit")} />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {showCanvas && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "auto", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-[#F97316] flex-shrink-0"
                    >
                      Canvas
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </div>

          <PromptInputAction tooltip={hasContent ? "Send message" : "Gravar audio"}>
            <Button
              variant="default"
              size="icon"
              className={cn(
                "h-8 w-8 rounded-full border border-white/20 bg-white text-[#1F2023] shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-all duration-200 hover:bg-white/85 disabled:opacity-100",
                !hasContent && "text-[#1F2023]"
              )}
              onClick={() => {
                if (hasContent) handleSubmit();
                else handleStartRecording();
              }}
              disabled={isLoading}
              aria-label={hasContent ? "Enviar mensagem" : "Gravar audio"}
              title={hasContent ? "Enviar mensagem" : "Gravar audio"}
              style={{
                backgroundColor: "#ffffff",
                borderColor: "rgba(255,255,255,0.28)",
                color: "#1F2023",
                opacity: 1,
              }}
            >
              {isLoading ? (
                <Square className="h-4 w-4 animate-pulse fill-current" />
              ) : hasContent ? (
                <ArrowUp className="h-4 w-4 text-current" />
              ) : (
                <Mic className="h-4 w-4 text-current" />
              )}
            </Button>
          </PromptInputAction>
        </PromptInputActions>
        )}
      </PromptInput>

      <ImageViewDialog imageUrl={selectedImage} onClose={() => setSelectedImage(null)} />
    </>
  );
});
PromptInputBox.displayName = "PromptInputBox";
