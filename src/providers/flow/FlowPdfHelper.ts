import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './FlowUtils';

/**
 * Converts an image file (PNG/JPEG) to a PDF file at 1:1 pixel scale (maximum quality).
 * Preserves the exact original pixels without recompression or resampling.
 * 
 * @param imagePath Full path to the source image.
 * @param pdfPath Full path to the destination PDF.
 */
export async function convertImageToPdf(imagePath: string, pdfPath: string): Promise<void> {
  logger.info(`Convertendo imagem para PDF: ${imagePath} -> ${pdfPath}`);
  
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Imagem de origem não encontrada: ${imagePath}`);
  }

  const imageBytes = fs.readFileSync(imagePath);
  const pdfDoc = await PDFDocument.create();
  
  const ext = path.extname(imagePath).toLowerCase();
  let embeddedImage;

  if (ext === '.png') {
    embeddedImage = await pdfDoc.embedPng(imageBytes);
  } else if (ext === '.jpg' || ext === '.jpeg') {
    embeddedImage = await pdfDoc.embedJpg(imageBytes);
  } else {
    throw new Error(`Formato de imagem não suportado para PDF: ${ext}`);
  }

  // Get native dimensions
  const { width, height } = embeddedImage.scale(1.0);
  
  // Add a page with the exact dimensions of the image (1:1 ratio)
  const page = pdfDoc.addPage([width, height]);
  
  // Draw image at full scale
  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width,
    height,
  });

  const pdfBytes = await pdfDoc.save();
  
  // Ensure destination directory exists
  const destDir = path.dirname(pdfPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.writeFileSync(pdfPath, pdfBytes);
  logger.info(`PDF gerado com sucesso em: ${pdfPath}`);
}
