import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";

const sourcePath = path.join(process.cwd(), "Tool_Working_Detailed_Guide.md");
const outputPath = path.join(process.cwd(), "Tool_Working_Detailed_Guide.pdf");

if (!fs.existsSync(sourcePath)) {
  console.error(`Source file not found: ${sourcePath}`);
  process.exit(1);
}

const markdown = fs.readFileSync(sourcePath, "utf8");
const lines = markdown.split(/\r?\n/);

const doc = new jsPDF({
  orientation: "portrait",
  unit: "mm",
  format: "a4",
});

const pageWidth = doc.internal.pageSize.getWidth();
const pageHeight = doc.internal.pageSize.getHeight();
const margin = 15;
const maxTextWidth = pageWidth - margin * 2;
let y = margin;

function ensureSpace(requiredHeight) {
  if (y + requiredHeight > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }
}

function writeText(text, options = {}) {
  const {
    font = "helvetica",
    style = "normal",
    size = 11,
    lineHeight = 5.5,
    bullet = false,
  } = options;

  doc.setFont(font, style);
  doc.setFontSize(size);

  const prefix = bullet ? "- " : "";
  const wrapped = doc.splitTextToSize(`${prefix}${text}`, maxTextWidth);

  ensureSpace(wrapped.length * lineHeight);
  doc.text(wrapped, margin, y);
  y += wrapped.length * lineHeight;
}

for (const rawLine of lines) {
  const line = rawLine.trimEnd();

  if (line.trim() === "") {
    y += 3;
    continue;
  }

  if (line.startsWith("# ")) {
    y += 2;
    writeText(line.replace(/^#\s+/, ""), {
      style: "bold",
      size: 17,
      lineHeight: 7,
    });
    y += 1;
    continue;
  }

  if (line.startsWith("## ")) {
    y += 1;
    writeText(line.replace(/^##\s+/, ""), {
      style: "bold",
      size: 14,
      lineHeight: 6,
    });
    continue;
  }

  if (line.startsWith("### ")) {
    writeText(line.replace(/^###\s+/, ""), {
      style: "bold",
      size: 12,
      lineHeight: 5.5,
    });
    continue;
  }

  if (line === "---") {
    ensureSpace(6);
    doc.setDrawColor(170);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;
    continue;
  }

  if (line.startsWith("- ")) {
    writeText(line.replace(/^-\s+/, ""), {
      size: 11,
      lineHeight: 5,
      bullet: true,
    });
    continue;
  }

  if (/^\d+\.\s+/.test(line)) {
    writeText(line, {
      size: 11,
      lineHeight: 5,
    });
    continue;
  }

  writeText(line, {
    size: 11,
    lineHeight: 5.5,
  });
}

const totalPages = doc.getNumberOfPages();
for (let i = 1; i <= totalPages; i += 1) {
  doc.setPage(i);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, {
    align: "right",
  });
}

doc.save(outputPath);
console.log(`PDF created: ${outputPath}`);
