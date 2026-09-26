import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PresentationImage, ExtractedPresentation } from '../types';

const MAX_CHARS = 20000;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB

export const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

export function truncateText(text: string): string {
  if (text.length > MAX_CHARS) {
    return (
      text.slice(0, MAX_CHARS) +
      '\n\n...[truncated — showing the first ' +
      MAX_CHARS.toLocaleString() +
      ' characters]'
    );
  }
  return text;
}

export async function extractPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  if (!window.pdfjsLib) {
    throw new Error('PDF viewer library is loading. Please try again in a moment.');
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const doc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    out += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  return out.trim();
}

/**
 * Extracts all slide text AND extracts all embedded images from a PPTX file.
 */
export async function extractPptxWithImages(arrayBuffer: ArrayBuffer): Promise<ExtractedPresentation> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const matchA = a.match(/slide(\d+)\.xml/);
      const matchB = b.match(/slide(\d+)\.xml/);
      const na = matchA ? parseInt(matchA[1], 10) : 0;
      const nb = matchB ? parseInt(matchB[1], 10) : 0;
      return na - nb;
    });

  let textOut = '';
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('text');
    const matches = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    const slideText = matches.join(' ').trim();
    textOut += `--- Slide ${i + 1} ---\n${slideText}\n\n`;
  }

  // Extract embedded media images (ppt/media/image1.png, image2.jpeg, etc.)
  const mediaFiles = Object.keys(zip.files).filter((name) =>
    /^ppt\/media\/.*\.(png|jpe?g|webp|gif)$/i.test(name)
  );

  const images: PresentationImage[] = [];

  for (let i = 0; i < mediaFiles.length; i++) {
    const filePath = mediaFiles[i];
    const fileName = filePath.split('/').pop() || `slide-image-${i + 1}`;
    const ext = fileName.split('.').pop()?.toLowerCase() || 'jpeg';
    const mediaType = IMAGE_EXTENSIONS[ext] || 'image/jpeg';

    try {
      const blob = await zip.files[filePath].async('blob');
      // Skip tiny icon assets smaller than 4KB (usually bullet bullets, arrows, or watermarks)
      if (blob.size < 4096) continue;

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result.split(',')[1]);
          } else {
            reject(new Error('Failed to convert slide image'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      images.push({
        id: `pptx-img-${i}-${Date.now()}`,
        name: fileName,
        previewUrl: `data:${mediaType};base64,${base64}`,
        base64,
        mediaType,
      });
    } catch (e) {
      console.warn(`Could not extract presentation image ${filePath}:`, e);
    }
  }

  return {
    text: textOut.trim(),
    images,
  };
}

export async function extractPptx(arrayBuffer: ArrayBuffer): Promise<string> {
  const extracted = await extractPptxWithImages(arrayBuffer);
  return extracted.text;
}

export async function extractDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

export async function extractTxt(file: File): Promise<string> {
  return await file.text();
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1]);
      } else {
        reject(new Error('Failed to read file as base64 string.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

export function resizeImageBase64(
  base64: string,
  mediaType: string,
  maxDim: number = 1280,
  quality: number = 0.85
): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ base64, mediaType });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Could not process image dimensions.'));
    img.src = 'data:' + mediaType + ';base64,' + base64;
  });
}
