import { PDFDocument } from "@napi-rs/canvas";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = PAGE_HEIGHT - MARGIN;

const COLORS = {
  ink: "#342a4f",
  muted: "#655d73",
  purple: "#7763b7",
  purpleSoft: "#f0e6fa",
  gold: "#c6a54e",
  goldSoft: "#f6ebd4",
  critical: "#a73d45",
  border: "#ded7e6",
  white: "#ffffff",
};

export interface AuditPdfFinding {
  severity: string;
  title: string;
  description?: string | null;
  impact?: string | null;
  fix?: string | null;
}

export interface AuditPdfReportInput {
  claim: {
    claimNumber: string;
    insuredName: string;
    carrier?: string | null;
    dateOfLoss?: string | null;
    lossType?: string | null;
    policyNumber?: string | null;
    propertyAddress?: string | null;
    adjuster?: string | null;
  };
  audit: {
    overallScore: number;
    deskAdjusterScore: number;
    fieldAdjusterScore: number;
    readiness: string;
    technicalRisk: string;
    executiveSummary?: string | null;
  };
  findings: AuditPdfFinding[];
}

function safeText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

export function renderAuditPdfReport(input: AuditPdfReportInput): Buffer {
  const pdf = new PDFDocument({
    title: `${input.claim.claimNumber || "Claim"} Carrier Audit Report`,
    author: "Complete iQ",
    creator: "Complete iQ Carrier Audit",
    producer: "Complete iQ",
  });
  let context!: ReturnType<PDFDocument["beginPage"]>;
  let y = MARGIN;
  let pageNumber = 0;

  const beginPage = () => {
    if (pageNumber > 0) pdf.endPage();
    context = pdf.beginPage(PAGE_WIDTH, PAGE_HEIGHT);
    pageNumber += 1;
    context.fillStyle = COLORS.white;
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.fillStyle = COLORS.purple;
    context.fillRect(0, 0, 12, PAGE_HEIGHT);
    context.fillStyle = COLORS.gold;
    context.fillRect(12, 0, 3, PAGE_HEIGHT);
    context.fillStyle = COLORS.muted;
    context.font = "10px sans-serif";
    context.fillText(`COMPLETE iQ · CARRIER AUDIT · ${pageNumber}`, MARGIN, 28);
    y = MARGIN;
  };

  const ensureSpace = (height: number) => {
    if (y + height <= BOTTOM) return;
    beginPage();
  };

  const wrappedLines = (
    text: string,
    maxWidth: number,
    font: string,
  ): string[] => {
    context.font = font;
    const output: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        output.push("");
        continue;
      }
      let line = words[0]!;
      for (const word of words.slice(1)) {
        const candidate = `${line} ${word}`;
        if (context.measureText(candidate).width <= maxWidth) {
          line = candidate;
        } else {
          output.push(line);
          line = word;
        }
      }
      output.push(line);
    }
    return output;
  };

  const writeWrapped = (
    text: string,
    options: {
      font?: string;
      color?: string;
      lineHeight?: number;
      indent?: number;
      width?: number;
      gapAfter?: number;
    } = {},
  ) => {
    const font = options.font ?? "11px sans-serif";
    const lineHeight = options.lineHeight ?? 16;
    const indent = options.indent ?? 0;
    const lines = wrappedLines(
      safeText(text),
      options.width ?? CONTENT_WIDTH - indent,
      font,
    );
    for (const line of lines) {
      ensureSpace(lineHeight + 2);
      context.font = font;
      context.fillStyle = options.color ?? COLORS.ink;
      context.fillText(line, MARGIN + indent, y);
      y += lineHeight;
    }
    y += options.gapAfter ?? 4;
  };

  const section = (title: string) => {
    ensureSpace(36);
    y += 8;
    context.fillStyle = COLORS.purpleSoft;
    context.fillRect(MARGIN, y - 15, CONTENT_WIDTH, 25);
    context.fillStyle = COLORS.purple;
    context.font = "bold 10px sans-serif";
    context.fillText(title.toUpperCase(), MARGIN + 10, y + 1);
    y += 24;
  };

  const field = (label: string, value: unknown) => {
    ensureSpace(21);
    context.fillStyle = COLORS.muted;
    context.font = "bold 8px sans-serif";
    context.fillText(label.toUpperCase(), MARGIN, y);
    context.fillStyle = COLORS.ink;
    context.font = "11px sans-serif";
    context.fillText(safeText(value), MARGIN + 132, y);
    y += 19;
  };

  beginPage();
  context.fillStyle = COLORS.ink;
  context.font = "bold 25px sans-serif";
  context.fillText("Carrier Audit Report", MARGIN, y);
  y += 29;
  context.fillStyle = COLORS.gold;
  context.fillRect(MARGIN, y, 88, 4);
  y += 20;
  context.fillStyle = COLORS.ink;
  context.font = "bold 18px sans-serif";
  context.fillText(safeText(input.claim.claimNumber), MARGIN, y);
  y += 28;

  section("Claim information");
  field("Insured", input.claim.insuredName);
  field("Carrier", input.claim.carrier);
  field("Date of loss", input.claim.dateOfLoss);
  field("Loss type", input.claim.lossType);
  field("Policy number", input.claim.policyNumber);
  field("Property", input.claim.propertyAddress);
  field("Adjuster", input.claim.adjuster);

  section("Audit outcome");
  const scores = [
    ["OVERALL", `${Math.round(input.audit.overallScore)}%`],
    ["DESK ADJUSTER", `${Math.round(input.audit.deskAdjusterScore)}%`],
    ["FIELD ADJUSTER", `${Math.round(input.audit.fieldAdjusterScore)}%`],
  ];
  const cardWidth = (CONTENT_WIDTH - 20) / 3;
  ensureSpace(75);
  scores.forEach(([label, value], index) => {
    const x = MARGIN + index * (cardWidth + 10);
    context.fillStyle = index === 0 ? COLORS.goldSoft : COLORS.purpleSoft;
    context.fillRect(x, y - 12, cardWidth, 58);
    context.fillStyle = COLORS.muted;
    context.font = "bold 8px sans-serif";
    context.fillText(label!, x + 10, y + 1);
    context.fillStyle = COLORS.ink;
    context.font = "bold 20px sans-serif";
    context.fillText(value!, x + 10, y + 29);
  });
  y += 69;
  field("Readiness", input.audit.readiness);
  field("Technical risk", input.audit.technicalRisk);

  if (input.audit.executiveSummary) {
    section("Executive summary");
    writeWrapped(input.audit.executiveSummary, {
      font: "11px sans-serif",
      lineHeight: 17,
      gapAfter: 8,
    });
  }

  section(`Findings (${input.findings.length})`);
  if (input.findings.length === 0) {
    writeWrapped("No open findings were recorded for this audit.");
  } else {
    input.findings.forEach((finding, index) => {
      ensureSpace(68);
      context.fillStyle = COLORS.border;
      context.fillRect(MARGIN, y - 11, CONTENT_WIDTH, 1);
      context.fillStyle =
        /critical|high|fail/i.test(finding.severity)
          ? COLORS.critical
          : COLORS.purple;
      context.font = "bold 9px sans-serif";
      context.fillText(
        `${String(index + 1).padStart(2, "0")} · ${safeText(finding.severity).toUpperCase()}`,
        MARGIN,
        y + 5,
      );
      y += 22;
      writeWrapped(finding.title, {
        font: "bold 12px sans-serif",
        lineHeight: 17,
      });
      if (finding.description) {
        writeWrapped(finding.description, {
          color: COLORS.muted,
          lineHeight: 15,
        });
      }
      if (finding.impact) {
        writeWrapped(`Impact: ${finding.impact}`, {
          color: COLORS.critical,
          lineHeight: 15,
        });
      }
      if (finding.fix) {
        writeWrapped(`Required action: ${finding.fix}`, {
          color: COLORS.ink,
          lineHeight: 15,
          gapAfter: 10,
        });
      }
    });
  }

  ensureSpace(34);
  y += 12;
  context.fillStyle = COLORS.gold;
  context.fillRect(MARGIN, y, CONTENT_WIDTH, 2);
  y += 17;
  context.fillStyle = COLORS.muted;
  context.font = "9px sans-serif";
  context.fillText(
    "Generated by Complete iQ · Reviewer verification remains required.",
    MARGIN,
    y,
  );

  pdf.endPage();
  return pdf.close();
}
