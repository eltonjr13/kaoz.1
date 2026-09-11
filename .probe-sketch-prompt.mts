import { prepareSketchCompositeReference } from "./lib/sketch/sketch-composite-preparer.ts";
import { createDefaultProject } from "./lib/sketch/sketch-storage.ts";

const project = createDefaultProject({ id: "probe-1", title: "Probe" });
project.prompt = "Bolo de chocolate ancestral com calda brilhante servido numa mesa rústica ao amanhecer";
project.layers = [
  {
    id: "layer-sketch-root",
    name: "Esboço de Composição",
    type: "sketch",
    paths: [
      {
        id: "p1",
        tool: "brush",
        color: "#ffffff",
        size: 4,
        opacity: 1,
        points: [
          { x: 10, y: 10 },
          { x: 80, y: 90 },
        ],
        isGuide: false,
      },
    ],
    visible: true,
    opacity: 0.85,
    elementKind: "annotation",
    includeInFinalExport: false,
  } as never,
];
project.attachments = [
  {
    id: "att-1",
    name: "bolo.png",
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    role: "product",
    createdAt: new Date().toISOString(),
  },
];

const result = prepareSketchCompositeReference(project, { referenceDataUrlOverride: "data:image/png;base64,AAAA" });
console.log("referenceMode:", result.referenceMode);
console.log("referenceKind:", result.referenceKind);
console.log("operation:", result.providerOptions.operation);
console.log("roles:", result.compositePreview.includedRoles);
console.log("diagnostics:", result.diagnostics.map((d) => d.code + ": " + d.message));
console.log("---- preparedPrompt ----");
console.log(result.preparedPrompt);
console.log("---- word count ----", result.preparedPrompt.split(/\s+/).length);
