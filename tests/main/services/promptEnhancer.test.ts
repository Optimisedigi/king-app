import { describe, it, expect } from 'vitest';
import {
  ENHANCER_MODEL,
  ENHANCER_SYSTEM_PROMPT,
  buildEnhanceUserMessage,
  cleanEnhancedPrompt,
  normaliseEnhanceInput,
} from '../../../src/main/services/promptEnhancer';

describe('promptEnhancer', () => {
  it('uses GPT-6 Luna, the lowest GPT tier in the installed ggcoder registry', () => {
    expect(ENHANCER_MODEL).toBe('gpt-6-luna');
  });

  it('keeps the image-specific guidelines in the instructions', () => {
    expect(ENHANCER_SYSTEM_PROMPT).toMatch(/product must look exactly as photographed/);
    expect(ENHANCER_SYSTEM_PROMPT).toMatch(/\{productType\}/);
    expect(ENHANCER_SYSTEM_PROMPT).toMatch(/Never state an aspect ratio/);
  });

  it('sends the app context with the draft', () => {
    const message = buildEnhanceUserMessage('my candle on a table', {
      hasProductPhotos: true,
      aspectRatio: '4:5',
      framingControlled: true,
      imageModel: 'GPT Image 2',
    });
    expect(message).toContain('Product photos attached: yes.');
    expect(message).toContain('Aspect ratio: 4:5, set by the app.');
    expect(message).toContain('Camera framing: controlled by the app');
    expect(message).toContain('<draft>\nmy candle on a table\n</draft>');
  });

  it.each([
    ['```\nA candle on oak.\n```', 'A candle on oak.'],
    ["Here's the enhanced prompt:\n\nA candle on oak.", 'A candle on oak.'],
    ['<output>A candle on oak.</output>', 'A candle on oak.'],
    ['"A candle on oak."', 'A candle on oak.'],
    ['Label reads "Lumi" on the jar.', 'Label reads "Lumi" on the jar.'],
  ])('cleans wrapping from %j', (raw, expected) => {
    expect(cleanEnhancedPrompt(raw)).toBe(expected);
  });

  it('rejects an empty draft and falls back on unknown settings', () => {
    expect(() => normaliseEnhanceInput({ prompt: '   ' })).toThrow(/Write a prompt/);
    const input = normaliseEnhanceInput({ prompt: 'x', aspectRatio: '<script>', provider: 'fal' });
    expect(input.context.aspectRatio).toBe('auto');
    expect(input.context.hasProductPhotos).toBe(false);
    expect(input.preferApiKey).toBe(false);
  });
});
