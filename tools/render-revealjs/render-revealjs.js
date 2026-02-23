#!/usr/bin/env node

import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import cliProgress from 'cli-progress';
import { assert } from 'console';

// Helper function to wait for a specified time
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Log to stderr
const log = (msg) => process.stderr.write(msg + '\n');

// Default dimensions (16:9 aspect ratio)
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_ASPECT_RATIO = DEFAULT_WIDTH / DEFAULT_HEIGHT;

/**
 * Parse CLI arguments
 */
function parseArgs(args) {
  const result = {
    url: null,
    output: null,
    width: null,
    height: null,
    lastFrame: false,
    help: false,
    success: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-h' || arg === '--help') {
      result.help = true;
      result.success = true;
      break;
    } else if (arg === '-w' || arg === '--width') {
      result.width = parseInt(args[++i], 10);
    } else if (arg === '-H' || arg === '--height') {
      result.height = parseInt(args[++i], 10);
    } else if (arg === '-o' || arg === '--output') {
      result.output = args[++i];
    } else if (arg === '--last-frame') {
      result.lastFrame = true;
    } else if (!result.url) {
      result.url = arg;
    } else if (!result.output) {
      result.output = arg;
      result.success = true;
    } else {
      // Here we parse an additional positional parameter 
      result.success = false;
    }
  }

  return result;
}

/**
 * Calculate dimensions maintaining aspect ratio
 */
function calculateDimensions(width, height) {
  if (width && height) {
    return { width, height };
  }
  
  if (width && !height) {
    return { width, height: Math.round(width / DEFAULT_ASPECT_RATIO) };
  }
  
  if (!width && height) {
    return { width: Math.round(height * DEFAULT_ASPECT_RATIO), height };
  }
  
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

/**
 * Renders a Reveal.js presentation to PDF by taking screenshots of each slide
 * and each fragment state (pauses/incremental reveals)
 */
async function renderRevealJsToPdf(url, outputPath, viewportWidth, viewportHeight, lastFrame = false) {
  log(`Starting Reveal.js to PDF conversion...`);
  log(`URL: ${url}`);
  log(`Output: ${outputPath}`);
  log(`Resolution: ${viewportWidth}x${viewportHeight}`);
  if (lastFrame) {
    log(`Mode: Last frame only (fragments disabled)`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: viewportWidth, height: viewportHeight });

  log(`Loading presentation...`);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

  // Wait for Reveal.js to initialize
  await page.waitForFunction(() => {
    return typeof Reveal !== 'undefined' && Reveal.isReady();
  }, { timeout: 30000 });

  log(`Reveal.js loaded successfully`);

  // Collect all slide indices with fragment counts
  const slideData = await page.evaluate(() => {
    const slides = [];
    const horizontalSlides = Reveal.getHorizontalSlides();
    
    for (let h = 0; h < horizontalSlides.length; h++) {
      const verticalSlidesSelector = `.slides > section:nth-child(${h + 1}) > section`;
      const verticalSlides = document.querySelectorAll(verticalSlidesSelector);
      
      if (verticalSlides.length > 0) {
        for (let v = 0; v < verticalSlides.length; v++) {
          const fragmentCount = verticalSlides[v].querySelectorAll('.fragment').length;
          slides.push({ h, v, fragmentCount });
        }
      } else {
        const fragmentCount = horizontalSlides[h].querySelectorAll('.fragment').length;
        slides.push({ h, v: 0, fragmentCount });
      }
    }
    
    return slides;
  });

  const totalSlides = slideData.length;
  const totalStates = lastFrame 
    ? totalSlides 
    : slideData.reduce((sum, slide) => sum + 1 + slide.fragmentCount, 0);

  if (lastFrame) {
    log(`Found ${totalSlides} slides\n`);
  } else {
    log(`Found ${totalSlides} slides with ${totalStates} total states (including fragment steps)\n`);
  }
  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Rendering |{bar}| {percentage}% | Slide {currentSlide}/{totalSlides} | State {currentState}/{totalStates}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    stream: process.stderr
  });

  progressBar.start(totalStates, 0, {
    currentSlide: 0,
    totalSlides,
    currentState: 0,
    totalStates
  });

  // Take screenshots of each slide and fragment state
  const screenshots = [];
  let stateIndex = 0;

  for (let i = 0; i < slideData.length; i++) {
    const { h, v, fragmentCount } = slideData[i];
    
    if (lastFrame && fragmentCount > 0) {
      // Skip to the last fragment if rendering last frame only
      await page.evaluate(({ h, v, fragmentCount }) => {
        Reveal.slide(h, v, fragmentCount - 1);
      }, { h, v, fragmentCount });
    } else {
      // Navigate to the slide with fragment index -1 (no fragments visible)
      await page.evaluate(({ h, v }) => {
        Reveal.slide(h, v, -1);
      }, { h, v });
    }

    // Wait for transition
    await waitForTransition(page);

    // Capture screenshot
    stateIndex++;
    progressBar.update(stateIndex, {
      currentSlide: i + 1,
      currentState: stateIndex
    });
    
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false
    });
    screenshots.push(screenshot);

    // Capture each fragment state (only if not in lastFrame mode)
    if (!lastFrame) {
      for (let f = 0; f < fragmentCount; f++) {
        // Navigate to next fragment
        await page.evaluate(() => {
          Reveal.nextFragment();
        });

        // Wait for fragment animation
        await delay(300);

        stateIndex++;
        progressBar.update(stateIndex, {
          currentSlide: i + 1,
          currentState: stateIndex
        });

        const fragmentScreenshot = await page.screenshot({
          type: 'png',
          fullPage: false
        });
        screenshots.push(fragmentScreenshot);
      }
    }
  }

  progressBar.stop();
  log(`\nAll ${screenshots.length} states captured. Generating PDF...`);

  // Create PDF from screenshots
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < screenshots.length; i++) {
    const screenshot = screenshots[i];
    const pngImage = await pdfDoc.embedPng(screenshot);
    
    const pdfPage = pdfDoc.addPage([viewportWidth, viewportHeight]);
    
    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: viewportWidth,
      height: viewportHeight
    });
  }

  // Save PDF
  const pdfBytes = await pdfDoc.save();
  await fs.writeFile(outputPath, pdfBytes);

  log(`PDF saved to: ${outputPath}`);

  await browser.close();
  
  return outputPath;
}

async function waitForTransition(page) {
  await page.evaluate(() => {
    return new Promise(resolve => {
      const transitionSpeed = Reveal.getConfig().transitionSpeed;
      const delay = transitionSpeed === 'fast' ? 400 : transitionSpeed === 'slow' ? 1000 : 600;
      setTimeout(resolve, delay);
    });
  });

  await delay(200);
}

function showHelp() {
  console.log(`
Reveal.js to PDF Converter

Usage: node render-revealjs.js [options] <url>

Arguments:
  url              URL of the Reveal.js presentation (required)

Options:
  -w, --width <n>     Viewport width in pixels (default: 1920)
  -H, --height <n>    Viewport height in pixels (default: 1080)
  --last-frame        Render only the last frame of each slide, skipping all fragment animations
  -h, --help          Show this help message

Resolution:
  - If both width and height are specified, use those exact dimensions
  - If only width is specified, calculate height to maintain 16:9 aspect ratio
  - If only height is specified, calculate width to maintain 16:9 aspect ratio
  - Default: 1920x1080 (Full HD, 16:9)

Examples:
  node render-revealjs.js http://localhost:8000 output.pdf
  node render-revealjs.js -w 1280 -H 720 http://localhost:8000 presentation.pdf
  node render-revealjs.js --width 2560 http://localhost:8000/presentation.html presentation.pdf
  node render-revealjs.js --last-frame http://localhost:8000 slides.pdf
  node render-revealjs.js -H 1080 --last-frame http://localhost:8000 slides.pdf
`);
}

// CLI handling
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || !options.success) {
    showHelp();
    process.exit(options.success ? 0 : 1);
  }

  assert(options.url !== null);
  assert(options.output !== null);

  // Validate URL
  try {
    new URL(options.url);
  } catch (e) {
    log(`Error: Invalid URL provided: ${options.url}`);
    process.exit(1);
  }

  // Calculate dimensions
  const { width, height } = calculateDimensions(options.width, options.height);

  // Validate dimensions
  if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
    log(`Error: Invalid dimensions specified`);
    process.exit(1);
  }

  try {
    await renderRevealJsToPdf(options.url, options.output, width, height, options.lastFrame);
    log(`\nConversion completed successfully!`);
  } catch (error) {
    log(`\nError during conversion: ${error.message}`);
    process.exit(1);
  }
}

main();
