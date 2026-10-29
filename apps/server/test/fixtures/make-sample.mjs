// Generates sample-study.pdf: a short, fictional cohort study used for tests and demos.
// Plain PDF 1.4 with the standard Helvetica font, so no dependencies are needed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pages = [
  [
    ['h', 16, 'Robotic-assisted versus conventional minimally invasive'],
    ['h', 16, 'esophagectomy: a propensity-matched cohort study'],
    ['p', 10, 'A. Example, B. Sample, C. Placeholder (fictional authors for software testing)'],
    ['gap'],
    ['h', 12, 'Methods'],
    ['p', 10, 'Patients who underwent robotic-assisted minimally invasive esophagectomy (RAMIE) or'],
    ['p', 10, 'conventional minimally invasive esophagectomy (MIE) for esophageal cancer between 2015'],
    ['p', 10, 'and 2020 were identified from a prospectively maintained institutional database.'],
    ['p', 10, 'The choice of approach was made by the operating surgeon.'],
    ['gap'],
    ['p', 10, 'Propensity score matching (1:1) was performed using age, sex, ASA classification, body'],
    ['p', 10, 'mass index, clinical stage and neoadjuvant therapy. Smoking history and surgeon experi-'],
    ['p', 10, 'ence were not available in the database and were not included in the model.'],
    ['gap'],
    ['p', 10, 'Anastomotic leak was defined according to the Esophagectomy Complications Consensus'],
    ['p', 10, 'Group (ECCG) definitions and confirmed by contrast study or endoscopy. Outcome assessors'],
    ['p', 10, 'were not blinded to the surgical approach.'],
    ['gap'],
    ['p', 10, 'Follow-up began on the date of surgery. Patients with missing data on clinical stage'],
    ['p', 10, '(n = 12) were excluded from the analysis. No imputation was performed.']
  ],
  [
    ['h', 12, 'Results'],
    ['p', 10, 'A total of 412 patients were identified. After matching, 120 patients were included in'],
    ['p', 10, 'each group. Baseline characteristics were well balanced after matching.'],
    ['gap'],
    ['p', 10, 'Anastomotic leak occurred in 14 (11.7%) patients after RAMIE and 22 (18.3%) after MIE'],
    ['p', 10, '(OR 0.59, 95% CI 0.29 to 1.21, p = 0.15).'],
    ['gap'],
    ['p', 10, 'Table 2. Postoperative outcomes in the matched cohort'],
    ['p', 10, 'Anastomotic leak 14 (11.7%) 22 (18.3%) 0.15'],
    ['p', 10, 'Pneumonia 18 (15.0%) 25 (20.8%) 0.24'],
    ['gap'],
    ['h', 12, 'Discussion'],
    ['p', 10, 'The study was not registered and no protocol or statistical analysis plan was published.'],
    ['p', 10, 'Residual confounding by unmeasured factors such as frailty cannot be excluded. No sensi-'],
    ['p', 10, 'tivity analyses for unmeasured confounding were performed.']
  ]
];

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const objects = [];
const add = (body) => (objects.push(body), objects.length);
const catalog = add('');
const pagesObj = add('');
const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
const kids = [];
for (const lines of pages) {
  let y = 740;
  const ops = [];
  for (const line of lines) {
    if (line[0] === 'gap') {
      y -= 8;
      continue;
    }
    const [kind, size, text] = line;
    ops.push(`BT /${kind === 'h' ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 60 ${y} Tm (${esc(text)}) Tj ET`);
    y -= size + 4;
  }
  const stream = ops.join('\n');
  const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
}
objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

let out = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(out, 'latin1'));
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(out, 'latin1');
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(fileURLToPath(new URL('./sample-study.pdf', import.meta.url)), Buffer.from(out, 'latin1'));
