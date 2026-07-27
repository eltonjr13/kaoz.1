import type {
  IntelligentCourseThemeKey,
  IntelligentCourseThemeProfile,
  IntelligentEditDesign,
  IntelligentEditPalette,
  IntelligentEditPlan,
} from "./intelligent-edit.types";

export const INTELLIGENT_EDIT_PALETTES: Record<
  IntelligentEditPalette,
  Omit<IntelligentEditDesign, "captionsEnabled">
> = {
  kaoz: {
    palette: "kaoz",
    colors: {
      background: "#080B14",
      surface: "#151A2D",
      primary: "#7C3AED",
      secondary: "#22D3EE",
      text: "#F8FAFC",
      muted: "#94A3B8",
    },
  },
  electric: {
    palette: "electric",
    colors: {
      background: "#07130F",
      surface: "#10251D",
      primary: "#34D399",
      secondary: "#FACC15",
      text: "#F8FAFC",
      muted: "#A7C7BA",
    },
  },
  premium: {
    palette: "premium",
    colors: {
      background: "#090D18",
      surface: "#171D2F",
      primary: "#D4AF37",
      secondary: "#E8D7A4",
      text: "#FFFDF5",
      muted: "#B7B2A3",
    },
  },
  coral: {
    palette: "coral",
    colors: {
      background: "#160B11",
      surface: "#29121C",
      primary: "#FF5D73",
      secondary: "#FFB86B",
      text: "#FFF8FA",
      muted: "#D2AAB5",
    },
  },
  "course-theme": {
    palette: "course-theme",
    colors: {
      background: "#0B100C",
      surface: "#18231B",
      primary: "#B88A44",
      secondary: "#5E8C61",
      text: "#F7F3E8",
      muted: "#A8B2A3",
    },
  },
};

export const INTELLIGENT_COURSE_THEME_PRESETS: Record<
  IntelligentCourseThemeKey,
  Pick<IntelligentCourseThemeProfile, "label" | "tone" | "colors">
> = {
  ancestral: {
    label: "Vitalidade ancestral",
    tone: "orgânico, firme e transformador",
    colors: {
      background: "#0B100C",
      surface: "#18231B",
      primary: "#C89B52",
      secondary: "#6D9B69",
      text: "#F7F3E8",
      muted: "#A8B2A3",
    },
  },
  performance: {
    label: "Alta performance",
    tone: "direto, energético e orientado a resultados",
    colors: {
      background: "#07120E",
      surface: "#10251B",
      primary: "#B7F34B",
      secondary: "#37D6A3",
      text: "#F6FFF9",
      muted: "#A3C4B3",
    },
  },
  wellness: {
    label: "Bem-estar contemporâneo",
    tone: "acolhedor, claro e equilibrado",
    colors: {
      background: "#0B1515",
      surface: "#152727",
      primary: "#72D6C9",
      secondary: "#E7B98A",
      text: "#F5FBFA",
      muted: "#A8C2BF",
    },
  },
  business: {
    label: "Estratégia e autoridade",
    tone: "seguro, preciso e profissional",
    colors: {
      background: "#09101D",
      surface: "#142039",
      primary: "#4F8CFF",
      secondary: "#7DD3FC",
      text: "#F7FAFF",
      muted: "#9EACC5",
    },
  },
  technology: {
    label: "Tecnologia aplicada",
    tone: "moderno, analítico e inovador",
    colors: {
      background: "#070A16",
      surface: "#111830",
      primary: "#8B5CF6",
      secondary: "#22D3EE",
      text: "#F8FAFC",
      muted: "#9AA8C3",
    },
  },
  creative: {
    label: "Expressão criativa",
    tone: "ousado, humano e memorável",
    colors: {
      background: "#160B11",
      surface: "#29121C",
      primary: "#FF5D73",
      secondary: "#FFB86B",
      text: "#FFF8FA",
      muted: "#D2AAB5",
    },
  },
};

export function courseThemeDesign(
  profile: Pick<IntelligentCourseThemeProfile, "colors">,
  captionsEnabled: boolean,
): IntelligentEditDesign {
  return {
    palette: "course-theme",
    colors: { ...profile.colors },
    captionsEnabled,
  };
}

export function intelligentEditDesign(
  palette: IntelligentEditPalette,
  captionsEnabled: boolean,
): IntelligentEditDesign {
  return {
    ...INTELLIGENT_EDIT_PALETTES[palette],
    colors: { ...INTELLIGENT_EDIT_PALETTES[palette].colors },
    captionsEnabled,
  };
}

export function resolveIntelligentEditDesign(
  plan: Pick<IntelligentEditPlan, "design">,
): IntelligentEditDesign {
  const palette = plan.design?.palette || "kaoz";
  const preset = INTELLIGENT_EDIT_PALETTES[palette] || INTELLIGENT_EDIT_PALETTES.kaoz;
  return {
    ...preset,
    colors: { ...preset.colors, ...plan.design?.colors },
    captionsEnabled: plan.design?.captionsEnabled !== false,
  };
}
