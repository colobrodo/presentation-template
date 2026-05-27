#!/usr/bin/env node

import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
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
 * Parse a slide selector string into an array of terms.
 *
 * Syntax (all numbers are 1-based, combine with commas):
 *   N         slide N
 *   N-M       slides N to M inclusive
 *   -M        slides 1 to M
 *   N-        slides N to last
 *   N:F       frame F of slide N
 *   N:F-G     frames F to G of slide N
 *   N:F-      frames F to last of slide N
 *   N:-G      frames 1 to G of slide N
 *
 * Frame 1 = initial slide state, frame 2 = after first fragment, etc.
 * Example: 1-4,7:1-3,9
 */
function parseSelector(str) {
  const terms = [];
  for (const part of str.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const pageStr = trimmed.slice(0, colonIdx);
      const frameStr = trimmed.slice(colonIdx + 1);

      const page = parseInt(pageStr, 10);
      if (isNaN(page) || page < 1) {
        throw new Error(`Invalid slide number: "${pageStr}"`);
      }

      const dashIdx = frameStr.indexOf('-');
      let frameFrom, frameTo;
      if (dashIdx !== -1) {
        const fromStr = frameStr.slice(0, dashIdx);
        const toStr = frameStr.slice(dashIdx + 1);
        frameFrom = fromStr ? parseInt(fromStr, 10) : null;
        frameTo = toStr ? parseInt(toStr, 10) : null;
        if (fromStr && (isNaN(frameFrom) || frameFrom < 1)) {
          throw new Error(`Invalid frame number: "${fromStr}"`);
        }
        if (toStr && (isNaN(frameTo) || frameTo < 1)) {
          throw new Error(`Invalid frame number: "${toStr}"`);
        }
        if (frameFrom !== null && frameTo !== null && frameFrom > frameTo) {
          throw new Error(`Invalid frame range: "${frameStr}" (start > end)`);
        }
      } else {
        const f = parseInt(frameStr, 10);
        if (isNaN(f) || f < 1) throw new Error(`Invalid frame number: "${frameStr}"`);
        frameFrom = f;
        frameTo = f;
      }

      terms.push({ type: 'pageframes', page, frameFrom, frameTo });
    } else {
      const dashIdx = trimmed.indexOf('-');
      if (dashIdx !== -1) {
        const fromStr = trimmed.slice(0, dashIdx);
        const toStr = trimmed.slice(dashIdx + 1);
        const from = fromStr ? parseInt(fromStr, 10) : null;
        const to = toStr ? parseInt(toStr, 10) : null;
        if (fromStr && (isNaN(from) || from < 1)) {
          throw new Error(`Invalid slide number: "${fromStr}"`);
        }
        if (toStr && (isNaN(to) || to < 1)) {
          throw new Error(`Invalid slide number: "${toStr}"`);
        }
        if (from !== null && to !== null && from > to) {
          throw new Error(`Invalid slide range: "${trimmed}" (start > end)`);
        }
        terms.push({ type: 'range', from, to });
      } else {
        const page = parseInt(trimmed, 10);
        if (isNaN(page) || page < 1) {
          throw new Error(`Invalid slide number: "${trimmed}"`);
        }
        terms.push({ type: 'page', page });
      }
    }
  }
  return terms;
}

function matchSelector(terms, slideNum, totalSlides) {
  for (const term of terms) {
    if (term.type === 'page') {
      if (term.page === slideNum) return { match: true, frameFrom: null, frameTo: null };
    } else if (term.type === 'range') {
      const from = term.from ?? 1;
      const to = term.to ?? totalSlides;
      if (slideNum >= from && slideNum <= to) return { match: true, frameFrom: null, frameTo: null };
    } else if (term.type === 'pageframes') {
      if (term.page === slideNum) return { match: true, frameFrom: term.frameFrom, frameTo: term.frameTo };
    }
  }
  return { match: false, frameFrom: null, frameTo: null };
}

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
    slides: null,
    png: false,
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
    } else if (arg === '-s' || arg === '--slides') {
      result.slides = args[++i];
    } else if (arg === '--last-frame') {
      result.lastFrame = true;
    } else if (arg === '--png') {
      result.png = true;
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
async function renderRevealJsToPdf(url, outputPath, viewportWidth, viewportHeight, lastFrame = false, selector = null, png = false) {
  log(`Starting Reveal.js to ${png ? 'PNG' : 'PDF'} conversion...`);
  log(`URL: ${url}`);
  log(`Output: ${outputPath}`);
  log(`Resolution: ${viewportWidth}x${viewportHeight}`);
  if (lastFrame) {
    log(`Mode: Last frame only (fragments disabled)`);
  }
  if (selector) {
    log(`Slide filter: active`);
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

  // Warn if --last-frame conflicts with frame-specific selectors
  if (lastFrame && selector) {
    const hasFrameSpecific = selector.some(t => t.type === 'pageframes');
    if (hasFrameSpecific) {
      log(`Warning: --last-frame conflicts with frame-specific selectors (N:F-G). Frame ranges take precedence; --last-frame applies to slides without a frame range.`);
    }
  }

  // Returns the frame range [frameFrom, frameTo] (1-based) to render for a slide,
  // or null if the slide should be skipped.
  function getSlideFrameRange(slideNum, fragmentCount) {
    const totalFrames = 1 + fragmentCount;

    if (selector) {
      const { match, frameFrom, frameTo } = matchSelector(selector, slideNum, totalSlides);
      if (!match) return null;
      if (frameFrom !== null || frameTo !== null) {
        // Frame-specific selector: ignore --last-frame for this slide
        return { frameFrom: frameFrom ?? 1, frameTo: frameTo ?? totalFrames };
      }
    }

    if (lastFrame) {
      return { frameFrom: totalFrames, frameTo: totalFrames };
    }

    return { frameFrom: 1, frameTo: totalFrames };
  }

  // Compute total states for progress bar
  let totalStates = 0;
  for (let i = 0; i < slideData.length; i++) {
    const range = getSlideFrameRange(i + 1, slideData[i].fragmentCount);
    if (!range) continue;
    const maxFrame = 1 + slideData[i].fragmentCount;
    const from = Math.max(1, range.frameFrom);
    const to = Math.min(maxFrame, range.frameTo);
    totalStates += Math.max(0, to - from + 1);
  }

  const filteredSlideCount = slideData.filter((s, i) => getSlideFrameRange(i + 1, s.fragmentCount) !== null).length;

  log(`Found ${totalSlides} slides, rendering ${filteredSlideCount} with ${totalStates} total frames\n`);

  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Rendering |{bar}| {percentage}% | Slide {currentSlide}/{filteredSlides} | Frame {currentState}/{totalStates}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    stream: process.stderr
  });

  progressBar.start(totalStates, 0, {
    currentSlide: 0,
    filteredSlides: filteredSlideCount,
    currentState: 0,
    totalStates
  });

  if (png) {
    await fs.mkdir(outputPath, { recursive: true });
  }

  const screenshots = png ? null : [];
  let stateIndex = 0;
  let slideRenderedCount = 0;

  for (let i = 0; i < slideData.length; i++) {
    const slideNum = i + 1;
    const { h, v, fragmentCount } = slideData[i];

    const range = getSlideFrameRange(slideNum, fragmentCount);
    if (!range) continue;

    slideRenderedCount++;
    const maxFrame = 1 + fragmentCount;
    const frameFrom = Math.max(1, range.frameFrom);
    const frameTo = Math.min(maxFrame, range.frameTo);
    const frameCount = frameTo - frameFrom + 1;

    for (let frameNum = frameFrom; frameNum <= frameTo; frameNum++) {
      // Frame 1 = initial state (fragment index -1), frame k = fragment index k-2
      const fragIndex = frameNum === 1 ? -1 : frameNum - 2;

      await page.evaluate(({ h, v, fragIndex }) => {
        Reveal.slide(h, v, fragIndex);
      }, { h, v, fragIndex });

      if (frameNum === frameFrom) {
        // First frame of this slide: wait for slide transition
        await waitForTransition(page);
      } else {
        // Subsequent fragment within same slide
        await delay(300);
      }

      stateIndex++;
      progressBar.update(stateIndex, {
        currentSlide: slideRenderedCount,
        currentState: stateIndex
      });

      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: false
      });
      if (png) {
        const filename = (lastFrame || frameCount === 1) ? `${slideNum}.png` : `${slideNum}-${frameNum}.png`;
        await fs.writeFile(path.join(outputPath, filename), screenshot);
      } else {
        screenshots.push(screenshot);
      }
    }
  }

  progressBar.stop();

  if (png) {
    log(`\nAll ${stateIndex} frames saved to: ${outputPath}`);
  } else {
    log(`\nAll ${screenshots.length} frames captured. Generating PDF...`);

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

    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(outputPath, pdfBytes);

    log(`PDF saved to: ${outputPath}`);
  }

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

Usage: node render-revealjs.js [options] <url> <output>

Arguments:
  url              URL of the Reveal.js presentation (required)
  output           Output PDF file path (required)

Options:
  -w, --width <n>       Viewport width in pixels (default: 1920)
  -H, --height <n>      Viewport height in pixels (default: 1080)
  -o, --output <path>   Output PDF file path
  -s, --slides <sel>    Render only specified slides/frames (see Slide Selector below)
  --last-frame          Render only the last frame of each slide, skipping fragment animations
  --png                 Save slides as PNG images; output must be a directory
                        Named {slide}-{frame}.png for multi-frame slides, {slide}.png for single-frame slides or --last-frame
  -h, --help            Show this help message

Resolution:
  - If both width and height are specified, use those exact dimensions
  - If only width is specified, calculate height to maintain 16:9 aspect ratio
  - If only height is specified, calculate width to maintain 16:9 aspect ratio
  - Default: 1920x1080 (Full HD, 16:9)

Slide Selector (-s / --slides):
  All numbers are 1-based. Combine multiple selectors with commas.

  N           Slide N
  N-M         Slides N to M (inclusive)
  -M          Slides 1 to M
  N-          Slides N to last
  N:F         Frame F of slide N
  N:F-G       Frames F to G of slide N (inclusive)
  N:F-        Frames F to last of slide N
  N:-G        Frames 1 to G of slide N

  A "frame" is a visual state of a slide: frame 1 is the initial state,
  frame 2 is after the first fragment reveal, frame 3 after the second, etc.

  When a frame range (N:F-G) is specified, it takes precedence over --last-frame
  for that slide. A warning is shown if both are used together.

Examples:
  node render-revealjs.js http://localhost:8000 output.pdf
  node render-revealjs.js -w 1280 -H 720 http://localhost:8000 presentation.pdf
  node render-revealjs.js --width 2560 http://localhost:8000/presentation.html presentation.pdf
  node render-revealjs.js --last-frame http://localhost:8000 slides.pdf
  node render-revealjs.js -H 1080 --last-frame http://localhost:8000 slides.pdf
  node render-revealjs.js -s 1-4,7:1-3,9 http://localhost:8000 slides.pdf
  node render-revealjs.js -s -10 http://localhost:8000 slides.pdf
  node render-revealjs.js -s 5- http://localhost:8000 slides.pdf
  node render-revealjs.js -s 3,7:2-4,10- http://localhost:8000 slides.pdf
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

  // Parse slide selector
  let selector = null;
  if (options.slides) {
    try {
      selector = parseSelector(options.slides);
    } catch (e) {
      log(`Error: Invalid slide selector: ${e.message}`);
      process.exit(1);
    }
  }

  // Calculate dimensions
  const { width, height } = calculateDimensions(options.width, options.height);

  // Validate dimensions
  if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
    log(`Error: Invalid dimensions specified`);
    process.exit(1);
  }

  try {
    await renderRevealJsToPdf(options.url, options.output, width, height, options.lastFrame, selector, options.png);
    log(`\nConversion completed successfully!`);
  } catch (error) {
    log(`\nError during conversion: ${error.message}`);
    process.exit(1);
  }
}

main();
